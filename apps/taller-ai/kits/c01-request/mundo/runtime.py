"""El runtime de contenedores del nodo (en C01: containerd, guiado por el kubelet), para un pod. Es el proceso principal
de cada contenedor nodo-a / nodo-b de compose.yaml:

    python mundo/runtime.py --pod gateway-…-xa7k2 --nodo a --uid … --contenedor gateway -- <comando del contenedor>

Hace lo que hacen containerd y el kubelet con el stdout de un contenedor, y nada más:
- Corre el comando. Lee su stdout y su stderr línea por línea y escribe cada una en el disco del nodo, en el formato
  de CRI: «<hora RFC 3339 con nanosegundos, UTC> <stdout|stderr> <F|P> <texto>». F = línea completa; P = un pedazo
  (una línea de más de 16 KiB se parte en pedazos, como containerd).
- Archivo: /var/log/pods/<ns>_<pod>_<uid>/<contenedor>/<reinicios>.log, y el enlace que lee Fluent Bit:
  /var/log/containers/<pod>_<ns>_<contenedor>-<id del contenedor>.log (en el disco del nodo: el volumen log-a o log-b).
- Rotación del kubelet: al pasar de container_log_max_size_mib, el archivo se renombra con la hora (<n>.log.AAAAMMDD-
  HHMMSS) y se empieza otro; se guardan container_log_max_files archivos en total (el más viejo se borra).
- Si el contenedor termina sin que se lo pidan, lo vuelve a arrancar (restartPolicy: Always), con espera creciente
  (1, 2, 4… hasta 10 s: el CrashLoopBackOff), con otro id de contenedor y el número de reinicio en el archivo.
- El estado (PID del contenedor, reinicios, id, archivo) va a /var/lib/dojo/<pod>.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
MAX_LINEA = 16 * 1024


def hora_cri() -> str:
    ns = time.time_ns()
    s, frac = divmod(ns, 1_000_000_000)
    return datetime.fromtimestamp(s, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + f".{frac:09d}Z"


class Archivo:
    def __init__(self, carpeta: Path, n: int, enlace: Path, max_bytes: int, max_archivos: int):
        self.carpeta, self.n, self.enlace = carpeta, n, enlace
        self.max_bytes, self.max_archivos = max_bytes, max_archivos
        self.ruta = carpeta / f"{n}.log"
        self.lock = threading.Lock()
        carpeta.mkdir(parents=True, exist_ok=True)
        self.f = open(self.ruta, "ab", buffering=0)
        enlace.parent.mkdir(parents=True, exist_ok=True)
        if enlace.is_symlink() or enlace.exists():
            enlace.unlink()
        enlace.symlink_to(os.path.relpath(self.ruta, enlace.parent))

    def escribir(self, flujo: str, texto: bytes) -> None:
        texto = texto.rstrip(b"\n")
        pedazos = [texto[i:i + MAX_LINEA] for i in range(0, len(texto), MAX_LINEA)] or [b""]
        with self.lock:
            for i, p in enumerate(pedazos):
                marca = b"F" if i == len(pedazos) - 1 else b"P"
                self.f.write(hora_cri().encode() + b" " + flujo.encode() + b" " + marca + b" " + p + b"\n")
            if self.f.tell() >= self.max_bytes:
                self.rotar()

    def rotar(self) -> None:
        self.f.close()
        sello = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        self.ruta.rename(self.carpeta / f"{self.n}.log.{sello}")
        viejos = sorted(self.carpeta.glob(f"{self.n}.log.*"))
        for v in viejos[: max(0, len(viejos) - (self.max_archivos - 1))]:
            v.unlink()
        self.f = open(self.ruta, "ab", buffering=0)

    def cerrar(self) -> None:
        with self.lock:
            self.f.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pod", required=True)
    ap.add_argument("--nodo", required=True)
    ap.add_argument("--uid", required=True)
    ap.add_argument("--contenedor", default="gateway")
    ap.add_argument("--ns", default="classifier")
    ap.add_argument("--max-mib", type=float, default=10)
    ap.add_argument("--max-archivos", type=int, default=5)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
    base = Path(os.environ["LOG_RAIZ"]) if os.environ.get("LOG_RAIZ") else RAIZ / "nodo" / a.nodo   # en el nodo: /
    pods_dir = base / "var" / "log" / "pods" / f"{a.ns}_{a.pod}_{a.uid}" / a.contenedor
    estado = base / "var" / "lib" / "dojo" / f"{a.pod}.json"
    estado.parent.mkdir(parents=True, exist_ok=True)
    parar = threading.Event()
    hijo: list[subprocess.Popen] = []

    def salir(*_):
        parar.set()
        if hijo and hijo[0].poll() is None:
            hijo[0].terminate()

    signal.signal(signal.SIGTERM, salir)
    signal.signal(signal.SIGINT, salir)
    reinicios, espera = 0, 1.0
    while not parar.is_set():
        cid = hashlib.sha256(f"{a.pod}-{reinicios}-{time.time_ns()}".encode()).hexdigest()
        enlace = base / "var" / "log" / "containers" / f"{a.pod}_{a.ns}_{a.contenedor}-{cid}.log"
        arch = Archivo(pods_dir, reinicios, enlace, int(a.max_mib * 1024 * 1024), a.max_archivos)
        p = subprocess.Popen(cmd, cwd=RAIZ, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env={**os.environ, "PYTHONUNBUFFERED": "1"})
        hijo[:] = [p]
        inicio = time.time()
        estado.write_text(json.dumps({"pod": a.pod, "nodo": a.nodo, "pid": p.pid, "runtime_pid": os.getpid(),
                                      "reinicios": reinicios, "contenedor_id": cid, "archivo": str(arch.ruta), "enlace": str(enlace),
                                      "desde": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n")

        def leer(flujo, nombre):
            for linea in iter(flujo.readline, b""):
                arch.escribir(nombre, linea)

        hilos = [threading.Thread(target=leer, args=(p.stdout, "stdout"), daemon=True),
                 threading.Thread(target=leer, args=(p.stderr, "stderr"), daemon=True)]
        for h in hilos:
            h.start()
        p.wait()
        for h in hilos:
            h.join(timeout=2)
        arch.cerrar()
        # el kubelet guarda los logs del contenedor anterior (kubectl logs --previous) y borra los de antes
        enlaces = sorted((base / "var" / "log" / "containers").glob(f"{a.pod}_*.log"), key=lambda x: x.lstat().st_mtime)
        for viejo in enlaces[:-2]:
            viejo.unlink(missing_ok=True)
        if parar.is_set():
            break
        reinicios += 1
        espera = 1.0 if time.time() - inicio > 30 else min(espera * 2, 10.0)
        print(f"runtime: {a.pod} terminó con código {p.returncode}; reinicio {reinicios} en {espera:.0f} s", file=sys.stderr, flush=True)
        parar.wait(espera)
    estado.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
