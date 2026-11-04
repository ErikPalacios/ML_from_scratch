"""Solo para probar las prácticas sin clics: etiqueta por la API lo que una persona etiquetaría en Label Studio.
Uso: python _etiquetar_api.py <proyecto> <titulo> <interfaz.xml> <archivos...>   (crea el proyecto, importa y etiqueta)
"""
import json
import sys
import urllib.request
from pathlib import Path

H = {"Authorization": "Token practica-token-local-0001"}
VERDAD = {**{f"foto_{i:02d}.png": "playera" for i in (1, 2, 4, 6, 10)}, **{f"foto_{i:02d}.png": "tenis" for i in (3, 5, 7, 8, 9)},
          **{f"req_{i:03d}.png": "bolsa" for i in range(1, 7)}, "req_007.png": "playera", "req_008.png": "playera",
          "req_009.png": "tenis", "req_010.png": "tenis"}


def api(ruta, datos=None, tipo="application/json"):
    r = urllib.request.Request("http://localhost:8091" + ruta, data=datos, headers={**H, **({"Content-Type": tipo} if datos else {})})
    return json.loads(urllib.request.urlopen(r).read() or b"null")


titulo, xml, archivos = sys.argv[1], sys.argv[2], sys.argv[3:]
pid = api("/api/projects", json.dumps({"title": titulo, "label_config": Path(xml).read_text()}).encode())["id"]
limite = "----practica"
cuerpo = b"".join(f"--{limite}\r\nContent-Disposition: form-data; name=\"{Path(a).name}\"; filename=\"{Path(a).name}\"\r\nContent-Type: image/png\r\n\r\n".encode()
                  + Path(a).read_bytes() + b"\r\n" for a in archivos) + f"--{limite}--\r\n".encode()
api(f"/api/projects/{pid}/import", cuerpo, f"multipart/form-data; boundary={limite}")
tareas = api(f"/api/tasks?project={pid}&page_size=100")
for t in tareas["tasks"] if isinstance(tareas, dict) else tareas:
    clase = VERDAD[t["data"]["image"].rsplit("/", 1)[1].split("-", 1)[1]]
    api(f"/api/tasks/{t['id']}/annotations", json.dumps({"result": [{"from_name": "clase", "to_name": "foto", "type": "choices", "value": {"choices": [clase]}}]}).encode())
print(pid)
