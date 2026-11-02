# Plan de lanzamiento público

Borrador del 2026-11-02. Prioridad: **alcance** (gente real usando las apps, portafolio, experiencia lanzando algo). Ingresos: **solo si es posible**, y sin que estorben al alcance.

Lo marcado con «verifica» son datos de precios, límites o reglas que cambian; se confirman antes de depender de ellos.

## 1. Punto de partida

| App | Qué es | Estado | Datos del usuario | Lista para público |
|---|---|---|---|---|
| Ronda de Diseño ML (`apps/ml-system-design`) | Curso + simulador de ML System Design, ~15 MB, español | Estática, con Vercel | `localStorage` (`msd.v1`), exporta e importa JSON | Casi: falta portada pública, SEO y revisar contenido |
| Cheat sheets (`apps/cheat-sheets`) | 9 hojas con PDF, generadores y revisores, sin conexión | En producción (`cheat-sheets-ml.vercel.app`) | Tema en el navegador | Sí, es la más madura |
| Laboratorio Transformer (`apps/transformer-lab`) | Entrenamiento de un GPT pequeño paso a paso, calculado en el navegador | Sin `vercel.json`; se abre por `file://` | `localStorage` (`tl.*`) | Falta publicarla |
| Atlas de Arquitecturas | Atlas nivel 2 de arquitecturas, 15 fases completas | **Solo en su rama** (`claude/atlas-arquitecturas-vision-ab9d96`), no está en `main` | No revisado | Falta integrarla a `main` |
| Tablero de proyectos ML (`apps/tablero-ml`) | Tablero tipo mapa de metro con API para Claude Code | En producción, **de un solo usuario** (una `APP_PASSWORD`, Upstash) y precargado con tu proyecto C01 | Redis | **No** como producto abierto (ver 4.4) |

Lo bueno: cuatro de las cinco son estáticas, funcionan sin cuenta y guardan en el navegador. Publicarlas cuesta casi nada y no hay datos ajenos que proteger.

## 2. Objetivo y cómo sabremos que funcionó

Objetivo de 90 días desde el lanzamiento público:

- **Alcance:** 1 000 visitantes únicos al mes y 100 personas que regresan en la semana siguiente.
- **Señal de valor:** 20 personas que te escriben o comentan algo concreto (qué les sirvió, qué falló).
- **Portafolio:** repositorio público con README en inglés y español, portada con las apps y 3 publicaciones que cuenten qué se construyó y qué falló.
- **Aprendizaje:** una lista escrita de contratiempos reales del lanzamiento (costos, abuso, soporte, errores en producción).
- **Ingresos (opcional):** cualquier cantidad por encima de cero. No es criterio de éxito.

Las cifras son una estimación para un nicho en español; se ajustan después de la beta.

## 3. Arquitectura del conjunto

Una **portada común** con una tarjeta por app, igual que la portada de las cheat sheets, y cada app en su propia dirección:

```
tu-dominio.com/              portada: qué hay, por dónde empezar, enlace al repo
curso.tu-dominio.com         Ronda de Diseño ML
hojas.tu-dominio.com         cheat sheets
transformer.tu-dominio.com   laboratorio Transformer
atlas.tu-dominio.com         Atlas de Arquitecturas
tablero.tu-dominio.com       demo del tablero (solo lectura)
```

- Un proyecto de Vercel por app (ya funciona así) y **un dominio propio** (~12 USD al año, verifica). Subdominios y no rutas, para que cada app mantenga su service worker y su CSP sin chocar.
- Cada app lleva el mismo encabezado mínimo: enlace a la portada, selector de tema, enlace de feedback.
- Todo queda **offline-first**, que ya es una ventaja de las cheat sheets.
- Analítica **sin cookies** (Plausible, Umami o la de Vercel; verifica precios) para no necesitar banner de cookies.

## 4. Decisiones por tema

### 4.1 Cuentas (Fase 5, no antes)

- **Todo funciona sin cuenta.** La cuenta solo sirve para **sincronizar el progreso** entre Mac, celular y tablet.
- Cada app ya exporta e importa un JSON; la sincronización es guardar ese JSON por usuario y app. Sin rediseñar los datos.
- Proveedor: uno administrado (Clerk, Auth.js con Upstash, o Supabase) con **enlace por correo y Google**. No guardar contraseñas propias. Verifica límites gratuitos.
- Antes de pedir cuentas, medir si alguien pide sincronizar. Si nadie lo pide, no se hace.

### 4.2 Registro gratis como «puerta»

Registro obligatorio frena el alcance. Propuesta: contenido completo abierto; el registro ofrece progreso sincronizado, y más adelante las prácticas con costo para ti (laboratorio Docker remoto). Así el registro tiene una razón de existir.

### 4.3 Laboratorio de Docker (el proyecto estrella)

Tres niveles, cada uno útil solo:

1. **Kata con tu Docker local.** Proyecto fijo (el Iris de la hoja de Docker), pasos, cronómetro, contador de repeticiones («dockerizar → borrar → repetir») y validación pegando la salida de `docker images` o `docker ps`. Costo de servidor: cero. Se publica dentro de las cheat sheets.
2. **Terminal simulada en el navegador.** Para quien no tiene Docker o está en celular o tablet: un sistema de archivos virtual, comandos `docker` simulados y revisión del Dockerfile con las reglas que ya existen. Costo de servidor: cero.
3. **Sandbox remoto real** (Vercel Sandbox, Fly.io o E2B). Solo con cuenta, con límite de minutos y solo si hay demanda. Es el único punto donde el costo crece con el uso; requiere tope de gasto, tiempo máximo por sesión y protección contra abuso. Verifica si el proveedor permite Docker dentro del sandbox.

### 4.4 Tablero

Es una herramienta personal con tu proyecto precargado. Convertirla en producto multiusuario es reescribir autenticación y datos. Para el alcance basta con:

- **Demo pública de solo lectura** con un proyecto de ejemplo (no tu C01 real), y
- el código en el repositorio para quien quiera correr el suyo.

### 4.5 Copias del material

No se puede impedir una captura de pantalla en una web, y todo contenido que se lee sin conexión ya está en el navegador del lector. Además, cualquier candado (PDF detrás de un correo, repositorio con el texto privado, bloqueos en la página) frena el alcance. **Decisión: no se pone ningún candado.** Se protege el crédito, no el acceso:

- **Licencia clara:** contenido bajo CC BY-NC-ND 4.0 (`LICENSE-CONTENIDO.md`) y código bajo MIT (`LICENSE`). Con eso se puede pedir la baja de una copia.
- **Atribución visible** (Fase 2): tu nombre y el enlace al sitio en el pie de cada página y de cada PDF. Los PDF siguen abiertos, sin pedir correo.
- **Marcas ocultas** (Fase 2): una frase o dato inocuo y único por hoja, para probar que una copia viene de aquí.
- **Lo difícil de copiar es lo valioso:** laboratorios, sincronización y correcciones en el servidor (Fases 5 a 8), actualizaciones y comunidad.
- El repositorio se publica **completo**, es la pieza de portafolio.

### 4.6 Ingresos (Fase 7, solo con tracción)

Orden de menor a mayor compromiso:

1. **Donaciones** desde la primera semana (Ko-fi, Buy Me a Coffee o GitHub Sponsors; verifica cuáles pagan en México).
2. **Pase de 3 meses o pago único** para lo que tenga costo (sandbox, correcciones con IA). Una suscripción mensual encaja mal con quien estudia 1 a 3 meses.
3. Cobros con **Stripe México** (acepta tarjetas, y verifica OXXO/SPEI) o con un procesador que cobre los impuestos al comprador extranjero (Lemon Squeezy, Paddle). Verifica comisiones.

Condiciones para empezar a cobrar: 500 visitantes semanales y al menos 20 personas pidiendo algo que cuesta dinero producir.

Importante: el plan **Hobby de Vercel es solo para uso no comercial**. En cuanto cobres, hay que pasar a Pro (~20 USD al mes, verifica). Las donaciones también pueden contar; decide con las condiciones vigentes.

Impuestos en México: hay que declarar los ingresos (por ejemplo bajo RESICO o actividad empresarial). Antes de cobrar, una consulta con un contador.

## 5. Plan de alcance (distribución)

La app sola no trae gente. Cada fase de contenido se acompaña de algo para compartir.

- **SEO:** cada hoja y cada módulo con título, descripción, imagen para redes y mapa del sitio. Las hojas ya son páginas indexables; el curso, que es una sola página, necesita rutas o páginas de entrada por tema.
- **Un contenido por semana**, tomado de lo que ya existe: una figura de una hoja, un error de Docker del quiz, un cálculo del curso. Con enlace a la hoja.
- **Dónde:** LinkedIn (comunidad ML de México y LATAM), X, Reddit (`r/learnmachinelearning`, `r/mlops`), comunidades de Discord y Telegram de ML en español, y un «Show HN» en inglés cuando haya versión en inglés de la portada.
- **Repositorio público:** README con capturas, licencia y una nota de «cómo se construyó con Claude Code». Es la pieza principal de portafolio.
- **Beta cerrada primero:** 10 a 20 personas conocidas, una semana, con un formulario corto. Se corrige antes de anunciar.
- **Inglés:** solo portada y README al inicio. Traducir el contenido es otro proyecto; se decide con datos.

## 6. Riesgos

| Riesgo | Qué hacer |
|---|---|
| **Privacidad del repositorio**: el tablero se precargó con datos de `Caso1` y hay rutas personales en documentos | Auditar el repositorio y el historial antes de hacerlo público; quitar secretos, rutas y datos personales |
| **Contenido incorrecto** (cifras, comandos) | Una pasada de verificación antes del lanzamiento; página de «reportar error» |
| **Licencia y derechos** (imágenes, fuentes, fragmentos de terceros) | Elegir licencia (código MIT; contenido CC BY-NC o similar); revisar lo que no es tuyo |
| **Costos que se disparan** (sandbox, Redis, ancho de banda) | Solo estático hasta la Fase 6; tope de gasto en cada proveedor |
| **Abuso del sandbox** (minado, spam) | Solo con cuenta, límites estrictos, red de salida cerrada |
| **Privacidad de usuarios** (México: aviso de privacidad, LFPDPPP) | Aviso corto, analítica sin cookies, pedir solo el correo |
| **Soporte y desgaste** | Un solo canal de contacto, respuestas en lotes semanales |
| **Rendimiento** del curso (15 MB) | Revisar la carga inicial y el service worker antes del lanzamiento |

## 7. Fases

Cada fase cabe en una ventana de 5 horas y termina con algo verificable.

| Fase | Contenido | Se considera lista cuando |
|---|---|---|
| **0 · Preparación** (hecha en esta rama, sin comprar dominio) | Integrar el Atlas; auditar repositorio e historial (secretos, rutas, datos personales); licencias; comprar el dominio | El repositorio puede hacerse público sin sorpresas. Resultado en la sección 10 |
| **1 · Publicar las cuatro apps** | `vercel.json` y despliegue del laboratorio Transformer y del Atlas; subdominios; revisión de móvil, tablet y modo oscuro con los chequeos existentes | Las cuatro abren en su dirección y pasan sus chequeos |
| **2 · Portada y SEO** | Portada común; metadatos, imágenes para redes, mapa del sitio; analítica sin cookies; botón de feedback; aviso de privacidad | La portada indexa y las visitas se miden |
| **3 · Demo del tablero** | Proyecto de ejemplo, modo solo lectura, sin tus datos | Se puede probar sin contraseña y sin exponer nada tuyo |
| **4 · Beta cerrada y lanzamiento** | 10–20 personas, correcciones, README en dos idiomas, publicaciones de lanzamiento | Beta sin errores graves y primeras publicaciones hechas |
| **5 · Cuentas y sincronización** | Registro por correo/Google; guardar el JSON por usuario y app | Tu progreso aparece igual en Mac y celular |
| **6 · Docker, nivel 1 y 2** | Kata con Docker local y terminal simulada, dentro de las cheat sheets | Se puede repetir el ciclo completo con cronómetro y validación |
| **7 · Donaciones y cobros** | Botón de donación; Stripe México o procesador con impuestos; Vercel Pro si aplica; contador | Una compra de prueba de punta a punta |
| **8 · Docker, nivel 3** | Sandbox remoto con tope de gasto y límites | Una sesión real con costo medido |

Orden recomendado: 0 → 1 → 2 → 4, y después 3 en paralelo. Las fases 5 a 8 esperan a ver si hay uso. El donativo (parte de la 7) puede adelantarse a la Fase 2 sin tocar nada más.

## 8. Costos estimados

| Concepto | Costo aproximado (verifica) |
|---|---|
| Dominio | ~12 USD al año |
| Vercel Hobby | 0 (solo no comercial); Pro ~20 USD al mes si cobras |
| Upstash Redis y proveedor de cuentas | 0 en los niveles gratuitos mientras haya poco uso |
| Analítica | 0 a ~9 USD al mes |
| Sandbox remoto (Fase 8) | Variable; se mide en la Fase 6 y 8 |

## 9. Pendientes por decidir

1. Nombre y dominio de la marca común.
2. ¿Versión en inglés de la portada desde el lanzamiento?
3. ¿Historia del repositorio: publicar la actual o empezar un repositorio nuevo con un solo commit inicial? (Ver sección 10.)

Decididas: licencias (CC BY-NC-ND 4.0 para el contenido, MIT para el código), PDF abiertos sin pedir correo, repositorio completo.

## 10. Resultado de la Fase 0

**Hecho**
- El Atlas de Arquitecturas está integrado en esta rama (merge limpio, sin conflictos); ya trae su `vercel.json`. Falta llevar la rama a `main`.
- Auditoría del árbol de trabajo y del historial (todas las ramas): **cero secretos reales**. Los dos hallazgos de patrón son texto didáctico («github_pat_…», «ghp_…» explicando formatos de token). `.env.example` solo tiene nombres de variables vacíos; ningún `.env` ni `.vercel/` se subió jamás.
- Rutas personales: 10 archivos internos (briefs de generación de las hojas y el manifest del laboratorio Iris) tenían tu ruta local; se cambiaron por `~` y `-Users-USER-`. El nombre de tu equipo de Vercel en el README del tablero pasó a `<tu-equipo>`. Quedan solo ejemplos genéricos en el contenido (`/Users/<tú>/…`).
- `.gitignore` raíz ahora cubre `.env*`, `.vercel/`, `node_modules/` y `.DS_Store`.
- `LICENSE` (MIT) y `LICENSE-CONTENIDO.md` (CC BY-NC-ND 4.0) agregados.

**Pendiente de tu decisión o de tu mano**
- **Historia del repositorio.** Tu correo `erikpalacios587@gmail.com` aparece en los 148 commits y la historia incluye las rutas ya limpiadas y varias versiones de PDF de ~6 MB. Opciones: (a) publicar tal cual y usar un correo `noreply` de GitHub desde ahora; (b) crear un repositorio nuevo con un commit inicial limpio y conservar este como archivo privado. Recomiendo (b): es más liviano y no expone nada, a costa de perder el historial público.
- **Datos del C01 en el tablero.** `seed-c01.mjs` y las pruebas contienen el estado real de tu proyecto Caso1 (mediciones, decisiones). No es secreto, pero es tuyo: decide si se queda en el repositorio público o se cambia por el proyecto de ejemplo de la Fase 3.
- **Comprar el dominio** (lo haces tú; no puedo comprar por ti) y elegir el nombre.
- **Cambiar `source_dir`** del manifest de Iris no afecta el build: usa la variable `IRIS_LAB` cuando quieras volver a tomar la copia desde tu carpeta de Caso1.

## 11. Resultado de la Fase 1 (2026-11-02)

Las cuatro apps abren en producción, en direcciones `*.vercel.app` (los subdominios propios esperan al dominio):

| App | Dirección | Notas |
|---|---|---|
| Ronda de Diseño ML | https://ronda-diseno-ml.vercel.app | ya estaba publicada; responde 200 |
| Cheat sheets | https://cheat-sheets-ml.vercel.app | `npm run check` pasa (celular, tablet, oscuro, sin conexión) |
| Laboratorio Transformer | https://laboratorio-transformer.vercel.app | `apps/transformer-lab/vercel.json` nuevo; cabeceras de seguridad básicas |
| Atlas de Arquitecturas | https://atlas-arquitecturas.vercel.app | proyecto nuevo en Vercel; sirve `dist/web` con `/lab/` y service worker |

Detalles a recordar:
- El proyecto `laboratorio-transformer` de Vercel tiene como *Root Directory* `apps/transformer-lab`: se despliega **desde la raíz del repositorio** (`npx vercel deploy --prod`), no desde la carpeta. El Atlas y las cheat sheets se despliegan desde su carpeta.
- El enlace de Vercel en la raíz (`.vercel/`) no se versiona.
- **Hallazgo importante:** el repositorio de GitHub (`ErikPalacios/ML_from_scratch`) **ya es público**, con todo el historial de `main`. Subir esta rama publica también las 55 commits del Atlas. Por eso la decisión de la historia (sección 10) cambia: publicar un repositorio nuevo no esconde lo que ya está en el actual.

Pendiente de la Fase 1: chequeos de celular y modo oscuro del Atlas y del laboratorio Transformer (los de las cheat sheets ya pasaron), y subir la rama.

## 12. Resultado de la Fase 2 (2026-11-02)

**Hecho y en producción**
- **Portada común** (`apps/portada`, proyecto de Vercel `ml-desde-cero`): https://ml-desde-cero.vercel.app. Tarjetas de las cuatro apps y el tablero («Próximamente»), tres rutas de «por dónde empezar», enlace para reportar errores (issues de GitHub), pie con licencia y **aviso de privacidad** (`/privacidad/`). Datos en `apps/portada/site.json`; el nombre «ML desde cero» es de trabajo y se cambia ahí.
- **SEO en todas las apps:** dirección canónica, Open Graph y Twitter Card, `robots.txt` y `sitemap.xml` (curso, hojas con una URL por hoja, atlas, laboratorio y portada). Imagen para redes de 1200×630 por app, generada con `npm run og` (en `apps/portada`).
- **Atribución visible:** pie con nombre, licencia y enlace en la portada y en cada hoja. Los PDF ya generados no cambian.
- Chequeos del navegador de cheat sheets, Atlas, curso y laboratorio: sin errores.

**Pendiente de tu mano**
1. **Activar Vercel Web Analytics** en el proyecto `ml-desde-cero` (Vercel → proyecto → Analytics → Enable). La portada ya trae el script; hasta que lo actives, esa petición da 404 sin efecto. Si quieres medir también las otras apps, hay que activarlo en cada proyecto y agregar el mismo script a sus builds.
2. **Probar cómo se ve el enlace compartido** (LinkedIn Post Inspector, X, WhatsApp) y que Google Search Console reciba los sitemaps cuando haya dominio propio.
3. **Aviso de privacidad:** es un resumen en lenguaje sencillo, no asesoría legal; revísalo antes del lanzamiento público.

**Queda para después (fuera de lo hecho)**
- Marcas ocultas por hoja (la prueba de copia del plan, sección 4.5).
- Atribución en el curso, el atlas y el laboratorio (son aplicaciones de una sola página).
- Cuando haya dominio propio: cambiar `SITE_URL` en los cinco builds y las URLs de `site.json`.

## 13. Resultado de la Fase 3 (2026-11-02)

**Demo del tablero en producción:** https://tablero-ml-demo.vercel.app (`apps/tablero-demo`, proyecto de Vercel `tablero-ml-demo`). Enlazada desde la portada.

Cambio respecto al plan: en vez de «solo lectura», la demo es **editable pero privada para cada visitante**. Corre el mismo tablero contra un «servidor» dentro del navegador (localStorage), con un proyecto de ejemplo inventado; lo que se edita no sale del navegador y hay un botón «Reset demo». Es más convincente para quien la prueba y no necesita backend ni base de datos (costo cero).

- **Tus datos no viajan:** el build reemplaza `seed-c01.mjs` (el estado real de Caso1) por un módulo vacío y no copia `seed-c01-v1.mjs`. Una prueba revisa que nada de Caso1, rutas, secretos ni tu nombre (salvo el enlace al repositorio) aparezca en `dist/`. En producción se verificó en vivo: 0 coincidencias y `/api/*` responde 404.
- **Pruebas:** 7 de la demo (proyecto válido y coherente, API del navegador con el entry gate, crear/duplicar/borrar, SEO y orden de scripts) y 22 del tablero (se agregó una de sintaxis de todos los módulos del navegador). Se probó a mano en navegador real: lista, mapa, edición, reinicio, celular y consola sin errores.
- **Error evitado:** al mover los textos de la tarjeta «Load C01» a `seed-c01.mjs` se me coló un `''` dentro de una cadena y rompió `app.js`. Lo encontré probando en el navegador, lo corregí y agregué la prueba de sintaxis (las pruebas de la API nunca cargaban `app.js`). Producción no se había desplegado con ese error.
- **Placeholder personal quitado:** el campo «Repo» de «New project» sugería `~/Documents/ProyectosPortafolio/Caso14`; ahora dice `~/projects/receipt-api`.

**Pendiente de tu decisión (sigue igual):** el tablero real (`apps/tablero-ml`) y su README siguen mencionando Caso1 y el código fuente trae `seed-c01.mjs` con tus mediciones. Como el repositorio ya es público, eso ya está visible en GitHub; decide si lo dejas o lo sacas del repositorio.
