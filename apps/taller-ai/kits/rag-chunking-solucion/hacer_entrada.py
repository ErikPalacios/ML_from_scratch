"""Escribe la entrada del kit de la estación 2 (kits/rag-chunking/mundo/entrada/): lo que deja la estación 1 el día 1
y el día 2, corriendo de verdad el kit de la estación 1 con su solución, más los tres documentos largos de largos.py.

    python3 hacer_entrada.py            # necesita el .venv de la estación 1 (bash ../rag-ingesta-solucion/probar.sh /ruta)

Hace, en una carpeta temporal: crear el mundo, arrancar las fuentes, ingerir (foto del día 1), avanzar un día,
ingerir y barrer (foto del día 2). Las fotos van a entrada/dia1.json y dia2.json (el catálogo y el reloj) y los
textos a entrada/texto/<hash>.json, la unión de los dos días.
"""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

AQUI = Path(__file__).resolve().parent
E1 = AQUI.parent / "rag-ingesta"
E1S = AQUI.parent / "rag-ingesta-solucion"
SALIDA = AQUI.parent / "rag-chunking" / "mundo" / "entrada"
sys.path.insert(0, str(AQUI))
from largos import LARGOS  # noqa: E402


def corre(d: Path, *a: str) -> None:
    r = subprocess.run([str(d / ".venv/bin/python"), *a], cwd=d, capture_output=True, text=True)
    print(f"  {' '.join(a)} → {r.returncode}")
    if r.returncode not in (0, 1):
        sys.exit(r.stdout + r.stderr)


def foto(d: Path) -> tuple[dict, dict]:
    c = json.loads((d / "almacen/catalogo.json").read_text())
    textos = {p.stem: json.loads(p.read_text()) for p in (d / "almacen/texto").glob("*.json")}
    reloj = json.loads((d / "fuentes/estado.json").read_text())["reloj"]
    return {"reloj": reloj, "catalogo": c}, textos


def sumar_largos(f: dict, textos: dict, dia: int) -> None:
    for doc_id, titulo, tipo, url, actualizado, acl, t1, t2 in LARGOS:
        t = (t1 if dia == 1 else t2).strip()
        h = hashlib.sha256(t.encode()).hexdigest()    # el crudo de un markdown son sus bytes; aquí ya viene limpio
        textos[h] = {"hash_crudo": h, "parser": "v1", "texto": t, "sha256_texto": hashlib.sha256(t.encode()).hexdigest(), "necesita_ocr": False}
        cambio = t2 != t1 and dia == 2
        f["catalogo"][doc_id] = {"fuente": doc_id.split(":")[0], "version": "2" if cambio else "1",
                                 "actualizado": "2026-11-21T14:50:00Z" if cambio else actualizado, "titulo": titulo, "url": url,
                                 "tipo": tipo, "hash": h, "acl": acl, "necesita_ocr": False, "borrado": False,
                                 "ingerido": "2026-11-21T15:05:00Z" if dia == 2 else "2026-11-20T15:05:00Z"}


def main() -> None:
    venv = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "e1"
        shutil.copytree(E1, d, ignore=shutil.ignore_patterns(".venv", "fuentes", "almacen", ".taller", "__pycache__"))
        shutil.copytree(E1S / "pipeline", d / "pipeline", dirs_exist_ok=True)
        shutil.copy(E1 / "mundo/esqueleto/config.yaml", d / "config.yaml")
        (d / ".venv").symlink_to(venv or (E1S.parent / "rag-ingesta" / ".venv"))
        corre(d, "mundo/crear.py")
        corre(d, "mundo/fuentes.py", "arrancar")
        try:
            corre(d, "pipeline/ingestar.py")
            f1, t1 = foto(d)
            corre(d, "mundo/avanzar.py")
            corre(d, "pipeline/ingestar.py")
            corre(d, "pipeline/ingestar.py", "--barrido")
            f2, t2 = foto(d)
        finally:
            corre(d, "mundo/fuentes.py", "parar")
    sumar_largos(f1, t1, 1)
    sumar_largos(f2, t2, 2)
    # «ingerido» lleva la hora real de la corrida: se fija para que la entrada sea siempre la misma
    for f, hora in ((f1, "2026-11-20T15:05:00Z"), (f2, "2026-11-21T15:05:00Z")):
        for r in f["catalogo"].values():
            r["ingerido"] = hora if r["ingerido"] > "2026-11-24" else r["ingerido"]
            if r.get("borrado_en"):
                r["borrado_en"] = "2026-11-21T15:06:00Z"
    shutil.rmtree(SALIDA, ignore_errors=True)
    (SALIDA / "texto").mkdir(parents=True)
    for n, f in (("dia1", f1), ("dia2", f2)):
        (SALIDA / f"{n}.json").write_text(json.dumps(f, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    vivos = {r["hash"] for f in (f1, f2) for r in f["catalogo"].values()}
    for h, t in (t1 | t2).items():
        if h in vivos:
            (SALIDA / "texto" / f"{h}.json").write_text(json.dumps(t, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    for n, f in (("día 1", f1), ("día 2", f2)):
        c = f["catalogo"]
        print(f"{n}: {sum(not r['borrado'] for r in c.values())} vivos, {sum(r['borrado'] for r in c.values())} lápidas")
    print(f"{len(list((SALIDA / 'texto').glob('*.json')))} textos en {SALIDA}")


if __name__ == "__main__":
    main()
