"""La sesión en la GPU rentada: cuánto va a durar y costar, cómo pedir la máquina, el vigía que la apaga y el apagado.

    python3 mundo/gpu.py plan        # antes de rentar: minutos y costo estimados de la sesión, con la hora del apagado
    python3 mundo/gpu.py receta      # los campos del formulario de RunPod, sacados de tu servir.sh y servidor.env
    python3 mundo/gpu.py vigilar     # al lanzar el pod: un proceso en tu Mac que lo apaga a los MINUTOS de gpu.env
    python3 mundo/gpu.py estado      # ¿sigue vivo el pod?, ¿cuánto lleva?, ¿cuándo lo apaga el vigía?
    python3 mundo/gpu.py apagar      # termina el pod ya (y para el vigía): deja de cobrar en ese momento

Se corre en tu Mac, no en el pod: la prueba de carga sale de tu Mac hacia el proxy del pod, así que los resultados
nunca se quedan en una máquina que se borra. Para apagar usa la API v2 de RunPod con tu llave (RUNPOD_API_KEY, en la
terminal: nunca en un archivo del kit). Si el vigía falla (la Mac se duerme, se va el internet), el tope es tu saldo
prepagado: RunPod detiene el pod cuando se acaba. Carga solo lo de una sesión.
"""
from __future__ import annotations

import json
import os
import shlex
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import GPU_ENV, MODELOS, MUNDO, RAIZ, TALLER, escribir_json, leer_env, leer_json  # noqa: E402

PROVEEDORES = json.loads((MUNDO / "proveedores.json").read_text())
API = os.environ.get("RUNPOD_API_URL", "https://api.runpod.io/v2")   # se cambia solo para probar con una API falsa
VIGIA = TALLER / "vigia.json"
IMAGEN = "vllm/vllm-openai:v0.34.0"
CARGA_ENV = RAIZ / "carga.env"


def gpu_env() -> dict:
    e = leer_env(GPU_ENV)
    faltan = [k for k in ("PROVEEDOR", "GPU", "USD_HORA", "MINUTOS", "DISCO_GB", "TIPO_CAMBIO") if not e.get(k)]
    if faltan:
        sys.exit(f"✗ gpu.env: faltan {', '.join(faltan)} (paso 6)")
    return e


# ---------------------------------------------------------------- plan
def fases() -> list[tuple[str, float]]:
    """Las piezas de la sesión con sus minutos estimados. La abierta sale de carga.env: peticiones ÷ tasa."""
    c = leer_env(CARGA_ENV)
    tasa, n = float(c.get("TASA") or 0.07), int(c.get("PETICIONES") or 40)
    cerrada = int(c.get("CERRADA_PETICIONES") or 24)
    bajar = MODELOS["Qwen/Qwen3-32B-AWQ"]["bytes_pesos"] / 100e6 / 60          # ≈ 100 MB/s de Hugging Face al pod
    return [
        ("pedir el pod y que arranque la imagen de vLLM (≈ 10 GB)", 6),
        (f"bajar el modelo ({MODELOS['Qwen/Qwen3-32B-AWQ']['bytes_pesos'] / 1e9:.1f} GB a ≈ 100 MB/s)", round(bajar, 1)),
        ("arranque de vLLM: cargar pesos, perfilar memoria, CUDA graphs", 4),
        ("verificar.py contra el pod", 3),
        (f"carga cerrada: {cerrada} preguntas, 8 a la vez", 4),
        (f"carga abierta: {n} preguntas a {tasa}/s (Poisson) y el final de la cola", round(n / tasa / 60 + 1, 1)),
        ("copiar números, revisar /metrics y apagar", 5),
    ]


def plan() -> None:
    e = gpu_env()
    p = PROVEEDORES["proveedores"].get(e["PROVEEDOR"], {})
    usd_h, tope, cambio = float(e["USD_HORA"]), float(e["MINUTOS"]), float(e["TIPO_CAMBIO"])
    disco_h = float(e["DISCO_GB"]) * float(e.get("USD_GB_MES") or 0.10) / 730
    print(f"Sesión en {p.get('nombre', e['PROVEEDOR'])} · 1 × {e['GPU'].upper()} a US${usd_h:.2f}/h + disco {e['DISCO_GB']} GB (US${disco_h:.3f}/h) · cobro {p.get('cobro', '?')}")
    total = 0.0
    for que, m in fases():
        total += m
        print(f"  {m:5.1f} min  {que}")
    costo = lambda mins: mins / 60 * (usd_h + disco_h)  # noqa: E731
    print(f"  ─────\n  {total:5.1f} min  estimado · US${costo(total):.2f} ≈ MXN {costo(total) * cambio:.0f}")
    print(f"  {tope:5.0f} min  tope del vigía (MINUTOS) · lo más que cuesta: US${costo(tope):.2f} ≈ MXN {costo(tope) * cambio:.0f}")
    if total > tope * 0.85:
        print(f"  ⚠ el estimado ({total:.0f} min) deja menos de 15 % de margen al tope: sube MINUTOS o baja PETICIONES en carga.env")
    fin = datetime.now() + timedelta(minutes=tope)
    print(f"Si lanzas el pod ahora y corres el vigía, se apaga solo a las {fin:%H:%M}. Saldo sugerido: US$10 (lo que alcance a cobrar es tu tope real).")


# ---------------------------------------------------------------- receta (de tu servir.sh)
def args_de_servir() -> list[str]:
    """Corre tu servir.sh con un `vllm` falso que solo imprime sus argumentos: la receta es lo que de verdad correría."""
    with tempfile.TemporaryDirectory() as d:
        falso = Path(d) / "vllm"
        falso.write_text("#!/usr/bin/env python3\nimport json, sys\nprint(json.dumps(sys.argv[1:]))\n")
        falso.chmod(0o755)
        r = subprocess.run(["bash", "servir.sh"], cwd=RAIZ, capture_output=True, text=True, timeout=30,
                           env={**os.environ, "PATH": f"{d}{os.pathsep}{os.environ['PATH']}"})
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        sys.exit(f"✗ no pude leer los argumentos de servir.sh (¿termina en `exec vllm serve …`?): {r.stderr.strip()[-300:]}")


def receta() -> None:
    e = gpu_env()
    a = args_de_servir()
    if a[:1] != ["serve"]:
        sys.exit(f"✗ servir.sh corre `vllm {' '.join(a[:2])}`, no `vllm serve …`")
    a = a[1:]
    limpio, clave = [], None
    i = 0
    while i < len(a):
        if a[i] == "--api-key":
            clave, i = a[i + 1], i + 2
            continue
        if a[i] == "--host":
            i += 2
            continue
        limpio.append(a[i])
        i += 1
    limpio = [limpio[0], "--host", "0.0.0.0", *limpio[1:]]
    puerto = limpio[limpio.index("--port") + 1] if "--port" in limpio else "8000"
    print("RunPod → Pods → Deploy. Llena así (lo demás, como viene):")
    print(f"  Cloud:                 Secure Cloud · GPU: {e['GPU'].upper()} × 1 (si no hay: RTX 6000 Ada, también 48 GB)")
    print(f"  Pod template:          Edit → Container image: {IMAGEN}")
    print(f"  Container disk:        {e['DISCO_GB']} GB · Volume disk: 0 GB (al terminar se borra todo; no cobra después)")
    print(f"  Expose HTTP ports:     {puerto}")
    print(f"  Environment variables: VLLM_API_KEY = {'(tu CLAVE de servidor.env)' if clave else '⚠ servir.sh no pasa --api-key: el proxy es público'}"
          "\n                         VLLM_NO_USAGE_STATS = 1 (que vLLM no mande estadísticas de uso)")
    print(f"  Container start command:\n    {shlex.join(limpio)}")
    print(f"Cuando diga Running: copia su id (Pods → el nombre del pod) a POD_ID en gpu.env y en servidor.env pon\n"
          f"  LLM_URL=https://<POD_ID>-{puerto}.proxy.runpod.net/v1")
    print("Y de inmediato, en otra terminal de tu Mac: python3 mundo/gpu.py vigilar")


# ---------------------------------------------------------------- la API de RunPod
def api(metodo: str, ruta: str, cuerpo: dict | None = None) -> tuple[int, dict]:
    clave = os.environ.get("RUNPOD_API_KEY")
    if not clave:
        sys.exit("✗ falta RUNPOD_API_KEY en esta terminal: export RUNPOD_API_KEY=… (RunPod → Settings → API Keys: una llave «All», o «Restricted» con pods:write)")
    req = urllib.request.Request(API + ruta, json.dumps(cuerpo).encode() if cuerpo is not None else None, method=metodo,
                                 headers={"Authorization": f"Bearer {clave}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            datos = r.read()
            return r.status, json.loads(datos) if datos.strip() else {}
    except urllib.error.HTTPError as err:
        try:
            return err.code, json.loads(err.read() or b"{}")
        except json.JSONDecodeError:
            return err.code, {}
    except (urllib.error.URLError, TimeoutError) as err:
        return 0, {"error": str(getattr(err, "reason", err))}


def pod_id() -> str:
    pid = leer_env(GPU_ENV).get("POD_ID")
    if not pid:
        sys.exit("✗ gpu.env: falta POD_ID (el id del pod, en RunPod → Pods)")
    return pid


def terminar(pid: str) -> bool:
    """Termina el pod: deja de cobrar GPU y disco. DELETE (la ruta documentada) y, si no, la acción terminate. Luego
    confirma que ya no está: 404 o status TERMINATED. EXITED es detenido, no terminado: el disco seguiría cobrando."""
    st, d = api("DELETE", f"/pods/{pid}")
    if st not in (200, 204, 404):
        st2, d2 = api("POST", f"/pods/{pid}/action", {"action": "terminate"})
        if st2 not in (200, 204):
            print(f"✗ RunPod no terminó el pod {pid}: DELETE → {st} {d} · action → {st2} {d2}")
            return False
    for _ in range(10):
        st, d = api("GET", f"/pods/{pid}")
        if st == 404 or (st == 200 and str(d.get("status", "")).upper() == "TERMINATED"):
            return True
        time.sleep(3)
    print(f"⚠ pedí terminar el pod {pid}, pero RunPod todavía lo lista ({st} {d.get('status', d)}): revísalo en la consola")
    return False


# ---------------------------------------------------------------- vigía
def vigia_vivo() -> dict | None:
    v = leer_json(VIGIA)
    if not v:
        return None
    try:
        os.kill(v["pid"], 0)
        return v
    except (ProcessLookupError, PermissionError, KeyError):
        return None


def vigilar() -> None:
    e, pid = gpu_env(), pod_id()
    api("GET", f"/pods/{pid}")   # falla aquí (sin llave) y no en medio de la noche
    if vigia_vivo():
        sys.exit(f"✗ ya hay un vigía: python3 mundo/gpu.py estado")
    mins = float(e["MINUTOS"])
    inicio, fin = datetime.now(), datetime.now() + timedelta(minutes=mins)
    TALLER.mkdir(exist_ok=True)
    log = open(TALLER / "vigia.log", "a")
    p = subprocess.Popen([sys.executable, __file__, "_vigia", pid, str(fin.timestamp())], cwd=RAIZ, stdout=log, stderr=subprocess.STDOUT,
                         start_new_session=True, env=os.environ)
    escribir_json(VIGIA, {"pid": p.pid, "pod": pid, "inicio": inicio.isoformat(timespec="seconds"), "fin": fin.isoformat(timespec="seconds"),
                          "usd_hora": float(e["USD_HORA"])})
    print(f"▶ vigía en marcha (pid {p.pid}): apaga el pod {pid} a las {fin:%H:%M} ({mins:.0f} min). Avisa 10 min antes.")
    print("  Si cierras la Mac o se va el internet, el vigía no puede: apaga a mano con python3 mundo/gpu.py apagar.")


def _vigia(pid: str, fin_ts: float) -> None:
    aviso = fin_ts - 600 if fin_ts - 600 > time.time() else 0   # con un tope de menos de 10 min, no hay aviso
    while time.time() < fin_ts:
        if aviso and time.time() >= aviso:
            print(f"{datetime.now():%H:%M} faltan 10 min para apagar el pod {pid}", flush=True)
            subprocess.run(["osascript", "-e", f'display notification "Faltan 10 min: el vigía apaga el pod {pid}" with title "Dojo · GPU rentada"'],
                           capture_output=True)
            aviso = 0
        time.sleep(min(30, max(1, fin_ts - time.time())))
    print(f"{datetime.now():%H:%M} tope de tiempo: termino el pod {pid}", flush=True)
    ok = terminar(pid)
    print(f"{datetime.now():%H:%M} {'✓ pod terminado' if ok else '✗ NO se pudo terminar: revisa la consola de RunPod'}", flush=True)
    subprocess.run(["osascript", "-e", f'display notification "{"Pod terminado" if ok else "NO se pudo apagar el pod: revisa RunPod"}" with title "Dojo · GPU rentada"'],
                   capture_output=True)


def estado() -> None:
    pid = pod_id()
    st, d = api("GET", f"/pods/{pid}")
    v = vigia_vivo() or leer_json(VIGIA)
    if st == 404:
        print(f"■ el pod {pid} ya no existe (terminado): no cobra")
    elif st == 200:
        print(f"▶ pod {pid}: {d.get('status', '?')}{' (detenido: el disco sigue cobrando; termínalo)' if d.get('status') == 'EXITED' else ''}")
    else:
        print(f"? RunPod contesta {st}: {d}")
    if v:
        ini = datetime.fromisoformat(v["inicio"])
        mins = (datetime.now() - ini).total_seconds() / 60
        print(f"  lleva {mins:.0f} min · ≈ US${mins / 60 * v['usd_hora']:.2f} de GPU · vigía {'vivo' if vigia_vivo() else 'parado'}: apaga a las {datetime.fromisoformat(v['fin']):%H:%M}")


def apagar() -> None:
    pid = pod_id()
    v = vigia_vivo()
    ok = terminar(pid)
    if v:
        try:
            os.killpg(v["pid"], signal.SIGTERM)
        except ProcessLookupError:
            pass
    reg = leer_json(VIGIA)
    if reg:
        mins = (datetime.now() - datetime.fromisoformat(reg["inicio"])).total_seconds() / 60
        print(f"{'✓ pod terminado' if ok else '✗ revisa la consola'} · {mins:.0f} min desde que lo lanzaste · ≈ US${mins / 60 * reg['usd_hora']:.2f} de GPU")
        VIGIA.unlink(missing_ok=True)
    else:
        print("✓ pod terminado" if ok else "✗ revisa la consola de RunPod")
    if ok:
        print("  En servidor.env regresa LLM_URL a http://127.0.0.1:8000/v1 para seguir en tu Mac.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "plan"
    if cmd == "_vigia":
        _vigia(sys.argv[2], float(sys.argv[3]))
    elif cmd in ("plan", "receta", "vigilar", "estado", "apagar"):
        globals()[cmd]()
    else:
        sys.exit(__doc__)
