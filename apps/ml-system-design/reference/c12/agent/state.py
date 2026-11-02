"""Estado durable del agente: conversaciones, mensajes recibidos, el STEP LOG (cada llamada al modelo, cada tool
call con argumentos y resultado, cada decisión de política, cada evento mandado al cliente) y las acciones que
esperan confirmación o aprobación. SQLite aquí (tests sin servidor); en producción, Postgres (SPEC §8m).

Por qué un step log y no "el historial del chat":
  * REANUDAR. Si el pod muere a mitad de un turno, otro proceso reconstruye la conversación desde el log y
    sigue desde el último paso COMPLETO. Las respuestas del modelo ya registradas no se vuelven a pedir.
  * EXACTLY-ONCE en los efectos. Antes de una escritura se registra el paso como "started" con su idempotency
    key (write-ahead); después, "completed" con el resultado. Si el proceso muere entre las dos cosas, al
    reanudar se repite la llamada con la MISMA key y el backend devuelve el resultado guardado sin repetir el
    efecto. Sin la key, reanudar = pagar dos veces; sin el log, no sabrías que había algo por reanudar.
  * ESPERAS LARGAS. Una aprobación puede tardar horas (SLA 4 h hábiles): ningún proceso se queda esperando en
    memoria; la acción queda en la tabla `actions` y el webhook de aprobación retoma desde ahí.
  * AUDITORÍA Y REPLAY. Qué vio el modelo, qué propuso, qué dijo la política y qué se ejecutó, paso por paso;
    `to_trace()` lo exporta como spans con los atributos gen_ai.* de OpenTelemetry.

Alternativa a esto: un motor de durable execution (Temporal y similares), que persiste el historial de cada
workflow y lo re-ejecuta de forma determinista; las actividades (las tool calls) se reintentan según política
y una señal externa (la aprobación) despierta al workflow. Te da lo mismo con menos código propio, a cambio de
otro sistema que operar y de reglas de determinismo en el código del workflow. Para un loop corto como este,
una máquina de estados propia sobre Postgres alcanza; con muchos tipos de flujo largos, el motor paga.

PII: el log guarda los argumentos COMPLETOS (una dirección nueva, por ejemplo) porque reanudar los necesita.
Por eso vive en la base de la conversación con retención acotada (30 días, ilustrativo) y lo que sale a trazas,
métricas y logs de aplicación es una versión redactada (`to_trace` no incluye contenido).
"""

from __future__ import annotations  # anotaciones como texto

import json  # payloads
import sqlite3  # store durable de referencia
import threading  # un lock alrededor de la conexión (la app es async con un solo hilo, los tests no siempre)
from collections.abc import Iterator  # tipos
from contextlib import contextmanager  # transacciones
from dataclasses import dataclass  # filas tipadas
from datetime import UTC, datetime, timedelta, timezone  # timestamps y horario hábil
from typing import Any  # payloads JSON

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,             -- dueño: de la sesión autenticada
  conversation_type TEXT NOT NULL,       -- order_support | general_question
  status TEXT NOT NULL,                  -- active | awaiting_confirmation | awaiting_approval | handed_off | closed
  injection_flagged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (    -- dedupe: el cliente reenvía el mismo message_id si no vio respuesta
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, message_id)
);
CREATE TABLE IF NOT EXISTS steps (
  conversation_id TEXT NOT NULL,
  step_id INTEGER NOT NULL,              -- 1, 2, 3… por conversación: orden total de lo que pasó
  turn_id TEXT NOT NULL,                 -- el message_id que abrió el turno (o approval:<action_id>)
  kind TEXT NOT NULL,                    -- user_message | llm_call | tool_call | policy | agent_message |
                                         -- event | turn_end | approval_resume | note
  status TEXT NOT NULL,                  -- started | completed
  payload TEXT NOT NULL,                 -- JSON
  idempotency_key TEXT,                  -- solo tool calls con efectos
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (conversation_id, step_id)
);
CREATE TABLE IF NOT EXISTS actions (     -- acciones que esperan al cliente (confirmación) o a una persona (aprobación)
  action_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,                    -- JSON de los argumentos validados (lo que se confirma es ESTO)
  turn_id TEXT NOT NULL,
  status TEXT NOT NULL,                  -- pending_confirmation | confirmed | pending_approval | approved |
                                         -- rejected | executed
  approval_queue TEXT,
  amount_usd TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decided_by TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS actions_pending ON actions (status, updated_at);
"""


@dataclass(frozen=True)
class Conversation:
    id: str
    customer_id: str
    conversation_type: str
    status: str
    injection_flagged: bool


@dataclass(frozen=True)
class Step:
    step_id: int
    turn_id: str
    kind: str
    status: str
    payload: dict[str, Any]
    idempotency_key: str | None
    created_at: str


@dataclass(frozen=True)
class Action:
    action_id: str
    conversation_id: str
    tool: str
    args: dict[str, Any]
    turn_id: str
    status: str
    approval_queue: str | None
    amount_usd: str | None
    created_at: str
    updated_at: str
    decided_by: str | None
    note: str | None


class NotOwner(PermissionError):
    """La conversación existe y es de otro cliente."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class StepLog:
    def __init__(self, path: str = ":memory:", *, now=_now, durable: bool = True):
        # isolation_level=None: autocommit; las transacciones se abren a mano con BEGIN IMMEDIATE (toman el lock
        # de escritura al empezar: dos procesos no pueden asignar el mismo step_id)
        self.db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        if path != ":memory:":
            self.db.execute("PRAGMA journal_mode=WAL")  # lectores no bloquean al escritor
        # FULL: cada commit llega a disco antes de seguir (sobrevive a un corte de luz, no solo a que muera el
        # proceso): es el punto de un log durable. Los tests usan NORMAL (con WAL, sobrevive a que muera el
        # proceso, que es lo que simulan) porque un fsync por paso los hace ≈ 10× más lentos en una laptop.
        self.db.execute(f"PRAGMA synchronous={'FULL' if durable else 'NORMAL'}")
        self.db.executescript(SCHEMA)
        self._lock = threading.Lock()
        self._now = now

    def close(self) -> None:
        """Cerrar la conexión (Python 3.13 avisa con un ResourceWarning si se olvida)."""
        with self._lock:
            self.db.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield self.db
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    # ---------------------------------------------------------- conversaciones
    def open_conversation(self, conversation_id: str, customer_id: str, conversation_type: str) -> Conversation:
        """Crea la conversación o la devuelve. Si es de OTRO cliente: NotOwner (el servicio contesta 404)."""
        with self._tx() as db:
            row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
            if row is None:
                ts = self._now()
                db.execute("INSERT INTO conversations VALUES (?, ?, ?, 'active', 0, ?, ?)",
                           (conversation_id, customer_id, conversation_type, ts, ts))
                row = db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if row["customer_id"] != customer_id:
            raise NotOwner(conversation_id)
        return self._conv(row)

    def get_conversation(self, conversation_id: str) -> Conversation | None:
        with self._lock:
            row = self.db.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        return self._conv(row) if row else None

    @staticmethod
    def _conv(row: sqlite3.Row) -> Conversation:
        return Conversation(row["id"], row["customer_id"], row["conversation_type"], row["status"],
                            bool(row["injection_flagged"]))

    def set_status(self, conversation_id: str, status: str) -> None:
        with self._tx() as db:
            db.execute("UPDATE conversations SET status = ?, updated_at = ? WHERE id = ?",
                       (status, self._now(), conversation_id))

    def flag_injection(self, conversation_id: str) -> None:
        with self._tx() as db:
            db.execute("UPDATE conversations SET injection_flagged = 1, updated_at = ? WHERE id = ?",
                       (self._now(), conversation_id))

    def register_message(self, conversation_id: str, message_id: str) -> bool:
        """True si el mensaje es nuevo. False si ya llegó (reenvío del cliente o doble clic): no se procesa dos
        veces. Es la idempotencia de la ENTRADA, como la idempotency key lo es de la salida."""
        try:
            with self._tx() as db:
                db.execute("INSERT INTO messages VALUES (?, ?, ?)", (conversation_id, message_id, self._now()))
            return True
        except sqlite3.IntegrityError:
            return False

    # ---------------------------------------------------------- step log
    def append_step(self, conversation_id: str, turn_id: str, kind: str, payload: dict[str, Any], *,
                    status: str = "completed", key: str | None = None) -> int:
        with self._tx() as db:
            (last,) = db.execute("SELECT COALESCE(MAX(step_id), 0) FROM steps WHERE conversation_id = ?",
                                 (conversation_id,)).fetchone()
            ts = self._now()
            db.execute("INSERT INTO steps VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (conversation_id, last + 1, turn_id, kind, status, json.dumps(payload, default=str), key,
                        ts, ts if status == "completed" else None))
        return last + 1

    def complete_step(self, conversation_id: str, step_id: int, payload: dict[str, Any]) -> None:
        with self._tx() as db:
            db.execute("UPDATE steps SET status = 'completed', payload = ?, completed_at = ? "
                       "WHERE conversation_id = ? AND step_id = ?",
                       (json.dumps(payload, default=str), self._now(), conversation_id, step_id))

    def steps(self, conversation_id: str, *, turn_id: str | None = None) -> list[Step]:
        q = "SELECT * FROM steps WHERE conversation_id = ?" + (" AND turn_id = ?" if turn_id else "")
        with self._lock:
            rows = self.db.execute(q + " ORDER BY step_id", (conversation_id, turn_id) if turn_id else
                                   (conversation_id,)).fetchall()
        return [Step(r["step_id"], r["turn_id"], r["kind"], r["status"], json.loads(r["payload"]),
                     r["idempotency_key"], r["created_at"]) for r in rows]

    def incomplete_turn(self, conversation_id: str) -> str | None:
        """El turno que empezó y no terminó (para reanudar después de una caída), o None."""
        opened: list[str] = []
        ended: set[str] = set()
        for s in self.steps(conversation_id):
            if s.kind in {"user_message", "approval_resume"} and s.turn_id not in opened:
                opened.append(s.turn_id)
            if s.kind == "turn_end":
                ended.add(s.turn_id)
        pending = [t for t in opened if t not in ended]
        return pending[-1] if pending else None

    # ---------------------------------------------------------- acciones (confirmaciones y aprobaciones)
    def upsert_action(self, action_id: str, conversation_id: str, tool: str, args: dict[str, Any], turn_id: str,
                      status: str, *, approval_queue: str | None = None, amount_usd: str | None = None) -> None:
        with self._tx() as db:
            ts = self._now()
            db.execute(
                "INSERT INTO actions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL) "
                "ON CONFLICT(action_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, "
                "approval_queue = COALESCE(excluded.approval_queue, approval_queue), "
                "amount_usd = COALESCE(excluded.amount_usd, amount_usd)",
                (action_id, conversation_id, tool, json.dumps(args), turn_id, status, approval_queue, amount_usd,
                 ts, ts))

    def get_action(self, action_id: str) -> Action | None:
        with self._lock:
            r = self.db.execute("SELECT * FROM actions WHERE action_id = ?", (action_id,)).fetchone()
        if r is None:
            return None
        return Action(r["action_id"], r["conversation_id"], r["tool"], json.loads(r["args"]), r["turn_id"],
                      r["status"], r["approval_queue"], r["amount_usd"], r["created_at"], r["updated_at"],
                      r["decided_by"], r["note"])

    def set_action_status(self, action_id: str, status: str, *, expected: tuple[str, ...] = (),
                          decided_by: str | None = None, note: str | None = None) -> bool:
        """Cambia el estado solo si el actual está en `expected` (compare-and-set): dos webhooks de aprobación
        que llegan juntos no ejecutan la acción dos veces; el segundo ve que ya no está pendiente."""
        with self._tx() as db:
            cur = db.execute(
                "UPDATE actions SET status = ?, updated_at = ?, decided_by = COALESCE(?, decided_by), "
                "note = COALESCE(?, note) WHERE action_id = ?" +
                (f" AND status IN ({','.join('?' * len(expected))})" if expected else ""),
                (status, self._now(), decided_by, note, action_id, *expected))
            return cur.rowcount == 1

    def action_ids(self, conversation_id: str, statuses: tuple[str, ...]) -> frozenset[str]:
        with self._lock:
            rows = self.db.execute(
                f"SELECT action_id FROM actions WHERE conversation_id = ? AND status IN "
                f"({','.join('?' * len(statuses))})", (conversation_id, *statuses)).fetchall()
        return frozenset(r["action_id"] for r in rows)

    def approval_backlog(self, now: datetime) -> tuple[int, float]:
        """(aprobaciones pendientes, edad en segundos HÁBILES de la más vieja): alimenta ApprovalQueueBacklog.
        Hábiles porque el SLA es de 4 horas hábiles: una pedida el viernes a las 17:00 no está "atrasada" el
        lunes a las 9:00 (lleva 1 hora hábil, no 64 de reloj)."""
        with self._lock:
            # updated_at = cuándo ENTRÓ a pending_approval (la fila se creó antes, al pedir la confirmación)
            rows = self.db.execute("SELECT updated_at FROM actions WHERE status = 'pending_approval'").fetchall()
        if not rows:
            return 0, 0.0
        oldest = min(datetime.fromisoformat(r["updated_at"]) for r in rows)
        return len(rows), business_seconds_between(oldest, now)

    # ---------------------------------------------------------- lectura para el cliente y para trazas
    def events(self, conversation_id: str, *, after_step: int = 0, turn_id: str | None = None) -> list[Step]:
        """Eventos ya mandados (para reenviarlos si el cliente se reconecta o reenvía un mensaje)."""
        return [s for s in self.steps(conversation_id, turn_id=turn_id) if s.kind == "event" and
                s.step_id > after_step]

    def to_trace(self, conversation_id: str) -> list[dict[str, Any]]:
        """El step log como spans con las convenciones semánticas de GenAI de OpenTelemetry (estado
        "Development" a oct. 2026: los nombres pueden cambiar; fija la versión que usas). SIN contenido: ni
        prompts, ni argumentos, ni resultados; solo nombres, ids, tokens y estados."""
        spans: list[dict[str, Any]] = []
        for s in self.steps(conversation_id):
            base = {"gen_ai.conversation.id": conversation_id, "c12.step_id": s.step_id, "c12.turn_id": s.turn_id}
            if s.kind == "llm_call" and not s.payload.get("synthetic"):
                u = s.payload.get("usage", {})
                spans.append({"name": "chat chat-default", "attributes": {
                    **base, "gen_ai.operation.name": "chat", "gen_ai.request.model": "chat-default",
                    "gen_ai.usage.input_tokens": u.get("prompt_tokens", 0),
                    "gen_ai.usage.output_tokens": u.get("completion_tokens", 0),
                    "gen_ai.response.finish_reasons": [s.payload.get("finish_reason", "")]}})
            elif s.kind == "tool_call":
                spans.append({"name": f"execute_tool {s.payload.get('name')}", "attributes": {
                    **base, "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": s.payload.get("name"),
                    "gen_ai.tool.call.id": s.payload.get("call_id"),
                    "c12.outcome": s.payload.get("outcome", s.status)}})
        return spans


# Horario hábil del equipo de aprobaciones: lunes a viernes, 9:00–18:00 de Ciudad de México (UTC−6 todo el año:
# México no tiene horario de verano desde 2022). Ilustrativo: los feriados no están (van en un calendario).
CDMX = timezone(timedelta(hours=-6))
BUSINESS_START_H, BUSINESS_END_H = 9, 18


def business_seconds_between(start: datetime, end: datetime) -> float:
    """Segundos hábiles entre dos instantes (recorre día por día; un backlog tiene pocos días)."""
    if end <= start:
        return 0.0
    s, e = start.astimezone(CDMX), end.astimezone(CDMX)
    total = 0.0
    day = s.replace(hour=0, minute=0, second=0, microsecond=0)
    while day <= e:
        if day.weekday() < 5:  # 0 = lunes … 4 = viernes
            open_, close_ = day.replace(hour=BUSINESS_START_H), day.replace(hour=BUSINESS_END_H)
            lo, hi = max(open_, s), min(close_, e)
            if hi > lo:
                total += (hi - lo).total_seconds()
        day += timedelta(days=1)
    return total
