"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca tu código de pipeline/.

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja el mundo sano

Antes de romper, tu pipeline tiene que pasar verificar.py completo. Cuando la falla cambia el mundo o la
configuración, romper.py corre el job del mes (mundo/correr.py), como si hubiera corrido anoche con el problema.
La falla activa se guarda como un hash en .taller/: ni tú ni Claude la pueden leer ahí.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import DATA, RAIZ, TALLER, config, guardar_config, leer_json, escribir_json, s3  # noqa: E402

ESTADO = TALLER / "romper.json"


# ---------------------------------------------------------------- las fallas
def mundo(falla: str | None, fotos: bool = False) -> None:
    cmd = [sys.executable, str(RAIZ / "mundo" / "simular.py")] + (["--falla", falla] if falla else [])
    subprocess.run(cmd + ([] if fotos else ["--sin-fotos"]), check=True, cwd=RAIZ, stdout=subprocess.DEVNULL)


def config_set(ruta: str, valor, estado: dict) -> None:
    c = config()
    a, b = ruta.split(".")
    estado.setdefault("config_original", {})[ruta] = c[a][b]
    c[a][b] = valor
    guardar_config(c)


def config_restaurar(estado: dict) -> None:
    c = config()
    for ruta, valor in estado.get("config_original", {}).items():
        a, b = ruta.split(".")
        c[a][b] = valor
    guardar_config(c)


def export_a_json_completo(estado: dict) -> None:
    p = DATA / "etiquetado" / "adjudicacion-export.json"
    original = p.read_text()
    estado["respaldo_export"] = original
    completo = [{
        "id": f["id"], "project": 1, "data": {k: f[k] for k in ("image", "request_id", "anotador_a", "anotador_b", "guia_version") if k in f},
        "annotations": [{"id": f["annotation_id"], "completed_by": f.get("annotator", 1), "lead_time": f.get("lead_time"),
                         "created_at": f["created_at"], "updated_at": f["updated_at"],
                         "result": [{"from_name": "categoria", "to_name": "imagen", "type": "choices", "origin": "manual",
                                     "value": {"choices": [f["categoria"]]}}]}],
        "predictions": [], "drafts": [], "meta": {}, "created_at": f["created_at"], "updated_at": f["updated_at"],
    } for f in json.loads(original)]
    p.write_text(json.dumps(completo, ensure_ascii=False, indent=1))


def exif_de_vuelta(estado: dict) -> None:
    import pandas as pd

    cli, B = s3(), config()["s3"]["bucket_restringido"]
    cola = pd.read_parquet(DATA / "pipeline" / "cola.parquet").sample(40, random_state=secrets.randbelow(10**6))
    for f in cola.itertuples():
        orig = cli.get_object(Bucket="producto-fotos", Key=f.foto_key)["Body"].read()
        cli.put_object(Bucket=B, Key=f"cola/{f.request_id}.jpg", Body=orig, ContentType="image/jpeg",
                       Metadata={"request-id": f.request_id, "copiado-por": "copiar_v0.sh"})


def exif_limpiar(estado: dict) -> None:
    from PIL import Image, ImageOps

    cli, B = s3(), config()["s3"]["bucket_restringido"]
    for p in cli.get_paginator("list_objects_v2").paginate(Bucket=B, Prefix="cola/"):
        for o in p.get("Contents", []):
            im = Image.open(io.BytesIO(cli.get_object(Bucket=B, Key=o["Key"])["Body"].read()))
            if len(im.getexif()) or "exif" in im.info:
                im = ImageOps.exif_transpose(im)
                out = io.BytesIO()
                Image.frombytes(im.mode, im.size, im.tobytes()).save(out, "JPEG", quality=92)
                cli.put_object(Bucket=B, Key=o["Key"], Body=out.getvalue(), ContentType="image/jpeg")


def bucket_publico(estado: dict) -> None:
    cli, B = s3(), config()["s3"]["bucket_restringido"]
    cli.delete_public_access_block(Bucket=B)
    cli.put_bucket_policy(Bucket=B, Policy=json.dumps({"Version": "2012-10-17", "Statement": [{
        "Sid": "demo-proveedor", "Effect": "Allow", "Principal": "*", "Action": ["s3:GetObject"],
        "Resource": [f"arn:aws:s3:::{B}/*"]}]}))
    cli.delete_bucket_lifecycle(Bucket=B)


def bucket_sano() -> None:
    c = config()["s3"]
    cli, B = s3(), c["bucket_restringido"]
    try:
        cli.delete_bucket_policy(Bucket=B)
    except Exception:
        pass
    cli.put_public_access_block(Bucket=B, PublicAccessBlockConfiguration={
        "BlockPublicAcls": True, "IgnorePublicAcls": True, "BlockPublicPolicy": True, "RestrictPublicBuckets": True})
    cli.put_bucket_lifecycle_configuration(Bucket=B, LifecycleConfiguration={"Rules": [{
        "ID": "cola-vence", "Status": "Enabled", "Filter": {"Prefix": "cola/"}, "Expiration": {"Days": c["dias_vencimiento"]}}]})


# tipo · historia (lo que «notó alguien») · cómo se mete · cómo se deshace · desde qué paso corre el job (None = no corre)
FALLAS = {
    "feedback-loop": dict(
        tipo="mundo", titulo="La sugerencia viene preseleccionada",
        historia="Producto lanzó a mediados de septiembre un rediseño del formulario de publicación. Este mes la exactitud offline del modelo subió y todos celebran, pero la tasa de aceptación en producción no se movió.",
        explica="Desde el 16 de septiembre la sugerencia viene preseleccionada y casi todos la aceptan aunque esté mal: la «categoría elegida» se volvió una copia del modelo. Las sugerencias aceptadas de esas fechas son labels contaminados. Se detecta comparando contra el holdout y el golden (no suben) y viendo la tasa de aceptación por día. Arreglo: no usar las sugerencias aceptadas desde el cambio (debil.excluir_sugerencias_desde) y avisar a producto.",
        aplicar=lambda e: mundo("feedback-loop"), deshacer=lambda e: mundo(None), job=1),
    "llave-cambiada": dict(
        tipo="mundo", titulo="El request_id cambió de formato",
        historia="El equipo del gateway desplegó una versión nueva a mediados de octubre. Nadie avisó de nada raro, pero este mes hay menos labels nuevos que de costumbre.",
        explica="Desde el 21 de octubre el gateway escribe el request_id en mayúsculas (R-…) y publicaciones lo sigue escribiendo en minúsculas. El JOIN interno descarta esas filas sin error: perder datos en silencio. Arreglo: normalizar la llave (lower) y vigilar la tasa de unión.",
        aplicar=lambda e: mundo("llave-cambiada"), deshacer=lambda e: mundo(None), job=1),
    "zona-horaria": dict(
        tipo="mundo", titulo="Hora local sin zona",
        historia="El equipo de producto migró el export de publicaciones a un sistema nuevo. El job del mes corrió, pero los números de labels débiles no cuadran con la auditoría.",
        explica="publicaciones.ts_publicacion ahora viene como hora local de la Ciudad de México sin zona (TIMESTAMP, no TIMESTAMPTZ). Con la sesión en UTC se lee 6 horas corrida y la ventana de 30 días mete o saca anuncios en el borde. Arreglo: interpretar esa columna como America/Mexico_City y convertirla a UTC antes de comparar.",
        aplicar=lambda e: mundo("zona-horaria"), deshacer=lambda e: mundo(None), job=1),
    "categoria-nueva": dict(
        tipo="mundo", titulo="La categoría nueva no se puede elegir",
        historia="Negocio agregó «bolsas» al árbol de categorías en octubre y pregunta por qué el modelo todavía no las sugiere.",
        explica="Ni el buscador del formulario ni la herramienta de moderación ofrecen todavía «bolsas»: quien vende una bolsa se queda con la sugerencia (otra categoría) y nadie la corrige. No hay ni un label 8, así que la regla «categoria_final en nuevas.clases» no encuentra nada. Arreglo: sembrar la categoría por texto del título (bolsa, bolso, mochila) para la cola.",
        aplicar=lambda e: mundo("categoria-nueva"), deshacer=lambda e: mundo(None), job=1),
    "golden-filtrado": dict(
        tipo="mundo", titulo="Fotos del golden set en el tráfico",
        historia="Alguien de QA usó fotos de prueba para un test de carga en producción a mediados de octubre. El job del mes corrió con normalidad… o eso parece.",
        explica="300 fotos del golden set entraron al tráfico real y algunas cayeron en la cola. Si se etiquetan y se entrenan, el golden deja de medir (fuga). Se detecta cruzando hashes de contenido contra el manifest. Arreglo: excluir por img_sha256 los del golden al armar la cola.",
        aplicar=lambda e: mundo("golden-filtrado", fotos=True), deshacer=lambda e: mundo(None, fotos=True), job=1),
    "sin-aleatoria": dict(
        tipo="config", titulo="Se recortó la muestra aleatoria",
        historia="Para ahorrar presupuesto de etiquetado, alguien del equipo «optimizó» la cola de este mes. Ahora la exactitud medida en los labels nuevos se ve muy baja y preocupa a todos.",
        explica="cola.frac_aleatoria se puso en 0: la cola solo trae casos difíciles elegidos a propósito, así que medir ahí da números pesimistas y sesgados. Arreglo: regresar al 20–30 % al azar.",
        aplicar=lambda e: config_set("cola.frac_aleatoria", 0.0, e), deshacer=config_restaurar, job=3),
    "guia-ambigua": dict(
        tipo="config", titulo="El proveedor recibió la guía vieja",
        historia="El proveedor de etiquetado cambió de equipo este mes. Los labels llegaron a tiempo, pero algo en el acuerdo se ve raro.",
        explica="etiquetado.guia_version regresó a guia-v1: el proveedor etiquetó con la guía que no define «bolsas» ni los casos límite, y el kappa se cae en camisas, playeras, suéteres, abrigos y bolsas. Arreglo: mandar la guía vigente y reetiquetar.",
        aplicar=lambda e: config_set("etiquetado.guia_version", "guia-v1", e), deshacer=config_restaurar, job=5),
    "export-esquema": dict(
        tipo="entorno", titulo="El export de Label Studio cambió de formato",
        historia="Alguien re-exportó la adjudicación desde Label Studio para revisarla y la dejó en su lugar. El cierre del mes ya no termina.",
        explica="El archivo quedó en formato JSON (completo) en vez de JSON_MIN: la categoría ya no está en f['categoria'] sino en annotations[0].result[0].value.choices[0]. Arreglo: volver a exportar en JSON_MIN, o leer los dos formatos y fallar con un mensaje claro.",
        aplicar=export_a_json_completo, deshacer=lambda e: (DATA / "etiquetado" / "adjudicacion-export.json").write_text(e["respaldo_export"]), job=7),
    "exif-de-vuelta": dict(
        tipo="infra", titulo="Fotos con EXIF en el bucket restringido",
        historia="Un compañero corrió «rápido» un script viejo para recuperar unas fotos que faltaban en el bucket restringido.",
        explica="copiar_v0.sh copió 40 fotos originales, con EXIF y GPS, al bucket restringido. Se detecta revisando los metadatos de cada objeto (y el metadato copiado-por). Arreglo: volver a copiar esas fotos limpias (o correr el paso 4) y no dejar scripts que se salten el pipeline.",
        aplicar=exif_de_vuelta, deshacer=exif_limpiar, job=None),
    "bucket-publico": dict(
        tipo="infra", titulo="El bucket restringido quedó público",
        historia="Para una demo con el proveedor, alguien «abrió un momento» el bucket restringido. La demo fue hace una semana.",
        explica="Se quitó el bloqueo de acceso público, se puso una política con Principal: * y se borró la regla de vencimiento. Cualquiera con la URL baja las fotos. Arreglo: borrar la política, poner el bloqueo completo y la regla de 90 días.",
        aplicar=bucket_publico, deshacer=lambda e: bucket_sano(), job=None),
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


def job(desde: int | None) -> None:
    if desde is None:
        print("  (esta falla no necesita correr el job: ya está ahí)")
        return
    from mundo.correr import correr

    ok, msg = correr(desde, silencio=True)
    print(f"  el job del mes corrió anoche desde el paso {desde}: {msg}")


def romper(mostrar: bool, cual: str | None) -> None:
    e = leer_json(ESTADO)
    if e:
        sys.exit("✗ ya hay una falla activa: python romper.py --verificar (o --restaurar)")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, tu pipeline tiene que pasar verificar.py completo (falla: {', '.join(malos)})")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    c = config()
    if c["etiquetado"]["adjudicacion"] != "experto_simulado":
        c["etiquetado"]["adjudicacion"] = "experto_simulado"
        guardar_config(c)
        print("  (en las rondas de romper adjudica el experto simulado: config etiquetado.adjudicacion = experto_simulado)")
    f = FALLAS[falla]
    f["aplicar"](e)
    escribir_json(ESTADO, e)
    if mostrar:
        print(f"\n[solo para Claude] falla: {falla} · tipo: {f['tipo']} · {f['titulo']}\n  {f['explica']}\n")
    print(f"⚠ Historia: {f['historia']}")
    job(f["job"])
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python verificar.py, y a diagnosticar.")


def cerrar(e: dict, falla: str, como: str) -> None:
    f = FALLAS[falla]
    minutos = (datetime.now(timezone.utc) - datetime.fromisoformat(e["inicio"])).total_seconds() / 60
    print(f"{como}: era «{falla}» · {f['titulo']} · {minutos:.0f} min\n  {f['explica']}")
    print("  restaurando el mundo sano…")
    f["deshacer"](e)
    ESTADO.unlink()
    if f["job"] is not None:
        job(1 if f["tipo"] == "mundo" else f["job"])
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
    e = leer_json(ESTADO)
    if not (a.verificar or a.revelar or a.restaurar):
        return romper(a.mostrar, a.falla)
    falla = activa(e)
    if not falla:
        sys.exit("No hay ninguna falla activa.")
    if a.verificar:
        malos = verificar(silencio=False)
        if malos:
            sys.exit(f"\n✗ todavía no: {len(malos)} check(s) sin pasar")
        return cerrar(e, falla, "✓ arreglado")
    cerrar(e, falla, "Revelada" if a.revelar else "Restaurada")


if __name__ == "__main__":
    main()
