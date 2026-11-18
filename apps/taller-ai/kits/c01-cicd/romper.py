"""Mete una falla en el mundo, la configuración o la infraestructura. Nunca toca lo que escribes (.github/workflows/,
ci/, infra/ecr-retencion.json ni .trivyignore.yaml).

    python romper.py                       # una falla al azar, escondida (ronda Romper solo)
    python romper.py --mostrar             # al azar, y dice cuál fue (ronda Romper con ayuda; lo lee Claude)
    python romper.py --mostrar --falla X   # una falla concreta
    python romper.py --verificar           # ¿ya quedó? corre verificar.py; si todo pasa, dice cuál era y restaura
    python romper.py --revelar             # me rindo: explica la falla y restaura
    python romper.py --restaurar           # deshace la falla activa y deja todo sano

Antes de romper, todo tiene que pasar verificar.py. La falla activa se guarda como un hash en .taller/:
ni tú ni Claude la pueden leer ahí.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import secrets
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mundo.comun import (CONFIANZA, DESPLIEGUE, FORJA_YAML, IMAGEN_GW, NUBE, ORIGEN, RAIZ, REPO_GW, REVISORA,  # noqa: E402
                         TALLER, escribir_json, leer_json, sh)

ESTADO = TALLER / "romper.json"
RESPALDO = TALLER / "respaldo"
PLATAFORMA = {"GIT_AUTHOR_NAME": "Equipo de plataforma", "GIT_AUTHOR_EMAIL": "plataforma@c01.test"}
NUBE_EQ = {"GIT_AUTHOR_NAME": "Equipo de nube", "GIT_AUTHOR_EMAIL": "nube@c01.test"}


def respaldar(e: dict, *rutas: Path) -> None:
    RESPALDO.mkdir(parents=True, exist_ok=True)
    e["respaldo"] = []
    for p in rutas:
        rel = str(p.relative_to(RAIZ))
        shutil.copy(p, RESPALDO / rel.replace("/", "__"))
        e["respaldo"].append(rel)


def devolver(e: dict) -> None:
    for rel in e.get("respaldo", []):
        shutil.copy(RESPALDO / rel.replace("/", "__"), RAIZ / rel)


def commit(archivo: str, msg: str, quien: dict) -> None:
    """Si el archivo quedó distinto del último commit, lo sube con ese mensaje (como alguien de otro equipo)."""
    if sh("git", "status", "--porcelain", "--", archivo).stdout.strip():
        sh("git", "commit", "-q", "-m", msg, "--", archivo, env=quien)


def forja(*a: str) -> str:
    r = sh(sys.executable, "mundo/forja.py", *a, timeout=900)
    return r.stdout + r.stderr


def ultima_corrida() -> str:
    return list(leer_json(RAIZ / ".forja" / "estado.json")["corridas"])[-1]


def cambio_en_main(rama: str, archivo: str, viejo: str, nuevo: str, titulo: str, quien: str) -> None:
    """Como otra persona: una rama desde main de la forja, un cambio, su PR y el merge (y aprueba producción si espera)."""
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        sh("git", "clone", "-q", str(ORIGEN), ".", cwd=d, check=True)
        sh("git", "switch", "-q", "-c", rama, cwd=d, check=True)
        p = d / archivo
        p.write_text(p.read_text().replace(viejo, nuevo))
        sh("git", "-c", f"user.name={quien}", "-c", f"user.email={quien}@c01.test", "commit", "-qam", titulo, cwd=d, check=True)
        sh("git", "push", "-q", "-f", "origin", rama, cwd=d, check=True)
    forja("pr", "abrir", rama, "--titulo", titulo, "--como", quien)
    n = max(int(k) for k in leer_json(RAIZ / ".forja" / "estado.json")["prs"])
    forja("pr", "merge", str(n), "--como", quien)
    c = leer_json(RAIZ / ".forja" / "estado.json")["corridas"][ultima_corrida()]
    if c["estado"] == "esperando":
        forja("aprobar", str(c["id"]), "--como", REVISORA)


# ---------------------------------------------------------------- las fallas
def check_fantasma(e: dict) -> None:
    respaldar(e, FORJA_YAML)
    FORJA_YAML.write_text(FORJA_YAML.read_text().replace("checks_obligatorios: [pruebas]", "checks_obligatorios: [test]"))
    commit("mundo/forja.yaml", "forja: el check obligatorio se llama test, como en la plantilla de la org", PLATAFORMA)


def check_bueno(e: dict) -> None:
    devolver(e)
    commit("mundo/forja.yaml", "forja: vuelve el check obligatorio revisado (pruebas)", PLATAFORMA)


def confianza_abierta(e: dict) -> None:
    respaldar(e, CONFIANZA)
    t = CONFIANZA.read_text()
    t = t.replace('"StringEquals": {\n                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",\n                "token.actions.githubusercontent.com:sub": "repo:dojo/classifier:ref:refs/heads/main"',
                  '"StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },\n              "StringLike": {\n                "token.actions.githubusercontent.com:sub": "repo:dojo/classifier:*"')
    CONFIANZA.write_text(t)
    commit("mundo/nube/confianza.json", "nube: el rol del CI acepta cualquier workflow del repo (para el nuevo job de previews)", NUBE_EQ)


def confianza_buena(e: dict) -> None:
    devolver(e)
    commit("mundo/nube/confianza.json", "nube: vuelve la trust policy revisada (solo main)", NUBE_EQ)


def tag_movible(e: dict) -> None:
    c = leer_json(NUBE / "ecr.json")
    c["repos"][REPO_GW]["inmutable"] = False
    escribir_json(NUBE / "ecr.json", c)


def tag_fijo(e: dict) -> None:
    c = leer_json(NUBE / "ecr.json")
    c["repos"][REPO_GW]["inmutable"] = True
    escribir_json(NUBE / "ecr.json", c)


def aviso_critico(e: dict) -> None:
    cambio_en_main("fijar-pyyaml", "gateway/requirements.txt", "pyyaml==6.0.3", "pyyaml==6.0.2",
                   "gateway: fijar pyyaml 6.0.2 (la 6.0.3 rompe mi notebook)", "beto")


def aviso_bueno(e: dict) -> None:
    cambio_en_main("pyyaml-603", "gateway/requirements.txt", "pyyaml==6.0.2", "pyyaml==6.0.3",
                   "gateway: vuelve pyyaml 6.0.3 (DOJO-2026-0107)", "beto")


def despliegue_por_tag(e: dict) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        sh("git", "clone", "-q", str(DESPLIEGUE), ".", cwd=d, check=True)
        p = d / "produccion" / "gateway.yaml"
        import re
        tag = sh("git", f"--git-dir={ORIGEN}", "rev-parse", "--short=7", "refs/heads/main").stdout.strip()
        p.write_text(re.sub(r"^imagen: .*$", f"imagen: {IMAGEN_GW}:{tag}   # más fácil de leer que un digest", p.read_text(), flags=re.M))
        sh("git", "-c", "user.name=plataforma", "-c", "user.email=plataforma@c01.test", "commit", "-qam",
           "produccion: la imagen por tag, que se lee mejor", cwd=d, check=True)
        sh("git", "push", "-q", "origin", "main", cwd=d)
        e["commit_despliegue"] = sh("git", "rev-parse", "HEAD", cwd=d).stdout.strip()


def despliegue_bueno(e: dict) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        sh("git", "clone", "-q", str(DESPLIEGUE), ".", cwd=d, check=True)
        if "@sha256:" not in (d / "produccion" / "gateway.yaml").read_text():
            sh("git", "-c", "user.name=plataforma", "-c", "user.email=plataforma@c01.test", "revert", "--no-edit",
               e["commit_despliegue"], cwd=d, check=True)
            sh("git", "push", "-q", "origin", "main", cwd=d)


def retencion_agresiva(e: dict) -> None:
    c = leer_json(NUBE / "ecr.json")
    e["retencion"] = c["repos"][REPO_GW]["retencion"]
    pol = json.loads(json.dumps(e["retencion"]))
    for r in pol["rules"]:
        if r["selection"].get("countType") == "imageCountMoreThan":
            r["selection"]["countNumber"] = 1
        elif r["selection"]["tagStatus"] != "untagged":
            r["selection"]["countNumber"] = 1
    c["repos"][REPO_GW]["retencion"] = pol
    escribir_json(NUBE / "ecr.json", c)


def retencion_buena(e: dict) -> None:
    c = leer_json(NUBE / "ecr.json")
    c["repos"][REPO_GW]["retencion"] = e["retencion"]
    escribir_json(NUBE / "ecr.json", c)


FALLAS = {
    "check-fantasma": dict(
        tipo="config", titulo="El check que nunca llega",
        historia="Tu siguiente PR tiene lint y pruebas en verde, pero la forja no lo deja juntar: «esperando el resultado de test». Nadie del equipo tiene un job que se llame test.",
        explica="El equipo de plataforma cambió mundo/forja.yaml directo en main (sin revisión): el check obligatorio ahora es «test», como en la plantilla de la org. Tu workflow nunca reporta un job con ese nombre, así que ningún PR se puede juntar: un check obligatorio que nadie produce se queda «esperando» para siempre, igual que con un filtro de carpetas. Arreglo: python verificar.py reglas, git log -p mundo/forja.yaml y git revert del commit. El nombre del check obligatorio y el del job tienen que ser el mismo, y cambian juntos.",
        aplicar=check_fantasma, deshacer=check_bueno),
    "confianza-abierta": dict(
        tipo="config", titulo="Previews para todos",
        historia="El equipo de nube avisa en el canal: «abrimos el rol del CI a todo el repositorio para un job de previews; ya no tienen que pedirnos nada». Todo sigue en verde.",
        explica="La trust policy del rol gha-classifier-gateway (mundo/nube/confianza.json) pasó de StringEquals sub = repo:dojo/classifier:ref:refs/heads/main a StringLike repo:dojo/classifier:*. Ahora un job de un PR, que corre código que nadie revisó, puede cambiar su token OIDC por credenciales que suben imágenes al ECR de producción. No falla nada: es un hueco. Arreglo: python verificar.py reglas, git log -p mundo/nube/confianza.json y git revert del commit. Si de verdad hace falta un job de previews, lleva su propio rol, con permisos sobre otro repositorio de ECR.",
        aplicar=confianza_abierta, deshacer=confianza_buena),
    "tag-movible": dict(
        tipo="infra", titulo="El Terraform viejo",
        historia="El equipo de nube corrió un Terraform de hace meses para arreglar otra cosa. Todo sigue funcionando.",
        explica="El repositorio classifier-gateway volvió a MUTABLE (tags que se pueden mover): así lo crea ECR si nadie dice otra cosa, y así decía el Terraform viejo. No se rompe nada hoy; el día que alguien haga rerun de un commit ya publicado, su tag pasa a apuntar a otra imagen (la reconstrucción casi nunca da los mismos bytes) y el nombre deja de decir la verdad. Producción no se entera porque despliega por digest, pero el tag ya no sirve para encontrar lo que corre. Arreglo: python verificar.py inmutable, python mundo/nube.py ecr describir classifier-gateway y python mundo/nube.py ecr configurar classifier-gateway --inmutable. En C01: image_tag_mutability = \"IMMUTABLE\" en el Terraform del repositorio.",
        aplicar=tag_movible, deshacer=tag_fijo),
    "aviso-critico": dict(
        tipo="mundo", titulo="La versión que funcionaba",
        historia="Beto juntó un PR chiquito: «gateway: fijar pyyaml 6.0.2 (la 6.0.3 rompe mi notebook)». Las pruebas pasaron. Ahora main está en rojo y producción no ha cambiado.",
        explica="pyyaml 6.0.2 tiene un aviso CRITICAL con parche (DOJO-2026-0107, de la base de ejemplo). El job imagen construyó, pasó el humo y se detuvo en el escaneo, ANTES del push: la imagen nunca llegó al ECR, staging y producción siguen con la anterior. Eso es el pipeline haciendo su trabajo. Arreglo: python mundo/forja.py corrida <id> --job imagen para leer el hallazgo, una rama que regrese pyyaml==6.0.3, su PR, el merge y la aprobación de producción. Lo que no se hace: una excepción en .trivyignore.yaml para un aviso que sí aplica y sí tiene parche.",
        aplicar=aviso_critico, deshacer=aviso_bueno),
    "despliegue-por-tag": dict(
        tipo="config", titulo="Más fácil de leer",
        historia="Alguien de plataforma cambió el repositorio de despliegue: «produccion por tag, que se lee mejor que un sha256 de 64 letras». El canal dice que producción «no tomó el cambio».",
        explica="produccion/gateway.yaml del repositorio de despliegue pide la imagen por tag (…:<commit>). La política de admisión la rechaza (un tag se puede mover; un digest no) y producción sigue con la imagen anterior: el repositorio pide una cosa y corre otra (en Argo CD: OutOfSync). Arreglo: python mundo/gitops.py estado, git clone .forja/despliegue.git, git log -p produccion/gateway.yaml, git revert del commit y git push (el hook vuelve a aplicar). Para leerlo, el comentario con el commit al lado del digest basta.",
        aplicar=despliegue_por_tag, deshacer=despliegue_bueno),
    "retencion-agresiva": dict(
        tipo="infra", titulo="Ahorrar en el registro",
        historia="El equipo de nube vio la factura de ECR y, desde la consola, recortó la regla de retención de classifier-gateway: «con la última imagen basta, lo demás es basura». Todavía no ha corrido.",
        explica="La regla aplicada en ECR ya no es la de infra/ecr-retencion.json: guarda una sola imagen con tag. En cuanto ECR la aplique (dentro de las 24 h siguientes) borraría la imagen anterior de producción, que es la del rollback: volver atrás dejaría de ser un cambio de digest de segundos y pasaría a ser reconstruir un commit viejo (otro digest, sin probar). ECR no sabe qué corre en el clúster; la regla tiene que dejar margen. Arreglo: python verificar.py retencion, python mundo/nube.py ecr describir classifier-gateway, python mundo/nube.py ecr retencion classifier-gateway --vista-previa y volver a aplicar la tuya: python mundo/nube.py ecr politica-retencion classifier-gateway infra/ecr-retencion.json. La regla vive en git, y el cambio desde la consola se pierde con el siguiente apply.",
        aplicar=retencion_agresiva, deshacer=retencion_buena),
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
    if leer_json(ESTADO):
        sys.exit("✗ ya hay una falla activa: python romper.py --verificar (o --restaurar)")
    print("  revisando que todo esté sano (≈ 10 s)…")
    malos = verificar()
    if malos:
        sys.exit(f"✗ antes de romper, todo tiene que pasar verificar.py (falla: {', '.join(malos)})")
    if cual and cual not in FALLAS:
        sys.exit(f"✗ no existe la falla «{cual}». Hay: {', '.join(FALLAS)}")
    falla = cual or secrets.choice(list(FALLAS))
    e = {"sal": secrets.token_hex(8), "inicio": datetime.now(timezone.utc).isoformat(), "mostrada": mostrar}
    e["hash"] = h(e["sal"], falla)
    f = FALLAS[falla]
    f["aplicar"](e)
    escribir_json(ESTADO, e)
    if mostrar:
        print(f"\n[solo para Claude] falla: {falla} · tipo: {f['tipo']} · {f['titulo']}\n  {f['explica']}\n")
    print(f"⚠ Historia: {f['historia']}")
    print(f"\nEmpezó: {datetime.now():%H:%M}. Tu turno: python verificar.py, y a diagnosticar.")


def cerrar(e: dict, falla: str, como: str) -> None:
    f = FALLAS[falla]
    if como != "Restaurada":
        from taller.registro import anotar_falla

        anotar_falla(falla, e["inicio"], e.get("mostrada", False), rendido=como == "Revelada")
    minutos = (datetime.now(timezone.utc) - datetime.fromisoformat(e["inicio"])).total_seconds() / 60
    print(f"{como}: era «{falla}» · {f['titulo']} · {minutos:.0f} min\n  {f['explica']}")
    if como != "✓ arreglado":
        print("  restaurando…")
        f["deshacer"](e)
    ESTADO.unlink()
    shutil.rmtree(RESPALDO, ignore_errors=True)
    malos = verificar()
    print("✓ listo para otra falla" if not malos else f"⚠ falla: {', '.join(malos)} (corre verificar.py)")


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
        print()
        return cerrar(e, falla, "✓ arreglado")
    cerrar(e, falla, "Revelada" if a.revelar else "Restaurada")


if __name__ == "__main__":
    main()
