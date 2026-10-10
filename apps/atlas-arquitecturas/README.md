# Atlas de Arquitecturas

Los modelos que te preguntan en entrevistas de **ML/AI Engineer**, a **nivel 2**: diagrama de bloques,
matemáticas y dimensiones. Cada modelo tiene su diagrama interactivo, la fórmula exacta de cada bloque,
el recorrido con números de un ejemplo real, el conteo de parámetros y de FLOPs con la cuenta a la
vista, entrenamiento, inferencia, modos de falla, preguntas de entrevista y práctica activa.

Empieza por lo que combina atención y visión (ViT, Swin, CLIP, DETR, SAM, VLMs, VLA) y sigue con LLMs,
retrieval y ML de industria. La hoja de ruta completa (15 fases) está en `docs/ROADMAP.md`.

**Estado: las 15 fases están completas.**
- **Visión:** ViT, Swin, CLIP, DETR / Deformable DETR, Grounding DINO, YOLO-World, SAM / SAM 2.
- **LLMs y VLMs:** LLM decoder e inferencia, LLaVA, Qwen2-VL.
- **Difusión y robótica:** Stable Diffusion, DiT / flow matching, RT-2, OpenVLA y π0.
- **Fine-tuning y alineación:** LoRA, RLHF / DPO.
- **Texto, búsqueda y recomendación:** BERT, retrieval, ANN, T5, Whisper, two-tower, DLRM, GBDT.
- **Percepción para robótica:** ByteTrack, depth y PointNet.
- **Aprendizaje de políticas:** RL con PPO e imitation learning (BC, ACT, Diffusion Policy).

Además, el Mapa, el Repaso de atención y la hoja de formas y fórmulas.

## Cómo abrirla

- **Doble clic** en `index.html`. Funciona desde el disco, sin servidor.
- **Un solo archivo:** `npm run build` genera `dist/atlas-arquitecturas.html` (y `dist/artifact.html`
  para publicarlo como Artifact de claude.ai).
- **Web, instalable en celular y offline:** `npm run build:web` arma `dist/web/` (manifest, íconos,
  service worker y el Laboratorio Transformer en `lab/`). Para Vercel: Root Directory
  `apps/atlas-arquitecturas`; el resto lo toma de `vercel.json`. Después de abrirla una vez con
  internet funciona sin conexión, fórmulas incluidas.

Recursos externos: MathJax 3 (cdnjs) y las fuentes IBM Plex. Sin conexión, las fórmulas se muestran
como LaTeX legible y se usan las fuentes del sistema.

## De dónde salen los números

Ninguna forma de tensor, conteo de parámetros ni de FLOPs está escrita a mano:

1. **Calculador** (`js/arch/`): cada modelo se define como un grafo de primitivas (linear, conv2d,
   layernorm, mhsa…) que calculan forma de salida, parámetros exactos y MACs, con la fórmula y la
   cuenta. Lo usan los diagramas, las tablas, el texto (`{{vit-b16-224.params.total}}`), los ejercicios
   y el explorador de escalado.
2. **Tests** (`tests/arch.test.cjs`): cada primitiva contra cuentas hechas a mano y las reglas prácticas
   del texto (12D² + 13D por capa, cruce N = 6D…).
3. **Cross-check con PyTorch** (`crosscheck/`): construye los modelos de referencia (timm, sin
   descargar pesos), cuenta parámetros, registra cada forma con hooks y cuenta FLOPs con
   `FlopCounterMode`. El resultado se guarda en `crosscheck/expected/*.json` y `npm test` lo compara
   sin necesitar Python. Hoy coinciden exacto los 6 ViT y el bloque de juguete.

Convención: **FLOPs = 2 × MACs**. Muchas tablas (DeiT, Swin, fvcore) llaman "FLOPs" a los MACs; la
app siempre dice cuál es cuál. Memoria en unidades decimales (1 KB = 1000 B).

## Comandos

| comando | qué hace |
|---|---|
| `npm run validate` | valida catálogo, contenido, enlaces, `{{…}}`, diagramas (solapes, cruces, ids) y LaTeX |
| `npm test` | calculador, cross-check contra el JSON guardado, validador y store |
| `npm run crosscheck` | vuelve a correr el cross-check en PyTorch (necesita `.venv`, ver abajo) y compara |
| `npm run contrast` | contraste de los colores de diagramas en tema claro y oscuro |
| `npm run smoke` · `smoke:mobile` · `smoke:mobile:dark` · `smoke:dark` · `smoke:tablet` | recorrido completo en Chrome headless |
| `npm run smoke:dist` · `smoke:artifact` · `smoke:web` · `smoke:offline` | lo mismo sobre el HTML único, el Artifact, la versión web (service worker + Laboratorio) y sin MathJax |
| `npm run build` · `build:web` | builds |
| `npm run vendor:lab` | regenera `vendor/lab/index.html` desde `../transformer-lab` |

Entorno de Python para el cross-check (solo desarrollo; no se commitea):

```bash
python3.13 -m venv .venv
```

```bash
.venv/bin/pip install -r crosscheck/requirements.txt
```

## Cómo se agrega un modelo (fases siguientes)

El shell no se toca. Por modelo:

1. `js/arch/<modelo>.js`: configs del paper (con la fuente) y `build()` con ids estables de tensores y
   operaciones, más sus tests en `tests/arch.test.cjs` y su script en `crosscheck/`.
2. `js/content/diagrams/<modelo>.js`: diagramas hechos a mano (vista general + bloques expandibles +
   recorrido). Las formas de las aristas salen del calculador.
3. `js/content/<modelo>.js`: las 11 secciones de la plantilla (`docs/SPEC.md` §5.3), flashcards y
   glosario. Todo LaTeX en strings `String.raw` (`R\`…\``).
4. Las líneas `<script>` en `index.html` en los tres puntos marcados (`arch`, `viz`, `contenido`) y el
   `status` de la fase en `js/content/catalog.js`.
5. `npm run validate`, `npm test`, `npm run crosscheck` y los smokes.

El contrato completo (formatos, paleta, gramática de diagramas, convenciones) está en `docs/SPEC.md`.

## Progreso

Se guarda en el navegador (`localStorage`, clave `atlas.v1`) o, publicada como Artifact con las
capabilities `{db:{}, user:{}}`, en tu cuenta. Para moverlo entre dispositivos: **Exportar / importar
progreso** en el pie de la barra lateral.
