"""Etapa `route`: ¿el documento pasa directo (STP) o va a revisión, y con QUÉ campos?

Por qué es el corazón del sistema: el negocio no compra "un modelo con 97 % de exactitud", compra
"que los capturistas solo vean lo dudoso". Esa promesa vive aquí:

  STP (straight-through processing) ⇔ TODOS los campos requeridos superan su umbral calibrado
                                       Y TODAS las validaciones requeridas corrieron y pasan.

Falla CERRADA: lo que no se puede comprobar no pasa. Una confianza que no es un número finito en
[0, 1] (NaN llega fácil: json.loads acepta el literal NaN y un calibrador degenerado puede emitirlo, y
`nan < 0.995` es False) marca el campo. Una validación de `required_checks` que no llegó marca el
documento: una lista vacía de validaciones no es "todo pasó", es "no sabemos".

Si no, se crea una tarea de revisión con SOLO los campos marcados (valor leído, confianza, página,
bbox para el recorte y el motivo). El revisor corrige 2 campos en ≈ 45 s en vez de capturar 15 en
≈ 4 min, y cada corrección es una etiqueta nueva para reentrenar.

Decisiones que este archivo deja explícitas:
  - Umbral POR CAMPO y por tipo de documento: una CLABE mal leída cuesta mucho más que un nombre de
    colonia mal leído. Los umbrales salen de calibrate_thresholds.py, no de la intuición.
  - Versión de umbrales POR TIPO (thresholds_version, junto con el model_version para el que se
    calibraron): cada decisión dice qué juego de umbrales aceptó el campo, y revertir un tipo no toca
    a los demás. Si el extractor reporta otro model_version, los umbrales no aplican: va a revisión.
  - Una regla que falla no rechaza: marca el campo (validators.py).
  - Un campo opcional bajo su umbral no bloquea el STP: se entrega como "no verificado".
  - Fuentes que nunca se auto-aceptan (manuscrito: Textract solo lee escritura a mano en inglés).
  - Prioridad = vencimiento del SLA (4 horas hábiles) menos un bono por etapa del crédito.
  - Auditoría: 2 % de los STP al azar (hash del document_id), la única medición sin sesgo de lo que
    nadie más mira. Se elige por hash y no por confianza a propósito: si auditaras los de confianza
    más baja, medirías la exactitud de la frontera, no la del documento típico.

Puro: sin I/O. El worker carga la config, lee de S3 los campos y las validaciones (por el estado de
Step Functions solo viajan llaves), llama a decide(), guarda la decisión completa (la tarea de revisión
lleva valores: PII) en S3 y devuelve a Step Functions solo `state_summary()`, sin valores: el historial
de ejecuciones guarda la entrada y la salida de cada estado.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

from validators import ValidationResult


@dataclass(frozen=True)
class DocTypeConfig:
    required: tuple[str, ...]
    thresholds: dict[str, float | None]
    required_checks: tuple[str, ...]
    model_version: str
    thresholds_version: str


@dataclass(frozen=True)
class SlaConfig:
    business_hours: float
    timezone: str
    workdays: tuple[int, ...]
    start: dt.time
    end: dt.time
    holidays: frozenset[dt.date]


@dataclass(frozen=True)
class RoutingConfig:
    version: str
    doc_types: dict[str, DocTypeConfig]
    critical_fields: frozenset[str]
    never_auto_sources: frozenset[str]
    sla: SlaConfig
    stage_bonus_minutes: dict[str, int]
    audit_rate: float


def load_config(path: str | Path) -> RoutingConfig:
    """Lee routing.yaml y FALLA al arrancar si está mal: un umbral fuera de [0, 1] o un campo
    requerido sin umbral es un error de configuración que no debe descubrirse con tráfico real."""
    raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    return parse_config(raw)


def parse_config(raw: dict) -> RoutingConfig:
    doc_types = {}
    for name, d in raw["doc_types"].items():
        thresholds = dict(d.get("thresholds") or {})
        for f, t in thresholds.items():
            if t is not None and not (0.0 <= float(t) <= 1.0):
                raise ValueError(f"{name}.{f}: umbral {t} fuera de [0, 1]")
        missing = [f for f in d["required"] if f not in thresholds]
        if missing:
            raise ValueError(f"{name}: campos requeridos sin umbral: {missing}")
        for key in ("model_version", "thresholds_version", "required_checks"):
            if not d.get(key):
                raise ValueError(f"{name}: falta {key} (los umbrales se versionan por tipo, con su modelo)")
        doc_types[name] = DocTypeConfig(tuple(d["required"]), thresholds, tuple(d["required_checks"]),
                                        str(d["model_version"]), str(d["thresholds_version"]))
    s = raw["review_sla"]
    sla = SlaConfig(
        business_hours=float(s["business_hours"]),
        timezone=s["timezone"],
        workdays=tuple(s["workdays"]),
        start=dt.time.fromisoformat(s["start"]),
        end=dt.time.fromisoformat(s["end"]),
        holidays=frozenset(dt.date.fromisoformat(h) for h in s.get("holidays") or []),
    )
    rate = float(raw.get("audit_rate", 0.02))
    if not 0.0 <= rate <= 1.0:
        raise ValueError("audit_rate fuera de [0, 1]")
    return RoutingConfig(
        version=str(raw.get("version", "unknown")),
        doc_types=doc_types,
        critical_fields=frozenset(raw.get("critical_fields") or []),
        never_auto_sources=frozenset(raw.get("never_auto_sources") or []),
        sla=sla,
        stage_bonus_minutes={k: int(v) for k, v in (raw.get("stage_bonus_minutes") or {}).items()},
        audit_rate=rate,
    )


# ------------------------------------------------------------------------------------------ el SLA
def add_business_hours(start: dt.datetime, hours: float, sla: SlaConfig) -> dt.datetime:
    """Suma horas HÁBILES. Ejemplo (lun–vie 09:00–19:00): un documento que llega el viernes a las
    17:00 tiene 2 h el viernes y vence el lunes a las 11:00, no el viernes a las 21:00.

    Usa la zona del equipo (America/Mexico_City). México dejó el horario de verano en 2022; la base
    de datos de zonas (tzdata) lo sabe, por eso se fija tzdata en requirements.txt: una imagen slim sin
    base de zonas haría fallar ZoneInfo.
    """
    if start.tzinfo is None:
        raise ValueError("start debe tener zona horaria (guárdalo en UTC, nunca 'naive')")
    tz = ZoneInfo(sla.timezone)
    t = start.astimezone(tz)
    remaining = dt.timedelta(hours=hours)
    for _ in range(400):  # tope defensivo: 400 días sin horas hábiles = config rota
        day = t.date()
        if day.weekday() in sla.workdays and day not in sla.holidays:
            open_t = dt.datetime.combine(day, sla.start, tz)
            close_t = dt.datetime.combine(day, sla.end, tz)
            if t < open_t:
                t = open_t
            if t < close_t:
                available = close_t - t
                if remaining <= available:
                    return t + remaining
                remaining -= available
        t = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(0, 0), tz)
    raise ValueError("no hay horas hábiles en la configuración del SLA")


def select_for_audit(document_id: str, rate: float, salt: str = "audit-v1") -> bool:
    """Muestra aleatoria reproducible: el mismo documento siempre cae del mismo lado (un reintento de
    la etapa no lo "re-sortea") y nadie puede predecir ni influir qué se audita. Cambiar `salt`
    cambia la muestra (por ejemplo, si se sospecha que alguien la aprendió)."""
    h = hashlib.sha256(f"{salt}:{document_id}".encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64 < rate


# --------------------------------------------------------------------------------------- decisión
@dataclass
class FlaggedField:
    field: str
    value: str | None
    confidence: float | None
    page: int | None
    bbox: list[float] | None  # [x0, y0, x1, y1] en fracciones de la página: la UI recorta la imagen
    reasons: list[str] = field(default_factory=list)
    critical: bool = False


@dataclass
class RouteDecision:
    decision: str  # "stp" | "review"  (el Choice IsStp de la máquina de estados lee esto)
    document_id: str
    doc_type: str
    config_version: str  # revisión del archivo routing.yaml
    thresholds_version: str | None = None  # la del TIPO: qué juego de umbrales decidió (procedencia)
    model_version: str | None = None  # el modelo para el que se calibraron esos umbrales
    unverified_fields: list[str] = field(default_factory=list)
    audit: bool = False  # solo STP: ¿entra a la muestra de QA?
    review_task: dict | None = None  # con valores (PII): va a S3, nunca al estado de Step Functions

    def as_dict(self) -> dict:
        """Decisión COMPLETA (incluye valores en review_task): la guarda el worker en S3/Postgres."""
        return asdict(self)

    def state_summary(self, review_task_key: str | None = None) -> dict:
        """Lo que vuelve a Step Functions con SendTaskSuccess: sin un solo valor de campo ni motivo con
        montos. Solo nombres de campos, versiones y la llave de S3 donde quedó la tarea completa."""
        task = self.review_task or {}
        return {
            "decision": self.decision,
            "document_id": self.document_id,
            "doc_type": self.doc_type,
            "config_version": self.config_version,
            "thresholds_version": self.thresholds_version,
            "model_version": self.model_version,
            "unverified_fields": list(self.unverified_fields),
            "audit": self.audit,
            "flagged_fields": [f["field"] for f in task.get("flagged_fields", [])],
            "n_doc_flags": len(task.get("doc_flags", [])),
            "sort_at": task.get("sort_at"),
            "review_task_key": review_task_key if self.review_task is not None else None,
        }


def decide(
    doc: dict,
    validations: list[ValidationResult],
    cfg: RoutingConfig,
    *,
    loan_stage: str,
    received_at: dt.datetime,
) -> RouteDecision:
    """doc = {"document_id", "doc_type", "fields": {nombre: {value, confidence, source, page, bbox}}
    [, "model_version"]}. Si trae model_version y no es el de los umbrales de su tipo, va a revisión.

    Ejemplo: INE con curp 0.999 (umbral 0.995), nombre 0.98 (0.97), fecha_nacimiento 0.95 (0.98) y la
    validación curp_fecha_nacimiento fallida → review con 2 campos marcados (fecha_nacimiento por
    confianza y por cruce; curp por cruce). El revisor ve 2 recortes, no la INE completa.
    """
    doc_id, doc_type = doc["document_id"], doc["doc_type"]
    fields = doc.get("fields") or {}
    flagged: dict[str, FlaggedField] = {}
    doc_flags: list[str] = []
    unverified: list[str] = []

    def flag(name: str, reason: str) -> None:
        fv = fields.get(name) or {}
        ff = flagged.setdefault(name, FlaggedField(
            field=name, value=fv.get("value"), confidence=fv.get("confidence"), page=fv.get("page"),
            bbox=fv.get("bbox"), critical=name in cfg.critical_fields))
        if reason not in ff.reasons:
            ff.reasons.append(reason)

    tcfg = cfg.doc_types.get(doc_type)
    if tcfg is None:
        doc_flags.append(f"Tipo de documento sin configuración de ruteo: {doc_type}.")
    else:
        mv = doc.get("model_version")
        if mv is not None and mv != tcfg.model_version:
            doc_flags.append(f"Umbrales calibrados para {tcfg.model_version}, no para {mv}.")
        ran = {v.check for v in validations}
        for check in tcfg.required_checks:
            if check not in ran:
                doc_flags.append(f"Falta la validación {check}.")
        for name in sorted(set(tcfg.required) | set(fields)):
            if name not in tcfg.thresholds:
                continue  # campo que el modelo extrae pero el negocio no usa: no se enruta
            required = name in tcfg.required
            fv = fields.get(name)
            reason = _field_problem(fv, tcfg.thresholds[name], cfg)
            if reason is None:
                continue
            if required:
                flag(name, reason)
            elif fv is not None:
                unverified.append(name)

    for v in validations:
        if v.ok:
            continue
        if v.fields:
            for name in v.fields:
                flag(name, v.reason)
        else:
            doc_flags.append(v.reason)

    tv = tcfg.thresholds_version if tcfg else None
    mv = tcfg.model_version if tcfg else None
    if not flagged and not doc_flags:
        return RouteDecision("stp", doc_id, doc_type, cfg.version, tv, mv, unverified_fields=sorted(unverified),
                             audit=select_for_audit(doc_id, cfg.audit_rate))

    deadline = add_business_hours(received_at, cfg.sla.business_hours, cfg.sla)
    bonus = dt.timedelta(minutes=cfg.stage_bonus_minutes.get(loan_stage, 0))
    task = {
        "document_id": doc_id,
        "doc_type": doc_type,
        "loan_stage": loan_stage,
        # Críticos primero: el revisor los ve arriba.
        "flagged_fields": [asdict(f) for f in sorted(flagged.values(), key=lambda f: (not f.critical, f.field))],
        "doc_flags": doc_flags,
        "received_at": received_at.isoformat(),
        "deadline": deadline.isoformat(),
        # La cola del revisor se ordena por sort_at ascendente (SQS no ordena: lo hace review-api en Postgres).
        "sort_at": (deadline - bonus).isoformat(),
        "config_version": cfg.version,
        "thresholds_version": tv,
        "model_version": mv,
    }
    return RouteDecision("review", doc_id, doc_type, cfg.version, tv, mv, unverified_fields=sorted(unverified),
                         review_task=task)


def _field_problem(fv: dict | None, threshold: float | None, cfg: RoutingConfig) -> str | None:
    """Motivo por el que un campo no se puede auto-aceptar, o None si se acepta."""
    if fv is None or fv.get("value") in (None, ""):
        return "No se encontró el campo."
    if threshold is None:
        return "Este campo siempre lo verifica una persona."
    if fv.get("source") in cfg.never_auto_sources:
        return "Texto manuscrito: este OCR no reconoce escritura a mano en español; lo verifica una persona."
    conf = fv.get("confidence")
    if conf is None:
        return f"Sin confianza (umbral {threshold:.3f})."
    # bool es subclase de int: True no es una confianza. NaN, ±inf, texto o fuera de [0, 1] → inválida.
    if isinstance(conf, bool) or not isinstance(conf, (int, float)) or not math.isfinite(conf) \
            or not 0.0 <= conf <= 1.0:
        return "Confianza inválida (no es un número entre 0 y 1)."
    if conf < threshold:
        return f"Confianza {conf:.3f} < umbral {threshold:.3f}."
    return None
