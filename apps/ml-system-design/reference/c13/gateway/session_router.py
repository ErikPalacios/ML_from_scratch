"""Session router (caso c13): a qué asr-worker va cada sesión de captions, y qué pasa cuando un worker se va.

Por qué no sirve un balanceador normal: el modelo streaming guarda ESTADO en la GPU (su caché) mientras
alguien habla, y una sesión vive horas en el mismo worker. La carga se mide en SESIONES y STREAMS ACTIVOS,
no en requests por segundo ni en CPU. Round-robin por conexión reparte bien las conexiones nuevas y mal la
carga: un worker que arrancó a las 9:00 tiene cientos de sesiones largas y uno que llegó a las 11:00, 30.

Dos contadores, que no hay que mezclar (los dos los exporta el asr-worker):
  sesión         una pista de un participante, conectada toda la reunión (≈ 200k en el pico del caso)
  stream activo  una sesión con una utterance abierta: la que ocupa GPU (≈ 60k en el pico, ≈ 30 %)
El router reparte SESIONES: es lo que asigna y lo que cuenta exacto en su tabla. Los streams los reporta
cada worker (report_streams, cada pocos segundos) y sirven para no mandarle nada a una GPU que ya está en
su tope. Por qué no se elige por streams reportados: entre dos reportes, todas las sesiones de la rampa de
las 9:00 irían al worker que en el último reporte se veía más vacío (efecto manada). Con sesiones parejas,
los streams se emparejan solos (≈ 1,170 sesiones con p = 0.3 de voz: σ ≈ 16 streams, ver el caso).

Reglas (todas probadas en tests/test_session_router.py):
  1. Capacidad: cada worker acepta hasta `capacity` SESIONES (MAX_SESSIONS del asr-worker, 1,500 en la
     referencia: 450 streams ÷ 0.3, ilustrativo) y deja de aceptar si reporta sus streams activos en el
     tope (MAX_STREAMS, 450). Asignar = elegir entre los que tienen lugar. Sin lugar → NoCapacity: el gateway
     responde "captions no disponibles, reintenta" (degradación: la reunión sigue, sin captions) y la alerta
     de capacidad avisa.
  2. Estrategia "spread" (la del caso): el worker con MÁS lugares libres de sesión; empate → menos streams
     activos. Baja latencia (ninguna GPU va al tope mientras otras sobran). La alternativa "pack" (el que
     tiene MENOS lugares libres, pero alguno) concentra sesiones y deja workers vacíos para apagar barato, a
     costa de GPUs más cargadas: se ofrece para comparar, no es la default.
  3. Sticky: una sesión asignada se queda en su worker toda su vida. Volver a pedirla devuelve el mismo.
     Una RECONEXIÓN (el worker cerró con 1011 porque el modelo falló, 1013 porque su GPU no daba abasto, o
     1012 por drain) va a OTRO worker: volver al mismo repetiría la falla. Solo si ningún otro tiene lugar,
     vuelve al anterior.
  4. Drain: un worker que drena no recibe sesiones nuevas; las suyas se mueven en su próximo límite de
     utterance (el worker manda "migrate" y el gateway llama a assign() otra vez). Mover entre
     utterances no pierde texto: no hay estado a medias.
  5. Worker perdido (crash, nodo caído, spot): sus sesiones se reasignan YA a otros, cada una con su
     contador de reconexiones +1. El usuario pierde ≈ 1–2 s de partials (lo que el modelo tenía en su
     caché), aceptable para captions. Las que no caben quedan en `unplaced`.
  6. Rebalanceo simple: si un worker pasa del 90 % y otro está debajo del 60 %, se planean como máximo
     `max_moves` movimientos del más cargado al menos cargado. Se ejecutan en el próximo límite de
     utterance de cada sesión (como el drain), nunca a media frase.

Dónde vive este estado en producción: el asr-gateway tiene varias réplicas, y todas tienen que ver la misma
tabla sesión → worker. Opciones: un store compartido (Redis-class, con operaciones atómicas para
"reservar un lugar"), o que cada réplica del gateway sea dueña de un subconjunto de workers. Aquí está en
memoria para poder probar las REGLAS; la concurrencia entre réplicas es el problema siguiente (y se dice
en la entrevista). Los workers se descubren por el Service headless de k8s/asr-worker.yaml: un pod que
drena deja de estar Ready y sale de la lista.
Lógica pura (biblioteca estándar, sin I/O).
"""

from __future__ import annotations  # anotaciones como texto

from dataclasses import dataclass, field  # estado simple por worker


class NoCapacity(Exception):
    """Ningún worker vivo y sin drenar tiene lugar."""


@dataclass
class WorkerState:
    worker_id: str
    capacity: int  # SESIONES que acepta (MAX_SESSIONS)
    sessions: set[str] = field(default_factory=set)
    draining: bool = False
    stream_capacity: int = 0  # MAX_STREAMS que reporta el worker (0 = todavía no reportó)
    active_streams: int = 0  # streams activos del último reporte (sesiones hablando)

    @property
    def free(self) -> int:
        return self.capacity - len(self.sessions)

    @property
    def load(self) -> float:
        return len(self.sessions) / self.capacity if self.capacity else 1.0

    @property
    def gpu_full(self) -> bool:
        return self.stream_capacity > 0 and self.active_streams >= self.stream_capacity

    @property
    def accepting(self) -> bool:
        return not self.draining and self.free > 0 and not self.gpu_full


@dataclass(frozen=True)
class Assignment:
    session_id: str
    worker_id: str
    sticky: bool  # True = la sesión ya estaba en ese worker (no hubo que elegir)
    reconnects: int  # cuántas veces se reabrió la sesión (worker perdido, migración)


@dataclass(frozen=True)
class Move:
    session_id: str
    from_worker: str
    to_worker: str


@dataclass(frozen=True)
class LossResult:
    moved: dict[str, str]  # sesión → worker nuevo
    unplaced: list[str]  # sesiones que no cupieron en ningún lado


class SessionRouter:
    def __init__(self, strategy: str = "spread") -> None:
        if strategy not in ("spread", "pack"):
            raise ValueError("strategy debe ser 'spread' o 'pack'")
        self.strategy = strategy
        self.workers: dict[str, WorkerState] = {}
        self.session_worker: dict[str, str] = {}
        self.reconnects: dict[str, int] = {}

    # ------------------------------------------------------------------------ flota
    def add_worker(self, worker_id: str, capacity: int) -> None:
        """Un worker pasó a Ready (o cambió su capacidad en sesiones, p. ej. un modelo más pesado)."""
        if worker_id in self.workers:
            self.workers[worker_id].capacity = capacity
        else:
            self.workers[worker_id] = WorkerState(worker_id, capacity)

    def report_streams(self, worker_id: str, active_streams: int, stream_capacity: int) -> None:
        """Lo que el worker dice de su GPU (asr_active_streams y MAX_STREAMS, vía /readyz o un heartbeat).
        En el tope, el worker deja de recibir sesiones nuevas hasta el próximo reporte por debajo."""
        w = self.workers.get(worker_id)
        if w is not None:
            w.active_streams, w.stream_capacity = active_streams, stream_capacity

    def drain(self, worker_id: str) -> list[str]:
        """Marca el worker como drenando. Devuelve sus sesiones: cada una migra en su próximo límite."""
        w = self.workers[worker_id]
        w.draining = True
        return sorted(w.sessions)

    def remove_worker(self, worker_id: str) -> None:
        """Un worker drenado y vacío se fue (scale-in terminado)."""
        w = self.workers.pop(worker_id)
        for sid in w.sessions:  # no debería quedar ninguna; si queda, se trata como pérdida
            self.session_worker.pop(sid, None)

    def worker_lost(self, worker_id: str) -> LossResult:
        """Crash o nodo caído: sus sesiones se reasignan ya, con una reconexión más cada una."""
        w = self.workers.pop(worker_id, None)
        if w is None:
            return LossResult({}, [])
        moved: dict[str, str] = {}
        unplaced: list[str] = []
        for sid in sorted(w.sessions):  # orden determinista: los tests y los logs se pueden comparar
            self.session_worker.pop(sid, None)
            self.reconnects[sid] = self.reconnects.get(sid, 0) + 1
            target = self._choose()
            if target is None:
                unplaced.append(sid)
                continue
            self._place(sid, target)
            moved[sid] = target.worker_id
        return LossResult(moved, unplaced)

    # ------------------------------------------------------------------------ sesiones
    def assign(self, session_id: str, reconnect: bool = False, exclude: str | None = None) -> Assignment:
        """Worker para una sesión. Sticky si ya tiene uno que sigue aceptándola.

        reconnect=True: el worker cerró la sesión (migrate 1012, modelo 1011, sobrecarga 1013) o se cortó la
        conexión. Se evita el worker anterior (o `exclude`, si el gateway sabe cuál falló): con "spread",
        ese worker acaba de liberar un lugar y, sin esta regla, muchas veces sería el elegido otra vez.
        """
        current = self.session_worker.get(session_id)
        if current is not None and current in self.workers and not reconnect:
            return Assignment(session_id, current, True, self.reconnects.get(session_id, 0))
        if reconnect and exclude is None:
            exclude = current
        if current is not None:  # reconexión pedida por el worker (migrate) o por el cliente
            self._release(session_id)
            self.reconnects[session_id] = self.reconnects.get(session_id, 0) + 1
        target = self._choose(exclude)
        if target is None and exclude is not None:
            target = self._choose()  # nadie más tiene lugar: mejor el anterior que sin captions
        if target is None:
            raise NoCapacity(session_id)
        self._place(session_id, target)
        return Assignment(session_id, target.worker_id, False, self.reconnects.get(session_id, 0))

    def release(self, session_id: str) -> None:
        """La sesión terminó (el participante se fue o apagó los captions)."""
        self._release(session_id)
        self.reconnects.pop(session_id, None)

    def plan_rebalance(self, high: float = 0.9, low: float = 0.6, max_moves: int = 10) -> list[Move]:
        """Movimientos sugeridos del worker más cargado al menos cargado, hasta `max_moves`.

        No mueve nada: devuelve el plan. El gateway lo aplica en el próximo límite de utterance de cada
        sesión (apply_move). Pocos movimientos por ronda: cada uno es una reconexión que el usuario no ve,
        pero un rebalanceo masivo es una tormenta de reconexiones que sí se ve.
        """
        # Simulación sobre copias de los conteos: el plan no toca el estado real
        counts = {wid: len(w.sessions) for wid, w in self.workers.items()}
        pending = {wid: sorted(w.sessions) for wid, w in self.workers.items()}
        moves: list[Move] = []
        while len(moves) < max_moves:
            live = [w for w in self.workers.values() if w.capacity > 0]
            # Un worker que drena no dona: sus sesiones ya se van solas
            donors = [w for w in live if not w.draining and counts[w.worker_id] / w.capacity > high
                      and pending[w.worker_id]]
            receivers = [w for w in live if not w.draining and counts[w.worker_id] / w.capacity < low]
            if not donors or not receivers:
                break
            src = max(donors, key=lambda w: (counts[w.worker_id] / w.capacity, w.worker_id))
            dst = min(receivers, key=lambda w: (counts[w.worker_id] / w.capacity, w.worker_id))
            sid = pending[src.worker_id].pop()
            moves.append(Move(sid, src.worker_id, dst.worker_id))
            counts[src.worker_id] -= 1
            counts[dst.worker_id] += 1
        return moves

    def apply_move(self, move: Move) -> bool:
        """Ejecuta un movimiento planeado (en el límite de utterance). False si ya no aplica."""
        if self.session_worker.get(move.session_id) != move.from_worker:
            return False  # la sesión terminó o ya se movió
        dst = self.workers.get(move.to_worker)
        if dst is None or not dst.accepting:
            return False  # el destino se llenó, empezó a drenar o se fue: se replanea en la próxima ronda
        self._release(move.session_id)
        self._place(move.session_id, dst)
        return True

    # ------------------------------------------------------------------------ resumen y internos
    def utilization(self) -> float:
        """Sesiones ÷ capacidad en sesiones de los workers que no drenan. La misma cuenta con las métricas de
        los workers (asr:session_utilization) es una rama de ASRCapacityHeadroomLow; la otra mira streams."""
        cap = sum(w.capacity for w in self.workers.values() if not w.draining)
        active = sum(len(w.sessions) for w in self.workers.values())
        return active / cap if cap else 1.0

    def _choose(self, exclude: str | None = None) -> WorkerState | None:
        candidates = [w for w in self.workers.values() if w.accepting and w.worker_id != exclude]
        if not candidates:
            return None
        if self.strategy == "spread":
            # Más lugares libres de sesión; empate → menos streams activos reportados → menor carga relativa
            # → id menor (determinista)
            return min(candidates, key=lambda w: (-w.free, w.active_streams, w.load, w.worker_id))
        return min(candidates, key=lambda w: (w.free, w.worker_id))  # pack

    def _place(self, session_id: str, w: WorkerState) -> None:
        w.sessions.add(session_id)
        self.session_worker[session_id] = w.worker_id

    def _release(self, session_id: str) -> None:
        wid = self.session_worker.pop(session_id, None)
        if wid is not None and wid in self.workers:
            self.workers[wid].sessions.discard(session_id)
