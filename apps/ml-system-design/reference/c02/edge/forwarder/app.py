"""Forwarder de eventos de la caja edge (caso c02): de detecciones por MQTT a eventos en la nube.

Flujo:  DeepStream ──MQTT (local, QoS 0)──▶ on_message ──▶ rules.ZoneRules (zonas, horario, dwell, dedupe)
          ──▶ fotos del stream principal ──▶ cola SQLite (store-and-forward) ──▶ Sender ──HTTPS──▶ API
        + clip de 10 s en segundo plano (prioridad baja) + heartbeat cada 30 s con los fps por cámara.

Por qué un proceso aparte y no código dentro de DeepStream: el pipeline de video es C/GStreamer y no
debe bloquearse por la red; aquí vive todo lo que falla por la red (reintentos, cola en disco, backoff)
y la lógica de negocio que cambia seguido (zonas, horarios), en Python y con tests.
"""

from __future__ import annotations  # anotaciones como texto

import json  # payloads de MQTT y de la API; filas de la cola
import logging  # una línea JSON por evento importante, a stdout (Docker rota los logs)
import os  # configuración por variables de entorno: la misma imagen en los 25 sitios
import random  # jitter del backoff
import shutil  # espacio libre en disco antes de grabar un clip
import signal  # SIGTERM de `docker stop`: terminar lo que está en curso
import sqlite3  # la cola durable: un archivo, sin servidor, sobrevive reinicios y cortes de luz
import subprocess  # ffmpeg para el clip (copia el stream, no decodifica)
import sys  # stdout para los logs
import threading  # MQTT, sender y heartbeat corren en hilos separados
import time  # reloj de pared (epoch) inyectable en tests
from collections import Counter  # frames recibidos por cámara → fps del heartbeat
from concurrent.futures import Future, ThreadPoolExecutor  # fotos y clips sin bloquear el hilo de MQTT
from dataclasses import dataclass  # filas de la cola
from pathlib import Path  # spool de fotos y clips en disco

import httpx2  # cliente HTTP (misma API que httpx; es el que usa el TestClient de Starlette 1.x)
import paho.mqtt.client as mqtt  # cliente MQTT de Eclipse
import yaml  # site.yaml

from rules import SiteConfig, SnapshotRequest, ZoneEvent, ZoneRules, parse_minimal_payload

VERSION = os.getenv("FORWARDER_VERSION", "dev")  # viaja en cada evento: qué versión lo generó
MODEL_VERSION = os.getenv("MODEL_VERSION", "unknown")  # versión del bundle del detector (OTA)
CLIP_SECONDS = 10  # 10 s del stream principal a ≈ 4 Mb/s ≈ 5 MB (est.)
MIN_FREE_BYTES = 2 * 1024**3  # con menos de 2 GB libres no se graban clips; los eventos (≈ 1 MB) siguen
DEGRADE_AFTER_ATTEMPTS = 3  # si las fotos no suben tras 3 intentos, el evento sale SIN fotos

log = logging.getLogger("forwarder")


def jlog(event: str, **fields) -> None:
    """Una línea JSON por hecho relevante: se busca por event_id cuando el SOC pregunta."""
    log.info(json.dumps({"event": event, **fields}, ensure_ascii=False, default=str))


# ------------------------------------------------------------------------------ backoff
def backoff_delay(attempt: int, rng: random.Random, base: float = 1.0, cap: float = 300.0) -> float:
    """Exponential backoff con FULL jitter: uniforme entre 0 y min(cap, base·2^intento).

    Por qué el jitter: si la API cae 10 min, las 25 cajas acumulan eventos; sin jitter reintentarían
    todas en el mismo segundo al volver y la tumbarían otra vez (retry storm). El tope de 5 min acota
    cuánto tarda en salir un evento después de que vuelve la red.
    """
    return rng.uniform(0.0, min(cap, base * (2**attempt)))


# ------------------------------------------------------------------------------ cola durable
@dataclass(frozen=True)
class Item:
    item_id: str  # event_id del evento, o "<event_id>:clip"
    kind: str  # "event" | "clip"
    payload: dict
    files: list[str]
    attempts: int
    created_at: float


class Outbox:
    """Store-and-forward en SQLite: primero se ESCRIBE en disco, después se intenta enviar.

    Si la caja pierde la subida horas o se reinicia, nada se pierde: al volver, se vacía en orden,
    eventos antes que clips. PRIMARY KEY = event_id: encolar dos veces el mismo evento no lo duplica.
    """

    def __init__(self, path: str, clock=time.time):
        self._clock = clock
        self._lock = threading.Lock()  # una conexión compartida entre hilos, serializada
        # isolation_level=None: autocommit; cada sentencia es su propia transacción
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")  # lectores no bloquean al escritor
        # FULL: cada commit llega al disco antes de volver. Una caja en un andén pierde la luz; con
        # NORMAL, el último evento confirmado podría desaparecer. Son pocas escrituras: el costo no importa.
        self._db.execute("PRAGMA synchronous=FULL")
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS outbox (
              item_id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              priority INTEGER NOT NULL,          -- 0 = eventos, 1 = clips
              payload TEXT NOT NULL,
              files TEXT NOT NULL,                -- rutas locales a subir (JSON)
              attempts INTEGER NOT NULL DEFAULT 0,
              next_attempt_at REAL NOT NULL,
              created_at REAL NOT NULL,
              last_error TEXT
            );
            CREATE INDEX IF NOT EXISTS outbox_due ON outbox (priority, next_attempt_at, created_at);
            CREATE TABLE IF NOT EXISTS dead_letter (
              item_id TEXT PRIMARY KEY, kind TEXT, payload TEXT, files TEXT, reason TEXT, failed_at REAL
            );
            """
        )

    def put(self, item_id: str, kind: str, payload: dict, files: list[str]) -> bool:
        now = self._clock()
        with self._lock:
            cur = self._db.execute(
                "INSERT OR IGNORE INTO outbox (item_id, kind, priority, payload, files, next_attempt_at, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (item_id, kind, 0 if kind == "event" else 1, json.dumps(payload), json.dumps(files), now, now),
            )
            return cur.rowcount == 1  # False = ya estaba (idempotente)

    def next_due(self) -> Item | None:
        """El más prioritario que ya puede intentarse: eventos primero, y entre ellos el más viejo."""
        with self._lock:
            row = self._db.execute(
                "SELECT item_id, kind, payload, files, attempts, created_at FROM outbox"
                " WHERE next_attempt_at <= ? ORDER BY priority, created_at LIMIT 1",
                (self._clock(),),
            ).fetchone()
        if row is None:
            return None
        return Item(row[0], row[1], json.loads(row[2]), json.loads(row[3]), row[4], row[5])

    def done(self, item_id: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM outbox WHERE item_id = ?", (item_id,))

    def retry(self, item_id: str, delay: float, error: str) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE item_id = ?",
                (self._clock() + delay, error[:500], item_id),
            )

    def dead(self, item: Item, reason: str) -> None:
        """Error permanente (un 4xx que no se arregla reintentando): se aparta, no se reintenta para siempre."""
        with self._lock:
            self._db.execute("BEGIN")
            self._db.execute(
                "INSERT OR REPLACE INTO dead_letter VALUES (?, ?, ?, ?, ?, ?)",
                (item.item_id, item.kind, json.dumps(item.payload), json.dumps(item.files), reason[:500], self._clock()),
            )
            self._db.execute("DELETE FROM outbox WHERE item_id = ?", (item.item_id,))
            self._db.execute("COMMIT")

    def stats(self) -> dict:
        """Para el heartbeat: cuánto hay pendiente y desde hace cuánto (la cola crece = la subida falla)."""
        with self._lock:
            pending, oldest = self._db.execute("SELECT COUNT(*), MIN(created_at) FROM outbox").fetchone()
            dead = self._db.execute("SELECT COUNT(*) FROM dead_letter").fetchone()[0]
        age = round(self._clock() - oldest, 1) if oldest is not None else 0.0
        return {"pending": pending, "oldest_age_s": age, "dead_letters": dead}


# ------------------------------------------------------------------------------ cliente de la API
class RetryableError(Exception):
    """Red caída, timeout, 429 o 5xx: vale la pena reintentar más tarde."""


class PermanentError(Exception):
    """4xx (menos 429): el request está mal y reintentarlo daría lo mismo."""


class ApiClient:
    """HTTPS a la API de ingesta con el token del sitio. Todos los timeouts son explícitos.

    Dos clientes a propósito: `api` lleva el header Authorization; `blob` sube a S3 con la URL
    prefirmada SIN ese header. La URL prefirmada ya ES la credencial: si además mandas un Bearer,
    S3 rechaza el PUT por tener dos mecanismos de autenticación.
    """

    def __init__(self, base_url: str, token: str, transport: httpx2.BaseTransport | None = None):
        timeout = httpx2.Timeout(10.0, connect=3.0)  # connect corto: si no hay red, fallar rápido
        self.api = httpx2.Client(
            base_url=base_url, timeout=timeout, transport=transport,
            headers={"Authorization": f"Bearer {token}", "User-Agent": f"c02-forwarder/{VERSION}"},
        )
        self.blob = httpx2.Client(timeout=httpx2.Timeout(60.0, connect=3.0), transport=transport)  # un clip ≈ 5 MB

    @staticmethod
    def _check(call) -> httpx2.Response:
        try:
            resp = call()
        except httpx2.TransportError as exc:  # DNS, conexión rechazada, timeout, TLS
            raise RetryableError(repr(exc)) from None
        if resp.status_code == 429 or resp.status_code >= 500:
            raise RetryableError(f"HTTP {resp.status_code}")
        if resp.status_code >= 400:
            raise PermanentError(f"HTTP {resp.status_code}: {resp.text[:200]}")
        return resp

    def upload(self, event_id: str, kind: str, index: int, path: str, content_type: str) -> str:
        """Pide una URL prefirmada y sube el archivo. Devuelve la llave S3.

        Cada intento pide una URL NUEVA: las prefirmadas vencen (15 min) y un reintento horas después
        con la URL vieja daría 403. Por la misma razón un 4xx de S3 se trata como reintentable.
        La llave es determinista (sitio/evento/foto-i): subir dos veces sobrescribe, no duplica.
        """
        spec = self._check(lambda: self.api.post(
            "/v1/uploads", json={"event_id": event_id, "kind": kind, "index": index, "content_type": content_type},
        )).json()
        try:
            data = Path(path).read_bytes()
        except OSError as exc:  # el archivo desapareció: tras 3 intentos el evento sale sin fotos
            raise RetryableError(f"archivo local: {exc}") from None
        try:
            self._check(lambda: self.blob.put(spec["url"], content=data, headers=spec.get("headers", {})))
        except PermanentError as exc:
            raise RetryableError(f"PUT a S3: {exc}") from None
        return spec["key"]

    def post_event(self, payload: dict) -> str:
        """202 {"status": "accepted" | "duplicate"}: las dos significan "la nube ya lo tiene"."""
        return self._check(lambda: self.api.post("/v1/events", json=payload)).json()["status"]

    def heartbeat(self, body: dict) -> dict:
        return self._check(lambda: self.api.post("/v1/heartbeat", json=body)).json()


# ------------------------------------------------------------------------------ envío
class Sender:
    """Vacía la cola: un ítem a la vez, con backoff por ítem y una pausa global si la red está caída."""

    def __init__(self, outbox: Outbox, api: ApiClient, clock=time.time, rng: random.Random | None = None):
        self.outbox, self.api, self.clock = outbox, api, clock
        self.rng = rng or random.Random()
        self.pause_until = 0.0  # con la API caída no tiene sentido probar el siguiente ítem enseguida

    def run_once(self) -> bool:
        """Procesa como máximo un ítem. True si hizo algo (el loop decide si dormir)."""
        if self.clock() < self.pause_until:
            return False
        item = self.outbox.next_due()
        if item is None:
            return False
        try:
            if item.kind == "event":
                result = self._send_event(item)
            else:
                result = self._send_clip(item)
        except RetryableError as exc:
            delay = backoff_delay(item.attempts, self.rng)
            self.outbox.retry(item.item_id, delay, str(exc))
            self.pause_until = self.clock() + min(delay, 30.0)  # pausa global corta: otros ítems esperan
            jlog("send_retry", item=item.item_id, attempt=item.attempts + 1, delay_s=round(delay, 2), error=str(exc))
            return True
        except PermanentError as exc:
            self.outbox.dead(item, str(exc))
            jlog("send_dead_letter", item=item.item_id, error=str(exc))
            return True
        except Exception as exc:  # noqa: BLE001 - un bug no debe matar el hilo que vacía la cola
            self.outbox.retry(item.item_id, backoff_delay(item.attempts, self.rng), repr(exc))
            jlog("send_bug", item=item.item_id, error=repr(exc))
            return True
        self.outbox.done(item.item_id)
        for f in item.files:  # el disco de la caja es finito: lo enviado se borra
            Path(f).unlink(missing_ok=True)
        if item.kind == "event" and item.files:
            try:
                Path(item.files[0]).parent.rmdir()  # la carpeta del evento, si quedó vacía
            except OSError:
                pass
        jlog("sent", item=item.item_id, kind=item.kind, result=result, attempts=item.attempts + 1,
             age_s=round(self.clock() - item.created_at, 2))
        return True

    def _send_event(self, item: Item) -> str:
        payload = dict(item.payload)
        keys: list[str] = []
        try:
            for i, path in enumerate(item.files):
                keys.append(self.api.upload(payload["event_id"], "frame", i, path, "image/jpeg"))
        except RetryableError:
            if item.attempts < DEGRADE_AFTER_ATTEMPTS:
                raise
            # Degradación: la API responde pero las fotos no suben. Una intrusión SIN fotos vale más que
            # ninguna: sale igual, marcada, y el SOC la ve como "sin verificar".
            keys, payload["evidence_missing"] = [], True
        payload["frames"] = keys
        return self.api.post_event(payload)

    def _send_clip(self, item: Item) -> str:
        if not Path(item.files[0]).exists():  # sin archivo no hay nada que reintentar
            raise PermanentError("clip ausente en el disco")
        return self.api.upload(item.payload["event_id"], "clip", 0, item.files[0], "video/mp4")

    def run_forever(self, stop: threading.Event) -> None:
        while not stop.is_set():
            if not self.run_once():
                stop.wait(0.5)  # nada que hacer: dormir poco, un evento nuevo debe salir en < 1 s


# ------------------------------------------------------------------------------ evidencia
class Evidence:
    """Fotos y clips del stream PRINCIPAL de la cámara (15 fps, mejor calidad que el de análisis)."""

    def __init__(self, cfg: SiteConfig, user: str, password: str, http: httpx2.Client | None = None, clock=time.time):
        self.cfg, self.clock = cfg, clock
        self.http = http or httpx2.Client(timeout=httpx2.Timeout(1.5, connect=0.5))
        self.auth = httpx2.DigestAuth(user, password)  # muchas cámaras piden Digest y rechazan Basic
        self.user, self.password = user, password
        self._cache: dict[str, tuple[float, bytes]] = {}
        self._lock = threading.Lock()

    def snapshot(self, camera_id: str) -> bytes | None:
        """JPEG actual de la cámara, o None. Reusa una foto de < 0.5 s: varias personas entrando a la
        vez a zonas de la misma cámara no deben disparar varias descargas al mismo equipo."""
        with self._lock:
            cached = self._cache.get(camera_id)
            if cached and self.clock() - cached[0] < 0.5:
                return cached[1]
        url = self.cfg.cameras[camera_id].snapshot_url
        if not url:
            return None
        try:
            resp = self.http.get(url, auth=self.auth)
        except httpx2.TransportError:
            return None  # sin foto no se frena el evento: el verificador trabaja con las que haya
        if resp.status_code != 200 or not resp.content.startswith(b"\xff\xd8"):  # JPEG empieza con FFD8
            return None
        with self._lock:
            self._cache[camera_id] = (self.clock(), resp.content)
        return resp.content

    def record_clip(self, camera_id: str, dest: Path) -> bool:
        """10 s del stream principal con ffmpeg SIN decodificar (-c copy): casi nada de CPU.

        Empieza al disparar, no antes: el NVR del sitio ya graba continuo y tiene el "antes" para una
        investigación. Con -c copy ffmpeg descarta los frames previos al primer keyframe: con un GOP de
        4 s en la cámara, el clip pierde hasta 4 s. Configura GOP ≈ 1–2 s en el stream principal.
        """
        url = self.cfg.cameras[camera_id].rtsp_main_url
        if not url:
            return False
        if shutil.disk_usage(dest.parent).free < MIN_FREE_BYTES:
            jlog("clip_skipped_disk", camera=camera_id)
            return False
        auth_url = url.replace("rtsp://", f"rtsp://{self.user}:{self.password}@", 1)  # nunca se loguea
        cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", auth_url,
               "-t", str(CLIP_SECONDS), "-an", "-c", "copy", "-movflags", "+faststart", "-y", str(dest)]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=CLIP_SECONDS + 20)
        except (subprocess.SubprocessError, OSError) as exc:
            jlog("clip_failed", camera=camera_id, error=type(exc).__name__)
            return False
        return dest.exists() and dest.stat().st_size > 0


# ------------------------------------------------------------------------------ orquestación
class Forwarder:
    """Pega las piezas: MQTT → reglas → evidencia → cola. Nada aquí espera a la red."""

    def __init__(self, cfg: SiteConfig, outbox: Outbox, evidence: Evidence, spool: Path,
                 io_pool: ThreadPoolExecutor, clip_pool: ThreadPoolExecutor, clock=time.time):
        self.cfg, self.outbox, self.evidence, self.spool = cfg, outbox, evidence, spool
        self.rules = ZoneRules(cfg)
        self.io_pool, self.clip_pool, self.clock = io_pool, clip_pool, clock
        self._lock = threading.Lock()
        self._pending: dict[tuple, tuple[float, dict[int, Future]]] = {}  # fotos pedidas antes del disparo
        self._frames: Counter[str] = Counter()
        self._window_start = clock()
        self.counters: Counter[str] = Counter()  # mensajes rotos, cámaras desconocidas: van al heartbeat

    def on_message(self, payload: bytes) -> None:
        """Corre en el hilo de red de paho: debe volver en microsegundos (nada de I/O aquí)."""
        try:
            frame = parse_minimal_payload(payload)
        except (ValueError, KeyError, TypeError):
            self.counters["malformed_messages"] += 1
            return
        if frame.camera_id not in self.cfg.cameras:
            self.counters["unknown_camera_messages"] += 1  # [sensorN] y site.yaml desalineados
            return
        with self._lock:
            self._frames[frame.camera_id] += 1  # también los frames vacíos: son los que prueban que hay video
        for action in self.rules.process(frame):
            if isinstance(action, SnapshotRequest):
                fut = self.io_pool.submit(self.evidence.snapshot, action.camera_id)
                with self._lock:
                    self._pending.setdefault(action.key, (self.clock(), {}))[1][action.index] = fut
            elif isinstance(action, ZoneEvent):
                with self._lock:
                    _, futures = self._pending.pop(action.key, (0.0, {}))
                self.io_pool.submit(self._finalize, action, futures)
        self._prune_pending()

    def _prune_pending(self) -> None:
        """Fotos pedidas para gente que entró y salió sin cumplir el dwell: se olvidan a los 2 min."""
        now = self.clock()
        with self._lock:
            for key in [k for k, (t, _) in self._pending.items() if now - t > 120]:
                del self._pending[key]

    def _finalize(self, event: ZoneEvent, futures: dict[int, Future]) -> None:
        """Junta las 3 fotos, persiste el evento en la cola y DESPUÉS graba el clip (no lo espera)."""
        images: list[bytes] = []
        for i in (0, 1):
            img = None
            if i in futures:
                try:
                    img = futures[i].result(timeout=2.0)
                except Exception:  # noqa: BLE001 - una foto fallida no debe tumbar el evento
                    img = None
            if img is not None:
                images.append(img)
        # Foto 2: al cumplirse el dwell. En un recordatorio (mismo track 10 min después) no hay fotos
        # previas pedidas y el evento sale con esta sola.
        last = self.evidence.snapshot(event.camera_id)
        if last is not None:
            images.append(last)
        folder = self.spool / event.event_id
        folder.mkdir(parents=True, exist_ok=True)
        files = []
        for i, img in enumerate(images[:3]):
            path = folder / f"frame-{i}.jpg"
            path.write_bytes(img)
            files.append(str(path))
        payload = event.to_payload([], MODEL_VERSION, VERSION)  # "frames" se llena al subir
        if self.outbox.put(event.event_id, "event", payload, files):
            jlog("event_queued", event_id=event.event_id, camera=event.camera_id, zone=event.zone_id,
                 frames=len(files), lag_s=round(self.clock() - event.first_seen_at, 2))
            self.clip_pool.submit(self._record_clip, event)

    def _record_clip(self, event: ZoneEvent) -> None:
        # Carpeta aparte de las fotos: el Sender borra la carpeta del evento al enviarlo y ffmpeg
        # crea el archivo recién al recibir el primer paquete; en la misma carpeta sería una carrera.
        clips = self.spool / "clips"
        clips.mkdir(parents=True, exist_ok=True)
        clip = clips / f"{event.event_id}.mp4"
        if self.evidence.record_clip(event.camera_id, clip):
            self.outbox.put(f"{event.event_id}:clip", "clip", {"event_id": event.event_id}, [str(clip)])

    def camera_fps(self) -> dict[str, float]:
        """fps por cámara desde el último heartbeat. TODAS las cámaras de site.yaml: la que no mandó
        nada aparece con 0.0 (si la omitiéramos, la serie desaparecería y la alerta nunca dispararía)."""
        now = self.clock()
        with self._lock:
            counts, self._frames = self._frames, Counter()
            elapsed, self._window_start = max(now - self._window_start, 1e-6), now
        return {cam: round(counts.get(cam, 0) / elapsed, 2) for cam in self.cfg.cameras}


def heartbeat_loop(fwd: Forwarder, api: ApiClient, outbox: Outbox, stop: threading.Event, interval: float = 30.0) -> None:
    """Cada 30 s: 'sigo vivo' + fps por cámara + estado de la cola. NO pasa por la cola: un heartbeat
    de hace una hora no le dice nada a nadie; si falla, el siguiente sale en 30 s."""
    while not stop.wait(interval):
        body = {"sent_at": time.time(), "forwarder_version": VERSION, "model_version": MODEL_VERSION,
                "cameras": fwd.camera_fps(), "outbox": outbox.stats(), "counters": dict(fwd.counters)}
        try:
            reply = api.heartbeat(body)
            skew = reply.get("server_time", body["sent_at"]) - body["sent_at"]
            if abs(skew) > 2:  # el SLO se mide con el reloj de la caja: si NTP falla, la métrica miente
                jlog("clock_skew", skew_s=round(skew, 2))
        except (RetryableError, PermanentError) as exc:
            jlog("heartbeat_failed", error=str(exc))


# ------------------------------------------------------------------------------ main
def main() -> None:
    # Raíz en WARNING y nuestro logger en INFO: httpx2 loguea CADA request en INFO ("HTTP Request: …") y
    # ensuciaría las líneas JSON (visto al correr el forwarder completo contra la API real).
    logging.basicConfig(stream=sys.stdout, level=logging.WARNING, format="%(message)s")
    log.setLevel(logging.INFO)
    cfg = SiteConfig.from_dict(yaml.safe_load(Path(os.environ["SITE_CONFIG"]).read_text(encoding="utf-8")))
    data_dir = Path(os.getenv("DATA_DIR", "/var/lib/forwarder"))  # volumen persistente: cola + spool
    spool = data_dir / "spool"
    spool.mkdir(parents=True, exist_ok=True)
    # Secretos como ARCHIVOS montados (Docker secrets), no como variables: no salen en `docker inspect`
    token = Path(os.environ["API_TOKEN_FILE"]).read_text().strip()
    cam_password = Path(os.environ["CAMERA_PASSWORD_FILE"]).read_text().strip()

    outbox = Outbox(str(data_dir / "outbox.sqlite3"))
    api = ApiClient(os.environ["API_URL"], token)
    evidence = Evidence(cfg, os.getenv("CAMERA_USER", "forwarder"), cam_password)
    io_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="io")  # fotos: I/O corto
    clip_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="clip")  # clips: 10 s cada uno, aparte
    fwd = Forwarder(cfg, outbox, evidence, spool, io_pool, clip_pool)
    stop = threading.Event()

    # paho-mqtt 2.x: hay que declarar la versión de la API de callbacks (VERSION2)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"forwarder-{cfg.site_id}")
    # Suscribirse en on_connect (y no una vez al inicio) hace que la suscripción vuelva tras cada reconexión
    client.on_connect = lambda c, userdata, flags, reason, props: c.subscribe(os.getenv("MQTT_TOPIC", "ds/detections"), qos=0)
    client.on_message = lambda c, userdata, msg: fwd.on_message(msg.payload)
    client.reconnect_delay_set(min_delay=1, max_delay=30)  # si mosquitto reinicia, reintenta solo
    client.connect_async(os.getenv("MQTT_HOST", "mqtt"), int(os.getenv("MQTT_PORT", "1883")), keepalive=30)
    client.loop_start()  # hilo de red de paho; on_message corre ahí

    sender = Sender(outbox, api)
    threads = [
        threading.Thread(target=sender.run_forever, args=(stop,), name="sender", daemon=True),
        threading.Thread(target=heartbeat_loop, args=(fwd, api, outbox, stop), name="heartbeat", daemon=True),
    ]
    for t in threads:
        t.start()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())  # docker stop manda SIGTERM
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    jlog("started", site=cfg.site_id, cameras=len(cfg.cameras), version=VERSION, pending=outbox.stats())
    stop.wait()
    client.loop_stop()  # deja de recibir detecciones
    io_pool.shutdown(wait=True)  # termina de guardar los eventos en curso: quedan en SQLite
    clip_pool.shutdown(wait=False, cancel_futures=True)  # un clip a medias no vale la pena esperar
    jlog("stopped", pending=outbox.stats())


if __name__ == "__main__":
    main()
