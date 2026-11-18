# Dojo de entrenamiento ML engineer's · C01 · Estación 8: CI/CD y registro de imágenes

Este es un mini-proyecto de práctica. Reproduce en pequeño, en una Mac sin nube, la estación «CI/CD y registro de imágenes» del caso C01: el workflow que prueba cada PR, construye la imagen del gateway una sola vez por commit, la prueba y la escanea antes de subirla a un registro donde ningún tag se reusa, y lleva su digest por GitOps a staging y a producción, con una persona que aprueba y un rollback que tarda segundos. La persona con la que trabajas está aprendiendo; tu trabajo es que **entienda**, no que termine rápido.

## Qué es cada cosa

| Carpeta o archivo | Qué es | ¿Se toca? |
|---|---|---|
| `mundo/forja.py`, `mundo/acciones.py` | La forja: el GitHub del dojo. PRs, merges, corridas y aprobaciones; `acciones.py` corre el workflow como GitHub Actions. | **No.** `forja.py` sí se usa. No leas `acciones.py` para resolver un paso: se porta como Actions. |
| `mundo/nube.py`, `mundo/nube/confianza.json` | La nube: credenciales por OIDC (la trust policy de cada rol) y los comandos de ECR. | `nube.py` se usa; `confianza.json` es del equipo de nube y cambia solo con revisión. |
| `mundo/gitops.py` | Pone a correr en staging (8801) y producción (8802) lo que dice el repositorio de despliegue. Lo dispara un hook en cada push. | Se usa (`estado`); no se toca. |
| `mundo/escaner.py`, `mundo/avisos.json` | El escáner (flags de Trivy) y su base de avisos congelada, con avisos DE EJEMPLO. | Se usa; no se toca. |
| `mundo/forja.yaml` | La protección de main (check obligatorio) y los ambientes (quién aprueba producción), del equipo de plataforma. | Solo con una revisión aprobada (`mundo/revisiones.json`). |
| `mundo/ecr_dojo/`, `mundo/triton_dojo/`, `mundo/triton/`, `compose.yaml`, `mundo/crear.py`, `mundo/comun.py` | El ECR del dojo, el Triton del dojo con un modelo de juguete y cómo nace el mundo. | **No.** |
| `gateway/` (con su `Dockerfile`), `gateway.yaml`, `servir/modelo.json` | El gateway de la estación 6, su receta y su configuración. | **No** en esta estación (se cambia por PR cuando una falla lo pide). |
| `.github/workflows/gateway.yml` | Lo escribe la persona: el workflow. El contrato está arriba del archivo. | **Sí.** |
| `ci/humo.sh`, `ci/escaneo.sh`, `ci/push.sh`, `ci/desplegar.sh` | Los escribe la persona. Cada uno trae su contrato arriba. `ci/foto.py` viene dado. | **Sí.** |
| `infra/ecr-retencion.json`, `.trivyignore.yaml` | Los escribe la persona: la regla de retención (formato de ECR) y las excepciones del escaneo. | **Sí.** |
| `.forja/`, `.nube/` | El estado de la forja (repositorios, PRs, corridas y logs) y de la nube. Git los ignora. | No a mano. Los logs se leen mucho: `python mundo/forja.py corrida <id> --job <job>`. |
| `verificar.py` | Revisa los criterios de «listo», uno por check. | No. |
| `romper.py` | Mete fallas en el mundo, la configuración o la infraestructura. Nunca en lo que escribe la persona. | No. Y no leas su código para adivinar una falla escondida. |
| `GUION.md` / `OBJETIVOS.md` | El paso a paso (Construir con ayuda) y solo los objetivos (Construir solo). | No. |
| `taller/progreso.json`, `BITACORA.md` | El registro de las rondas. | Sí, tú los mantienes (ver abajo). |
| `taller/registro.py` | Lo usan `verificar.py` y `romper.py` para anotar en `progreso.json`. | No. |

## Cómo se trabaja

- Responde en español neutro, de tú, directo y sin relleno. Términos técnicos en inglés la primera vez, con su explicación.
- Explica siempre el **por qué**. Cuando algo en el dojo es distinto de C01 real, dilo en una línea: la forja en lugar de GitHub (el mismo YAML de Actions, corrido en la Mac y no en máquinas de GitHub), `mundo/nube.py` en lugar de AWS (el token OIDC lo firma la forja con un secreto compartido; en GitHub, con su llave pública), el ECR del dojo (un proxy con las reglas de ECR delante de `registry:2`, en `localhost:5800`), un hook de git en lugar de Argo CD, dos contenedores en lugar del clúster, una imagen para la Mac (arm64) en lugar de `linux/amd64`, un escáner con avisos de ejemplo en lugar de Trivy con CVE reales, y sin la firma con cosign ni la paridad en la T4.
- Nunca inventes salidas: si no corriste algo, di que no lo corriste.
- El entorno virtual va activo en cada comando: `source .venv/bin/activate`.
- El flujo de trabajo es el de GitHub: rama → `git push origin <rama>` → `python mundo/forja.py pr abrir <rama> --titulo "…"` → `python mundo/forja.py pr merge <N>` → `git switch main && git pull`. Nadie hace push directo a main. Antes de cambiar de rama, haz commit de `taller/progreso.json` y `BITACORA.md` (`verificar.py` escribe en el primero).
- Antes de correr algo que cambia el mundo (`forja.py pr merge`, `forja.py aprobar`, `forja.py rerun`, `nube.py ecr configurar|politica-retencion|retencion --aplicar`, un push al repositorio de despliegue, `docker compose …`, `romper.py`, `git commit`, `git revert`, `git push`), dilo. Lo que solo lee (`verificar.py`, `forja.py pr ver|corridas|corrida`, `nube.py ecr describir|imagenes|retencion --vista-previa`, `gitops.py estado`, `docker history`, `curl` a los ambientes, `git log`, `git diff`) se puede correr directo.
- Aprobar producción lo hace `revisora`, nunca quien disparó la corrida: la forja no deja que alguien apruebe su propio despliegue. En el dojo la persona hace los dos papeles, y está bien que lo note.
- Una corrida de main tarda ≈ 30 s (la primera, ≈ 1 min); `mundo/crear.py` ≈ 70 s; `verificar.py` ≈ 5 s.
- Las reglas de otros equipos (`mundo/forja.yaml`, `mundo/nube/confianza.json`) no se cambian para que algo pase. Tampoco se agrega una excepción al escaneo para un aviso que sí aplica y sí tiene parche.
- Enséñale a mirar: `python mundo/forja.py corrida <id>` (los jobs, sus pasos y sus outputs), `--job <job>` (el log), `python mundo/nube.py ecr imagenes classifier-gateway`, `python mundo/gitops.py estado`, `git --git-dir=.forja/despliegue.git log -p`.
- Sigue el prompt de la ronda que te pegaron: en Construir solo y en Romper solo **no das código ni pistas** salvo que la persona se rinda.

## Bitácora

Al terminar cada paso, objetivo o falla, agrega una entrada en los dos archivos:

`BITACORA.md`, legible en el celular:

```markdown
## 2026-11-18 10:42 · Construir con ayuda · paso 6 (el workflow completo)
- **Hice:** …
- **Medí:** … (números reales que salieron)
- **Sigue:** …
```

`taller/progreso.json`, el que se importa en «Tu tablero» del Dojo (la página /tablero/ de la app). Agrega a `bitacora` y actualiza `rondas`:

```json
{
  "estacion": "c01-cicd",
  "rondas": {
    "guiado":       { "estado": "en_curso", "inicio": "2026-11-18T10:05:12-06:00", "fin": null },
    "solo":         { "estado": "pendiente", "inicio": null, "fin": null, "pistas": 0 },
    "romper_ayuda": { "estado": "pendiente", "fallas": [] },
    "romper_solo":  { "estado": "pendiente", "fallas": [] }
  },
  "bitacora": [
    { "fecha": "2026-11-18T10:42:30-06:00", "ronda": "guiado", "paso": "workflow", "hice": "…", "medi": "…", "sigue": "…" }
  ],
  "verificaciones": [
    { "fecha": "2026-11-18T10:41:02-06:00", "pasan": ["mundo", "reglas"], "fallan": [] }
  ]
}
```

- `estado` es `pendiente`, `en_curso` o `hecha`. En el tablero, `guiado` se llama «Construir con ayuda», `solo` «Construir solo», `romper_ayuda` «Romper con ayuda» y `romper_solo` «Romper solo».
- **Fecha y hora en cada avance**, en ISO 8601 con la zona de la Mac: sácala con `date -Iseconds` (da algo como `2026-11-18T10:42:30-06:00`). Nunca solo la fecha.
- `verificaciones` la escribe `verificar.py` solo, en cada corrida. No la edites.
- Cada falla la anota `romper.py` al cerrarla (`--verificar` o `--revelar`): `{ "id", "inicio", "fin", "minutos", "pistas": 0, "rendido", "aprendi": "" }`, con el tiempo real. Tú solo completas `pistas` y `aprendi` en esa misma entrada (la última de su ronda); no agregues otra.
- Mantén el JSON válido: después de editarlo, corre `python -m json.tool taller/progreso.json > /dev/null`.
