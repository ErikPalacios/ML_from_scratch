# Tablero de proyectos ML

Un tablero para llevar el control de cada proyecto de ML que construyes y retomarlo rápido después de días sin moverle.

Cada proyecto es un **mapa de metro** del dato al monitoreo, con el estilo de la hoja «Del dato a producción». Cada paso es una estación con:
- su estado: pendiente, en curso, hecho, bloqueado, o no aplica con su razón;
- tus notas;
- los criterios de «hecho» del curso;
- lo que mediste, con unidades;
- los comandos para verificar;
- los archivos y commits;
- enlaces al curso y a la cheat sheet que le corresponden.

Los mismos datos se ven en la Mac, el celular y la tablet, y también se leen sin conexión.

## Qué tiene

- **Patrones del curso.** Al crear un proyecto eliges su patrón: online síncrono, batch, asíncrono, LLMs y RAG, híbrido, streaming o edge. Los pasos obligatorios salen del curso y de la hoja; nada es inventado. Después puedes agregar, quitar y reordenar pasos.
  - **Síncrono:** las 12 estaciones del C01.
  - **Batch, LLM, streaming y edge:** la comparación de la hoja contra el C01, con los criterios sacados de C14, C11, C13 y C03.
  - **Asíncrono e híbrido:** los casos C04–C05 y C07 (con lo que agregan C06 y C08), y M02.
- **Panel «Retomar»:**
  - dónde te quedaste y el próximo paso concreto;
  - los días sin moverle;
  - los bloqueos abiertos, lo que está en curso y la última sesión.
- **Bitácora de sesiones:** fecha, qué hice, qué medí y qué sigue.
- **Registro de decisiones:** qué elegiste, contra qué y por qué.
- **Vueltas:** cada paso marca la vuelta 1 (guiada) y la vuelta 2 (solo).
- **«Resumen para retomar»:** arma un markdown con el estado, listo para pegarlo al empezar una sesión con Claude Code.
- **Varios proyectos y respaldo:**
  - exportar e importar en JSON;
  - el servidor guarda una copia antes de cambiar un proyecto (como mucho una cada 10 minutos, las últimas 30);
  - un proyecto borrado queda 30 días en la papelera.
- **Precarga del C01** con tu estado real de `~/Documents/ProyectosPortafolio/Caso1` (leído el 2026-10-26): los hitos 0–10 del PLAN acomodados en las estaciones, las mediciones del LAB_LOG, las decisiones de PLAN y LAB_LOG, y las dos sesiones del git log. El próximo paso queda en el hito 1, paso 1.4.
- **Sin conexión:**
  - La página abre desde el service worker y los proyectos desde la copia del navegador.
  - Un cambio sin red queda en cola y se sube al volver la red.
  - Como cada cambio toca solo su campo, lo que escribió Claude Code mientras tanto no se pisa.
- **API para Claude Code** con su propio token: lee el estado, agrega entradas a la bitácora y marca pasos.

## Cómo funciona

```
web/                    la página (HTML, CSS y JavaScript sin framework ni build)
  js/shared/            lo que comparten el navegador y el servidor: modelo de datos y validación, ops,
                        plantillas de los patrones (generadas), resumen en markdown, precarga del C01
api/index.mjs           la única Vercel Function: recibe todo /api/* (vercel.json hace el rewrite)
server/                 la API (handler.mjs), la contraseña, la cookie y el token (auth.mjs) y la base de datos (store.mjs)
fuentes/                los pasos por patrón que no están en la hoja, sacados del curso (asíncrono, híbrido y criterios)
tools/                  build, servidor local, chequeo en Chrome y generador de plantillas
tests/                  tests de la API y del modelo (node --test)
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
   npx vercel link --yes --project tablero-ml --scope erikpalacios-projects
   ```
   Si el proyecto no existe, lo crea. `vercel link` puede escribir un `.env.local` con un token de OIDC; git y `.vercelignore` lo ignoran.
2. **Crear la base de datos (en el dashboard):**
   1. Abre vercel.com → equipo **erikpalacios-projects** → proyecto **tablero-ml** → pestaña **Storage**.
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
- agrega la línea `.env` a `.gitignore` (hoy no la tiene);
- crea `.env` con dos líneas:
  ```
  TABLERO_URL=https://tablero-ml.vercel.app
  TABLERO_TOKEN=<el valor de ~/.tablero-token>
  ```

Revisa la URL real que te dio Vercel. Comprueba que git ignora el archivo con `git check-ignore .env`.

**2. Este texto, al final del `CLAUDE.md` de Caso1** (créalo si no existe):

````markdown
## Tablero del proyecto (fuente única del estado)

El estado de este proyecto vive en el tablero, no en dos registros: el proyecto es `c01`. La URL y el token están en `.env` (git lo ignora); cárgalos con `set -a; . ./.env; set +a` antes de cada llamada. Nunca imprimas el token ni lo pongas en un commit.

**Al empezar cada sesión**, lee el resumen y úsalo como punto de partida (dónde me quedé, próximo paso, bloqueos, pasos activos con sus criterios y resultados, últimas sesiones y decisiones):

```bash
set -a; . ./.env; set +a; curl -fsS -H "Authorization: Bearer $TABLERO_TOKEN" "$TABLERO_URL/api/claude/c01"
```

Los ids de los pasos están en la tabla «Mapa» del resumen: `datos`, `versionado`, `entrenamiento`, `gate`, `export`, `serving`, `empaquetado`, `cicd`, `kubernetes`, `rollout`, `request`, `monitoreo`. Los hitos del PLAN están dentro de su paso, con ids `h0`–`h10` (`h7b`, `h9a`, `h9b`, `imagenette`).

**Al cerrar cada paso o hito** (no al final del día: en el momento), actualiza el tablero con estas llamadas. Todas usan `POST` con JSON y responden `{"ok":true,"rev":N}`; un error trae `{"error":…}`.

- Un paso: estado, razón, vueltas, una nota, un resultado medido (con unidad), un comando, un archivo o commit, un hito, un criterio.
  ```bash
  curl -fsS -X POST -H "Authorization: Bearer $TABLERO_TOKEN" -H 'Content-Type: application/json' "$TABLERO_URL/api/claude/c01/paso/serving" --data @- <<'JSON'
  {"hito": {"id": "h1", "estado": "hecho"},
   "resultado": {"nombre": "latencia del curl en caliente", "valor": "31", "unidad": "ms", "nota": "10 requests, M4, 4 threads"},
   "archivo": {"ruta": "app/main.py", "ref": "commit abc1234"},
   "vuelta": {"v1": "hecho"},
   "nota": "POST /v1/classify devuelve el contrato; /readyz 503 durante la carga."}
  JSON
  ```
  Campos (todos opcionales): `estado` (pendiente, en_curso, hecho, bloqueado, no_aplica), `razon` (obligatoria con no_aplica), `vuelta` (`v1`/`v2`: pendiente, en_curso, hecho), `nota` (se agrega con fecha, no reemplaza), `resultado` (`nombre`, `valor`, `unidad`, `nota`, `fecha`), `comando` (`codigo`, `nota`), `archivo` (`ruta`, `ref`), `hito` (`id`, `estado`), `criterio` (`id` y `ok`, o `texto` para uno nuevo).
- Una entrada en la bitácora, al terminar la sesión: `POST $TABLERO_URL/api/claude/c01/bitacora` con `{"hice": "…", "medi": "… con unidades", "sigue": "…", "pasos": ["serving"]}`.
- Dónde me quedé y el próximo paso concreto: `POST $TABLERO_URL/api/claude/c01/retomar` con `{"donde": "…", "proximo": "Hito 2, paso 2.1: …", "paso": "serving"}`.
- Una decisión con su porqué: `POST $TABLERO_URL/api/claude/c01/decision` con `{"que": "…", "contra": "…", "porque": "…", "paso": "serving"}`.

Reglas:
- Lo medido va con su número real y su unidad; si no se midió, no se escribe.
- `LAB_LOG.md` sigue siendo el diario largo del laboratorio; el tablero guarda el estado y el próximo paso. Si los dos dicen cosas distintas, avísame en vez de elegir uno.
- El token no puede borrar ni reordenar pasos: eso lo hago yo en la página.
````

**3. Probarlo** desde Caso1:
```bash
set -a; . ./.env; set +a; curl -fsS -H "Authorization: Bearer $TABLERO_TOKEN" "$TABLERO_URL/api/claude/c01" | head -20
```

## La API completa

Todo vive bajo `/api/`. La página usa la cookie de sesión y Claude Code usa `Authorization: Bearer <API_TOKEN>`.

| Método y ruta | Quién | Qué hace |
|---|---|---|
| `POST login` `{password}` · `POST logout` · `GET session` | todos | entrar, salir y saber si hay sesión (y qué falta configurar) |
| `GET projects` | web, token | la lista, con avance y días |
| `POST projects` `{project}` | web | crear o importar |
| `GET projects/<id>` | web, token | el proyecto completo |
| `PUT projects/<id>` `{project, baseRev?}` | web | reemplazar (importar encima, restaurar una versión) |
| `DELETE projects/<id>` | web | borrar (30 días en la papelera) |
| `POST projects/<id>/ops` `{ops}` | web, token (acotado) | cambios con ops: `set`, `insert`, `remove`, `move` sobre una ruta como `["steps","#serving","status"]` |
| `GET projects/<id>/resumen` · `GET claude/<id>` | web, token | el resumen para retomar, en markdown |
| `GET claude/<id>.json` | web, token | el proyecto en JSON |
| `POST claude/<id>/paso/<pasoId>` · `bitacora` · `retomar` · `decision` | web, token | los atajos en español de arriba |
| `GET projects/<id>/historial` · `GET export` | web | versiones guardadas y respaldo completo |

## Regenerar las plantillas

`npm run templates` lee tres fuentes y escribe `web/js/shared/templates.mjs`:
- las 12 estaciones y los 4 patrones de la hoja, en `../cheat-sheets/sheets/recorrido/fuentes/content-w*.json`;
- los títulos de las secciones del curso, de `../ml-system-design/js/content`, que también se usan para verificar cada enlace;
- `fuentes/patterns-done.json` (criterios de batch, LLM, streaming y edge) y `fuentes/patterns-extra.json` (asíncrono e híbrido).

Los dos JSON de `fuentes/` los escribieron agentes que leyeron los casos del curso, con la regla de no inventar números, herramientas ni pasos. Las decisiones que tuvieron que tomar están en el historial de este proyecto (fase 1).

Si un enlace al curso deja de existir o un paso queda sin criterios, el generador lo avisa.

## Fases

Cada fase cabe en una ventana de 5 horas de uso.

1. **MVP (esta):** todo lo de «Qué tiene», la precarga del C01, la API de Claude Code, la sincronización sin conexión, los tests y el chequeo en 375/768/1024 px.
2. **Revisión del contenido por patrón:** revisores independientes contra el curso para los pasos y criterios de los 6 patrones que no son el C01 (como en las fases del curso). Además:
   - un buscador en notas y resultados;
   - en cada paso, «qué cambia en tu patrón» frente al C01, junto a los criterios.
3. **Seguimiento en el tiempo:**
   - una gráfica de cada resultado medido entre sesiones (por ejemplo, el p99 antes y después del hito 7);
   - una línea de tiempo de la bitácora;
   - comparar la vuelta 1 contra la vuelta 2 de un paso.
4. **Más integración con Claude Code:** un comando `tablero` (CLI sin dependencias) para no escribir el `curl`, y que la sesión proponga la entrada de la bitácora al cerrar.
