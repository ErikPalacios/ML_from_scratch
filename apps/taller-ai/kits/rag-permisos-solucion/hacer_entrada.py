"""Escribe la entrada del kit de la estación 3 (kits/rag-permisos/mundo/entrada/): lo que deja la estación 2 el día 2
(los chunks de cada documento, corriendo de verdad su kit con su solución), el directorio de la empresa y la cola de
cambios de permisos de la mañana del 21 de noviembre.

    bash ../rag-chunking-solucion/probar.sh /ruta/e2      # una vez: deja /ruta/e2 con su .venv
    python3 hacer_entrada.py /ruta/e2

Hace, en /ruta/e2: copia la solución de la estación 2, vuelve a crear su mundo, chunkea el día 1, avanza al día 2 y
chunkea otra vez. Copia chunks/docs/ a entrada/docs/ y le suma a cada documento «acl_leida»: cuándo leyó su ACL la
ingestión de la estación 1 (el «ingerido» de su catálogo). El directorio y los eventos son ficticios y están aquí.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
E2S = AQUI.parent / "rag-chunking-solucion"
SALIDA = AQUI.parent / "rag-permisos" / "mundo" / "entrada"
D = "marketplace.test"
EXT = "paqueteria-aliada.test"
u = lambda x, dom=D: f"user:{x}@{dom}"  # noqa: E731
g = lambda x: f"group:{x}@{D}"  # noqa: E731

PERSONAS = {
    f"ana.ruiz@{D}": ("Ana Ruiz", "Soporte"),
    f"elena.cruz@{D}": ("Elena Cruz", "Soporte"),
    f"marco.diaz@{D}": ("Marco Díaz", "Soporte"),
    f"tomas.rey@{D}": ("Tomás Rey", "Soporte (antes Fraude)"),
    f"paula.vega@{D}": ("Paula Vega", "Líder de soporte"),
    f"luis.campos@{EXT}": ("Luis Campos", "Soporte, externo de la paquetería aliada"),
    f"diego.luna@{D}": ("Diego Luna", "Recién contratado, todavía sin equipo"),
    f"jorge.paz@{D}": ("Jorge Paz", "Operaciones"),
    f"hugo.salas@{D}": ("Hugo Salas", "Operaciones"),
    f"sofia.leal@{D}": ("Sofía Leal", "Líder de operaciones"),
    f"carmen.nava@{D}": ("Carmen Nava", "Finanzas"),
    f"raul.ortiz@{D}": ("Raúl Ortiz", "Fraude"),
    f"lucia.mora@{D}": ("Lucía Mora", "Recursos humanos"),
    f"irene.sol@{D}": ("Irene Sol", "Legal, litigios"),
}
GRUPOS = {
    g("soporte"): ("Soporte (todo el equipo)", [g("soporte-nivel1"), g("soporte-lideres")]),
    g("soporte-nivel1"): ("Soporte nivel 1", [u("ana.ruiz"), u("elena.cruz"), u("marco.diaz"), u("tomas.rey"), u("luis.campos", EXT)]),
    g("soporte-lideres"): ("Líderes de soporte", [u("paula.vega")]),
    g("operaciones"): ("Operaciones", [g("operaciones-lideres"), u("jorge.paz"), u("hugo.salas")]),
    g("operaciones-lideres"): ("Líderes de operaciones", [u("sofia.leal")]),
    g("fraude"): ("Fraude", [g("fraude-analistas"), u("tomas.rey")]),
    g("fraude-analistas"): ("Analistas de fraude", [u("raul.ortiz")]),
    g("finanzas"): ("Finanzas", [u("carmen.nava")]),
    g("rh"): ("Recursos humanos", [u("lucia.mora")]),
    g("legal"): ("Legal", [g("legal-litigios")]),
    g("legal-litigios"): ("Legal · litigios", [u("irene.sol")]),
    # un ciclo de verdad: alguien metió el boletín dentro del comité y el comité dentro del boletín
    g("comite-calidad"): ("Comité de calidad", [g("soporte-lideres"), g("operaciones-lideres"), g("boletin-calidad")]),
    g("boletin-calidad"): ("Boletín de calidad", [g("comite-calidad"), u("carmen.nava")]),
}
# la mañana del 21 de noviembre (UTC; 15:00 es 9:00 en Ciudad de México). Cada fuente avisa con un webhook.
EVENTOS = [
    {"ocurrio": "2026-11-21T15:07:20Z", "fuente": "drive", "tipo": "acl", "doc_id": "drive:d21", "acl": [[g("operaciones-lideres"), u("jorge.paz")]],
     "que": "Jorge deja las «Tarifas de envío» solo para líderes de operaciones: traen las tarifas negociadas"},
    {"ocurrio": "2026-11-21T15:18:40Z", "fuente": "directorio", "tipo": "membresia", "grupo": g("fraude"), "miembro": u("tomas.rey"), "accion": "quitar",
     "que": "Tomás pasó de fraude a soporte: sale del grupo de fraude"},
    {"ocurrio": "2026-11-21T15:25:00Z", "fuente": "directorio", "tipo": "membresia", "grupo": g("soporte-nivel1"), "miembro": u("diego.luna"), "accion": "agregar",
     "que": "Diego entra a soporte nivel 1"},
    {"ocurrio": "2026-11-21T15:31:10Z", "fuente": "jira", "tipo": "acl", "doc_id": "jira:SOP-14",
     "acl": [[g("operaciones"), g("soporte"), u("tomas.rey")], [g("soporte-lideres")]],
     "que": "El ticket SOP-14 pasa al nivel de seguridad «Solo líderes»: el cliente mandó una identificación"},
    {"ocurrio": "2026-11-21T15:44:30Z", "fuente": "wiki", "tipo": "acl", "doc_id": "wiki:2002", "acl": [[g("operaciones")], [g("operaciones-lideres")]],
     "que": "La página «Comisiones por categoría» queda restringida a líderes de operaciones mientras se negocian las nuevas"},
    {"ocurrio": "2026-11-21T15:52:00Z", "fuente": "directorio", "tipo": "membresia", "grupo": g("soporte-nivel1"), "miembro": u("luis.campos", EXT), "accion": "quitar",
     "que": "Terminó el contrato de Luis, de la paquetería aliada: sale de soporte nivel 1"},
]


def corre(d: Path, *a: str) -> None:
    r = subprocess.run([str(d / ".venv/bin/python"), *a], cwd=d, capture_output=True, text=True)
    print(f"  {' '.join(a)} → {r.returncode}")
    if r.returncode != 0:
        sys.exit(r.stdout + r.stderr)


def main() -> None:
    d = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("uso: python3 hacer_entrada.py /ruta/e2 (la carpeta de probar.sh de la estación 2)")
    for f in (E2S / "pipeline").glob("*.py"):
        shutil.copy(f, d / "pipeline" / f.name)
    shutil.copy(d / "mundo/esqueleto/config.yaml", d / "config.yaml")
    shutil.rmtree(d / "chunks", ignore_errors=True)
    corre(d, "mundo/crear.py")
    corre(d, "pipeline/chunkear.py")
    corre(d, "mundo/avanzar.py")
    corre(d, "pipeline/chunkear.py")
    cat = json.loads((d / "almacen/catalogo.json").read_text())
    shutil.rmtree(SALIDA, ignore_errors=True)
    (SALIDA / "docs").mkdir(parents=True)
    n = 0
    for p in sorted((d / "chunks/docs").glob("*.json")):
        x = json.loads(p.read_text())
        x["acl_leida"] = cat[x["doc_id"]]["ingerido"]
        n += len(x["chunks"])
        (SALIDA / "docs" / p.name).write_text(json.dumps(x, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    directorio = {"dominio": D, "foto": "2026-11-21T15:00:00Z",
                  "personas": {c: {"nombre": nm, "area": a} for c, (nm, a) in PERSONAS.items()},
                  "grupos": {k: {"nombre": nm, "miembros": sorted(m)} for k, (nm, m) in GRUPOS.items()}}
    (SALIDA / "directorio.json").write_text(json.dumps(directorio, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    eventos = [{"n": i + 1, **e} for i, e in enumerate(EVENTOS)]
    (SALIDA / "eventos.json").write_text(json.dumps(eventos, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(list((SALIDA / 'docs').glob('*.json')))} documentos · {n} chunks · {len(PERSONAS)} personas · {len(GRUPOS)} grupos · {len(EVENTOS)} eventos → {SALIDA}")


if __name__ == "__main__":
    main()
