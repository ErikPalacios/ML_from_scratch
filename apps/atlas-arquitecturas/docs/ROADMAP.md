# Atlas de Arquitecturas — hoja de ruta

Cada fase cabe en una ventana de 5 horas: build en paralelo → commit → revisión centrada en contenido
(exactitud técnica, números corriendo los scripts, diagramas, entrevistador senior) → fixes → commit.
Antes de cada fase reviso tu uso. Las configuraciones canónicas son **propuestas**: cada fase las
confirma contra la tabla del paper y el cross-check en PyTorch antes de escribir contenido.

## Cambios respecto a tu propuesta (y por qué)

| cambio | por qué |
|---|---|
| **LLMs por dentro sube de F9 a F6**, justo antes de los VLMs | LLaVA, Qwen2-VL, OpenVLA y π0 son *un decoder LLM con tokens visuales pegados*. Si el decoder (RMSNorm, RoPE, SwiGLU, GQA, KV cache, prefill/decode) llega después, F7 y F9 tendrían que explicarlo a medias. Así cada VLM/VLA es "encoder de visión + projector + el decoder que ya conoces". |
| **SAM / SAM 2 sube a F5**, pegado a Grounding DINO | Se usan juntos (Grounded-SAM: Grounding DINO da cajas → SAM da máscaras), SAM reutiliza el ViT de F1 (ViT-H con preentrenamiento MAE) y no necesita LLM. Mantiene el bloque de visión contiguo. |
| **Diffusion deja de ser opcional y se vuelve "Diffusion + flow matching"**, antes de VLA | π0 genera acciones con *flow matching* y Diffusion Policy es el baseline de imitation learning en robótica. Sin esta fase, F9 no se entiende a nivel 2. |
| **Qwen-VL → Qwen2-VL** | La "resolución dinámica" (número de tokens que depende del tamaño de la imagen, con M-RoPE) es de **Qwen2-VL** (2024). El Qwen-VL original (2023) usa resolución fija (448) y un resampler de cross-attention. Si dices "Qwen-VL tiene resolución dinámica" en una entrevista, es un error de fecha que un entrevistador nota. |
| **Tu F10 se parte en dos** y BERT pasa a la fase de retrieval | LoRA/QLoRA + SFT + RLHF + DPO ya es una fase completa. BERT encaja mejor con retrieval: BERT → bi-encoder (Sentence-BERT) → cross-encoder reranker es una sola línea de evolución. T5 + Whisper (encoder-decoder con cross-attention) quedan en su propia fase, ligera, junto con las tarjetas de nivel 1. |
| **Contraste "tres sabores de transformer" desde F1** (en el Mapa y el repaso) | encoder-only / decoder-only / encoder-decoder es la pregunta de entrada de casi toda entrevista de LLMs; no conviene esperarla hasta F10–F12. |
| **Tarjetas de nivel 1 (GNN, Mamba/SSM, GAN, RNN/LSTM) en F12**, no en F1 | F1 ya es la fase más pesada (shell + tres motores). En F1 el Mapa ya las muestra como "nivel 1, próximamente". |

Resultado: 15 fases (antes 14). Bloque 1 pasa de 8 a 9 fases porque absorbe los LLMs; Bloque 2 queda en 4.

## Bloque 1 — Visión + atención (prioridad)

| fase | contenido | config canónica (propuesta) | visualización clave | tamaño |
|---|---|---|---|---|
| **F1** | Shell completo (forkeado de la Ronda) · **motor de cálculo** (formas, parámetros, MACs) + tests + cross-check en PyTorch · **motor de diagramas** (dos niveles de zoom, tensores proporcionales, recorrido, leyenda) · motor de práctica (diagrama en blanco, "¿qué forma tiene?", "¿qué pasa si…?", flashcards) · **Mapa** con todas las familias (modelos futuros como "Próximamente") · **Repaso de atención** enlazado al Laboratorio · **ViT** completo · hoja de formas y fórmulas (filas de ViT) | ViT-B/16 @ 224×224 (196 patches + CLS, D = 768, L = 12, h = 12) · Dosovitskiy et al., ICLR 2021 | imagen partida en patches → tokens; mapa de atención de un token | **pesada** (≈ la F1 de la Ronda, que llegó justo al límite) |
| **F2** | **Swin** (contraste con CNN jerárquica: stages, patch merging ≈ stride) + **CLIP** (dos encoders en paralelo, InfoNCE) | Swin-T @ 224 (C = 96, capas 2-2-6-2, ventana M = 7) · CLIP con ViT-B/16 + text transformer (12 capas, 512, contexto 77) | ventanas desplazadas; matriz de similitud imagen-texto | 2 modelos |
| **F3** | **DETR** (+ Deformable DETR breve) — contraste directo con YOLO: sin anchors, sin NMS, set prediction | DETR-R50 (6+6 capas, d = 256, 8 heads, 100 queries) | matching húngaro queries ↔ objetos | 1.5 modelos |
| **F4** | **Grounding DINO** + **YOLO-World** (vocabulario abierto) | Grounding DINO-T (Swin-T + BERT-base, 900 queries) · YOLO-World-L @ 640 | texto → cajas: fusión texto-imagen | 2 modelos |
| **F5** | **SAM** + **SAM 2** (segmentación con prompts; memoria para video) | SAM ViT-H @ 1024 (embeddings 64×64×256) · SAM 2 con Hiera (tamaño a confirmar) | prompt (punto/caja) → máscara; banco de memoria en video | 2 modelos |
| **F6** | **LLM decoder por dentro**: RMSNorm, RoPE, SwiGLU, GQA/MQA, KV cache, prefill vs decode; MoE y cuantización como página de inferencia | Llama 3 8B (32 capas, d = 4096, 32 heads de Q / 8 de KV, contexto 8k) · Mixtral 8×7B para MoE | máscara causal y KV cache creciendo | 2 páginas |
| **F7** | **VLMs**: **LLaVA** (encoder → projector → LLM) + **Qwen2-VL** (resolución dinámica, M-RoPE) | LLaVA-1.5-7B (CLIP ViT-L/14 @ 336 → 576 tokens → MLP → Vicuna-7B) · Qwen2-VL-7B | de la imagen a tokens visuales dentro del prompt; tokens según resolución | 2 modelos |
| **F8** | **Diffusion + flow matching**: U-Net latente (Stable Diffusion) y **DiT** | DiT-XL/2 @ 256 (latente 32×32×4) · U-Net de SD 1.5 (latente 64×64×4) | proceso de ruido / denoising; flow matching como línea recta | 2 modelos |
| **F9** | **VLA**: RT-2 (acciones como tokens), **OpenVLA**, **π0** (action expert con flow matching) | OpenVLA-7B · π0 (PaliGemma 3B + action expert, chunks de 50 acciones) · RT-2 a nivel 2 parcial (pesos cerrados: se marca qué es público) | de imagen + instrucción a un chunk de acciones | 3 modelos, ligeros porque reutilizan F6–F8 |

## Bloque 2 — LLMs, retrieval y ML clásico de industria

| fase | contenido | nota |
|---|---|---|
| **F10** | Fine-tuning y alineación: **LoRA/QLoRA**, SFT, **RLHF (PPO)** vs **DPO** | diagramas del adapter (rango r) y del pipeline de RLHF; conteo de parámetros entrenables |
| **F11** | **BERT** (MLM, encoder-only) → embeddings y retrieval: **bi-encoder vs cross-encoder** (reranker), contrastive loss (InfoNCE), **ANN** (HNSW, IVF-PQ) | conecta con CLIP (F2) y con los casos de búsqueda/RAG de la Ronda |
| **F12** | Encoder-decoder: **T5** + **Whisper** (cross-attention) · tarjetas de nivel 1 en el Mapa: GNNs, Mamba/SSMs, GANs, RNN/LSTM | fase ligera |
| **F13** | Recomendación: **two-tower** + ranking (**DLRM** / Wide & Deep) + **gradient boosted trees** (XGBoost/LightGBM) y por qué siguen ganando en tabulares | la plantilla se adapta: en árboles, "parámetros" = árboles × hojas y el diagrama es de splits por histograma |

## Bloque 3 — Robótica (opcional, después)

| fase | contenido |
|---|---|
| **F14** | Tracking (**SORT/ByteTrack**: Kalman + matching húngaro, conecta con DETR) + depth estimation (DPT / Depth Anything) + **PointNet**; NeRF / Gaussian Splatting a nivel 1 |
| **F15** | RL para robótica: policy gradient, **PPO**, imitation learning (behavior cloning, ACT, Diffusion Policy) — conecta con F8 y F9 |

## Riesgo principal: F1

F1 lleva todo lo que las demás fases reutilizan (shell, motor de cálculo, motor de diagramas, motor de
práctica) más un modelo completo para probarlo de verdad. Es comparable a la F1 de la Ronda, que
terminó justo en el límite de las 5 horas. Mitigación: el SPEC fija los contratos antes de lanzar los
agentes (para que trabajen en paralelo sin esperarse), hago commit justo después del build, y si al
terminar el build el uso pasa de ≈ 70 %, la revisión y los fixes pasan a la siguiente ventana en vez de
arriesgar un corte a la mitad.
