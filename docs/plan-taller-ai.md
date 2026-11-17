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
  - **La rama LLM/RAG se fusionó con la rama IA Privada (2026-11-12).** Es una sola rama, planeada en [plan-ia-privada.md](plan-ia-privada.md), sección 6: cubre el patrón LLM/RAG (C11) completo y además el serving en hardware propio. Así no se construyen dos veces el serving del LLM ni el RAG.
  - **Cómo vive una rama en el Dojo (2026-11-16):** en `content/ramas.json`, con su id, nombre, patrón, caso de referencia y estaciones (num, id, título, qué sale, etapa de la T explícita y dónde corre). La página de una estación de rama es `/<rama>/<estación>/`; en el tablero, las estaciones de rama van agrupadas por rama, debajo del tronco. El molde, los kits y el formato de `progreso.json` son los mismos.
  - Los modelos son chicos para que corran en la Mac: un LLM de unos 0.5–1.5 B parámetros y embeddings pequeños. Los modelos exactos se eligen y verifican en la fase de esa rama. La rama IA Privada además usa una GPU rentada por horas en algunas estaciones.
- **Orden propuesto de las ramas:** IA Privada (que incluye LLM/RAG) primero, por interés y por negocio; después batch, asíncrono, híbrido, streaming y edge. Se puede cambiar.
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
- La rama LLM/RAG y la rama IA Privada son una sola (2026-11-12), planeada en [plan-ia-privada.md](plan-ia-privada.md).
- El progreso va en el tablero de cada persona, local primero y sincronizado cuando haya cuentas.
- Fashion-MNIST para la estación 1 (cualquier dataset sirve; este tiene ambigüedad real y es ligero).

## 11. Pendiente de decidir

- El nombre de la app.
- Si el Taller sale en la portada pública desde la fase 3 o espera a tener más estaciones.

## 12. Estado (16 de noviembre de 2026)

La estación 1, «Datos y etiquetas», cubre las fases 1 a 3 en `apps/taller-ai`. Está en producción desde el 3 de noviembre en https://taller-ai-engineer.vercel.app (proyecto `taller-ai-engineer`, sin Git conectado) y la portada ml-desde-cero la enlaza.

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
- **Prácticas desde cero (3 de noviembre):** la estación 1 trae dos prácticas sin kit, cada una con su página. En «Antes de producción» se arma un dataset de 10 fotos (playera y tenis, 3/1/1 por clase): recolectar, guía v1, Label Studio, `labels.csv`, splits estables, contrato, ficha, DVC sobre el S3 local, recuperar y entrenar con linaje. «En producción» sigue en la misma carpeta: llegan 11 publicaciones con la clase nueva bolsa, una foto repetida del test y un error de quien vende; se arma la cola con presupuesto 8, guía v2, `dataset-v2` sin mover el test, `modelo-v2` comparado con el mismo examen y `modelo-v1` reproducido desde su tag. Los scripts probados están en `kits/c01-desde-cero-solucion/`; `probar.sh` las corre de punta a punta y las salidas de las páginas salen de ahí. El etiquetado en Label Studio se probó también a mano.
- **Diseño Dojo (3 de noviembre):** la página de la estación 1 y sus dos prácticas usan el diseño «Dojo Estacion 01» de Claude Design (marca TrueML, franja de 6 colores, la T de vidrio con la etapa de la estación encendida, tarjetas, rondas en cuadrícula construir/romper × con ayuda/solo). Las páginas se generan del mismo contenido; la T sale de `tools/trueml-mark.js` al construir, sin React.
- **Estación 7, Empaquetado (Docker) (4 de noviembre):** el kit es el servicio de Iris de tu laboratorio de Docker (gateway + model server v2, código y modelo tal cual). La persona escribe dependencias fijadas, `.dockerignore`, los dos Dockerfiles, `compose.yaml` y el push a un registry local en `localhost:5050` (el 5000 lo ocupa AirPlay). Se probaron de verdad los pasos que en el lab estaban en borrador (Compose con healthcheck, registry y digest). `verificar.py` tiene 9 checks y `romper.py` 6 fallas: puerto ocupado, URL localhost, basura en el contexto, modelo roto, registry caído y tag pisado. Cada falla se probó metiéndola, viendo que el check la detecta y cerrándola con su arreglo documentado. AWS quedó fuera porque sin cuenta no se puede probar. `kits/c01-empaquetado-solucion/probar.sh` y `probar-fallas.sh` repiten las pruebas.
- **Portada Dojo y nombre nuevo (4 de noviembre):** la portada usa el diseño «Dojo TrueML»: hero con la T grande y etiquetada (fija a la derecha en escritorio), qué es C01, las 12 estaciones agrupadas por etapa de la T (al pasar el cursor se encienden en la T), el mapa en anillo del diseño (en el celular, el vertical de la cheat sheet con los mismos colores) y «Cómo se usa el dojo». La app se llama ahora «Dojo de entrenamiento ML engineer's» en títulos, textos, prompts, kit y README; la URL, la clave `taller-tema`, `taller/progreso.json` y las credenciales de prueba del kit no cambian. `site/style.css` se borró: todas las páginas usan `dojo.css`.
- **Estación 7: pull y pesos dentro o fuera (4 de noviembre):** dos pasos nuevos al final del Guiado.
  - **Paso 9, «Bajar del registry».** Un «servidor» en `servidor/` que solo tiene `compose.yaml` (con `image: localhost:5050/…`, sin `build`) y su copia de `config.env`. Primero se borran las etiquetas `localhost:5050/…` y se bajan con `docker pull`: el digest coincide con el del push. El gateway se publica en 8081 y el model server no se publica. También se muestra el error real de pedir `--platform linux/amd64` (la Mac solo construyó arm64), que es justo lo que resuelve la 7.1.
  - **Paso 10, «Pesos dentro o fuera: la comparación».** `model_server/Dockerfile.volumen` sin `COPY model_repository`, con el contexto solo en `model_server/`. Se comparan las imágenes: 103.8 MB contra 103.8 MB comprimida, una diferencia de 1.6 kB, porque el modelo pesa 1.3 kB. Sin volumen el contenedor muere al arrancar; con `-v …:/models:ro` queda listo en 9001. Hay un precálculo nuevo, «pesos», con la cuenta parámetros × bytes: un ResNet-50 en FP16 pesa ≈ 51 MB y un LLM de 7 B, 14 GB.
  - `verificar.py` pasa de 9 a 11 checks (`pull`, `volumen`) y la ronda Solo de 9 a 11 objetivos. Hay 2 conceptos nuevos (pull en el servidor y plataforma arm64/amd64) y una pregunta de entrevista. `reiniciar.py` también baja el servidor y borra `iris-volumen` y la imagen sin modelo. `probar.sh` corre los 11 pasos en limpio (11/11) y `probar-fallas.sh` sigue detectando y cerrando las 6 fallas.
- **Estación 7.1, Empaquetado en AWS (planeada, falta cuenta de AWS):** el mismo proceso que la 7, pero con ECR como registry y una EC2 chica como servidor. La 7.1 se queda en la etapa Contenedor; ECS y EKS caen en las estaciones de Orquestación (9–10).
  - **Antes de empezar:** la persona instala el AWS CLI e inicia sesión ella misma, porque Claude no mete credenciales. Al final se borra todo lo creado, y la estación trae el comando que lo comprueba.
  - **Pasos tentativos:**
    1. Precálculos de costo: almacenamiento en ECR, horas de EC2 y transferencia.
    2. `aws ecr create-repository` con tags inmutables y escaneo al subir.
    3. `aws ecr get-login-password | docker login`.
    4. Build multiplataforma con `docker buildx build --platform linux/amd64,linux/arm64 --push`, o solo la de la EC2, y revisarla con `docker buildx imagetools inspect`.
    5. Push y comparar digests.
    6. Una EC2 con un rol de IAM de solo lectura a ECR (sin llaves en la máquina), con Docker y compose.
    7. Pull en la EC2, por tag y por digest.
    8. La pila arriba con el `servidor/compose.yaml` apuntando a ECR, y el security group abierto solo al gateway.
    9. Limpiar: terminar la EC2, borrar los repositorios, el rol y el security group.
  - **Fallas candidatas:** tag inmutable rechazado, token de login vencido (dura 12 h), rol sin permiso de ECR, plataforma equivocada y security group cerrado.
  - Como con todo, solo salidas reales: se arma cuando haya cuenta.

- **Fase 4, «Tu tablero» (15 de noviembre):** la página `/tablero/` del Dojo, sin cuenta ni servidor. Está en producción en https://taller-ai-engineer.vercel.app/tablero/; el BUILD de `/sw.js`, el sha de los dos kits y los archivos del tablero coinciden con `dist/`. Corre en el navegador, se guarda en localStorage y abre sin conexión.
  - **Un solo JSON por app.** Todo el avance de la persona es un documento (`app: "dojo-tablero"`, `v: 1`), con fecha y hora ISO (UTC) en cada avance. Es el formato que se va a sincronizar cuando haya cuentas.
  - **Plantilla del Dojo.** Cada estación con taller tiene sus 4 rondas, siempre con su nombre completo: Construir con ayuda, Construir solo, Romper con ayuda y Romper solo. Cada una está pendiente, en curso o hecha, con su inicio y su fin. Además, cada estación guarda sus fallas (minutos, pistas, si te rendiste y qué aprendiste), su bitácora y las últimas 30 corridas de `verificar.py`, que marcan los objetivos de Construir solo. Entran las estaciones 1 y 7; las otras 10 salen como «próximamente». La T del hero enciende cada etapa según las rondas hechas en sus estaciones.
  - **El motor del tablero, reusado.** Cada cambio es una op del motor de `apps/tablero-ml` (`set`, `insert`, `remove`), validada con sus mismas reglas. Al motor se le hizo un cambio chico: `ops.mjs` acepta otro esquema (`opts.schema`) y `model.mjs` exporta `checkShape`. Con eso, el tablero de proyectos no cambia: sus 22 pruebas y las 7 de la demo pasan, y no hizo falta redesplegarlo. El Dojo lleva una copia en `site/tablero/motor/` (`tools/motor.mjs`), y `npm run check` avisa si se desfasa.
  - **Cambio contra la sección 6.** No se agregaron las vueltas 3 y 4 al modelo del tablero de proyectos. Sus pasos traen gate, cálculos y textos en inglés que no le sirven al Dojo, así que el Dojo tiene su propio documento sobre el mismo motor. La «migración al leer» es `migrar()`: suma las estaciones y rondas nuevas de la plantilla sin tocar lo tuyo.
  - **El kit marca el avance solo.** Cada kit trae `taller/registro.py`. `verificar.py` anota cada corrida en `progreso.json` (qué checks pasan y cuáles no), y `romper.py` cada falla que cierras con `--verificar` o `--revelar`, con su inicio, su fin y los minutos reales. `--restaurar` no anota nada. El `CLAUDE.md` de los dos kits pide fecha y hora ISO con la zona (`date -Iseconds`) y que Claude complete `pistas` y `aprendi` en la falla que dejó `romper.py`, sin duplicarla.
  - **Importar.** Se puede subir el archivo o pegar su texto. Importar el mismo archivo dos veces no duplica nada, porque los ids salen del contenido, y gana el estado más avanzado de cada ronda. Lo que anotaste en el tablero no se pierde al reimportar. Un `progreso.json` con fechas sin hora se sigue leyendo: quedan a mediodía UTC. También se exporta el respaldo completo y se importa en otro dispositivo.
  - **Nombres.** Las páginas de estación y la portada ahora nombran las rondas completas: la de estación enlaza a su tarjeta en el tablero y el paso 05 de la portada lleva al tablero. Las secciones «Guiado» y «Solo» siguen con su nombre: son el material de Construir con ayuda y de Construir solo, y el tablero lo explica.
  - **Pruebas.** `tools/test-tablero.mjs` (12 pruebas del modelo, el motor y la importación) corre dentro de `npm run check`. El check también importa en Chrome un `progreso.json` de la estación 7 en 375, 768, 1024 px y oscuro: revisa que las rondas queden marcadas, que reimportar no cambie nada, que la T se encienda y que nada se salga de ancho con todo abierto. Además revisa que el tablero arranque sin conexión.
  - **Prueba de punta a punta (15 de noviembre).** `probar.sh` corrió el Guiado de la estación 7 en limpio (11/11) y `probar-fallas.sh` metió y cerró sus 6 fallas con `romper.py --mostrar` y `--verificar`. Con eso, el `progreso.json` real quedó con las 6 fallas en Romper con ayuda (inicio, fin y minutos reales) y 19 corridas de `verificar.py`. Después se hizo a mano la parte de Claude Code (una nota de bitácora y lo aprendido en una falla) y se importó pegándolo en el tablero. Quedaron Construir con ayuda y Romper con ayuda en curso, 11/11 objetivos en verde, 6 de 6 fallas arregladas y la nota en la bitácora. Esa prueba encontró dos corridas de `verificar.py` en el mismo segundo que se juntaban en una: ya se corrigió. Lo que falta es una ronda hecha por una persona, que es la fase 5. En esta Mac, `docker run registry:2` se volvió a colgar en `docker-credential-desktop`; se corrió con un `DOCKER_CONFIG` temporal sin `credsStore`.

- **Estación 2, Versionado y linaje (15 de noviembre):** las fases 1 a 3 de una estación nueva en una sola sesión, en la rama `claude/dojo-estacion-2-fc51ca` (sale de la de la fase 4), sin merge a main. En producción en https://taller-ai-engineer.vercel.app/c01/versionado/; el BUILD de `/sw.js` (`99f7c8d64f06`), el sha de los tres kits y las páginas coinciden con `dist/`.
  - **El mundo:** el marketplace de C01 a principios de octubre de 2026. `mundo/crear.py` crea con semilla fija, en ≈ 10 s, 3,120 publicaciones de abril a septiembre con fotos de juguete de 64×64 (≈ 2.3 kB, el color y la forma dependen de la categoría; sin descargas), 3,908 eventos de labels (quien vende, moderación y humano; 112 después del corte), un golden set de 280 huellas, un registro de borrados (las 14 fotos de una vendedora) y el snapshot de agosto `ds-2026-08-01` publicado por el equipo, con la corrida del modelo de septiembre. El S3 local es RustFS en 9300/9301 (sin choque con 9100/9101, 9200/9201, 8080/8081/5050/9000/9001) con dos buckets: `fotos` y `ml-datos` (con versionado). El mundo es determinista: dos corridas limpias dan el mismo `rows_sha256`.
  - **Lo que escribe la persona:** 7 pasos (labels al corte con la regla de 30 días, manifest, filas sin borrados/duplicados/golden con split por hash del vendedor, contrato de datos con 8 reglas, publicar con `If-None-Match: *` y la tarjeta al final, entrenar comprobando cada huella y dejando los punteros, y el linaje al revés) y `dvc.yaml` con los pasos 1 a 5 como DAG. DVC se usa para el DAG y su caché (sin remote): es el sustituto del orquestador. La práctica desde cero de la estación 1 ya enseña `dvc add`/`push`/`pull`.
  - **Contenido:** 18 conceptos, 5 precálculos en las dos escalas, 9 pasos del Guiado (0–8) con salidas reales, 12 objetivos, 7 fallas, 6 preguntas de entrevista y los 4 prompts con las rondas por su nombre completo. Las salidas no se copian a mano: `kits/c01-versionado-solucion/contenido.py` arma el JSON desde los logs de `probar.sh` y `probar-fallas.sh`.
  - **Fallas:** snapshot pisado (borrar la versión mala), tarjeta borrada (quitar la marca de borrado), versionado suspendido, `latest` en el entrenamiento, umbral del split movido (la validación detiene la publicación; la caché de DVC recupera la salida), labels reentregados (412 al publicar → id nuevo `ds-2026-09-01-r2`) y fotos borradas sin anotar (se agregan al registro de borrados, que se lee al corte). `probar-fallas.sh` mete cada una, ve que su check la detecta, aplica el arreglo documentado, la cierra con `romper.py --verificar` y prueba que `--restaurar` deja 12/12 en verde.
  - **Pruebas:** `probar.sh` corrió el Guiado en una carpeta limpia con el venv de `requirements.txt` sobre Python 3.14.3: 12/12. `npm run check` pasa (375/768/1024, oscuro, tema, sin conexión y las 13 pruebas del tablero). La estación aparece sola en la portada y en «Tu tablero». `node apps/trueml/sync.mjs` la marcó como lista en `apps/portada/data/dojo.json` y `apps/sensei/content/dojo.json`, pero esas dos apps **no se redesplegaron**.
  - **Revisión de hechos** contra la documentación de AWS S3, DVC, Kubeflow, RustFS y lakeFS: los 14 puntos se sostienen. Un matiz entró al contenido y se probó en RustFS: con versiones, `If-None-Match` solo mira la versión vigente, así que un PUT condicional pasa si la vigente es una marca de borrado. RustFS no acepta la condición `s3:if-none-match` en una política del bucket (se probó): en el dojo la escritura condicional depende del código, y la página lo dice.
  - **Para revisar en la fase 5 (lo que del molde se vio débil al copiarlo):**
    - Las pruebas del tablero tenían fijas las dos estaciones y sus posiciones (`estaciones[1]`); ya buscan por id y sacan la lista del contenido.
    - `build.mjs` excluye del .zip solo `data/`, `.taller/`, `.venv/`…: si alguien corre el mundo dentro de `kits/` (aquí crea `entrada/` y `corridas/`), se empaqueta. Convendría una lista de exclusión por kit.
    - `GUION.md` y `OBJETIVOS.md` (los arma `build.mjs`) siguen diciendo «Ronda Guiado» y «Ronda Solo», mientras los prompts dicen Construir con ayuda y Construir solo.
    - Un kit con estado en git (aquí `params.yaml`, `dvc.lock`, `entrada/`): `romper.py --restaurar` devuelve esos archivos y el árbol queda con cambios sin commit; `romper.py` lo avisa, pero el molde no dice qué hacer con el git de la persona.
    - El molde pide la cuenta de C01 en cada precálculo; cuando C01 no publica el número, se usó el rango que da la regla (el volumen).

- **Preparar las ramas (16 de noviembre):** el Dojo ya acepta estaciones de rama además del tronco C01, sin ninguna estación de rama todavía. En la rama `claude/intelligent-tesla-434434` (sale de `claude/dojo-estacion-2-fc51ca`), sin merge a main.
  - **`content/ramas.json`:** por rama, su id, nombre, patrón, caso de referencia, la etiqueta de su escala y sus estaciones (num, id, título, qué sale, etapa de la T y dónde corre). Trae IA Privada con sus 8 estaciones, todas «próximamente», y el camino sin GPU: 1 → 5 → 6, un proyecto de RAG completo en la Mac ([plan-ia-privada.md](plan-ia-privada.md), sección 6).
  - **Las líneas (`tools/lineas.mjs`):** una estación es del tronco (`caso`) o de una rama (`rama`), nunca de las dos. De su línea salen su URL (`/<línea>/<estación>/`), su slug (el id en el tablero y el nombre del kit), cuántas estaciones tiene la línea y la etiqueta de su escala. La etapa de la T se toma de la estación cuando la trae (`etapa`); en el tronco sigue saliendo del número con los rangos del C01. El build, el tablero, `validate.mjs`, `check.mjs` y `apps/trueml/sync.mjs` ya no filtran por `caso === "c01"`.
  - **La escala de referencia:** el campo `c01` de los precálculos y del mapa ahora se llama `ref`, y su etiqueta sale de la línea («En C01» en `tronco.json`, «En el despacho» en la rama). `c01` se sigue aceptando como alias: las estaciones 1, 2 y 7 no se reescribieron, y `normalizar()` (en `schema.mjs`) lo copia a `ref` al construir. Las 6 páginas de estación y los 3 kits salen idénticos, byte por byte, a los de producción.
  - **Sensei:** `content/sensei.json` lleva la línea de cada estación (`"linea": "c01"`), y el Dojo lo busca por línea y número. Así la estación 1 de una rama no recibe la lección de la estación 1 del C01.
  - **Portada:** una sección «Ramas» en diseño Dojo, entre las estaciones y «Cómo se usa». Cada rama va en una tarjeta con su patrón, la T chica con sus etapas, el caso de referencia, el camino sin GPU y sus estaciones con su etapa, dónde corren y si están listas. «Los otros patrones» ahora dice que la primera rama es IA Privada.
  - **Tablero:** las estaciones van agrupadas por línea (el tronco C01 primero y después cada rama), igual que la lista de «próximamente». El documento no cambió: el id de cada estación es su slug, así que un tablero de antes se lee tal cual y `migrar()` solo suma las estaciones nuevas.
  - **`sync.mjs`:** `apps/portada/data/dojo.json` y `apps/sensei/content/dojo.json` llevan ahora también `ramas`, con el avance de cada una. Lo de antes no cambió, así que la portada y Sensei no necesitan redesplegarse por esto.
  - **Pruebas:** `tools/test-tablero.mjs` pasa de 13 a 19 pruebas: `ramas.json` (incluido que 1, 5 y 6 corran solo en la Mac), la etapa de la T de la estación, el molde con `caso`/`rama` y el alias `c01`, la plantilla agrupada y la migración de un tablero del C01 con avance (rondas, fallas, bitácora, verificaciones e historial) a la plantilla con una estación de rama, sin perder nada; también importar el `progreso.json` de un kit de rama. Aparte, se armó fuera del repo una copia con una estación de rama de prueba (`/ia-privada/rag/`): la página, el kit, el GUION.md con «En el despacho», la T con su etapa y el tablero agrupado salieron bien.

Siguiente: la fase 5. Haces las 4 rondas de la estación 1 con los prompts e importas tu `progreso.json` en el tablero; se ajusta lo que falle del molde (incluidos los puntos de arriba). Después, redesplegar la portada y Sensei para que enlacen la estación 2. La sincronización con cuentas sigue esperando la Fase 5 del plan de lanzamiento: el documento y las ops ya están listos para mandarse a una API.
