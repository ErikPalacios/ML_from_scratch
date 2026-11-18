"""El GitOps del dojo: hace que lo que corre sea lo que dice el repositorio de despliegue. Se usa; no se toca.

    python mundo/gitops.py estado          # qué pide cada ambiente, qué corre y si coinciden
    python mundo/gitops.py sincronizar     # baja la imagen que pide cada ambiente y la pone a correr

El repositorio de despliegue (.forja/despliegue.git, aparte de classifier) tiene un archivo por ambiente:
staging/gateway.yaml y produccion/gateway.yaml, con la imagen (por digest) y la configuración del ambiente. Cada push a
su main dispara `sincronizar` (un hook de git): es lo que hace Argo CD en C01, que mira el repositorio y aplica lo que
cambió. Para clonarlo: git clone .forja/despliegue.git

La política de admisión del dojo (en C01, la del clúster) rechaza una imagen que no venga del ECR del proyecto o que no
esté fijada por digest (…@sha256:…): un tag se puede mover; un digest, no. Los nodos bajan la imagen con su propio rol
(nodos-classifier: solo bajar). Cada ambiente es un contenedor en la red del mundo: staging en localhost:8801,
producción en localhost:8802, los dos hablando con el mismo Triton (triton:8000).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import (AMBIENTES, IMAGEN_GW, PROYECTO, RED, REGISTRO, corto, docker, docker_env, es_digest,  # noqa: E402
                         esperar, leer_despliegue, sh)


def corriendo(ambiente: str) -> dict:
    r = docker("inspect", "--format", "{{.Config.Image}}|{{.State.Status}}|{{.Image}}", f"{PROYECTO}-gw-{ambiente}")
    if r.returncode != 0:
        return {}
    img, st, local = r.stdout.strip().split("|")
    return {"imagen": img, "estado": st, "id_local": local}


def admitir(img: str) -> str | None:
    if not img.startswith(IMAGEN_GW + "@"):
        return f"la imagen no viene del ECR del proyecto ({IMAGEN_GW})"
    if not es_digest(img):
        return "la imagen no está fijada por digest (…@sha256:<64 hex>): un tag se puede mover"
    return None


def login_nodos() -> bool:
    from mundo.nube import token_interno
    r = sh("docker", "login", "--username", "AWS", "--password-stdin", REGISTRO,
           entrada=token_interno("nodos-classifier", 3600), env=docker_env())
    return r.returncode == 0


def sincronizar(solo: str | None = None) -> bool:
    bien = True
    login_hecho = False
    for amb, puerto in AMBIENTES.items():
        if solo and amb != solo:
            continue
        pide = leer_despliegue(amb)
        img = pide.get("imagen", "")
        ahora = corriendo(amb)
        if ahora.get("imagen") == img and ahora.get("estado") == "running":
            print(f"  {amb}: sin cambios ({corto(img)})")
            continue
        motivo = admitir(img)
        if motivo:
            print(f"  ✗ {amb}: admisión rechazada: {motivo}. Sigue corriendo {corto(ahora.get('imagen', ''))}")
            bien = False
            continue
        if not login_hecho:
            login_hecho = login_nodos()
        r = docker("pull", "-q", img, timeout=600)
        if r.returncode != 0:
            print(f"  ✗ {amb}: no pude bajar {corto(img)}: {(r.stderr or r.stdout).strip().splitlines()[-1]}. "
                  f"Sigue corriendo {corto(ahora.get('imagen', ''))}")
            bien = False
            continue
        nombre = f"{PROYECTO}-gw-{amb}"
        docker("rm", "-f", f"{nombre}-nuevo")
        env = [x for k, v in (pide.get("env") or {}).items() for x in ("-e", f"{k}={v}")]
        r = docker("run", "-d", "--name", f"{nombre}-nuevo", "--network", RED, *env, img)
        if r.returncode != 0:
            print(f"  ✗ {amb}: no arrancó: {r.stderr.strip()[-300:]}")
            bien = False
            continue
        # como un rollout: el nuevo arranca al lado; solo si queda listo, reemplaza al viejo
        listo = False
        for _ in range(60):
            st = docker("exec", f"{nombre}-nuevo", "python", "-c",
                        "import urllib.request as u; u.urlopen('http://localhost:8080/readyz', timeout=2)")
            if st.returncode == 0:
                listo = True
                break
            if docker("inspect", "--format", "{{.State.Running}}", f"{nombre}-nuevo").stdout.strip() != "true":
                break
            sh("sleep", "0.5")
        if not listo:
            log = docker("logs", "--tail", "5", f"{nombre}-nuevo")
            print(f"  ✗ {amb}: la imagen nueva no quedó lista; sigue la anterior. Su log: {(log.stdout + log.stderr).strip()[-400:]}")
            docker("rm", "-f", f"{nombre}-nuevo")
            bien = False
            continue
        docker("rm", "-f", nombre)
        docker("rm", "-f", f"{nombre}-nuevo")
        r = docker("run", "-d", "--name", nombre, "--network", RED, "-p", f"{puerto}:8080", "--restart", "unless-stopped", *env, img)
        if r.returncode != 0 or not esperar(f"http://localhost:{puerto}/readyz", 30):
            print(f"  ✗ {amb}: no quedó listo en :{puerto}")
            bien = False
            continue
        print(f"  ✓ {amb}: corre {corto(img)} en localhost:{puerto} (antes: {corto(ahora.get('imagen', '')) if ahora else 'nada'})")
    return bien


def estado() -> None:
    for amb, puerto in AMBIENTES.items():
        pide = leer_despliegue(amb).get("imagen", "")
        hay = corriendo(amb)
        igual = "✓ coincide" if hay.get("imagen") == pide and hay.get("estado") == "running" else "✗ NO coincide"
        print(f"{amb:<11} pide {corto(pide)} · corre {corto(hay.get('imagen', '')) if hay else 'nada'} ({hay.get('estado', '—')}) · "
              f"localhost:{puerto} · {igual}")


if __name__ == "__main__":
    op = sys.argv[1] if len(sys.argv) > 1 else "estado"
    if op == "sincronizar":
        sys.exit(0 if sincronizar(sys.argv[2] if len(sys.argv) > 2 else None) else 1)
    estado()
