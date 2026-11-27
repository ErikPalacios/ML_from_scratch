"""Revisa los criterios de «listo» de la estación, uno por check. Solo lee: no cambia medicion.json, cuantizados/ ni
resultados/ (cuantizar vuelve a cuantizar en una carpeta temporal, para comparar).

    python3 verificar.py                     # todos
    python3 verificar.py cuantizar velocidad # algunos

Los checks miran lo que dejó tu pipeline (cuantizados/ y resultados/), no medicion.json: una medición mal hecha se
nota en sus datos. No hace falta entorno virtual: el kit solo usa la biblioteca estándar de Python.
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ))
from mundo.comun import CATALOGO, CUANTIZADOS, LLAMA_MIN, RESULTADOS, herramienta, leer_json, medicion, ruta_modelo, sha256_archivo, version_llama  # noqa: E402
from mundo.ficha import resumen  # noqa: E402

TIPOS = ("Q8_0", "Q4_K_M", "Q2_K")
# qué tipos de tensor tiene que traer cada cuantización de llama-quantize (lo grande; las normas van en F32)
TRAE = {"Q8_0": {"Q8_0"}, "Q4_K_M": {"Q4_K", "Q6_K"}, "Q2_K": {"Q2_K", "Q3_K", "Q6_K"}}
F16 = CATALOGO["qwen3-0.6b-f16"]


class Falla(Exception):
    pass


def exige(cond, msg) -> None:
    if not cond:
        raise Falla(msg() if callable(msg) else msg)


def manifiesto() -> dict:
    m = leer_json(CUANTIZADOS / "manifiesto.json")
    exige(m, "no está cuantizados/manifiesto.json: python3 pipeline/cuantizar.py (paso 1)")
    return m


def velocidad() -> dict:
    v = leer_json(RESULTADOS / "velocidad.json")
    exige(v and v.get("cuantizaciones"), "no está resultados/velocidad.json: python3 pipeline/medir.py (paso 2)")
    return v


def calidad() -> dict:
    c = leer_json(RESULTADOS / "calidad.json")
    exige(c and c.get("cuantizaciones"), "no está resultados/calidad.json: python3 pipeline/calidad.py (paso 4)")
    return c


# ---------------------------------------------------------------- checks
def check_mundo() -> str:
    v, linea = version_llama()
    exige(v, "no encuentro llama-server: brew install llama.cpp (paso 0)")
    exige(v >= LLAMA_MIN, f"llama.cpp {linea}: el kit se probó con {'.'.join(map(str, LLAMA_MIN))} o más nuevo (brew upgrade llama.cpp)")
    faltan = [h for h in ("llama-quantize", "llama-perplexity") if not herramienta(h)]
    exige(not faltan, f"no encuentro {', '.join(faltan)}: vienen con llama.cpp")
    p = ruta_modelo()
    exige(p.exists(), "falta el f16: python3 mundo/modelos.py")
    exige(sha256_archivo(p) == F16["sha256"], "el sha256 del f16 no es el del catálogo: bórralo y python3 mundo/modelos.py")
    return f"llama.cpp {linea} · llama-quantize y llama-perplexity · {F16['archivo']} ({F16['bytes'] / 1e9:.2f} GB, sha256 {F16['sha256'][:12]}…)"


def check_cuantizar() -> str:
    m = manifiesto()
    exige(medicion().get("fuente") == f"modelo/{F16['archivo']}", "medicion.json: la fuente tiene que ser el f16 del catálogo")
    exige(set(m) >= set(TIPOS), f"el manifiesto trae {sorted(m)} y faltan {sorted(set(TIPOS) - set(m))}")
    partes = []
    with tempfile.TemporaryDirectory() as tmp:
        for t in TIPOS:
            x = m[t]
            p = RAIZ / x["archivo"]
            exige(p.exists(), f"{t}: no está {x['archivo']}")
            exige(sha256_archivo(p) == x["sha256"], f"{t}: el archivo ya no es el del manifiesto (su sha256 cambió)")
            exige(x["fuente_sha256"] == F16["sha256"], f"{t}: según el manifiesto salió de otra fuente, no del f16")
            r = resumen(p)
            grandes = {k for k, c in r["tipos"].items() if c["pesos"] / r["pesos"] > 0.05}
            exige(grandes == TRAE[t], f"{t}: el archivo dice {x['archivo']} y sus pesos son {', '.join(sorted(grandes))} (python3 mundo/ficha.py {x['archivo']} --tipos)")
            exige(abs(r["bits_por_peso"] - x["bits_por_peso"]) < 0.01, f"{t}: el manifiesto dice {x['bits_por_peso']} bits por peso y el archivo tiene {r['bits_por_peso']}")
            # llama-quantize es determinista: desde el mismo f16, el mismo archivo
            otra = Path(tmp) / f"{t}.gguf"
            q = subprocess.run([herramienta("llama-quantize"), str(ruta_modelo()), str(otra), t], capture_output=True, text=True)
            exige(q.returncode == 0, f"{t}: llama-quantize falló al repetir la cuantización")
            exige(sha256_archivo(otra) == x["sha256"], f"{t}: cuantizar otra vez el f16 da otro archivo: el tuyo no salió del f16 con llama-quantize {t}")
            otra.unlink()
            partes.append(f"{t} {x['bytes'] / 1e6:,.0f} MB, {r['bits_por_peso']:.2f} bits")
    return " · ".join(partes) + " · los tres salen igual otra vez del f16"


def check_comparable() -> str:
    v = velocidad()
    cfg = v["medicion"]
    prompts = leer_json(RAIZ / cfg["prompts"])
    exige(v["prompts_sha256"] == sha256_archivo(RAIZ / cfg["prompts"]), "los prompts cambiaron desde que mediste: python3 pipeline/medir.py")
    exige(set(v["cuantizaciones"]) >= set(TIPOS), f"faltan cuantizaciones en velocidad.json: {sorted(set(TIPOS) - set(v['cuantizaciones']))}")
    ids = [p["id"] for p in prompts["prompts"]]
    leidos = {}
    for t in TIPOS:
        x = v["cuantizaciones"][t]
        exige(set(x["muestras"]) == set(ids), f"{t}: se midió con los prompts {sorted(x['muestras'])} y son {ids}: los mismos para todas")
        for pid, ms in x["muestras"].items():
            exige(len(ms) >= 3, f"{t}/{pid}: {len(ms)} muestra(s); con menos de 3 la mediana no dice nada")
            toks = sorted({s["tokens"] for s in ms})
            exige(toks == [cfg["max_tokens"]], f"{t}/{pid}: las respuestas tienen {toks} tokens y tendrían que ser {cfg['max_tokens']} todas: con largos distintos no se comparan (largo fijo, ignore_eos)")
            pn = [s["prompt_n"] for s in ms]
            exige(min(pn) > 10, f"{t}/{pid}: el servidor leyó {min(pn)} token(s) del prompt: reusó el prompt anterior (cache_prompt) y el TTFT no es real")
            leidos.setdefault(pid, set()).update(pn)
    for pid, pn in leidos.items():
        exige(len(pn) == 1, f"{pid}: el prompt entró con {sorted(pn)} tokens según la cuantización: todas tienen que leer exactamente lo mismo")
    return f"los mismos {len(ids)} prompts ({', '.join(f'{k}: {next(iter(n)):,} tokens' for k, n in leidos.items())}) · {cfg['max_tokens']} tokens de respuesta en cada muestra · sin cache"


def check_velocidad() -> str:
    v = velocidad()
    for t in TIPOS:
        x = v["cuantizaciones"][t]
        c, l = x["mediana"]["corto"]["decode_tps"], x["mediana"]["largo"]["decode_tps"]
        # con ≈ 3,000 tokens de contexto, escribir sí es más lento (la atención lee todo el KV cache): ≈ 0.65 del corto.
        # Si además se cuenta la lectura del prompt como escritura, baja a ≈ 0.3.
        exige(l >= 0.45 * c, f"{t}: escribe a {c:.0f} tokens/s con el prompt corto y a {l:.0f} con el largo: ¿estás contando la lectura del prompt como escritura? (decode = predicted_per_second)")
    med = {t: v["cuantizaciones"][t]["mediana"] for t in TIPOS}
    return " · ".join(f"{t} {med[t]['corto']['decode_tps']:.0f} tokens/s, TTFT largo {med[t]['largo']['ttft_ms']:,.0f} ms" for t in TIPOS)


def check_calidad() -> str:
    c = calidad()
    cfg = c["medicion"]
    exige(c["texto_sha256"] == sha256_archivo(RAIZ / cfg["texto"]), "el texto de la perplejidad cambió desde que mediste: python3 pipeline/calidad.py")
    f16 = c["f16"]["ppl"]
    partes = [f"f16 {f16:.2f}"]
    for t in TIPOS:
        x = c["cuantizaciones"].get(t)
        exige(x, f"falta {t} en calidad.json")
        ppl = x["perplejidad"]["ppl"]
        exige(ppl >= f16 * 0.995, f"{t}: perplejidad {ppl:.2f}, menor que la del f16 ({f16:.2f}): ¿el mismo texto y el mismo contexto?")
        vs = x["examen"]
        exige(len(vs) >= 2, f"{t}: el examen se corrió {len(vs)} vez; dos vueltas dicen si es repetible")
        r0 = [q["respuesta"] for q in vs[0]["respuestas"]]
        distintas = [q["id"] for q, r in zip(vs[1]["respuestas"], r0) if q["respuesta"] != r]
        exige(not distintas, f"{t}: el examen contestó distinto en las dos vueltas ({', '.join(distintas)}): con azar no se compara (temperatura 0 y semilla fija)")
        partes.append(f"{t} {ppl:.2f} ({ppl / f16 - 1:+.1%}), examen {vs[0]['aciertos']}/{vs[0]['total']}")
    q8 = c["cuantizaciones"]["Q8_0"]
    exige(q8["perplejidad"]["ppl"] <= f16 * 1.01, lambda: f"Q8_0 pierde {q8['perplejidad']['ppl'] / f16 - 1:+.1%} de perplejidad contra el f16: con 8 bits casi no debería perder")
    exige(q8["examen"][0]["aciertos"] >= q8["examen"][0]["total"] - 1, f"Q8_0 saca {q8['examen'][0]['aciertos']}/{q8['examen'][0]['total']} en el examen: ¿cómo se califica?")
    return " · ".join(partes)


def check_reporte() -> str:
    p = RESULTADOS / "reporte.md"
    exige(p.exists(), "no está resultados/reporte.md: python3 pipeline/reporte.py (paso 6)")
    exige(p.stat().st_mtime >= max((RESULTADOS / f).stat().st_mtime for f in ("velocidad.json", "calidad.json")), "reporte.md es más viejo que los resultados: python3 pipeline/reporte.py")
    texto = p.read_text()
    m, c = manifiesto(), calidad()
    f16 = c["f16"]["ppl"]
    buenas = [(m[t]["bytes"], t) for t in TIPOS
              if c["cuantizaciones"][t]["perplejidad"]["ppl"] / f16 - 1 <= 0.05
              and min(v["aciertos"] for v in c["cuantizaciones"][t]["examen"]) >= c["cuantizaciones"][t]["examen"][0]["total"] - 1]
    exige(all(f"| {t} |" in texto for t in TIPOS), "reporte.md no trae las tres cuantizaciones")
    dec = min(buenas)[1] if buenas else "ninguna"
    exige(f"**Decisión:** {dec}" in texto, f"con tus datos, la regla elige {dec}, y el reporte dice otra cosa")
    return f"reporte.md con las tres, lado a lado · decisión: {dec}"


CHECKS = {"mundo": check_mundo, "cuantizar": check_cuantizar, "comparable": check_comparable, "velocidad": check_velocidad, "calidad": check_calidad, "reporte": check_reporte}


def correr(ids: list[str], silencio: bool = False) -> dict[str, tuple[bool, str]]:
    out = {}
    for i in ids:
        try:
            ok, msg = True, CHECKS[i]()
        except Falla as e:
            ok, msg = False, str(e)
        except NotImplementedError as e:
            ok, msg = False, f"todavía es el esqueleto ({e})"
        except Exception as e:  # noqa: BLE001 — un error inesperado también es un check que no pasa
            ok, msg = False, f"{type(e).__name__}: {e}"
        out[i] = (ok, msg)
        if not silencio:
            print(f"{'✓' if ok else '✗'} {i:<10} {msg}", flush=True)
    return out


if __name__ == "__main__":
    pedidos = sys.argv[1:] or list(CHECKS)
    desconocidos = [p for p in pedidos if p not in CHECKS]
    if desconocidos:
        sys.exit(f"checks desconocidos: {desconocidos}. Hay: {', '.join(CHECKS)}")
    r = correr(pedidos)
    from taller.registro import anotar_verificacion  # la corrida queda en taller/progreso.json, para tu tablero

    anotar_verificacion({k: ok for k, (ok, _) in r.items()})
    malos = [k for k, (ok, _) in r.items() if not ok]
    print(f"\n{len(r) - len(malos)}/{len(r)} en verde" + (f" · falta: {', '.join(malos)}" if malos else ""))
    sys.exit(1 if malos else 0)
