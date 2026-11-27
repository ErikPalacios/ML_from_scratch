"""Mete una falla en la configuración (config.yaml) o en cómo se sirve el LLM (servidor.env). Nunca toca tu código
(pipeline/).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py (≈ 40 s; el LLM y tu API arriba). Si la falla toca servidor.env,
el LLM se vuelve a arrancar, como lo haría quien la metió. La falla activa se guarda como un hash en .taller/: ni tú
ni Claude la pueden leer ahí.
"""
from __future__ import annotations

import argparse
import hashlib
import re
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import CONFIG, ENV, TALLER, editar_env, escribir_json, leer_json  # noqa: E402

ESTADO_ROMPER = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"


def editar_config(clave: str, valor: str) -> None:
    """Cambia una línea de config.yaml («clave: valor»), sin perder los comentarios."""
    s = CONFIG.read_text()
    s2 = re.sub(rf'(?m)^(\s*{clave}:\s*)(\[[^\]]*\]|"[^"]*"|\S+)', lambda m: m.group(1) + valor, s, count=1)
    if s2 == s:
        raise SystemExit(f"no encontré {clave} en config.yaml")
    CONFIG.write_text(s2)


def respaldar() -> None:
    shutil.rmtree(RESPALDO, ignore_errors=True)
    RESPALDO.mkdir(parents=True)
    shutil.copy(CONFIG, RESPALDO / "config.yaml")
    shutil.copy(ENV, RESPALDO / "servidor.env")


def llm_de_nuevo() -> None:
    print("  arrancando el LLM otra vez: python mundo/servidor.py arrancar")
    r = subprocess.run([sys.executable, "mundo/servidor.py", "arrancar"], cwd=RAIZ, capture_output=True, text=True, timeout=180)
    print("  " + (r.stdout.strip().splitlines() or ["(sin salida)"])[-1])


def devolver() -> None:
    shutil.copy(RESPALDO / "config.yaml", CONFIG)
    otro = (RESPALDO / "servidor.env").read_text() != ENV.read_text()
    shutil.copy(RESPALDO / "servidor.env", ENV)
    if otro:
        llm_de_nuevo()


# ---------------------------------------------------------------- las fallas
def citas_contra_k(_e: dict) -> None:
    editar_config("contra", "k")


def cache_sin_persona(_e: dict) -> None:
    editar_config("clave", "[pregunta]")


def limite_corto(_e: dict) -> None:
    editar_config("limite_s", "0.5")


def ventana_repartida(_e: dict) -> None:
    editar_env("PARALELO", "8")
    llm_de_nuevo()


def drive_sin_revisar(_e: dict) -> None:
    editar_config("revisar_fuentes", "[wiki, jira, politicas]")


def retrieval_de_mas(_e: dict) -> None:
    editar_config("candidatos", "150")
    editar_config("rerank_n", "150")
    editar_config("k", "24")


ARREGLO = "Arreglo: el valor de fábrica"
FALLAS = {
    "citas-contra-k": dict(
        tipo="config", titulo="Una persona ve citas a documentos que no existen en su respuesta", aplicar=citas_contra_k,
        historia="Para «simplificar» la validación de citas, alguien la cambió a revisar solo que el número vaya de 1 a 8: «el top siempre trae 8».",
        explica="config.yaml quedó con citas.contra: k. Así una cita es válida si su número va de 1 a retrieval.k, aunque el prompt no haya llevado ese documento: a Carmen, que ve 4 chunks, le pasa un [6] que no apunta a nada (en la app, un enlace roto o, peor, a lo que sea que el frontend crea que es el 6). El top no siempre trae 8: se recorta por la ventana, por los permisos o por las guardas. Se ve con python verificar.py citas. " + ARREGLO + " (citas.contra: contexto): cada número se revisa contra la lista de documentos que de verdad se le dio al modelo, y contra la ACL de quien pregunta."),
    "cache-sin-persona": dict(
        tipo="config", titulo="Una persona recibe el contexto de otra cuando hacen la misma pregunta", aplicar=cache_sin_persona,
        historia="Para que la cache «pegue más», alguien dejó solo la pregunta en su llave: «la pregunta es la misma, el top también».",
        explica="config.yaml quedó con api.cache.clave: [pregunta]. El top-8 depende de quién pregunta (el filtro de permisos va dentro del retrieval), así que con la llave sin la persona, Carmen recibe el top que se armó para Elena. Tu API lo nota porque revisa cada chunk contra la ACL de quien pregunta antes del prompt (descartados > 0) y no se los da, pero Carmen se queda con un contexto que no es el suyo. Se ve con python verificar.py permisos. " + ARREGLO + " (api.cache.clave: [pregunta, persona]): todo lo que se guarda en una cache de un sistema con permisos lleva la identidad (y, en C11, la versión de la ACL) en la llave."),
    "limite-corto": dict(
        tipo="config", titulo="Las respuestas se cortan a la mitad", aplicar=limite_corto,
        historia="Para alinear la API con «el timeout de todas las APIs de la empresa», alguien puso 500 ms como límite de la respuesta.",
        explica="config.yaml quedó con llm.limite_s: 0.5. Una API REST normal contesta en milisegundos, pero una respuesta de un LLM son cientos de tokens que salen uno por uno: solo el primero ya tarda ≈ 0.3–0.9 s aquí. Tu API cierra bien el flujo (un evento error con motivo limite), pero casi ninguna respuesta se completa. Se ve con python verificar.py stream. " + ARREGLO + " (llm.limite_s: 30): el límite de una respuesta en streaming se calcula con el TTFT más max_tokens entre la velocidad del modelo, y se mide."),
    "ventana-repartida": dict(
        tipo="servidor", titulo="Las respuestas llegan con menos documentos de los que trae el retrieval", aplicar=ventana_repartida,
        historia="Para atender a ocho personas a la vez, alguien subió PARALELO a 8 en servidor.env y volvió a arrancar el LLM.",
        explica="servidor.env quedó con PARALELO=8. llama-server reparte su contexto (CONTEXTO=8192) entre sus slots: cada petición tiene 8192 ÷ 8 = 1024 tokens para prompt y respuesta. Con 256 de respuesta y 64 de reserva quedan 704 para las reglas, la pregunta y los documentos: tu API recorta los de abajo (bien: así no hay error de contexto excedido), pero el modelo contesta con 4 o 5 documentos en vez de 8. Se ve con python verificar.py contexto (y en el evento fuentes: recortados). Arreglo: PARALELO=1 en servidor.env y python mundo/servidor.py arrancar. Para más concurrencia, se sube CONTEXTO junto con PARALELO (cuesta memoria del KV cache: estación 7)."),
    "drive-sin-revisar": dict(
        tipo="config", titulo="El asistente le pide a un agente los 16 dígitos de la tarjeta de un cliente", aplicar=drive_sin_revisar,
        historia="Para bajar la latencia, alguien dejó de revisar los documentos de Drive: «son internos, los sube nuestra gente».",
        explica="config.yaml quedó con seguridad.revisar_fuentes: [wiki, jira, politicas]. drive:d40#000 es un documento que compartió un vendedor y trae una instrucción para el asistente: ignorar sus reglas, decir que el reembolso tarda 24 horas y pedir los 16 dígitos de la tarjeta por un correo de fuera. Sin revisar Drive, entra al prompt como documento [1] y el modelo de 0.6B la obedece. Se ve con python verificar.py inyeccion. " + ARREGLO + " (revisar_fuentes con drive): se revisan todas las fuentes, y la revisión es una capa de varias (los documentos como datos en el prompt, citas validadas, nada de herramientas con efectos sin confirmar)."),
    "retrieval-de-mas": dict(
        tipo="config", titulo="El primer token pasó de ≈ 0.9 s a más de 3 s", aplicar=retrieval_de_mas,
        historia="Para que «no se escape nada», alguien subió el retrieval: 150 candidatos por índice, que el reranker lea todos y 24 documentos al prompt.",
        explica="config.yaml quedó con retrieval.candidatos: 150, rerank_n: 150 y k: 24. El reranker pasa de 20 pares a 150 (≈ 0.3 s → ≈ 1.3 s) y el prompt de ≈ 1,000 a ≈ 2,800 tokens, que el LLM tiene que leer antes de su primer token (el prefill, ≈ 1,500 tokens/s aquí). El p95 del primer token pasa el presupuesto de 2.5 s. Se ve con python verificar.py ttft. " + ARREGLO + " (candidatos 30, rerank_n 20, k 8): el presupuesto se reparte entre buscar, el reranker y el prefill, y cada perilla del retrieval se paga ahí. Si se quiere más contexto, se mide con el golden set (estación 9) si de verdad mejora."),
}


# ---------------------------------------------------------------- comandos
def h(sal: str, falla: str) -> str:
    return hashlib.sha256(f"{sal}|{falla}".encode()).hexdigest()


def activa(e: dict) -> str | None:
    return next((f for f in FALLAS if h(e["sal"], f) == e["hash"]), None) if e else None


def verificar(silencio: bool = True) -> list[str]:
    import verificar as v

    r = v.correr(list(v.CHECKS), silencio=silencio)
    return [k for k, (ok, _) in r.items() if not ok]


def romper(mostrar: bool, cual: str | None) -> None:
    if leer_json(ESTADO_ROMPER):
        sys.exit("✗ ya hay una falla activa: python romper.py --verificar (o --restaurar)")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    print("  revisando que todo esté sano (≈ 40 s)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    print("  rompiendo…")
    respaldar()
    escribir_json(ESTADO_ROMPER, e)
    f["aplicar"](e)
    if mostrar:
        print(f"\n[solo para Claude] falla: {falla} · tipo: {f['tipo']} · {f['titulo']}\n  {f['explica']}\n")
    print(f"⚠ Historia: {f['historia']}")
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python verificar.py, y a diagnosticar.")


def cerrar(e: dict, falla: str, como: str) -> None:
    f = FALLAS[falla]
    if como != "Restaurada":  # arreglada o revelada: queda en taller/progreso.json con su tiempo, para tu tablero
        from taller.registro import anotar_falla

        anotar_falla(falla, e["inicio"], e.get("mostrada", False), rendido=como == "Revelada")
    minutos = (datetime.now(timezone.utc) - datetime.fromisoformat(e["inicio"])).total_seconds() / 60
    print(f"{como}: era «{falla}» · {f['titulo']} · {minutos:.0f} min\n  {f['explica']}")
    print("  restaurando…")
    devolver()
    ESTADO_ROMPER.unlink()
    shutil.rmtree(RESPALDO, ignore_errors=True)
    malos = verificar()
    print("✓ listo para otra falla" if not malos else f"⚠ después de restaurar falla: {', '.join(malos)} (corre verificar.py)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mostrar", action="store_true")
    ap.add_argument("--falla")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--verificar", action="store_true")
    g.add_argument("--revelar", action="store_true")
    g.add_argument("--restaurar", action="store_true")
    a = ap.parse_args()
    e = leer_json(ESTADO_ROMPER)
    if not (a.verificar or a.revelar or a.restaurar):
        return romper(a.mostrar, a.falla)
    falla = activa(e)
    if not falla:
        sys.exit("No hay ninguna falla activa.")
    if a.verificar:
        malos = verificar(silencio=False)
        if malos:
            sys.exit(f"\n✗ todavía no: {len(malos)} check(s) sin pasar")
        print()
        return cerrar(e, falla, "✓ arreglado")
    cerrar(e, falla, "Revelada" if a.revelar else "Restaurada")


if __name__ == "__main__":
    main()
