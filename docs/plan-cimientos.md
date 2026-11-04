# Plan: Cimientos

Nombre de trabajo: «Cimientos». Se cambia en un solo lugar (`apps/cimientos/content/sitio.json`).

## 1. Qué es y por qué existe

Cimientos es la teoría desde cero de cada paso para llevar un modelo de AI o ML a producción. Lo explica como a alguien que apenas entra a la universidad, pero todo enfocado en AI y ML.

Existe porque el Dojo y la Ronda de Diseño están hechos para **practicar**, y por eso dan los conceptos por sabidos. Al entrar a una estación aparecen palabras que nadie explicó. Hay que salir a preguntar, y las respuestas quedan regadas en sesiones distintas. Cimientos es la capa de **entender**, antes de practicar.

| Herramienta | Para qué sirve |
|---|---|
| Cimientos | Entender cada paso desde cero: qué es, por qué existe, cómo se conecta con lo demás. |
| Dojo | Construir, rehacer y romper un mini-proyecto de ese paso. |
| Ronda de Diseño | Defender el diseño completo en una entrevista. |

## 2. Las reglas del contenido

1. **No asumir nada.** Cada concepto se explica antes de usarse. Si una lección menciona algo que se ve después, la palabra trae su definición corta en un globo y dice en qué lección se ve a fondo. El build cuenta estos casos y los reporta.
2. **Analogías donde ayuden, sin forzarlas.** Si un ejemplo directo explica mejor, va el ejemplo directo.
3. **Un diagrama por idea importante.** Los flujos muestran dónde cae el paso en el camino completo y qué entra y sale de él.
4. **El término en inglés al lado del español,** porque es el que vas a oír en el trabajo y en las entrevistas.
5. **Salir de la app lo menos posible.** Las palabras del glosario abren su definición ahí mismo, los requisitos de cada lección son enlaces dentro de la app, y las ligas externas son solo para profundizar.
6. **Cifras y hechos verificados** contra la documentación oficial, como en el resto de TrueML.
7. **Diseño Dojo de TrueML** (tokens `--tm-*`, la T de vidrio donde se vea natural). Funciona sin conexión y se lee bien en celular y tablet.

## 3. Las piezas de la app

- **La portada:** el mapa del camino completo y los módulos en orden, con tu avance.
- **Las lecciones:** todas con la misma forma.
  1. La pregunta que responde y lo que necesitas saber antes, con enlaces.
  2. La idea en una frase.
  3. El cuerpo: explicación, analogía si ayuda, diagramas y ejemplos con números.
  4. «Palabras que vas a oír»: los conceptos nuevos de la lección.
  5. Un chequeo de 3 a 5 preguntas con la respuesta escondida.
  6. Lo que sigue, y la estación del Dojo donde lo practicas.
- **El glosario:** cada concepto vive en un solo lugar, con su definición corta, la explicación, la analogía, los conceptos relacionados y las lecciones que lo usan. Se puede buscar.
- **La regla de las dudas:** cuando surja una duda en una sesión del Dojo o de la Ronda, la respuesta se agrega o mejora en el glosario de Cimientos. Así el glosario se vuelve el cuaderno único.

## 4. Cómo se escribe el contenido

| Archivo | Qué es |
|---|---|
| `content/sitio.json` | Nombre, dirección y textos de la portada. |
| `content/temario.json` | Los módulos y sus lecciones en orden, con su etapa de la T y la estación del Dojo. |
| `content/glosario.json` | Todos los conceptos. |
| `content/lecciones/<id>.md` | Cada lección en Markdown, con bloques propios: `:::idea`, `:::analogia`, `:::ojo`, `:::ejemplo`, `:::diagrama`, `:::figura`, `:::conceptos`, `:::chequeo`. Una palabra del glosario se marca como `[[id]]` o `[[id\|texto]]`. |
| `content/diagramas/<id>.json` | Diagramas de flujo en un formato simple (nodos y flechas). El build dibuja una versión horizontal para pantallas anchas y otra vertical para el celular. |
| `content/figuras/<id>.svg` | Figuras hechas a mano, con los colores de los tokens para que se vean bien en claro y en oscuro. |

El build revisa que cada `[[id]]` exista en el glosario y cuenta las palabras que se usan antes de su lección.

## 5. Las fases

Cada fase termina con la app construida, revisada en el navegador (375, 768 y 1024 px, claro y oscuro, sin conexión) y con commit. El despliegue se pide aparte.

| Fase | Qué trae | Lecciones |
|---|---|---|
| 1 | El motor: build, diseño, glosario con globos, diagramas, chequeo, avance y modo sin conexión. La entrada en la portada de TrueML. | 0 · El camino completo: qué significa poner un modelo en producción |
| 2 | Módulo «Lo básico de ML» | Qué es un modelo · Datos, ejemplos, features y etiquetas · Cómo aprende un modelo (pérdida, gradiente, epoch, batch) · ¿Aprendió de verdad? (train/val/test, overfitting, métricas) |
| 3 | Módulo «Lo básico de la computadora y la red» | Programa, proceso, memoria y disco · CPU y GPU · Archivos y formatos · Red, IP y puertos · Cliente, servidor, HTTP, JSON y API · Latencia y throughput · Qué es la nube |
| 4 | Etapa Datos | Estación 1: datos y etiquetas · Estación 2: versionado y linaje |
| 5 | Etapa Modelo | Estación 3: entrenamiento y experimentos · Estación 4: gate de evaluación y registry · Estación 5: export, engine y paridad |
| 6 | Etapa API | Estación 6: código de serving (gateway, Triton, batching) |
| 7 | Etapa Contenedor | Estación 7: Docker · Estación 8: CI/CD y registro de imágenes |
| 8 | Etapa Orquestación | Estación 9: Kubernetes · Estación 10: rollout seguro |
| 9 | Etapa Monitoreo | Estación 11: la request en vivo (logs y métricas) · Estación 12: monitoreo, drift y reentrenamiento |
| 10 | Integración | Cada estación del Dojo enlaza a su lección y cada concepto a su glosario. Buscador global, repaso con tarjetas sacadas del glosario y revisión final de hechos. |

Las fases 2 y 3 van antes que las estaciones porque son los cimientos de verdad: sin ellas, la lección de la estación 1 tendría que suponer qué es un modelo o una API.
