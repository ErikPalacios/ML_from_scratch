"""Umbral de confianza POR CAMPO para una exactitud objetivo, con una cota de Wilson.

Pregunta que responde: "¿desde qué confianza puedo aceptar `curp` sin que lo vea nadie y seguir
cumpliendo 99.9 %?". No basta con que la exactitud observada sea ≥ 99.9 %: con 200 ejemplos y 0
errores también lo es, y no prueba nada. Por eso se exige que la COTA INFERIOR del intervalo de
Wilson (z = 1.96 por defecto, ≈ 95 % de confianza) supere el objetivo.

Números que conviene saber de memoria (cero errores → cota = n / (n + z²)):
  objetivo 99.5 % → n ≥ 0.995 × 3.8416 / 0.005 ≈ 765 aciertos seguidos sobre el umbral
  objetivo 99.9 % → n ≥ 0.999 × 3.8416 / 0.001 ≈ 3,838
El gold set (2,000 documentos, estratificado: ≈ 400 por tipo) es para el GATE y no se usa aquí; de
todos modos, ≈ 400 INE no alcanzarían para certificar 99.9 % en CURP. Los miles de etiquetas salen de
la sombra (captura ciega, discrepancias adjudicadas por QA) y de lotes de doble captura aparte del gold
set; después, la auditoría los mantiene al día. Las capturas históricas no sirven para esto: traen
≈ 1–2 % de errores de tecleo (estimado), 10–20× el 0.1 % que intentas medir.

Entrada: CSV con columnas
  doc_id, doc_type, field, confidence, correct, label_source
  correct ∈ {1, 0, true, false}; label_source ∈ {audit, shadow, calib, review, gold}:
    shadow = sombra adjudicada; calib = lotes de doble captura con adjudicación, APARTE del gold set;
    audit  = auditoría aleatoria de los STP; review = correcciones de revisores; gold = gold set.
  Una fila sin label_source es un ERROR (con su número de línea): adivinar la fuente es justo cómo se
  cuela el gold set.
Por defecto se usan audit, shadow y calib (--sources). Las correcciones de revisión tienen SESGO DE
SELECCIÓN: solo existen para campos que ya estaban bajo el umbral, así que no dicen nada de la zona que
se auto-acepta. Y el GOLD SET NUNCA: si eliges el umbral mirándolo, deja de medir (el gate que lo usa
reportaría una exactitud optimista). Una fila gold hace fallar el script salvo --allow-gold, que existe
solo para experimentos y avisa.

La auditoría tiene el sesgo espejo: solo existe por ENCIMA del umbral vigente (se audita lo STP). Sirve
para confirmar ese umbral o subirlo, no para bajarlo ni para medir cobertura. Por eso (1) por debajo
de la confianza mínima auditada el umbral solo baja si la evidencia SIN auditoría lo justifica
(choose_threshold_audit_aware: si no, miles de aciertos auditados "subsidiarían" una franja que solo vio
la sombra), y (2) la cobertura se calcula solo con las fuentes incondicionales (shadow, calib), que
etiquetan todo lo que llegó; sin ellas se reporta "-".

Regla de elección (conservadora): se recorren los umbrales candidatos de mayor a menor confianza y
se toma el más bajo que pasa SIN cruzar una franja que falla. Si bajar el umbral hace fallar la cota,
paramos ahí aunque más abajo vuelva a pasar: una franja mala no se "subsidia" con miles de casos
fáciles de confianza 0.999.

Holdout: elegir el mejor de muchos umbrales sobre los mismos datos es optimista (te quedas con el
que tuvo suerte). Con --confirm-frac 0.3, el 30 % de los documentos (por hash de doc_id, para que
los campos de un mismo documento caigan juntos) no se usa para elegir, solo para confirmar. El campo
queda en null (siempre revisión) si en ese 30 % la exactitud observada queda bajo el objetivo, o si
el split de confirmación tiene muy pocos aceptados para decir algo: menos de
min_n_zero_errors(objetivo) × f / (1 − f) (con f = 0.3: ≈ 328 para 99.5 %, ≈ 1,645 para 99.9 %).
Sin ese mínimo, 50 aciertos "confirmarían" 99.9 %. El reporte trae también la cota de Wilson del
split de confirmación.

Uso:
  python calibrate_thresholds.py etiquetas.csv --config routing.yaml -o umbrales.yaml
"""


from __future__ import annotations

import argparse
import csv
import hashlib
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import yaml

REQUIRED_COLUMNS = ("doc_id", "doc_type", "field", "confidence", "correct")
TRUE_VALUES = {"1", "true", "t", "yes", "si", "sí"}
FALSE_VALUES = {"0", "false", "f", "no"}
SOURCES = {"audit", "shadow", "calib", "review", "gold"}
DEFAULT_SOURCES = "audit,shadow,calib"
# Etiquetan TODO lo que llegó (no solo lo que pasó o lo que se marcó): las únicas que miden cobertura.
UNCONDITIONAL_SOURCES = {"shadow", "calib"}


def wilson_lower(k: int, n: int, z: float = 1.96) -> float:
    """Cota inferior del intervalo de Wilson para k aciertos en n.

    Ejemplo: 990 de 1,000 → exactitud 0.990, cota ≈ 0.9817. 1,000 de 1,000 → cota ≈ 0.9962.
    Se usa Wilson y no la aproximación normal (p ± z·√(p(1−p)/n)) porque con p cerca de 1 la normal
    da cotas absurdas: con 0 errores su margen es 0 y "certifica" 100 % con 10 ejemplos.
    """
    if n <= 0:
        return 0.0
    p = k / n
    z2 = z * z
    center = p + z2 / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return (center - margin) / (1 + z2 / n)


def min_n_zero_errors(target: float, z: float = 1.96) -> int:
    """Mínimo de aciertos sin ningún error para que la cota de Wilson alcance `target`."""
    return math.ceil(target * z * z / (1 - target))


@dataclass(frozen=True)
class Row:
    doc_id: str
    doc_type: str
    field: str
    confidence: float
    correct: bool
    label_source: str


@dataclass
class FieldResult:
    doc_type: str
    field: str
    target: float
    threshold: float | None
    status: str  # ok | sin_datos | no_confirmado
    n_total: int
    n_accepted: int
    accuracy: float | None
    lower_bound: float | None
    coverage: float | None  # fracción que se auto-aceptaría, SOLO con fuentes incondicionales (None = sin ellas)
    confirm_n: int = 0
    confirm_accuracy: float | None = None
    confirm_lower: float | None = None


def read_rows(path: str | Path, allowed_sources: set[str], allow_gold: bool = False) -> list[Row]:
    """Lee y valida el CSV con número de línea en cada error: un CSV roto debe fallar fuerte, no
    convertirse en "ningún campo certificado" (que se vería igual que un modelo malo).

    Una fila del gold set es un error aunque gold no esté en allowed_sources: si el export las trae, el
    pipeline de etiquetas está mezclando el set del gate con el de calibración, y eso hay que verlo."""
    unknown = allowed_sources - SOURCES
    if unknown:
        raise ValueError(f"label_source desconocido en --sources: {sorted(unknown)}")
    if "gold" in allowed_sources and not allow_gold:
        raise ValueError("el gold set solo se usa en el gate; --allow-gold existe solo para experimentos")
    rows: list[Row] = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        cols = set(reader.fieldnames or [])
        missing = [c for c in REQUIRED_COLUMNS + ("label_source",) if c not in cols]
        if missing:
            raise ValueError(f"faltan columnas: {missing}")
        for i, r in enumerate(reader, start=2):
            try:
                conf = float(r["confidence"])
            except ValueError as exc:
                raise ValueError(f"línea {i}: confidence no numérica: {r['confidence']!r}") from exc
            if not 0.0 <= conf <= 1.0:
                raise ValueError(f"línea {i}: confidence fuera de [0, 1]: {conf}")
            c = (r["correct"] or "").strip().lower()
            if c not in TRUE_VALUES | FALSE_VALUES:
                raise ValueError(f"línea {i}: correct inválido: {r['correct']!r}")
            src = (r.get("label_source") or "").strip().lower()
            if not src:
                raise ValueError(f"línea {i}: label_source vacío (¿audit, shadow, calib…? no se adivina)")
            if src not in SOURCES:
                raise ValueError(f"línea {i}: label_source desconocido: {src!r}")
            if src == "gold" and not allow_gold:
                raise ValueError(f"línea {i}: label_source=gold: el gold set solo se usa en el gate, nunca para "
                                 "elegir umbrales (si lo usas aquí, deja de medir)")
            if src not in allowed_sources:
                continue
            rows.append(Row(r["doc_id"], r["doc_type"], r["field"], conf, c in TRUE_VALUES, src))
    return rows


def in_confirm_split(doc_id: str, frac: float) -> bool:
    if frac <= 0:
        return False
    h = hashlib.sha256(f"confirm:{doc_id}".encode()).digest()
    return int.from_bytes(h[:8], "big") / 2**64 < frac


def choose_threshold(rows: list[Row], target: float, z: float, min_accepted: int) -> tuple[float | None, int, int]:
    """Devuelve (umbral, n_aceptados, aciertos) con la regla conservadora del docstring."""
    by_conf: dict[float, list[int]] = defaultdict(lambda: [0, 0])  # conf → [n, k]
    for r in rows:
        by_conf[r.confidence][0] += 1
        by_conf[r.confidence][1] += int(r.correct)
    n = k = 0
    best: tuple[float | None, int, int] = (None, 0, 0)
    for conf in sorted(by_conf, reverse=True):
        n += by_conf[conf][0]
        k += by_conf[conf][1]
        passes = n >= min_accepted and wilson_lower(k, n, z) >= target
        if passes:
            best = (conf, n, k)
        elif best[0] is not None:
            break  # ya habíamos pasado y bajar el umbral rompe la cota: no cruzamos la franja mala
    return best


def choose_threshold_audit_aware(rows: list[Row], target: float, z: float,
                                 min_accepted: int) -> tuple[float | None, int, int]:
    """choose_threshold, pero la auditoría no puede justificar BAJAR el umbral.

    Las filas audit solo existen por encima del umbral vigente (≈ la confianza mínima auditada). Si al
    juntarlas con el resto el umbral elegido queda por debajo de ese piso, los miles de aciertos
    auditados estarían "subsidiando" una franja que solo vieron la sombra y la doble captura. Debajo
    del piso decide solo la evidencia sin auditoría; si esa no alcanza, el umbral no baja del piso."""
    t, n, k = choose_threshold(rows, target, z, min_accepted)
    audit = [r.confidence for r in rows if r.label_source == "audit"]
    if t is None or not audit or t >= min(audit):
        return t, n, k
    floor = min(audit)
    t2, n2, k2 = choose_threshold([r for r in rows if r.label_source != "audit"], target, z, min_accepted)
    if t2 is not None and t2 < floor:
        return t2, n2, k2
    return choose_threshold([r for r in rows if r.confidence >= floor], target, z, min_accepted)


def calibrate(
    rows: list[Row],
    target: float,
    critical_target: float,
    critical_fields: set[str],
    z: float = 1.96,
    min_accepted: int = 50,
    confirm_frac: float = 0.0,
) -> list[FieldResult]:
    groups: dict[tuple[str, str], list[Row]] = defaultdict(list)
    for r in rows:
        groups[(r.doc_type, r.field)].append(r)
    results = []
    for (doc_type, field), grp in sorted(groups.items()):
        tgt = critical_target if field in critical_fields else target
        select = [r for r in grp if not in_confirm_split(r.doc_id, confirm_frac)]
        confirm = [r for r in grp if in_confirm_split(r.doc_id, confirm_frac)]
        t, n_acc, k_acc = choose_threshold_audit_aware(select, tgt, z, min_accepted)
        if t is None:
            results.append(FieldResult(doc_type, field, tgt, None, "sin_datos", len(select), 0, None, None,
                                       _coverage(select, None)))
            continue
        res = FieldResult(doc_type, field, tgt, t, "ok", len(select), n_acc, k_acc / n_acc,
                          wilson_lower(k_acc, n_acc, z), _coverage(select, t))
        if confirm_frac > 0:
            acc = [r for r in confirm if r.confidence >= t]
            k = sum(r.correct for r in acc)
            res.confirm_n = len(acc)
            if acc:
                res.confirm_accuracy = k / len(acc)
                res.confirm_lower = wilson_lower(k, len(acc), z)
            # Sin suficientes aceptados en el split de confirmación no hay confirmación (ni con 0 errores).
            needed = math.ceil(min_n_zero_errors(tgt, z) * confirm_frac / (1 - confirm_frac))
            if len(acc) < needed or res.confirm_accuracy < tgt:
                res.status, res.threshold = "no_confirmado", None
        results.append(res)
    return results


def _coverage(rows: list[Row], threshold: float | None) -> float | None:
    """Cobertura solo con fuentes incondicionales: la auditoría (solo STP) la inflaría."""
    base = [r for r in rows if r.label_source in UNCONDITIONAL_SOURCES]
    if not base:
        return None
    if threshold is None:
        return 0.0
    return sum(r.confidence >= threshold for r in base) / len(base)


PENDING_VERSION = "POR-ASIGNAR"


def to_yaml_dict(results: list[FieldResult], z: float, source: str) -> dict:
    """Un bloque por tipo de documento, con la forma de doc_types.<tipo> en routing.yaml, para revisarlo
    en un PR y copiarlo. Los umbrales se versionan POR TIPO y junto con el modelo para el que se
    calibraron: thresholds_version y model_version salen como POR-ASIGNAR y se llenan en el PR (nueva
    versión del tipo; el model_version es el del extractor que produjo estas confianzas)."""
    out: dict[str, dict] = {}
    for r in results:
        block = out.setdefault(r.doc_type, {"thresholds_version": PENDING_VERSION,
                                            "model_version": PENDING_VERSION, "thresholds": {}})
        block["thresholds"][r.field] = None if r.threshold is None else round(r.threshold, 4)
    return {"generated_from": source, "z": z, "doc_types": out}


def format_report(results: list[FieldResult]) -> str:
    lines = [f"{'doc_type':<22}{'campo':<20}{'objetivo':>9}{'umbral':>8}{'cobert.':>8}{'n_acep':>8}"
             f"{'exact.':>8}{'cota':>8}{'conf_n':>8}{'confirm':>9}{'c_cota':>8}  estado"]
    for r in results:
        def fmt(x, d=4):
            return "-" if x is None else f"{x:.{d}f}"
        cov = "-" if r.coverage is None else f"{r.coverage:.1%}"
        lines.append(f"{r.doc_type:<22}{r.field:<20}{r.target:>9.3f}{fmt(r.threshold, 3):>8}{cov:>8}"
                     f"{r.n_accepted:>8}{fmt(r.accuracy):>8}{fmt(r.lower_bound):>8}{r.confirm_n:>8}"
                     f"{fmt(r.confirm_accuracy):>9}{fmt(r.confirm_lower):>8}  {r.status}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("csv")
    ap.add_argument("--config", help="routing.yaml (para leer critical_fields)")
    ap.add_argument("--target", type=float, default=0.995)
    ap.add_argument("--critical-target", type=float, default=0.999)
    ap.add_argument("--critical-fields", help="lista separada por comas (anula la del --config)")
    ap.add_argument("--z", type=float, default=1.96)
    ap.add_argument("--min-accepted", type=int, default=50)
    ap.add_argument("--confirm-frac", type=float, default=0.3)
    ap.add_argument("--sources", default=DEFAULT_SOURCES,
                    help="label_source permitidos (por defecto audit, shadow y calib; review no se recomienda)")
    ap.add_argument("--allow-gold", action="store_true",
                    help="SOLO experimentos: deja usar el gold set (el gate que lo use dejará de medir)")
    ap.add_argument("-o", "--output", help="YAML de salida (si no, a stdout)")
    a = ap.parse_args(argv)

    critical: set[str] = set()
    if a.config:
        critical = set(yaml.safe_load(Path(a.config).read_text(encoding="utf-8")).get("critical_fields") or [])
    if a.critical_fields:
        critical = {f.strip() for f in a.critical_fields.split(",") if f.strip()}
    sources = {x.strip() for x in a.sources.split(",") if x.strip()}
    if a.allow_gold:
        print("AVISO: --allow-gold: estos umbrales vieron el gold set; el gate que lo use será optimista.",
              file=sys.stderr)
    rows = read_rows(a.csv, sources, allow_gold=a.allow_gold)
    if not rows:
        print("sin filas utilizables (¿label_source?)", file=sys.stderr)
        return 2
    results = calibrate(rows, a.target, a.critical_target, critical, a.z, a.min_accepted, a.confirm_frac)
    print(format_report(results), file=sys.stderr)
    print(f"\nmínimo sin errores: {min_n_zero_errors(a.target, a.z)} para {a.target}, "
          f"{min_n_zero_errors(a.critical_target, a.z)} para {a.critical_target} (z = {a.z})", file=sys.stderr)
    text = yaml.safe_dump(to_yaml_dict(results, a.z, Path(a.csv).name), sort_keys=True, allow_unicode=True)
    if a.output:
        Path(a.output).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
