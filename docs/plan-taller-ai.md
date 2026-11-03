# Plan: Taller de AI Engineer

Nombre de trabajo: «Taller». Se cambia en un solo lugar cuando exista la app.

## 1. Qué es

Es una app para **entrenarse como AI Engineer** construyendo, rompiendo y arreglando proyectos chicos. Cada estación del mapa de C01 de la cheat sheet «Del dato a producción» se vuelve un segmento práctico.

Generaliza el método que funcionó con Docker y el lab de Iris:

1. Claude construye contigo, paso a paso.
2. Lo rehaces tú solo desde cero.
3. Se rompe y lo arreglan juntos.
4. Se rompe de nuevo y lo arreglas tú solo.

Todo queda registrado para repasarlo en el celular en tiempos muertos.

**La app es información, no ejecuta nada.** Trae conceptos, pasos, el código principal, comandos, prompts y el registro de tu progreso. El trabajo real pasa en tu máquina, en una sesión aparte de Claude Code, dentro de la carpeta del mini-proyecto.

## 2. Dónde vive cada cosa

| Pieza | Dónde | Por qué |
|---|---|---|
| La app | `apps/taller-ai` en este repo, proyecto de Vercel propio | Igual que las otras apps: estática, offline-first, con el encabezado común |
| Los kits («el mundo» de cada estación) | `apps/taller-ai/kits/<patrón>-<estación>/` y se descargan como .zip desde la app | Cualquiera que use la app puede bajarlos |
| Tus mini-proyectos | Fuera de este repo, por ejemplo `~/Documents/ML_from_scratch/taller/c01-datos/` | Ahí se borra, se rompe y se rehace sin tocar las apps |
| Tu progreso y tu bitácora | El tablero de cada persona dentro de la app (sección 6) | Una sola fuente de estado |

## 3. El molde de cada estación

Todas las estaciones tienen las mismas siete piezas.

1. **Mapa:** dónde está la estación en la línea, qué entra, qué sale y la pregunta que responde. Sale del contenido de la cheat sheet del recorrido.
2. **Conceptos exprés:** de 8 a 15 tarjetas. Cada una trae una definición de una línea en español con el término en inglés, una analogía correcta, por qué importa y la trampa. Lenguaje simple, sin quitar conceptos.
3. **Guiado:** el guion paso a paso. Cada paso trae el objetivo, el comando o el código principal, la salida esperada y el concepto que usa. Solo se muestran salidas reales que se corrieron al probar el kit.
4. **Solo:** solo objetivos y cómo se verifica cada uno, sin código. Las verificaciones son automáticas (`verificar.py`, sección 5).
5. **Romper con ayuda:** el catálogo de fallas. Cada falla trae síntoma, hipótesis, el comando que la confirma, el arreglo y el concepto que enseña.
6. **Romper solo:** el kit inyecta una falla al azar y no dice cuál. Tú la diagnosticas y la arreglas, y el kit te confirma si quedó bien.
7. **Prompts:** un prompt por ronda para pegarlo en Claude Code, más el `CLAUDE.md` del mini-proyecto (sección 4).

## 4. Los prompts para trabajar por fuera

Cada mini-proyecto trae un `CLAUDE.md` con las reglas fijas: qué es el mundo y qué es tu pipeline, qué archivos no tocar y cómo anotar en la bitácora. Así cada prompt es corto.

| Ronda | Lo que le pide el prompt a Claude |
|---|---|
| Guiado | Construir juntos paso por paso según el guion. Explicar cada concepto al usarlo. Esperar a que tú corras cada comando. Anotar cada paso en la bitácora. |
| Solo | No dar código. Solo correr `verificar.py`, decir qué objetivo falla y hacer preguntas, sin dar la respuesta. |
| Romper con ayuda | Correr `romper.py --mostrar` y guiarte con preguntas: síntoma, hipótesis y comprobación. Revelar el arreglo solo si lo pides. |
| Romper solo | Correr `romper.py`, que esconde la falla. Claude tampoco sabe cuál es. Al final, `romper.py --verificar` dice si quedó arreglado y cuál era. |

La falla escondida la elige el script y no Claude. Así el secreto no depende de que el modelo lo guarde.

Al final de cada ronda, el prompt pide escribir la bitácora en `taller/progreso.json` y `BITACORA.md`, con lo que hiciste, lo que mediste, lo que sigue y la falla con el tiempo que tardaste. Ese archivo se importa en tu tablero (sección 6).

## 5. Qué trae cada kit

- **El mundo:** lo que existe antes de tu pipeline, ya hecho y probado. Datos, simuladores, modelos y servicios en Docker Compose. No lo escribes tú.
- **El esqueleto de tu pipeline:** archivos vacíos con el objetivo de cada paso. Esto sí lo escribes tú.
- **`verificar.py`:** revisa los criterios de «listo» de la estación. Se usa en la ronda Solo y para confirmar los arreglos.
- **`romper.py`:** inyecta fallas con una semilla. Tiene tres modos: al azar y escondida, `--mostrar` y `--verificar`.
- **`CLAUDE.md`, `BITACORA.md` y `taller/progreso.json`.**
- **Restricción:** todo corre en una MacBook Air M4 sin GPU ni nube, con costo cero. Los servicios de nube se sustituyen por equivalentes locales: MinIO en lugar de S3, kind o k3d en lugar de EKS. La guía dice qué cambia en la nube real.

## 6. El tablero de cada persona

Sigue la decisión 4.1 del plan de lanzamiento: **todo funciona sin cuenta, y la cuenta solo sirve para sincronizar.**

- **Sin cuenta (desde el inicio):** «Tu tablero» corre dentro de la app con el mismo motor del tablero, igual que la demo pública. Es un servidor dentro del navegador que guarda en localStorage, usa las mismas operaciones y funciona offline. Lleva una plantilla del Taller: por estación, el estado de las 4 rondas, la bitácora y las fallas con su tiempo.
- **Importar desde Claude Code:** un botón que lee el `taller/progreso.json` del mini-proyecto. También se puede exportar e importar el JSON completo.
- **Con cuenta (Fase 5 del plan de lanzamiento):** el mismo JSON se guarda por persona y se sincroniza entre Mac, celular y tablet. Cada persona tiene un token restringido para que Claude Code escriba directo en su tablero, como `/api/claude/<id>` del tablero actual.
- **Cambio al motor:** hoy cada paso del tablero tiene solo `v1` y `v2` (guiado y solo). El Taller necesita 4 vueltas, con migración al leer, igual que la v2. El gate de cálculos de entrada del modo producción no aplica al Taller: la plantilla lo apaga.

## 7. El tronco y las ramas

- **Tronco: C01 completo (patrón síncrono, 12 estaciones).** Aquí se aprende lo que comparten todos los patrones.
  1. Datos y etiquetas
  2. Versionado y linaje
  3. Entrenamiento
  4. Gate de evaluación y registry
  5. Export, engine y paridad
  6. Código de serving
  7. Empaquetado (Docker)
  8. CI/CD y registro de imágenes
  9. Kubernetes
  10. Rollout seguro
  11. La request en vivo
  12. Monitoreo y reentrenamiento
- **Ramas: un mini-proyecto por patrón.** Los patrones son batch (C14), LLM/RAG (C11), streaming (C13), edge (C03), asíncrono y híbrido.
  - La cheat sheet del recorrido ya marca, por patrón, qué estación «cambia», «desaparece» o queda «igual».
  - En la mayoría de los patrones casi todas las estaciones «cambian» en algo. Por eso la rama no repite las 12. Elige las **4 a 6 estaciones donde la habilidad es de verdad otra**; en las demás, la app solo pone una nota de qué cambia respecto al tronco.
  - Ejemplo para LLM/RAG: ingestión y chunking, índice y embeddings, evaluación de retrieval, serving del LLM y guardrails.
  - Los modelos son chicos para que corran en la Mac: un LLM de unos 0.5–1.5 B parámetros y embeddings pequeños. Los modelos exactos se eligen y verifican en la fase de esa rama.
- **Orden propuesto de las ramas:** LLM/RAG primero, por interés; después batch, asíncrono, híbrido, streaming y edge. Se puede cambiar.
- **Relación con la Fase 6 del plan de lanzamiento (kata de Docker):** la estación 7 del tronco, Empaquetado, usa el lab de Iris. La kata con cronómetro puede vivir ahí en lugar de en las cheat sheets.

## 8. La estación 1, «Datos y etiquetas», en pequeño

- **El mundo:** un simulador de marketplace con semilla.
  - Usa imágenes de **Fashion-MNIST**. Son prendas, o sea productos, y Shirt, T-shirt, Pullover y Coat son ambiguas de verdad.
  - Trae un modelo chico entrenado **sin la clase Bag**, que aparece después como categoría nueva.
  - Genera ~30 días de logs de predicción en Parquet: `request_id`, `model_version`, top-k con scores y un prefijo del sha256.
  - Genera la categoría que eligió quien vende, con el feedback loop metido a propósito: acepta la primera sugerencia la mayoría de las veces.
  - Genera correcciones de moderación con su fecha.
  - Guarda las fotos como JPEG **con un EXIF falso que incluye GPS**, para que quitarlo importe.
  - Trae MinIO y Label Studio en Docker Compose.
  - Como el simulador conoce la verdad, el sesgo se puede medir.
- **Tu pipeline:** los 6 pasos de la estación.
  1. Juntar señales: unir por `request_id` con pandas o DuckDB.
  2. Filtrar el label débil: que moderación no lo haya corregido en 30 días, o que quien vende haya buscado en vez de aceptar la sugerencia.
  3. Elegir qué etiquetar: top-1 < 0.3 o margen chico, desacuerdos, 20–30 % al azar y categorías nuevas. Unas 300 imágenes.
  4. Copiar solo esas fotos a un bucket restringido, sin EXIF y con una regla de vencimiento.
  5. Etiquetar en Label Studio con una guía de casos límite. El 10 % lleva doble anotación; la segunda la hace un anotador simulado con ruido en las clases ambiguas.
  6. Medir el kappa por clase con scikit-learn, adjudicar los desacuerdos y congelar el golden set (~500).
- **Fallas:**
  - Las 4 de la cheat sheet:
    - La métrica offline sube, pero la aceptación no (feedback loop).
    - La guía es ambigua y el kappa sale bajo.
    - Se recortó la muestra al azar.
    - Llegó una categoría nueva sin ejemplos.
  - Técnicas:
    - Un join con una llave duplicada que infla filas.
    - Zona horaria mal en la ventana de 30 días.
    - El EXIF no se quitó.
    - El golden set se filtró al entrenamiento (hashes en común).
    - El export de Label Studio cambió de esquema.

## 9. Fases

Cada fase cabe en una ventana de 5 horas y termina con algo verificable.

| Fase | Contenido | Se considera lista cuando |
|---|---|---|
| **1 · Molde y contenido de la estación 1** | Esquema JSON del molde; conceptos, guion, objetivos, catálogo de fallas, 4 prompts y `CLAUDE.md`; revisión contra documentación oficial | El contenido valida contra el esquema y pasó la revisión de hechos |
| **2 · Kit de la estación 1** | Simulador, modelo, Compose (MinIO y Label Studio), esqueleto, `verificar.py` y `romper.py` | El guion corre de punta a punta en la Mac, cada falla se inyecta y se detecta, y las salidas del guion son reales |
| **3 · App: esqueleto y estación 1** | `apps/taller-ai`: portada de estaciones, página de estación, descarga del kit, botón para copiar prompts, offline y tema claro/oscuro | Pasa los chequeos de 375/768/1024 px, oscuro y offline |
| **4 · Tu tablero** | Motor del tablero en el navegador con la plantilla del Taller, 4 vueltas con migración, importar `progreso.json`, exportar e importar | Una ronda real hecha por fuera queda en el tablero con su bitácora |
| **5 · Primera vuelta real** | Haces las 4 rondas de la estación 1 con los prompts; se ajusta lo que falle | Las 4 rondas registradas y el molde corregido |
| **6 en adelante · Tronco** | Una estación por fase (2 → 12). Empaquetado reusa el lab de Iris | Igual que las fases 1–3, por estación |
| **Ramas** | Por patrón: una fase para elegir sus 4–6 estaciones y armar el kit; después, una fase por cada 1–2 estaciones | Igual |
| **Sincronización** | Llega con la Fase 5 del plan de lanzamiento (cuentas) | Tu progreso aparece igual en Mac y celular |

La fase 5 va antes de seguir con el tronco a propósito: probar el molde contigo antes de copiarlo 11 veces.

## 10. Decisiones tomadas

- La app vive en este repo; los mini-proyectos van fuera.
- La app es información y prompts; nada corre dentro de ella.
- Un mini-proyecto por patrón, con tronco y ramas.
- El progreso va en el tablero de cada persona, local primero y sincronizado cuando haya cuentas.
- Fashion-MNIST para la estación 1 (cualquier dataset sirve; este tiene ambigüedad real y es ligero).

## 11. Pendiente de decidir

- El nombre de la app.
- Si el Taller sale en la portada pública desde la fase 3 o espera a tener más estaciones.

## 12. Estado (3 de noviembre de 2026)

La estación 1, «Datos y etiquetas», cubre las fases 1 a 3 en `apps/taller-ai` y todavía no está desplegada.

- **Contenido:** 16 conceptos, 8 pasos del Guiado con salidas reales, 12 objetivos para la ronda Solo, 10 fallas, 4 preguntas de entrevista y los 4 prompts. Una revisión contra la documentación oficial encontró 12 correcciones y ya están aplicadas.
- **Kit:** usa RustFS en lugar de MinIO, porque MinIO archivó su repositorio y ya no publica imágenes. Se probó de punta a punta desde el .zip. Cada falla se detecta, su arreglo documentado pasa `romper.py --verificar` y `--restaurar` deja todo en verde. Las salidas se reproducen igual en dos corridas limpias.
- **App:** tiene portada y página de estación, y la descarga del kit. Pasa los chequeos de 375/768/1024 px, modo oscuro, tema y modo sin conexión.

Cambios contra el plan:
- La doble anotación es del 20 % en el taller y no del 10 %: con una cola de 800, el 10 % da un kappa por clase demasiado ruidoso.
- Los umbrales de incertidumbre son 0.5 y 0.15 y no los de C01: se calibraron con este modelo.
- Los puertos son 9100, 9101 y 8090, porque el 9000 y el 8080 ya los ocupan otros procesos de Python tuyos (probablemente el lab de Iris).

Agregado después:
- **Precálculos en cada estación:** las cuentas de servilleta antes de escribir código, en las dos escalas (C01 y el taller), con lo que decides con cada una. Cada cuenta se comprueba con un comando sobre el mundo recién creado (salida real) o apunta al paso del Guiado que la confirma. Están en el molde (`precalculos`), en la página, en el `GUION.md` del kit (entre el paso 0 y el 1) y en el prompt del Guiado. La estación 1 trae 7.
- **Portada:** qué es C01, el mapa de 12 estaciones copiado de la cheat sheet «Del dato a producción» (`tools/importar-mapa.mjs` → `content/mapa-c01.json`; las estaciones con taller abren su página y las demás su sección de la hoja) y cómo se usa el taller, paso a paso.

Siguiente: la fase 4 (tu tablero) y la fase 5 (tú haces las 4 rondas).
