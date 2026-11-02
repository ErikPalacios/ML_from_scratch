# ML Project Board (tablero-ml)

**En producción:** https://tablero-ml-hazel.vercel.app

Un tablero en **modo producción**: en inglés y sin explicaciones didácticas, como el de un equipo de ML engineering. Lo didáctico vive en el curso y en las cheat sheets.

Cada proyecto es un **mapa de metro** del dato al monitoreo, con el estilo de la hoja «Del dato a producción». Cada paso trae:
- **Status:** To do, In progress, Done, Blocked, o N/A con su razón;
- **Entry gate:** los cálculos previos que el paso exige antes de empezarlo;
- **Definition of Done:** los criterios del curso;
- **Milestones**, **Measurements** con unidades y **Runbook** (comandos);
- **Artifacts & commits**, **Notes**, **Decisions** y **References**, con enlaces al curso y a la cheat sheet que le corresponden.

Los mismos datos se ven en la Mac, el celular y la tablet, y se leen sin conexión.

## Qué tiene

- **Patrones del curso.** Al crear un proyecto eliges su patrón: Online synchronous, Batch, Async (queue), LLM & RAG, Hybrid, Streaming o Edge / on-device. Los pasos obligatorios salen del curso y de la hoja, nada es inventado, y después puedes agregar, quitar y reordenar pasos.
  - **Síncrono:** las 12 estaciones del C01, más el kickoff.
  - **Batch, LLM, streaming y edge:** la comparación de la hoja contra el C01, con los criterios de C14, C11, C13 y C03.
  - **Asíncrono e híbrido:** C04 (con C05) y C07 (con C06 y C08), más M02.
- **Requirements & Capacity Plan (`kickoff`):** el primer paso de todo patrón, con el sizing base del caso de referencia: QPS promedio → pico → diseño, GPUs con N+1, CPU, red, costo mensual contra el presupuesto y error budget.
- **Entry gate por paso:**
  - **Qué exige:** cada paso trae los cálculos que hay que hacer **antes** de empezarlo. Por ejemplo, el tamaño del modelo en FP32/FP16 y la VRAM antes del export, los pods y nodos antes de Kubernetes, o el tiempo hasta la muestra del canary antes del rollout.
  - **Cómo se verifica:** tú pones tu resultado y la app lo recalcula con la fórmula del curso (con su tolerancia: exacto para conteos, ±2–5 % para lo demás).
  - **Fórmula y ojo:** «Formula» muestra la fórmula. El ojo («Reveal») muestra la respuesta: cuenta para el gate, pero queda marcada como revelada en el resumen.
  - **Acceptance checks:** algunos cálculos traen un criterio que el diseño tiene que cumplir, como el costo bajo el presupuesto o «sobrevive a perder una GPU bajo 70 %». Si falla, el gate sigue cerrado.
  - **El bloqueo:** el paso no pasa a «In progress» ni a «Done» con el gate abierto, ni desde la página ni con el token de Claude Code. Solo lo abre un **waiver** con su razón, que queda registrado.
  - **Cuántos son:** 317 cálculos en los 7 patrones. Cada uno se comprueba al generar las plantillas: con los valores del caso, el motor da el número que dice el curso.
- **Sizing:** la hoja de inputs del proyecto, separados en requirements, assumptions y benchmarks.
  - En un proyecto nuevo, los requirements empiezan vacíos (son de tu sistema). Las assumptions y los benchmarks empiezan con el valor del caso de referencia, que queda visible como `reference`.
  - El resultado de un cálculo pasa a ser input de los pasos siguientes; un cálculo con inputs vacíos queda «blocked».
  - Puedes agregar tus propios inputs y cálculos.
- **Status (retomar):** dónde te quedaste, la próxima acción y el estado del gate del paso siguiente, más los días sin moverle, los entry gates cumplidos, los bloqueos abiertos, lo que está en curso y la última sesión.
- **Work log, decisiones (ADR) y pasadas:**
  - work log por sesión (did, measured, next);
  - ADRs (decision, over, why; in force o superseded);
  - pass 1 (guided) y pass 2 (solo) por paso.
- **Resume brief:** un markdown con el estado, el gate de cada paso activo y los inputs que faltan. Nunca muestra el valor de un cálculo que no hiciste ni revelaste.
- **Respaldo:** varios proyectos y JSON de ida y vuelta. Historial de versiones en el servidor (como mucho una cada 10 minutos, las últimas 30) y papelera de 30 días.
- **Precarga del C01** con tu estado real de Caso1 (ver abajo).
- **Sin conexión:** la página abre desde el service worker y los proyectos desde la copia del navegador. Un cambio sin red queda en cola y se sube al volver la red; cada cambio toca solo su campo, así que no pisa lo que escribió Claude Code.
- **API para Claude Code** con su propio token: lee el estado, registra respuestas de cálculos e inputs, agrega entradas al work log y marca pasos. No revela respuestas ni hace waivers.

### La precarga del C01

Viene de `~/Documents/ProyectosPortafolio/Caso1` (PLAN.md, LAB_LOG.md, DESIGN.md y el git log, leídos en solo lectura el 2026-10-26):
- **Hitos:** los hitos 0–10 del PLAN, cada uno en su estación.
- **Registro:** las mediciones del LAB_LOG, 11 decisiones y 2 sesiones.
- **Sizing:** los inputs del C01, más tu supuesto de DESIGN.md de 400 B por línea de log.
- **Cálculos ya hechos:** solo los que hiciste en DESIGN.md.
  - kickoff: QPS 116 → 350 → 500, 2 GPUs y 43 min de error budget;
  - serving: el tensor y 25 requests en vuelo;
  - datos: los logs por día.

  El resto de los gates queda abierto; por ejemplo, al kickoff le faltan los cálculos de CPU del gateway, red, ALB y costo total.

Un proyecto v1 (el que se precargó antes del modo producción) se migra solo al leerlo: el kickoff, los cálculos, los inputs y los textos en inglés llegan, pero tus ediciones se conservan. Solo se cambia un texto si sigue exactamente igual a como lo dejó la precarga.

## Cómo funciona

```
web/                    la página (HTML, CSS y JavaScript sin framework ni build)
  js/shared/            lo que comparten el navegador y el servidor:
    model.mjs           modelo de datos v2 y validación
    calc.mjs            motor de los cálculos (parser propio, sin eval) y el entry gate
    ops.mjs             cambios por ruta, con el gate y los permisos del token
    migrate.mjs         v1 → v2
    templates.mjs       plantillas de los 7 patrones (generadas)
    legacy-es.mjs       los textos v1 (generados, para la migración)
    summary.mjs         el resume brief
    seed-c01.mjs        la precarga del C01 (v2) y su migración; seed-c01-v1.mjs es la v1
api/index.mjs           la única Vercel Function: recibe todo /api/* (vercel.json hace el rewrite)
server/                 la API (handler.mjs), la contraseña, la cookie y el token (auth.mjs) y la base de datos (store.mjs)
fuentes/                lo que sale del curso y no está en la hoja: pasos de asíncrono e híbrido, criterios,
                        textos en inglés (text-en.json), cálculos por patrón (calcs-*.json) y fuentes de los inputs
tools/                  build, servidor local, chequeo en Chrome y generador de plantillas
tests/                  tests de la API, el motor, el gate y la migración (node --test); calc-expected.json es generado
```

### Por qué Upstash Redis y no Neon Postgres

Para un solo usuario, cada proyecto es un documento JSON que se lee y se escribe completo.
- **Upstash** lo guarda con un `SET` bajo una llave y se llama por HTTPS con `fetch`. No hay esquema, migraciones ni pool de conexiones, y no hace falta ninguna dependencia de npm.
- **Postgres** obliga a definir tablas, o una columna `jsonb`, y a manejar conexiones desde funciones serverless, a cambio de consultas que aquí no se usan.

El plan gratis de Upstash alcanza de sobra:
- **256 MB:** un proyecto pesa ≈ 50 KB.
- **500 mil comandos al mes:** guardar un cambio usa 2 llamadas.
- **10 GB de transferencia al mes.**

Una escritura usa un script Lua que solo escribe si nadie escribió antes. Si dos lugares guardan a la vez, el segundo vuelve a aplicar sus cambios sobre lo nuevo.

### Seguridad

- **Contraseña:** una sola, guardada en Vercel como `APP_PASSWORD`, de 12 caracteres o más (mejor 4 o más palabras al azar). El login la compara en tiempo constante y acepta 10 intentos por IP cada 15 minutos (300 en total). Una IP bloqueada ya no gasta comandos de la base.
- **Cookie de sesión:** `__Host-tablero`, firmada con HMAC-SHA256 (`SESSION_SECRET`) y con `HttpOnly`, `Secure` y `SameSite=Strict`. Dura 60 días; cambiar `SESSION_SECRET` cierra todas las sesiones.
- **Escrituras con cookie:** el servidor también revisa que vengan de la misma página (encabezado `Origin`).
- **Token de Claude Code** (`API_TOKEN`): solo lee, agrega y marca. No crea, reemplaza ni borra proyectos, ni borra, reordena o reemplaza completos pasos, sesiones o decisiones.
- **Reemplazos con control:** importar encima o restaurar una versión manda la revisión que viste; si Claude Code escribió mientras tanto, responde 409 y no pisa nada.
- **Encabezados:** CSP sin scripts de terceros y `frame-ancestors 'none'`. Las respuestas de la API van con `no-store`.
- Ningún secreto está en el repo: `.env*` está en `.gitignore` y en `.vercelignore`.

## Comandos

```bash
npm test           # tests de la API, las ops, la cookie, el token y la precarga del C01
npm run dev        # servidor local en http://localhost:5173 con los datos en .data/ (sin Vercel ni Upstash)
npm run check      # arma dist/ y lo revisa en Chrome: 375, 768 y 1024 px, claro y oscuro, y sin conexión
npm run templates  # regenera web/js/shared/templates.mjs desde el curso, la hoja y fuentes/
npx vercel --prod --yes   # desde esta carpeta en el checkout principal: sube a Vercel (proyecto tablero-ml)
```

En local, `npm run dev` lee `.env.local` si existe (git lo ignora). Sin `APP_PASSWORD`, la contraseña local es `tablero-local`.

## Subirlo a Vercel (la primera vez)

Crear la base de datos y aceptar los términos lo haces tú en el dashboard de Vercel. El resto son comandos.

1. **Crear y enlazar el proyecto.** Desde `apps/tablero-ml` en el checkout principal:
   ```bash
   npx vercel link --yes --project tablero-ml --scope <tu-equipo>
   ```
   Si el proyecto no existe, lo crea. `vercel link` puede escribir un `.env.local` con un token de OIDC; git y `.vercelignore` lo ignoran.
2. **Crear la base de datos (en el dashboard):**
   1. Abre vercel.com → equipo **<tu-equipo>** → proyecto **tablero-ml** → pestaña **Storage**.
   2. Elige **Create Database**, después **Upstash** y luego **Upstash for Redis**.
   3. Acepta los términos de Upstash. Elige el plan **Free** y la región más cercana a la de tus Functions (por defecto, Washington D.C., `iad1`, en us-east-1).
   4. En **Connect Project**, conecta `tablero-ml` en los tres ambientes.

   Vercel agrega las variables de la base: `KV_REST_API_URL` y `KV_REST_API_TOKEN`, o `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN`. El tablero acepta cualquiera de los dos pares.
3. **Agregar los tres secretos** (Production). Cada comando pide el valor; la contraseña necesita 12 caracteres o más:
   ```bash
   npx vercel env add APP_PASSWORD production
   ```
   ```bash
   openssl rand -hex 32 | npx vercel env add SESSION_SECRET production
   ```
   ```bash
   openssl rand -hex 32 | tee ~/.tablero-token | npx vercel env add API_TOKEN production
   ```
   El tercero también deja el token en `~/.tablero-token`, para el `.env` de Caso1 (paso 5). Bórralo cuando lo copies.
4. **Subirlo:**
   ```bash
   npx vercel --prod --yes
   ```
   Después abre la URL, entra con tu contraseña y toca **Precargar el C01**. Para verificar el deploy, el `BUILD` de `/sw.js` en producción tiene que ser el mismo que el de tu `dist/sw.js`.
5. **Conectar Caso1** (abajo).

## Integración con Claude Code (Caso1)

**1. El token en Caso1, fuera de git.** En `~/Documents/ProyectosPortafolio/Caso1`:
- agrega la línea `.env` a `.gitignore`;
- crea `.env` con dos líneas:
  ```
  TABLERO_URL=https://tablero-ml-hazel.vercel.app
  TABLERO_TOKEN=<el token>
  ```

Comprueba que git ignora el archivo con `git check-ignore .env`.

**2. Este texto en el `CLAUDE.md` de Caso1** (también está en [docs/claude-md-caso1.md](docs/claude-md-caso1.md)). Reemplaza la sección del tablero si ya la tenías: la v2 agrega el entry gate.

````markdown
## Project board (single source of truth for status)

This project's status lives on the board, project `c01`. URL and token are in `.env` (git-ignored); load them with `set -a; . ./.env; set +a` before each call. Never print the token or commit it.

**At the start of every session**, read the brief and start from it: where I left off, next action, blockers, active steps with their entry gate, DoD and measurements, recent work log and decisions.

```bash
set -a; . ./.env; set +a; curl -fsS -H "Authorization: Bearer $TABLERO_TOKEN" "$TABLERO_URL/api/claude/c01"
```

Step ids are in the brief's «Map» table: `kickoff`, `datos`, `versionado`, `entrenamiento`, `gate`, `export`, `serving`, `empaquetado`, `cicd`, `kubernetes`, `rollout`, `request`, `monitoreo`. PLAN milestones live inside their step (`h0`–`h10`, `h7b`, `h9a`, `h9b`, `imagenette`, `design`).

**Entry gate (hard rule).** A step cannot move to `en_curso` or `hecho` until its sizing calcs are done. Before starting a step:
1. Show me the step's open calcs: label, the inputs with their values, and the unit.
2. Ask me for my result. Do not compute it for me, and do not give me the formula or the answer unless I ask.
3. Record my answer. The board checks it against the course formula and replies 422 «Entry gate not met» while anything is open or wrong. Tell me which calcs are off; never retry with a different number on your own.

Waivers and revealed answers are mine to decide, on the board.

**When a step or milestone closes** (at that moment, not at the end of the day), update the board. Every call is a `POST` with JSON and returns `{"ok":true,"rev":N}`, or `{"error":…}`.

- A step:
  ```bash
  curl -fsS -X POST -H "Authorization: Bearer $TABLERO_TOKEN" -H 'Content-Type: application/json' "$TABLERO_URL/api/claude/c01/step/serving" --data @- <<'JSON'
  {"milestone": {"id": "h1", "status": "hecho"},
   "result": {"name": "curl latency, warm", "value": "31", "unit": "ms", "note": "10 requests, M4, 4 threads"},
   "file": {"path": "app/main.py", "ref": "commit abc1234"},
   "pass": {"v1": "hecho"},
   "note": "POST /v1/classify returns the contract; /readyz 503 while loading."}
  JSON
  ```
  Fields (all optional):
  - `status` (pendiente, en_curso, hecho, bloqueado, no_aplica) and `reason` (required for no_aplica);
  - `pass` (`v1`/`v2`: pendiente, en_curso, hecho);
  - `note` (appended with the date; never replaces);
  - `result` (`name`, `value`, `unit`, `note`, `date`), `command` (`code`, `note`), `file` (`path`, `ref`);
  - `milestone` (`id`, `status`), `criterion` (`id` and `ok`, or `text` for a new one);
  - `calc` (`id`, `answer`): my result for an entry-gate calc.

  In one request, answers are applied before the status.
- A sizing input, when a requirement or a measurement changes: `POST $TABLERO_URL/api/claude/c01/var/<varId>` with `{"value": "…"}`. Ids are in `GET $TABLERO_URL/api/claude/c01.json` → `vars`.
- A work-log entry, when the session ends: `POST $TABLERO_URL/api/claude/c01/log` with `{"did": "…", "measured": "… with units", "next": "…", "steps": ["serving"]}`.
- Where I left off and the next action: `POST $TABLERO_URL/api/claude/c01/resume` with `{"where": "…", "next": "Milestone 2, step 2.1: …", "step": "serving"}`.
- A decision with its why: `POST $TABLERO_URL/api/claude/c01/decision` with `{"what": "…", "over": "…", "why": "…", "step": "serving"}`.

Rules:
- Measurements carry their real number and unit; if it wasn't measured, it isn't written.
- `LAB_LOG.md` remains the long lab diary; the board holds the status and the next action. If they disagree, tell me instead of picking one.
- The token cannot delete or reorder steps, reveal answers, file waivers or change calc definitions: that's done on the board.
````

**3. Probarlo** desde Caso1:
```bash
set -a; . ./.env; set +a; curl -fsS -H "Authorization: Bearer $TABLERO_TOKEN" "$TABLERO_URL/api/claude/c01" | head -20
```

Las rutas y las claves en español de la v1 (`paso`, `bitacora`, `retomar`, `estado`, `resultado`…) siguen funcionando.


## La API completa

Todo vive bajo `/api/`. La página usa la cookie de sesión y Claude Code usa `Authorization: Bearer <API_TOKEN>`.

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `POST login` `{password}` · `POST logout` · `GET session` | todos | entrar, salir y saber si hay sesión (y qué falta configurar) |
| `GET projects` | web, token | la lista, con avance y días |
| `POST projects` `{project}` | web | crear o importar (un v1 se migra) |
| `GET projects/<id>` | web, token | el proyecto completo (v2) |
| `PUT projects/<id>` `{project, baseRev?}` | web | reemplazar (importar encima, restaurar una versión) |
| `DELETE projects/<id>` | web | borrar (30 días en la papelera) |
| `POST projects/<id>/ops` `{ops}` | web, token (acotado) | cambios con ops: `set`, `insert`, `remove`, `move` sobre una ruta como `["steps","#serving","status"]`; el gate se revisa aquí |
| `GET projects/<id>/resumen` · `GET claude/<id>` | web, token | el resume brief, en markdown |
| `GET claude/<id>.json` | web, token | el proyecto en JSON |
| `POST claude/<id>/step/<stepId>` · `var/<varId>` · `log` · `resume` · `decision` | web, token | los atajos de arriba (también `paso`, `variable`, `bitacora`, `retomar`) |
| `GET projects/<id>/historial[/<i>]` · `GET export` | web | versiones guardadas y respaldo completo |


## Regenerar las plantillas

`npm run templates` lee estas fuentes y escribe `web/js/shared/templates.mjs`, `legacy-es.mjs` y `tests/calc-expected.json`:
- **de la hoja:** las 12 estaciones y los 4 patrones, en `../cheat-sheets/sheets/recorrido/fuentes/content-w*.json`;
- **del curso:** los títulos de las secciones, en `../ml-system-design/js/content`; también sirven para verificar cada enlace;
- **de `fuentes/`:**
  - `patterns-done.json`, `patterns-extra.json`: los pasos y criterios;
  - `text-en.json`: los textos en inglés, con la misma cantidad de criterios que en español;
  - `calcs-*.json`: las variables y los cálculos, con el valor que da el curso;
  - `var-sources-en.json`: las fuentes de los inputs, en inglés.

Agentes que leyeron los casos del curso escribieron los JSON de `fuentes/`, con la regla de no inventar números, herramientas ni pasos. El generador vuelve a calcular cada fórmula con el motor de la app y avisa en cuatro casos:
- un resultado no coincide con el número del curso;
- un check falla;
- una fórmula usa una variable que no está definida antes;
- un enlace al curso no existe.


## Fases

Cada fase cabe en una ventana de 5 horas de uso.

1. **MVP (hecha):** el mapa, los pasos, el panel para retomar, el work log, las decisiones, la precarga del C01, la API de Claude Code, el modo sin conexión, los tests y el chequeo en 375/768/1024 px.
2. **Modo producción (esta):**
   - la interfaz en inglés;
   - el kickoff y el entry gate con 317 cálculos de los 7 patrones;
   - Sizing, el ojo para revelar y el waiver;
   - la migración v1 → v2 y la API de cálculos.
3. **Revisión del contenido:** revisores independientes contra el curso para los pasos, criterios y cálculos de los 6 patrones que no son el C01, como en las fases del curso. Además, un buscador.
4. **Seguimiento en el tiempo:**
   - gráficas de cada medición entre sesiones;
   - una línea de tiempo del work log;
   - comparar la pass 1 contra la pass 2 de un paso.
5. **CLI `tablero`** para Claude Code, para no escribir el `curl`.
