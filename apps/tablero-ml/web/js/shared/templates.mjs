/* GENERADO por tools/gen-templates.mjs: no lo edites a mano. Fuentes: el curso (Ronda de Diseño ML) y la hoja «Del dato a producción». */
export const T = {
 "COURSE_URL": "https://ronda-diseno-ml.vercel.app/",
 "SHEETS_URL": "https://cheat-sheets-ml.vercel.app/",
 "ORDER": [
  "sincrono",
  "batch",
  "asincrono",
  "llm",
  "hibrido",
  "streaming",
  "edge"
 ],
 "PATTERNS": {
  "sincrono": {
   "name": "Online synchronous",
   "case": "c01",
   "cases": [
    "c01",
    "c09",
    "c15"
   ],
   "summary": "A caller waits for the answer in milliseconds: load balancer, CPU gateway and GPU model server, with timeouts and fallback. This is the full C01 path, all 12 stations from data to monitoring.",
   "removed": [],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.arquitectura"
    },
    {
     "label": "Course · M02 · Patrones de inferencia · Online síncrona (request/response)",
     "href": "https://ronda-diseno-ml.vercel.app/#m02.online-sincrona"
    },
    {
     "label": "Sheet · Del dato a producción · mapa del C01",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#mapa"
    }
   ]
  },
  "batch": {
   "name": "Batch",
   "case": "c14",
   "cases": [
    "c14"
   ],
   "summary": "Sales, calendar and promotions are known ahead of time and nobody waits online: a scheduled job forecasts all 4.8 M series every night and the ERP reads an already-published table at 04:00. Versus C01, export, the live request and autoscaling drop out, and what protects a fixed window is added: cutoff sensors, an output gate, atomic publishing and a fallback that never leaves the ERP without a forecast.",
   "speeds": "No hay línea de milisegundos: nadie llama en línea. Aparece una línea diaria con hora límite: la corrida nocturna, de 00:30 a 03:30, antes de que el ERP lea a las 04:00. El modelo se reentrena cada domingo (≈ 2–3 h en spot) y el código sale en días. La operación mira dos relojes: la noche (minutos, page) y la precisión (días, cuando llegan las ventas; ticket).",
   "removed": [
    {
     "id": "export",
     "why": "The GBDT predicts on CPU with the same image that trains it: no ONNX or TensorRT."
    },
    {
     "id": "request",
     "why": "No online caller: the ERP reads the `forecast_current` view at 04:00, by target date."
    }
   ],
   "links": [
    {
     "label": "Course · C14 · Pronóstico de demanda · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c14.arquitectura"
    },
    {
     "label": "Course · C14 · Pronóstico de demanda · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
    },
    {
     "label": "Course · C14 · Pronóstico de demanda · Monitoreo, alertas y reentrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c14.monitoreo"
    },
    {
     "label": "Course · M02 · Patrones de inferencia · Batch: precomputar en vez de servir",
     "href": "https://ronda-diseno-ml.vercel.app/#m02.batch"
    },
    {
     "label": "Sheet · Del dato a producción · patrón batch",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
    }
   ]
  },
  "llm": {
   "name": "LLM & RAG",
   "case": "c11",
   "cases": [
    "c10",
    "c11",
    "c12"
   ],
   "summary": "Almost nothing is trained: the LLM already exists and the C10 platform serves it (`llm-gateway` → vLLM), with C11 as one more tenant. The work moves to ingestion (connectors, chunking, embeddings and permissions) and to golden-set evaluation, and the request goes from milliseconds to seconds, with token streaming and citations.",
   "speeds": "La línea de semanas no entrena: la reemplaza la ingestión continua (frescura p95 ≤ 15 min, revocaciones en ≤ 5 min) y, cada trimestre, la evaluación de embeddings candidatos. La de días mueve código, prompt, índice o la revisión del LLM, todos por el mismo gate. La de milisegundos se vuelve de segundos (retrieval + rerank p95 ≤ 700 ms, primer token p95 ≤ 2.5 s). La continua corre el probe de permisos cada pocos minutos y el canary de groundedness cada 4 h.",
   "removed": [
    {
     "id": "entrenamiento",
     "why": "The LLM (C10's `chat-default`) and the embedding model come ready-made; instead, ≈ 12 M chunks are embedded (≈ 44 L4-hours)."
    },
    {
     "id": "export",
     "why": "No in-house ONNX or TensorRT: on the C10 platform, vLLM loads FP8 weights from a pinned revision, copied from S3 to NVMe and verified with sha256."
    }
   ],
   "links": [
    {
     "label": "Course · C11 · RAG empresarial · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
    },
    {
     "label": "Course · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
    },
    {
     "label": "Course · C11 · RAG empresarial · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
    },
    {
     "label": "Course · C10 · Servir un LLM propio · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c10.arquitectura"
    },
    {
     "label": "Course · M14 · Sistemas con LLMs · RAG: el modelo con tus documentos",
     "href": "https://ronda-diseno-ml.vercel.app/#m14.rag"
    },
    {
     "label": "Sheet · Del dato a producción · patrón LLM",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
    }
   ]
  },
  "streaming": {
   "name": "Streaming",
   "case": "c13",
   "cases": [
    "c13"
   ],
   "summary": "This is streaming inference over a long-lived connection, not stream processing over Kafka: each participant opens a session and sends audio in 160 ms chunks while a stateful model advances on a GPU. Balancing (by active streams, with affinity), autoscaling (up on sessions, down by draining) and monitoring (partial latency and a canary that speaks in production, since customer audio is not stored) change accordingly.",
   "speeds": "La línea de milisegundos dura lo que la reunión: un fragmento cada 160 ms, parciales p95 ≤ 500 ms y sesiones de horas. La continua sigue la curva del día (≈ 60 L4 de noche, ≈ 172 en el pico) con un cron antes de la rampa de la mañana. La del modelo hace fine-tune por idioma cuando un disparador lo pide, revisa cada trimestre y entra por canary de sesiones nuevas.",
   "removed": [],
   "links": [
    {
     "label": "Course · C13 · Speech-to-text en vivo · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c13.arquitectura"
    },
    {
     "label": "Course · C13 · Speech-to-text en vivo · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
    },
    {
     "label": "Course · C13 · Speech-to-text en vivo · Monitoreo, alertas y reentrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c13.monitoreo"
    },
    {
     "label": "Course · M02 · Patrones de inferencia · Streaming: inferencia sobre eventos",
     "href": "https://ronda-diseno-ml.vercel.app/#m02.streaming"
    },
    {
     "label": "Sheet · Del dato a producción · patrón streaming",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
    }
   ]
  },
  "edge": {
   "name": "Edge / on-device",
   "case": "c03",
   "cases": [
    "c02",
    "c03"
   ],
   "summary": "The model runs next to the line on a Jetson, because the line cannot wait on the network or stop when the internet drops; the cloud trains and monitors. Nothing in the cloud sits on a part's path: Kubernetes and autoscaling drop out (4 fixed devices on Docker), release becomes OTA to a fleet through the DMZ, and monitoring works without internet.",
   "speeds": "La línea de milisegundos vive en el dispositivo y es dura: 2 piezas/s por línea y decisión en ≤ 350 ms, sin red. La del modelo es mensual (o antes, por una variante o un defecto nuevo, drift o un escape que reporta la armadora) y llega en días: descarga de noche, un turno en shadow, canary y las 4 líneas. La continua es local (Prometheus y andon en la planta) y lo demás sube a la nube cuando hay enlace.",
   "removed": [
    {
     "id": "kubernetes",
     "why": "4 fixed devices do not justify Kubernetes: Docker with a restart policy and a watchdog, and no autoscaling either, since sizing is per device."
    }
   ],
   "links": [
    {
     "label": "Course · C03 · Inspección visual en planta · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c03.arquitectura"
    },
    {
     "label": "Course · C03 · Inspección visual en planta · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
    },
    {
     "label": "Course · C03 · Inspección visual en planta · Monitoreo, alertas y reentrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c03.monitoreo"
    },
    {
     "label": "Course · M02 · Patrones de inferencia · Edge / on-device",
     "href": "https://ronda-diseno-ml.vercel.app/#m02.edge"
    },
    {
     "label": "Sheet · Del dato a producción · patrón edge",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
    }
   ]
  },
  "asincrono": {
   "name": "Async (queue)",
   "case": "c04",
   "cases": [
    "c04",
    "c05"
   ],
   "summary": "A slide takes ≈ 20–30 s of GPU and the result waits for the pathologist, so the archive publishes an event, an SQS queue absorbs scanner bursts and KEDA scales GPU workers from 0 to 4 against a turnaround p95 ≤ 60 min SLO. The ms request is replaced by a queue with a DLQ, versioned results read by the viewer and expert review that feeds labels; C05 applies the same pattern on CPU, with `docs-api` (202 after a synchronous quality gate) and one Step Functions execution per document.",
   "removed": [
    {
     "id": "request",
     "why": "Nobody waits for a ms response: a slide takes ≈ 20–30 s and the pathologist opens the case later, so the synchronous request becomes event → queue → worker → results the viewer reads."
    }
   ],
   "links": [
    {
     "label": "Course · C04 · Segmentación de imágenes · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c04.arquitectura"
    },
    {
     "label": "Sheet · Del dato a producción · casos asíncronos",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-asincrono"
    }
   ]
  },
  "hibrido": {
   "name": "Hybrid",
   "case": "c07",
   "cases": [
    "c07",
    "c06",
    "c08"
   ],
   "summary": "Embedding search combines two patterns: the expensive part is precomputed (vectors for 100 M listings, in batch when the model changes and streamed through Kafka for new items) and the query is encoded and searched online, at p99 ≤ 300 ms for text. Versus C01 a stateful index appears (re-embed, build green, stream-index) and rollout becomes an index blue/green; C06 instead pairs a synchronous check with an async cascade and people, and C08 adds a per-request funnel with streaming features.",
   "removed": [],
   "links": [
    {
     "label": "Course · C07 · Búsqueda con embeddings · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
    },
    {
     "label": "Sheet · Del dato a producción · casos híbridos",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-hibrido"
    }
   ]
  }
 },
 "STATIONS": [
  {
   "id": "datos",
   "num": 1,
   "title": "Data & Labels",
   "tramo": "datos",
   "speed": "semanas",
   "question": "",
   "note": "Turn production traffic into a new monthly label set from four sources: the category chosen at listing time, moderation corrections, a ≈ 5k-image human queue and a frozen ≈ 50k golden set used only for evaluation.",
   "artifact": "labels del mes (≈ 5k humanos + débiles filtrados)",
   "done": [
    "La cola del mes tiene sus ≈ 5k imágenes con la mezcla acordada: incertidumbre, desacuerdos y 20–30 % al azar.",
    "La doble anotación tiene su kappa por clase y los desacuerdos están adjudicados.",
    "Solo se copiaron las fotos que se etiquetan, sin EXIF; el resto se referencia por request_id y sha256.",
    "Los labels débiles entran filtrados y nunca como única fuente de evaluación."
   ],
   "commands": [
    {
     "code": "pip install label-studio && label-studio start",
     "note": "Label Studio Community en tu máquina: la UI queda en `localhost:8080`. C01 acepta también un proveedor gestionado."
    }
   ],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
    },
    {
     "label": "Course · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
     "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
    },
    {
     "label": "Course · M01 · El mapa y la entrevista · El ciclo de vida de ML en producción",
     "href": "https://ronda-diseno-ml.vercel.app/#m01.ciclo-de-vida"
    },
    {
     "label": "Sheet · Del dato a producción · estación 1",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
    }
   ]
  },
  {
   "id": "versionado",
   "num": 2,
   "title": "Dataset Versioning & Lineage",
   "tramo": "datos",
   "speed": "semanas",
   "question": "",
   "note": "Publish each dataset as an immutable snapshot (`ds-2026-09-01`) with a Parquet manifest that references images by hash, and link every registered model to its snapshot, commit and training-container digest.",
   "artifact": "snapshot ds-2026-09-01 (manifest inmutable)",
   "done": [
    "El snapshot tiene id, manifest y tarjeta, y su prefijo no se puede sobrescribir.",
    "La validación pasó: 500 categorías, cero duplicados con el golden set, conteos por fuente en rango.",
    "El pipeline recibe el id del snapshot como parámetro, nunca una carpeta «latest».",
    "Desde un sha256 llegas a los snapshots y a los modelos que lo usan."
   ],
   "commands": [
    {
     "code": "aws s3 ls s3://{bucket}/datasets/{snapshot_id}/",
     "note": "Mira qué hay en el prefijo de un snapshot (solo lectura)."
    },
    {
     "code": "dvc add {carpeta_datos} && dvc push",
     "note": "Si el equipo ya usa DVC: hashea la carpeta, deja `{carpeta_datos}.dvc` para git y sube los datos al remote en S3."
    },
    {
     "code": "lakectl branch create lakefs://{repo}/{rama} -s lakefs://{repo}/main",
     "note": "Si usan lakeFS: una rama aislada sobre el bucket, sin copiar datos; después `lakectl commit` y `lakectl merge`."
    }
   ],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
    },
    {
     "label": "Course · M09 · Datos y features · Versionado de datos y snapshots inmutables",
     "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
    },
    {
     "label": "Course · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
    },
    {
     "label": "Sheet · Del dato a producción · estación 2",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
    }
   ]
  },
  {
   "id": "entrenamiento",
   "num": 3,
   "title": "Training Pipeline",
   "tramo": "modelo",
   "speed": "semanas",
   "question": "",
   "note": "Run the ResNet-50 fine-tune as an orchestrated monthly job (earlier if a monitoring trigger fires) on an on-demand GPU, warm-started from the champion with AMP and the gateway's `preprocess.py`, with everything tracked in MLflow.",
   "artifact": "checkpoint candidato (corrida en MLflow)",
   "done": [
    "La corrida salió del pipeline desde un commit limpio, no de una laptop.",
    "MLflow tiene parámetros, curva de val_top1, artefactos, id del snapshot, commit y digest.",
    "El entrenamiento usó el mismo preprocess.py y la misma versión de Pillow que el gateway.",
    "La GPU se apagó al terminar y los checkpoints quedaron en S3."
   ],
   "commands": [
    {
     "code": "mlflow server --backend-store-uri postgresql://{usuario}:{clave}@{host_db}/{db} --artifacts-destination s3://{bucket} --host 0.0.0.0",
     "note": "Lo levanta plataforma una vez, no en cada corrida: UI y API en el puerto 5000, metadatos en Postgres y artefactos en S3. Sin `--host 0.0.0.0` solo responde en esa máquina; si los jobs lo llaman por nombre, suma `--allowed-hosts {nombre}` (MLflow ≥ 3.5)."
    }
   ],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
    },
    {
     "label": "Course · M10 · MLOps · Pipelines de entrenamiento orquestados",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
    },
    {
     "label": "Course · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
    },
    {
     "label": "Course · M09 · Datos y features · Training-serving skew: causas, detección y prevención",
     "href": "https://ronda-diseno-ml.vercel.app/#m09.skew"
    },
    {
     "label": "Sheet · Del dato a producción · estación 3",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
    }
   ]
  },
  {
   "id": "gate",
   "num": 4,
   "title": "Evaluation Gate & Registry",
   "tramo": "modelo",
   "speed": "semanas",
   "question": "",
   "note": "Compare challenger against champion on the same golden set with an automatic gate written before training (paired non-inferiority ≥ −0.3 pp on top-1 and top-5, recall of the 100 highest-traffic categories, ECE ≤ 0.05, slices), and register the version as `challenger` only after station 5 parity and latency pass.",
   "artifact": "checkpoint aprobado por el gate",
   "done": [
    "El candidato es no inferior al champion (≥ −0.3 pp pareado) y al de hace 3 meses.",
    "Ninguna de las 100 categorías grandes cae > 5 pp con caída significativa (McNemar + Holm), ningún slice cae más que su intervalo y ECE ≤ 0.05.",
    "Paridad y latencia (estación 5) pasaron y la versión quedó como challenger con todos sus artefactos.",
    "Sabes qué versión es champion y a cuál vuelves si algo falla."
   ],
   "commands": [
    {
     "code": "python -c \"from mlflow import MlflowClient; print(MlflowClient().get_model_version_by_alias('classifier', 'champion').version)\"",
     "note": "¿Qué versión es `champion` ahora? Con `MLFLOW_TRACKING_URI` apuntando al servidor."
    }
   ],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
    },
    {
     "label": "Course · C01 · API de clasificación · Evaluación offline y online",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
    },
    {
     "label": "Course · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
    },
    {
     "label": "Course · M10 · MLOps · Model registry: versiones, aliases y linaje",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.model-registry"
    },
    {
     "label": "Sheet · Del dato a producción · estación 4",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
    }
   ]
  },
  {
   "id": "export",
   "num": 5,
   "title": "Export, Engine & Parity",
   "tramo": "modelo",
   "speed": "semanas",
   "question": "",
   "note": "Export the approved checkpoint to ONNX opset 17, compile a TensorRT FP16 engine on a T4 with the same NGC release as Triton (24.08), bake it into the Triton image and pass the parity (top-1 agreement ≥ 99.5 %) and latency (p99 ≤ champion + 10 %) gates on a T4 CI runner.",
   "artifact": "engine model.plan (versión challenger)",
   "done": [
    "export_onnx.py imprime opset=17 y «[export] OK».",
    "El engine se construyó en una T4 con tensorrt:24.08, la misma release que tritonserver:24.08.",
    "parity_check.py --backend triton da top-1 agreement ≥ 99.5 % y exit 0.",
    "perf_analyzer a 250 y 500 req/s: p99 ≤ champion + 10 %.",
    "Los sha256 del ONNX y del plan, la GPU y la release están en la versión del registry."
   ],
   "commands": [
    {
     "code": "python model/export_onnx.py --checkpoint {checkpoint.pt} --out model/classifier.onnx",
     "note": "Exporta y verifica. Sin `--checkpoint` usa pesos aleatorios: solo prueba el pipeline."
    },
    {
     "code": "python model/parity_check.py --checkpoint {checkpoint.pt} --onnx model/classifier.onnx --images {carpeta_muestra_eval} --n 2000",
     "note": "Paridad en CPU con ONNX Runtime; exit 1 = no pasa. Sin `--checkpoint`, la referencia de PyTorch tendría pesos aleatorios."
    },
    {
     "code": "bash model/build_engine.sh",
     "note": "En la T4, con Docker y NVIDIA Container Toolkit: deja `triton/model_repository/classifier/1/model.plan`."
    },
    {
     "code": "python model/parity_check.py --backend triton --triton-url {host}:8000 --checkpoint {checkpoint.pt} --images {carpeta_muestra_eval} --n 2000",
     "note": "El engine FP16 servido por Triton contra PyTorch FP32 del mismo checkpoint; exit 1 = no se registra."
    },
    {
     "code": "perf_analyzer -m classifier -u {host}:8000 --request-rate-range=250:500:250 --percentile=99",
     "note": "Carga a tasa fija (250 y 500 req/s) para el gate de latencia: compara el p99 con el del champion."
    }
   ],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Archivos de referencia",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
    },
    {
     "label": "Course · C01 · API de clasificación · Evaluación offline y online",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
    },
    {
     "label": "Course · M08 · Optimización de modelos · ONNX y ONNX Runtime",
     "href": "https://ronda-diseno-ml.vercel.app/#m08.onnx"
    },
    {
     "label": "Course · M08 · Optimización de modelos · TensorRT",
     "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
    },
    {
     "label": "Sheet · Del dato a producción · estación 5",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
    },
    {
     "label": "Sheet · De PyTorch a Triton · ONNX",
     "href": "https://cheat-sheets-ml.vercel.app/triton/#onnx"
    },
    {
     "label": "Sheet · De PyTorch a Triton · paridad",
     "href": "https://cheat-sheets-ml.vercel.app/triton/#paridad"
    },
    {
     "label": "Sheet · De PyTorch a Triton · TensorRT",
     "href": "https://cheat-sheets-ml.vercel.app/triton/#tensorrt"
    }
   ]
  },
  {
   "id": "serving",
   "num": 6,
   "title": "Serving Code",
   "tramo": "release",
   "speed": "dias",
   "question": "",
   "note": "Ship the FastAPI CPU gateway (validate, decode in a threadpool, preprocess with the shared `preprocess.py`, call Triton, build the top-k) and the Triton `config.pbtxt` for the T4 (2 ms dynamic batching, 2 instances, queue rejection at 100 ms), covered by 24 GPU-free pytest tests.",
   "artifact": "código del gateway + model repository de Triton",
   "done": [
    "pytest pasa los 24 tests sin GPU: 200, 400, 413, 415, 422, 503, 504, health checks y métricas.",
    "/healthz no depende de Triton; /readyz da 200 solo con el modelo listo.",
    "Los nombres, shapes y dtypes del gateway coinciden con config.pbtxt.",
    "Ningún trabajo de CPU corre en el event loop; 150 ms de timeout a Triton y 250 ms en total.",
    "config.pbtxt tiene ventana de 2 ms, REJECT a los 100 ms, 2 instancias y warmup."
   ],
   "commands": [
    {
     "code": "cd reference/c01/gateway && pip install -r requirements-dev.txt && pytest",
     "note": "Los 24 tests con un Triton falso, en un venv con Python 3.13 (la versión con que se probó); no necesitas GPU."
    },
    {
     "code": "uvicorn app.main:app --port 8080",
     "note": "Gateway suelto desde `gateway/`, sin Triton: `/healthz` da 200, `/readyz` 503 y `/v1/classify` 503 con Retry-After."
    },
    {
     "code": "curl -fsS http://localhost:8000/v2/health/ready",
     "note": "¿Triton está listo con su modelo cargado? (arranca con `--strict-readiness`)."
    },
    {
     "code": "curl -H \"Content-Type: image/jpeg\" --data-binary @{foto.jpg} \"localhost:8080/v1/classify?top_k=5\"",
     "note": "Un request de punta a punta contra el gateway, con Triton arriba."
    }
   ],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.serving"
    },
    {
     "label": "Course · C01 · API de clasificación · Archivos de referencia",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
    },
    {
     "label": "Course · M07 · Servidores de modelos · Qué hace un model server (y qué no)",
     "href": "https://ronda-diseno-ml.vercel.app/#m07.que-hace"
    },
    {
     "label": "Course · M07 · Servidores de modelos · NVIDIA Triton Inference Server",
     "href": "https://ronda-diseno-ml.vercel.app/#m07.triton"
    },
    {
     "label": "Sheet · Del dato a producción · estación 6",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
    },
    {
     "label": "Sheet · El gateway · contrato",
     "href": "https://cheat-sheets-ml.vercel.app/gateway/#contrato"
    },
    {
     "label": "Sheet · De PyTorch a Triton · model repository",
     "href": "https://cheat-sheets-ml.vercel.app/triton/#repositorio"
    },
    {
     "label": "Sheet · El gateway · tests",
     "href": "https://cheat-sheets-ml.vercel.app/gateway/#tests"
    }
   ]
  },
  {
   "id": "empaquetado",
   "num": 7,
   "title": "Packaging (Docker)",
   "tramo": "release",
   "speed": "dias",
   "question": "",
   "note": "Package each tier in its own image — the gateway (FastAPI, multi-stage on `python:3.13-slim`, ≈ 0.1 GB compressed) and Triton with `config.pbtxt` and `model.plan` baked in (≈ 9.2 GB compressed) — and test both together with `docker compose` on a GPU machine.",
   "artifact": "Dockerfiles probados (gateway y Triton)",
   "done": [
    "Las dos imágenes se construyen para linux/amd64, y la del gateway no lleva tests, secretos ni modelos.",
    "El gateway corre como UID 10001 con un solo proceso uvicorn y /healthz responde 200.",
    "La imagen de Triton trae config.pbtxt y model.plan, y su tag es la versión del modelo.",
    "docker compose up --build devuelve un top-5 en /v1/classify y localhost:9090/alerts muestra las 6 alertas.",
    "Sabes cuánto pesa cada imagen comprimida: ≈ 0.1 GB el gateway y ≈ 9.2 GB Triton."
   ],
   "commands": [
    {
     "code": "docker build --platform linux/amd64 -t classifier-gateway:{tag} gateway/",
     "note": "En un Mac con Apple Silicon `--platform` es obligatorio: los nodos c6i y g4dn son x86. El tag es el commit."
    },
    {
     "code": "docker build -t classifier-triton:{version_modelo} triton/",
     "note": "Falla a propósito si falta `model.plan`: primero `build_engine.sh` en la T4."
    },
    {
     "code": "docker compose up --build",
     "note": "Desde `reference/c01`: gateway, Triton con GPU y Prometheus en una máquina."
    },
    {
     "code": "curl -s -H \"Content-Type: image/jpeg\" --data-binary @{foto} \"localhost:8080/v1/classify?top_k=5\"",
     "note": "La prueba de punta a punta: top-5 con `model_version`."
    },
    {
     "code": "docker history classifier-gateway:{tag}",
     "note": "Una fila por capa: encuentra la que infló la imagen."
    },
    {
     "code": "docker buildx imagetools inspect --format '{{json .Image}}' {registry}/classifier-gateway:{tag}",
     "note": "Antes de desplegar: el config tiene que decir `\"architecture\": \"amd64\"`. Sin `--format`, una imagen de una sola plataforma no muestra la suya."
    }
   ],
   "links": [
    {
     "label": "Course · M05 · Contenedores · Un Dockerfile de ML, decisión por decisión",
     "href": "https://ronda-diseno-ml.vercel.app/#m05.dockerfile-ml"
    },
    {
     "label": "Course · M05 · Contenedores · docker compose para desarrollo local",
     "href": "https://ronda-diseno-ml.vercel.app/#m05.compose-local"
    },
    {
     "label": "Course · M05 · Contenedores · Reducir tamaño (y por qué importa para el cold start)",
     "href": "https://ronda-diseno-ml.vercel.app/#m05.tamano"
    },
    {
     "label": "Course · C01 · API de clasificación · Archivos de referencia",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
    },
    {
     "label": "Sheet · Del dato a producción · estación 7",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
    },
    {
     "label": "Sheet · Docker · anatomía de un Dockerfile",
     "href": "https://cheat-sheets-ml.vercel.app/docker/#anatomia"
    },
    {
     "label": "Sheet · Docker · compose",
     "href": "https://cheat-sheets-ml.vercel.app/docker/#compose"
    }
   ]
  },
  {
   "id": "cicd",
   "num": 8,
   "title": "CI/CD & Image Registry",
   "tramo": "release",
   "speed": "dias",
   "question": "",
   "note": "Run the 24 gateway tests on every commit, build each image once for `linux/amd64` into tag-immutable ECR repos (gateway in CI, Triton in the model pipeline on the T4), then scan, sign and deploy the same digest to staging and production.",
   "artifact": "imagen en ECR (tag inmutable + digest)",
   "done": [
    "pytest pasa los 24 tests del gateway en cada commit, sin GPU.",
    "Cada imagen se construyó una sola vez (el gateway en CI, Triton en el pipeline del modelo), con tag = commit o versión del modelo, en repos de ECR con tags inmutables.",
    "La imagen de Triton llegó del pipeline del modelo, construida en la T4 y con la paridad FP16 contra PyTorch aprobada sobre esa misma imagen.",
    "El digest está escaneado y firmado, y staging y producción apuntan a ese mismo digest.",
    "La lifecycle policy conserva las últimas releases: el rollback siempre tiene a dónde volver."
   ],
   "commands": [
    {
     "code": "cd reference/c01/gateway && pip install -r requirements-dev.txt && pytest",
     "note": "24 tests sin GPU ni Triton: lo primero que corre el CI."
    },
    {
     "code": "aws ecr get-login-password --region {region} | docker login --username AWS --password-stdin {registry}",
     "note": "Login a ECR; el token dura 12 h. En CI, con un rol asumido por OIDC, sin llaves guardadas."
    },
    {
     "code": "docker buildx build --platform linux/amd64 -t {registry}/classifier-gateway:{sha} --push gateway/",
     "note": "Build único, para la arquitectura de los nodos; `{sha}` son los primeros 7 caracteres del commit: `git rev-parse --short=7 HEAD` (en CI, `${GITHUB_SHA::7}`)."
    },
    {
     "code": "crane digest {registry}/classifier-gateway:{sha}",
     "note": "El digest es la identidad: es lo que se firma y se despliega."
    },
    {
     "code": "cosign sign --yes {registry}/classifier-gateway@{digest}",
     "note": "Firma keyless con la identidad OIDC del CI."
    },
    {
     "code": "kubectl -n classifier set image deployment/gateway gateway={registry}/classifier-gateway@{digest}",
     "note": "Despliegue por digest; con GitOps ese valor va en un PR al repo de manifests."
    }
   ],
   "links": [
    {
     "label": "Course · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
    },
    {
     "label": "Course · M05 · Contenedores · Registries y tags inmutables",
     "href": "https://ronda-diseno-ml.vercel.app/#m05.registries"
    },
    {
     "label": "Course · Herramientas · Infraestructura como código, CI y seguridad",
     "href": "https://ronda-diseno-ml.vercel.app/#ref-herramientas.infra-ci-seguridad"
    },
    {
     "label": "Course · M15 · Seguridad y confiabilidad · Supply chain: imágenes, dependencias y pesos verificados",
     "href": "https://ronda-diseno-ml.vercel.app/#m15.supply-chain"
    },
    {
     "label": "Sheet · Del dato a producción · estación 8",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
    },
    {
     "label": "Sheet · Git y GitHub Actions · workflows",
     "href": "https://cheat-sheets-ml.vercel.app/git/#workflow"
    },
    {
     "label": "Sheet · Git y GitHub Actions · tests en CI",
     "href": "https://cheat-sheets-ml.vercel.app/git/#tests-ci"
    },
    {
     "label": "Sheet · Docker · registries",
     "href": "https://cheat-sheets-ml.vercel.app/docker/#registries"
    }
   ]
  },
  {
   "id": "kubernetes",
   "num": 9,
   "title": "Kubernetes",
   "tramo": "operacion",
   "speed": "dias",
   "question": "",
   "note": "Run two Deployments on EKS spread across two zones — the gateway on CPU nodes (3–12 pods, HPA on CPU) and Triton on `g4dn.xlarge` nodes with one T4 per pod (2–4 pods, KEDA on queue time) — behind an internal ALB created from the Ingress by the AWS Load Balancer Controller.",
   "artifact": "pods listos detrás del ALB interno",
   "done": [
    "kubectl get pods -o wide muestra 2 Triton READY en nodos de zonas distintas y al menos 3 gateways.",
    "Los nodos GPU anuncian nvidia.com/gpu: 1, tienen el taint y ningún gateway corre en ellos.",
    "kubectl get hpa muestra el HPA del gateway y keda-hpa-triton con métricas reales, sin unknown.",
    "El Ingress tiene la dirección del ALB interno y sus targets pasan el health check en /readyz.",
    "Los ServiceMonitors existen y las alertas cargaron como PrometheusRule."
   ],
   "commands": [
    {
     "code": "kubectl create namespace classifier",
     "note": "Una vez por cluster."
    },
    {
     "code": "kubectl label namespace classifier elbv2.k8s.aws/pod-readiness-gate-inject=enabled",
     "note": "Readiness gate del ALB: el rolling update no mata un pod viejo hasta que el ALB ve sano al nuevo."
    },
    {
     "code": "kubectl apply -f k8s/triton.yaml -f k8s/keda-triton.yaml -f k8s/gateway.yaml -f k8s/monitoring.yaml",
     "note": "Declarativo: guardas el estado deseado y los controladores hacen el resto."
    },
    {
     "code": "kubectl get pods -n classifier -o wide",
     "note": "Fase, READY, reinicios y nodo: ¿un Triton por zona?"
    },
    {
     "code": "kubectl describe pod {pod} -n classifier",
     "note": "Primera parada si algo no arranca: los Events del final dicen por qué."
    },
    {
     "code": "kubectl get nodes -L node.kubernetes.io/instance-type,topology.kubernetes.io/zone,workload",
     "note": "Tipo, zona y label `workload=gpu-t4` de cada nodo."
    },
    {
     "code": "kubectl get hpa -n classifier",
     "note": "El HPA del gateway y `keda-hpa-triton`, con su métrica actual contra el objetivo."
    }
   ],
   "links": [
    {
     "label": "Course · M06 · Orquestación y escalado · Los objetos que sí debes conocer",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.objetos-basicos"
    },
    {
     "label": "Course · M06 · Orquestación y escalado · GPUs en Kubernetes",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.gpus-k8s"
    },
    {
     "label": "Course · M06 · Orquestación y escalado · HPA: por qué escalar por CPU no sirve para un servicio de GPU",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.hpa"
    },
    {
     "label": "Course · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
    },
    {
     "label": "Course · M06 · Orquestación y escalado · Alta disponibilidad: multi-AZ, PDB y N+1",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.alta-disponibilidad"
    },
    {
     "label": "Course · Comandos · Depurar pods: síntoma → comandos → causa típica",
     "href": "https://ronda-diseno-ml.vercel.app/#ref-comandos.depurar"
    },
    {
     "label": "Sheet · Del dato a producción · estación 9",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
    },
    {
     "label": "Sheet · Kubernetes · Deployments",
     "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#deployments"
    },
    {
     "label": "Sheet · Kubernetes · probes",
     "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#probes"
    },
    {
     "label": "Sheet · Kubernetes · autoscaling",
     "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#autoscaling"
    }
   ]
  },
  {
   "id": "rollout",
   "num": 10,
   "title": "Safe Rollout",
   "tramo": "operacion",
   "speed": "dias",
   "question": "",
   "note": "Release each model as a gateway vN + Triton vN pair with its own Service through shadow (1–2 days), canary 5 % → 25 % → 100 % with automatic rollback and, for large changes, a per-seller A/B, moving the champion alias on promotion and keeping the previous release live for 24–48 h.",
   "artifact": "versión nueva al 100 % (alias champion)",
   "done": [
    "La release nueva (gateway vN + Triton vN con su Service) está lista antes de recibir tráfico.",
    "Los criterios para revertir (5xx, p99, baja confianza, PSI) y para avanzar están escritos antes de empezar.",
    "Cada etapa del canary juntó al menos 10,000 requests y cubrió un pico diurno.",
    "Una persona aprobó el 100 %, el alias champion apunta a la versión nueva y la anterior sigue viva 24–48 h.",
    "El rollback está ensayado: peso al estable en segundos; redeploy del tag anterior en ≈ 5–20 min."
   ],
   "commands": [
    {
     "code": "kubectl diff -f k8s/triton.yaml",
     "note": "Qué cambiaría antes de aplicar (exit 1 = hay diferencias)."
    },
    {
     "code": "kubectl rollout status deploy/triton -n classifier --timeout=25m",
     "note": "Espera el rollout: cada pod de Triton puede tardar minutos (nodo, imagen, engine)."
    },
    {
     "code": "kubectl argo rollouts promote gateway -n classifier",
     "note": "Con Argo Rollouts: sale de la pausa manual del canary."
    },
    {
     "code": "kubectl argo rollouts abort gateway -n classifier",
     "note": "Devuelve el tráfico al estable; el Rollout queda `Degraded` hasta que el template vuelva a la versión anterior (con GitOps, un revert)."
    },
    {
     "code": "kubectl rollout undo deploy/triton -n classifier",
     "note": "Vuelve al ReplicaSet anterior: el tag anterior es el modelo anterior. Con GitOps, un revert en git."
    },
    {
     "code": "kubectl rollout history deploy/triton -n classifier",
     "note": "Revisiones guardadas para volver: el C01 conserva 5."
    }
   ],
   "links": [
    {
     "label": "Course · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
     "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
    },
    {
     "label": "Course · M11 · Despliegue seguro · Canary: porcentajes, tiempos y criterios para avanzar",
     "href": "https://ronda-diseno-ml.vercel.app/#m11.canary"
    },
    {
     "label": "Course · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
     "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
    },
    {
     "label": "Course · M11 · Despliegue seguro · Rollback: criterios automáticos y qué guardar para volver",
     "href": "https://ronda-diseno-ml.vercel.app/#m11.rollback"
    },
    {
     "label": "Course · C01 · API de clasificación · Evaluación offline y online",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
    },
    {
     "label": "Sheet · Del dato a producción · estación 10",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
    },
    {
     "label": "Sheet · Kubernetes · rollouts",
     "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#rollouts"
    },
    {
     "label": "Sheet · Git y GitHub Actions · CD",
     "href": "https://cheat-sheets-ml.vercel.app/git/#cd"
    }
   ]
  },
  {
   "id": "request",
   "num": 11,
   "title": "Live Request Path",
   "tramo": "operacion",
   "speed": "ms",
   "question": "",
   "note": "Serve each photo through the internal ALB → gateway (validate, decode, 602 KB tensor on CPU) → Triton (≤ 2 ms batching) → TensorRT FP16 on the T4 within p99 ≤ 200 ms server-side, with cascading timeouts (`300 → 250 → 150 → 100 ms`) and the caller's manual selector as fallback.",
   "artifact": "una línea de log JSON y métricas por request",
   "done": [
    "Cada respuesta trae model_version y X-Request-ID, y cada línea de log trae preprocess_ms e inference_ms.",
    "El p99 del histograma del gateway, sumado entre pods, queda bajo 200 ms en el pico de diseño (500 req/s).",
    "Los timeouts están encadenados: 300 ms el caller, 250 ms el deadline, 150 ms a Triton y 100 ms en la cola.",
    "Bajo sobrecarga ves 503 y 504 rápidos (y el selector manual), no requests colgados.",
    "Cada gateway llama al Triton de su propia zona."
   ],
   "commands": [
    {
     "code": "curl -s -H \"Content-Type: image/jpeg\" --data-binary @{foto} \"localhost:8080/v1/classify?top_k=5\"",
     "note": "En local (compose): la respuesta trae `model_version` y `latency_ms`, y el header `X-Request-ID`."
    },
    {
     "code": "curl -i localhost:8080/readyz",
     "note": "200 solo si el modelo está listo en Triton; en EKS, con 503 el pod sale del ALB."
    },
    {
     "code": "kubectl logs deploy/gateway -n classifier --tail=5",
     "note": "Una línea JSON por request: `request_id`, `preprocess_ms`, `inference_ms`, `status`."
    },
    {
     "code": "kubectl port-forward -n classifier svc/triton 8000:8000 8002:8002",
     "note": "Túnel a un pod de Triton sin exponerlo: sirve para mirar, no para load tests."
    },
    {
     "code": "curl -s localhost:8002/metrics | grep nv_inference_queue_duration_us",
     "note": "El tiempo acumulado en la cola de Triton: la señal con la que escala KEDA."
    }
   ],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.arquitectura"
    },
    {
     "label": "Course · C01 · API de clasificación · Estimaciones back-of-the-envelope",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.estimaciones"
    },
    {
     "label": "Course · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
     "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
    },
    {
     "label": "Course · C01 · API de clasificación · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.serving"
    },
    {
     "label": "Course · M07 · Servidores de modelos · Protocolos: REST, gRPC, KServe v2 y OpenAI-compatible",
     "href": "https://ronda-diseno-ml.vercel.app/#m07.protocolos"
    },
    {
     "label": "Sheet · Del dato a producción · estación 11",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
    },
    {
     "label": "Sheet · El gateway · timeouts y reintentos",
     "href": "https://cheat-sheets-ml.vercel.app/gateway/#upstream"
    },
    {
     "label": "Sheet · El gateway · admisión",
     "href": "https://cheat-sheets-ml.vercel.app/gateway/#backpressure"
    },
    {
     "label": "Sheet · Formulario de estimaciones · latencia",
     "href": "https://cheat-sheets-ml.vercel.app/estimaciones/#latencia"
    }
   ]
  },
  {
   "id": "monitoreo",
   "num": 12,
   "title": "Monitoring & Retraining",
   "tramo": "operacion",
   "speed": "continuo",
   "question": "",
   "note": "Catch loud failures (errors, latency, pods down) in Prometheus within minutes and page on them, ticket silent ones (confidence, PSI, acceptance), and feed prediction logs and a retraining trigger back into labeling at station 1.",
   "artifact": "disparador de reentrenamiento y muestras para etiquetar",
   "done": [
    "Las 6 alertas evalúan con su severidad (page, warning o ticket) y cada una tiene runbook.",
    "Hay dashboards de servicio, de Triton y GPU, de modelo (partido por model_version) y de negocio.",
    "El 100 % de las predicciones llega a S3 sin PII y el job diario publica el PSI y la aceptación.",
    "Un disparador (mensual, PSI mayor a 0.2 por 3 días, −3 pp de aceptación o categoría nueva) abre ticket y adelanta el pipeline; nada se promueve sin gate y canary.",
    "La baja confianza, los desacuerdos y una muestra aleatoria llegan a la cola de etiquetado (estación 1)."
   ],
   "commands": [
    {
     "code": "kubectl apply -f k8s/monitoring.yaml",
     "note": "ServiceMonitors del gateway y de Triton; las reglas de `alerts.yml` se cargan aparte como PrometheusRule (comando en el README)."
    },
    {
     "code": "histogram_quantile(0.99, sum by (le) (rate(classifier_request_latency_seconds_bucket[5m])))",
     "note": "PromQL del p99: primero sumar buckets entre pods, después el cuantil."
    },
    {
     "code": "sum(rate(classifier_requests_total{status=~\"5..\"}[5m])) / sum(rate(classifier_requests_total{status!~\"4..\"}[5m]))",
     "note": "Fracción de 5xx sobre requests válidos: los 4xx no cuentan."
    },
    {
     "code": "sum(rate(nv_inference_count{model=\"classifier\"}[5m])) / sum(rate(nv_inference_exec_count{model=\"classifier\"}[5m]))",
     "note": "Batch promedio real de Triton: mídelo, no lo supongas."
    },
    {
     "code": "kubectl describe scaledobject triton -n classifier",
     "note": "Si Prometheus no ve a Triton, aquí aparece el error del scaler, no un 0 silencioso."
    }
   ],
   "links": [
    {
     "label": "Course · C01 · API de clasificación · Monitoreo, alertas y reentrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.monitoreo"
    },
    {
     "label": "Course · M12 · Monitoreo · Métricas de sistema: golden signals con detalles de ML",
     "href": "https://ronda-diseno-ml.vercel.app/#m12.sistema"
    },
    {
     "label": "Course · M12 · Monitoreo · Métricas de modelo: con y sin labels",
     "href": "https://ronda-diseno-ml.vercel.app/#m12.modelo"
    },
    {
     "label": "Course · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
     "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
    },
    {
     "label": "Course · M12 · Monitoreo · Cuándo reentrenar (y cuándo no)",
     "href": "https://ronda-diseno-ml.vercel.app/#m12.reentrenar"
    },
    {
     "label": "Course · M10 · MLOps · Reentrenamiento: programado, disparado o continuo",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.reentrenamiento"
    },
    {
     "label": "Sheet · Del dato a producción · estación 12",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
    },
    {
     "label": "Sheet · Prometheus y Grafana · tipos de métrica",
     "href": "https://cheat-sheets-ml.vercel.app/prometheus/#metricas"
    },
    {
     "label": "Sheet · Prometheus y Grafana · histogramas",
     "href": "https://cheat-sheets-ml.vercel.app/prometheus/#histogramas"
    },
    {
     "label": "Sheet · Prometheus y Grafana · SLOs",
     "href": "https://cheat-sheets-ml.vercel.app/prometheus/#slos"
    }
   ]
  }
 ],
 "STEPS": {
  "sincrono": [
   {
    "id": "kickoff",
    "base": "kickoff",
    "status": "nuevo",
    "title": "Requirements & Capacity Plan",
    "tramo": "diseno",
    "speed": "diseno",
    "question": "",
    "note": "Fix traffic, the p99 ≤ 200 ms server-side SLO, 99.9 % availability and the US$3k/month budget, and size QPS, GPUs and cost from them.",
    "artifact": "",
    "inputs": [],
    "outputs": [],
    "done": [
     "Average, peak and design QPS are computed from 10 M images/day: ≈ 116 req/s average, ≈ 350 peak (3×) and a 500 req/s design point.",
     "The p99 ≤ 200 ms SLO is split into a per-hop latency budget: ≈ 20–45 ms at p50 and ≈ 150 ms in a pessimistic p99.",
     "GPUs are sized for availability, not throughput: 2 × T4 (N+1, one per AZ) planned at ≈ 50 % of the measured max, autoscaling up to 4.",
     "Monthly infra is ≈ US$1.75k, under the US$3k budget, and the 99.9 % error budget is ≈ 300,000 failed requests per month."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.requisitos"
     },
     {
      "label": "Course · C01 · API de clasificación · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.estimaciones"
     },
     {
      "label": "Sheet · Formulario de estimaciones · C01 sizing chain",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/"
     }
    ],
    "calcs": [
     {
      "id": "qps-avg",
      "label": "Average QPS",
      "out": "qps_avg",
      "expr": "n_day / 86400",
      "unit": "req/s",
      "tol": 0.02,
      "why": "Drives cost: the average pays the bill.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "qps-peak",
      "label": "Peak QPS",
      "out": "qps_peak",
      "expr": "qps_avg * peak_factor",
      "unit": "req/s",
      "tol": 0.02,
      "why": "Sizes capacity: the fleet is built for the peak.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "qps-design",
      "label": "Design QPS (rounded up to 50)",
      "out": "qps_design",
      "expr": "ceilto(qps_peak * margin, 50)",
      "unit": "req/s",
      "tol": 0,
      "why": "The single design point every tier is sized against.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "gpu-count",
      "label": "T4 GPUs (throughput + 1, min one per AZ)",
      "out": "gpu_count",
      "expr": "max(ceil(qps_design / (target_util * gpu_max_tput) - 1e-9) + 1, n_az)",
      "unit": "GPU",
      "tol": 0,
      "why": "Availability, not throughput, sets the GPU count.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "gpu-util-design",
      "label": "Per-GPU load at design QPS",
      "out": "gpu_util_design",
      "expr": "qps_design / (gpu_count * gpu_max_tput)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Headroom left for spikes and failover.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "gpu-util-n1",
      "label": "Per-GPU load with one GPU down",
      "out": "gpu_util_n1",
      "expr": "qps_design / ((gpu_count - 1) * gpu_max_tput)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Confirms N+1: one zone carries the design peak alone.",
      "check": {
       "expr": "gpu_util_n1 <= 0.7",
       "label": "Survivor stays within the 50–70 % planning band (M03)"
      },
      "ref": "#c01.estimaciones"
     },
     {
      "id": "gw-vcpu",
      "label": "Gateway vCPU requests at design QPS",
      "out": "gw_vcpu_req",
      "expr": "qps_design * cpu_ms_per_req / 1000 / hpa_target",
      "unit": "vCPU",
      "tol": 0.02,
      "why": "CPU requests the HPA scales against.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "gw-nodes",
      "label": "Gateway nodes (c6i.xlarge, min one per AZ)",
      "out": "gw_nodes",
      "expr": "max(ceil(gw_vcpu_req / vcpu_per_node - 1e-9), n_az)",
      "unit": "nodes",
      "tol": 0,
      "why": "CPU node group size and its cost line.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "net-gbps",
      "label": "Gateway → Triton bandwidth at design QPS",
      "out": "net_gbps",
      "expr": "qps_design * req_bytes * 8 / 1e9",
      "unit": "Gb/s",
      "tol": 0.02,
      "why": "Decides zone routing and when to move to UINT8 input.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "net-node-share",
      "label": "Egress per gateway node vs sustained baseline",
      "out": "net_node_share",
      "expr": "net_gbps / gw_nodes / node_baseline_gbps",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Network saturates before CPU on these nodes; HPA does not see it.",
      "check": {
       "expr": "net_node_share <= 1",
       "label": "Fits under the sustained baseline (burst is best effort)"
      },
      "ref": "#c01.estimaciones"
     },
     {
      "id": "cost-alb",
      "label": "ALB monthly (hours + LCU by GB)",
      "out": "cost_alb",
      "expr": "price_alb_h * 730 + n_day * upload_kb * 1e3 / 1e9 * bill_days * price_lcu_gb",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Second cost line: the ALB bills every image GB.",
      "check": null,
      "ref": "#c01.costo"
     },
     {
      "id": "cost-infra",
      "label": "Monthly infra (GPU + gateway + ALB + EKS + logs)",
      "out": "cost_infra",
      "expr": "gpu_count * price_gpu_h * 730 + gw_nodes * price_node_h * 730 + cost_alb + cost_eks_month + cost_obs_month",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Go/no-go against the budget before building.",
      "check": {
       "expr": "cost_infra <= budget_month",
       "label": "Infra fits the US$3,000/month budget"
      },
      "ref": "#c01.estimaciones"
     },
     {
      "id": "cost-per-1k",
      "label": "Infra cost per 1,000 predictions",
      "out": "cost_per_1k",
      "expr": "cost_infra / (n_day * bill_days) * 1000",
      "unit": "US$",
      "tol": 0.05,
      "why": "Unit cost reported to the business.",
      "check": null,
      "ref": "#c01.costo"
     },
     {
      "id": "error-budget-min",
      "label": "Error budget per 30-day month",
      "out": "err_budget_min",
      "expr": "30 * 1440 * (1 - slo)",
      "unit": "min/month",
      "tol": 0.02,
      "why": "Downtime allowed per month; sets release freezes.",
      "check": null,
      "ref": "#c01.requisitos"
     }
    ]
   },
   {
    "id": "datos",
    "base": "datos",
    "status": "igual",
    "title": "Data & Labels",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Turn production traffic into a new monthly label set from four sources: the category chosen at listing time, moderation corrections, a ≈ 5k-image human queue and a frozen ≈ 50k golden set used only for evaluation.",
    "artifact": "labels del mes (≈ 5k humanos + débiles filtrados)",
    "done": [
     "The monthly queue holds its ≈ 5k images in the agreed mix: uncertainty, disagreements and 20–30 % random.",
     "Double annotation has its per-class kappa and disagreements are adjudicated.",
     "Only the photos being labeled were copied, without EXIF; the rest are referenced by `request_id` and sha256.",
     "Weak labels enter filtered and are never the only evaluation source."
    ],
    "commands": [
     {
      "code": "pip install label-studio && label-studio start",
      "note": "Label Studio Community on your machine: UI at `localhost:8080`. C01 also allows a managed provider."
     }
    ],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
     },
     {
      "label": "Course · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Course · M01 · El mapa y la entrevista · El ciclo de vida de ML en producción",
      "href": "https://ronda-diseno-ml.vercel.app/#m01.ciclo-de-vida"
     },
     {
      "label": "Sheet · Del dato a producción · estación 1",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ],
    "inputs": [
     "prediction logs in S3 (Parquet, one row per request)",
     "final category of each listing and moderation corrections",
     "monitoring signals: low confidence, drift, new categories"
    ],
    "outputs": [
     "monthly labels (≈ 5k human + filtered weak)",
     "labeled photos, EXIF-stripped, in a restricted bucket",
     "frozen golden set (≈ 50k, evaluation only)"
    ],
    "calcs": [
     {
      "id": "log-day",
      "label": "Prediction logs per day (raw)",
      "out": "log_gb_day",
      "expr": "n_day * log_bytes / 1e9",
      "unit": "GB/day",
      "tol": 0.02,
      "why": "Log 100 % of predictions: storage is not the constraint.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "log-month",
      "label": "Prediction logs per month (raw)",
      "out": "log_gb_month",
      "expr": "log_gb_day * 30",
      "unit": "GB/month",
      "tol": 0.02,
      "why": "Sizes the S3/Parquet log store and its retention.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "label-copy",
      "label": "Images copied for labeling per month",
      "out": "label_copy_gb_month",
      "expr": "label_per_month * label_img_kb / 1e6",
      "unit": "GB/month",
      "tol": 0.02,
      "why": "Only labeled images are copied (no EXIF, restricted bucket).",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "label-cost",
      "label": "Human labeling per month",
      "out": "label_cost_month",
      "expr": "label_per_month * price_label",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Labeling costs more than training: sampling strategy matters.",
      "check": {
       "expr": "cost_infra + label_cost_month <= budget_month",
       "label": "Infra + labeling stays under budget"
      },
      "ref": "#c01.datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "igual",
    "title": "Dataset Versioning & Lineage",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Publish each dataset as an immutable snapshot (`ds-2026-09-01`) with a Parquet manifest that references images by hash, and link every registered model to its snapshot, commit and training-container digest.",
    "artifact": "snapshot ds-2026-09-01 (manifest inmutable)",
    "done": [
     "The snapshot has an id, a manifest and a card, and its prefix cannot be overwritten.",
     "Validation passed: 500 categories, zero duplicates with the golden set, per-source counts in range.",
     "The pipeline takes the snapshot id as a parameter, never a “latest” folder.",
     "From a sha256 you reach the snapshots and the models that use it."
    ],
    "commands": [
     {
      "code": "aws s3 ls s3://{bucket}/datasets/{snapshot_id}/",
      "note": "List what is under a snapshot prefix (read-only)."
     },
     {
      "code": "dvc add {carpeta_datos} && dvc push",
      "note": "If the team already uses DVC: hashes the folder, leaves `{carpeta_datos}.dvc` for git and pushes the data to the S3 remote."
     },
     {
      "code": "lakectl branch create lakefs://{repo}/{rama} -s lakefs://{repo}/main",
      "note": "If you use lakeFS: an isolated branch over the bucket, no data copied; then `lakectl commit` and `lakectl merge`."
     }
    ],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
     },
     {
      "label": "Course · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Course · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
     },
     {
      "label": "Sheet · Del dato a producción · estación 2",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ],
    "inputs": [
     "monthly labels + image references (key + sha256)",
     "previous snapshot (parent)"
    ],
    "outputs": [
     "snapshot ds-2026-09-01 (immutable manifest)",
     "snapshot validation report"
    ],
    "calcs": [
     {
      "id": "snap-images",
      "label": "Images referenced by a snapshot",
      "out": "snap_ref_gb",
      "expr": "train_images * snap_img_kb / 1e6",
      "unit": "GB",
      "tol": 0.02,
      "why": "Bytes a snapshot would copy if it copied images.",
      "check": null,
      "ref": "#m09.versionado"
     },
     {
      "id": "manifest-size",
      "label": "Snapshot manifest size",
      "out": "manifest_mb",
      "expr": "train_images * manifest_row_b / 1e6",
      "unit": "MB",
      "tol": 0.02,
      "why": "What a new snapshot actually writes.",
      "check": null,
      "ref": "#m09.versionado"
     },
     {
      "id": "snap-ratio",
      "label": "Snapshot cost vs the images",
      "out": "snap_cost_ratio",
      "expr": "manifest_mb / (snap_ref_gb * 1000)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Immutable monthly snapshots are affordable for years.",
      "check": null,
      "ref": "#m09.versionado"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "igual",
    "title": "Training Pipeline",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Run the ResNet-50 fine-tune as an orchestrated monthly job (earlier if a monitoring trigger fires) on an on-demand GPU, warm-started from the champion with AMP and the gateway's `preprocess.py`, with everything tracked in MLflow.",
    "artifact": "checkpoint candidato (corrida en MLflow)",
    "done": [
     "The run came from the pipeline at a clean commit, not from a laptop.",
     "MLflow has the parameters, the val_top1 curve, artifacts, snapshot id, commit and digest.",
     "Training used the same `preprocess.py` and the same Pillow version as the gateway.",
     "The GPU shut down at the end and the checkpoints are in S3."
    ],
    "commands": [
     {
      "code": "mlflow server --backend-store-uri postgresql://{usuario}:{clave}@{host_db}/{db} --artifacts-destination s3://{bucket} --host 0.0.0.0",
      "note": "Platform starts it once, not per run: UI and API on port 5000, metadata in Postgres, artifacts in S3. Without `--host 0.0.0.0` it only answers on that machine; if jobs call it by name, add `--allowed-hosts {nombre}` (MLflow ≥ 3.5)."
     }
    ],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
     },
     {
      "label": "Course · M10 · MLOps · Pipelines de entrenamiento orquestados",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
     },
     {
      "label": "Course · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
     },
     {
      "label": "Course · M09 · Datos y features · Training-serving skew: causas, detección y prevención",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.skew"
     },
     {
      "label": "Sheet · Del dato a producción · estación 3",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ],
    "inputs": [
     "snapshot id (as a parameter)",
     "champion checkpoint (warm start)",
     "training image by digest"
    ],
    "outputs": [
     "candidate checkpoint (MLflow run)",
     "val_top1 curve and final metrics",
     "intermediate checkpoints in S3"
    ],
    "calcs": [
     {
      "id": "ckpt-size",
      "label": "Full checkpoint (FP32 weights + Adam)",
      "out": "ckpt_mb",
      "expr": "n_params * bytes_fp32 * (1 + adam_moments) / 1e6",
      "unit": "MB",
      "tol": 0.02,
      "why": "Sizes checkpoint storage and resume time.",
      "check": null,
      "ref": "#m10.pipelines-entrenamiento"
     },
     {
      "id": "ckpt-write",
      "label": "Checkpoint write to S3",
      "out": "ckpt_write_s",
      "expr": "ckpt_mb / s3_write_mbps",
      "unit": "s",
      "tol": 0.05,
      "why": "Cost of each checkpoint on the run.",
      "check": null,
      "ref": "#m10.pipelines-entrenamiento"
     },
     {
      "id": "ckpt-overhead",
      "label": "Checkpoint overhead per fine-tune",
      "out": "ckpt_overhead_s",
      "expr": "train_h * 60 / ckpt_every_min * ckpt_write_s",
      "unit": "s",
      "tol": 0.05,
      "why": "Justifies 15-min checkpoints (and spot) on the fine-tune.",
      "check": {
       "expr": "ckpt_overhead_s < 0.01 * train_h * 3600",
       "label": "Checkpointing costs < 1 % of the run"
      },
      "ref": "#m10.pipelines-entrenamiento"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "igual",
    "title": "Evaluation Gate & Registry",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Compare challenger against champion on the same golden set with an automatic gate written before training (paired non-inferiority ≥ −0.3 pp on top-1 and top-5, recall of the 100 highest-traffic categories, ECE ≤ 0.05, slices), and register the version as `challenger` only after station 5 parity and latency pass.",
    "artifact": "checkpoint aprobado por el gate",
    "done": [
     "The candidate is non-inferior to the champion (≥ −0.3 pp paired) and to the model from 3 months ago.",
     "None of the 100 large categories drops > 5 pp with a significant drop (McNemar + Holm), no slice drops more than its interval, and ECE ≤ 0.05.",
     "Parity and latency (station 5) passed and the version is registered as challenger with all its artifacts.",
     "The current champion and the version to roll back to if something fails are known."
    ],
    "commands": [
     {
      "code": "python -c \"from mlflow import MlflowClient; print(MlflowClient().get_model_version_by_alias('classifier', 'champion').version)\"",
      "note": "Which version is `champion` now? With `MLFLOW_TRACKING_URI` pointing at the server."
     }
    ],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
     },
     {
      "label": "Course · C01 · API de clasificación · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
     },
     {
      "label": "Course · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Course · M10 · MLOps · Model registry: versiones, aliases y linaje",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.model-registry"
     },
     {
      "label": "Sheet · Del dato a producción · estación 4",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ],
    "inputs": [
     "candidate checkpoint (MLflow run)",
     "current champion (pinned version, as a parameter)",
     "frozen golden set (≈ 50k)"
    ],
    "outputs": [
     "gate-approved checkpoint",
     "gate report (verdict, slices, per-category recall)",
     "challenger version in MLflow (after station 5)"
    ],
    "calcs": [
     {
      "id": "golden-ci",
      "label": "Golden-set 95 % CI on top-1",
      "out": "golden_ci95_pp",
      "expr": "z_95 * sqrt(golden_acc * (1 - golden_acc) / golden_n) * 100",
      "unit": "pp",
      "tol": 0.05,
      "why": "Sets the −0.3 pp non-inferiority margin, not \"≥ champion\".",
      "check": null,
      "ref": "#c01.datos"
     },
     {
      "id": "class-ci",
      "label": "Per-class recall 95 % CI (small category)",
      "out": "class_ci95_pp",
      "expr": "z_95 * sqrt(golden_acc * (1 - golden_acc) / class_n_min) * 100",
      "unit": "pp",
      "tol": 0.05,
      "why": "A fixed 5 pp per-class drop is noise here: gate with a paired test.",
      "check": null,
      "ref": "#c01.datos"
     },
     {
      "id": "parity-mismatch",
      "label": "Max top-1 mismatches in the parity run",
      "out": "parity_max_mismatch",
      "expr": "round(parity_n * (1 - parity_min_agree))",
      "unit": "img",
      "tol": 0,
      "why": "Hard fail line for the TensorRT FP16 parity gate.",
      "check": null,
      "ref": "#c01.evaluacion"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "igual",
    "title": "Export, Engine & Parity",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Export the approved checkpoint to ONNX opset 17, compile a TensorRT FP16 engine on a T4 with the same NGC release as Triton (24.08), bake it into the Triton image and pass the parity (top-1 agreement ≥ 99.5 %) and latency (p99 ≤ champion + 10 %) gates on a T4 CI runner.",
    "artifact": "engine model.plan (versión challenger)",
    "done": [
     "`export_onnx.py` prints opset=17 and “[export] OK”.",
     "The engine was built on a T4 with tensorrt:24.08, the same release as tritonserver:24.08.",
     "`parity_check.py --backend triton` gives top-1 agreement ≥ 99.5 % and exit 0.",
     "`perf_analyzer` at 250 and 500 req/s: p99 ≤ champion + 10 %.",
     "The sha256 of the ONNX and of the plan, the GPU and the release are recorded on the registry version."
    ],
    "commands": [
     {
      "code": "python model/export_onnx.py --checkpoint {checkpoint.pt} --out model/classifier.onnx",
      "note": "Exports and verifies. Without `--checkpoint` it uses random weights: pipeline test only."
     },
     {
      "code": "python model/parity_check.py --checkpoint {checkpoint.pt} --onnx model/classifier.onnx --images {carpeta_muestra_eval} --n 2000",
      "note": "CPU parity with ONNX Runtime; exit 1 = fail. Without `--checkpoint`, the PyTorch reference would have random weights."
     },
     {
      "code": "bash model/build_engine.sh",
      "note": "On the T4, with Docker and NVIDIA Container Toolkit: produces `triton/model_repository/classifier/1/model.plan`."
     },
     {
      "code": "python model/parity_check.py --backend triton --triton-url {host}:8000 --checkpoint {checkpoint.pt} --images {carpeta_muestra_eval} --n 2000",
      "note": "FP16 engine served by Triton vs PyTorch FP32 from the same checkpoint; exit 1 = not registered."
     },
     {
      "code": "perf_analyzer -m classifier -u {host}:8000 --request-rate-range=250:500:250 --percentile=99",
      "note": "Fixed-rate load (250 and 500 req/s) for the latency gate: compare p99 with the champion's."
     }
    ],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
     },
     {
      "label": "Course · C01 · API de clasificación · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
     },
     {
      "label": "Course · M08 · Optimización de modelos · ONNX y ONNX Runtime",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.onnx"
     },
     {
      "label": "Course · M08 · Optimización de modelos · TensorRT",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
     },
     {
      "label": "Sheet · Del dato a producción · estación 5",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     },
     {
      "label": "Sheet · De PyTorch a Triton · ONNX",
      "href": "https://cheat-sheets-ml.vercel.app/triton/#onnx"
     },
     {
      "label": "Sheet · De PyTorch a Triton · paridad",
      "href": "https://cheat-sheets-ml.vercel.app/triton/#paridad"
     },
     {
      "label": "Sheet · De PyTorch a Triton · TensorRT",
      "href": "https://cheat-sheets-ml.vercel.app/triton/#tensorrt"
     }
    ],
    "inputs": [
     "gate-approved checkpoint (.pt)",
     "sample of evaluation-set images"
    ],
    "outputs": [
     "model.plan engine (challenger version)",
     "Triton image with the engine baked in (tag = model version)",
     "ONNX, parity and latency reports, and fingerprints (sha256, GPU, NGC) for the registry"
    ],
    "calcs": [
     {
      "id": "onnx-fp32",
      "label": "ONNX FP32 weights",
      "out": "onnx_fp32_mb",
      "expr": "n_params * bytes_fp32 / 1e6",
      "unit": "MB",
      "tol": 0.02,
      "why": "Artifact size per model version in the registry.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "weights-fp16",
      "label": "FP16 weights in the engine",
      "out": "weights_fp16_mb",
      "expr": "n_params * bytes_fp16 / 1e6",
      "unit": "MB",
      "tol": 0.02,
      "why": "Weights are not what binds the T4.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "input-buffer",
      "label": "Input buffer at max batch",
      "out": "input_buf_mb",
      "expr": "max_batch * req_bytes / 1e6",
      "unit": "MB",
      "tol": 0.02,
      "why": "Engine profile max (batch 32) memory for inputs.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "vram-headroom",
      "label": "VRAM headroom on a 16 GB T4",
      "out": "vram_headroom_gb",
      "expr": "gpu_vram_gb - vram_used_gb",
      "unit": "GB",
      "tol": 0.02,
      "why": "No bigger GPU needed; room to co-host other models.",
      "check": {
       "expr": "vram_used_gb < gpu_vram_gb",
       "label": "Engine + 2 instances fit in one T4"
      },
      "ref": "#c01.estimaciones"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "igual",
    "title": "Serving Code",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Ship the FastAPI CPU gateway (validate, decode in a threadpool, preprocess with the shared `preprocess.py`, call Triton, build the top-k) and the Triton `config.pbtxt` for the T4 (2 ms dynamic batching, 2 instances, queue rejection at 100 ms), covered by 24 GPU-free pytest tests.",
    "artifact": "código del gateway + model repository de Triton",
    "done": [
     "pytest passes all 24 tests without a GPU: 200, 400, 413, 415, 422, 503, 504, health checks and metrics.",
     "`/healthz` does not depend on Triton; `/readyz` returns 200 only with the model ready.",
     "Gateway names, shapes and dtypes match `config.pbtxt`.",
     "No CPU work runs on the event loop; 150 ms timeout to Triton and 250 ms in total.",
     "`config.pbtxt` has a 2 ms window, REJECT at 100 ms, 2 instances and warmup."
    ],
    "commands": [
     {
      "code": "cd reference/c01/gateway && pip install -r requirements-dev.txt && pytest",
      "note": "The 24 tests against a fake Triton, in a Python 3.13 venv (the version it was tested with); no GPU needed."
     },
     {
      "code": "uvicorn app.main:app --port 8080",
      "note": "Standalone gateway from `gateway/`, no Triton: `/healthz` returns 200, `/readyz` 503 and `/v1/classify` 503 with Retry-After."
     },
     {
      "code": "curl -fsS http://localhost:8000/v2/health/ready",
      "note": "Is Triton ready with its model loaded? (starts with `--strict-readiness`)."
     },
     {
      "code": "curl -H \"Content-Type: image/jpeg\" --data-binary @{foto.jpg} \"localhost:8080/v1/classify?top_k=5\"",
      "note": "One end-to-end request against the gateway, with Triton up."
     }
    ],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.serving"
     },
     {
      "label": "Course · C01 · API de clasificación · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
     },
     {
      "label": "Course · M07 · Servidores de modelos · Qué hace un model server (y qué no)",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.que-hace"
     },
     {
      "label": "Course · M07 · Servidores de modelos · NVIDIA Triton Inference Server",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.triton"
     },
     {
      "label": "Sheet · Del dato a producción · estación 6",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     },
     {
      "label": "Sheet · El gateway · contrato",
      "href": "https://cheat-sheets-ml.vercel.app/gateway/#contrato"
     },
     {
      "label": "Sheet · De PyTorch a Triton · model repository",
      "href": "https://cheat-sheets-ml.vercel.app/triton/#repositorio"
     },
     {
      "label": "Sheet · El gateway · tests",
      "href": "https://cheat-sheets-ml.vercel.app/gateway/#tests"
     }
    ],
    "inputs": [
     "model.plan (engine) of the challenger version",
     "labels.json (500 categories)",
     "preprocess.py shared with training"
    ],
    "outputs": [
     "gateway code + Triton model repository",
     "24 passing tests",
     "POST /v1/classify contract"
    ],
    "calcs": [
     {
      "id": "tensor-bytes",
      "label": "Input tensor per request (from config.pbtxt)",
      "out": "tensor_bytes_contract",
      "expr": "in_c * in_h * in_w * bytes_fp32",
      "unit": "B",
      "tol": 0,
      "why": "The contract fixes the bytes every network number uses.",
      "check": {
       "expr": "tensor_bytes_contract == req_bytes",
       "label": "Matches the bytes the capacity plan assumed"
      },
      "ref": "#c01.estimaciones"
     },
     {
      "id": "p99-budget",
      "label": "Sum of per-hop p99 budgets",
      "out": "lat_p99_sum",
      "expr": "p99_alb_ms + p99_body_ms + p99_decode_ms + p99_norm_ms + p99_hop_ms + p99_queue_ms + p99_gpu_ms + p99_post_ms + p99_python_ms",
      "unit": "ms",
      "tol": 0.05,
      "why": "Leaves ≈ 50 ms margin; sets the 150 ms Triton timeout.",
      "check": {
       "expr": "lat_p99_sum <= slo_p99_ms",
       "label": "Pessimistic budget fits the 200 ms p99 SLO"
      },
      "ref": "#c01.estimaciones"
     },
     {
      "id": "inflight-total",
      "label": "Requests in flight at design QPS (Little)",
      "out": "inflight_total",
      "expr": "qps_design * lat_mean_s",
      "unit": "req",
      "tol": 0.02,
      "why": "Concurrency the gateway fleet must hold.",
      "check": null,
      "ref": "#m03.little"
     },
     {
      "id": "triton-inflight",
      "label": "Requests inside Triton per GPU (Little)",
      "out": "triton_inflight",
      "expr": "qps_design / gpu_count * triton_time_s",
      "unit": "req",
      "tol": 0.02,
      "why": "Picks instance_group count 2, not more.",
      "check": null,
      "ref": "#m03.little"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "igual",
    "title": "Packaging (Docker)",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Package each tier in its own image — the gateway (FastAPI, multi-stage on `python:3.13-slim`, ≈ 0.1 GB compressed) and Triton with `config.pbtxt` and `model.plan` baked in (≈ 9.2 GB compressed) — and test both together with `docker compose` on a GPU machine.",
    "artifact": "Dockerfiles probados (gateway y Triton)",
    "done": [
     "Both images build for linux/amd64, and the gateway image carries no tests, secrets or models.",
     "The gateway runs as UID 10001 with a single uvicorn process and `/healthz` returns 200.",
     "The Triton image includes `config.pbtxt` and `model.plan`, and its tag is the model version.",
     "`docker compose up --build` returns a top-5 on `/v1/classify` and `localhost:9090/alerts` shows the 6 alerts.",
     "The compressed size of each image is known: ≈ 0.1 GB for the gateway and ≈ 9.2 GB for Triton."
    ],
    "commands": [
     {
      "code": "docker build --platform linux/amd64 -t classifier-gateway:{tag} gateway/",
      "note": "On an Apple Silicon Mac `--platform` is mandatory: c6i and g4dn nodes are x86. The tag is the commit."
     },
     {
      "code": "docker build -t classifier-triton:{version_modelo} triton/",
      "note": "Fails on purpose if `model.plan` is missing: run `build_engine.sh` on the T4 first."
     },
     {
      "code": "docker compose up --build",
      "note": "From `reference/c01`: gateway, Triton with GPU and Prometheus on one machine."
     },
     {
      "code": "curl -s -H \"Content-Type: image/jpeg\" --data-binary @{foto} \"localhost:8080/v1/classify?top_k=5\"",
      "note": "The end-to-end check: top-5 with `model_version`."
     },
     {
      "code": "docker history classifier-gateway:{tag}",
      "note": "One row per layer: find the one that bloated the image."
     },
     {
      "code": "docker buildx imagetools inspect --format '{{json .Image}}' {registry}/classifier-gateway:{tag}",
      "note": "Before deploying: the config must say `\"architecture\": \"amd64\"`. Without `--format`, a single-platform image does not show its own."
     }
    ],
    "links": [
     {
      "label": "Course · M05 · Contenedores · Un Dockerfile de ML, decisión por decisión",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.dockerfile-ml"
     },
     {
      "label": "Course · M05 · Contenedores · docker compose para desarrollo local",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.compose-local"
     },
     {
      "label": "Course · M05 · Contenedores · Reducir tamaño (y por qué importa para el cold start)",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.tamano"
     },
     {
      "label": "Course · C01 · API de clasificación · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
     },
     {
      "label": "Sheet · Del dato a producción · estación 7",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     },
     {
      "label": "Sheet · Docker · anatomía de un Dockerfile",
      "href": "https://cheat-sheets-ml.vercel.app/docker/#anatomia"
     },
     {
      "label": "Sheet · Docker · compose",
      "href": "https://cheat-sheets-ml.vercel.app/docker/#compose"
     }
    ],
    "inputs": [
     "gateway code and pinned requirements.txt",
     "model.plan (station 5) + config.pbtxt (station 6)"
    ],
    "outputs": [
     "tested Dockerfiles (gateway and Triton)",
     "docker-compose.yml that brings everything up on one GPU machine"
    ],
    "calcs": [
     {
      "id": "pull-gateway",
      "label": "Gateway image pull",
      "out": "pull_gw_s",
      "expr": "gw_image_gb / pull_gbps",
      "unit": "s",
      "tol": 0.05,
      "why": "Gateway scales out in seconds.",
      "check": null,
      "ref": "#m05.tamano"
     },
     {
      "id": "pull-triton",
      "label": "Triton image pull",
      "out": "pull_triton_s",
      "expr": "triton_image_gb / pull_gbps",
      "unit": "s",
      "tol": 0.05,
      "why": "Minutes of cold start: pre-pull or bake into the AMI.",
      "check": null,
      "ref": "#m05.tamano"
     }
    ]
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD & Image Registry",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Run the 24 gateway tests on every commit, build each image once for `linux/amd64` into tag-immutable ECR repos (gateway in CI, Triton in the model pipeline on the T4), then scan, sign and deploy the same digest to staging and production.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "pytest passes the 24 gateway tests on every commit, without a GPU.",
     "Each image was built only once (the gateway in CI, Triton in the model pipeline), with tag = commit or model version, in ECR repos with immutable tags.",
     "The Triton image came from the model pipeline, built on the T4, with FP16-vs-PyTorch parity approved on that same image.",
     "The digest is scanned and signed, and staging and production point to that same digest.",
     "The lifecycle policy keeps the latest releases: rollback always has a target."
    ],
    "commands": [
     {
      "code": "cd reference/c01/gateway && pip install -r requirements-dev.txt && pytest",
      "note": "24 tests with no GPU or Triton: the first thing CI runs."
     },
     {
      "code": "aws ecr get-login-password --region {region} | docker login --username AWS --password-stdin {registry}",
      "note": "ECR login; the token lasts 12 h. In CI, via an OIDC-assumed role, no stored keys."
     },
     {
      "code": "docker buildx build --platform linux/amd64 -t {registry}/classifier-gateway:{sha} --push gateway/",
      "note": "Single build for the node architecture; `{sha}` is the first 7 characters of the commit: `git rev-parse --short=7 HEAD` (in CI, `${GITHUB_SHA::7}`)."
     },
     {
      "code": "crane digest {registry}/classifier-gateway:{sha}",
      "note": "The digest is the identity: it is what gets signed and deployed."
     },
     {
      "code": "cosign sign --yes {registry}/classifier-gateway@{digest}",
      "note": "Keyless signing with the CI's OIDC identity."
     },
     {
      "code": "kubectl -n classifier set image deployment/gateway gateway={registry}/classifier-gateway@{digest}",
      "note": "Deploy by digest; with GitOps that value goes in a PR to the manifests repo."
     }
    ],
    "links": [
     {
      "label": "Course · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Course · M05 · Contenedores · Registries y tags inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.registries"
     },
     {
      "label": "Course · Herramientas · Infraestructura como código, CI y seguridad",
      "href": "https://ronda-diseno-ml.vercel.app/#ref-herramientas.infra-ci-seguridad"
     },
     {
      "label": "Course · M15 · Seguridad y confiabilidad · Supply chain: imágenes, dependencias y pesos verificados",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.supply-chain"
     },
     {
      "label": "Sheet · Del dato a producción · estación 8",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     },
     {
      "label": "Sheet · Git y GitHub Actions · workflows",
      "href": "https://cheat-sheets-ml.vercel.app/git/#workflow"
     },
     {
      "label": "Sheet · Git y GitHub Actions · tests en CI",
      "href": "https://cheat-sheets-ml.vercel.app/git/#tests-ci"
     },
     {
      "label": "Sheet · Docker · registries",
      "href": "https://cheat-sheets-ml.vercel.app/docker/#registries"
     }
    ],
    "inputs": [
     "commit with code, Dockerfiles and manifests",
     "Triton image from the model pipeline (station 5)"
    ],
    "outputs": [
     "image in ECR (immutable tag + digest)",
     "signed digest ready to deploy"
    ],
    "calcs": [
     {
      "id": "staging-cost",
      "label": "Staging T4 at 60 h/week",
      "out": "staging_cost",
      "expr": "price_gpu_h * staging_h_week * 52 / 12",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Staging GPU cost outside the infra line.",
      "check": null,
      "ref": "#c01.costo"
     },
     {
      "id": "staging-saving",
      "label": "Saving vs staging T4 24/7",
      "out": "staging_saving",
      "expr": "price_gpu_h * 730 - staging_cost",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Schedule staging off nights and weekends.",
      "check": null,
      "ref": "#c01.costo"
     }
    ]
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "igual",
    "title": "Kubernetes",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Run two Deployments on EKS spread across two zones — the gateway on CPU nodes (3–12 pods, HPA on CPU) and Triton on `g4dn.xlarge` nodes with one T4 per pod (2–4 pods, KEDA on queue time) — behind an internal ALB created from the Ingress by the AWS Load Balancer Controller.",
    "artifact": "pods listos detrás del ALB interno",
    "done": [
     "`kubectl get pods -o wide` shows 2 Triton pods READY on nodes in different zones and at least 3 gateways.",
     "GPU nodes advertise `nvidia.com/gpu: 1`, carry the taint, and no gateway runs on them.",
     "`kubectl get hpa` shows the gateway HPA and `keda-hpa-triton` with real metrics, no `unknown`.",
     "The Ingress has the internal ALB address and its targets pass the health check on `/readyz`.",
     "The ServiceMonitors exist and the alerts are loaded as a PrometheusRule."
    ],
    "commands": [
     {
      "code": "kubectl create namespace classifier",
      "note": "Once per cluster."
     },
     {
      "code": "kubectl label namespace classifier elbv2.k8s.aws/pod-readiness-gate-inject=enabled",
      "note": "ALB readiness gate: the rolling update does not kill an old pod until the ALB sees the new one healthy."
     },
     {
      "code": "kubectl apply -f k8s/triton.yaml -f k8s/keda-triton.yaml -f k8s/gateway.yaml -f k8s/monitoring.yaml",
      "note": "Declarative: you store the desired state and the controllers do the rest."
     },
     {
      "code": "kubectl get pods -n classifier -o wide",
      "note": "Phase, READY, restarts and node: one Triton per zone?"
     },
     {
      "code": "kubectl describe pod {pod} -n classifier",
      "note": "First stop when something does not start: the Events at the bottom say why."
     },
     {
      "code": "kubectl get nodes -L node.kubernetes.io/instance-type,topology.kubernetes.io/zone,workload",
      "note": "Type, zone and `workload=gpu-t4` label of each node."
     },
     {
      "code": "kubectl get hpa -n classifier",
      "note": "The gateway HPA and `keda-hpa-triton`, with the current metric against the target."
     }
    ],
    "links": [
     {
      "label": "Course · M06 · Orquestación y escalado · Los objetos que sí debes conocer",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.objetos-basicos"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · GPUs en Kubernetes",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.gpus-k8s"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · HPA: por qué escalar por CPU no sirve para un servicio de GPU",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.hpa"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · Alta disponibilidad: multi-AZ, PDB y N+1",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.alta-disponibilidad"
     },
     {
      "label": "Course · Comandos · Depurar pods: síntoma → comandos → causa típica",
      "href": "https://ronda-diseno-ml.vercel.app/#ref-comandos.depurar"
     },
     {
      "label": "Sheet · Del dato a producción · estación 9",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     },
     {
      "label": "Sheet · Kubernetes · Deployments",
      "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#deployments"
     },
     {
      "label": "Sheet · Kubernetes · probes",
      "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#probes"
     },
     {
      "label": "Sheet · Kubernetes · autoscaling",
      "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#autoscaling"
     }
    ],
    "inputs": [
     "image in ECR (tag + digest)",
     "k8s/*.yaml manifests"
    ],
    "outputs": [
     "ready pods behind the internal ALB",
     "HPA and ScaledObject scaling on their own"
    ],
    "calcs": [
     {
      "id": "gw-pods",
      "label": "Gateway pods at design QPS",
      "out": "gw_pods_peak",
      "expr": "max(ceil(gw_vcpu_req / gw_pod_cpu - 1e-9), hpa_min)",
      "unit": "pods",
      "tol": 0,
      "why": "HPA min/max for the gateway Deployment.",
      "check": {
       "expr": "gw_pods_peak <= hpa_max",
       "label": "Design peak fits under HPA maxReplicas"
      },
      "ref": "#c01.archivos"
     },
     {
      "id": "inflight-pod",
      "label": "In flight per pod at 200 ms latency",
      "out": "inflight_pod_200",
      "expr": "qps_design / gw_pods_peak * slo_p99_ms / 1000",
      "unit": "req",
      "tol": 0.02,
      "why": "Basis for MAX_INFLIGHT load shedding per pod.",
      "check": {
       "expr": "max_inflight <= inflight_pod_200",
       "label": "MAX_INFLIGHT sheds before a pod holds more than 200 ms of work"
      },
      "ref": "#m03.little"
     },
     {
      "id": "net-zone-loss",
      "label": "Gateway NIC load on one node after a zone loss",
      "out": "net_share_zone_loss",
      "expr": "net_gbps / node_baseline_gbps",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Relies on burst until a second node joins; watch node egress.",
      "check": null,
      "ref": "#c01.estimaciones"
     },
     {
      "id": "triton-cold-start",
      "label": "New Triton pod, worst case (node + pull + engine + ready)",
      "out": "triton_cold_start_min",
      "expr": "(node_up_s + pull_triton_s + engine_load_s + readiness_s) / 60",
      "unit": "min",
      "tol": 0.05,
      "why": "Why 2 warm replicas absorb spikes, not the autoscaler.",
      "check": null,
      "ref": "#m05.tamano"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "igual",
    "title": "Safe Rollout",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Release each model as a gateway vN + Triton vN pair with its own Service through shadow (1–2 days), canary 5 % → 25 % → 100 % with automatic rollback and, for large changes, a per-seller A/B, moving the champion alias on promotion and keeping the previous release live for 24–48 h.",
    "artifact": "versión nueva al 100 % (alias champion)",
    "done": [
     "The new release (gateway vN + Triton vN with its Service) is ready before it receives traffic.",
     "The criteria to roll back (5xx, p99, low confidence, PSI) and to advance are written before starting.",
     "Each canary stage collected at least 10,000 requests and covered a daytime peak.",
     "A person approved 100 %, the champion alias points to the new version and the previous one stays live for 24–48 h.",
     "Rollback is rehearsed: weight back to stable in seconds; redeploy of the previous tag in ≈ 5–20 min."
    ],
    "commands": [
     {
      "code": "kubectl diff -f k8s/triton.yaml",
      "note": "What would change before applying (exit 1 = there are differences)."
     },
     {
      "code": "kubectl rollout status deploy/triton -n classifier --timeout=25m",
      "note": "Waits for the rollout: each Triton pod can take minutes (node, image, engine)."
     },
     {
      "code": "kubectl argo rollouts promote gateway -n classifier",
      "note": "With Argo Rollouts: leaves the canary's manual pause."
     },
     {
      "code": "kubectl argo rollouts abort gateway -n classifier",
      "note": "Sends traffic back to stable; the Rollout stays `Degraded` until the template returns to the previous version (with GitOps, a revert)."
     },
     {
      "code": "kubectl rollout undo deploy/triton -n classifier",
      "note": "Back to the previous ReplicaSet: the previous tag is the previous model. With GitOps, a git revert."
     },
     {
      "code": "kubectl rollout history deploy/triton -n classifier",
      "note": "Revisions kept for rollback: C01 keeps 5."
     }
    ],
    "links": [
     {
      "label": "Course · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Canary: porcentajes, tiempos y criterios para avanzar",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.canary"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Rollback: criterios automáticos y qué guardar para volver",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.rollback"
     },
     {
      "label": "Course · C01 · API de clasificación · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
     },
     {
      "label": "Sheet · Del dato a producción · estación 10",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     },
     {
      "label": "Sheet · Kubernetes · rollouts",
      "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#rollouts"
     },
     {
      "label": "Sheet · Git y GitHub Actions · CD",
      "href": "https://cheat-sheets-ml.vercel.app/git/#cd"
     }
    ],
    "inputs": [
     "challenger in MLflow (alias challenger)",
     "Triton vN image in ECR"
    ],
    "outputs": [
     "new version at 100 % (alias champion)",
     "previous release live for 24–48 h for rollback"
    ],
    "calcs": [
     {
      "id": "canary-peak",
      "label": "Time to 10,000 canary requests at peak",
      "out": "canary_min_peak",
      "expr": "canary_n_min / (qps_peak * canary_share) / 60",
      "unit": "min",
      "tol": 0.05,
      "why": "5 % fills the 10-min rollback window at peak.",
      "check": {
       "expr": "canary_min_peak <= rollback_window_min",
       "label": "Peak traffic fills the 10-min rollback window"
      },
      "ref": "#c01.evaluacion"
     },
     {
      "id": "canary-avg",
      "label": "Time to 10,000 canary requests at average traffic",
      "out": "canary_h_avg",
      "expr": "canary_n_min / (qps_avg * canary_share) / 3600",
      "unit": "h",
      "tol": 0.05,
      "why": "Off-peak windows collect 3× less: stages last hours and span a peak.",
      "check": null,
      "ref": "#c01.evaluacion"
     },
     {
      "id": "ab-n",
      "label": "A/B sample per arm (acceptance rate)",
      "out": "ab_n_arm",
      "expr": "2 * (z_95 + z_beta)^2 * ab_base * (1 - ab_base) / ab_mde^2",
      "unit": "listings",
      "tol": 0.05,
      "why": "Minimum listings per arm before reading the A/B.",
      "check": null,
      "ref": "#c01.evaluacion"
     },
     {
      "id": "ab-time",
      "label": "Time to the A/B sample at 5 % treatment",
      "out": "ab_h_5pct",
      "expr": "ab_n_arm / (listings_day * ab_share / 24)",
      "unit": "h",
      "tol": 0.05,
      "why": "Sample comes in hours; run 1–2 weeks for seasonality.",
      "check": null,
      "ref": "#c01.evaluacion"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "igual",
    "title": "Live Request Path",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "Serve each photo through the internal ALB → gateway (validate, decode, 602 KB tensor on CPU) → Triton (≤ 2 ms batching) → TensorRT FP16 on the T4 within p99 ≤ 200 ms server-side, with cascading timeouts (`300 → 250 → 150 → 100 ms`) and the caller's manual selector as fallback.",
    "artifact": "una línea de log JSON y métricas por request",
    "done": [
     "Every response carries `model_version` and `X-Request-ID`, and every log line carries `preprocess_ms` and `inference_ms`.",
     "The p99 of the gateway histogram, summed across pods, stays under 200 ms at the design peak (500 req/s).",
     "Timeouts are chained: 300 ms the caller, 250 ms the deadline, 150 ms to Triton and 100 ms in the queue.",
     "Under overload you see fast 503s and 504s (and the manual selector), not hung requests.",
     "Each gateway calls the Triton in its own zone."
    ],
    "commands": [
     {
      "code": "curl -s -H \"Content-Type: image/jpeg\" --data-binary @{foto} \"localhost:8080/v1/classify?top_k=5\"",
      "note": "Locally (compose): the response carries `model_version` and `latency_ms`, plus the `X-Request-ID` header."
     },
     {
      "code": "curl -i localhost:8080/readyz",
      "note": "200 only if the model is ready in Triton; on EKS, a 503 takes the pod out of the ALB."
     },
     {
      "code": "kubectl logs deploy/gateway -n classifier --tail=5",
      "note": "One JSON line per request: `request_id`, `preprocess_ms`, `inference_ms`, `status`."
     },
     {
      "code": "kubectl port-forward -n classifier svc/triton 8000:8000 8002:8002",
      "note": "Tunnel to a Triton pod without exposing it: for inspection, not for load tests."
     },
     {
      "code": "curl -s localhost:8002/metrics | grep nv_inference_queue_duration_us",
      "note": "Cumulative time in Triton's queue: the signal KEDA scales on."
     }
    ],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.arquitectura"
     },
     {
      "label": "Course · C01 · API de clasificación · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.estimaciones"
     },
     {
      "label": "Course · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Course · C01 · API de clasificación · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.serving"
     },
     {
      "label": "Course · M07 · Servidores de modelos · Protocolos: REST, gRPC, KServe v2 y OpenAI-compatible",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.protocolos"
     },
     {
      "label": "Sheet · Del dato a producción · estación 11",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     },
     {
      "label": "Sheet · El gateway · timeouts y reintentos",
      "href": "https://cheat-sheets-ml.vercel.app/gateway/#upstream"
     },
     {
      "label": "Sheet · El gateway · admisión",
      "href": "https://cheat-sheets-ml.vercel.app/gateway/#backpressure"
     },
     {
      "label": "Sheet · Formulario de estimaciones · latencia",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/#latencia"
     }
    ],
    "inputs": [
     "photo (≈ 200 KB) from the listing backend"
    ],
    "outputs": [
     "one JSON log line and metrics per request",
     "top-5 with model_version and X-Request-ID for the caller"
    ],
    "calcs": [
     {
      "id": "deadline-headroom",
      "label": "Caller timeout minus gateway deadline",
      "out": "deadline_headroom_ms",
      "expr": "caller_timeout_ms - req_deadline_ms",
      "unit": "ms",
      "tol": 0,
      "why": "The 504 reaches the caller before it gives up.",
      "check": {
       "expr": "caller_timeout_ms > req_deadline_ms && req_deadline_ms > infer_timeout_ms && infer_timeout_ms > queue_timeout_ms",
       "label": "Timeouts strictly decrease 300 → 250 → 150 → 100 ms"
      },
      "ref": "#c01.serving"
     },
     {
      "id": "hung-total",
      "label": "Requests held if Triton stalls to the timeout",
      "out": "hung_total",
      "expr": "qps_design * infer_timeout_ms / 1000",
      "unit": "req",
      "tol": 0.02,
      "why": "Upper bound for the connection pool to Triton.",
      "check": null,
      "ref": "#m03.little"
     },
     {
      "id": "hung-pod",
      "label": "Held requests per gateway pod",
      "out": "hung_per_pod",
      "expr": "hung_total / gw_pods_peak",
      "unit": "req",
      "tol": 0.02,
      "why": "A full Triton stall stays inside MAX_INFLIGHT.",
      "check": {
       "expr": "hung_per_pod <= max_inflight",
       "label": "Stall fits within MAX_INFLIGHT per pod"
      },
      "ref": "#m03.little"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "igual",
    "title": "Monitoring & Retraining",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Catch loud failures (errors, latency, pods down) in Prometheus within minutes and page on them, ticket silent ones (confidence, PSI, acceptance), and feed prediction logs and a retraining trigger back into labeling at station 1.",
    "artifact": "disparador de reentrenamiento y muestras para etiquetar",
    "done": [
     "The 6 alerts evaluate with their severity (page, warning or ticket) and each one has a runbook.",
     "There are dashboards for service, Triton and GPU, model (split by `model_version`) and business.",
     "100 % of predictions reach S3 without PII and the daily job publishes PSI and acceptance.",
     "A trigger (monthly, PSI above 0.2 for 3 days, −3 pp acceptance or a new category) opens a ticket and brings the pipeline forward; nothing is promoted without gate and canary.",
     "Low confidence, disagreements and a random sample reach the labeling queue (station 1)."
    ],
    "commands": [
     {
      "code": "kubectl apply -f k8s/monitoring.yaml",
      "note": "Gateway and Triton ServiceMonitors; the `alerts.yml` rules are loaded separately as a PrometheusRule (command in the README)."
     },
     {
      "code": "histogram_quantile(0.99, sum by (le) (rate(classifier_request_latency_seconds_bucket[5m])))",
      "note": "p99 PromQL: sum buckets across pods first, then take the quantile."
     },
     {
      "code": "sum(rate(classifier_requests_total{status=~\"5..\"}[5m])) / sum(rate(classifier_requests_total{status!~\"4..\"}[5m]))",
      "note": "5xx fraction over valid requests: 4xx do not count."
     },
     {
      "code": "sum(rate(nv_inference_count{model=\"classifier\"}[5m])) / sum(rate(nv_inference_exec_count{model=\"classifier\"}[5m]))",
      "note": "Triton's real average batch size: measure it, do not assume it."
     },
     {
      "code": "kubectl describe scaledobject triton -n classifier",
      "note": "If Prometheus cannot see Triton, the scaler error shows up here, not a silent 0."
     }
    ],
    "links": [
     {
      "label": "Course · C01 · API de clasificación · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.monitoreo"
     },
     {
      "label": "Course · M12 · Monitoreo · Métricas de sistema: golden signals con detalles de ML",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.sistema"
     },
     {
      "label": "Course · M12 · Monitoreo · Métricas de modelo: con y sin labels",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.modelo"
     },
     {
      "label": "Course · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Course · M12 · Monitoreo · Cuándo reentrenar (y cuándo no)",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.reentrenar"
     },
     {
      "label": "Course · M10 · MLOps · Reentrenamiento: programado, disparado o continuo",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reentrenamiento"
     },
     {
      "label": "Sheet · Del dato a producción · estación 12",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     },
     {
      "label": "Sheet · Prometheus y Grafana · tipos de métrica",
      "href": "https://cheat-sheets-ml.vercel.app/prometheus/#metricas"
     },
     {
      "label": "Sheet · Prometheus y Grafana · histogramas",
      "href": "https://cheat-sheets-ml.vercel.app/prometheus/#histogramas"
     },
     {
      "label": "Sheet · Prometheus y Grafana · SLOs",
      "href": "https://cheat-sheets-ml.vercel.app/prometheus/#slos"
     }
    ],
    "inputs": [
     "metrics on /metrics (gateway :8080, Triton :8002)",
     "prediction logs and caller events"
    ],
    "outputs": [
     "retraining trigger and samples to label",
     "alerts (page, warning, ticket) and dashboards"
    ],
    "calcs": [
     {
      "id": "error-budget-req",
      "label": "Error budget in requests per month",
      "out": "error_budget_req",
      "expr": "n_day * 30 * (1 - slo)",
      "unit": "req/month",
      "tol": 0.02,
      "why": "Failed requests allowed per month; burn alerts spend it.",
      "check": null,
      "ref": "#c01.requisitos"
     },
     {
      "id": "budget-page",
      "label": "Budget consumed by a 1 h fast burn",
      "out": "budget_frac_page",
      "expr": "burn_page * page_window_h / slo_window_h",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Page only when 2 % of the month burns in an hour.",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     },
     {
      "id": "err-thr-page",
      "label": "5xx ratio threshold for the fast-burn page",
      "out": "err_thr_page",
      "expr": "burn_page * (1 - slo)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "The number in the PrometheusRule (1h and 5m windows).",
      "check": null,
      "ref": "#c01.monitoreo"
     },
     {
      "id": "budget-ticket",
      "label": "Budget consumed by a 6 h slow burn",
      "out": "budget_frac_ticket",
      "expr": "burn_ticket * ticket_window_h / slo_window_h",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Ticket at 6× (5 % of the month in 6 h).",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     }
    ]
   }
  ],
  "batch": [
   {
    "id": "kickoff",
    "base": "kickoff",
    "status": "nuevo",
    "title": "Requirements & Capacity Plan",
    "tramo": "diseno",
    "speed": "diseno",
    "question": "",
    "note": "Fix the nightly deadline (published by 03:30, ERP reads at 04:00), the series volume, the accuracy targets and the ≈ US$3–5k/month budget, and size the window, compute and cost from them.",
    "artifact": "",
    "inputs": [],
    "outputs": [],
    "done": [
     "Series and nightly rows are computed from the assortment: 400 stores × ≈ 12,000 products ≈ 4.8 M series, × 14 horizons ≈ 67.2 M rows per night.",
     "The window is budgeted: data cutoff at 01:30, published by 03:30, ERP reads at 04:00; ≤ 60 min per attempt leaves room for one full retry.",
     "Compute is sized: prediction ≈ 67 core-min (2–5 min on 32 vCPU), feature build on ≈ 16 × r7i.4xlarge spot in ≈ 20–40 min, weekly training on ≈ 490 M rows on an r7i.24xlarge spot in ≈ 2–3 h.",
     "Monthly infra is ≈ US$3–5k, and 100 % of nights have a published forecast (fresh or fallback), with full fallback ≤ 1 night per month."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.requisitos"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.estimaciones"
     },
     {
      "label": "Sheet · Formulario de estimaciones · C01 sizing chain",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/"
     }
    ],
    "calcs": [
     {
      "id": "series",
      "label": "Store × product series",
      "out": "series",
      "expr": "n_stores * products_per_store",
      "unit": "series",
      "tol": 0.02,
      "why": "Fixes the gate row count and every downstream volume.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "rows-night",
      "label": "Forecast rows per night",
      "out": "rows_night",
      "expr": "series * horizons",
      "unit": "rows",
      "tol": 0.02,
      "why": "Exact row count the gate expects every night.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "predict-core-min",
      "label": "Scoring CPU per night",
      "out": "predict_core_min",
      "expr": "rows_night * n_models * us_per_row_core / 1e6 / 60",
      "unit": "core-min",
      "tol": 0.02,
      "why": "Scoring is minutes of CPU: no GPU fleet.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "predict-wall-min",
      "label": "Scoring wall time on the cluster",
      "out": "predict_wall_min",
      "expr": "predict_core_min / cluster_vcpu",
      "unit": "min",
      "tol": 0.05,
      "why": "Puts the time budget on the feature build, not on scoring.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "compute-window-min",
      "label": "Compute window, cutoff to deadline",
      "out": "compute_window_min",
      "expr": "deadline_min - cutoff_min",
      "unit": "min",
      "tol": 0,
      "why": "The SLO is a deadline: this is the whole budget.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "attempt-budget-min",
      "label": "Budget per attempt",
      "out": "attempt_budget_min",
      "expr": "compute_window_min / n_attempts",
      "unit": "min",
      "tol": 0,
      "why": "Caps run duration so one full retry still fits.",
      "check": {
       "expr": "run_max_min <= attempt_budget_min",
       "label": "A full run fits in half the window (room for one retry)"
      },
      "ref": "#c14.estimaciones"
     },
     {
      "id": "retry-margin-min",
      "label": "Margin left for a retry",
      "out": "retry_margin_min",
      "expr": "compute_window_min - run_max_min",
      "unit": "min",
      "tol": 0,
      "why": "Duration becomes a trended, alerted metric once this margin shrinks.",
      "check": {
       "expr": "retry_margin_min >= run_max_min",
       "label": "A full retry fits before 03:30"
      },
      "ref": "#c14.estimaciones"
     },
     {
      "id": "waste-point-usd",
      "label": "Value of one point of fresh waste",
      "out": "waste_point_usd",
      "expr": "annual_sales_usd * fresh_share * 0.01",
      "unit": "US$/year",
      "tol": 0.02,
      "why": "Puts accuracy in fresh, not infrastructure, at the top of the list.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "waste-goal-usd",
      "label": "Value of the −20 % waste goal",
      "out": "waste_goal_usd",
      "expr": "annual_sales_usd * fresh_share * waste_rate * waste_cut",
      "unit": "US$/year",
      "tol": 0.02,
      "why": "Business case of the project.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "stockout-goal-usd",
      "label": "Margin from the −25 % stockout goal",
      "out": "stockout_goal_usd",
      "expr": "annual_sales_usd * stockout_rate * stockout_cut * gross_margin",
      "unit": "US$/year",
      "tol": 0.02,
      "why": "Second half of the business case, in margin, not sales.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "infra-share-goals",
      "label": "Infra cost as share of the goals",
      "out": "infra_share_goals",
      "expr": "infra_month_usd * 12 / (waste_goal_usd + stockout_goal_usd)",
      "unit": "fraction",
      "tol": 0.05,
      "why": "Infra is noise: no machine decision gets more than one sentence.",
      "check": null,
      "ref": "#c14.estimaciones"
     }
    ]
   },
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "POS Sales & Stockouts",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Land nightly POS sales (`sales_daily`, the label, at 00:30) with no human labeling, and drop stockout days (`oos_flag`) from the targets because their sales are not demand.",
    "artifact": "",
    "done": [
     "`sales_daily` and `stock_daily` (with `oos_flag`) land every night: sales at 00:30 (stores with poor connectivity, until 01:30) and closing stock at 01:00.",
     "Days with `oos_flag` are excluded from targets and enter lags and means as NaN; `oos_days_7` and `oos_days_28` count how many there were.",
     "Each series is densified against the assortment: true zero, stockout and missing data stay distinct, and a store that uploaded nothing never counts as sales of 0.",
     "`price_promo` enters with the plan as known at the origin, and `retail_events.yaml` has the Buen Fin and Hot Sale dates for the year the features look at.",
     "The `features/` tests pass, including the leakage test: with everything after `run_date` poisoned, the features come out identical."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.datos"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M09 · Datos y features · Data leakage: cuando el training conoce el futuro",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.leakage"
     },
     {
      "label": "Sheet · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ],
    "inputs": [
     "POS sales `sales_daily` (00:30)",
     "stockout flag `oos_flag`"
    ],
    "outputs": [],
    "calcs": [
     {
      "id": "hist-cells-ref",
      "label": "History cells, reference features",
      "out": "hist_cells_ref",
      "expr": "series * hist_days_ref",
      "unit": "cells",
      "tol": 0.02,
      "why": "Size of what the nightly job reads with 10-week features.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "hist-gb-ref",
      "label": "History size, reference features",
      "out": "hist_gb_ref",
      "expr": "hist_cells_ref * bytes_float / 1e9",
      "unit": "GB",
      "tol": 0.05,
      "why": "Fits one machine: no cluster needed for the MVP.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "hist-rows-annual",
      "label": "History rows with annual features",
      "out": "hist_rows_annual",
      "expr": "series * hist_days_annual",
      "unit": "rows/table",
      "tol": 0.02,
      "why": "Annual features are what push the feature build to Spark.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "hist-gb-annual",
      "label": "History size per table, annual features",
      "out": "hist_gb_annual",
      "expr": "hist_rows_annual * bytes_hist_row / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "Sizes the feature-build cluster and its memory.",
      "check": null,
      "ref": "#c14.estimaciones"
     }
    ]
   },
   {
    "id": "sensores-con-hora-de-corte",
    "base": null,
    "status": "nuevo",
    "title": "Cutoff Sensors",
    "tramo": "datos",
    "speed": "nuevo",
    "question": "",
    "note": "Wait for each store's sales and stock until all stores report or 01:30, and impute the missing ones with the same weekday of last week, flagged `imputed_input`.",
    "artifact": "",
    "done": [
     "`wait_sales` and `wait_stock` run in reschedule mode, poking every 5 min, and finish when all stores have reported or at 01:30, whichever comes first.",
     "No sensor fails on incomplete data; its backstop timeout is 2 h and, if it expires, the job does not run and the fallback goes out.",
     "Stores missing at cutoff are imputed with their same weekday of last week (sales and stockout flag), and their rows carry `imputed_input`.",
     "`InputDataIncomplete` opens a ticket above 2 % imputed stores, and above 5 % the gate blocks the night."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M09 · Datos y features · Pipelines batch y streaming",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.pipelines"
     },
     {
      "label": "Sheet · Del dato a producción · patrón batch",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
     }
    ],
    "inputs": [
     "per-store sales and stock"
    ],
    "outputs": [
     "imputed rows flagged `imputed_input`"
    ],
    "calcs": [
     {
      "id": "impute-ticket-stores",
      "label": "Imputed stores that open a ticket",
      "out": "impute_ticket_stores",
      "expr": "n_stores * impute_ticket_share",
      "unit": "stores",
      "tol": 0,
      "why": "InputDataIncomplete threshold.",
      "check": null,
      "ref": "#c14.monitoreo"
     },
     {
      "id": "impute-block-stores",
      "label": "Imputed stores that block the night",
      "out": "impute_block_stores",
      "expr": "n_stores * impute_block_share",
      "unit": "stores",
      "tol": 0,
      "why": "Above this the gate blocks and the fallback is published.",
      "check": null,
      "ref": "#c14.requisitos"
     },
     {
      "id": "latest-publish-min",
      "label": "Latest first-attempt publish (minutes after 00:00)",
      "out": "latest_publish_min",
      "expr": "cutoff_min + run_max_min",
      "unit": "min",
      "tol": 0,
      "why": "Sensors end at the cutoff at the latest, so this is 02:30.",
      "check": null,
      "ref": "#c14.estimaciones"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "cambia",
    "title": "Snapshots & Immutable Partitions",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Pin a table snapshot for every training run (Iceberg or Delta time travel, or a dated copy) and keep every published night as an immutable, hash-named partition: the archive of what the ERP used.",
    "artifact": "",
    "done": [
     "Each training run uses a pinned table snapshot (Iceberg or Delta time travel, or a dated copy) recorded with the model.",
     "Each model stores its snapshot, the feature-code commit, the sampling config and the library versions.",
     "Each night writes an immutable version of the `run_date` partition of `forecast_daily`, named by the hash of its content: re-running it with the same data returns `already_published`.",
     "Every `forecast_daily` row carries `run_date` and `model_version`, and old versions are never deleted: they are the forecast archive."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.datos"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Course · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ],
    "inputs": [],
    "outputs": [
     "pinned training snapshot",
     "immutable hash-named nightly partition"
    ],
    "calcs": [
     {
      "id": "out-gb-night",
      "label": "Forecast partition size per night",
      "out": "out_gb_night",
      "expr": "rows_night * bytes_per_out_row / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "Immutable partitions are cheap to keep: never delete them.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "archive-tb-year",
      "label": "Forecast archive per year, uncompressed",
      "out": "archive_tb_year",
      "expr": "out_gb_night * 365 / 1000",
      "unit": "TB",
      "tol": 0.02,
      "why": "Keeping two years for audit is a storage non-issue.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "archive-usd-month",
      "label": "Archive cost after one year, uncompressed",
      "out": "archive_usd_month",
      "expr": "archive_tb_year * 1000 * s3_price_gb_month",
      "unit": "US$/month",
      "tol": 0.03,
      "why": "Upper bound; Parquet brings it to ≈ US$3–5.",
      "check": null,
      "ref": "#c14.estimaciones"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Weekly Quantile Training",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Train two quantile GBDTs (P50 and P90) every Sunday on ≈ 490 M point-in-time rows on a 96-vCPU spot node in ≈ 2–3 h, with no GPU.",
    "artifact": "",
    "done": [
     "Every Sunday a point-in-time training set of ≈ 490 M rows is built: top series with 52 full weeks, 10 % of the rest at weight 10 and one sampled horizon per row, with the seed recorded.",
     "Two quantile models (α = 0.5 and 0.9) come out of a 96-vCPU spot node in ≈ 2–3 h; if spot interrupts it, it is retried.",
     "P50 for fast movers does not come out at 0 (in the reference, with count jittering) and random early stopping is off.",
     "The model stores its scikit-learn version, and `train_quantile.load` refuses to load it under a different one."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.datos"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M10 · MLOps · Pipelines de entrenamiento orquestados",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
     },
     {
      "label": "Course · M13 · Nube · Spot y preemptible: para qué sí y para qué no",
      "href": "https://ronda-diseno-ml.vercel.app/#m13.spot"
     },
     {
      "label": "Sheet · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ],
    "inputs": [
     "≈ 490 M point-in-time rows"
    ],
    "outputs": [
     "P50 and P90 quantile GBDTs"
    ],
    "calcs": [
     {
      "id": "train-rows",
      "label": "Training set rows",
      "out": "train_rows",
      "expr": "series * top_share * train_days + series * (1 - top_share) * train_days * rest_sample",
      "unit": "rows",
      "tol": 0.02,
      "why": "Decides single node vs distributed training.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "train-mem-fp32-gb",
      "label": "Training set in float32",
      "out": "train_mem_fp32_gb",
      "expr": "train_rows * n_features * bytes_float / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "Fits one large CPU node: no distributed training.",
      "check": {
       "expr": "train_mem_fp32_gb * 1e9 / 2^30 < train_node_ram_gib",
       "label": "Fits in the RAM of one r7i.24xlarge"
      },
      "ref": "#c14.estimaciones"
     },
     {
      "id": "train-mem-binned-gb",
      "label": "Training set binned (1 B/feature)",
      "out": "train_mem_binned_gb",
      "expr": "train_rows * n_features * bytes_binned / 1e9",
      "unit": "GB",
      "tol": 0.03,
      "why": "What histogram GBDTs actually hold in memory.",
      "check": null,
      "ref": "#c14.estimaciones"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "8-Origin Backtest Gate",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Gate every recipe change on a rolling-origin backtest with 8 weekly origins: better WAPE than the champion and no major segment worse by more than 2 points.",
    "artifact": "",
    "done": [
     "A recipe change runs the rolling-origin backtest with 8 weekly origins; each origin trains only on rows whose `target_date` has already passed.",
     "The candidate has better WAPE than the champion, and no large segment (fresh, grocery, fast, slow, with and without promotion) worsens by more than 2 points.",
     "WAPE, bias, pinball and P90 coverage are computed without stockout days, by segment and horizon, and against seasonal naive.",
     "The weekly retrain of the same recipe passes the artifact gate: expected rows and features, loss in its range, few quantile crossings and one night in shadow.",
     "The version enters the registry as `challenger` with its lineage: snapshot, commit, config and backtest results."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.evaluacion"
     },
     {
      "label": "Course · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Course · M10 · MLOps · Model registry: versiones, aliases y linaje",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.model-registry"
     },
     {
      "label": "Sheet · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "Nightly Forecast Job",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Run `run_forecast.py` as the serving layer — impute, build features, predict ≈ 67 M rows and write a new partition — with no endpoint.",
    "artifact": "",
    "done": [
     "`run_forecast.py nightly` runs the night in 7 steps: completeness and imputation, calendar check, features, prediction, write, gate and compare-and-swap.",
     "Features come from the same function that builds the training set, and the job first checks that `retail_events.yaml` covers the horizon and the 30 days that `days_to_` looks at; otherwise it fails loudly.",
     "It predicts P50 and P90 for ≈ 67 M rows on CPU with the version pinned at startup: whole pieces, sorted per row, clipped at 0 and with crossings counted.",
     "Each attempt fits in ≤ 60 min (01:30 to 03:30 leaves room for one retry) and pushes only that attempt's metrics with `pushadd`.",
     "`pytest` in `reference/c14` passes the 73 tests (the DAG test is skipped without Airflow)."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Batch: precomputar en vez de servir",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.batch"
     },
     {
      "label": "Sheet · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ],
    "inputs": [],
    "outputs": [
     "new `forecast_daily` partition"
    ],
    "calcs": [
     {
      "id": "shard-rows",
      "label": "History rows per store shard",
      "out": "shard_rows",
      "expr": "products_per_store * hist_days_annual",
      "unit": "rows",
      "tol": 0.02,
      "why": "One store fits in one task’s memory: shard by store.",
      "check": null,
      "ref": "#c14.estimaciones"
     }
    ]
   },
   {
    "id": "gate-de-salida-y-swap-atomico",
    "base": null,
    "status": "nuevo",
    "title": "Output Gate & Atomic Swap",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "Write–audit–publish: the gate re-reads what was written (rows = series × 14, p90 ≥ p50, per-category bands) and publishing is a compare-and-swap of the `forecast_current` pointer, so the ERP never sees a half-written table.",
    "artifact": "",
    "done": [
     "The gate reads back the already-written partition: rows = series × 14 (± 0.5 %), no duplicate keys, nulls or negatives, p90 ≥ p50 and imputed stores ≤ 5 %.",
     "The per-category band compares 7-day Σ P50 against Σ of the medians of the last 4 same weekdays, fast movers only, within ±30 %; with a promotion or holiday it widens to [1/3×, 3×].",
     "Publishing is a compare-and-swap of the `forecast_current` pointer (`UPDATE … WHERE partition = :esperado`): if it affects 0 rows, it fails instead of overwriting.",
     "The pointer follows its rules: never backwards, a fallback never replaces the same night's model forecast, and after 03:55 it does not move.",
     "If the gate blocks, the fallback goes out and `ForecastValidationBlocked` pages."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M09 · Datos y features · Validación de datos: schemas y expectativas",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.validacion-datos"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Batch: precomputar en vez de servir",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.batch"
     },
     {
      "label": "Sheet · Del dato a producción · patrón batch",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
     }
    ],
    "inputs": [
     "written nightly partition"
    ],
    "outputs": [
     "`forecast_current` pointer swapped to the new partition"
    ],
    "calcs": [
     {
      "id": "row-count-min",
      "label": "Gate floor on row count",
      "out": "row_count_min",
      "expr": "rows_night * (1 - row_count_tol)",
      "unit": "rows",
      "tol": 0.01,
      "why": "Below this the gate blocks the publish.",
      "check": null,
      "ref": "#c14.archivos"
     },
     {
      "id": "row-count-max",
      "label": "Gate ceiling on row count",
      "out": "row_count_max",
      "expr": "rows_night * (1 + row_count_tol)",
      "unit": "rows",
      "tol": 0.01,
      "why": "Above this (duplicates) the gate blocks the publish.",
      "check": null,
      "ref": "#c14.archivos"
     }
    ]
   },
   {
    "id": "fallback-y-guardian-de-las-03-45",
    "base": null,
    "status": "nuevo",
    "title": "Fallback & 03:45 Guard",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "Publish yesterday's forecast shifted one day when the job fails or the gate blocks, with a separate DAG that publishes it at 03:45 if nothing went out.",
    "artifact": "",
    "done": [
     "The fallback runs on the last published forecast: yesterday's horizons 2..14 become 1..13 and day 14 comes from seasonal naive, with `fallback` = true and its `reason`.",
     "Three paths publish it: the job if the model or the gate fails, `publish_fallback` (trigger rule `all_failed`, always on-demand) if the job fails twice, and `forecast_fallback_guard` at 03:45 if nothing from the night is published.",
     "The fallback builds no features (its naive reads 28 days of sales and stock) and passes the gate's structure rules.",
     "`FallbackForecastServed` opens a ticket on every fallback night, and two nights in a row are escalated."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.fallas"
     },
     {
      "label": "Course · M15 · Seguridad y confiabilidad · Degradación con gracia: contener la falla",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.degradacion"
     },
     {
      "label": "Sheet · Del dato a producción · patrón batch",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
     }
    ],
    "inputs": [
     "yesterday's published forecast"
    ],
    "outputs": [
     "fallback forecast shifted one day"
    ],
    "calcs": [
     {
      "id": "erp-margin-min",
      "label": "Margin between deadline and ERP read",
      "out": "erp_margin_min",
      "expr": "erp_read_min - deadline_min",
      "unit": "min",
      "tol": 0,
      "why": "Time to get the fallback out after ForecastRunLate fires.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "guard-window-min",
      "label": "Guard window before the pointer freeze",
      "out": "guard_window_min",
      "expr": "freeze_min - guard_min",
      "unit": "min",
      "tol": 0,
      "why": "Caps the guard task timeout.",
      "check": {
       "expr": "guard_timeout_min <= guard_window_min",
       "label": "Guard finishes before the 03:55 freeze"
      },
      "ref": "#c14.serving"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "cambia",
    "title": "Single Job Image",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Build one image (`forecast-job`, pinned by digest) that both trains and predicts, because a model saved with scikit-learn's pickle is not portable across versions.",
    "artifact": "",
    "done": [
     "A single image (`forecast-job`) trains and predicts, and the DAG uses it by digest, not by tag.",
     "The image installs the `train/requirements.txt` lock (14 packages) and the code in `features/`, `train/` and `batch/`.",
     "The entrypoint is `python run_forecast.py`, and `OMP_NUM_THREADS` equals the cores the pod requests.",
     "A model saved with a different scikit-learn version does not load: the job rejects it instead of predicting with it."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M05 · Contenedores · Registries y tags inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.registries"
     },
     {
      "label": "Sheet · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ],
    "inputs": [],
    "outputs": [
     "`forecast-job` image (pinned by digest)"
    ],
    "calcs": []
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD, Image & DAG",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Test and build the image as in C01, and also deploy the `forecast_nightly` DAG to Airflow.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "`pytest` passes the 73 tests in the four folders on every commit, without warehouse, Spark or Airflow.",
     "`promtool check rules` and `promtool test rules` pass on `monitoring/alerts.yml`.",
     "In a venv with Airflow 3.3.2 and the Kubernetes provider, the 10 DAG tests pass (import, timetable, templates and serialization).",
     "`forecast_nightly_dag.py` and `nightly_rules.py` are deployed to the DAG bundle and wherever the triggerer imports them, with the `warehouse` connection created.",
     "The job image is published once, and the DAG points to that same digest."
    ],
    "commands": [
     {
      "code": "cd reference/c01/gateway && pip install -r requirements-dev.txt && pytest",
      "note": "24 tests with no GPU or Triton: the first thing CI runs."
     },
     {
      "code": "aws ecr get-login-password --region {region} | docker login --username AWS --password-stdin {registry}",
      "note": "ECR login; the token lasts 12 h. In CI, via an OIDC-assumed role, no stored keys."
     },
     {
      "code": "docker buildx build --platform linux/amd64 -t {registry}/classifier-gateway:{sha} --push gateway/",
      "note": "Single build for the node architecture; `{sha}` is the first 7 characters of the commit: `git rev-parse --short=7 HEAD` (in CI, `${GITHUB_SHA::7}`)."
     },
     {
      "code": "crane digest {registry}/classifier-gateway:{sha}",
      "note": "The digest is the identity: it is what gets signed and deployed."
     },
     {
      "code": "cosign sign --yes {registry}/classifier-gateway@{digest}",
      "note": "Keyless signing with the CI's OIDC identity."
     },
     {
      "code": "kubectl -n classifier set image deployment/gateway gateway={registry}/classifier-gateway@{digest}",
      "note": "Deploy by digest; with GitOps that value goes in a PR to the manifests repo."
     }
    ],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Sheet · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ],
    "inputs": [],
    "outputs": [
     "`forecast_nightly` DAG deployed to Airflow"
    ],
    "calcs": []
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "Job Pod, No Deployment",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Launch the job as a pod from Airflow (`KubernetesPodOperator`), with the first attempt on a Karpenter spot node and the retry on on-demand, and no Deployment, HPA or ALB.",
    "artifact": "",
    "done": [
     "There is no Deployment, HPA or ALB: `run_forecast` runs with `KubernetesPodOperator` in the `forecasting` namespace.",
     "The first attempt goes to a spot node and the retry to on-demand, via the `karpenter.sh/capacity-type` `node_selector`; `publish_fallback` and the guard always run on-demand.",
     "The job pod has a 90 min `execution_timeout`, a memory limit and no CPU limit.",
     "Karpenter has both capacity types, and a failed pod is kept so its logs can be read."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · Aprovisionar nodos GPU: Cluster Autoscaler y Karpenter",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.nodos"
     },
     {
      "label": "Course · M13 · Nube · Spot y preemptible: para qué sí y para qué no",
      "href": "https://ronda-diseno-ml.vercel.app/#m13.spot"
     },
     {
      "label": "Sheet · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "publish-if-timeout-min",
      "label": "Publish time if attempt 1 hits the timeout (minutes after 00:00)",
      "out": "publish_if_timeout_min",
      "expr": "cutoff_min + dag_timeout_min + run_max_min",
      "unit": "min",
      "tol": 0,
      "why": "The 90-min execution_timeout only kills hung attempts; the target stays ≤ 60.",
      "check": null,
      "ref": "#c14.serving"
     }
    ]
   },
   {
    "id": "job-programado-dag-forecast-nightly",
    "base": null,
    "status": "nuevo",
    "title": "Scheduled DAG (forecast_nightly)",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Trigger the run from Airflow at 00:30 with `catchup=False` and `max_active_runs=1`, because a past night's forecast is useless for today's order and two nights at once would fight over the pointer.",
    "artifact": "",
    "done": [
     "`forecast_nightly` runs on cron `30 0 * * *` in America/Mexico_City, with `catchup=False` and `max_active_runs=1`.",
     "`run_date_for` converts the logical date to store time (it does not use `ds`, which is UTC), and a test covers it with a manual run at 19:00.",
     "The DAG has a Deadline Alert at 03:30 (logical date + 3 h) whose callback notifies Alertmanager.",
     "Tasks run `[wait_sales, wait_stock] >> run_forecast >> publish_fallback`, and `forecast_fallback_guard` is a separate DAG with cron `45 3 * * *`."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M10 · MLOps · Pipelines de entrenamiento orquestados",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
     },
     {
      "label": "Sheet · Del dato a producción · patrón batch",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "idle-node-h-night",
      "label": "Billed idle node-hours if started early",
      "out": "idle_node_h_night",
      "expr": "spark_nodes * idle_wait_h",
      "unit": "node-h/night",
      "tol": 0.02,
      "why": "Why sensors wait in reschedule mode instead of a running cluster.",
      "check": null,
      "ref": "#c14.estimaciones"
     },
     {
      "id": "idle-usd-month",
      "label": "Cost of waiting on a running cluster",
      "out": "idle_usd_month",
      "expr": "idle_node_h_night * days_month * price_node_spot_h",
      "unit": "US$/month",
      "tol": 0.03,
      "why": "Billed is not busy: ≈ US$100–200/month.",
      "check": null,
      "ref": "#c14.estimaciones"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Shadow, Alias & Pilot",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Run the challenger one night in shadow through the same gate and promote it by moving the `champion` alias, with no traffic canary, and measure business value with 40 pilot stores against 40 control stores.",
    "artifact": "",
    "done": [
     "The challenger runs one night in shadow alongside the champion, and its output goes through the same gate.",
     "Promoting means moving the `champion` alias; each run resolves it to a version at startup, and the previous one stays ready for a one-minute rollback.",
     "The pilot matches 40 store pairs (format, DC, sales) and randomizes within each pair: 8 weeks, difference-in-differences on stockouts and shrink.",
     "The first 2 pilot weeks are burn-in and do not count, and management overrides are logged and measured with FVA.",
     "Rolling back an already-published night means re-running it with the previous champion before 03:55, never pointing the view at an old night."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.evaluacion"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Course · M11 · Despliegue seguro · A/B testing: unidad, métricas y tamaño de muestra",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.ab-testing"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Rollback: criterios automáticos y qué guardar para volver",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.rollback"
     },
     {
      "label": "Sheet · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "pilot-measured-weeks",
      "label": "Pilot weeks that count",
      "out": "pilot_measured_weeks",
      "expr": "pilot_weeks - burnin_weeks",
      "unit": "weeks",
      "tol": 0,
      "why": "Burn-in weeks are excluded from the readout.",
      "check": null,
      "ref": "#c14.evaluacion"
     },
     {
      "id": "pilot-se-pts",
      "label": "Std error of the stockout effect",
      "out": "pilot_se_pts",
      "expr": "pilot_sigma_pts * sqrt(2 / pilot_pairs)",
      "unit": "points",
      "tol": 0.03,
      "why": "Says whether 40 pairs can detect the −25 % goal.",
      "check": null,
      "ref": "#c14.evaluacion"
     },
     {
      "id": "pilot-ci-pts",
      "label": "95 % CI half-width of the effect",
      "out": "pilot_ci_pts",
      "expr": "z95 * pilot_se_pts",
      "unit": "points",
      "tol": 0.03,
      "why": "Go/no-go band for the rollout to 400 stores (course rounds to ± 0.7).",
      "check": null,
      "ref": "#c14.evaluacion"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Two-Clock Monitoring",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Watch two clocks: the night (`ForecastRunLate`, `ForecastRunFailed`: page), from metrics the job pushes to the Pushgateway, and accuracy (`WAPEDegraded`: ticket), which arrives days later with the sales.",
    "artifact": "",
    "done": [
     "The 8 alerts in `alerts.yml` pass their promtool tests: `ForecastRunLate`, `ForecastRunFailed` and `ForecastValidationBlocked` page; the other five open tickets.",
     "`ForecastRunLate` watches the age of the published `run_date` (over 51.5 h, or the metric absent), so it does not depend on Airflow.",
     "Each attempt pushes publish time, rows, imputed stores, gate result and fallback to the Pushgateway.",
     "The daily accuracy job publishes 7-day WAPE and bias by segment (horizons 1–2, no stockout days) against the backtest's: `WAPEDegraded` fires above 5 points and `ForecastBiasDrift` above 10.",
     "The model retrains every Sunday; two weeks of `WAPEDegraded` lead to a per-segment diagnosis before retraining."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C14 · Pronóstico de demanda · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.monitoreo"
     },
     {
      "label": "Course · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Course · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Course · M12 · Monitoreo · Dashboards, runbooks y on-call",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.runbooks"
     },
     {
      "label": "Sheet · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "late-alert-age-h",
      "label": "ForecastRunLate threshold on run_date age",
      "out": "late_alert_age_h",
      "expr": "(2 * 1440 + deadline_min) / 60",
      "unit": "h",
      "tol": 0,
      "why": "Alert on published run_date age: independent of Airflow.",
      "check": null,
      "ref": "#c14.archivos"
     }
    ]
   }
  ],
  "asincrono": [
   {
    "id": "kickoff",
    "base": "kickoff",
    "status": "nuevo",
    "title": "Requirements & Capacity Plan",
    "tramo": "diseno",
    "speed": "diseno",
    "question": "",
    "note": "Size GPU work, workers, burst drain time and storage from 1,200 slides/day against the turnaround p95 ≤ 60 min and nightly-coverage SLOs and the ≤ US$2k/month infra + 20 h/month pathologist budget.",
    "artifact": "",
    "inputs": [],
    "outputs": [],
    "done": [
     "Daily GPU work is computed: 1,200 slides × ≈ 3,000 tiles ≈ 3.6 M tiles ≈ 5 GPU-h/day at 200 tiles/s per L4 (≈ 70 % of the ≈ 300 tiles/s measured max).",
     "One L4 worker covers the peak (≈ 170 slides/h ≈ 142 tiles/s); a 200-slide burst drains in ≈ 25 min with 4 workers including cold start, against the 60 min SLO.",
     "Result storage is sized at ≈ 5 MB per slide: ≈ 180 GB/month, ≈ 2.2 TB/year.",
     "Monthly cost is ≈ US$1.2k of infra (under the US$2k cap) + ≈ US$4k for 20 h of pathologist time, ≈ US$5.2k in total."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.requisitos"
     },
     {
      "label": "Course · C04 · Segmentación de imágenes · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.estimaciones"
     },
     {
      "label": "Sheet · Formulario de estimaciones · C01 sizing chain",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/"
     }
    ],
    "calcs": [
     {
      "id": "tiles-slide",
      "label": "Tiles per slide (tissue only)",
      "out": "tiles_slide",
      "expr": "ceilto(tissue_cm2 * 1e8 / ((tile_px - overlap_px) * mpp_model)^2, 100)",
      "unit": "tiles",
      "tol": 0.02,
      "why": "Unit of GPU work; rounded like the course (≈ 2,990 → 3,000).",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "tiles-day",
      "label": "Tiles per day",
      "out": "tiles_day",
      "expr": "slides_day * tiles_slide",
      "unit": "tiles/day",
      "tol": 0.02,
      "why": "Daily GPU work.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "gpu-h-day",
      "label": "GPU-hours per day",
      "out": "gpu_h_day",
      "expr": "tiles_day / plan_tiles_s / 3600",
      "unit": "GPU-h/day",
      "tol": 0.02,
      "why": "One L4, scale to zero at night.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "slides-h-peak",
      "label": "Peak arrivals",
      "out": "slides_h_peak",
      "expr": "slides_day / scan_hours * slide_peak_factor",
      "unit": "slides/h",
      "tol": 0.02,
      "why": "Design point is the peak, not the daily average.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "tiles-s-peak",
      "label": "Peak tiles per second",
      "out": "tiles_s_peak",
      "expr": "slides_h_peak * tiles_slide / 3600",
      "unit": "tiles/s",
      "tol": 0.02,
      "why": "Peak throughput the GPU fleet must carry.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "workers-peak-gpu",
      "label": "Workers at peak (GPU throughput)",
      "out": "workers_peak_gpu",
      "expr": "ceil(tiles_s_peak / plan_tiles_s)",
      "unit": "workers",
      "tol": 0,
      "why": "One L4 covers the peak on throughput.",
      "check": {
       "expr": "tiles_s_peak <= workers_peak_gpu * plan_tiles_s",
       "label": "Peak fits the 70 % plan"
      },
      "ref": "#c04.estimaciones"
     },
     {
      "id": "workers-peak-serial",
      "label": "Workers at peak (serial time per slide)",
      "out": "workers_peak_serial",
      "expr": "ceil(slides_h_peak * secs_per_slide / 3600)",
      "unit": "workers",
      "tol": 0,
      "why": "GPU idles during download and stitch: KEDA adds a second worker at peak.",
      "check": {
       "expr": "workers_peak_serial <= max_workers",
       "label": "Fits under the KEDA max of 4"
      },
      "ref": "#c04.estimaciones"
     },
     {
      "id": "gpu-usd-month",
      "label": "GPU workers per month",
      "out": "gpu_usd_month",
      "expr": "billed_node_h_day * days_month * price_node_h",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Billed hours, not busy hours, drive GPU cost.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "infra-usd-month",
      "label": "Infra per month",
      "out": "infra_usd_month",
      "expr": "gpu_usd_month + other_infra_usd",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Checks the infra budget.",
      "check": {
       "expr": "infra_usd_month <= infra_budget_usd",
       "label": "Under the US$2k infra budget"
      },
      "ref": "#c04.estimaciones"
     },
     {
      "id": "expert-usd-month",
      "label": "Pathologist labeling per month",
      "out": "expert_usd_month",
      "expr": "path_hours_month * path_price_h",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "The dominant cost: optimize expert hours before GPUs.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "total-usd-month",
      "label": "Total per month",
      "out": "total_usd_month",
      "expr": "infra_usd_month + expert_usd_month",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "≈ 76 % is expert time.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "late-budget-slides",
      "label": "Turnaround error budget",
      "out": "late_budget_slides",
      "expr": "slides_day * days_month * slo_late_share",
      "unit": "slides/month",
      "tol": 0.02,
      "why": "Late slides allowed per month before the SLO breaks.",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     }
    ]
   },
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Data & Labels",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Split the 20 pathologist hours per month (≈ US$4k, the system's dominant cost) across audit, temporal set and active-learning regions, treating sign-out corrections as free but biased labels.",
    "artifact": "",
    "done": [
     "The monthly split is done: ≈ 2 h of random audit, ≈ 2.5 h of temporal set and ≈ 15.5 h of active learning (≈ 620 regions at 1.5 min).",
     "`select_for_labeling.py` selected by uncertainty and diversity: at most 5 regions per slide, strata by lab and scanner, lab C first and no golden-set slides.",
     "QC ran before selection: marker ink, folds, bubbles and out-of-focus areas do not consume pathologist hours.",
     "Labeling copies are de-identified: no label image or macro, metadata cleaned against an allowlist of fields, and pseudonymized ids.",
     "The golden set and the audit are annotated independently, without seeing the overlay: residents pre-annotate and a pathologist approves."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.datos"
     },
     {
      "label": "Course · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "audit-h",
      "label": "Random audit hours",
      "out": "audit_h",
      "expr": "audit_slides * approve_min / 60",
      "unit": "h/month",
      "tol": 0.02,
      "why": "Unbiased quality sample, read per quarter.",
      "check": null,
      "ref": "#c04.datos"
     },
     {
      "id": "temporal-h",
      "label": "Temporal set hours",
      "out": "temporal_h",
      "expr": "temporal_slides * approve_min / 60",
      "unit": "h/month",
      "tol": 0.02,
      "why": "Drift-over-time set.",
      "check": null,
      "ref": "#c04.datos"
     },
     {
      "id": "al-h",
      "label": "Active-learning hours left",
      "out": "al_h",
      "expr": "path_hours_month - audit_h - temporal_h",
      "unit": "h/month",
      "tol": 0.02,
      "why": "What is left of the 20 h for training labels.",
      "check": null,
      "ref": "#c04.datos"
     },
     {
      "id": "al-regions",
      "label": "Active-learning regions per month",
      "out": "al_regions",
      "expr": "al_h * 60 / al_min_per_region",
      "unit": "regions/month",
      "tol": 0.02,
      "why": "Size of the monthly selection job output.",
      "check": null,
      "ref": "#c04.datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "cambia",
    "title": "Dataset Versioning & Lineage",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Publish each snapshot as an immutable manifest that records where every label came from, and keep the 100-slide golden set as a separate, frozen artifact.",
    "artifact": "",
    "done": [
     "The manifest has each slide's sha256, the annotation version, the guideline version, the label source (independent annotation, correction or active-learning region) and the split.",
     "The split is by patient (at minimum by slide), never by tile; the monthly temporal set also splits by date.",
     "The snapshot excludes, by pseudonymized patient id, everything in the golden set or the temporal sets.",
     "The golden set (100 slides, 2 pathologists + consensus) is versioned as a separate artifact and changes only through controlled additions."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.datos"
     },
     {
      "label": "Course · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ],
    "inputs": [],
    "outputs": [
     "immutable snapshot manifest",
     "frozen golden set (100 slides)"
    ],
    "calcs": [
     {
      "id": "golden-h",
      "label": "Golden set pathologist hours (one-off)",
      "out": "golden_h",
      "expr": "golden_slides * golden_raters * golden_min_slide / 60",
      "unit": "h",
      "tol": 0.05,
      "why": "Too big for one month’s budget: fund apart or spread over 3–4 months.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "golden-usd",
      "label": "Golden set cost (one-off)",
      "out": "golden_usd",
      "expr": "golden_h * path_price_h",
      "unit": "US$",
      "tol": 0.05,
      "why": "Largest expert spend of the design.",
      "check": null,
      "ref": "#c04.estimaciones"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Tile-Based Training",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Train on tiles sampled from annotated regions in an on-demand GPU job, monthly or on trigger (drift, new lab or scanner), reading and downsampling exactly as the worker does.",
    "artifact": "",
    "done": [
     "The run is reproducible: data snapshot, commit and container by digest.",
     "Tiles come from the same read-and-downsample code as the worker (the 2× from level 0).",
     "With partial annotations, the loss is computed only where there is a label.",
     "If color is normalized at inference, the normalization goes into the config hash; color augmentation lives only in training."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.datos"
     },
     {
      "label": "Course · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
     },
     {
      "label": "Sheet · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Per-Slice Gate",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Measure criteria written before training on the golden set per slice (lab, scanner, specimen type), with intervals and against the inter-pathologist agreement ceiling (Dice ≈ 0.75–0.85).",
    "artifact": "",
    "done": [
     "No slice is worse than production by more than its interval (e.g. Dice −0.02, paired comparison with per-slide bootstrap).",
     "Per-lesion sensitivity (foci ≥ 1 mm) is ≥ 95 % with ≤ 1 false region per slide, and the tumor % error is ≤ 5 points.",
     "Per-slice calibration is measured and the decision threshold is recorded as part of the artifact.",
     "The registry stores the lineage (dataset, commit, digest, preprocessing config, engine and threshold); a candidate that fails is not registered."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.evaluacion"
     },
     {
      "label": "Course · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Sheet · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "dice-ci-golden",
      "label": "95 % CI half-width, golden set Dice",
      "out": "dice_ci_golden",
      "expr": "z95 * dice_sd / sqrt(golden_slides)",
      "unit": "Dice",
      "tol": 0.03,
      "why": "Smallest difference the golden set can resolve unpaired.",
      "check": null,
      "ref": "#c04.evaluacion"
     },
     {
      "id": "paired-ci-labc",
      "label": "95 % CI half-width, paired diff on lab C",
      "out": "paired_ci_labc",
      "expr": "z95 * paired_sd / sqrt(labc_slides)",
      "unit": "Dice",
      "tol": 0.03,
      "why": "Makes the “no slice worse than −0.02” gate reachable with 30 slides.",
      "check": {
       "expr": "paired_ci_labc < 0.02",
       "label": "Paired CI tighter than the −0.02 Dice gate"
      },
      "ref": "#c04.evaluacion"
     },
     {
      "id": "foci-needed",
      "label": "Foci needed to back ≥ 95 % sensitivity (rule of three)",
      "out": "foci_needed",
      "expr": "3 / (1 - lesion_sens_target)",
      "unit": "foci",
      "tol": 0,
      "why": "Count foci, not slides, to certify lesion sensitivity.",
      "check": null,
      "ref": "#c04.evaluacion"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "cambia",
    "title": "TensorRT Engine on L4",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Export to ONNX and build a TensorRT FP16 engine as in C01, but on an L4 and for the worker itself to load, baked into its image.",
    "artifact": "",
    "done": [
     "The engine was built with `trtexec --fp16` on an L4, inside `tensorrt:26.08-py3`, the worker's own base image.",
     "The engine-vs-PyTorch parity test passed on real tiles.",
     "`trtexec` measured the max per L4 (case assumption: ≈ 300 tiles/s) and the plan sits at ≈ 70 %: 200 tiles/s per worker.",
     "The engine is tied to the GPU (L4 = Ada, sm_89) and to the exact TensorRT version: changing the base or the GPU forces a rebuild and another pass through the gate."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.archivos"
     },
     {
      "label": "Course · M08 · Optimización de modelos · TensorRT",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
     },
     {
      "label": "Sheet · Del dato a producción · estación 5 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     }
    ],
    "inputs": [],
    "outputs": [
     "TensorRT FP16 engine baked into the worker image"
    ],
    "calcs": [
     {
      "id": "plan-share-max",
      "label": "Planned throughput vs measured max",
      "out": "plan_share_max",
      "expr": "plan_tiles_s / gpu_max_tiles_s",
      "unit": "fraction",
      "tol": 0.02,
      "why": "The engine’s trtexec number sets the per-worker plan.",
      "check": {
       "expr": "plan_share_max <= target_util",
       "label": "Plan at ≤ 70 % of the measured max"
      },
      "ref": "#c04.estimaciones"
     },
     {
      "id": "peak-share-max",
      "label": "Peak load vs measured max",
      "out": "peak_share_max",
      "expr": "tiles_s_peak / gpu_max_tiles_s",
      "unit": "fraction",
      "tol": 0.03,
      "why": "Headroom left on one L4 at peak.",
      "check": null,
      "ref": "#c04.estimaciones"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "Per-Slide Worker",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Run `seg-worker` to take a message, download the slide to NVMe, validate, tile only the tissue with overlap, infer in batches and stitch the map, with no endpoint, since ≈ 20–30 s of GPU per slide would break any reasonable HTTP timeout.",
    "artifact": "",
    "done": [
     "The idempotency key is sha256 + model_version + config hash: a redelivery with an ok result already written does not touch the GPU.",
     "A missing, odd or different (± 10 %) mpp versus the scanner's calibration, or less than 1 mm² of tissue, writes `qc_blocked` with the reason and no numbers.",
     "Tiles are 512 with 64 px overlap (stride 448) and are stitched with ramps that sum to 1 into a 4 µm/px map: no seams and within the pod's RAM.",
     "On SIGTERM it stops pulling messages, aborts at the next batch and returns the slide with visibility 0.",
     "`pytest` passes the worker's 65 tests without AWS or GPU."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.serving"
     },
     {
      "label": "Course · C04 · Segmentación de imágenes · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.archivos"
     },
     {
      "label": "Sheet · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "gpu-s-slide",
      "label": "GPU time per slide",
      "out": "gpu_s_slide",
      "expr": "tiles_slide / plan_tiles_s",
      "unit": "s",
      "tol": 0.02,
      "why": "Too long for any HTTP timeout: async worker, not an endpoint.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "cpu-busy-vcpu",
      "label": "CPU busy to feed one L4",
      "out": "cpu_busy_vcpu",
      "expr": "plan_tiles_s * cpu_ms_per_tile / 1000",
      "unit": "vCPU",
      "tol": 0.02,
      "why": "Worker is sized by CPU: g6.2xlarge, not g6.xlarge.",
      "check": {
       "expr": "cpu_busy_vcpu < vcpu_node",
       "label": "Decode fits the node’s 8 vCPU"
      },
      "ref": "#c04.estimaciones"
     },
     {
      "id": "decode-px-factor",
      "label": "Decode work vs model input (no 20× level)",
      "out": "decode_px_factor",
      "expr": "(mpp_model / mpp_scan)^2",
      "unit": "×",
      "tol": 0,
      "why": "Reading 1024² at level 0 per 512² tile is why CPU is the bottleneck.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "overlap-overhead",
      "label": "Overlap compute overhead",
      "out": "overlap_overhead",
      "expr": "(tile_px / (tile_px - overlap_px))^2",
      "unit": "×",
      "tol": 0.02,
      "why": "Price of seamless stitching.",
      "check": null,
      "ref": "#c04.estimaciones"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "cambia",
    "title": "Image with Baked Engine",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Ship a single GPU image for the worker with the engine inside, whose digest identifies code + TensorRT + model and is recorded in every `summary.json`; its size matters because it is paid on every start from zero replicas.",
    "artifact": "",
    "done": [
     "The base is `nvcr.io/nvidia/tensorrt:26.08-py3` and `model.plan` is in `worker/model/` before `docker build`.",
     "OpenSlide comes as a wheel (`openslide-bin`), without `apt-get`; the lock has 14 packages and the image runs as a non-root user.",
     "pytest, moto and tifffile (`requirements-dev.txt`) are not in the image.",
     "The image size is known: ≈ 6.8 GB compressed, part of the ≈ 3–5 min cold start."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.archivos"
     },
     {
      "label": "Course · M05 · Contenedores · Reducir tamaño (y por qué importa para el cold start)",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.tamano"
     },
     {
      "label": "Sheet · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ],
    "inputs": [],
    "outputs": [
     "worker GPU image with the engine baked in"
    ],
    "calcs": []
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "cambia",
    "title": "CI/CD with L4 Runner",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Run tests without a GPU, build the engine in the pipeline on an L4 runner inside the same base image, and promote by having CD resolve the production alias, build or pull that version's image and roll out `seg-worker`.",
    "artifact": "",
    "done": [
     "The worker's 65 tests, the selection's 13 and the PSI job's 6 pass.",
     "`promtool test rules` passes: the 10 alerts fire (or not) on synthetic series.",
     "Each Deployment pins its `MODEL_VERSION` (= image tag) and the digest is recorded; the worker does not query the registry.",
     "A base-image or GPU change goes through the gate again."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.arquitectura"
     },
     {
      "label": "Course · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Sheet · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "GPU Workers with KEDA",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Run one Deployment on g6.2xlarge nodes (1 × L4, 8 vCPU) that KEDA scales from 0 to 4 on the queue, so no GPU runs at night; the ≈ 3–5 min cold start is acceptable against a 60 min SLO.",
    "artifact": "",
    "done": [
     "The SQS ScaledObject has 0–4 replicas, `queueLength: \"20\"`, `scaleOnInFlight` and a 15 min `cooldownPeriod` before scaling to 0.",
     "The pod requests 1 GPU, has no CPU limit, uses `emptyDir` on the local NVMe, and its liveness checks a file the loop touches.",
     "Least-privilege IRSA: the archive is read-only and results have only GetObject, PutObject and ListBucket, no DeleteObject.",
     "A spot notice drains the node (Karpenter with its interruption queue or the Node Termination Handler) and the 90 s grace is enough; no PodDisruptionBudget, on purpose.",
     "`seg-worker.yaml` passes `kubernetes-validate --strict` and the KEDA CRD schemas."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.serving"
     },
     {
      "label": "Course · C04 · Segmentación de imágenes · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.archivos"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
     },
     {
      "label": "Sheet · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "interarrival-s",
      "label": "Mean gap between slides (scan hours)",
      "out": "interarrival_s",
      "expr": "scan_hours * 3600 / slides_day",
      "unit": "s",
      "tol": 0.02,
      "why": "Far below the 15-min cooldown: the first worker stays up all day.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "busy-worker-h-day",
      "label": "Busy worker-hours per day",
      "out": "busy_worker_h_day",
      "expr": "slides_day * secs_per_slide / 3600",
      "unit": "worker-h/day",
      "tol": 0.02,
      "why": "Work vs ≈ 15 billed node-h: ≈ 40 % idle by day.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "burst-drain-min",
      "label": "Rack burst drain at KEDA max",
      "out": "burst_drain_min",
      "expr": "burst_slides * secs_per_slide / max_workers / 60",
      "unit": "min",
      "tol": 0.02,
      "why": "Sets KEDA maxReplicaCount.",
      "check": {
       "expr": "burst_drain_min + cold_start_min <= slo_turnaround_min",
       "label": "Burst plus cold start stays inside the 60-min SLO"
      },
      "ref": "#c04.estimaciones"
     },
     {
      "id": "gpu-quota-vcpu",
      "label": "EC2 G-family quota needed",
      "out": "gpu_quota_vcpu",
      "expr": "max_workers * vcpu_node",
      "unit": "vCPU",
      "tol": 0,
      "why": "Request the quota increase before the burst.",
      "check": null,
      "ref": "#c04.estimaciones"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Silent Mode & Promotion",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Run a new model or a new lab first in silent mode, with results hidden from the viewer, and promote only with clinical governance approval; no traffic canary or A/B on patients.",
    "artifact": "",
    "done": [
     "The candidate ran in a separate Deployment pinned to its version, fed by the `slide-jobs-backfill` queue, at night and outside the turnaround SLI.",
     "Its results, under their own version prefix, were compared against production and against the pathologists' corrections.",
     "A new lab spent 2–4 weeks in silent with ≥ 30 slides annotated without the overlay before assisted mode.",
     "With approval, the production alias changes, CD deploys the image, results-api approves that version and the lab's flag switches to assisted.",
     "Rollback is defined: `kubectl rollout undo` (minutes) and removing the bad version from results-api's approved versions."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.evaluacion"
     },
     {
      "label": "Course · C04 · Segmentación de imágenes · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.fallas"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Sheet · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "evento-cola",
    "base": null,
    "status": "nuevo",
    "title": "Event & Queue with DLQ",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Start work automatically: when an upload finishes the archive emits an event (key + sha256), a rule filters what is in scope against the LIS and publishes the job to the `slide-jobs` SQS queue, which absorbs bursts and isolates persistent failures in `slide-jobs-dlq`.",
    "artifact": "",
    "done": [
     "The message carries slide_id, key, sha256, lab and scanner; never the file.",
     "The visibility timeout is 300 s, comfortably above the per-slide p99, and the worker extends it with `ChangeMessageVisibility` every 60 s.",
     "`maxReceiveCount` 3 lives in the redrive policy: on the 4th receive the message moves to `slide-jobs-dlq`; after an error, visibility is set to 60 s × attempt.",
     "Known data problems (`qc_blocked`) are not retried: the DLQ holds only what you genuinely do not understand.",
     "For DICOM (lab C), one job is published per Series Instance UID once all its instances have arrived, with the manifest of keys."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.arquitectura"
     },
     {
      "label": "Course · C04 · Segmentación de imágenes · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.serving"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Asíncrona con colas",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.asincrona-colas"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Entrega, reintentos e idempotencia",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.entrega-reintentos"
     },
     {
      "label": "Sheet · Del dato a producción · casos asíncronos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-asincrono"
     }
    ],
    "inputs": [
     "archive upload event (key + sha256)"
    ],
    "outputs": [
     "job message in `slide-jobs`"
    ],
    "calcs": [
     {
      "id": "hb-margin",
      "label": "Heartbeats that can be missed",
      "out": "hb_margin",
      "expr": "vt_s / heartbeat_s - 1",
      "unit": "heartbeats",
      "tol": 0,
      "why": "Visibility timeout vs heartbeat interval.",
      "check": null,
      "ref": "#c04.serving"
     },
     {
      "id": "redelivery-min",
      "label": "Redelivery after a dead worker",
      "out": "redelivery_min",
      "expr": "vt_s / 60",
      "unit": "min",
      "tol": 0.02,
      "why": "A crashed slide is back in the queue in ≤ 5 min.",
      "check": null,
      "ref": "#c04.serving"
     },
     {
      "id": "burst-drain-1w-min",
      "label": "Rack burst drain with 1 worker",
      "out": "burst_drain_1w_min",
      "expr": "burst_slides * secs_per_slide / 60",
      "unit": "min",
      "tol": 0.02,
      "why": "One worker would break the 60-min SLO on a burst.",
      "check": null,
      "ref": "#c04.estimaciones"
     }
    ]
   },
   {
    "id": "resultados",
    "base": null,
    "status": "nuevo",
    "title": "Versioned Results & Viewer",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Store results outside the worker — S3 plus an index row in Postgres — served by `results-api`, an always-on CPU service, so the viewer never depends on a running GPU.",
    "artifact": "",
    "done": [
     "Write order is respected: GeoJSON and heatmap in the run folder, then `summary.json` (the commit), then the index row and the `slide_done` log; only then is the message deleted.",
     "`summary.json` carries tumor mm², tissue %, QC flags, model_version, container digest, config hash and input sha256.",
     "results-api returns, among the versions approved for that lab, the newest result for that sha256; in silent mode it returns nothing.",
     "The viewer draws only if the result's sha256 matches the file it is showing; otherwise it says “no AI result”.",
     "Every result, access and correction goes to an append-only audit log, in a bucket with Object Lock."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.serving"
     },
     {
      "label": "Course · C04 · Segmentación de imágenes · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.arquitectura"
     },
     {
      "label": "Sheet · Del dato a producción · casos asíncronos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-asincrono"
     }
    ],
    "inputs": [],
    "outputs": [
     "results in S3 + Postgres index row",
     "`results-api` responses for the viewer"
    ],
    "calcs": [
     {
      "id": "results-gb-month",
      "label": "Results written per month",
      "out": "results_gb_month",
      "expr": "result_mb_slide * slides_day * days_month / 1000",
      "unit": "GB/month",
      "tol": 0.02,
      "why": "Results storage, not WSIs, is our cost.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "results-tb-year",
      "label": "Results after one year",
      "out": "results_tb_year",
      "expr": "result_mb_slide * slides_day * 365 / 1e6",
      "unit": "TB",
      "tol": 0.02,
      "why": "Cumulative bucket size.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "results-usd-year-end",
      "label": "S3 cost after one year",
      "out": "results_usd_year_end",
      "expr": "results_tb_year * 1000 * s3_price_gb_month",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Storage stays negligible.",
      "check": null,
      "ref": "#c04.estimaciones"
     },
     {
      "id": "mask-mb-slide",
      "label": "Full 20× mask per slide (1 bit/px)",
      "out": "mask_mb_slide",
      "expr": "tissue_cm2 * 1e8 / mpp_model^2 / 8 / 1e6",
      "unit": "MB",
      "tol": 0.02,
      "why": "Polygons + heatmap are 15× smaller: don’t store masks.",
      "check": null,
      "ref": "#c04.estimaciones"
     }
    ]
   },
   {
    "id": "revision",
    "base": null,
    "status": "nuevo",
    "title": "Pathologist Review",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Have the pathologist accept or correct before signing, with sign-out always human, and turn each correction into a label and a metric that flow back to station 1.",
    "artifact": "",
    "done": [
     "Each acceptance or correction is a new annotation version, with author, time, review time and the model version that produced it; it never overwrites the model output.",
     "The major-edit rate is computed: symmetric difference between proposal and final mask ÷ proposed area > 20 %.",
     "Large corrections enter as high-priority candidates; what was accepted unchanged does not enter training as ground truth.",
     "The monthly random audit (8 independently annotated slides) measures automation bias and is read quarterly, not monthly."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.evaluacion"
     },
     {
      "label": "Course · C04 · Segmentación de imágenes · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.datos"
     },
     {
      "label": "Sheet · Del dato a producción · casos asíncronos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-asincrono"
     }
    ],
    "inputs": [],
    "outputs": [
     "new annotation versions (labels)",
     "major-edit rate"
    ],
    "calcs": [
     {
      "id": "path-h-saved-day",
      "label": "Pathologist hours saved per day",
      "out": "path_h_saved_day",
      "expr": "slides_day * review_saved_min / 60",
      "unit": "h/day",
      "tol": 0.02,
      "why": "The value case; measure review time before and after.",
      "check": null,
      "ref": "#c04.costo"
     },
     {
      "id": "c05-review-h-month",
      "label": "C05 review + QA hours per month",
      "out": "c05_review_h_month",
      "expr": "c05_docs_month * (1 - c05_stp_share) * c05_review_s / 3600 + c05_docs_month * c05_stp_share * c05_audit_share * c05_audit_min / 60",
      "unit": "h/month",
      "tol": 0.02,
      "why": "Sizes the human review team (C05).",
      "check": null,
      "ref": "#c05.estimaciones"
     },
     {
      "id": "c05-review-fte",
      "label": "C05 reviewers on average",
      "out": "c05_review_fte",
      "expr": "c05_review_h_month / c05_productive_h_month",
      "unit": "people",
      "tol": 0.05,
      "why": "Average staffing; course rounds to ≈ 6.",
      "check": null,
      "ref": "#c05.estimaciones"
     },
     {
      "id": "c05-peak-reviewers",
      "label": "C05 reviewers on the peak day",
      "out": "c05_peak_reviewers",
      "expr": "ceil((c05_peak_docs_day * (1 - c05_stp_share) * c05_review_s / 3600 + c05_peak_docs_day * c05_stp_share * c05_audit_share * c05_audit_min / 60) / c05_productive_h_day)",
      "unit": "people",
      "tol": 0,
      "why": "Staff for the peak day, not the average: the SLA can’t defer.",
      "check": null,
      "ref": "#c05.estimaciones"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Monitoring & Retraining",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Write the SLO on job age — turnaround p95 ≤ 60 min and 99 % of what is scanned before 22:00 processed by 07:00 — alert on the age of the oldest message rather than queue depth, and expect quality signals to arrive weeks late and biased.",
    "artifact": "",
    "done": [
     "The 10 alerts in `alerts.yml` evaluate with their tests; only what breaks turnaround during hours (07:00–22:00) pages, plus `NightlyCoverageAtRisk` from 05:30.",
     "`SlideQueueBacklog` watches age (> 30 min sustained for 10 min) and `SlideDLQNotEmpty` exists separately, because a poison message stops counting toward age.",
     "The daily `stain_psi.py` job pushes color PSI per lab × scanner to the Pushgateway, and `StainPsiJobStale` warns after more than 26 h without data.",
     "No metric uses slide_id as a label.",
     "Retraining is monthly or on trigger (new lab or scanner, confirmed drift, `MajorEditRateHigh` confirmed by a blind review of 20–30 slides) and always goes through gate and silent/backfill."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C04 · Segmentación de imágenes · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.monitoreo"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Asíncrona con colas",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.asincrona-colas"
     },
     {
      "label": "Course · M12 · Monitoreo · Data drift, concept drift y label shift",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.drift"
     },
     {
      "label": "Sheet · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "max-burn",
      "label": "Max possible burn rate",
      "out": "max_burn",
      "expr": "1 / slo_late_share",
      "unit": "×",
      "tol": 0,
      "why": "Burn factors must stay ≤ 1 ÷ budget.",
      "check": {
       "expr": "burn_fast <= max_burn",
       "label": "The 14.4× fast-burn factor is reachable"
      },
      "ref": "#m12.prometheus-grafana"
     },
     {
      "id": "fast-burn-late-share",
      "label": "Late share at the 14.4× fast burn",
      "out": "fast_burn_late_share",
      "expr": "burn_fast * slo_late_share",
      "unit": "fraction",
      "tol": 0.02,
      "why": "What TurnaroundSLOBurn fires on: 72 % late in the last hour.",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     },
     {
      "id": "slides-per-5min",
      "label": "Slides in a 5-min window (average)",
      "out": "slides_per_5min",
      "expr": "slides_day / scan_hours / 12",
      "unit": "slides",
      "tol": 0.03,
      "why": "Low volume: require ≥ 10 slides in the long window.",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     },
     {
      "id": "night-recovery-min",
      "label": "Drain a 500-slide night backlog",
      "out": "night_recovery_min",
      "expr": "night_backlog * secs_per_slide / max_workers / 60",
      "unit": "min",
      "tol": 0.02,
      "why": "Why NightlyCoverageAtRisk pages at 05:30.",
      "check": {
       "expr": "night_recovery_min + cold_start_min <= night_margin_min",
       "label": "Recovers before 07:00 if someone starts at 05:30"
      },
      "ref": "#c04.monitoreo"
     }
    ]
   }
  ],
  "llm": [
   {
    "id": "kickoff",
    "base": "kickoff",
    "status": "nuevo",
    "title": "Requirements & Capacity Plan",
    "tramo": "diseno",
    "speed": "diseno",
    "question": "",
    "note": "Size the corpus, index, traffic and 8k prompt against the permission, freshness and latency SLOs (retrieval p95 ≤ 700 ms, first token p95 ≤ 2.5 s) and the monthly cost per question.",
    "artifact": "",
    "inputs": [],
    "outputs": [],
    "done": [
     "The corpus is sized: ≈ 1.5 M documents → ≈ 12 M chunks of 400 tokens ≈ 4.8 B tokens; a full embed is ≈ 44 L4-hours (≈ US$36).",
     "The index fits on 3 × r7i.2xlarge with 2 copies in FP16: ≈ 18.4 GB of vectors per node, ≈ 78 % of RAM in use.",
     "Traffic and prompt are budgeted: ≈ 0.7 qps average and ≈ 2 qps peak; prompt ≈ 5,300 + 600 output = 5,900 of 8,192 tokens; gateway quota ≈ 1 M tokens/min.",
     "The reranker fits the retrieval budget (≈ 0.24 s for 50 pairs on an L4, ≈ 0.45 s with the rest, within 700 ms), and infra is ≈ US$7.6k/month, ≈ US$0.014 per question."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.requisitos"
     },
     {
      "label": "Course · C11 · RAG empresarial · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.estimaciones"
     },
     {
      "label": "Sheet · Formulario de estimaciones · C01 sizing chain",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/"
     }
    ],
    "calcs": [
     {
      "id": "chunks",
      "label": "Chunks in the index",
      "out": "chunks",
      "expr": "n_docs * chunks_per_doc",
      "unit": "chunks",
      "tol": 0.02,
      "why": "Sizes the index and the embedding job.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "corpus-tokens",
      "label": "Corpus tokens",
      "out": "corpus_tokens",
      "expr": "chunks * tokens_per_chunk",
      "unit": "tokens",
      "tol": 0.02,
      "why": "Sizes a full re-embed.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "qps-avg",
      "label": "Average questions per second (business hours)",
      "out": "qps_avg",
      "expr": "q_day / (biz_hours * 3600)",
      "unit": "q/s",
      "tol": 0.02,
      "why": "Traffic is tiny: spend design time on permissions and freshness.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "qps-peak",
      "label": "Peak questions per second",
      "out": "qps_peak",
      "expr": "qps_avg * q_peak_factor",
      "unit": "q/s",
      "tol": 0.05,
      "why": "Design point for reranker, index and LLM quota.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "prompt-tokens",
      "label": "Prompt tokens",
      "out": "prompt_tokens",
      "expr": "sys_tokens + hist_tokens + k_chunks * tokens_per_chunk + q_tokens",
      "unit": "tokens",
      "tol": 0,
      "why": "Fixes k = 8 inside the 8k context.",
      "check": {
       "expr": "prompt_tokens + max_out_tokens <= ctx_tokens",
       "label": "Prompt + max_tokens fits the 8,192 context"
      },
      "ref": "#c11.estimaciones"
     },
     {
      "id": "live-seqs-tenant",
      "label": "Live sequences at peak (Little)",
      "out": "live_seqs_tenant",
      "expr": "qps_peak * answer_s",
      "unit": "sequences",
      "tol": 0.05,
      "why": "Concurrency the tenant adds to the C10 fleet.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "prefill-peak",
      "label": "Uncached prefill at peak",
      "out": "prefill_peak",
      "expr": "qps_peak * (avg_in_tokens - sys_tokens)",
      "unit": "tokens/s",
      "tol": 0.05,
      "why": "Compare against the C10 fleet’s ≈ 60k tokens/s design peak.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "tpm-peak",
      "label": "Gateway tokens per minute at peak",
      "out": "tpm_peak",
      "expr": "qps_peak * (avg_in_tokens + max_out_tokens) * 60",
      "unit": "tokens/min",
      "tol": 0.05,
      "why": "Sets the tenant quota on the gateway.",
      "check": {
       "expr": "tpm_peak <= quota_tpm",
       "label": "Under the ≈ 1 M tokens/min quota"
      },
      "ref": "#c11.estimaciones"
     },
     {
      "id": "showback-usd-month",
      "label": "LLM showback per month",
      "out": "showback_usd_month",
      "expr": "q_day * biz_days * (avg_in_tokens + avg_out_tokens) * llm_price_per_m / 1e6",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Largest single infra line.",
      "check": null,
      "ref": "#c11.costo"
     },
     {
      "id": "infra-usd-month",
      "label": "Infra per month",
      "out": "infra_usd_month",
      "expr": "showback_usd_month + other_infra_usd",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Infra is under a fifth of the total; people dominate.",
      "check": null,
      "ref": "#c11.costo"
     },
     {
      "id": "usd-per-question",
      "label": "Infra cost per question",
      "out": "usd_per_question",
      "expr": "infra_usd_month / (q_day * biz_days)",
      "unit": "US$/question",
      "tol": 0.02,
      "why": "Unit cost: answer caching isn’t worth the leak risk.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "error-budget-min",
      "label": "Monthly error budget",
      "out": "error_budget_min",
      "expr": "(1 - slo_avail) * slo_month_min",
      "unit": "min/month",
      "tol": 0.02,
      "why": "Search-only fallback lets the generated answer run at 99.5 %.",
      "check": null,
      "ref": "#c11.requisitos"
     }
    ]
   },
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Documents, ACLs & Golden Set",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Scope the ≈ 1.5 M Confluence, Drive, Jira and policy documents with their ACLs, plus a golden set of ≈ 600 questions written with each area's domain experts; there is no training dataset.",
    "artifact": "",
    "done": [
     "Sources are scoped: Confluence, Drive, Jira (last 2 years only) and the policy repository, ≈ 1.5 M documents after filtering, with HR and legal excluded by default.",
     "Each document carries its ACL normalized to principals (`user:`, `group:`, `role:`, `domain:`), and a shared link counts as not shared.",
     "The golden set has ≈ 600 questions written with each area's experts, with expected documents and a reference answer, and includes permission pairs, unanswerable questions, tables, versions and multi-turn.",
     "≈ 200 answers are graded by experts with the rubric, to calibrate the judge.",
     "Before Drive was opened, Security reviewed the over-sharing scan."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
     },
     {
      "label": "Course · M14 · Sistemas con LLMs · Evaluación: golden sets, jueces y gates",
      "href": "https://ronda-diseno-ml.vercel.app/#m14.evaluacion"
     },
     {
      "label": "Course · M15 · Seguridad y confiabilidad · Datos personales: dónde están, cuánto duran y quién los ve",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.pii-privacidad"
     },
     {
      "label": "Sheet · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ],
    "inputs": [],
    "outputs": [
     "≈ 1.5 M documents with ACLs",
     "golden set (≈ 600 questions)"
    ],
    "calcs": [
     {
      "id": "golden-h",
      "label": "Golden set expert hours",
      "out": "golden_h",
      "expr": "golden_q * golden_min_per_q / 60",
      "unit": "h",
      "tol": 0.02,
      "why": "Book SME time across areas before building.",
      "check": null,
      "ref": "#c11.datos"
     },
     {
      "id": "corpus-text-gb",
      "label": "Corpus plain text",
      "out": "corpus_text_gb",
      "expr": "corpus_tokens * bytes_per_token / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "Raw text volume to parse and store.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "parsed-gb",
      "label": "Parsed text stored in S3",
      "out": "parsed_gb",
      "expr": "corpus_text_gb * parsed_overhead",
      "unit": "GB",
      "tol": 0.05,
      "why": "≈ US$1/month: always keep it, re-chunk without re-parsing or OCR.",
      "check": null,
      "ref": "#c11.estimaciones"
     }
    ]
   },
   {
    "id": "ingestion-con-conectores",
    "base": null,
    "status": "nuevo",
    "title": "Connector Ingestion",
    "tramo": "datos",
    "speed": "nuevo",
    "question": "",
    "note": "Detect changes per source with one connector each (webhook or polling), then parse and OCR into ≈ 400-token chunks that carry their heading path and ACL.",
    "artifact": "",
    "done": [
     "Each source has its connector: events (webhook or change feed), modified-date polling as a safety net, and a reconciliation sweep that compares ids and versions against the index.",
     "Parsing preserves structure: OCR on pages without a text layer, tables as rows with their header, and parsed text stored in S3 by version and hash.",
     "Chunks are ≈ 400 tokens (hard cap 512), follow sections, carry the heading path, ACL fields and hash, and never split table rows.",
     "Processing the same event twice changes nothing, deletes are kept as tombstones, and a pass that would delete more than 2 % of a source halts.",
     "An edited page is answerable at p95 ≤ 15 min, and `IngestionLagHigh` watches lag per source."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
     },
     {
      "label": "Course · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Entrega, reintentos e idempotencia",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.entrega-reintentos"
     },
     {
      "label": "Sheet · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ],
    "inputs": [],
    "outputs": [
     "≈ 400-token chunks with heading path and ACL"
    ],
    "calcs": [
     {
      "id": "embed-tokens-day",
      "label": "Tokens to re-embed per day (worst case)",
      "out": "embed_tokens_day",
      "expr": "changed_docs_day * chunks_per_doc * tokens_per_chunk",
      "unit": "tokens/day",
      "tol": 0.02,
      "why": "Daily embedding load; per-chunk hashes cut it.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "embed-gpu-min-day",
      "label": "L4 time per day for changes",
      "out": "embed_gpu_min_day",
      "expr": "embed_tokens_day / embed_tok_s / 60",
      "unit": "min/day",
      "tol": 0.02,
      "why": "One shared L4 embed-worker is enough.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "embed-peak-share",
      "label": "Embed load at the edit peak",
      "out": "embed_peak_share",
      "expr": "changed_docs_day / (biz_hours * 3600) * edit_peak_factor * chunks_per_doc * tokens_per_chunk / embed_tok_s",
      "unit": "fraction of an L4",
      "tol": 0.03,
      "why": "Freshness p95 ≤ 15 min is not GPU-bound.",
      "check": {
       "expr": "embed_peak_share < 1",
       "label": "One L4 keeps up with the edit peak"
      },
      "ref": "#c11.estimaciones"
     },
     {
      "id": "ocr-core-h",
      "label": "Initial OCR on CPU",
      "out": "ocr_core_h",
      "expr": "scanned_share * n_pdfs * pages_per_pdf * ocr_s_page / 3600",
      "unit": "core-h",
      "tol": 0.02,
      "why": "One-off backfill: ≈ US$11 on CPU vs ≈ US$675 on Textract.",
      "check": null,
      "ref": "#c11.estimaciones"
     }
    ]
   },
   {
    "id": "carril-rapido-de-permisos",
    "base": null,
    "status": "nuevo",
    "title": "Permissions Fast Lane",
    "tramo": "datos",
    "speed": "nuevo",
    "question": "",
    "note": "Have ACL sync rewrite only the `acl_0…acl_2` fields of the affected chunks, so a revocation applies in ≤ 5 min without re-embedding or waiting behind a PDF.",
    "artifact": "",
    "done": [
     "Permission changes go to their own queue: ACL sync rewrites only `acl_0`…`acl_2` of the affected chunks, without re-embedding.",
     "A revocation applies in ≤ 5 min, measured end to end by the permissions probe.",
     "Anything the service account can no longer read is deleted from the index (fail-closed).",
     "The IdP snapshot refreshes every ≈ 60 s; `ACLSyncStale` fires with a snapshot older than 2 min, a source that has not synced permissions in 5 min, or a p95 lag above 5 min.",
     "`test_acl_only_change_updates_metadata_without_embedding` passes with the same document version."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
     },
     {
      "label": "Course · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Course · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Course · M15 · Seguridad y confiabilidad · Autenticación y autorización entre servicios",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.authn-authz"
     },
     {
      "label": "Sheet · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "cambia",
    "title": "Versioned Text, Chunks & Index",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Version the parsed text (in S3, by hash), each chunk with its hash and the embedding `model_version`, the index behind an alias, and the golden set as a dataset.",
    "artifact": "",
    "done": [
     "The parsed text of every version of every document lives in S3, addressed by hash, so re-chunking needs neither the APIs nor OCR again.",
     "Each chunk stores its hash and the embedding `model_version`, and only chunks whose hash changed are re-embedded.",
     "The index sits behind an alias, and the query encoder refuses to answer if its version is not that of the aliased index.",
     "The golden set is versioned as a dataset and grows every month with cases from feedback."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
     },
     {
      "label": "Course · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Course · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "indice-hibrido-en-opensearch",
    "base": null,
    "status": "nuevo",
    "title": "Hybrid OpenSearch Index",
    "tramo": "modelo",
    "speed": "nuevo",
    "question": "",
    "note": "Keep BM25 and HNSW in the same OpenSearch index behind an alias, fed by an L4 embed-worker (d = 1024) that upserts only chunks whose hash changed.",
    "artifact": "",
    "done": [
     "The dedicated OpenSearch cluster has 3 r7i.2xlarge nodes in 3 zones with 1 replica, separate from the marketplace search cluster.",
     "Each chunk carries text for BM25, an FP16 d = 1024 vector (HNSW on faiss), metadata and ACL fields.",
     "The L4 embed-worker upserts only chunks whose hash changed, with their `model_version`.",
     "A full backfill or re-embed (≈ 44 L4-hours, ≈ US$36) goes to a new index, on temporary spot L4s.",
     "ANN recall against exact search is measured on a canary set."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Course · C11 · RAG empresarial · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
     },
     {
      "label": "Course · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Sheet · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ],
    "inputs": [],
    "outputs": [
     "hybrid index (BM25 + HNSW) behind an alias"
    ],
    "calcs": [
     {
      "id": "vec-fp16-gb",
      "label": "Vectors in FP16",
      "out": "vec_fp16_gb",
      "expr": "chunks * dim * bytes_fp16 / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "FP16 is what makes 64 GiB nodes enough.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "hnsw-gb",
      "label": "HNSW graph (layer 0, M = 32)",
      "out": "hnsw_gb",
      "expr": "chunks * 2 * hnsw_m * bytes_link / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "Graph overhead on top of the vectors.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "index-gb-node",
      "label": "k-NN index per node",
      "out": "index_gb_node",
      "expr": "(vec_fp16_gb + hnsw_gb) * os_copies / os_nodes",
      "unit": "GB/node",
      "tol": 0.02,
      "why": "Native memory each data node must hold.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "node-mem-util",
      "label": "Node memory use (heap + k-NN + page cache)",
      "out": "node_mem_util",
      "expr": "(heap_gb + index_gb_node + page_cache_gb) / node_ram_gb",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Picks r7i.2xlarge; FP32 would need nodes twice the size.",
      "check": {
       "expr": "node_mem_util < 1",
       "label": "Fits a 64 GiB node"
      },
      "ref": "#c11.estimaciones"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Golden-Set Gate",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Run the golden set against the full system — recall@8, faithfulness and citation precision with a calibrated judge, and permissions at 100 % — for any change to chunker, embeddings, reranker, prompt or LLM.",
    "artifact": "",
    "done": [
     "The golden set runs against the full system as test users: recall@8 and MRR by source, area and language, plus faithfulness and citation precision from the judge.",
     "The permissions suite passes at 100 %: no chunk from a restricted document appears in the 50 candidates or in the prompt, and a single leak blocks.",
     "Against the current revision: paired recall@8 with no significant loss and no slice drop above 5 pp, faithfulness and citation precision within 2 points, and correct abstention does not drop.",
     "The judge has kappa ≥ 0.6 and false pass ≤ 10 % against expert answers (starting points), and is recalibrated when the judge or the rubric changes.",
     "Any change to parser, chunker, embeddings, reranker, abstention threshold, prompt or LLM revision goes through this same gate."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.evaluacion"
     },
     {
      "label": "Course · M14 · Sistemas con LLMs · Evaluación: golden sets, jueces y gates",
      "href": "https://ronda-diseno-ml.vercel.app/#m14.evaluacion"
     },
     {
      "label": "Course · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Sheet · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "ci-golden-pp",
      "label": "95 % CI half-width, recall@8 on 600",
      "out": "ci_golden_pp",
      "expr": "z95 * sqrt(recall * (1 - recall) / golden_q) * 100",
      "unit": "pp",
      "tol": 0.03,
      "why": "Unpaired noise: compare configs paired (McNemar).",
      "check": null,
      "ref": "#c11.evaluacion"
     },
     {
      "id": "ci-slice-pp",
      "label": "95 % CI half-width, slice of 60",
      "out": "ci_slice_pp",
      "expr": "z95 * sqrt(recall * (1 - recall) / slice_n) * 100",
      "unit": "pp",
      "tol": 0.03,
      "why": "A slice of 60 only catches large drops: add questions for critical areas.",
      "check": null,
      "ref": "#c11.evaluacion"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "rag-api Hybrid Retrieval",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Serve `POST /v1/ask` over SSE from `rag-api` (FastAPI): principals → BM25 ∥ k-NN fused with RRF (k = 60) → reranker 50 → 8 → 8k prompt → `llm-gateway` → validated citations.",
    "artifact": "",
    "done": [
     "`POST /v1/ask` validates the token, resolves the principals and runs BM25 and k-NN in parallel (300 ms timeout each), with the permission filter inside both queries and never as `post_filter`.",
     "RRF (k = 60) fuses, the ACL rule is re-applied to the 50 (it must remove zero) and the reranker keeps 8, with at most 3 chunks per document; if it does not answer in 400 ms, the RRF order stands.",
     "The prompt fits in 8k: fixed instructions, history trimmed first and 8 numbered, dated sources, ≤ 7,336 tokens and ≤ 7,500 by the gateway's estimate.",
     "With no candidates or below the abstention threshold the LLM is not called, and when the stream closes each citation is validated against the prompt's sources and the permissions.",
     "`pytest` in `reference/c11` passes the 128 tests."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
     },
     {
      "label": "Course · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Course · M14 · Sistemas con LLMs · RAG: el modelo con tus documentos",
      "href": "https://ronda-diseno-ml.vercel.app/#m14.rag"
     },
     {
      "label": "Sheet · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "rerank-tflop-q",
      "label": "Reranker compute per question",
      "out": "rerank_tflop_q",
      "expr": "rerank_pairs * (2 * rerank_active_b * 1e9 * pair_tokens / 1e12 + attn_tflop_pair)",
      "unit": "TFLOP",
      "tol": 0.02,
      "why": "Count only params that multiply, not the embedding table.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "rerank-s-l4",
      "label": "Rerank time on one L4",
      "out": "rerank_s_l4",
      "expr": "rerank_tflop_q / (l4_tflops * l4_eff)",
      "unit": "s",
      "tol": 0.03,
      "why": "Picks L4 over L40S for the reranker.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "retrieval-s",
      "label": "Retrieval + rerank",
      "out": "retrieval_s",
      "expr": "rerank_s_l4 + other_retrieval_s",
      "unit": "s",
      "tol": 0.03,
      "why": "Checks the 700 ms retrieval budget.",
      "check": {
       "expr": "retrieval_s <= retrieval_slo_s",
       "label": "Inside the 700 ms retrieval target"
      },
      "ref": "#c11.estimaciones"
     },
     {
      "id": "rerank-load-peak",
      "label": "Reranker load at peak (one L4)",
      "out": "rerank_load_peak",
      "expr": "qps_peak * rerank_tflop_q / (l4_tflops * l4_eff)",
      "unit": "fraction",
      "tol": 0.05,
      "why": "2 × L4 (one per zone) gives N+1.",
      "check": {
       "expr": "rerank_load_peak <= 1",
       "label": "One L4 alone carries the peak"
      },
      "ref": "#c11.estimaciones"
     }
    ]
   },
   {
    "id": "plataforma-llm-del-c10",
    "base": null,
    "status": "nuevo",
    "title": "C10 LLM Platform",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "Call the LLM through `llm-gateway` with the `employee-assistant` tenant key, a tokens/min quota and the `chat-default` alias → vLLM replicas (≈ 70B, 8k context).",
    "artifact": "",
    "done": [
     "The `employee-assistant` tenant has its key in `llm-gateway`, a ≈ 1 M tokens/min quota, interactive priority and the `chat-default` alias, with no fallback to the external provider.",
     "Every call uses `stream: true` and `max_tokens` 600, and cancellation propagates if the person closes the chat.",
     "A gateway 429 or 503 is not retried in a loop: the response falls back to search results only, same as when the first token does not arrive within 8 s.",
     "The tenant can pin its LLM revision until its golden set approves the new one."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
     },
     {
      "label": "Course · C10 · Servir un LLM propio · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c10.arquitectura"
     },
     {
      "label": "Course · C10 · Servir un LLM propio · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c10.serving"
     },
     {
      "label": "Sheet · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "kv-token-kib",
      "label": "KV cache per token (BF16)",
      "out": "kv_token_kib",
      "expr": "2 * n_layers * n_kv_heads * head_dim * kv_bytes / 1024",
      "unit": "KiB",
      "tol": 0,
      "why": "Unit of LLM memory cost.",
      "check": null,
      "ref": "#c10.estimaciones"
     },
     {
      "id": "kv-space-gb",
      "label": "KV space per 2 × H100 replica",
      "out": "kv_space_gb",
      "expr": "gpu_mem_util * n_gpu_replica * gpu_mem_gb - params_b - runtime_gb",
      "unit": "GB",
      "tol": 0.02,
      "why": "Why TP=2: one H100 leaves no room for KV.",
      "check": null,
      "ref": "#c10.estimaciones"
     },
     {
      "id": "seqs-per-replica",
      "label": "Typical sequences that fit per replica",
      "out": "seqs_per_replica",
      "expr": "kv_space_gb / ((c10_in + c10_out) * kv_token_kib * 1024 / 1e9)",
      "unit": "sequences",
      "tol": 0.02,
      "why": "KV says how many fit; the TPOT SLO says how many run.",
      "check": null,
      "ref": "#c10.estimaciones"
     },
     {
      "id": "tenant-kv-gb",
      "label": "Tenant KV at peak",
      "out": "tenant_kv_gb",
      "expr": "live_seqs_tenant * (prompt_tokens + tenant_kv_out) * kv_token_kib * 1024 / 1e9",
      "unit": "GB",
      "tol": 0.05,
      "why": "≈ 9 % of the C10 peak KV: a capacity talk with the platform team.",
      "check": null,
      "ref": "#c11.estimaciones"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "igual",
    "title": "rag-api Containers",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Containerize `rag-api`, the encoder and the reranker as in C01; vLLM runs its official image on the C10 platform.",
    "artifact": "Dockerfiles probados (gateway y Triton)",
    "done": [
     "The `rag-api` image installs the `service/requirements.txt` lock (via `uv pip compile`, for Linux x86_64 and Python 3.13), without the test dependencies.",
     "Each container runs a single uvicorn process: scale with replicas, not workers.",
     "The query encoder runs in a different Deployment from the embed-worker, on the reranker's L4s.",
     "vLLM uses the official `vllm/vllm-openai` image, pinned by version and digest in the C10 manifest."
    ],
    "commands": [
     {
      "code": "docker build --platform linux/amd64 -t classifier-gateway:{tag} gateway/",
      "note": "On an Apple Silicon Mac `--platform` is mandatory: c6i and g4dn nodes are x86. The tag is the commit."
     },
     {
      "code": "docker build -t classifier-triton:{version_modelo} triton/",
      "note": "Fails on purpose if `model.plan` is missing: run `build_engine.sh` on the T4 first."
     },
     {
      "code": "docker compose up --build",
      "note": "From `reference/c01`: gateway, Triton with GPU and Prometheus on one machine."
     },
     {
      "code": "curl -s -H \"Content-Type: image/jpeg\" --data-binary @{foto} \"localhost:8080/v1/classify?top_k=5\"",
      "note": "The end-to-end check: top-5 with `model_version`."
     },
     {
      "code": "docker history classifier-gateway:{tag}",
      "note": "One row per layer: find the one that bloated the image."
     },
     {
      "code": "docker buildx imagetools inspect --format '{{json .Image}}' {registry}/classifier-gateway:{tag}",
      "note": "Before deploying: the config must say `\"architecture\": \"amd64\"`. Without `--format`, a single-platform image does not show its own."
     }
    ],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Course · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Course · C10 · Servir un LLM propio · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c10.archivos"
     },
     {
      "label": "Sheet · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD & Golden-Set Gate",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Test and build images as in C01, with the golden-set gate deciding whether a change ships.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "`pytest` passes the 128 tests in the five folders on every commit, without OpenSearch, GPU or gateway.",
     "`promtool check rules` and both `promtool test rules` pass on `monitoring/alerts.yml`.",
     "A chunker, embeddings, reranker, prompt or LLM-revision change does not ship without an approved golden-set gate.",
     "A permission leak in the golden set blocks the release even if recall is perfect."
    ],
    "commands": [
     {
      "code": "cd reference/c01/gateway && pip install -r requirements-dev.txt && pytest",
      "note": "24 tests with no GPU or Triton: the first thing CI runs."
     },
     {
      "code": "aws ecr get-login-password --region {region} | docker login --username AWS --password-stdin {registry}",
      "note": "ECR login; the token lasts 12 h. In CI, via an OIDC-assumed role, no stored keys."
     },
     {
      "code": "docker buildx build --platform linux/amd64 -t {registry}/classifier-gateway:{sha} --push gateway/",
      "note": "Single build for the node architecture; `{sha}` is the first 7 characters of the commit: `git rev-parse --short=7 HEAD` (in CI, `${GITHUB_SHA::7}`)."
     },
     {
      "code": "crane digest {registry}/classifier-gateway:{sha}",
      "note": "The digest is the identity: it is what gets signed and deployed."
     },
     {
      "code": "cosign sign --yes {registry}/classifier-gateway@{digest}",
      "note": "Keyless signing with the CI's OIDC identity."
     },
     {
      "code": "kubectl -n classifier set image deployment/gateway gateway={registry}/classifier-gateway@{digest}",
      "note": "Deploy by digest; with GitOps that value goes in a PR to the manifests repo."
     }
    ],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Course · C11 · RAG empresarial · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.evaluacion"
     },
     {
      "label": "Course · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Sheet · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "C10 EKS & L4 Nodes",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Run the LLM on the C10 EKS (vLLM pods with 2 × H100), and add L4s for the encoder and reranker plus a dedicated 3-node OpenSearch cluster for C11.",
    "artifact": "",
    "done": [
     "The LLM runs on C10's `vllm-70b` pods: 2 × H100 per pod, with TP=2.",
     "C11 adds L4s for the query encoder and the reranker (≈ 0.24 s for 50 pairs).",
     "OpenSearch runs on its own 3-node cluster, separate from the marketplace search cluster.",
     "Backfills use temporary spot L4s and never make a question wait."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Course · C10 · Servir un LLM propio · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c10.arquitectura"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · GPUs en Kubernetes",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.gpus-k8s"
     },
     {
      "label": "Sheet · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "c10-live-seqs",
      "label": "C10 live sequences at design peak",
      "out": "c10_live_seqs",
      "expr": "c10_design_rps * (c10_ttft_s + c10_out * c10_tpot_s)",
      "unit": "sequences",
      "tol": 0.02,
      "why": "Unit of LLM capacity is the live sequence.",
      "check": null,
      "ref": "#c10.estimaciones"
     },
     {
      "id": "c10-replicas",
      "label": "vLLM replicas (2 × H100)",
      "out": "c10_replicas",
      "expr": "ceilto(c10_design_rps / (replica_rps * c10_target_util), gpus_per_node / n_gpu_replica)",
      "unit": "replicas",
      "tol": 0,
      "why": "Replicas come from measured goodput, rounded to whole p5 nodes.",
      "check": {
       "expr": "c10_live_seqs / c10_replicas <= seqs_per_replica && (c10_replicas - gpus_per_node / n_gpu_replica) * replica_rps >= c10_design_rps",
       "label": "KV holds the live sequences and losing one node still serves 60 rps"
      },
      "ref": "#c10.estimaciones"
     },
     {
      "id": "c10-gpu-usd-month",
      "label": "C10 GPU fleet per month",
      "out": "c10_gpu_usd_month",
      "expr": "c10_replicas * n_gpu_replica / gpus_per_node * price_p5_h * hours_month",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Fixed floor the tenant’s showback rides on.",
      "check": null,
      "ref": "#c10.estimaciones"
     },
     {
      "id": "c10-usd-per-m",
      "label": "C10 GPU cost per million tokens",
      "out": "c10_usd_per_m",
      "expr": "c10_gpu_usd_month / c10_tokens_month * 1e6",
      "unit": "US$/M tokens",
      "tol": 0.02,
      "why": "Showback rate charged to the tenant.",
      "check": null,
      "ref": "#c10.estimaciones"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Blue/Green Index via Alias",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Ship a new embedding model as a new index (blue/green), shadow-compared on real questions and switched by alias together with the encoder, keeping the old index a few days for rollback.",
    "artifact": "",
    "done": [
     "A new embedding model is embedded into a new index: vectors from two models are never mixed.",
     "It passes the gate and is shadow-compared on real questions, reviewing where the top-8 changes.",
     "The index alias switches together with the query-encoder version, and the old index stays a few days for rollback.",
     "While the switch lasts, the permissions lane writes to both indexes.",
     "When C10 moves `chat-default`, `employee-assistant` stays on the previous revision until its golden set approves the new one."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.evaluacion"
     },
     {
      "label": "Course · C11 · RAG empresarial · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.monitoreo"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Sheet · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "reembed-l4-h",
      "label": "Full re-embed for a new index",
      "out": "reembed_l4_h",
      "expr": "corpus_tokens / embed_tok_s / 3600",
      "unit": "L4-h",
      "tol": 0.02,
      "why": "Blue/green rebuild is an afternoon, not a project.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "reembed-usd",
      "label": "Full re-embed cost",
      "out": "reembed_usd",
      "expr": "reembed_l4_h * price_l4_h",
      "unit": "US$",
      "tol": 0.02,
      "why": "Cost is not a reason to delay an embedding upgrade.",
      "check": null,
      "ref": "#c11.estimaciones"
     },
     {
      "id": "ab-rated-per-arm",
      "label": "Rated answers per arm (20 % → 17 %)",
      "out": "ab_rated_per_arm",
      "expr": "(z95 + z_power)^2 * (ab_p1 * (1 - ab_p1) + ab_p2 * (1 - ab_p2)) / (ab_p1 - ab_p2)^2",
      "unit": "ratings",
      "tol": 0.02,
      "why": "Sizes the A/B of a prompt change.",
      "check": null,
      "ref": "#c11.evaluacion"
     },
     {
      "id": "ab-days",
      "label": "Traffic days for both arms",
      "out": "ab_days",
      "expr": "2 * ab_rated_per_arm / rated_share / q_day",
      "unit": "days",
      "tol": 0.03,
      "why": "Before user clustering; per-user randomization stretches it to 1–2 weeks.",
      "check": null,
      "ref": "#c11.evaluacion"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "cambia",
    "title": "Streaming Answer in Seconds",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "Answer in seconds instead of milliseconds — retrieval + rerank p95 ≤ 700 ms, first token p95 ≤ 2.5 s, streamed answer ≤ 10 s — and return 503 when the IdP group snapshot is older than 5 min.",
    "artifact": "",
    "done": [
     "Retrieval + rerank p95 ≤ 700 ms, first token p95 ≤ 2.5 s and full streamed answer ≤ 10 s.",
     "With an IdP snapshot older than 5 min, `rag-api` returns 503; a person who is not in the IdP gets 403.",
     "The `meta` event goes out with the sources before calling the gateway, and the final event carries an `outcome` that separates `no_sources` from `no_answer`.",
     "The trace stores retrieved and cited chunk ids, scores and latencies, without the question or answer text, for 30 days."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
     },
     {
      "label": "Course · C11 · RAG empresarial · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.requisitos"
     },
     {
      "label": "Course · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Sheet · Del dato a producción · estación 11 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "ttft-budget-s",
      "label": "First-token budget",
      "out": "ttft_budget_s",
      "expr": "retrieval_slo_s + c10_ttft_5k_s",
      "unit": "s",
      "tol": 0.02,
      "why": "Leaves ≈ 0.3 s; a follow-up rewrite barely fits.",
      "check": {
       "expr": "ttft_budget_s <= ttft_slo_s",
       "label": "Inside the 2.5 s first-token SLO"
      },
      "ref": "#c11.requisitos"
     },
     {
      "id": "decode-typical-s",
      "label": "Decode of a typical answer (40 ms/token)",
      "out": "decode_typical_s",
      "expr": "typical_out * tpot_rag_s",
      "unit": "s",
      "tol": 0.02,
      "why": "Why the full-answer SLO is a median, not a p95.",
      "check": null,
      "ref": "#c11.requisitos"
     },
     {
      "id": "decode-long-s",
      "label": "Decode of a max-length answer at TPOT p95",
      "out": "decode_long_s",
      "expr": "max_out_tokens * tpot_p95_s",
      "unit": "s",
      "tol": 0.02,
      "why": "Tail is set by length: keep max_tokens 600 and brevity rules.",
      "check": null,
      "ref": "#c11.requisitos"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Age & Count Monitoring",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Add ingestion and permission lag (`ACLSyncStale`), the zero-result retrieval rate and a groundedness canary every 4 h; there is no retraining, and the loop closes with chunking, prompt or index changes that pass the same gate.",
    "artifact": "",
    "done": [
     "The 8 alerts in `alerts.yml` pass their promtool tests, and the latency alerts only evaluate at ≥ 0.05 questions/s.",
     "`IngestionLagHigh` watches p95 lag per source (over 15 min) and a source with no events for 1 h during business hours; `IndexDocCountDrop`, documents per source against 24 h ago.",
     "The groundedness canary runs ≈ 100 fixed questions every 4 h, and `GroundednessCanaryRegression` fires below 85 %, more than 5 points under its 7-day average, or if it has not run in 8 h.",
     "The judge scores ≈ 1 % of real answers and only the score, chunk ids and area are stored.",
     "No retraining: every chunking, prompt or index change passes the same gate."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.monitoreo"
     },
     {
      "label": "Course · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Course · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Sheet · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "canary-ci-pp",
      "label": "95 % CI half-width, 100-question canary",
      "out": "canary_ci_pp",
      "expr": "z95 * sqrt(recall * (1 - recall) / canary_n) * 100",
      "unit": "pp",
      "tol": 0.03,
      "why": "Alert vs the 7-day average with a floor, not on one run.",
      "check": null,
      "ref": "#c11.evaluacion"
     },
     {
      "id": "judge-per-day",
      "label": "Live answers graded per day",
      "out": "judge_per_day",
      "expr": "q_day * judge_share",
      "unit": "answers/day",
      "tol": 0.02,
      "why": "Judge load for live groundedness.",
      "check": null,
      "ref": "#c11.monitoreo"
     }
    ]
   },
   {
    "id": "probe-de-permisos",
    "base": null,
    "status": "nuevo",
    "title": "Permissions Probe",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Have synthetic accounts with and without access query canary documents every few minutes, and treat any retrieval without access as a security incident, not a ticket.",
    "artifact": "",
    "done": [
     "Every source has canary documents with unique phrases, and synthetic accounts with and without access query them every few minutes.",
     "The no-access account never retrieves a canary document.",
     "The probe revokes an access and times how long it takes to disappear, against the ≤ 5 min target.",
     "A failure is a security incident with its runbook (disable the source, audit traces by document id, notify Security), not a ticket."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Course · C11 · RAG empresarial · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.monitoreo"
     },
     {
      "label": "Course · M15 · Seguridad y confiabilidad · Autenticación y autorización entre servicios",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.authn-authz"
     },
     {
      "label": "Sheet · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   }
  ],
  "hibrido": [
   {
    "id": "kickoff",
    "base": "kickoff",
    "status": "nuevo",
    "title": "Requirements & Capacity Plan",
    "tramo": "diseno",
    "speed": "diseno",
    "question": "",
    "note": "Size QPS, the vector index, GPUs and re-embed cost from daily search volume against the text and photo p99, 99.9 % availability, freshness targets and the ≤ US$20k/month budget.",
    "artifact": "",
    "inputs": [],
    "outputs": [],
    "done": [
     "QPS is computed from 50 M searches/day: ≈ 579 average and ≈ 1,750 peak (3×), of which ≈ 90 by photo and ≈ 1,660 by text.",
     "The vector index is sized: 100 M × 512 as HNSW on int8 ≈ 77 GB, in 4 shards × 2 copies on 8 × r7i.4xlarge (≈ 64 % memory), with each copy able to hold the peak alone.",
     "GPUs are sized: 2 × L4 for the query encoder (N+1, one per zone) and 8 L4 for the reranker on the top-30; a full re-embed is ≈ 23 GPU-h (≈ 2.9 h on 8 L4).",
     "Monthly infra is ≈ US$16–18k, within the ≈ US$20k budget, for text p99 ≤ 300 ms, photo p99 ≤ 600 ms and 99.9 % availability."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.requisitos"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Sheet · Formulario de estimaciones · C01 sizing chain",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/"
     }
    ],
    "calcs": [
     {
      "id": "qps-avg",
      "label": "Average QPS",
      "out": "qps_avg",
      "expr": "n_searches_day / 86400",
      "unit": "req/s",
      "tol": 0.02,
      "why": "Baseline load for the search-api and cache.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "qps-peak",
      "label": "Peak QPS",
      "out": "qps_peak",
      "expr": "qps_avg * peak_factor",
      "unit": "req/s",
      "tol": 0.02,
      "why": "The fleet is sized for the evening peak, not the average.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "qps-design",
      "label": "Design peak QPS",
      "out": "qps_design",
      "expr": "ceilto(qps_peak, 50)",
      "unit": "req/s",
      "tol": 0,
      "why": "Single design point reused by ANN, encoder and reranker sizing.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "qps-photo",
      "label": "Photo QPS at peak",
      "out": "qps_photo",
      "expr": "ceilto(qps_design * photo_share, 10)",
      "unit": "req/s",
      "tol": 0.02,
      "why": "Sizes the image tower and CPU decode; photo queries skip BM25 and rerank.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "qps-text",
      "label": "Text QPS at peak",
      "out": "qps_text",
      "expr": "qps_design - qps_photo",
      "unit": "req/s",
      "tol": 0.02,
      "why": "Drives the text tower and the cross-encoder, the cost driver.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "index-fp32-gb",
      "label": "Vectors in FP32",
      "out": "index_fp32_gb",
      "expr": "n_items * emb_dim * 4 / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "Reference size: FP32 is kept only for rescoring, not for graph traversal.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "index-int8-hnsw-gb",
      "label": "HNSW graph + int8 vectors",
      "out": "index_hot_gb",
      "expr": "n_items * (emb_dim + hnsw_m * 2 * 4) / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "What must stay in RAM per copy: picks machine size and shard count.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "ann-nodes",
      "label": "ANN data nodes",
      "out": "ann_nodes",
      "expr": "n_shards * n_copies",
      "unit": "nodes",
      "tol": 0,
      "why": "One copy per machine across 2 zones: the second copy is availability, not throughput.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "gpu-encoder",
      "label": "Query-encoder L4s (N+1)",
      "out": "gpu_encoder",
      "expr": "ceil(qps_text / (target_util * text_tput_l4) + qps_photo / (target_util * img_tput_l4)) + 1",
      "unit": "GPUs",
      "tol": 0,
      "why": "One L4 covers both towers at peak; the second is redundancy, one per zone.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "gpu-reranker",
      "label": "Reranker L4s (top-k text)",
      "out": "gpu_reranker",
      "expr": "ceil(qps_text * rerank_k / (target_util * rerank_tput_l4))",
      "unit": "GPUs",
      "tol": 0,
      "why": "The cost driver: rerank depth decides whether the budget holds (top-100 needs 24).",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "cost-compute-month",
      "label": "Monthly compute (ANN + L4s)",
      "out": "cost_compute_month",
      "expr": "(ann_nodes * price_r7i_h + (gpu_encoder + gpu_reranker + gpu_embed) * price_l4_h) * 730",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Compute is ≈ 75 % of the ≈ US$16–18k total; the rest is Redis, storage and model changes.",
      "check": {
       "expr": "cost_compute_month <= budget_month",
       "label": "Compute fits under the US$20k/month budget"
      },
      "ref": "#c07.costo"
     },
     {
      "id": "error-budget-min",
      "label": "Error budget (30 days)",
      "out": "error_budget_min",
      "expr": "(1 - slo_avail) * 43200",
      "unit": "min/month",
      "tol": 0.02,
      "why": "Minutes of non-BM25-covered downtime the month allows.",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     }
    ]
   },
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Pairs, Clicks & Judgments",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Collect cheap but biased training signal — (title, photo) pairs from 100 M listings, (query, contacted listing) pairs and clicks — and graded 0–3 human judgments on head, torso and tail queries as the yardstick.",
    "artifact": "",
    "done": [
     "There is a written guideline with per-category examples, and a fraction of pairs is judged by two people to measure weighted kappa.",
     "A judgment round (3,000 queries × 20 results ≈ 60k, ≈ US$3k) runs every quarter and before each new model.",
     "Negatives are skip-above and random same-category, never “shown without click”, and without near-duplicates of the positive.",
     "Query logs have no PII, the user id is pseudonymized and query photos are not stored: only the vector and a hash.",
     "Photo search is evaluated with another photo of the same listing as the query, without storing user photos."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.datos"
     },
     {
      "label": "Course · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "judgments-round",
      "label": "Judgments per round",
      "out": "judgments_round",
      "expr": "judged_queries * judged_per_query",
      "unit": "judgments",
      "tol": 0,
      "why": "Graded labels behind NDCG@10; one round per quarter and per new model.",
      "check": null,
      "ref": "#c07.datos"
     },
     {
      "id": "judgments-cost",
      "label": "Cost per judgment round",
      "out": "judgments_cost",
      "expr": "judgments_round * price_judgment",
      "unit": "US$",
      "tol": 0.02,
      "why": "Part of the ≈ US$6–7k each model change costs.",
      "check": null,
      "ref": "#c07.datos"
     },
     {
      "id": "positive-pairs-day",
      "label": "Query–contact pairs per day",
      "out": "positive_pairs_day",
      "expr": "n_searches_day * contact_rate",
      "unit": "pairs/day",
      "tol": 0.02,
      "why": "Free fine-tuning signal, biased to what the old ranker showed.",
      "check": null,
      "ref": "#c07.datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "cambia",
    "title": "Versions Down to the Vector",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Version everything, including each vector: a whole index belongs to a single model_version (named `listings-vec-v7`), and a Parquet copy of every vector per version stays in S3 to rebuild without GPU and to measure drift.",
    "artifact": "",
    "done": [
     "The training-pairs snapshot is versioned and the retention rule was applied before copying.",
     "Evaluation sets are frozen with their date and judgments carry the guideline version.",
     "Each index document stores model_version and the listing version; an old version never overwrites a newer one.",
     "Each version's vectors are in S3 (≈ 205 GB in FP32, ≈ US$5 per month)."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.datos"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Course · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ],
    "inputs": [],
    "outputs": [
     "per-version vectors in S3 (Parquet)"
    ],
    "calcs": [
     {
      "id": "vectors-s3-cost",
      "label": "FP32 vectors per version in S3",
      "out": "vectors_s3_cost",
      "expr": "index_fp32_gb * price_s3_gb_month",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Keeping every version is negligible: rebuild an index without GPUs.",
      "check": null,
      "ref": "#c07.arquitectura"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Encoder Fine-Tuning",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Fine-tune a CLIP-style dual encoder (d = 512) on (title, photo) and (query, contacted listing) pairs, run by the models team quarterly rather than weekly, because each new version forces a catalog re-embed and a two-index A/B.",
    "artifact": "",
    "done": [
     "Pairs were filtered: titles that do not describe the photo (“vendo urgente”, “ver fotos”) are out.",
     "The same item listed twice is never in both train and test.",
     "The version is in the registry with its lineage and the gate metrics.",
     "There is a written trigger to bring it forward: query drift together with NDCG or CTR dropping in a slice."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.datos"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.monitoreo"
     },
     {
      "label": "Course · M10 · MLOps · Reentrenamiento: programado, disparado o continuo",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reentrenamiento"
     },
     {
      "label": "Sheet · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Ranking Gate",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Gate on ranking quality (NDCG@10 and recall@k against human judgments), not accuracy, and require an improvement worth the cost of a re-embed and two live indexes, not just “no worse”.",
    "artifact": "",
    "done": [
     "NDCG@10 on head, torso and tail is no worse than production within its interval (paired bootstrap over queries), and no country or category drops more than its margin.",
     "“Same item” recall@k on photo search is measured.",
     "judged@10 is reported alongside NDCG, and gaps are judged before concluding.",
     "The final evaluation runs on the real (green) index, not only with exact search."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.evaluacion"
     },
     {
      "label": "Course · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Sheet · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "export",
    "base": "export",
    "status": "cambia",
    "title": "One Artifact, Three Consumers",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Ship a single encoder artifact from the registry to the three pieces that use it — the query encoder in Triton, the embed-worker and the re-embedding job — producing the same vectors up to numerical noise.",
    "artifact": "",
    "done": [
     "All three use the same artifact, the same runtime and the same precision.",
     "The parity test on a sample gives cosine ≥ 0.999 between the embed-worker's vector and the bulk job's.",
     "Triton serves both towers (text and image) as separate models, each with dynamic batching.",
     "There is no CPU path with another precision: it would be training-serving skew applied to vectors."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Course · M09 · Datos y features · Training-serving skew: causas, detección y prevención",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.skew"
     },
     {
      "label": "Sheet · Del dato a producción · estación 5 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "re-embedding",
    "base": null,
    "status": "nuevo",
    "title": "Catalog Re-Embedding",
    "tramo": "modelo",
    "speed": "nuevo",
    "question": "",
    "note": "Re-embed all 100 M listings on every model change with a sharded, checkpointed batch job that reads a catalog snapshot and writes the vectors to S3.",
    "artifact": "",
    "done": [
     "The catalog snapshot recorded the Kafka offset at that moment.",
     "≈ 23 GPU-h ran across both towers (image ≈ 14, text ≈ 9): ≈ 3 h on 8 L4, ≈ US$19 on-demand.",
     "There was CPU to decode the thumbnails (≈ 24 cores), or decoding ran on GPU.",
     "The new version's vectors are in S3 and are never mixed with another version's in an index."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Sheet · Del dato a producción · casos híbridos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-hibrido"
     }
    ],
    "inputs": [
     "catalog snapshot"
    ],
    "outputs": [
     "new-version vectors in S3"
    ],
    "calcs": [
     {
      "id": "reembed-gpu-h",
      "label": "Re-embedding GPU-hours (both towers)",
      "out": "reembed_gpu_h",
      "expr": "n_items / img_tput_l4 / 3600 + n_items / text_tput_catalog_l4 / 3600",
      "unit": "GPU-h",
      "tol": 0.02,
      "why": "GPU time for a model change: ≈ 14 image + ≈ 9 text.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "reembed-wall-h",
      "label": "Wall clock on the job fleet",
      "out": "reembed_wall_h",
      "expr": "reembed_gpu_h / n_gpu_reembed",
      "unit": "h",
      "tol": 0.02,
      "why": "A planned event of hours, not minutes: no need for more GPUs.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "reembed-cost",
      "label": "Re-embedding GPU cost (on-demand)",
      "out": "reembed_cost",
      "expr": "reembed_gpu_h * price_l4_h",
      "unit": "US$",
      "tol": 0.03,
      "why": "Under US$20: spot does not justify interruptions on a 3 h job.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "decode-cores",
      "label": "CPU cores to feed the job fleet",
      "out": "decode_cores",
      "expr": "n_gpu_reembed * img_tput_l4 * decode_cpu_ms / 1000",
      "unit": "cores",
      "tol": 0.02,
      "why": "JPEG decode is the bottleneck (4 vCPU per g6.xlarge): plan CPU or DALI.",
      "check": null,
      "ref": "#c07.estimaciones"
     }
    ]
   },
   {
    "id": "indice-green",
    "base": null,
    "status": "nuevo",
    "title": "Build the Green Index",
    "tramo": "modelo",
    "speed": "nuevo",
    "question": "",
    "note": "Build the stateful vector index side by side (`listings-vec-v8`) — HNSW on int8, 4 shards × 25 M with 2 copies, in an OpenSearch k-NN index separate from BM25 — while a second embed-worker brings it up to date.",
    "artifact": "",
    "done": [
     "Each shard has ≈ 19–21 GB of graph + int8 in RAM, and the rescoring FP32 vectors (51.2 GB) on EBS gp3, served from the page cache.",
     "It was built without replicas or refresh and the second copy was added afterwards; a new copy is warmed up before it takes traffic.",
     "The graph parameters (M = 32) are pinned in the mapping, not left at the defaults.",
     "A v8 embed-worker, with its own consumer group, processed events from the snapshot offset and green caught up to the present.",
     "Green's recall canary gives ANN recall@100 ≥ 0.95 against exact search, with and without filters."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
     },
     {
      "label": "Sheet · Del dato a producción · casos híbridos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-hibrido"
     }
    ],
    "inputs": [],
    "outputs": [
     "green index `listings-vec-v8`"
    ],
    "calcs": [
     {
      "id": "shard-hot-gb",
      "label": "Graph + int8 per shard (with overhead)",
      "out": "shard_hot_gb",
      "expr": "n_items / n_shards * (emb_dim + hnsw_m * 2 * 4) * engine_overhead / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "The traversed set must be in RAM: a page fault mid-graph is a disk read.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "shard-fp32-gb",
      "label": "FP32 rescoring vectors per shard",
      "out": "shard_fp32_gb",
      "expr": "n_items / n_shards * emb_dim * 4 / 1e9",
      "unit": "GB",
      "tol": 0.02,
      "why": "Served from page cache on gp3; a new copy must prewarm this before traffic.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "node-ram-used-gb",
      "label": "RAM used per data node",
      "out": "node_ram_used_gb",
      "expr": "heap_gb + shard_hot_gb + shard_fp32_gb",
      "unit": "GB",
      "tol": 0.02,
      "why": "Picks the r7i.4xlarge (128 GiB) over a bigger or smaller box.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "node-mem-util",
      "label": "Node memory utilization",
      "out": "node_mem_util",
      "expr": "node_ram_used_gb / node_ram_gb",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Headroom for merges that build new graphs and catalog growth.",
      "check": {
       "expr": "node_mem_util <= 0.85",
       "label": "Stays under ShardMemoryHigh (85 %)"
      },
      "ref": "#c07.estimaciones"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "Hybrid search-api",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Orchestrate instead of infer: fire BM25 immediately and, in parallel, the encoder and ANN; fuse with RRF (k = 60), drop tombstones, rerank the text top-30 and degrade step by step down to BM25 only.",
    "artifact": "",
    "done": [
     "The 46 tests in `search/` pass (≈ 2 s): each one is a failure mode, from a slow encoder to a shard with a different model.",
     "The version is not configured: search-api reads which index the `listings-vec-live` alias points to and asks the encoder for that version; a shard response with a different model_version is discarded.",
     "Filters go inside the search and are re-checked after RRF.",
     "`/readyz` does not check versions, and the log writes [tel] and [email] in place of phone and email.",
     "RRF ties are ordered deterministically (score, best position, number of lists, id)."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.archivos"
     },
     {
      "label": "Sheet · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "ann-cores-peak",
      "label": "ANN cores per node, one copy down",
      "out": "ann_cores_peak",
      "expr": "qps_design * ann_cpu_ms / 1000",
      "unit": "cores",
      "tol": 0.02,
      "why": "ANN is memory-bound: if CPU were short, add copies, not shards.",
      "check": {
       "expr": "ann_cores_peak <= node_vcpu",
       "label": "One copy carries the full peak on 16 vCPU"
      },
      "ref": "#c07.estimaciones"
     },
     {
      "id": "rescore-reads-node",
      "label": "FP32 rescoring reads per node",
      "out": "rescore_reads_node",
      "expr": "qps_design / n_copies * rescore_k",
      "unit": "reads/s",
      "tol": 0.02,
      "why": "Far above the 40k IOPS EBS ceiling: FP32 must sit in page cache.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "rerank-util-n1",
      "label": "Reranker utilization, one L4 down",
      "out": "rerank_util_n1",
      "expr": "qps_text * rerank_k / ((gpu_reranker - 1) * rerank_tput_l4)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "At the edge of the 70 % plan: the query cache provides the margin, else a 9th L4.",
      "check": null,
      "ref": "#c07.estimaciones"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "igual",
    "title": "search-api Image",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Keep the API image small and model-free as in C01, since the heavy parts sit behind the network (Triton, OpenSearch, Redis) and it needs no numpy, Pillow or torch.",
    "artifact": "Dockerfiles probados (gateway y Triton)",
    "done": [
     "The base is `python:3.13.15-slim-trixie` (≈ 43 MB compressed).",
     "The full lock (17 packages) was generated with `uv pip compile` for Linux x86_64 and Python 3.13, without numpy or Pillow.",
     "`fakes.py` and the tests are not in the image.",
     "One uvicorn process runs per container."
    ],
    "commands": [
     {
      "code": "docker build --platform linux/amd64 -t classifier-gateway:{tag} gateway/",
      "note": "On an Apple Silicon Mac `--platform` is mandatory: c6i and g4dn nodes are x86. The tag is the commit."
     },
     {
      "code": "docker build -t classifier-triton:{version_modelo} triton/",
      "note": "Fails on purpose if `model.plan` is missing: run `build_engine.sh` on the T4 first."
     },
     {
      "code": "docker compose up --build",
      "note": "From `reference/c01`: gateway, Triton with GPU and Prometheus on one machine."
     },
     {
      "code": "curl -s -H \"Content-Type: image/jpeg\" --data-binary @{foto} \"localhost:8080/v1/classify?top_k=5\"",
      "note": "The end-to-end check: top-5 with `model_version`."
     },
     {
      "code": "docker history classifier-gateway:{tag}",
      "note": "One row per layer: find the one that bloated the image."
     },
     {
      "code": "docker buildx imagetools inspect --format '{{json .Image}}' {registry}/classifier-gateway:{tag}",
      "note": "Before deploying: the config must say `\"architecture\": \"amd64\"`. Without `--format`, a single-platform image does not show its own."
     }
    ],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.archivos"
     },
     {
      "label": "Course · M05 · Contenedores · Un Dockerfile de ML, decisión por decisión",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.dockerfile-ml"
     },
     {
      "label": "Sheet · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD & Image Registry",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Test without GPU and build images once as in C01, with tests that cover the fallback ladder and check that every metric the alerts use exists.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "The 88 tests in search, indexing and eval pass without GPU, Kafka, OpenSearch or Redis.",
     "`promtool test rules` passes the 14 scenarios, and changing any of the 12 thresholds makes its test fail.",
     "A test reads `alerts.yml` and requires every `search_*` metric to exist on `/metrics`.",
     "As in C01: each image is built once, with an immutable tag, and staging and production use the same digest."
    ],
    "commands": [
     {
      "code": "cd reference/c01/gateway && pip install -r requirements-dev.txt && pytest",
      "note": "24 tests with no GPU or Triton: the first thing CI runs."
     },
     {
      "code": "aws ecr get-login-password --region {region} | docker login --username AWS --password-stdin {registry}",
      "note": "ECR login; the token lasts 12 h. In CI, via an OIDC-assumed role, no stored keys."
     },
     {
      "code": "docker buildx build --platform linux/amd64 -t {registry}/classifier-gateway:{sha} --push gateway/",
      "note": "Single build for the node architecture; `{sha}` is the first 7 characters of the commit: `git rev-parse --short=7 HEAD` (in CI, `${GITHUB_SHA::7}`)."
     },
     {
      "code": "crane digest {registry}/classifier-gateway:{sha}",
      "note": "The digest is the identity: it is what gets signed and deployed."
     },
     {
      "code": "cosign sign --yes {registry}/classifier-gateway@{digest}",
      "note": "Keyless signing with the CI's OIDC identity."
     },
     {
      "code": "kubectl -n classifier set image deployment/gateway gateway={registry}/classifier-gateway@{digest}",
      "note": "Deploy by digest; with GitOps that value goes in a PR to the manifests repo."
     }
    ],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.archivos"
     },
     {
      "label": "Course · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Sheet · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "Nodes, GPUs & Scaling",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Run the RAM-resident index on 8 dedicated r7i.4xlarge nodes in the OpenSearch cluster next to the stateless services, and split GPUs between the query encoder (2 L4), the reranker (8 L4) and the embed-worker (1 L4, scaled on lag).",
    "artifact": "",
    "done": [
     "Vector-index shards live on dedicated data nodes (node attributes), separate from BM25: 4 shards × 2 copies across 2 zones, with ≈ 64 % of memory used.",
     "The encoder has 2 L4 in two zones: one covers the peak and the second is redundancy.",
     "The reranker over the top-30 fits in 8 L4 (≈ 62 %), and its throughput was measured with perf_analyzer before committing to the design.",
     "The embed-worker scales on lag with KEDA, and search-api runs stateless across several zones."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
     },
     {
      "label": "Sheet · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "l4-total",
      "label": "L4 nodes in the cluster",
      "out": "l4_total",
      "expr": "gpu_encoder + gpu_reranker + gpu_embed",
      "unit": "GPUs",
      "tol": 0,
      "why": "GPU node pool size: encoder 2, reranker 8, embed-worker 1.",
      "check": null,
      "ref": "#c07.costo"
     },
     {
      "id": "rerank-util",
      "label": "Reranker utilization, all up",
      "out": "rerank_util",
      "expr": "qps_text * rerank_k / (gpu_reranker * rerank_tput_l4)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Confirms the reranker Deployment replica count.",
      "check": {
       "expr": "rerank_util <= target_util",
       "label": "Reranker fleet within the 70 % plan"
      },
      "ref": "#c07.estimaciones"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Index Blue/Green",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Change models by building the index side by side and moving an alias, never re-indexing in place, with each A/B arm a complete (encoder, index) pair and never a mix.",
    "artifact": "",
    "done": [
     "Shadow sent a copy of the queries to green: p99 within budget and differences against blue explainable.",
     "The per-user A/B ran 1–2 weeks: contacts per search no worse, some significant improvement and healthy guardrails.",
     "The swap is a single atomic alias change (`_aliases` with remove + add in the same request).",
     "Blue stays 7 days for rollback and up to date: the v7 worker keeps writing to it and the encoder keeps v7 loaded."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.evaluacion"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
     },
     {
      "label": "Sheet · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "ab-n-arm",
      "label": "A/B searches per arm",
      "out": "ab_n_arm",
      "expr": "16 * contact_rate * (1 - contact_rate) / (contact_rate * ab_rel_lift) ^ 2",
      "unit": "searches",
      "tol": 0.02,
      "why": "Sample for a +2 % contact lift; traffic is not what sets the duration.",
      "check": null,
      "ref": "#c07.evaluacion"
     },
     {
      "id": "ab-days",
      "label": "Days to reach the A/B sample",
      "out": "ab_days",
      "expr": "ab_n_arm / (n_searches_day * ab_traffic_share)",
      "unit": "days",
      "tol": 0.02,
      "why": "Under a day: the weekly cycle and novelty effect set 1–2 weeks.",
      "check": null,
      "ref": "#c07.evaluacion"
     },
     {
      "id": "parallel-index-week",
      "label": "Second index cost per week",
      "out": "parallel_index_week",
      "expr": "ann_nodes * price_r7i_h * 168",
      "unit": "US$/week",
      "tol": 0.02,
      "why": "Each A/B and rollback week runs two full indexes.",
      "check": null,
      "ref": "#c07.datos"
     },
     {
      "id": "blue-missing",
      "label": "Listings a frozen blue would miss",
      "out": "blue_missing",
      "expr": "rollback_days * new_items_day",
      "unit": "listings",
      "tol": 0.02,
      "why": "Why blue keeps receiving writes for its 7 rollback days.",
      "check": null,
      "ref": "#c07.serving"
     }
    ]
   },
   {
    "id": "indexacion-streaming",
    "base": null,
    "status": "nuevo",
    "title": "Streaming Indexing",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Consume new and sold listings from Kafka (`listing-events`, key = listing_id) in the embed-worker — deletions first, as Redis tombstones with no GPU, then embeddings and upsert — to meet “new searchable at p95 ≤ 5 min” and “sold removed in ≤ 1 min”.",
    "artifact": "",
    "done": [
     "The worker is idempotent by (listing_id, event version): a late `updated` never resurrects a `sold`.",
     "It refuses to write if its encoder and the index do not share the same model_version, and crashes without committing offsets.",
     "A price or city change updates only the filter attributes, without re-embedding.",
     "A photo that fails to download or decode goes to a dead-letter queue with its reason, without blocking the partition.",
     "The 18 tests in `test_embed_worker.py` pass."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Streaming: inferencia sobre eventos",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.streaming"
     },
     {
      "label": "Sheet · Del dato a producción · casos híbridos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-hibrido"
     }
    ],
    "inputs": [
     "`listing-events` (Kafka, key = listing_id)"
    ],
    "outputs": [
     "Redis tombstones",
     "upserted vectors in the index"
    ],
    "calcs": [
     {
      "id": "new-items-peak",
      "label": "New listings per second at peak",
      "out": "new_items_peak",
      "expr": "new_items_day / 86400 * peak_factor",
      "unit": "items/s",
      "tol": 0.05,
      "why": "Arrival rate the embed-worker must keep within p95 ≤ 5 min.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "embed-items-peak",
      "label": "Items to embed per second at peak",
      "out": "embed_items_peak",
      "expr": "(new_items_day + edits_day) / 86400 * peak_factor",
      "unit": "items/s",
      "tol": 0.05,
      "why": "Load on the embed-worker: one photo + one text each.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "embed-gpu-util",
      "label": "embed-worker L4 utilization",
      "out": "embed_gpu_util",
      "expr": "embed_items_peak / (target_util * img_tput_l4)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "A nearly idle L4 is kept for vector parity, not throughput.",
      "check": {
       "expr": "embed_gpu_util <= 1",
       "label": "One L4 covers the peak"
      },
      "ref": "#c07.estimaciones"
     },
     {
      "id": "deleted-week-frac",
      "label": "Graph nodes deleted in a week",
      "out": "deleted_week_frac",
      "expr": "7 * removals_day / n_items",
      "unit": "fraction",
      "tol": 0.05,
      "why": "Uncompacted deletes cost RAM and recall: tombstones + rebuild cadence.",
      "check": null,
      "ref": "#c07.estimaciones"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "cambia",
    "title": "Live Search Request",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "Serve each query as a scatter-gather — BM25 ∥ (encoder → 4 shards), RRF, tombstones, reranker and hydration — at ≈ 100 ms typical against p99 ≤ 300 ms for text and ≤ 600 ms for photo.",
    "artifact": "",
    "done": [
     "Every call has its cap (encoder 50 ms, each shard 80, BM25 120, tombstones 20, rerank 100) and timeouts derive from a propagated deadline.",
     "Tombstones for the ≤ 400 candidates are checked in a single round trip, also for what comes from the cache.",
     "If the encoder or all shards fail, text is served with BM25 only; a photo returns 503 with Retry-After.",
     "The query cache carries the index version in the key and a 5 min TTL; photo searches are not cached.",
     "A slow shard gets a hedged request to its other copy; if that does not arrive, the response goes out partial and is not cached."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Course · C07 · Búsqueda con embeddings · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.fallas"
     },
     {
      "label": "Course · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Sheet · Del dato a producción · estación 11 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "query-tail-if-p99",
      "label": "Query tail if each shard meets p99",
      "out": "query_tail_p99",
      "expr": "1 - p_target ^ n_shards",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Shard p99 becomes query p96: fan-out widens the tail.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "shard-tail-budget",
      "label": "Per-shard tail budget for query p99",
      "out": "shard_tail_budget",
      "expr": "1 - p_target ^ (1 / n_shards)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Each shard must hold its budget at p99.75: per-shard timeout + hedged request.",
      "check": null,
      "ref": "#c07.estimaciones"
     },
     {
      "id": "critical-path-ms",
      "label": "Typical text critical path",
      "out": "critical_path_ms",
      "expr": "t_parse_ms + t_cache_ms + max(t_bm25_ms, t_enc_ms + t_ann_ms) + t_tomb_ms + t_rrf_ms + t_rerank_ms + t_hydrate_ms",
      "unit": "ms",
      "tol": 0.02,
      "why": "Leaves the rest of 300 ms for queues, GC and the scatter-gather tail.",
      "check": {
       "expr": "critical_path_ms <= p99_text_ms",
       "label": "Typical path inside the 300 ms p99"
      },
      "ref": "#c07.serving"
     },
     {
      "id": "photo-decode-cores",
      "label": "Photo decode cores at peak",
      "out": "photo_decode_cores",
      "expr": "qps_photo * photo_decode_ms / 1000",
      "unit": "cores",
      "tol": 0.05,
      "why": "Decode runs in Triton preprocessing on the encoder nodes, not in search-api.",
      "check": null,
      "ref": "#c07.estimaciones"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Index Monitoring",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Monitor an index that can degrade without any service failing, measure freshness end to end in both directions, and treat query drift as a retraining trigger, not a paging alert.",
    "artifact": "",
    "done": [
     "The 8 alerts are loaded: SearchLatencyHigh, ZeroResultRateHigh, IndexFreshnessLag, SoldItemsServed, ANNRecallDrop, EmbedWorkerBacklog, SearchCTRDrop and ShardMemoryHigh.",
     "The canary runs every hour and `ANNRecallDrop` fires if recall@100 drops below 0.95 on any shard or if the canary has not run for more than 3 h.",
     "A synthetic listing published every minute measures when a search finds it, alongside the worker's freshness histogram and each consumer group's lag.",
     "Retraining is quarterly (fine-tuning → gate → re-embedding → blue/green → A/B), and a degraded index is rebuilt from the S3 vectors, without GPU."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C07 · Búsqueda con embeddings · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.monitoreo"
     },
     {
      "label": "Course · M12 · Monitoreo · Data drift, concept drift y label shift",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.drift"
     },
     {
      "label": "Sheet · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "burn-fast-ratio",
      "label": "Fast-burn error ratio (1 h)",
      "out": "burn_fast_ratio",
      "expr": "burn_fast * (1 - slo_avail)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Error rate that pages: 2 % of the monthly budget in 1 h.",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     },
     {
      "id": "failed-search-budget",
      "label": "Failed searches allowed per month",
      "out": "failed_search_budget",
      "expr": "n_searches_day * 30 * (1 - slo_avail)",
      "unit": "searches/month",
      "tol": 0.02,
      "why": "Error budget in requests for the burn-rate rules.",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     },
     {
      "id": "backlog-page-min",
      "label": "Time from worker stop to page",
      "out": "backlog_page_min",
      "expr": "backlog_thr_min + backlog_for_min",
      "unit": "min",
      "tol": 0.02,
      "why": "Gap where the ≤ 1 min sold-item promise breaks: split removals into their own consumer group if it repeats.",
      "check": null,
      "ref": "#c07.serving"
     }
    ]
   }
  ],
  "streaming": [
   {
    "id": "kickoff",
    "base": "kickoff",
    "status": "nuevo",
    "title": "Requirements & Capacity Plan",
    "tramo": "diseno",
    "speed": "diseno",
    "question": "",
    "note": "Size concurrency, GPUs, gateway CPU and network from daily meetings against the partial and final latency SLOs and ≥ 99.5 % availability, and settle in-house vs managed API on cost.",
    "artifact": "",
    "inputs": [],
    "outputs": [],
    "done": [
     "Concurrency is computed from 2 M meetings/day × 30 % with captions × 40 min: ≈ 16.7k simultaneous meetings on average, ≈ 50k at peak (3×), ≈ 200k connected tracks and ≈ 60k active streams with VAD.",
     "GPUs are sized by active streams: 350 per L4 (70 % of ≈ 500 measured) → ≈ 172 L4 at peak, with the fleet following the daily curve (≈ 100 L4 on average).",
     "The partials p95 ≤ 500 ms budget is split by hop: ≈ 300 ms typical, ≈ 510 ms if all the bad hops coincide.",
     "Monthly cost is ≈ US$58k of GPUs + ≈ US$23–37k for everything else, against ≈ US$3.5–8.6 M/month for a managed streaming API."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.requisitos"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.estimaciones"
     },
     {
      "label": "Sheet · Formulario de estimaciones · C01 sizing chain",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/"
     }
    ],
    "calcs": [
     {
      "id": "caption-min-day",
      "label": "Captioned meeting-minutes per day",
      "out": "caption_min_day",
      "expr": "meetings_day * caption_share * meeting_min",
      "unit": "min/day",
      "tol": 0.02,
      "why": "Daily volume; concurrency comes from Little, not from ÷ 86,400 as requests.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "meetings-peak",
      "label": "Concurrent captioned meetings, peak",
      "out": "meetings_peak",
      "expr": "caption_min_day / 1440 * peak_factor",
      "unit": "meetings",
      "tol": 0.02,
      "why": "Little: concurrency = arrivals × duration, then × 3 for the peak.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "tracks-peak",
      "label": "Connected tracks at peak",
      "out": "tracks_peak",
      "expr": "meetings_peak * participants",
      "unit": "sessions",
      "tol": 0.02,
      "why": "Open gRPC sessions on the gateways: CPU and memory, not GPU.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "streams-peak",
      "label": "Active streams at peak (with VAD)",
      "out": "streams_peak",
      "expr": "meetings_peak * speakers_per_meeting",
      "unit": "streams",
      "tol": 0.02,
      "why": "The capacity unit: only voiced tracks reach the GPU.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "streams-avg",
      "label": "Active streams, average",
      "out": "streams_avg",
      "expr": "caption_min_day / 1440 * speakers_per_meeting",
      "unit": "streams",
      "tol": 0.02,
      "why": "What a perfectly elastic fleet would use.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "gpu-peak",
      "label": "L4s for the peak",
      "out": "gpu_peak",
      "expr": "ceil(streams_peak / (streams_max_l4 * target_util))",
      "unit": "GPUs",
      "tol": 0,
      "why": "Fleet at 09:00–11:00; the 30 % left absorbs the on-the-hour burst.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "gpu-avg-busy",
      "label": "L4s busy on average",
      "out": "gpu_avg_busy",
      "expr": "streams_avg / (streams_max_l4 * target_util)",
      "unit": "GPUs",
      "tol": 0.02,
      "why": "Lower bound only: billed fleet ≈ 100 with ramp headroom, draining and the night floor.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "gpu-cost-month",
      "label": "GPU cost per month (billed fleet)",
      "out": "gpu_cost_month",
      "expr": "fleet_avg_l4 * price_l4_h * 730",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Cost with the billed fleet, never with busy GPUs.",
      "check": null,
      "ref": "#c13.costo"
     },
     {
      "id": "voice-min-month",
      "label": "Voiced minutes per month",
      "out": "voice_min_month",
      "expr": "caption_min_day * speakers_per_meeting * 30",
      "unit": "min/month",
      "tol": 0.02,
      "why": "The billing unit of a managed API.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "api-cost-month",
      "label": "Managed API cost per month",
      "out": "api_cost_month",
      "expr": "voice_min_month * api_price_min",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Build vs buy: at this scale self-hosting is 40–100× cheaper.",
      "check": {
       "expr": "gpu_cost_month < api_cost_month",
       "label": "Self-hosting beats the API at this volume"
      },
      "ref": "#c13.estimaciones"
     },
     {
      "id": "ingress-gbps",
      "label": "SFU → gateway bandwidth, peak",
      "out": "ingress_gbps",
      "expr": "tracks_peak * opus_kbps / 1e6",
      "unit": "Gb/s",
      "tol": 0.02,
      "why": "In-zone only: SFU, gateway and worker of a session share a zone.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "error-budget-min",
      "label": "Error budget (30 days)",
      "out": "error_budget_min",
      "expr": "(1 - slo_avail) * 43200",
      "unit": "min/month",
      "tol": 0.02,
      "why": "Captioned minutes without captions the month allows (99.5 %, not 99.9 %).",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     }
    ]
   },
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Licensed & Consented Audio",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Source labeled audio only from licensed corpora, consented per-accent recordings and opt-in customers, transcribed by people against a guide; customer audio is not stored.",
    "artifact": "",
    "done": [
     "Each file enters with its manifest (transcript, speaker, slice, license and consent); without traceable license or consent, it does not enter.",
     "Audio comes from corpora with verified commercial licenses, consented per-accent recordings and opt-in organizations; never from customers without consent.",
     "Transcripts follow a written, versioned guide (numbers, fillers, code-switching, overlapping speech), with a double pass on the golden set.",
     "Agreement between transcribers is measured as WER between two independent transcripts.",
     "Opt-in audio lives in a separate, encrypted bucket, with role-based access and deletion on request."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Course · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Course · M15 · Seguridad y confiabilidad · Datos personales: dónde están, cuánto duran y quién los ve",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.pii-privacidad"
     },
     {
      "label": "Sheet · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "saved-min-day",
      "label": "Saved transcript minutes per day",
      "out": "saved_min_day",
      "expr": "caption_min_day * save_share",
      "unit": "min/day",
      "tol": 0.02,
      "why": "Only host opt-in meetings are stored; audio never is.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "transcripts-gb-day",
      "label": "Transcript storage per day",
      "out": "transcripts_gb_day",
      "expr": "saved_min_day * transcript_kb_min / 1e6",
      "unit": "GB/day",
      "tol": 0.02,
      "why": "Storage is a privacy topic, not a cost topic.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "transcripts-tb-retained",
      "label": "Transcripts retained (30 days)",
      "out": "transcripts_tb",
      "expr": "transcripts_gb_day * retention_days / 1000",
      "unit": "TB",
      "tol": 0.05,
      "why": "Sizes the store and the deletion job.",
      "check": null,
      "ref": "#c13.estimaciones"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "igual",
    "title": "Frozen Per-Slice Golden Sets",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Freeze golden sets per language and slice (accent, noise, device), separated from training data by speaker.",
    "artifact": "snapshot ds-2026-09-01 (manifest inmutable)",
    "done": [
     "There is one golden set per language (Spanish, English and Portuguese), with slices by accent or region, noise, device, overlapping speech, code-switching and telephone.",
     "The golden set is separated from training by speaker and by session, deduplicated by audio and text fingerprint, and never enters training.",
     "WER normalization is written and versioned, and its version is reported with every number.",
     "Per-slice intervals come from a per-speaker bootstrap, not per-word."
    ],
    "commands": [
     {
      "code": "aws s3 ls s3://{bucket}/datasets/{snapshot_id}/",
      "note": "List what is under a snapshot prefix (read-only)."
     },
     {
      "code": "dvc add {carpeta_datos} && dvc push",
      "note": "If the team already uses DVC: hashes the folder, leaves `{carpeta_datos}.dvc` for git and pushes the data to the S3 remote."
     },
     {
      "code": "lakectl branch create lakefs://{repo}/{rama} -s lakefs://{repo}/main",
      "note": "If you use lakeFS: an isolated branch over the bucket, no data copied; then `lakectl commit` and `lakectl merge`."
     }
    ],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.evaluacion"
     },
     {
      "label": "Course · M09 · Datos y features · Data leakage: cuando el training conoce el futuro",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.leakage"
     },
     {
      "label": "Course · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "golden-words-hour",
      "label": "Words in one golden hour",
      "out": "golden_words_hour",
      "expr": "60 * words_per_min",
      "unit": "words",
      "tol": 0.02,
      "why": "Minimum audio per slice so a 1–2 point WER change is visible.",
      "check": null,
      "ref": "#c13.datos"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Streaming ASR Fine-Tune",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Start from a pretrained streaming ASR (transducer/CTC) and fine-tune per language only when needed; nothing is trained from scratch.",
    "artifact": "",
    "done": [
     "Start from a pretrained streaming ASR (transducer or CTC); nothing is trained from scratch.",
     "Per-language fine-tuning starts from the base model or the production one, on rented GPUs (spot with checkpoints).",
     "A slice that falls behind triggers it, and there is a quarterly review."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Course · M10 · MLOps · Pipelines de entrenamiento orquestados",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
     },
     {
      "label": "Sheet · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "WER & Streams Gate",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Gate on WER per language and slice with fixed normalization, plus latency and streams per GPU measured on an L4, against the production model.",
    "artifact": "",
    "done": [
     "Each slice's WER is no worse than production plus its interval, with the fixed normalization, and the target slice improves.",
     "No slice is worse than 1.5× its language's average.",
     "Partial latency and streams per L4 are measured on a real L4 with 160 ms chunks, together with the partial revision rate.",
     "If the model is quantized, the gate runs on the engine, not on the checkpoint."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.evaluacion"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Course · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Sheet · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "wer-se-naive",
      "label": "Naive WER standard error, 1 h slice",
      "out": "wer_se_pts",
      "expr": "sqrt(wer_ref * (1 - wer_ref) / golden_words_hour) * 100",
      "unit": "WER points",
      "tol": 0.05,
      "why": "Real interval is 2–4× wider: bootstrap by speaker before claiming a 1-point gain.",
      "check": null,
      "ref": "#c13.datos"
     },
     {
      "id": "slice-wer-ceiling",
      "label": "Worst-slice WER allowed",
      "out": "slice_wer_max",
      "expr": "slice_ceiling * wer_ref",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Blocks a model whose average hides a failing accent or device.",
      "check": null,
      "ref": "#c13.requisitos"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "igual",
    "title": "L4 Engine & Config",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Compile the engine for the serving GPU (L4) as in C01, and store the streaming config (chunk, lookahead, endpointing) in the registry alongside it.",
    "artifact": "engine model.plan (versión challenger)",
    "done": [
     "The engine is compiled for L4, the serving GPU: TensorRT is not portable across GPUs.",
     "Per language, the registry stores the model, its L4 engine, the streaming config (chunk, lookahead and endpointing), the gate metrics and the golden-set version.",
     "FP16 or INT8 with TensorRT is validated with per-slice WER on the engine."
    ],
    "commands": [
     {
      "code": "python model/export_onnx.py --checkpoint {checkpoint.pt} --out model/classifier.onnx",
      "note": "Exports and verifies. Without `--checkpoint` it uses random weights: pipeline test only."
     },
     {
      "code": "python model/parity_check.py --checkpoint {checkpoint.pt} --onnx model/classifier.onnx --images {carpeta_muestra_eval} --n 2000",
      "note": "CPU parity with ONNX Runtime; exit 1 = fail. Without `--checkpoint`, the PyTorch reference would have random weights."
     },
     {
      "code": "bash model/build_engine.sh",
      "note": "On the T4, with Docker and NVIDIA Container Toolkit: produces `triton/model_repository/classifier/1/model.plan`."
     },
     {
      "code": "python model/parity_check.py --backend triton --triton-url {host}:8000 --checkpoint {checkpoint.pt} --images {carpeta_muestra_eval} --n 2000",
      "note": "FP16 engine served by Triton vs PyTorch FP32 from the same checkpoint; exit 1 = not registered."
     },
     {
      "code": "perf_analyzer -m classifier -u {host}:8000 --request-rate-range=250:500:250 --percentile=99",
      "note": "Fixed-rate load (250 and 500 req/s) for the latency gate: compare p99 with the champion's."
     }
    ],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Course · M08 · Optimización de modelos · TensorRT",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
     },
     {
      "label": "Course · M08 · Optimización de modelos · Cómo validar una optimización",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.validar"
     },
     {
      "label": "Sheet · Del dato a producción · estación 5 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     }
    ],
    "inputs": [],
    "outputs": [
     "L4 engine",
     "streaming config (chunk, lookahead, endpointing) in the registry"
    ],
    "calcs": [
     {
      "id": "stream-state-mb",
      "label": "Cached state per stream (FP16)",
      "out": "stream_state_mb",
      "expr": "n_layers * ctx_frames * d_model * 2 / 1e6",
      "unit": "MB",
      "tol": 0.02,
      "why": "VRAM per live sequence in the L4 engine.",
      "check": null,
      "ref": "#c13.serving"
     },
     {
      "id": "stream-state-gb-max",
      "label": "Stream state at max streams",
      "out": "stream_state_gb",
      "expr": "streams_max_l4 * stream_state_mb / 1000",
      "unit": "GB",
      "tol": 0.05,
      "why": "VRAM is not the limit; compute per step is.",
      "check": {
       "expr": "stream_state_gb <= l4_vram_gb",
       "label": "Fits in the L4's 24 GB"
      },
      "ref": "#c13.serving"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "CPU Gateway & GPU Worker",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Run `asr-gateway` on CPU (Opus → 16 kHz, VAD, 160 ms chunks) and `asr-worker` on L4 with Triton's sequence batcher: per-stream state, partials and finals.",
    "artifact": "",
    "done": [
     "`asr-gateway` decodes Opus, resamples to 16 kHz mono, applies VAD and builds 160 ms chunks with 100 ms of pre-roll; the final goes out after 600 ms of silence or at the 20 s cap.",
     "`asr-worker` uses Triton's sequence batcher with one sequence per utterance, closed at the endpoint, and `max_sequence_idle_microseconds` (1 s by default) is set against the VAD pauses.",
     "A word freezes once it ended more than 800 ms of audio ago, tentative text is shown separately and corrections at the final are counted.",
     "Each session's queues are bounded: if the model falls ≈ 2 s behind, the worker closes with 1013, and a client that does not read loses partials but never finals.",
     "`pytest` in `reference/c13` passes the 95 tests."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Course · M07 · Servidores de modelos · NVIDIA Triton Inference Server",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.triton"
     },
     {
      "label": "Sheet · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "frags-per-s-gpu",
      "label": "Chunks per second per L4 at max",
      "out": "frags_per_s_gpu",
      "expr": "streams_max_l4 * 1000 / chunk_ms",
      "unit": "chunks/s",
      "tol": 0.02,
      "why": "Sequence-batcher load: ≈ 40 steps/s of ≈ 80 chunks.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "pcm-kbps",
      "label": "PCM bitrate per stream",
      "out": "pcm_kbps",
      "expr": "sample_rate_hz * bits_per_sample / 1000",
      "unit": "kb/s",
      "tol": 0.02,
      "why": "Gateway sends PCM, not Opus: GPU does no codec work.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "pcm-gbps-peak",
      "label": "Gateway → workers, peak",
      "out": "pcm_gbps_peak",
      "expr": "streams_peak * pcm_kbps / 1e6",
      "unit": "Gb/s",
      "tol": 0.02,
      "why": "The flow that must never cross zones.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "pcm-mbps-worker",
      "label": "PCM into one worker at target",
      "out": "pcm_mbps_worker",
      "expr": "streams_max_l4 * target_util * pcm_kbps / 1000",
      "unit": "Mb/s",
      "tol": 0.02,
      "why": "Nothing for a g6.xlarge NIC: network is not the worker limit.",
      "check": null,
      "ref": "#c13.estimaciones"
     }
    ]
   },
   {
    "id": "sesion-por-pista-grpc-bidireccional",
    "base": null,
    "status": "nuevo",
    "title": "Per-Track Bidirectional gRPC Session",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "Have the SFU open one stream per participant to the `asr-gateway` (≈ 200k connected at peak), with VAD so that only tracks with speech use GPU.",
    "artifact": "",
    "done": [
     "The SFU opens one gRPC stream per track to an `asr-gateway` in its own zone, identified by `meeting_id` + `participant_id`, with language and organization.",
     "The fork is fire-and-forget: if the gateway is not receiving, the SFU drops packets and the meeting carries on unchanged.",
     "The keepalive interval is shorter than the shortest idle timeout on the path, and the client ping and the server ping policy are configured together.",
     "Only utterances with speech open a sequence on the worker: a silent track uses no GPU.",
     "The gateway keeps the current utterance (up to 20 s) to replay it if the worker dies."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.arquitectura"
     },
     {
      "label": "Course · M07 · Servidores de modelos · Protocolos: REST, gRPC, KServe v2 y OpenAI-compatible",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.protocolos"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Streaming: inferencia sobre eventos",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.streaming"
     },
     {
      "label": "Sheet · Del dato a producción · patrón streaming",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "gw-vcpu-busy",
      "label": "Gateway vCPU busy at peak",
      "out": "gw_vcpu_busy",
      "expr": "(streams_peak + vad_hangover) * gw_cpu_ms_voice / 1000 + (tracks_peak - streams_peak - vad_hangover) * gw_cpu_ms_idle / 1000",
      "unit": "vCPU",
      "tol": 0.02,
      "why": "Decode only voiced tracks; decoding all 200k would be ≈ 600 vCPU.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "gw-vcpu-planned",
      "label": "Gateway vCPU planned",
      "out": "gw_vcpu_planned",
      "expr": "ceilto(gw_vcpu_busy / rho_cpu, 10)",
      "unit": "vCPU",
      "tol": 0.02,
      "why": "HPA target 60 % on CPU for the gateway pool.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "gw-nodes",
      "label": "Gateway nodes (c6i.xlarge) at peak",
      "out": "gw_nodes",
      "expr": "ceil(gw_vcpu_planned / vcpu_node)",
      "unit": "nodes",
      "tol": 0,
      "why": "Peak node count; the pool follows the day curve (≈ 160 vCPU average).",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "session-mem-gb",
      "label": "Gateway memory for all sessions",
      "out": "session_mem_gb",
      "expr": "tracks_peak * session_kb / 1e6",
      "unit": "GB",
      "tol": 0.02,
      "why": "Spread across pods: memory is not the gateway limit.",
      "check": null,
      "ref": "#c13.estimaciones"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "igual",
    "title": "Gateway & Worker Containers",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Containerize the gateway and the worker as in C01; the worker runs as a GPU Deployment.",
    "artifact": "Dockerfiles probados (gateway y Triton)",
    "done": [
     "The `asr-worker` image is tagged with the model version and the manifest also pins it by digest.",
     "Its dependencies come from the `server/requirements.txt` lock (via `uv pip compile`), without the tests.",
     "uvicorn runs with `--ws-max-size 65536`, `--timeout-graceful-shutdown 10` and WebSocket pings every 20 s."
    ],
    "commands": [
     {
      "code": "docker build --platform linux/amd64 -t classifier-gateway:{tag} gateway/",
      "note": "On an Apple Silicon Mac `--platform` is mandatory: c6i and g4dn nodes are x86. The tag is the commit."
     },
     {
      "code": "docker build -t classifier-triton:{version_modelo} triton/",
      "note": "Fails on purpose if `model.plan` is missing: run `build_engine.sh` on the T4 first."
     },
     {
      "code": "docker compose up --build",
      "note": "From `reference/c01`: gateway, Triton with GPU and Prometheus on one machine."
     },
     {
      "code": "curl -s -H \"Content-Type: image/jpeg\" --data-binary @{foto} \"localhost:8080/v1/classify?top_k=5\"",
      "note": "The end-to-end check: top-5 with `model_version`."
     },
     {
      "code": "docker history classifier-gateway:{tag}",
      "note": "One row per layer: find the one that bloated the image."
     },
     {
      "code": "docker buildx imagetools inspect --format '{{json .Image}}' {registry}/classifier-gateway:{tag}",
      "note": "Before deploying: the config must say `\"architecture\": \"amd64\"`. Without `--format`, a single-platform image does not show its own."
     }
    ],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Course · M05 · Contenedores · Registries y tags inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.registries"
     },
     {
      "label": "Sheet · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD & Tests",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Test and build images as in C01.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "`pytest` passes the 95 tests in the four folders on every commit, without GPU, model or SFU.",
     "`promtool check rules` and `promtool test rules` pass on the 8 alerts.",
     "The manifest passes `kubernetes-validate --strict` on its core resources, and the ScaledObject and PodMonitor pass their CRD schemas.",
     "CD deploys only versions approved by the gate and registered with their L4 engine."
    ],
    "commands": [
     {
      "code": "cd reference/c01/gateway && pip install -r requirements-dev.txt && pytest",
      "note": "24 tests with no GPU or Triton: the first thing CI runs."
     },
     {
      "code": "aws ecr get-login-password --region {region} | docker login --username AWS --password-stdin {registry}",
      "note": "ECR login; the token lasts 12 h. In CI, via an OIDC-assumed role, no stored keys."
     },
     {
      "code": "docker buildx build --platform linux/amd64 -t {registry}/classifier-gateway:{sha} --push gateway/",
      "note": "Single build for the node architecture; `{sha}` is the first 7 characters of the commit: `git rev-parse --short=7 HEAD` (in CI, `${GITHUB_SHA::7}`)."
     },
     {
      "code": "crane digest {registry}/classifier-gateway:{sha}",
      "note": "The digest is the identity: it is what gets signed and deployed."
     },
     {
      "code": "cosign sign --yes {registry}/classifier-gateway@{digest}",
      "note": "Keyless signing with the CI's OIDC identity."
     },
     {
      "code": "kubectl -n classifier set image deployment/gateway gateway={registry}/classifier-gateway@{digest}",
      "note": "Deploy by digest; with GitOps that value goes in a PR to the manifests repo."
     }
    ],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Course · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Sheet · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "KEDA on Active Streams",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Scale `asr-worker` with KEDA on active streams per GPU (target 350), with a cron that raises the floor before the morning; an L4 node takes 5–13 min, and scaling down means draining (`preStop`).",
    "artifact": "",
    "done": [
     "KEDA scales `asr-worker` between 20 and 220 replicas on `sum(asr_active_streams)` (target 350 per pod) and `asr_sessions` (target 1,200), and each pod requests a whole L4.",
     "A cron trigger holds at least 120 pods Monday to Friday from 7:30 to 11:00 (central Mexico time), and if Prometheus does not answer, KEDA's fallback requests 120.",
     "It scales up fast and down by 5 pods every 5 min, with a 20 min window.",
     "`preStop` drains for up to 60 s, `terminationGracePeriodSeconds` is 90 and the PDB allows at most 5 % voluntary disruptions."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
     },
     {
      "label": "Course · M06 · Orquestación y escalado · Cold starts de punta a punta",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.cold-starts"
     },
     {
      "label": "Sheet · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "keda-target",
      "label": "KEDA target, active streams per pod",
      "out": "keda_target",
      "expr": "streams_max_l4 * target_util",
      "unit": "streams",
      "tol": 0,
      "why": "Scale on the metric that saturates, never CPU.",
      "check": null,
      "ref": "#c13.serving"
     },
     {
      "id": "stream-hard-cap",
      "label": "Hard cap, active streams per worker",
      "out": "stream_hard_cap",
      "expr": "streams_max_l4 * max_streams_frac",
      "unit": "streams",
      "tol": 0,
      "why": "Router skips workers at the cap; ASRCapacityHeadroomLow watches it.",
      "check": null,
      "ref": "#c13.serving"
     },
     {
      "id": "burst-headroom",
      "label": "On-the-hour burst headroom",
      "out": "burst_headroom",
      "expr": "(stream_hard_cap - keda_target) / keda_target",
      "unit": "fraction",
      "tol": 0.03,
      "why": "Absorbs the 09:00 burst no autoscaler can follow; the cron floor does the rest.",
      "check": null,
      "ref": "#c13.serving"
     },
     {
      "id": "drain-max-s",
      "label": "Worst-case drain per session",
      "out": "drain_max_s",
      "expr": "2 * (phrase_max_s + endpoint_s)",
      "unit": "s",
      "tol": 0.02,
      "why": "Sets preStop (60 s) and terminationGracePeriodSeconds (90 s).",
      "check": {
       "expr": "drain_max_s <= prestop_s",
       "label": "preStop covers two max-length phrases"
      },
      "ref": "#c13.serving"
     }
    ]
   },
   {
    "id": "router-de-sesiones-con-afinidad",
    "base": null,
    "status": "nuevo",
    "title": "Session Router with Affinity",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Assign each session to an `asr-worker` in its zone by counting active streams, not requests or CPU, and keep it there (sticky).",
    "artifact": "",
    "done": [
     "Each session goes to the worker in its zone that has the language and the most free session slots, skipping those whose active streams are at the cap (450).",
     "Assignment is sticky, and three missed heartbeats (one per second) mark the worker dead: its sessions are redistributed within the zone.",
     "It never assigns to draining workers and rebalances only at end of utterance.",
     "Crossing zones is only a degradation, and it is counted in a metric."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.fallas"
     },
     {
      "label": "Sheet · Del dato a producción · patrón streaming",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "voice-share",
      "label": "Voiced share of tracks",
      "out": "voice_share",
      "expr": "streams_peak / tracks_peak",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Oversubscription ratio between sessions and GPU streams.",
      "check": null,
      "ref": "#c13.serving"
     },
     {
      "id": "sessions-per-worker",
      "label": "Sessions assigned per worker",
      "out": "sessions_per_worker",
      "expr": "keda_target / voice_share",
      "unit": "sessions",
      "tol": 0.02,
      "why": "Placement count the router tracks exactly in its table.",
      "check": {
       "expr": "sessions_per_worker <= max_sessions",
       "label": "Under MAX_SESSIONS (1,500)"
      },
      "ref": "#c13.serving"
     },
     {
      "id": "streams-sd-worker",
      "label": "Std dev of active streams per worker",
      "out": "streams_sd_worker",
      "expr": "sqrt(sessions_per_worker * voice_share * (1 - voice_share))",
      "unit": "streams",
      "tol": 0.05,
      "why": "Binomial spread stays far from the 500 max: oversubscription is safe.",
      "check": null,
      "ref": "#c13.serving"
     },
     {
      "id": "cross-zone-cost-month",
      "label": "Cross-zone cost without affinity",
      "out": "cross_zone_cost",
      "expr": "pcm_gbps_peak / peak_factor * 730 * 3600 / 8 * cross_zone_share * price_xaz_gb",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "Why the router assigns in-zone and counts every cross-zone fallback.",
      "check": null,
      "ref": "#c13.estimaciones"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Canary on New Sessions",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Canary by percentage of new sessions, not requests, because each session stays pinned to its worker (sticky).",
    "artifact": "",
    "done": [
     "The approved model is loaded on a group of workers and the router sends it 5 % of its language's new sessions; existing sessions do not move.",
     "It moves to 25 %, 50 % and 100 % over days, only if `CanaryWERRegression` does not fire and usage signals do not worsen.",
     "A model A/B is randomized by meeting or organization, not by participant.",
     "Rollback returns to the previous registry version, and workers are replaced by draining."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.arquitectura"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.evaluacion"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Canary: porcentajes, tiempos y criterios para avanzar",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.canary"
     },
     {
      "label": "Sheet · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "canary-gpus",
      "label": "Canary workers at 5 % of peak streams (upper bound)",
      "out": "canary_gpus",
      "expr": "ceil(canary_share * streams_peak / keda_target)",
      "unit": "GPUs",
      "tol": 0,
      "why": "Upper bound for the canary worker group: the course canaries one language at a time.",
      "check": null,
      "ref": "#c13.arquitectura"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "cambia",
    "title": "Live Partials & Finals",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "Replace the request with one long-lived gRPC session per track: partials at p95 ≤ 500 ms and finals at p95 ≤ 1.5 s after end of utterance.",
    "artifact": "",
    "done": [
     "Partials p95 ≤ 500 ms from spoken word to screen, and finals p95 ≤ 1.5 s after end of utterance.",
     "The 500 ms are split by hop: network, chunk wait, queue, compute and delivery.",
     "If a worker dies, the gateway notices within 1 s, reopens the session on another one and replays the current utterance: ≈ 1–2 s without partials and no final lost.",
     "Partials are coalesced to at most 5 per second per stream, and only if the text changed; finals always go out."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.requisitos"
     },
     {
      "label": "Course · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Sheet · Del dato a producción · estación 11 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "chunk-wait-ms",
      "label": "Average wait for the chunk",
      "out": "chunk_wait_ms",
      "expr": "chunk_ms / 2",
      "unit": "ms",
      "tol": 0.02,
      "why": "A word ends mid-chunk on average; lookahead is inside the chunk.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "partial-typical-ms",
      "label": "Typical partial latency end to end",
      "out": "partial_typical_ms",
      "expr": "t_capture_ms + 2 * t_net_ms + t_gw_ms + chunk_wait_ms + t_queue_ms + t_step_ms + t_bus_ms + t_render_ms",
      "unit": "ms",
      "tol": 0.02,
      "why": "Splits the 500 ms across segments; server alerts use their own share.",
      "check": {
       "expr": "partial_typical_ms <= p95_partial_ms",
       "label": "Typical path inside the 500 ms p95"
      },
      "ref": "#c13.estimaciones"
     },
     {
      "id": "network-share",
      "label": "Network share of the partial latency",
      "out": "network_share",
      "expr": "2 * t_net_ms / partial_typical_ms",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Latency levers are region and chunk size, not a faster GPU.",
      "check": null,
      "ref": "#c13.estimaciones"
     }
    ]
   },
   {
    "id": "caption-bus-por-reunion",
    "base": null,
    "status": "nuevo",
    "title": "Per-Meeting Caption Bus",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Publish partials and finals from the workers to an in-memory pub/sub (NATS or Redis Pub/Sub), from which the existing WebSocket signaling pushes them to each client.",
    "artifact": "",
    "done": [
     "There is one topic per meeting in an in-memory pub/sub (NATS or Redis Pub/Sub): workers publish and signaling servers consume.",
     "Each message carries `meeting_id`, speaker, `utterance_id`, sequence number, type, and frozen and tentative text; the client replaces by `utterance_id` and drops stale sequences.",
     "The bus keeps each meeting's finals from the last 60 s for clients that reconnect.",
     "`CaptionDeliveryLag` fires when p95 delivery to signaling stays above 250 ms for 10 min.",
     "Only finals from meetings with saving enabled are copied to Kafka; otherwise the text exists only in memory."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.arquitectura"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.monitoreo"
     },
     {
      "label": "Sheet · Del dato a producción · patrón streaming",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "partial-msgs-s",
      "label": "Partials published per second, peak",
      "out": "partial_msgs_s",
      "expr": "streams_peak * partials_per_s",
      "unit": "msg/s",
      "tol": 0.02,
      "why": "Publish rate into the per-meeting pub/sub.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "fanout-msgs-s",
      "label": "Messages to clients per second",
      "out": "fanout_msgs_s",
      "expr": "partial_msgs_s * participants",
      "unit": "msg/s",
      "tol": 0.02,
      "why": "New load on the existing WebSocket signaling fleet.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "fanout-gbps",
      "label": "Bytes to clients, peak",
      "out": "fanout_gbps",
      "expr": "fanout_msgs_s * partial_bytes * 8 / 1e9",
      "unit": "Gb/s",
      "tol": 0.02,
      "why": "Why partials are batched and sent as diffs.",
      "check": null,
      "ref": "#c13.estimaciones"
     },
     {
      "id": "finals-per-s",
      "label": "Finals per second, peak",
      "out": "finals_per_s",
      "expr": "streams_peak / phrase_s",
      "unit": "msg/s",
      "tol": 0.02,
      "why": "Rate of finals to buffer (60 s per meeting) and copy to Kafka when saved.",
      "check": null,
      "ref": "#c13.estimaciones"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Per-Hop & Stream Monitoring",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Monitor per-hop latency, active streams (also the autoscaling signal), reconnects and voice ratio, with the golden canary measuring WER in production, and retrain on triggers with a quarterly review.",
    "artifact": "",
    "done": [
     "The 8 alerts pass their promtool tests, with a per-hop server budget: `CaptionPartialLatencyHigh` at 200 ms, `CaptionFinalLatencyHigh` at 1.2 s and `GPUStreamSaturation` with the model step above 128 ms.",
     "`SessionReconnectRateHigh` counts only unplanned reconnects (more than 2 % in 15 min), excluding `migrate` and the max duration.",
     "`VADActiveRatioShift` compares the voice ratio with the same hour last week (below 0.7× or above 1.3× for 1 h).",
     "Logs contain no audio or text: only ids, timings and counters.",
     "Retraining is trigger-based (a slice falling behind, a change in input audio, a better model), with a quarterly review."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.monitoreo"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Course · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Sheet · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "burn-fast-ratio",
      "label": "Fast-burn missing-caption ratio (1 h)",
      "out": "burn_fast_ratio",
      "expr": "burn_fast * (1 - slo_avail)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Missing-caption rate that pages on the SLO dashboard.",
      "check": null,
      "ref": "#m12.prometheus-grafana"
     },
     {
      "id": "step-alert-ms",
      "label": "GPUStreamSaturation step threshold",
      "out": "step_alert_ms",
      "expr": "step_alert_frac * chunk_ms",
      "unit": "ms",
      "tol": 0.02,
      "why": "A step near 160 ms is no longer real time: lag grows without bound.",
      "check": null,
      "ref": "#c13.monitoreo"
     },
     {
      "id": "gpu-no-vad",
      "label": "L4s at peak if VAD fails open",
      "out": "gpu_no_vad",
      "expr": "ceil(tracks_peak / keda_target)",
      "unit": "GPUs",
      "tol": 0,
      "why": "Why VADActiveRatioShift exists: a VAD broken upward multiplies GPU by 3.3.",
      "check": null,
      "ref": "#c13.estimaciones"
     }
    ]
   },
   {
    "id": "canary-golden-en-produccion",
    "base": null,
    "status": "nuevo",
    "title": "Production Golden Canary",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Have a bot join an internal meeting and play golden-set audio to measure end-to-end WER and latency without touching customer audio.",
    "artifact": "",
    "done": [
     "Every few minutes, per region and language, a bot joins an internal meeting and plays golden-set audio as a participant.",
     "It goes through the real path (SFU, gateway, router, worker and bus) and measures end-to-end WER and latency without touching customer audio.",
     "`CanaryWERRegression` fires if the canary version's WER exceeds the stable one's + 1 point, with ≥ 5,000 reference words over 30 min, and the rollout stops."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C13 · Speech-to-text en vivo · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.evaluacion"
     },
     {
      "label": "Course · C13 · Speech-to-text en vivo · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.monitoreo"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Canary: porcentajes, tiempos y criterios para avanzar",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.canary"
     },
     {
      "label": "Sheet · Del dato a producción · patrón streaming",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "golden-min-canary",
      "label": "Golden speech for one regression window",
      "out": "golden_min_canary",
      "expr": "canary_words / words_per_min",
      "unit": "min",
      "tol": 0.02,
      "why": "Sets bot playback so each 30 min window holds ≥ 5,000 reference words.",
      "check": null,
      "ref": "#c13.monitoreo"
     }
    ]
   }
  ],
  "edge": [
   {
    "id": "kickoff",
    "base": "kickoff",
    "status": "nuevo",
    "title": "Requirements & Capacity Plan",
    "tramo": "diseno",
    "speed": "diseno",
    "question": "",
    "note": "Fix part volume, the 350 ms hard decision deadline, the recall and FP targets and ≥ 72 h offline operation, and size the deadline budget, the per-line device and the FP budget from them.",
    "artifact": "",
    "inputs": [],
    "outputs": [],
    "done": [
     "Production is computed: 2 parts/s × 3,600 s × 16 h = 115,200 parts/day per line (≈ 576 defects at 0.5 %), 460,800/day across the 4 lines.",
     "The 350 ms deadline is split by stage: ≈ 50 ms acquisition, ≈ 20 ms preprocessing, ≤ 120 ms inference, ≈ 10 ms PLC write; ≈ 200 ms expected path with 150 ms of margin.",
     "One Jetson Orin NX 16 GB per line, sized for the deterministic latency of a single inference (≈ 24 % GPU occupancy), not for throughput.",
     "The FP budget comes from inspector capacity: hard cap ≈ 2.8 %, target ≤ 1.5 % (inspector at ≈ 60 %), with recall ≥ 99.5 % per defect type."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.requisitos"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.estimaciones"
     },
     {
      "label": "Sheet · Formulario de estimaciones · C01 sizing chain",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/"
     }
    ],
    "calcs": [
     {
      "id": "pieces-day-line",
      "label": "Pieces per line per day",
      "out": "pieces_day_line",
      "expr": "pieces_per_s * 3600 * shift_h * n_shifts",
      "unit": "pieces/day",
      "tol": 0.02,
      "why": "The line is a clock: design per piece period, not for a QPS peak.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "defects-day-line",
      "label": "Defects per line per day",
      "out": "defects_day_line",
      "expr": "pieces_day_line * defect_rate",
      "unit": "defects/day",
      "tol": 0.02,
      "why": "Bounds escapes and the label flow.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "decision-deadline-ms",
      "label": "Decision deadline after trigger",
      "out": "decision_deadline_ms",
      "expr": "cam_gate_m / belt_mps * 1000 - plc_ms",
      "unit": "ms",
      "tol": 0.02,
      "why": "Hard budget for camera + model + write; PLC owns the last 150 ms.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "path-typical-ms",
      "label": "Typical loop path",
      "out": "path_typical_ms",
      "expr": "t_acq_ms + t_pre_ms + t_inf_ms + t_plc_ms",
      "unit": "ms",
      "tol": 0.02,
      "why": "Typical case uses ≈ 60 % of the deadline; the rest is for the tail.",
      "check": {
       "expr": "path_typical_ms <= 0.6 * decision_deadline_ms",
       "label": "Typical path within ≈ 60 % of the deadline"
      },
      "ref": "#c03.estimaciones"
     },
     {
      "id": "deadline-margin-ms",
      "label": "Margin for the tail",
      "out": "deadline_margin_ms",
      "expr": "decision_deadline_ms - path_typical_ms",
      "unit": "ms",
      "tol": 0.02,
      "why": "Absorbs thermal throttling, Python pauses and GigE resends.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "gpu-occupancy",
      "label": "Jetson GPU occupancy per line",
      "out": "gpu_occupancy",
      "expr": "pieces_per_s * t_inf_ms / 1000",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Sized for deterministic latency, not throughput: one device per line.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "inspector-capacity-day",
      "label": "Inspector re-inspection capacity",
      "out": "inspector_capacity_day",
      "expr": "3600 / inspect_s * shift_h * n_shifts",
      "unit": "pieces/day",
      "tol": 0.02,
      "why": "Capacity, not re-inspection cost, sets the FP budget.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "fp-hard-budget",
      "label": "Hard false-positive budget",
      "out": "fp_hard_budget",
      "expr": "(inspector_capacity_day - defects_day_line) / pieces_day_line",
      "unit": "fraction",
      "tol": 0.02,
      "why": "Ceiling the threshold tool may never cross.",
      "check": {
       "expr": "fp_target <= fp_hard_budget",
       "label": "FP target under the inspector-capacity ceiling"
      },
      "ref": "#c03.estimaciones"
     },
     {
      "id": "diverted-day-line",
      "label": "Diverted pieces per line per day",
      "out": "diverted_day_line",
      "expr": "fp_target * (pieces_day_line - defects_day_line) + defects_day_line * recall_target",
      "unit": "pieces/day",
      "tol": 0.02,
      "why": "Bin load and the image volume to store.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "inspector-load",
      "label": "Inspector load at the FP target",
      "out": "inspector_load",
      "expr": "diverted_day_line / inspector_capacity_day",
      "unit": "fraction",
      "tol": 0.02,
      "why": "At ≈ 60 % the inspector absorbs variation; at 2.8 % FP it would be ≈ 100 %.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "uplink-if-cloud-mbps",
      "label": "Uplink if the plant inferred in the cloud",
      "out": "uplink_cloud_mbps",
      "expr": "n_lines * pieces_per_s * img_w_px * img_h_px * 8 / 1e6",
      "unit": "Mb/s",
      "tol": 0.02,
      "why": "Sustained 320 Mb/s on a link that drops rules out cloud inference.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "cost-month",
      "label": "Hardware amortized + cloud",
      "out": "cost_month",
      "expr": "hw_capex_usd / amort_months + cloud_month",
      "unit": "US$/month",
      "tol": 0.02,
      "why": "The business case is escapes avoided, not cost per prediction.",
      "check": {
       "expr": "cost_month <= incident_min_usd",
       "label": "One avoided escape a month pays for it"
      },
      "ref": "#c03.costo"
     }
    ]
   },
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Line Images & Verdicts",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Collect images from the line camera and label them with the inspector's tablet verdict, the cheapest label, starting from ≈ 2,000 good parts and ≈ 300 defects.",
    "artifact": "",
    "done": [
     "Line 1 shadow collects images with the production camera and strobe; at the start there are ≈ 2,000 good parts and ≈ 300 defects.",
     "The inspector labels each diverted part on the tablet with one tap: good, one of the 4 types, or other.",
     "Quality reviews all disagreements and ≈ 5 % of verdicts, and on ≈ 10 % the tablet hides the reason to measure anchoring.",
     "Line images are filtered (high-score ones removed, with an audited sample) before entering the good-parts set.",
     "1 % of passed parts, near-rejects and every escape the OEM reports are also collected."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Course · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ],
    "inputs": [
     "line camera images",
     "inspector tablet verdicts"
    ],
    "outputs": [],
    "calcs": [
     {
      "id": "mm-per-px",
      "label": "Resolution on the part",
      "out": "mm_per_px",
      "expr": "fov_mm / img_w_px",
      "unit": "mm/px",
      "tol": 0.02,
      "why": "Picks camera and lens before any model choice.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "exposure-us",
      "label": "Max exposure for ≤ 1 px motion blur",
      "out": "exposure_us",
      "expr": "mm_per_px / (belt_mps * 1000) * 1e6",
      "unit": "µs",
      "tol": 0.03,
      "why": "Global shutter + synchronized strobe, not ambient light.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "approved-sample-day",
      "label": "Approved-piece sample per line",
      "out": "approved_sample_day",
      "expr": "pieces_day_line * approved_share",
      "unit": "images/day",
      "tol": 0.02,
      "why": "Escape-hunting sample and clean \"good\" data for the anomaly model.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "label-min-day",
      "label": "Inspector labeling time per line",
      "out": "label_min_day",
      "expr": "diverted_day_line * label_s / 60",
      "unit": "min/day",
      "tol": 0.02,
      "why": "The cheapest label: one tap on a piece already being inspected.",
      "check": null,
      "ref": "#c03.datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "igual",
    "title": "Snapshots, Golden Sets & Lineage",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Keep immutable snapshots in S3, frozen golden sets per defect type, and part ↔ image ↔ model ↔ decision lineage.",
    "artifact": "snapshot ds-2026-09-01 (manifest inmutable)",
    "done": [
     "Each label batch produces a snapshot with a manifest (image hash, label, label source and version) and an immutable id in S3.",
     "Per-defect-type golden sets are frozen, never enter training, and are built from defects that did not pass through the model's filter.",
     "Each decision is an immutable record with `decision` and `model_decision`, model version and thresholds, scores, latency and PLC ack.",
     "Labels are events with author and time: never overwritten, corrected with a new one."
    ],
    "commands": [
     {
      "code": "aws s3 ls s3://{bucket}/datasets/{snapshot_id}/",
      "note": "List what is under a snapshot prefix (read-only)."
     },
     {
      "code": "dvc add {carpeta_datos} && dvc push",
      "note": "If the team already uses DVC: hashes the folder, leaves `{carpeta_datos}.dvc` for git and pushes the data to the S3 remote."
     },
     {
      "code": "lakectl branch create lakefs://{repo}/{rama} -s lakefs://{repo}/main",
      "note": "If you use lakeFS: an isolated branch over the bucket, no data copied; then `lakectl commit` and `lakectl merge`."
     }
    ],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Course · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Sheet · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "records-mb-day",
      "label": "Decision records per line",
      "out": "records_mb_day",
      "expr": "pieces_day_line * record_bytes / 1e6",
      "unit": "MB/day",
      "tol": 0.02,
      "why": "Immutable lineage for every piece is cheap; keep it all.",
      "check": null,
      "ref": "#c03.estimaciones"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Cloud Training",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Train in an on-demand cloud GPU job — anomaly detection on good parts and, once there are enough defects, a per-type classifier — monthly or on trigger.",
    "artifact": "",
    "done": [
     "An on-demand cloud GPU job trains the anomaly model on good parts and, once there are hundreds of defects per type, the classifier.",
     "The run is reproducible: data snapshot, commit and container by digest.",
     "It uses the same preprocessing (crop, normalization and tiles) that runs on the Jetson.",
     "The split is by time or by lot, never random."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Course · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
     },
     {
      "label": "Course · M09 · Datos y features · Training-serving skew: causas, detección y prevención",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.skew"
     },
     {
      "label": "Sheet · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Per-Type Recall & Threshold",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Gate on per-defect-type recall at fixed FP on the golden sets, and pick the threshold by expected cost with recall ≥ 99.5 % (`choose_threshold.py`).",
    "artifact": "",
    "done": [
     "Per-defect-type recall is measured at fixed FP on the golden sets, with slices by part variant, line and camera, shift and lot.",
     "`choose_threshold.py` picks the threshold with recall ≥ 99.5 % per type, a 1.5 % FP target and a hard cap of ≈ 2.85 %; if no threshold qualifies, it exits with an error.",
     "With the classifier, each head gets its share of the FP budget (`--target-fp-rate 0.003 --max-fp-rate 0.0057`), and the combination is verified ≤ 1.5 % before writing `config.yaml`.",
     "Recall is reported with its Clopper-Pearson bound: claiming 99.5 % requires ≈ 600 real defects per type with no misses.",
     "If any type does not reach 99.5 %, nothing is built."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.evaluacion"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Course · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Sheet · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "defects-needed-type",
      "label": "Defects per type to claim the recall",
      "out": "defects_needed_type",
      "expr": "round(3 / (1 - recall_target))",
      "unit": "defects",
      "tol": 0,
      "why": "Rule of three: 0 misses in n proves ≥ 1 − 3/n at 95 %.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "recall-one-miss",
      "label": "Recall with one miss in today's set",
      "out": "recall_one_miss",
      "expr": "(defects_pilot / n_defect_types - 1) / (defects_pilot / n_defect_types)",
      "unit": "fraction",
      "tol": 0.02,
      "why": "The pilot set cannot prove 99.5 %: collect in shadow first.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "escapes-day-line",
      "label": "Escapes per line per day at target",
      "out": "escapes_day_line",
      "expr": "defects_day_line * (1 - recall_target)",
      "unit": "escapes/day",
      "tol": 0.02,
      "why": "FN cost dominates at every operating point.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "ppm-shipped",
      "label": "Defective PPM shipped",
      "out": "ppm_shipped",
      "expr": "defect_rate * (1 - recall_target) * 1e6",
      "unit": "PPM",
      "tol": 0.02,
      "why": "The automaker's scorecard number.",
      "check": null,
      "ref": "#c03.estimaciones"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "cambia",
    "title": "Engine on Identical Jetson",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Build the engine on a CI Jetson identical to the line devices (same module, JetPack and power mode), with parity against the ONNX and fixed-batch latency.",
    "artifact": "",
    "done": [
     "The TensorRT FP16 engine is built with `build_engine_jetson.sh` on an Orin NX with the same module, JetPack and power mode as the line.",
     "The script checks the mode with `EXPECTED_POWER_MODE` and outputs the `.plan`, the trtexec log and a JSON with the sha256 of the ONNX and of the plan.",
     "The shape is fixed: a batch of 20 tiles of 512 × 512 and a single profile.",
     "Parity against the ONNX passes, and fixed-batch inference fits in ≤ 120 ms measured with trtexec.",
     "Start with FP16; INT8 only if FP16 does not fit, calibrating with defects included."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.archivos"
     },
     {
      "label": "Course · M08 · Optimización de modelos · TensorRT",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
     },
     {
      "label": "Sheet · Del dato a producción · estación 5 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "crack-px",
      "label": "Crack width in pixels",
      "out": "crack_px",
      "expr": "crack_mm / mm_per_px",
      "unit": "px",
      "tol": 0.02,
      "why": "Full resolution in tiles; if too thin, fix optics, not the model.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "crack-px-downscaled",
      "label": "Crack width if downscaled to 1,024 px",
      "out": "crack_px_down",
      "expr": "crack_mm / (fov_mm / downscale_px)",
      "unit": "px",
      "tol": 0.03,
      "why": "Why the image is never resized: the crack vanishes.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "tiles-per-image",
      "label": "Tiles per image (fixed batch)",
      "out": "tiles_per_image",
      "expr": "ceil(img_w_px / tile_px) * ceil(img_h_px / tile_px)",
      "unit": "tiles",
      "tol": 0,
      "why": "Fixed engine shape: one profile, batch = tiles.",
      "check": null,
      "ref": "#c03.estimaciones"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "Jetson Inspection Loop",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Run a single process on the Jetson Orin NX that acquires the image, builds 20 tiles, runs TensorRT FP16 and writes to the PLC over Modbus TCP, with a deadline guard that writes `DIVERT` when time runs out.",
    "artifact": "",
    "done": [
     "`app.py` measures the deadline from the trigger (trigger + 350 ms) and consumes each trigger's frame even if it arrives late.",
     "`decide()` returns REJECT if any score is ≥ its threshold; a NaN, a score outside [0, 1] or a missing type is DIVERT, never PASS.",
     "If less than ≈ 140 ms remain after the capture, immediate DIVERT; if the 50 ms write does not fit, nothing is written.",
     "A dark image yields `bad_image` (DIVERT), and the watchdog kills the process after 30 s without progress.",
     "The inspector's 62 tests and the threshold tool's 20 pass."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.archivos"
     },
     {
      "label": "Course · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Sheet · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ],
    "inputs": [],
    "outputs": [
     "PASS / REJECT / DIVERT decision written to the PLC"
    ],
    "calcs": [
     {
      "id": "image-mb",
      "label": "Raw image size (mono 8-bit)",
      "out": "image_mb",
      "expr": "img_w_px * img_h_px / 1e6",
      "unit": "MB",
      "tol": 0.02,
      "why": "Per-piece buffer and storage unit.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "gige-transfer-ms",
      "label": "GigE transfer per image",
      "out": "gige_transfer_ms",
      "expr": "image_mb / gige_mbyte_s * 1000",
      "unit": "ms",
      "tol": 0.02,
      "why": "Almost all of acquisition: dedicated NIC with jumbo frames.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "divert-cutoff-ms",
      "label": "Latest frame arrival before an immediate DIVERT",
      "out": "divert_cutoff_ms",
      "expr": "decision_deadline_ms - t_pre_ms - t_inf_ms - write_reserve_ms",
      "unit": "ms",
      "tol": 0.02,
      "why": "Deadline-guard threshold in app.py: skip inference, keep up with the next piece.",
      "check": {
       "expr": "t_acq_ms <= divert_cutoff_ms",
       "label": "Normal acquisition lands before the cutoff"
      },
      "ref": "#c03.serving"
     },
     {
      "id": "shared-jetson-path-ms",
      "label": "Typical path if two lines shared a Jetson",
      "out": "shared_path_ms",
      "expr": "path_typical_ms + t_inf_ms",
      "unit": "ms",
      "tol": 0.02,
      "why": "Leaves ≈ 30 ms for the tail: one device per line.",
      "check": null,
      "ref": "#c03.estimaciones"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "cambia",
    "title": "arm64 Image with Compose",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Build an arm64 image on `l4t-tensorrt` run with `docker compose` (`runtime: nvidia`, host network), with engines mounted separately so the previous one can be restored without network.",
    "artifact": "",
    "done": [
     "The image starts from `nvcr.io/nvidia/l4t-tensorrt:r10.3.0-runtime`, with the same TensorRT as JetPack 6.2.x, and runs as a non-root user.",
     "`docker-compose.yml` uses `runtime: nvidia`, `network_mode: host`, `restart: unless-stopped`, `read_only: true` and `cap_drop: ALL`.",
     "`config.yaml` and `/opt/inspector/models` are mounted read-only: the engine is not inside the image.",
     "The healthcheck reads the heartbeat (reports, does not restart) and logs rotate at 50 MB × 5 files."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.archivos"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Course · M05 · Contenedores · GPUs dentro del contenedor: NVIDIA Container Toolkit",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.gpu-en-contenedor"
     },
     {
      "label": "Sheet · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "cambia",
    "title": "Signed Release with Plan",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Register every version signed (ONNX, engine per module and JetPack, thresholds and container) together with its per-line rollout plan.",
    "artifact": "",
    "done": [
     "Each version is registered signed: ONNX, engine per module and JetPack, per-type thresholds, container by digest and gate metrics.",
     "It carries its rollout plan: line 1 in shadow for one shift, line 1 canary, the 4 lines and then the other plants.",
     "`choose_threshold.py` works as a CI gate: without a threshold that meets recall and cap, the pipeline fails.",
     "The inspector and threshold-tool tests pass on Python 3.10, JetPack 6's version."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.arquitectura"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.evaluacion"
     },
     {
      "label": "Course · M15 · Seguridad y confiabilidad · Supply chain: imágenes, dependencias y pesos verificados",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.supply-chain"
     },
     {
      "label": "Sheet · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ],
    "inputs": [],
    "outputs": [
     "signed release with its rollout plan"
    ],
    "calcs": []
   },
   {
    "id": "ota-por-la-dmz",
    "base": null,
    "status": "nuevo",
    "title": "OTA via the DMZ",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "Have the DMZ pull signed artifacts over outbound connections, verify the signature and copy them to a local registry on the OT network, so devices never reach the internet.",
    "artifact": "",
    "done": [
     "The DMZ gateway downloads over outbound connections, verifies the signature and copies the artifacts to the local registry on the OT network.",
     "Devices download only from the local registry and never reach the internet.",
     "Updates go in during the nightly window and, if there is no link, they wait."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.arquitectura"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Edge / on-device",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.edge"
     },
     {
      "label": "Sheet · Del dato a producción · patrón edge",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
     }
    ],
    "inputs": [
     "signed artifacts"
    ],
    "outputs": [
     "artifacts in the local OT registry"
    ],
    "calcs": []
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Per-Line Shadow & Canary",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Roll out per line: overnight the engine lands in slot B with a smoke test, line 1 runs one shift in shadow, then canary and all 4 lines, with local rollback and no network needed.",
    "artifact": "",
    "done": [
     "Overnight the new engine lands in slot B, next to the current one, and passes a smoke test with golden-part images.",
     "Line 1 runs a full shift in shadow: the challenger only logs, after the champion has written to the PLC.",
     "It advances only if it misses no defect the champion caught, does not raise FPs and has zero deadline misses; quality reviews all disagreements.",
     "Then line 1 decides for several shifts (canary), followed by one wave per line.",
     "Rollback is local and takes minutes: `config.yaml` points back to the previous engine and the container restarts, without network."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.evaluacion"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Course · M11 · Despliegue seguro · Rollback: criterios automáticos y qué guardar para volver",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.rollback"
     },
     {
      "label": "Sheet · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "shadow-pieces-shift",
      "label": "Pieces in one shadow shift (line 1)",
      "out": "shadow_pieces_shift",
      "expr": "pieces_per_s * 3600 * shift_h",
      "unit": "pieces",
      "tol": 0.02,
      "why": "Sample the challenger logs before it may decide on line 1.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "shadow-defects-shift",
      "label": "Defects expected in one shadow shift",
      "out": "shadow_defects_shift",
      "expr": "shadow_pieces_shift * defect_rate",
      "unit": "defects",
      "tol": 0.02,
      "why": "Defects the shadow shift compares: promotion needs none lost vs the champion.",
      "check": null,
      "ref": "#c03.estimaciones"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "cambia",
    "title": "Part Decided in 350 ms",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "Decide each part within a 350 ms deadline from a hardware photocell trigger (2 parts per second per line), with no HTTP in the path.",
    "artifact": "",
    "done": [
     "The photocell triggers the camera in hardware and the PLC assigns the sequence number; within ≈ 50 ms the image is in Jetson memory.",
     "Loop p99.9 stays ≤ 350 ms over full shifts, with the enclosure closed.",
     "The decision goes out as `[part_id, código]` in a single Modbus TCP write, with no retries.",
     "The shape is fixed, there is no dynamic batching, the power mode is fixed and `jetson_clocks` is applied on every boot.",
     "`inspection_latency_seconds` has a bucket at 0.35 s, and `inspection_deadline_miss_total` stays ≈ 0."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.estimaciones"
     },
     {
      "label": "Course · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Sheet · Del dato a producción · estación 11 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "piece-period-ms",
      "label": "Time between pieces",
      "out": "piece_period_ms",
      "expr": "1000 / pieces_per_s",
      "unit": "ms",
      "tol": 0.02,
      "why": "No dynamic batching: batching two pieces means waiting 500 ms.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "camera-link-mbps",
      "label": "Camera → Jetson average per line",
      "out": "camera_link_mbps",
      "expr": "pieces_per_s * image_mb * 8",
      "unit": "Mb/s",
      "tol": 0.02,
      "why": "Dedicated camera port, separate from the PLC network.",
      "check": null,
      "ref": "#c03.estimaciones"
     }
    ]
   },
   {
    "id": "plc-con-default-seguro",
    "base": null,
    "status": "nuevo",
    "title": "PLC Safe Default",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Have the PLC pass a part only if a PASS with its number arrived before the deadline, so a dead Jetson, a dead network or a late decision all end the same way: diverted.",
    "artifact": "",
    "done": [
     "The PLC diverts every part without a valid PASS for its `part_id` before the deadline: code 0, no decision, means divert.",
     "The PLC resets the register to 0 after using a decision, because the 16-bit `part_id` repeats every 65,536 parts.",
     "A chute sensor confirms each diverted part; without confirmation, with low air pressure or with the bin full, the PLC stops the line and lights the andon.",
     "Jetson down, network down or a late decision all end the same: the part is diverted."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.fallas"
     },
     {
      "label": "Course · M15 · Seguridad y confiabilidad · Degradación con gracia: contener la falla",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.degradacion"
     },
     {
      "label": "Sheet · Del dato a producción · patrón edge",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "part-id-wrap-h",
      "label": "part_id wrap-around time",
      "out": "part_id_wrap_h",
      "expr": "part_id_space / pieces_per_s / 3600",
      "unit": "h",
      "tol": 0.02,
      "why": "PLC clears the register after use so a stale PASS never matches.",
      "check": null,
      "ref": "#c03.archivos"
     },
     {
      "id": "divert-all-per-h",
      "label": "Pieces diverted per hour with Jetson or PLC link down",
      "out": "divert_all_per_h",
      "expr": "pieces_per_s * 3600",
      "unit": "pieces/h",
      "tol": 0.02,
      "why": "Fail-safe default means the line effectively stops: page immediately.",
      "check": null,
      "ref": "#c03.monitoreo"
     },
     {
      "id": "inspector-per-h",
      "label": "Inspector capacity per hour",
      "out": "inspector_per_h",
      "expr": "3600 / inspect_s",
      "unit": "pieces/h",
      "tol": 0.02,
      "why": "What a divert-all can be compared against: 30× over.",
      "check": null,
      "ref": "#c03.serving"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Local Prometheus & Andon",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Run Prometheus and the andon in the plant because there may be no internet, shipping heartbeats and aggregates to the cloud; a reject rate above 2× its baseline for 30 min most likely means light, lens or focus, not defects.",
    "artifact": "",
    "done": [
     "`app.py` exports its 7 metrics with series at 0 from startup, and DIVERTs are counted by their 10 reasons.",
     "Paging alerts are evaluated in the plant's Prometheus and Alertmanager, and reach the andon and the maintenance tablet.",
     "`RejectRateSpike` fires with REJECTs above 2× their 7-day baseline for 30 min, without mixing in DIVERTs.",
     "`AnomalyScoreDrift` compares the last hour's median against the 7-day one + 0.1, for 2 h.",
     "Cloud `DeviceOffline` alerts only during shift hours and if the plant gateway is reporting; if the gateway is missing, it is a single link ticket."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.monitoreo"
     },
     {
      "label": "Course · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Sheet · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": [
     {
      "id": "pieces-over-p99-day",
      "label": "Pieces above a p99 per line-day",
      "out": "pieces_over_p99",
      "expr": "pieces_day_line * (1 - p_target)",
      "unit": "pieces/day",
      "tol": 0.02,
      "why": "SLO is deadline misses ≈ 0 plus p99.9 and max per shift, not p99.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "divert-alert-rate",
      "label": "Error-DIVERT alert threshold",
      "out": "divert_alert_rate",
      "expr": "divert_alert_frac * pieces_per_s",
      "unit": "pieces/s",
      "tol": 0.02,
      "why": "rate() threshold for camera, image and engine DIVERT reasons.",
      "check": null,
      "ref": "#c03.monitoreo"
     },
     {
      "id": "spike-load-per-h",
      "label": "Inspector load per hour in a 2× reject spike",
      "out": "spike_load_per_h",
      "expr": "reject_spike * diverted_day_line / (shift_h * n_shifts)",
      "unit": "pieces/h",
      "tol": 0.02,
      "why": "RejectRateSpike means light, lens or focus: the bin overflows.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "backlog-growth-per-h",
      "label": "Bin backlog growth in the spike",
      "out": "backlog_growth_per_h",
      "expr": "spike_load_per_h - inspector_per_h",
      "unit": "pieces/h",
      "tol": 0.02,
      "why": "Time to act before someone returns parts unchecked.",
      "check": null,
      "ref": "#c03.estimaciones"
     }
    ]
   },
   {
    "id": "store-and-forward-a-la-nube",
    "base": null,
    "status": "nuevo",
    "title": "Store-and-Forward to Cloud",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Hold decisions, reject images and verdicts in the plant store and upload them when the link is up, so the line runs ≥ 72 h without internet.",
    "artifact": "",
    "done": [
     "The plant store keeps decision records, reject images, the passed-part sample and verdicts, and the line runs ≥ 72 h without internet.",
     "Upload is idempotent (each record with an id, each image named by its hash) and resumes where it left off.",
     "Records and verdicts upload first, then rejects and finally the sample, with a bandwidth cap during shifts.",
     "The store holds weeks (≈ 69 GB/day) and sync lag is measured.",
     "With the disk full, what is already synced is dropped first; decision records never."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.fallas"
     },
     {
      "label": "Course · M02 · Patrones de inferencia · Edge / on-device",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.edge"
     },
     {
      "label": "Sheet · Del dato a producción · patrón edge",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
     }
    ],
    "inputs": [
     "decision records, reject images and verdicts"
    ],
    "outputs": [
     "data synced to the cloud"
    ],
    "calcs": [
     {
      "id": "store-gb-day-line",
      "label": "Local data per line per day",
      "out": "store_gb_day_line",
      "expr": "(diverted_day_line + approved_sample_day) * image_mb / 1000 + records_mb_day / 1000",
      "unit": "GB/day",
      "tol": 0.02,
      "why": "Rejected images + 1 % sample + records, uncompressed.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "buffer-72h-gb",
      "label": "Buffer for 72 h offline per line",
      "out": "buffer_72h_gb",
      "expr": "store_gb_day_line * offline_h / 24",
      "unit": "GB",
      "tol": 0.02,
      "why": "Fits the device NVMe; the plant server keeps weeks.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "plant-upload-mbps",
      "label": "Plant upload, 24 h average",
      "out": "plant_upload_mbps",
      "expr": "n_lines * store_gb_day_line * 8000 / 86400",
      "unit": "Mb/s",
      "tol": 0.02,
      "why": "Steady upload volume ≈ 69 GB/day: bandwidth-capped during shifts.",
      "check": null,
      "ref": "#c03.estimaciones"
     },
     {
      "id": "catchup-h",
      "label": "Catch-up after 72 h without link",
      "out": "catchup_h",
      "expr": "n_lines * buffer_72h_gb * 8000 / (link_free_mbps - plant_upload_mbps) / 3600",
      "unit": "h",
      "tol": 0.02,
      "why": "How long the cloud lags after an outage; records upload first.",
      "check": null,
      "ref": "#c03.estimaciones"
     }
    ]
   },
   {
    "id": "piezas-patron-en-cada-turno",
    "base": null,
    "status": "nuevo",
    "title": "Golden Parts Every Shift",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Start every shift with known good and defective parts and give no part a PASS until that check passes, catching a dirty lens, a shifted focus or degraded light before production.",
    "artifact": "",
    "done": [
     "Each shift starts with the station's golden parts (2 good and 1 of each defect type), with the line in golden mode.",
     "Defective parts are rejected and good ones pass at least 0.15 below the anomaly threshold.",
     "Until the check passes in that process, no part gets PASS, and the approval expires at the start of the next shift.",
     "`GoldenPartCheckFailed` fires with `golden_part_check_ok == 0` for 10 min during shift hours.",
     "Each bad golden part must be confirmed in the bin: this also tests the chute sensor."
    ],
    "commands": [],
    "links": [
     {
      "label": "Course · C03 · Inspección visual en planta · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.monitoreo"
     },
     {
      "label": "Course · C03 · Inspección visual en planta · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.archivos"
     },
     {
      "label": "Sheet · Del dato a producción · patrón edge",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
     }
    ],
    "inputs": [],
    "outputs": [],
    "calcs": []
   }
  ]
 },
 "VARS": {
  "sincrono": [
   {
    "id": "n_day",
    "label": "Requests per day",
    "unit": "req/day",
    "kind": "requirement",
    "source": "C01 · Aclaración: 10 M imágenes/día, una imagen por request",
    "ref": "10000000"
   },
   {
    "id": "peak_factor",
    "label": "Diurnal peak factor",
    "unit": "×",
    "kind": "assumption",
    "source": "C01 · Aclaración: pico diurno ≈ 3× el promedio",
    "ref": "3"
   },
   {
    "id": "margin",
    "label": "Spike and growth margin",
    "unit": "×",
    "kind": "assumption",
    "source": "C01 · Estimaciones: 350 × ≈ 1.4 (spikes, crecimiento) → 500 req/s",
    "ref": "1.4"
   },
   {
    "id": "n_az",
    "label": "Availability zones",
    "unit": "AZ",
    "kind": "requirement",
    "source": "C01 · Aclaración: una región (us-east-1), dos zonas de disponibilidad",
    "ref": "2"
   },
   {
    "id": "gpu_max_tput",
    "label": "Measured max per T4 (TensorRT FP16, Triton)",
    "unit": "img/s",
    "kind": "benchmark",
    "source": "C01 · Estimaciones: perf_analyzer con batch dinámico ≤ 32 → ≈ 1,200 img/s",
    "ref": "1200"
   },
   {
    "id": "target_util",
    "label": "Planned GPU utilization",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C01 · Estimaciones: capacidad planeada ≈ 50 % del máximo medido (600 img/s)",
    "ref": "0.5"
   },
   {
    "id": "cpu_ms_per_req",
    "label": "Gateway CPU per image",
    "unit": "ms",
    "kind": "benchmark",
    "source": "C01 · Estimaciones: CPU por imagen ≈ 6 ms (mezcla móvil/web, draft mode)",
    "ref": "6"
   },
   {
    "id": "hpa_target",
    "label": "Gateway HPA CPU target",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C01 · Estimaciones: objetivo de HPA al 60 %",
    "ref": "0.6"
   },
   {
    "id": "vcpu_per_node",
    "label": "vCPU per gateway node (c6i.xlarge)",
    "unit": "vCPU",
    "kind": "benchmark",
    "source": "C01 · Estimaciones: 2 × c6i.xlarge = 8 vCPU",
    "ref": "4"
   },
   {
    "id": "req_bytes",
    "label": "Bytes per request to Triton (FP32 tensor)",
    "unit": "B",
    "kind": "assumption",
    "source": "C01 · Estimaciones: tensor FP32 por imagen 3 × 224 × 224 × 4 B ≈ 602 KB",
    "ref": "602112"
   },
   {
    "id": "node_baseline_gbps",
    "label": "Gateway node sustained network baseline",
    "unit": "Gb/s",
    "kind": "benchmark",
    "source": "C01 · Estimaciones: c6i.xlarge baseline ≈ 1.56 Gb/s",
    "ref": "1.56"
   },
   {
    "id": "price_gpu_h",
    "label": "g4dn.xlarge (T4) on-demand",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C01 · Costo: 2 × US$0.526/h × 730",
    "ref": "0.526"
   },
   {
    "id": "price_node_h",
    "label": "c6i.xlarge on-demand",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C01 · Costo: 2 × US$0.17/h × 730",
    "ref": "0.17"
   },
   {
    "id": "price_alb_h",
    "label": "ALB hourly charge",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C01 · Estimaciones: ALB US$0.0225/h × 730",
    "ref": "0.0225"
   },
   {
    "id": "price_lcu_gb",
    "label": "ALB LCU price per GB processed",
    "unit": "US$/GB",
    "kind": "assumption",
    "source": "C01 · Estimaciones: 1 LCU = 1 GB/h hacia targets IP, US$0.008",
    "ref": "0.008"
   },
   {
    "id": "upload_kb",
    "label": "Image bytes through the ALB",
    "unit": "KB",
    "kind": "assumption",
    "source": "C01 · Estimaciones: supone ≈ 200 KB por imagen (≈ 2 TB/día)",
    "ref": "200"
   },
   {
    "id": "bill_days",
    "label": "Days per billing month",
    "unit": "days",
    "kind": "assumption",
    "source": "C01 · Costo: predicciones al mes 10 M × 30.4",
    "ref": "30.4"
   },
   {
    "id": "cost_eks_month",
    "label": "EKS control plane",
    "unit": "US$/month",
    "kind": "assumption",
    "source": "C01 · Costo: US$0.10/h × 730 ≈ US$73",
    "ref": "73"
   },
   {
    "id": "cost_obs_month",
    "label": "Logs, metrics, S3",
    "unit": "US$/month",
    "kind": "assumption",
    "source": "C01 · Costo: logs, métricas, S3 ≈ US$100",
    "ref": "100"
   },
   {
    "id": "budget_month",
    "label": "Infra budget",
    "unit": "US$/month",
    "kind": "requirement",
    "source": "C01 · Aclaración: ≈ US$3,000/mes de infraestructura",
    "ref": "3000"
   },
   {
    "id": "slo",
    "label": "Availability SLO (30 days)",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C01 · Requisitos: 99.9 % mensual (≈ 43 min/mes)",
    "ref": "0.999"
   },
   {
    "id": "log_bytes",
    "label": "Prediction log line",
    "unit": "B",
    "kind": "assumption",
    "source": "C01 · Estimaciones: log de predicción ≈ 300 B",
    "ref": "300"
   },
   {
    "id": "label_per_month",
    "label": "Human labeling queue",
    "unit": "img/month",
    "kind": "requirement",
    "source": "C01 · Datos: ≈ 5k imágenes/mes en la cola de etiquetado",
    "ref": "5000"
   },
   {
    "id": "label_img_kb",
    "label": "Copied image for labeling",
    "unit": "KB",
    "kind": "assumption",
    "source": "C01 · Estimaciones: ≈ 5k/mes × ≈ 250 KB",
    "ref": "250"
   },
   {
    "id": "price_label",
    "label": "Human label price (upper)",
    "unit": "US$/img",
    "kind": "assumption",
    "source": "C01 · Datos: ≈ 5k imágenes/mes a US$0.05–0.10 cada una",
    "ref": "0.1"
   },
   {
    "id": "train_images",
    "label": "Images in the training snapshot",
    "unit": "img",
    "kind": "assumption",
    "source": "M09 · Versionado: imágenes del training set ≈ 2 M (c01)",
    "ref": "2000000"
   },
   {
    "id": "snap_img_kb",
    "label": "Referenced image size",
    "unit": "KB",
    "kind": "assumption",
    "source": "M09 · Versionado: 2 M × ≈ 200 KB",
    "ref": "200"
   },
   {
    "id": "manifest_row_b",
    "label": "Manifest row (hash, path, label, source, seller, date)",
    "unit": "B",
    "kind": "assumption",
    "source": "M09 · Versionado: ≈ 200 B por fila, sin comprimir",
    "ref": "200"
   },
   {
    "id": "n_params",
    "label": "ResNet-50 params (500-class head)",
    "unit": "params",
    "kind": "requirement",
    "source": "C01 · Aclaración: 24.5 M parámetros con la capa final de 500 clases",
    "ref": "24500000"
   },
   {
    "id": "bytes_fp32",
    "label": "Bytes per FP32 value",
    "unit": "B",
    "kind": "requirement",
    "source": "C01 · Estimaciones: ONNX FP32 ≈ 98 MB (24.5 M × 4 B)",
    "ref": "4"
   },
   {
    "id": "adam_moments",
    "label": "Adam moments per weight",
    "unit": "count",
    "kind": "requirement",
    "source": "M10 · Pipelines: estado del optimizador (Adam: 2 momentos) = 2 × 98 MB",
    "ref": "2"
   },
   {
    "id": "s3_write_mbps",
    "label": "Checkpoint write rate to S3",
    "unit": "MB/s",
    "kind": "assumption",
    "source": "M10 · Pipelines: escribirlo en S3 ≈ 100–200 MB/s (lower bound)",
    "ref": "100"
   },
   {
    "id": "train_h",
    "label": "Fine-tune wall time (1 GPU)",
    "unit": "h",
    "kind": "assumption",
    "source": "M10 · Pipelines: cada 15 min durante un fine-tune de 4 h",
    "ref": "4"
   },
   {
    "id": "ckpt_every_min",
    "label": "Checkpoint interval",
    "unit": "min",
    "kind": "assumption",
    "source": "M10 · Pipelines: un checkpoint cada 15 minutos",
    "ref": "15"
   },
   {
    "id": "golden_n",
    "label": "Golden set size",
    "unit": "img",
    "kind": "requirement",
    "source": "C01 · Datos: golden set ≈ 50k imágenes estratificadas",
    "ref": "50000"
   },
   {
    "id": "golden_acc",
    "label": "Top-1 accuracy",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C01 · Datos: accuracy p = 0.85 y n = 50,000",
    "ref": "0.85"
   },
   {
    "id": "class_n_min",
    "label": "Examples in a rank-50–100 category",
    "unit": "img",
    "kind": "assumption",
    "source": "C01 · Datos: las del puesto 50–100 tienen ≈ 60–150 (lower bound)",
    "ref": "60"
   },
   {
    "id": "z_95",
    "label": "z for 95 % (two-sided)",
    "unit": "z",
    "kind": "requirement",
    "source": "C01 · Datos: intervalo al 95 % ≈ ±1.96 × SE",
    "ref": "1.96"
   },
   {
    "id": "parity_n",
    "label": "Parity test images",
    "unit": "img",
    "kind": "assumption",
    "source": "C01 · Evaluación: el parity test corre ≈ 10k imágenes por ambos",
    "ref": "10000"
   },
   {
    "id": "parity_min_agree",
    "label": "Min top-1 agreement TensorRT FP16 vs PyTorch",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C01 · Datos: parity top-1 agreement ≥ 99.5 %",
    "ref": "0.995"
   },
   {
    "id": "bytes_fp16",
    "label": "Bytes per FP16 value",
    "unit": "B",
    "kind": "requirement",
    "source": "C01 · Estimaciones: pesos FP16 24.5 M × 2 B ≈ 49 MB",
    "ref": "2"
   },
   {
    "id": "max_batch",
    "label": "Triton max_batch_size",
    "unit": "req",
    "kind": "requirement",
    "source": "C01 · Serving: max_batch_size: 32 (igual al perfil max del engine)",
    "ref": "32"
   },
   {
    "id": "gpu_vram_gb",
    "label": "T4 memory",
    "unit": "GB",
    "kind": "benchmark",
    "source": "C01 · Estimaciones: qué ocupa una T4 de 16 GB",
    "ref": "16"
   },
   {
    "id": "vram_used_gb",
    "label": "VRAM used, 2 instances (upper)",
    "unit": "GB",
    "kind": "assumption",
    "source": "C01 · Estimaciones: 2 instancias del modelo ≈ 1–3 GB en total",
    "ref": "3"
   },
   {
    "id": "in_c",
    "label": "Input channels",
    "unit": "ch",
    "kind": "requirement",
    "source": "C01 · Serving: input FP32 dims [3, 224, 224] (config.pbtxt)",
    "ref": "3"
   },
   {
    "id": "in_h",
    "label": "Input height",
    "unit": "px",
    "kind": "requirement",
    "source": "C01 · Serving: input FP32 dims [3, 224, 224] (config.pbtxt)",
    "ref": "224"
   },
   {
    "id": "in_w",
    "label": "Input width",
    "unit": "px",
    "kind": "requirement",
    "source": "C01 · Serving: input FP32 dims [3, 224, 224] (config.pbtxt)",
    "ref": "224"
   },
   {
    "id": "slo_p99_ms",
    "label": "Latency SLO p99 (server-side)",
    "unit": "ms",
    "kind": "requirement",
    "source": "C01 · Aclaración: p99 ≤ 200 ms del lado del servidor",
    "ref": "200"
   },
   {
    "id": "p99_alb_ms",
    "label": "p99 · ALB + routing",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: presupuesto por tramo, ALB + routing p99 5–10 ms",
    "ref": "10"
   },
   {
    "id": "p99_body_ms",
    "label": "p99 · Body read in gateway",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: lectura del body p99 10–30 ms",
    "ref": "30"
   },
   {
    "id": "p99_decode_ms",
    "label": "p99 · Decode + resize + crop",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: decode + resize 256 + crop 224 p99 25–50 ms",
    "ref": "50"
   },
   {
    "id": "p99_norm_ms",
    "label": "p99 · Normalize + CHW tensor",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: normalización + tensor CHW FP32 p99 ≈ 2 ms",
    "ref": "2"
   },
   {
    "id": "p99_hop_ms",
    "label": "p99 · Gateway → Triton hop",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: hop gateway → Triton (602 KB) p99 5–10 ms",
    "ref": "10"
   },
   {
    "id": "p99_queue_ms",
    "label": "p99 · Dynamic batching queue",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: cola de dynamic batching p99 2 ms (max_queue_delay 2000 µs)",
    "ref": "2"
   },
   {
    "id": "p99_gpu_ms",
    "label": "p99 · GPU compute (TRT FP16, batch 1–8)",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: cómputo GPU p99 8–15 ms",
    "ref": "15"
   },
   {
    "id": "p99_post_ms",
    "label": "p99 · Postprocess + JSON + log",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: postproceso + JSON + log p99 2–3 ms",
    "ref": "3"
   },
   {
    "id": "p99_python_ms",
    "label": "p99 · Python overhead (loop, threadpool, GC)",
    "unit": "ms",
    "kind": "assumption",
    "source": "C01 · Estimaciones: overhead de Python p99 10–30 ms",
    "ref": "30"
   },
   {
    "id": "lat_mean_s",
    "label": "Mean gateway latency",
    "unit": "s",
    "kind": "assumption",
    "source": "M03 · Little: cada request tarda en promedio 50 ms",
    "ref": "0.05"
   },
   {
    "id": "triton_time_s",
    "label": "Mean time inside Triton",
    "unit": "s",
    "kind": "assumption",
    "source": "M03 · Little: tiempo promedio dentro de Triton ≈ 8 ms",
    "ref": "0.008"
   },
   {
    "id": "gw_image_gb",
    "label": "Gateway image (compressed)",
    "unit": "GB",
    "kind": "benchmark",
    "source": "M05 · Tamaño: gateway base slim + venv ≈ 0.09 GB",
    "ref": "0.09"
   },
   {
    "id": "triton_image_gb",
    "label": "Triton 24.08 image with engine (compressed)",
    "unit": "GB",
    "kind": "benchmark",
    "source": "M05 · Tamaño: Triton 24.08 con el engine ≈ 9.2 GB",
    "ref": "9.2"
   },
   {
    "id": "pull_gbps",
    "label": "Effective pull rate (worst case, gp3 default)",
    "unit": "GB/s",
    "kind": "benchmark",
    "source": "M05 · Tamaño: ritmo efectivo de pull ≈ 0.03–0.09 GB/s",
    "ref": "0.03"
   },
   {
    "id": "staging_h_week",
    "label": "Staging T4 hours on per week",
    "unit": "h/week",
    "kind": "assumption",
    "source": "C01 · Costo: staging con 1 T4 prendida 60 h/semana",
    "ref": "60"
   },
   {
    "id": "gw_pod_cpu",
    "label": "Gateway pod CPU request",
    "unit": "vCPU",
    "kind": "requirement",
    "source": "C01 · Archivos: k8s/gateway.yaml requests cpu \"1\" (base del HPA)",
    "ref": "1"
   },
   {
    "id": "hpa_min",
    "label": "Gateway HPA min replicas",
    "unit": "pods",
    "kind": "requirement",
    "source": "C01 · Serving: HPA por CPU al 60 %, min 3, max 12",
    "ref": "3"
   },
   {
    "id": "hpa_max",
    "label": "Gateway HPA max replicas",
    "unit": "pods",
    "kind": "requirement",
    "source": "C01 · Serving: HPA por CPU al 60 %, min 3, max 12",
    "ref": "12"
   },
   {
    "id": "max_inflight",
    "label": "MAX_INFLIGHT per gateway pod",
    "unit": "req",
    "kind": "requirement",
    "source": "M03 · Little: MAX_INFLIGHT ≈ 20, recortado a 16 por RAM",
    "ref": "16"
   },
   {
    "id": "node_up_s",
    "label": "New GPU node ready (upper)",
    "unit": "s",
    "kind": "benchmark",
    "source": "M05 · Tamaño: nodo ≈ 2–5 min",
    "ref": "300"
   },
   {
    "id": "engine_load_s",
    "label": "Triton start + engine load + warmup (upper)",
    "unit": "s",
    "kind": "benchmark",
    "source": "M05 · Tamaño: engine y warmup ≈ 10–60 s",
    "ref": "60"
   },
   {
    "id": "readiness_s",
    "label": "Readiness + endpoints (upper)",
    "unit": "s",
    "kind": "benchmark",
    "source": "M05 · Tamaño: readiness ≈ 5–15 s",
    "ref": "15"
   },
   {
    "id": "canary_share",
    "label": "Canary traffic share",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C01 · Evaluación: canary 5 % → 25 % → 100 %",
    "ref": "0.05"
   },
   {
    "id": "canary_n_min",
    "label": "Canary requests per decision window",
    "unit": "req",
    "kind": "requirement",
    "source": "C01 · Evaluación: rollback 5xx con ≥ 10,000 requests del canary en la ventana",
    "ref": "10000"
   },
   {
    "id": "rollback_window_min",
    "label": "Canary 5xx rollback window",
    "unit": "min",
    "kind": "requirement",
    "source": "C01 · Evaluación: criterio de rollback 5xx, ventana 10 min",
    "ref": "10"
   },
   {
    "id": "ab_base",
    "label": "Acceptance-rate baseline",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C01 · Evaluación: línea base de ≈ 70 %",
    "ref": "0.7"
   },
   {
    "id": "ab_mde",
    "label": "Minimum detectable effect",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C01 · Evaluación: detectar una mejora de 1 punto porcentual",
    "ref": "0.01"
   },
   {
    "id": "z_beta",
    "label": "z for 80 % power",
    "unit": "z",
    "kind": "requirement",
    "source": "C01 · Evaluación: (1.96 + 0.84)²",
    "ref": "0.84"
   },
   {
    "id": "listings_day",
    "label": "New listings per day",
    "unit": "listings/day",
    "kind": "requirement",
    "source": "C01 · Evaluación: ≈ 2.5 M publicaciones/día",
    "ref": "2500000"
   },
   {
    "id": "ab_share",
    "label": "A/B treatment share",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C01 · Evaluación: tiempo con 5 % en tratamiento",
    "ref": "0.05"
   },
   {
    "id": "caller_timeout_ms",
    "label": "Caller timeout",
    "unit": "ms",
    "kind": "requirement",
    "source": "C01 · Serving: timeout del caller 300 ms → selector manual",
    "ref": "300"
   },
   {
    "id": "req_deadline_ms",
    "label": "Gateway request deadline",
    "unit": "ms",
    "kind": "requirement",
    "source": "C01 · Serving: deadline total de 250 ms por request → 504",
    "ref": "250"
   },
   {
    "id": "infer_timeout_ms",
    "label": "Gateway → Triton timeout",
    "unit": "ms",
    "kind": "requirement",
    "source": "C01 · Serving: timeout gateway → Triton 150 ms (INFER_TIMEOUT_S=0.15)",
    "ref": "150"
   },
   {
    "id": "queue_timeout_ms",
    "label": "Triton queue timeout",
    "unit": "ms",
    "kind": "requirement",
    "source": "C01 · Serving: timeout en la cola de Triton 100 ms (REJECT)",
    "ref": "100"
   },
   {
    "id": "slo_window_h",
    "label": "SLO window",
    "unit": "h",
    "kind": "requirement",
    "source": "M12 · Prometheus: 99.9 % en 30 días (720 h)",
    "ref": "720"
   },
   {
    "id": "burn_page",
    "label": "Fast-burn page factor",
    "unit": "×",
    "kind": "requirement",
    "source": "C01 · Monitoreo: page si se consume 14.4× más rápido en 1 h y 5 min",
    "ref": "14.4"
   },
   {
    "id": "page_window_h",
    "label": "Fast-burn long window",
    "unit": "h",
    "kind": "requirement",
    "source": "C01 · Monitoreo: 14.4× en 1 h y en 5 min a la vez",
    "ref": "1"
   },
   {
    "id": "burn_ticket",
    "label": "Slow-burn ticket factor",
    "unit": "×",
    "kind": "requirement",
    "source": "C01 · Monitoreo: ticket a 6× en 6 h y 30 min",
    "ref": "6"
   },
   {
    "id": "ticket_window_h",
    "label": "Slow-burn long window",
    "unit": "h",
    "kind": "requirement",
    "source": "C01 · Monitoreo: ticket a 6× en 6 h y 30 min",
    "ref": "6"
   }
  ],
  "batch": [
   {
    "id": "n_stores",
    "label": "Stores",
    "unit": "stores",
    "kind": "requirement",
    "source": "C14 · Estimaciones: 400 tiendas",
    "ref": "400"
   },
   {
    "id": "products_per_store",
    "label": "Active products per store",
    "unit": "products",
    "kind": "requirement",
    "source": "C14 · Estimaciones: ≈ 12,000 productos por tienda (de ≈ 25,000 en la cadena)",
    "ref": "12000"
   },
   {
    "id": "horizons",
    "label": "Forecast horizons per series",
    "unit": "days",
    "kind": "requirement",
    "source": "C14 · Requisitos FR1: 14 filas (horizonte 1–14) por serie",
    "ref": "14"
   },
   {
    "id": "n_models",
    "label": "Quantile models scored",
    "unit": "models",
    "kind": "requirement",
    "source": "C14 · Estimaciones: 67.2 M filas × 2 modelos (P50 y P90)",
    "ref": "2"
   },
   {
    "id": "us_per_row_core",
    "label": "GBDT scoring cost per row",
    "unit": "µs/row/core",
    "kind": "benchmark",
    "source": "C14 · Estimaciones: 30 µs por fila y núcleo",
    "ref": "30"
   },
   {
    "id": "cluster_vcpu",
    "label": "Scoring vCPU",
    "unit": "vCPU",
    "kind": "assumption",
    "source": "C14 · Estimaciones: En 32 vCPU ≈ 2.1 min",
    "ref": "32"
   },
   {
    "id": "cutoff_min",
    "label": "Data cutoff (minutes after 00:00)",
    "unit": "min",
    "kind": "requirement",
    "source": "C14 · Estimaciones: corte a la 01:30",
    "ref": "90"
   },
   {
    "id": "deadline_min",
    "label": "Publish deadline (minutes after 00:00)",
    "unit": "min",
    "kind": "requirement",
    "source": "C14 · Requisitos: publicado a las 03:30",
    "ref": "210"
   },
   {
    "id": "erp_read_min",
    "label": "ERP read time (minutes after 00:00)",
    "unit": "min",
    "kind": "requirement",
    "source": "C14 · Estimaciones: ERP a las 04:00",
    "ref": "240"
   },
   {
    "id": "n_attempts",
    "label": "Attempts that must fit the window",
    "unit": "attempts",
    "kind": "requirement",
    "source": "C14 · Estimaciones: presupuesto por intento 120 ÷ 2 (primer intento spot, reintento on-demand)",
    "ref": "2"
   },
   {
    "id": "run_max_min",
    "label": "Run duration budget per attempt",
    "unit": "min",
    "kind": "requirement",
    "source": "C14 · Requisitos: ≤ 60 min por intento (esperado ≈ 35–60 min)",
    "ref": "60"
   },
   {
    "id": "annual_sales_usd",
    "label": "Chain annual sales",
    "unit": "US$/year",
    "kind": "requirement",
    "source": "C14 · Estimaciones: US$5 B",
    "ref": "5000000000"
   },
   {
    "id": "fresh_share",
    "label": "Fresh share of sales",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C14 · Estimaciones: 30 % × US$5 B",
    "ref": "0.3"
   },
   {
    "id": "waste_rate",
    "label": "Fresh waste rate today",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C14 · Estimaciones: merma 4 %",
    "ref": "0.04"
   },
   {
    "id": "waste_cut",
    "label": "Waste reduction target",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C14 · Estimaciones: meta −20 % de merma (4 % → 3.2 %)",
    "ref": "0.2"
   },
   {
    "id": "stockout_rate",
    "label": "Lost sales to stockouts",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C14 · Estimaciones: 3 % × US$5 B",
    "ref": "0.03"
   },
   {
    "id": "stockout_cut",
    "label": "Stockout reduction target",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C14 · Estimaciones: meta −25 % de agotados",
    "ref": "0.25"
   },
   {
    "id": "gross_margin",
    "label": "Gross margin",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C14 · Estimaciones: margen bruto de ≈ 25 %",
    "ref": "0.25"
   },
   {
    "id": "infra_month_usd",
    "label": "Infra cost, upper bound",
    "unit": "US$/month",
    "kind": "requirement",
    "source": "C14 · Requisitos: ≈ US$3–5k/mes de infraestructura (cota alta)",
    "ref": "5000"
   },
   {
    "id": "hist_days_ref",
    "label": "History read by reference features",
    "unit": "days",
    "kind": "assumption",
    "source": "C14 · Estimaciones: 4.8 M series × 70 días",
    "ref": "70"
   },
   {
    "id": "hist_days_annual",
    "label": "History read with annual features",
    "unit": "days",
    "kind": "assumption",
    "source": "C14 · Estimaciones: 4.8 M series × 730 días",
    "ref": "730"
   },
   {
    "id": "bytes_float",
    "label": "Bytes per float32",
    "unit": "B",
    "kind": "assumption",
    "source": "C14 · Estimaciones: ≈ 1.3 GB en float32; memoria en float32 × 4 B",
    "ref": "4"
   },
   {
    "id": "bytes_hist_row",
    "label": "Bytes per history row",
    "unit": "B",
    "kind": "assumption",
    "source": "C14 · Estimaciones: ≈ 16 B por fila → ≈ 56 GB por tabla",
    "ref": "16"
   },
   {
    "id": "impute_ticket_share",
    "label": "Imputed stores that open a ticket",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C14 · Monitoreo: InputDataIncomplete con más del 2 % (≈ 8 de 400)",
    "ref": "0.02"
   },
   {
    "id": "impute_block_share",
    "label": "Imputed stores that block the gate",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C14 · Requisitos FR5: tiendas imputadas ≤ 5 %",
    "ref": "0.05"
   },
   {
    "id": "bytes_per_out_row",
    "label": "Bytes per forecast row",
    "unit": "B",
    "kind": "assumption",
    "source": "C14 · Estimaciones: ≈ 30 B (ids, fechas, P50, P90, marcas)",
    "ref": "30"
   },
   {
    "id": "s3_price_gb_month",
    "label": "S3 Standard price",
    "unit": "US$/GB-month",
    "kind": "assumption",
    "source": "ref-numeros · S3 Standard ≈ US$0.023/GB-mes (C14 da ≈ US$17 sin comprimir)",
    "ref": "0.023"
   },
   {
    "id": "top_share",
    "label": "Top series share (all rows kept)",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C14 · Estimaciones: series principales 20 % × 4.8 M",
    "ref": "0.2"
   },
   {
    "id": "train_days",
    "label": "Training history",
    "unit": "days",
    "kind": "assumption",
    "source": "C14 · Estimaciones: 52 semanas = 364 días",
    "ref": "364"
   },
   {
    "id": "rest_sample",
    "label": "Sample rate for the other series",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C14 · Estimaciones: el resto al 10 %, con peso 10",
    "ref": "0.1"
   },
   {
    "id": "n_features",
    "label": "Features per row",
    "unit": "features",
    "kind": "assumption",
    "source": "C14 · Estimaciones: ≈ 50 features (la referencia usa 45)",
    "ref": "50"
   },
   {
    "id": "bytes_binned",
    "label": "Bytes per binned feature",
    "unit": "B",
    "kind": "assumption",
    "source": "C14 · Estimaciones: 1 B (≤ 255 bins por feature)",
    "ref": "1"
   },
   {
    "id": "train_node_ram_gib",
    "label": "Training node RAM (r7i.24xlarge)",
    "unit": "GiB",
    "kind": "assumption",
    "source": "C14 · Estimaciones: r7i.24xlarge (96 vCPU, 768 GiB)",
    "ref": "768"
   },
   {
    "id": "row_count_tol",
    "label": "Gate tolerance on row count",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C14 · Archivos: row_count (series × 14 ± 0.5 %)",
    "ref": "0.005"
   },
   {
    "id": "guard_min",
    "label": "Fallback guard DAG start (minutes after 00:00)",
    "unit": "min",
    "kind": "requirement",
    "source": "C14 · Serving: guardián a las 03:45",
    "ref": "225"
   },
   {
    "id": "freeze_min",
    "label": "Pointer freeze (minutes after 00:00)",
    "unit": "min",
    "kind": "requirement",
    "source": "C14 · Serving: puntero congelado a las 03:55",
    "ref": "235"
   },
   {
    "id": "guard_timeout_min",
    "label": "Guard task limit",
    "unit": "min",
    "kind": "requirement",
    "source": "C14 · Serving: forecast_fallback_guard, límite 9 min",
    "ref": "9"
   },
   {
    "id": "dag_timeout_min",
    "label": "run_forecast execution timeout",
    "unit": "min",
    "kind": "requirement",
    "source": "C14 · Serving: 90 min por intento (tope para un intento colgado)",
    "ref": "90"
   },
   {
    "id": "spark_nodes",
    "label": "Spark nodes (r7i.4xlarge)",
    "unit": "nodes",
    "kind": "assumption",
    "source": "C14 · Estimaciones: ≈ 16 × r7i.4xlarge en spot",
    "ref": "16"
   },
   {
    "id": "idle_wait_h",
    "label": "Cluster up but waiting for late stores",
    "unit": "h",
    "kind": "assumption",
    "source": "C14 · Estimaciones (trampa): levantarlo a las 00:30 y esperar hasta la 01:30",
    "ref": "1"
   },
   {
    "id": "price_node_spot_h",
    "label": "r7i.4xlarge spot price",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C14 · Estimaciones: r7i.4xlarge ≈ US$0.41 en spot (oct. 2026)",
    "ref": "0.41"
   },
   {
    "id": "days_month",
    "label": "Nights per month",
    "unit": "nights",
    "kind": "assumption",
    "source": "Course convention: SLO month = 30 days",
    "ref": "30"
   },
   {
    "id": "pilot_pairs",
    "label": "Pilot store pairs",
    "unit": "pairs",
    "kind": "requirement",
    "source": "C14 · Evaluación: 40 pares de tiendas",
    "ref": "40"
   },
   {
    "id": "pilot_weeks",
    "label": "Pilot length",
    "unit": "weeks",
    "kind": "requirement",
    "source": "C14 · Evaluación: semanas 3 a 8",
    "ref": "8"
   },
   {
    "id": "burnin_weeks",
    "label": "Burn-in weeks not counted",
    "unit": "weeks",
    "kind": "requirement",
    "source": "C14 · Evaluación: las 2 primeras semanas son de arranque",
    "ref": "2"
   },
   {
    "id": "pilot_sigma_pts",
    "label": "Std dev of per-store stockout change",
    "unit": "points",
    "kind": "assumption",
    "source": "C14 · Evaluación: σ del cambio por tienda ≈ 1.5 puntos",
    "ref": "1.5"
   },
   {
    "id": "z95",
    "label": "z for 95 %",
    "unit": "z",
    "kind": "assumption",
    "source": "C14 · Evaluación: intervalo de 95 %",
    "ref": "1.96"
   }
  ],
  "asincrono": [
   {
    "id": "slides_day",
    "label": "In-scope slides per day",
    "unit": "slides/day",
    "kind": "requirement",
    "source": "C04 · Estimaciones: 1,200 láminas al día",
    "ref": "1200"
   },
   {
    "id": "scan_hours",
    "label": "Scanner hours per day",
    "unit": "h",
    "kind": "requirement",
    "source": "C04 · Estimaciones: 1,200 ÷ 14 h (08:00–22:00)",
    "ref": "14"
   },
   {
    "id": "slide_peak_factor",
    "label": "Peak factor",
    "unit": "×",
    "kind": "assumption",
    "source": "C04 · Estimaciones: pico ≈ 2× del promedio",
    "ref": "2"
   },
   {
    "id": "tissue_cm2",
    "label": "Tissue per slide",
    "unit": "cm²",
    "kind": "assumption",
    "source": "C04 · Estimaciones: ≈ 1.5 cm² por lámina",
    "ref": "1.5"
   },
   {
    "id": "mpp_model",
    "label": "Model resolution (20×)",
    "unit": "µm/px",
    "kind": "requirement",
    "source": "C04 · Estimaciones: 20× (0.5 µm/px), la resolución del modelo",
    "ref": "0.5"
   },
   {
    "id": "mpp_scan",
    "label": "Scan resolution (40×, level 0)",
    "unit": "µm/px",
    "kind": "requirement",
    "source": "C04 · Estimaciones: 40× (0.25 µm/px)",
    "ref": "0.25"
   },
   {
    "id": "tile_px",
    "label": "Tile size",
    "unit": "px",
    "kind": "requirement",
    "source": "C04 · Estimaciones: tiles de 512×512",
    "ref": "512"
   },
   {
    "id": "overlap_px",
    "label": "Tile overlap",
    "unit": "px",
    "kind": "requirement",
    "source": "C04 · Estimaciones: 64 px de solape (stride 448)",
    "ref": "64"
   },
   {
    "id": "gpu_max_tiles_s",
    "label": "Measured max per L4 (TensorRT FP16)",
    "unit": "tiles/s",
    "kind": "benchmark",
    "source": "C04 · Estimaciones: trtexec ≈ 300 tiles/s (supuesto)",
    "ref": "300"
   },
   {
    "id": "plan_tiles_s",
    "label": "Planned throughput per worker",
    "unit": "tiles/s",
    "kind": "assumption",
    "source": "C04 · Estimaciones: ≈ 70 % de 300 = 200 tiles/s",
    "ref": "200"
   },
   {
    "id": "target_util",
    "label": "Target utilization ceiling",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C04 · Estimaciones: ≈ 70 % (tráfico por cola)",
    "ref": "0.7"
   },
   {
    "id": "secs_per_slide",
    "label": "Serial time per slide",
    "unit": "s",
    "kind": "assumption",
    "source": "C04 · Estimaciones: ≈ 20–30 s por lámina (≈ 25 s)",
    "ref": "25"
   },
   {
    "id": "max_workers",
    "label": "KEDA max workers",
    "unit": "workers",
    "kind": "assumption",
    "source": "C04 · Estimaciones: KEDA de 0 a 4 workers",
    "ref": "4"
   },
   {
    "id": "billed_node_h_day",
    "label": "Billed GPU node-hours per day",
    "unit": "node-h/day",
    "kind": "assumption",
    "source": "C04 · Estimaciones: ≈ 15 nodo-h/día facturadas",
    "ref": "15"
   },
   {
    "id": "price_node_h",
    "label": "g6.2xlarge on-demand",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C04 · Estimaciones: g6.2xlarge ≈ US$0.98/h (us-east-1)",
    "ref": "0.98"
   },
   {
    "id": "days_month",
    "label": "Days per month",
    "unit": "days",
    "kind": "assumption",
    "source": "C04 · Estimaciones: × 30",
    "ref": "30"
   },
   {
    "id": "other_infra_usd",
    "label": "Other infra (reprocess, training, EKS, CPU, Postgres, storage)",
    "unit": "US$/month",
    "kind": "assumption",
    "source": "C04 · Estimaciones: 70 + 200 + 73 + 150 + 200 + 100",
    "ref": "793"
   },
   {
    "id": "infra_budget_usd",
    "label": "Infra budget",
    "unit": "US$/month",
    "kind": "requirement",
    "source": "C04 · Requisitos: infra ≤ US$2k/mes",
    "ref": "2000"
   },
   {
    "id": "path_hours_month",
    "label": "Pathologist labeling hours",
    "unit": "h/month",
    "kind": "requirement",
    "source": "C04 · Requisitos: 20 h/mes de patólogo",
    "ref": "20"
   },
   {
    "id": "path_price_h",
    "label": "Pathologist cost",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C04 · Estimaciones: US$200/h",
    "ref": "200"
   },
   {
    "id": "slo_late_share",
    "label": "Turnaround error budget (p95 ≤ 60 min)",
    "unit": "fraction",
    "kind": "requirement",
    "source": "M12 · c04: el presupuesto es 5 % de slides tarde",
    "ref": "0.05"
   },
   {
    "id": "cpu_ms_per_tile",
    "label": "CPU per tile (read, decode, 2× downsample)",
    "unit": "ms",
    "kind": "benchmark",
    "source": "C04 · Estimaciones: ≈ 20 ms (mídelo con un profiler)",
    "ref": "20"
   },
   {
    "id": "vcpu_node",
    "label": "vCPU per worker node (g6.2xlarge)",
    "unit": "vCPU",
    "kind": "assumption",
    "source": "C04 · Estimaciones: g6.2xlarge: 1 × L4, 8 vCPU",
    "ref": "8"
   },
   {
    "id": "burst_slides",
    "label": "Rack burst",
    "unit": "slides",
    "kind": "assumption",
    "source": "C04 · Estimaciones: un rack de 200 láminas de golpe",
    "ref": "200"
   },
   {
    "id": "cold_start_min",
    "label": "Cold start (node + image)",
    "unit": "min",
    "kind": "assumption",
    "source": "C04 · Estimaciones: arranque en frío ≈ 3–5 min (cota alta)",
    "ref": "5"
   },
   {
    "id": "slo_turnaround_min",
    "label": "Turnaround SLO (p95)",
    "unit": "min",
    "kind": "requirement",
    "source": "C04 · Requisitos: p95 ≤ 60 min",
    "ref": "60"
   },
   {
    "id": "vt_s",
    "label": "SQS visibility timeout",
    "unit": "s",
    "kind": "requirement",
    "source": "C04 · Serving: visibility timeout 300 s",
    "ref": "300"
   },
   {
    "id": "heartbeat_s",
    "label": "Heartbeat interval",
    "unit": "s",
    "kind": "requirement",
    "source": "C04 · Serving: ChangeMessageVisibility cada 60 s",
    "ref": "60"
   },
   {
    "id": "result_mb_slide",
    "label": "Results per slide (GeoJSON + heatmap + summary)",
    "unit": "MB",
    "kind": "assumption",
    "source": "C04 · Estimaciones: ≈ 5 MB por lámina",
    "ref": "5"
   },
   {
    "id": "s3_price_gb_month",
    "label": "S3 Standard price",
    "unit": "US$/GB-month",
    "kind": "assumption",
    "source": "C04 · Estimaciones: US$0.023/GB-mes",
    "ref": "0.023"
   },
   {
    "id": "audit_slides",
    "label": "Random audit slides per month",
    "unit": "slides",
    "kind": "requirement",
    "source": "C04 · Datos: 8 láminas × ≈ 15 min",
    "ref": "8"
   },
   {
    "id": "approve_min",
    "label": "Pathologist approval time per slide",
    "unit": "min",
    "kind": "assumption",
    "source": "C04 · Datos: ≈ 15 min de aprobación",
    "ref": "15"
   },
   {
    "id": "temporal_slides",
    "label": "Monthly temporal set",
    "unit": "slides",
    "kind": "requirement",
    "source": "C04 · Datos: set temporal 10 láminas × ≈ 15 min",
    "ref": "10"
   },
   {
    "id": "al_min_per_region",
    "label": "Time per active-learning region",
    "unit": "min",
    "kind": "assumption",
    "source": "C04 · Datos: ≈ 620 regiones a 1.5 min",
    "ref": "1.5"
   },
   {
    "id": "golden_slides",
    "label": "Golden set slides",
    "unit": "slides",
    "kind": "requirement",
    "source": "C04 · Estimaciones: golden set de 100 láminas",
    "ref": "100"
   },
   {
    "id": "golden_raters",
    "label": "Pathologists per golden slide",
    "unit": "raters",
    "kind": "requirement",
    "source": "C04 · Estimaciones: × 2 patólogos + consenso",
    "ref": "2"
   },
   {
    "id": "golden_min_slide",
    "label": "Approval time on resident pre-annotation",
    "unit": "min",
    "kind": "assumption",
    "source": "C04 · Estimaciones: ≈ 12 min de aprobación",
    "ref": "12"
   },
   {
    "id": "z95",
    "label": "z for 95 %",
    "unit": "z",
    "kind": "assumption",
    "source": "C04 · Evaluación: ≈ 1.96 × sd ÷ √n",
    "ref": "1.96"
   },
   {
    "id": "dice_sd",
    "label": "Per-slide Dice std dev",
    "unit": "Dice",
    "kind": "assumption",
    "source": "C04 · Evaluación: 1.96 × 0.10 ÷ √100",
    "ref": "0.1"
   },
   {
    "id": "paired_sd",
    "label": "Std dev of the paired Dice difference",
    "unit": "Dice",
    "kind": "assumption",
    "source": "C04 · Evaluación: sd de la diferencia ≈ 0.03",
    "ref": "0.03"
   },
   {
    "id": "labc_slides",
    "label": "Annotated lab-C slides",
    "unit": "slides",
    "kind": "requirement",
    "source": "C04 · Evaluación: ≥ 30 láminas anotadas del laboratorio C",
    "ref": "30"
   },
   {
    "id": "lesion_sens_target",
    "label": "Lesion-level sensitivity target",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C04 · Requisitos: sensibilidad por lesión ≥ 95 %",
    "ref": "0.95"
   },
   {
    "id": "burn_fast",
    "label": "Fast-burn factor (1 h)",
    "unit": "×",
    "kind": "assumption",
    "source": "M12 · SRE Workbook: 14.4× = 2 % del presupuesto en 1 h",
    "ref": "14.4"
   },
   {
    "id": "night_backlog",
    "label": "Worst-case night backlog",
    "unit": "slides",
    "kind": "assumption",
    "source": "C04 · Monitoreo: ≈ 500 láminas acumuladas",
    "ref": "500"
   },
   {
    "id": "night_margin_min",
    "label": "Page at 05:30 to SLO at 07:00",
    "unit": "min",
    "kind": "requirement",
    "source": "C04 · Monitoreo: 90 min de margen desde las 05:30",
    "ref": "90"
   },
   {
    "id": "review_saved_min",
    "label": "Review time saved per slide (low end)",
    "unit": "min",
    "kind": "assumption",
    "source": "C04 · Costo: el overlay ahorra 1–2 min por lámina",
    "ref": "1"
   },
   {
    "id": "c05_docs_month",
    "label": "C05 documents per month",
    "unit": "docs/month",
    "kind": "requirement",
    "source": "C05 · Estimaciones: 5,000 × 30 = 150,000",
    "ref": "150000"
   },
   {
    "id": "c05_stp_share",
    "label": "C05 straight-through share",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C05 · Estimaciones: 60 % STP",
    "ref": "0.6"
   },
   {
    "id": "c05_review_s",
    "label": "C05 review time per routed document",
    "unit": "s",
    "kind": "assumption",
    "source": "C05 · Estimaciones: 45 s por documento revisado",
    "ref": "45"
   },
   {
    "id": "c05_audit_share",
    "label": "C05 QA audit share of STP",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C05 · Estimaciones: auditoría del 2 % de los STP",
    "ref": "0.02"
   },
   {
    "id": "c05_audit_min",
    "label": "C05 audit time per document",
    "unit": "min",
    "kind": "assumption",
    "source": "C05 · Estimaciones: a 2 min",
    "ref": "2"
   },
   {
    "id": "c05_productive_h_month",
    "label": "C05 productive hours per reviewer",
    "unit": "h/month",
    "kind": "assumption",
    "source": "C05 · Estimaciones: ≈ 130 h productivas (6 h × ≈ 22 días)",
    "ref": "130"
   },
   {
    "id": "c05_peak_docs_day",
    "label": "C05 peak-day documents",
    "unit": "docs/day",
    "kind": "requirement",
    "source": "C05 · Estimaciones: día de pico 10,000 docs",
    "ref": "10000"
   },
   {
    "id": "c05_productive_h_day",
    "label": "C05 productive hours per reviewer per day",
    "unit": "h/day",
    "kind": "assumption",
    "source": "C05 · Estimaciones: 6 h productivas",
    "ref": "6"
   }
  ],
  "llm": [
   {
    "id": "n_docs",
    "label": "Indexed documents",
    "unit": "docs",
    "kind": "requirement",
    "source": "C11 · Estimaciones: ≈ 1.5 M documentos",
    "ref": "1500000"
   },
   {
    "id": "chunks_per_doc",
    "label": "Chunks per document (avg)",
    "unit": "chunks",
    "kind": "assumption",
    "source": "C11 · Estimaciones: ≈ 8 chunks por documento de promedio",
    "ref": "8"
   },
   {
    "id": "tokens_per_chunk",
    "label": "Tokens per chunk",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 12 M × 400",
    "ref": "400"
   },
   {
    "id": "bytes_per_token",
    "label": "Bytes per token of plain text",
    "unit": "B",
    "kind": "assumption",
    "source": "C11 · Estimaciones: ≈ 4 bytes por token",
    "ref": "4"
   },
   {
    "id": "q_day",
    "label": "Questions per day",
    "unit": "questions/day",
    "kind": "requirement",
    "source": "C11 · Estimaciones: 25,000 preguntas",
    "ref": "25000"
   },
   {
    "id": "biz_hours",
    "label": "Business hours per day",
    "unit": "h",
    "kind": "requirement",
    "source": "C11 · Estimaciones: 25,000 ÷ (10 h × 3,600 s)",
    "ref": "10"
   },
   {
    "id": "q_peak_factor",
    "label": "Peak factor",
    "unit": "×",
    "kind": "assumption",
    "source": "C11 · Estimaciones: pico 3 × 0.7",
    "ref": "3"
   },
   {
    "id": "sys_tokens",
    "label": "System instructions",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Estimaciones: instrucciones ≈ 800 (prefijo fijo)",
    "ref": "800"
   },
   {
    "id": "hist_tokens",
    "label": "Trimmed history",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Estimaciones: historial ≤ 1,200",
    "ref": "1200"
   },
   {
    "id": "k_chunks",
    "label": "Chunks in the prompt",
    "unit": "chunks",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 8 chunks × 400",
    "ref": "8"
   },
   {
    "id": "q_tokens",
    "label": "Question",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Estimaciones: pregunta ≈ 100",
    "ref": "100"
   },
   {
    "id": "max_out_tokens",
    "label": "max_tokens",
    "unit": "tokens",
    "kind": "requirement",
    "source": "C11 · Estimaciones: max_tokens = 600",
    "ref": "600"
   },
   {
    "id": "ctx_tokens",
    "label": "Model context",
    "unit": "tokens",
    "kind": "requirement",
    "source": "C11 · Estimaciones: 5,900 de 8,192",
    "ref": "8192"
   },
   {
    "id": "avg_in_tokens",
    "label": "Avg input tokens per question (rewrites, retries)",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Estimaciones: el promedio de entrada queda en ≈ 6,000 tokens",
    "ref": "6000"
   },
   {
    "id": "avg_out_tokens",
    "label": "Avg output tokens per question (answer + rewrite)",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 25k × ≈ 400",
    "ref": "400"
   },
   {
    "id": "answer_s",
    "label": "Avg answer duration",
    "unit": "s",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 2 qps × ≈ 11 s",
    "ref": "11"
   },
   {
    "id": "quota_tpm",
    "label": "Gateway quota requested",
    "unit": "tokens/min",
    "kind": "requirement",
    "source": "C11 · Estimaciones: se pide ≈ 1 M tokens/min",
    "ref": "1000000"
   },
   {
    "id": "biz_days",
    "label": "Business days per month",
    "unit": "days",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 25k × 22 días hábiles",
    "ref": "22"
   },
   {
    "id": "llm_price_per_m",
    "label": "C10 showback rate",
    "unit": "US$/M tokens",
    "kind": "assumption",
    "source": "C11 · Costo: ≈ US$1.0 por millón (mezcla del c10)",
    "ref": "1"
   },
   {
    "id": "other_infra_usd",
    "label": "Other infra (OpenSearch, L4s, ingestion, logs)",
    "unit": "US$/month",
    "kind": "assumption",
    "source": "C11 · Costo: 1.4k + 1.2k + 0.6k + 0.6k + 0.3k",
    "ref": "4100"
   },
   {
    "id": "slo_avail",
    "label": "Availability SLO (generated answer)",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C11 · Requisitos: 99.5 % de la respuesta generada",
    "ref": "0.995"
   },
   {
    "id": "slo_month_min",
    "label": "SLO month",
    "unit": "min",
    "kind": "assumption",
    "source": "Course convention: SLO month = 30 days = 43,200 min (M12)",
    "ref": "43200"
   },
   {
    "id": "golden_q",
    "label": "Golden set questions",
    "unit": "questions",
    "kind": "requirement",
    "source": "C11 · Datos: golden set de ≈ 600 preguntas",
    "ref": "600"
   },
   {
    "id": "golden_min_per_q",
    "label": "Expert time per golden question",
    "unit": "min",
    "kind": "assumption",
    "source": "C11 · Datos: ≈ 20 min por pregunta de un experto",
    "ref": "20"
   },
   {
    "id": "parsed_overhead",
    "label": "Parsed JSON vs plain text",
    "unit": "×",
    "kind": "assumption",
    "source": "C11 · Estimaciones: ≈ 19 GB × ≈ 2 por metadatos y estructura",
    "ref": "2"
   },
   {
    "id": "changed_docs_day",
    "label": "Documents touched per day",
    "unit": "docs/day",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 15k docs × 8 chunks × 400 tokens",
    "ref": "15000"
   },
   {
    "id": "edit_peak_factor",
    "label": "Edit peak factor",
    "unit": "×",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 15k ÷ 10 h × 3",
    "ref": "3"
   },
   {
    "id": "embed_tok_s",
    "label": "Embedding throughput per L4 (≈ 0.6 B model)",
    "unit": "tokens/s",
    "kind": "benchmark",
    "source": "C11 · Estimaciones: ≈ 30k tokens/s por L4 (mídelo)",
    "ref": "30000"
   },
   {
    "id": "scanned_share",
    "label": "Scanned share of PDFs",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C11 · Estimaciones: ≈ 15 % de 300k",
    "ref": "0.15"
   },
   {
    "id": "n_pdfs",
    "label": "PDFs in the corpus",
    "unit": "PDFs",
    "kind": "assumption",
    "source": "C11 · Estimaciones: incluye ≈ 300k PDFs",
    "ref": "300000"
   },
   {
    "id": "pages_per_pdf",
    "label": "Pages per scanned PDF",
    "unit": "pages",
    "kind": "assumption",
    "source": "C11 · Estimaciones: × ≈ 10 páginas",
    "ref": "10"
   },
   {
    "id": "ocr_s_page",
    "label": "CPU OCR time per page",
    "unit": "core-s",
    "kind": "assumption",
    "source": "C11 · Estimaciones: ≈ 2 s por página de un núcleo",
    "ref": "2"
   },
   {
    "id": "dim",
    "label": "Embedding dimension",
    "unit": "dims",
    "kind": "requirement",
    "source": "C11 · Estimaciones: d = 1024",
    "ref": "1024"
   },
   {
    "id": "bytes_fp16",
    "label": "Bytes per FP16 component",
    "unit": "B",
    "kind": "assumption",
    "source": "C11 · Estimaciones: en FP16 × 2 B",
    "ref": "2"
   },
   {
    "id": "hnsw_m",
    "label": "HNSW M",
    "unit": "links",
    "kind": "assumption",
    "source": "C11 · Estimaciones: grafo HNSW, M = 32",
    "ref": "32"
   },
   {
    "id": "bytes_link",
    "label": "Bytes per graph link",
    "unit": "B",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 12 M × 2 × 32 × 4 B",
    "ref": "4"
   },
   {
    "id": "os_nodes",
    "label": "OpenSearch data nodes",
    "unit": "nodes",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 3 nodos",
    "ref": "3"
   },
   {
    "id": "os_copies",
    "label": "Index copies (primary + replica)",
    "unit": "copies",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 2 copias",
    "ref": "2"
   },
   {
    "id": "node_ram_gb",
    "label": "r7i.2xlarge RAM",
    "unit": "GB",
    "kind": "assumption",
    "source": "C11 · Estimaciones: 64 GiB ≈ 68.7 GB",
    "ref": "68.7"
   },
   {
    "id": "heap_gb",
    "label": "OpenSearch heap",
    "unit": "GB",
    "kind": "assumption",
    "source": "C11 · Estimaciones: heap 16",
    "ref": "16"
   },
   {
    "id": "page_cache_gb",
    "label": "Text and BM25 in page cache",
    "unit": "GB",
    "kind": "assumption",
    "source": "C11 · Estimaciones: texto y BM25 en page cache ≈ 19.5",
    "ref": "19.5"
   },
   {
    "id": "recall",
    "label": "recall@8 (first measurement)",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C11 · Evaluación: recall@8 de ≈ 0.85",
    "ref": "0.85"
   },
   {
    "id": "z95",
    "label": "z for 95 %",
    "unit": "z",
    "kind": "assumption",
    "source": "C11 · Evaluación: 1.96 × √(p(1−p) ÷ n)",
    "ref": "1.96"
   },
   {
    "id": "slice_n",
    "label": "Questions in one slice",
    "unit": "questions",
    "kind": "assumption",
    "source": "C11 · Evaluación: slice de 60",
    "ref": "60"
   },
   {
    "id": "canary_n",
    "label": "Groundedness canary set",
    "unit": "questions",
    "kind": "requirement",
    "source": "C11 · Evaluación: canary de 100 preguntas cada 4 h",
    "ref": "100"
   },
   {
    "id": "rerank_active_b",
    "label": "Reranker params that do math",
    "unit": "B params",
    "kind": "assumption",
    "source": "C11 · Estimaciones: bge-reranker-v2-m3 ≈ 0.30 B sin la tabla de embeddings",
    "ref": "0.3"
   },
   {
    "id": "pair_tokens",
    "label": "Tokens per (question, chunk) pair",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Estimaciones: ≈ 450 tokens (pregunta + chunk)",
    "ref": "450"
   },
   {
    "id": "attn_tflop_pair",
    "label": "Attention FLOPs per pair",
    "unit": "TFLOP",
    "kind": "assumption",
    "source": "C11 · Estimaciones: la atención suma ≈ 0.02 a 450 tokens",
    "ref": "0.02"
   },
   {
    "id": "rerank_pairs",
    "label": "Candidates reranked",
    "unit": "pairs",
    "kind": "requirement",
    "source": "C11 · Estimaciones: 50 pares",
    "ref": "50"
   },
   {
    "id": "l4_tflops",
    "label": "L4 FP16 dense peak",
    "unit": "TFLOPS",
    "kind": "benchmark",
    "source": "C11 · Estimaciones: L4 121 TFLOPS FP16 densos",
    "ref": "121"
   },
   {
    "id": "l4_eff",
    "label": "Useful fraction of peak",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C11 · Estimaciones: ≈ 50 % útil",
    "ref": "0.5"
   },
   {
    "id": "other_retrieval_s",
    "label": "Auth, BM25 ∥ k-NN, RRF",
    "unit": "s",
    "kind": "assumption",
    "source": "C11 · Estimaciones: más ≈ 0.2 s del resto",
    "ref": "0.2"
   },
   {
    "id": "retrieval_slo_s",
    "label": "Retrieval + rerank p95 target",
    "unit": "s",
    "kind": "requirement",
    "source": "C11 · Requisitos: p95 ≤ 700 ms",
    "ref": "0.7"
   },
   {
    "id": "c10_ttft_5k_s",
    "label": "Prompt + gateway + C10 TTFT with ≈ 5k tokens",
    "unit": "s",
    "kind": "assumption",
    "source": "C11 · Requisitos: TTFT de c10 con ≈ 5k tokens (≤ ≈ 1.5 s)",
    "ref": "1.5"
   },
   {
    "id": "ttft_slo_s",
    "label": "First-token SLO (p95)",
    "unit": "s",
    "kind": "requirement",
    "source": "C11 · Requisitos: primer token p95 ≤ 2.5 s",
    "ref": "2.5"
   },
   {
    "id": "typical_out",
    "label": "Typical answer length",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Requisitos: la típica, de ≈ 300 tokens",
    "ref": "300"
   },
   {
    "id": "tpot_rag_s",
    "label": "TPOT on the C10 fleet (high end)",
    "unit": "s/token",
    "kind": "assumption",
    "source": "C11 · Requisitos: ≈ 25–40 ms por token",
    "ref": "0.04"
   },
   {
    "id": "tpot_p95_s",
    "label": "C10 TPOT SLO (p95)",
    "unit": "s/token",
    "kind": "requirement",
    "source": "C10 · Requisitos: TPOT p95 ≤ 50 ms",
    "ref": "0.05"
   },
   {
    "id": "price_l4_h",
    "label": "g6.xlarge on-demand",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C11 · Estimaciones: US$0.805 (g6.xlarge on-demand)",
    "ref": "0.805"
   },
   {
    "id": "ab_p1",
    "label": "Thumbs-down rate today",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C11 · Evaluación: pulgar abajo de 20 %",
    "ref": "0.2"
   },
   {
    "id": "ab_p2",
    "label": "Thumbs-down rate to detect",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C11 · Evaluación: 20 % → 17 %",
    "ref": "0.17"
   },
   {
    "id": "z_power",
    "label": "z for 80 % power",
    "unit": "z",
    "kind": "assumption",
    "source": "C11 · Evaluación: (1.96 + 0.84)²",
    "ref": "0.84"
   },
   {
    "id": "rated_share",
    "label": "Share of answers that get a rating",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C11 · Evaluación: si califica ≈ 10 %",
    "ref": "0.1"
   },
   {
    "id": "judge_share",
    "label": "Live answers graded by the judge",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C11 · Monitoreo: groundedness en vivo sobre ≈ 1 %",
    "ref": "0.01"
   },
   {
    "id": "tenant_kv_out",
    "label": "Output tokens held in KV (tenant)",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C11 · Estimaciones: (5,300 + 350) × 320 KiB",
    "ref": "350"
   },
   {
    "id": "c10_design_rps",
    "label": "C10 design peak",
    "unit": "req/s",
    "kind": "requirement",
    "source": "C10 · Estimaciones: diseño 60 rps",
    "ref": "60"
   },
   {
    "id": "c10_in",
    "label": "C10 typical prompt",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C10 · Estimaciones: 1.5 M req × 2,000",
    "ref": "2000"
   },
   {
    "id": "c10_out",
    "label": "C10 typical output",
    "unit": "tokens",
    "kind": "assumption",
    "source": "C10 · Estimaciones: 1.5 M req × 250",
    "ref": "250"
   },
   {
    "id": "c10_ttft_s",
    "label": "C10 TTFT (planning)",
    "unit": "s",
    "kind": "assumption",
    "source": "C10 · Estimaciones: TTFT ≈ 0.5 s",
    "ref": "0.5"
   },
   {
    "id": "c10_tpot_s",
    "label": "C10 TPOT (planning)",
    "unit": "s/token",
    "kind": "assumption",
    "source": "C10 · Estimaciones: 250 tokens × ≈ 40 ms",
    "ref": "0.04"
   },
   {
    "id": "n_layers",
    "label": "Layers (Llama 3.x 70B)",
    "unit": "layers",
    "kind": "requirement",
    "source": "C10 · Estimaciones: 80 capas",
    "ref": "80"
   },
   {
    "id": "n_kv_heads",
    "label": "KV heads",
    "unit": "heads",
    "kind": "requirement",
    "source": "C10 · Estimaciones: 8 heads de KV",
    "ref": "8"
   },
   {
    "id": "head_dim",
    "label": "Head dim",
    "unit": "dims",
    "kind": "requirement",
    "source": "C10 · Estimaciones: head_dim 128",
    "ref": "128"
   },
   {
    "id": "kv_bytes",
    "label": "Bytes per KV element (BF16)",
    "unit": "B",
    "kind": "assumption",
    "source": "C10 · Estimaciones: KV en BF16, 2 B",
    "ref": "2"
   },
   {
    "id": "params_b",
    "label": "Model params (FP8 = 1 B each)",
    "unit": "B params",
    "kind": "requirement",
    "source": "C10 · Estimaciones: 70.6 B parámetros; pesos FP8 ≈ 70.6 GB",
    "ref": "70.6"
   },
   {
    "id": "n_gpu_replica",
    "label": "GPUs per replica (TP=2)",
    "unit": "GPUs",
    "kind": "assumption",
    "source": "C10 · Estimaciones: réplica de 2 × H100 (TP=2)",
    "ref": "2"
   },
   {
    "id": "gpu_mem_gb",
    "label": "H100 memory",
    "unit": "GB",
    "kind": "benchmark",
    "source": "C10 · Estimaciones: H100 (80 GB)",
    "ref": "80"
   },
   {
    "id": "gpu_mem_util",
    "label": "vLLM --gpu-memory-utilization",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C10 · Estimaciones: --gpu-memory-utilization 0.90",
    "ref": "0.9"
   },
   {
    "id": "runtime_gb",
    "label": "Runtime, activations, CUDA graphs",
    "unit": "GB",
    "kind": "assumption",
    "source": "C10 · Estimaciones: ≈ 5 GB entre las dos GPUs",
    "ref": "5"
   },
   {
    "id": "replica_rps",
    "label": "Measured replica capacity within SLOs",
    "unit": "req/s",
    "kind": "benchmark",
    "source": "C10 · Estimaciones: ≈ 6 rps (vllm bench serve; supuesto fuerte)",
    "ref": "6"
   },
   {
    "id": "c10_target_util",
    "label": "Planned utilization",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C10 · Estimaciones: 70 % de 6 = 4.2 rps",
    "ref": "0.7"
   },
   {
    "id": "gpus_per_node",
    "label": "H100 per p5.48xlarge",
    "unit": "GPUs",
    "kind": "benchmark",
    "source": "C10 · Estimaciones: una p5.48xlarge tiene 8 H100 = 4 réplicas",
    "ref": "8"
   },
   {
    "id": "price_p5_h",
    "label": "p5.48xlarge on-demand",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C10 · Estimaciones: ≈ US$55/h (oct. 2026)",
    "ref": "55"
   },
   {
    "id": "hours_month",
    "label": "Cost month",
    "unit": "h",
    "kind": "assumption",
    "source": "C10 · Estimaciones: × 730 h",
    "ref": "730"
   },
   {
    "id": "c10_tokens_month",
    "label": "C10 tokens per month (all tenants)",
    "unit": "tokens/month",
    "kind": "assumption",
    "source": "C10 · Estimaciones: ≈ 158 B tokens/mes",
    "ref": "158000000000"
   }
  ],
  "hibrido": [
   {
    "id": "n_searches_day",
    "label": "Searches per day",
    "unit": "searches/day",
    "kind": "requirement",
    "source": "C07 · Facts (Escala): ≈ 50 M búsquedas al día",
    "ref": "50000000"
   },
   {
    "id": "peak_factor",
    "label": "Peak / average",
    "unit": "×",
    "kind": "requirement",
    "source": "C07 · Facts (Escala): pico de la tarde ≈ 3× el promedio",
    "ref": "3"
   },
   {
    "id": "photo_share",
    "label": "Photo-query share",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C07 · Facts (Escala): ≈ 5 % son por foto",
    "ref": "0.05"
   },
   {
    "id": "n_items",
    "label": "Active listings",
    "unit": "items",
    "kind": "requirement",
    "source": "C07 · Facts (Escala): ≈ 100 M listings activos",
    "ref": "100000000"
   },
   {
    "id": "emb_dim",
    "label": "Embedding dimension",
    "unit": "dims",
    "kind": "requirement",
    "source": "C07 · Facts (Modelo actual): dual encoder tipo CLIP, d = 512",
    "ref": "512"
   },
   {
    "id": "hnsw_m",
    "label": "HNSW M",
    "unit": "neighbors",
    "kind": "assumption",
    "source": "C07 · Estimaciones: grafo HNSW (capa 0), M = 32 → M × 2 × 4 B = 256 B por vector",
    "ref": "32"
   },
   {
    "id": "n_shards",
    "label": "Shards",
    "unit": "shards",
    "kind": "assumption",
    "source": "C07 · Estimaciones: 4 shards de 25 M (por operación, no por memoria)",
    "ref": "4"
   },
   {
    "id": "n_copies",
    "label": "Copies per shard",
    "unit": "copies",
    "kind": "assumption",
    "source": "C07 · Estimaciones: 4 shards × 2 copias, una por máquina, en 2 zonas",
    "ref": "2"
   },
   {
    "id": "target_util",
    "label": "Planned GPU utilization",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C07 · Estimaciones: encoder y reranker planeados al 70 %",
    "ref": "0.7"
   },
   {
    "id": "text_tput_l4",
    "label": "Text tower max per L4 (short query)",
    "unit": "queries/s",
    "kind": "benchmark",
    "source": "C07 · Estimaciones: torre de texto ≈ 5,000 consultas/s por L4 (perf_analyzer)",
    "ref": "5000"
   },
   {
    "id": "img_tput_l4",
    "label": "Image tower max per L4 (224×224)",
    "unit": "img/s",
    "kind": "benchmark",
    "source": "C07 · Estimaciones: torre de imagen ≈ 2,000 img/s por L4",
    "ref": "2000"
   },
   {
    "id": "rerank_tput_l4",
    "label": "Cross-encoder max per L4 (≤ 64 tokens)",
    "unit": "pairs/s",
    "kind": "benchmark",
    "source": "C07 · Estimaciones: reranker ≈ 10,000 pares/s por L4 (supuesto a medir)",
    "ref": "10000"
   },
   {
    "id": "rerank_k",
    "label": "Rerank depth (text only)",
    "unit": "candidates",
    "kind": "assumption",
    "source": "C07 · Estimaciones: reranker top-30 solo para texto",
    "ref": "30"
   },
   {
    "id": "gpu_embed",
    "label": "embed-worker L4s",
    "unit": "GPUs",
    "kind": "assumption",
    "source": "C07 · Estimaciones: embed-worker 1 × L4 + autoscaling por lag",
    "ref": "1"
   },
   {
    "id": "price_r7i_h",
    "label": "r7i.4xlarge on-demand",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C07 · Costo: r7i.4xlarge × US$1.0584/h (us-east-1, verifica)",
    "ref": "1.0584"
   },
   {
    "id": "price_l4_h",
    "label": "g6.xlarge (1 L4) on-demand",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C07 · Costo: g6.xlarge × US$0.805/h",
    "ref": "0.805"
   },
   {
    "id": "budget_month",
    "label": "New-infra budget",
    "unit": "US$/month",
    "kind": "requirement",
    "source": "C07 · Facts (Restricciones): ≈ US$20k al mes de infraestructura nueva",
    "ref": "20000"
   },
   {
    "id": "slo_avail",
    "label": "Search availability SLO",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C07 · Requisitos: disponibilidad 99.9 % (BM25-only cuenta como disponible)",
    "ref": "0.999"
   },
   {
    "id": "judged_queries",
    "label": "Judged queries per round",
    "unit": "queries",
    "kind": "assumption",
    "source": "C07 · Datos: 3,000 consultas × 20 resultados por ronda",
    "ref": "3000"
   },
   {
    "id": "judged_per_query",
    "label": "Judged results per query",
    "unit": "results",
    "kind": "assumption",
    "source": "C07 · Datos: 3,000 consultas × 20 resultados por ronda",
    "ref": "20"
   },
   {
    "id": "price_judgment",
    "label": "Price per human judgment",
    "unit": "US$",
    "kind": "assumption",
    "source": "C07 · Datos: ≈ US$0.05 por juicio",
    "ref": "0.05"
   },
   {
    "id": "contact_rate",
    "label": "Searches ending in contact",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C07 · Datos: ≈ 5 % de las búsquedas termina en contacto; Evaluación: p ≈ 5 %",
    "ref": "0.05"
   },
   {
    "id": "price_s3_gb_month",
    "label": "S3 Standard",
    "unit": "US$/GB-month",
    "kind": "assumption",
    "source": "Hoja de números (costos): S3 Standard ≈ US$0.023/GB-mes; C07 · Arquitectura: ≈ 205 GB FP32 ≈ US$5/mes",
    "ref": "0.023"
   },
   {
    "id": "text_tput_catalog_l4",
    "label": "Text tower per L4 (title + attributes)",
    "unit": "items/s",
    "kind": "benchmark",
    "source": "C07 · Estimaciones: re-embedding, torre de texto ≈ 3,000/s (más largo que una consulta)",
    "ref": "3000"
   },
   {
    "id": "n_gpu_reembed",
    "label": "L4s for the re-embedding job",
    "unit": "GPUs",
    "kind": "assumption",
    "source": "C07 · Estimaciones: re-embedding en 8 L4",
    "ref": "8"
   },
   {
    "id": "decode_cpu_ms",
    "label": "JPEG decode CPU per thumbnail",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Estimaciones: 16,000 img/s × ≈ 1.5 ms de CPU",
    "ref": "1.5"
   },
   {
    "id": "heap_gb",
    "label": "OpenSearch heap",
    "unit": "GB",
    "kind": "assumption",
    "source": "C07 · Estimaciones: heap de OpenSearch ≈ 16 GB (supuesto)",
    "ref": "16"
   },
   {
    "id": "engine_overhead",
    "label": "Engine overhead on graph + int8",
    "unit": "×",
    "kind": "assumption",
    "source": "C07 · Estimaciones: + ≈ 10 % de overhead (OpenSearch estima ≈ 1.1×)",
    "ref": "1.1"
   },
   {
    "id": "node_ram_gb",
    "label": "r7i.4xlarge RAM",
    "unit": "GB",
    "kind": "benchmark",
    "source": "C07 · Estimaciones: r7i.4xlarge 128 GiB ≈ 137 GB",
    "ref": "137"
   },
   {
    "id": "node_vcpu",
    "label": "r7i.4xlarge vCPU",
    "unit": "vCPU",
    "kind": "benchmark",
    "source": "C07 · Estimaciones: 16 vCPU, 128 GiB",
    "ref": "16"
   },
   {
    "id": "ann_cpu_ms",
    "label": "ANN CPU per query per shard",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Estimaciones: ≈ 2 ms por consulta en un shard de 25 M (HNSW int8 + rescoring)",
    "ref": "2"
   },
   {
    "id": "rescore_k",
    "label": "FP32 rescoring candidates per shard",
    "unit": "candidates",
    "kind": "assumption",
    "source": "C07 · Estimaciones: rescorear el top-200 con FP32",
    "ref": "200"
   },
   {
    "id": "new_items_day",
    "label": "New listings per day",
    "unit": "items/day",
    "kind": "requirement",
    "source": "C07 · Facts (Escala): ≈ 2.5 M listings nuevos al día",
    "ref": "2500000"
   },
   {
    "id": "edits_day",
    "label": "Title / main-photo edits per day",
    "unit": "items/day",
    "kind": "assumption",
    "source": "C07 · Estimaciones: ediciones de título o foto principal ≈ 0.5 M/día",
    "ref": "500000"
   },
   {
    "id": "removals_day",
    "label": "Sold / expired / removed per day",
    "unit": "items/day",
    "kind": "requirement",
    "source": "C07 · Facts (Escala): salen otros tantos (≈ 2.5 M/día)",
    "ref": "2500000"
   },
   {
    "id": "ab_rel_lift",
    "label": "Minimum detectable lift (relative)",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C07 · Evaluación: +2 % relativo en contactos por búsqueda",
    "ref": "0.02"
   },
   {
    "id": "ab_traffic_share",
    "label": "Traffic per A/B arm",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C07 · Evaluación: 10 % del tráfico por brazo",
    "ref": "0.1"
   },
   {
    "id": "rollback_days",
    "label": "Blue kept for rollback",
    "unit": "days",
    "kind": "assumption",
    "source": "C07 · Serving: blue queda 7 días para rollback",
    "ref": "7"
   },
   {
    "id": "p_target",
    "label": "Query latency percentile",
    "unit": "quantile",
    "kind": "requirement",
    "source": "C07 · Requisitos: latencia texto p99 ≤ 300 ms",
    "ref": "0.99"
   },
   {
    "id": "p99_text_ms",
    "label": "Text p99 server-side",
    "unit": "ms",
    "kind": "requirement",
    "source": "C07 · Requisitos: p99 ≤ 300 ms del lado del servidor",
    "ref": "300"
   },
   {
    "id": "t_parse_ms",
    "label": "Receive / validate / split filters",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: presupuesto de una consulta de texto, ≈ 2 ms",
    "ref": "2"
   },
   {
    "id": "t_cache_ms",
    "label": "Query cache lookup",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: caché ≈ 1–2 ms (camino crítico usa 2)",
    "ref": "2"
   },
   {
    "id": "t_bm25_ms",
    "label": "BM25 with filters",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: BM25 con filtros ≈ 40 ms",
    "ref": "40"
   },
   {
    "id": "t_enc_ms",
    "label": "Text encoder incl. network",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: encoder 15 ms en el camino crítico",
    "ref": "15"
   },
   {
    "id": "t_ann_ms",
    "label": "ANN scatter-gather",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: ANN 25 ms en el camino crítico",
    "ref": "25"
   },
   {
    "id": "t_tomb_ms",
    "label": "Tombstone check",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: tombstones ≈ 1–2 ms",
    "ref": "2"
   },
   {
    "id": "t_rrf_ms",
    "label": "RRF + rules",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: RRF + reglas ≈ 10 ms",
    "ref": "10"
   },
   {
    "id": "t_rerank_ms",
    "label": "Reranker top-30",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: reranker top-30 ≈ 25 ms",
    "ref": "25"
   },
   {
    "id": "t_hydrate_ms",
    "label": "Hydrate 48 results",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Serving: hidratar 48 resultados ≈ 10 ms",
    "ref": "10"
   },
   {
    "id": "photo_decode_ms",
    "label": "Photo decode + resize CPU",
    "unit": "ms",
    "kind": "assumption",
    "source": "C07 · Estimaciones: ≈ 90 fotos/s × ≈ 15 ms",
    "ref": "15"
   },
   {
    "id": "burn_fast",
    "label": "Fast-burn factor (1 h)",
    "unit": "×",
    "kind": "assumption",
    "source": "M12 · SLOs, error budget y burn rate: 2 % del presupuesto en 1 h → 14.4×",
    "ref": "14.4"
   },
   {
    "id": "backlog_thr_min",
    "label": "EmbedWorkerBacklog threshold",
    "unit": "min",
    "kind": "assumption",
    "source": "C07 · Monitoreo: atraso del consumer group > 3 min",
    "ref": "3"
   },
   {
    "id": "backlog_for_min",
    "label": "EmbedWorkerBacklog for",
    "unit": "min",
    "kind": "assumption",
    "source": "C07 · Monitoreo: … durante 10 min",
    "ref": "10"
   }
  ],
  "streaming": [
   {
    "id": "meetings_day",
    "label": "Meetings per day",
    "unit": "meetings/day",
    "kind": "requirement",
    "source": "C13 · Facts (Escala): ≈ 2 M de reuniones al día",
    "ref": "2000000"
   },
   {
    "id": "caption_share",
    "label": "Meetings with captions",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C13 · Facts (Escala): ≈ 30 % activa subtítulos",
    "ref": "0.3"
   },
   {
    "id": "meeting_min",
    "label": "Average meeting length",
    "unit": "min",
    "kind": "requirement",
    "source": "C13 · Facts (Escala): 40 min en promedio",
    "ref": "40"
   },
   {
    "id": "participants",
    "label": "Participants per meeting",
    "unit": "tracks",
    "kind": "requirement",
    "source": "C13 · Facts (Escala): ≈ 4 participantes",
    "ref": "4"
   },
   {
    "id": "peak_factor",
    "label": "Peak / average",
    "unit": "×",
    "kind": "requirement",
    "source": "C13 · Facts (Escala): pico ≈ 3× el promedio",
    "ref": "3"
   },
   {
    "id": "speakers_per_meeting",
    "label": "Concurrent speakers per meeting",
    "unit": "speakers",
    "kind": "requirement",
    "source": "C13 · Facts (Escala): hablan en promedio ≈ 1.2 personas por reunión",
    "ref": "1.2"
   },
   {
    "id": "streams_max_l4",
    "label": "Max streams per L4 (160 ms chunks)",
    "unit": "streams",
    "kind": "benchmark",
    "source": "C13 · Estimaciones: máximo por L4 ≈ 500 streams (supuesto fuerte: lo primero que mides)",
    "ref": "500"
   },
   {
    "id": "target_util",
    "label": "Planned GPU utilization",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C13 · Estimaciones: planeado al 70 % de lo medido",
    "ref": "0.7"
   },
   {
    "id": "chunk_ms",
    "label": "Chunk size",
    "unit": "ms",
    "kind": "assumption",
    "source": "C13 · Estimaciones / Serving: fragmentos de 160 ms",
    "ref": "160"
   },
   {
    "id": "fleet_avg_l4",
    "label": "Billed L4 fleet, average",
    "unit": "GPUs",
    "kind": "assumption",
    "source": "C13 · Estimaciones: la flota facturada promedia ≈ 94–100 L4 (costea con ≈ 100)",
    "ref": "100"
   },
   {
    "id": "price_l4_h",
    "label": "g6.xlarge (1 L4) on-demand",
    "unit": "US$/h",
    "kind": "assumption",
    "source": "C13 · Estimaciones: g6.xlarge ≈ US$0.805/h on-demand",
    "ref": "0.805"
   },
   {
    "id": "api_price_min",
    "label": "Managed streaming API, list",
    "unit": "US$/min",
    "kind": "assumption",
    "source": "C13 · Estimaciones: Amazon Transcribe streaming US$0.01/min (lista, oct. 2026)",
    "ref": "0.01"
   },
   {
    "id": "opus_kbps",
    "label": "SFU → gateway per track",
    "unit": "kb/s",
    "kind": "assumption",
    "source": "C13 · Estimaciones: Opus ≈ 32 kb/s + RTP/gRPC ≈ 16 kb/s",
    "ref": "48"
   },
   {
    "id": "slo_avail",
    "label": "Captioned-minute availability",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C13 · Requisitos: ≥ 99.5 % de los minutos con subtítulos activados tienen subtítulos",
    "ref": "0.995"
   },
   {
    "id": "save_share",
    "label": "Captioned minutes with \"save\" on",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C13 · Estimaciones (Almacenamiento): 40 % con “guardar” activado",
    "ref": "0.4"
   },
   {
    "id": "transcript_kb_min",
    "label": "Transcript + metadata per minute",
    "unit": "KB/min",
    "kind": "assumption",
    "source": "C13 · Estimaciones (Almacenamiento): ≈ 3 KB/min",
    "ref": "3"
   },
   {
    "id": "retention_days",
    "label": "Transcript retention",
    "unit": "days",
    "kind": "requirement",
    "source": "C13 · Facts (Restricciones): se retienen ≈ 30 días",
    "ref": "30"
   },
   {
    "id": "words_per_min",
    "label": "Speech rate",
    "unit": "words/min",
    "kind": "assumption",
    "source": "C13 · Datos: ≈ 140 palabras por minuto",
    "ref": "140"
   },
   {
    "id": "wer_ref",
    "label": "Reference WER for a slice",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C13 · Datos: con un WER de 15 %; Requisitos: ≤ 12–15 % (es, pt)",
    "ref": "0.15"
   },
   {
    "id": "slice_ceiling",
    "label": "Worst slice vs language average",
    "unit": "×",
    "kind": "requirement",
    "source": "C13 · Requisitos: ningún slice peor que 1.5× el promedio de su idioma",
    "ref": "1.5"
   },
   {
    "id": "n_layers",
    "label": "Encoder layers (FastConformer 0.6 B)",
    "unit": "layers",
    "kind": "assumption",
    "source": "C13 · Serving: 24 × 56 × 1,024 × 2 B ≈ 2.8 MB",
    "ref": "24"
   },
   {
    "id": "ctx_frames",
    "label": "Left-context frames cached",
    "unit": "frames",
    "kind": "assumption",
    "source": "C13 · Serving: 24 × 56 × 1,024 × 2 B (att_context_size [56, 1])",
    "ref": "56"
   },
   {
    "id": "d_model",
    "label": "Model width",
    "unit": "dims",
    "kind": "assumption",
    "source": "C13 · Serving: 24 × 56 × 1,024 × 2 B",
    "ref": "1024"
   },
   {
    "id": "l4_vram_gb",
    "label": "L4 VRAM",
    "unit": "GB",
    "kind": "benchmark",
    "source": "C13 · Serving: poco frente a 24 GB de la L4",
    "ref": "24"
   },
   {
    "id": "sample_rate_hz",
    "label": "PCM sample rate to workers",
    "unit": "Hz",
    "kind": "assumption",
    "source": "C13 · Estimaciones (Red): PCM 16 kHz, 16 bits",
    "ref": "16000"
   },
   {
    "id": "bits_per_sample",
    "label": "PCM bits per sample",
    "unit": "bits",
    "kind": "assumption",
    "source": "C13 · Estimaciones (Red): PCM 16 kHz, 16 bits",
    "ref": "16"
   },
   {
    "id": "gw_cpu_ms_voice",
    "label": "Gateway CPU per second of voiced audio",
    "unit": "ms/s",
    "kind": "assumption",
    "source": "C13 · Estimaciones (CPU): ≈ 3 ms por segundo de audio",
    "ref": "3"
   },
   {
    "id": "gw_cpu_ms_idle",
    "label": "Gateway CPU per second, silent track",
    "unit": "ms/s",
    "kind": "assumption",
    "source": "C13 · Estimaciones (CPU): 130k × 0.3 ms (solo recibir paquetes)",
    "ref": "0.3"
   },
   {
    "id": "vad_hangover",
    "label": "Extra decoded tracks (VAD hangover)",
    "unit": "tracks",
    "kind": "assumption",
    "source": "C13 · Estimaciones (CPU): ≈ 70k (60k + hangover)",
    "ref": "10000"
   },
   {
    "id": "rho_cpu",
    "label": "Gateway planned CPU utilization",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C13 · Estimaciones (CPU): planeadas al ≈ 60 %",
    "ref": "0.6"
   },
   {
    "id": "vcpu_node",
    "label": "vCPU per c6i.xlarge",
    "unit": "vCPU",
    "kind": "benchmark",
    "source": "C13 · Estimaciones (CPU): ≈ 105 × c6i.xlarge para 420 vCPU",
    "ref": "4"
   },
   {
    "id": "session_kb",
    "label": "Gateway memory per session",
    "unit": "KB",
    "kind": "assumption",
    "source": "C13 · Estimaciones (CPU): ≈ 100–300 KB por sesión (200k × 300 KB ≈ 60 GB)",
    "ref": "300"
   },
   {
    "id": "max_streams_frac",
    "label": "Hard stream cap / estimated max",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C13 · Serving: MAX_STREAMS = 450, 90 % de los 500 estimados",
    "ref": "0.9"
   },
   {
    "id": "phrase_max_s",
    "label": "Max phrase length",
    "unit": "s",
    "kind": "assumption",
    "source": "C13 · Serving: tope de 20 s por frase",
    "ref": "20"
   },
   {
    "id": "endpoint_s",
    "label": "Endpointing silence",
    "unit": "s",
    "kind": "assumption",
    "source": "C13 · Serving: 600 ms de silencio",
    "ref": "0.6"
   },
   {
    "id": "prestop_s",
    "label": "preStop drain wait",
    "unit": "s",
    "kind": "assumption",
    "source": "C13 · Serving: el preStop de la referencia espera hasta 60 s",
    "ref": "60"
   },
   {
    "id": "max_sessions",
    "label": "Sessions cap per worker",
    "unit": "sessions",
    "kind": "assumption",
    "source": "C13 · Serving: MAX_SESSIONS = 1,500 en la referencia",
    "ref": "1500"
   },
   {
    "id": "cross_zone_share",
    "label": "Sessions crossing zones without affinity",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C13 · Estimaciones (quiz): con 2/3 de las sesiones cruzando",
    "ref": "0.6667"
   },
   {
    "id": "price_xaz_gb",
    "label": "Cross-AZ transfer (both directions)",
    "unit": "US$/GB",
    "kind": "assumption",
    "source": "C13 · Estimaciones (Red): US$0.01/GB en cada sentido (M13)",
    "ref": "0.02"
   },
   {
    "id": "canary_share",
    "label": "Canary share of new sessions",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C13 · Arquitectura: el router le manda un 5 % de las sesiones nuevas (de español) al grupo canary",
    "ref": "0.05"
   },
   {
    "id": "t_capture_ms",
    "label": "Capture + Opus encode",
    "unit": "ms",
    "kind": "assumption",
    "source": "C13 · Estimaciones: presupuesto de un parcial, típico ≈ 25 ms",
    "ref": "25"
   },
   {
    "id": "t_net_ms",
    "label": "Network one way (client ↔ region)",
    "unit": "ms",
    "kind": "assumption",
    "source": "C13 · Estimaciones: red cliente → SFU ≈ 60 ms (y la vuelta igual)",
    "ref": "60"
   },
   {
    "id": "t_gw_ms",
    "label": "SFU → gateway, decode, VAD",
    "unit": "ms",
    "kind": "assumption",
    "source": "C13 · Estimaciones: ≈ 5 ms",
    "ref": "5"
   },
   {
    "id": "t_queue_ms",
    "label": "Queue + sequence batching",
    "unit": "ms",
    "kind": "assumption",
    "source": "C13 · Estimaciones: ≈ 15 ms",
    "ref": "15"
   },
   {
    "id": "t_step_ms",
    "label": "Model step",
    "unit": "ms",
    "kind": "assumption",
    "source": "C13 · Estimaciones: cómputo del paso ≈ 25 ms",
    "ref": "25"
   },
   {
    "id": "t_bus_ms",
    "label": "caption-bus + signaling",
    "unit": "ms",
    "kind": "assumption",
    "source": "C13 · Estimaciones: ≈ 15 ms",
    "ref": "15"
   },
   {
    "id": "t_render_ms",
    "label": "Client render",
    "unit": "ms",
    "kind": "assumption",
    "source": "C13 · Estimaciones: un frame de la UI ≈ 16 ms",
    "ref": "16"
   },
   {
    "id": "p95_partial_ms",
    "label": "Partials p95 end to end",
    "unit": "ms",
    "kind": "requirement",
    "source": "C13 · Requisitos: parciales p95 ≤ 500 ms",
    "ref": "500"
   },
   {
    "id": "partials_per_s",
    "label": "Max partials per stream",
    "unit": "msg/s",
    "kind": "assumption",
    "source": "C13 · Estimaciones: ≤ 5 por segundo (solo si el texto cambió)",
    "ref": "5"
   },
   {
    "id": "partial_bytes",
    "label": "Bytes per caption message",
    "unit": "B",
    "kind": "assumption",
    "source": "C13 · Estimaciones: 1.2 M × ≈ 200 B",
    "ref": "200"
   },
   {
    "id": "phrase_s",
    "label": "Average phrase length",
    "unit": "s",
    "kind": "assumption",
    "source": "C13 · Estimaciones: 60k ÷ ≈ 4 s por frase",
    "ref": "4"
   },
   {
    "id": "burn_fast",
    "label": "Fast-burn factor (1 h)",
    "unit": "×",
    "kind": "assumption",
    "source": "M12 · SLOs, error budget y burn rate: 2 % del presupuesto en 1 h → 14.4×",
    "ref": "14.4"
   },
   {
    "id": "step_alert_frac",
    "label": "Step-time alert / chunk",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C13 · Monitoreo: GPUStreamSaturation, paso > 128 ms (80 % del fragmento de 160 ms)",
    "ref": "0.8"
   },
   {
    "id": "canary_words",
    "label": "Reference words for CanaryWERRegression",
    "unit": "words",
    "kind": "assumption",
    "source": "C13 · Monitoreo: con ≥ 5,000 palabras de referencia, durante 30 min",
    "ref": "5000"
   }
  ],
  "edge": [
   {
    "id": "pieces_per_s",
    "label": "Pieces per second per line",
    "unit": "pieces/s",
    "kind": "requirement",
    "source": "C03 · Facts (Escala): 2 piezas/s (120 por minuto)",
    "ref": "2"
   },
   {
    "id": "shift_h",
    "label": "Shift length",
    "unit": "h",
    "kind": "requirement",
    "source": "C03 · Facts (Escala): 2 turnos de 8 h",
    "ref": "8"
   },
   {
    "id": "n_shifts",
    "label": "Shifts per day",
    "unit": "shifts",
    "kind": "requirement",
    "source": "C03 · Facts (Escala): 2 turnos de 8 h; de noche no se produce",
    "ref": "2"
   },
   {
    "id": "n_lines",
    "label": "Lines",
    "unit": "lines",
    "kind": "requirement",
    "source": "C03 · Facts (Escala): 4 líneas",
    "ref": "4"
   },
   {
    "id": "defect_rate",
    "label": "Defect rate",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C03 · Facts (Escala): tasa de defectos ≈ 0.5 %",
    "ref": "0.005"
   },
   {
    "id": "belt_mps",
    "label": "Belt speed",
    "unit": "m/s",
    "kind": "requirement",
    "source": "C03 · Facts (Latencia): banda a 0.6 m/s",
    "ref": "0.6"
   },
   {
    "id": "cam_gate_m",
    "label": "Camera → diverter distance",
    "unit": "m",
    "kind": "requirement",
    "source": "C03 · Facts (Latencia): la cámara puede ir 0.3 m antes del desviador",
    "ref": "0.3"
   },
   {
    "id": "plc_ms",
    "label": "PLC + valve + diverter",
    "unit": "ms",
    "kind": "requirement",
    "source": "C03 · Facts (Latencia): decisión 150 ms antes de la compuerta",
    "ref": "150"
   },
   {
    "id": "t_acq_ms",
    "label": "Trigger → image in memory",
    "unit": "ms",
    "kind": "assumption",
    "source": "C03 · Estimaciones (deadline): ≈ 50 ms",
    "ref": "50"
   },
   {
    "id": "t_pre_ms",
    "label": "Preprocessing (crop, normalize, tiles)",
    "unit": "ms",
    "kind": "assumption",
    "source": "C03 · Estimaciones (deadline): ≈ 20 ms",
    "ref": "20"
   },
   {
    "id": "t_inf_ms",
    "label": "TensorRT inference, 20 tiles",
    "unit": "ms",
    "kind": "benchmark",
    "source": "C03 · Estimaciones (deadline): ≤ 120 ms (presupuesto; mídelo con trtexec)",
    "ref": "120"
   },
   {
    "id": "t_plc_ms",
    "label": "Decision + Modbus TCP write",
    "unit": "ms",
    "kind": "assumption",
    "source": "C03 · Estimaciones (deadline): ≈ 10 ms",
    "ref": "10"
   },
   {
    "id": "write_reserve_ms",
    "label": "Write reserve before deadline",
    "unit": "ms",
    "kind": "assumption",
    "source": "C03 · Serving: reserva de 50 ms (2 × 20 ms de timeout del PLC)",
    "ref": "50"
   },
   {
    "id": "inspect_s",
    "label": "Inspector time per piece",
    "unit": "s",
    "kind": "requirement",
    "source": "C03 · Facts (Modelo actual): el inspector revisa ≈ 1 pieza cada 15 s",
    "ref": "15"
   },
   {
    "id": "fp_target",
    "label": "False-positive target",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C03 · Requisitos: FP ≤ 1.5 % de las piezas buenas",
    "ref": "0.015"
   },
   {
    "id": "recall_target",
    "label": "Recall per defect type",
    "unit": "fraction",
    "kind": "requirement",
    "source": "C03 · Facts: recall ≥ 99.5 % por tipo de defecto",
    "ref": "0.995"
   },
   {
    "id": "img_w_px",
    "label": "Image width",
    "unit": "px",
    "kind": "assumption",
    "source": "C03 · Estimaciones: cámara mono 5 MP, 2,448 × 2,048",
    "ref": "2448"
   },
   {
    "id": "img_h_px",
    "label": "Image height",
    "unit": "px",
    "kind": "assumption",
    "source": "C03 · Estimaciones: 2,448 × 2,048",
    "ref": "2048"
   },
   {
    "id": "fov_mm",
    "label": "Field of view, long side",
    "unit": "mm",
    "kind": "assumption",
    "source": "C03 · Estimaciones: campo de visión de 150 mm (supuesto)",
    "ref": "150"
   },
   {
    "id": "crack_mm",
    "label": "Finest crack that matters",
    "unit": "mm",
    "kind": "requirement",
    "source": "C03 · Facts (Entrada): fisuras de ≈ 0.2 mm",
    "ref": "0.2"
   },
   {
    "id": "downscale_px",
    "label": "Downscaled width (rejected option)",
    "unit": "px",
    "kind": "assumption",
    "source": "C03 · Estimaciones: si reduces la imagen a 1,024 px de ancho",
    "ref": "1024"
   },
   {
    "id": "tile_px",
    "label": "Tile size",
    "unit": "px",
    "kind": "assumption",
    "source": "C03 · Estimaciones: tiles de 512 × 512 sin reducir",
    "ref": "512"
   },
   {
    "id": "gige_mbyte_s",
    "label": "Effective 1 GigE throughput",
    "unit": "MB/s",
    "kind": "benchmark",
    "source": "C03 · Estimaciones: ≈ 115–120 MB/s; transferencia 5.0 MB ÷ ≈ 117 MB/s",
    "ref": "117"
   },
   {
    "id": "record_bytes",
    "label": "Decision record size",
    "unit": "B",
    "kind": "assumption",
    "source": "C03 · Estimaciones (Almacenamiento): 115,200 × ≈ 300 B",
    "ref": "300"
   },
   {
    "id": "approved_share",
    "label": "Approved-piece sample",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C03 · Estimaciones (Almacenamiento): muestra de aprobadas (1 %)",
    "ref": "0.01"
   },
   {
    "id": "label_s",
    "label": "Inspector label time",
    "unit": "s",
    "kind": "assumption",
    "source": "C03 · Datos: el label cuesta ≈ 2 s",
    "ref": "2"
   },
   {
    "id": "offline_h",
    "label": "Required offline operation",
    "unit": "h",
    "kind": "requirement",
    "source": "C03 · Facts (Latencia): ≥ 72 h sin nube",
    "ref": "72"
   },
   {
    "id": "link_free_mbps",
    "label": "Free uplink for catch-up",
    "unit": "Mb/s",
    "kind": "assumption",
    "source": "C03 · Estimaciones (Almacenamiento): ≈ 50 Mb/s libres",
    "ref": "50"
   },
   {
    "id": "hw_capex_usd",
    "label": "Hardware (4 stations + PPE box + CI Jetson), high end",
    "unit": "US$",
    "kind": "assumption",
    "source": "C03 · Costo: ≈ US$15–30.5k (se usa el extremo alto)",
    "ref": "30500"
   },
   {
    "id": "amort_months",
    "label": "Amortization period",
    "unit": "months",
    "kind": "assumption",
    "source": "C03 · Costo: amortizado en 36 meses",
    "ref": "36"
   },
   {
    "id": "cloud_month",
    "label": "Cloud spend, high end",
    "unit": "US$/month",
    "kind": "assumption",
    "source": "C03 · Costo: nube ≈ US$200–500/mes (extremo alto)",
    "ref": "500"
   },
   {
    "id": "incident_min_usd",
    "label": "Escape incident, low end",
    "unit": "US$",
    "kind": "requirement",
    "source": "C03 · Facts (Modelo actual): incidente de ≈ US$2,000–10,000",
    "ref": "2000"
   },
   {
    "id": "defects_pilot",
    "label": "Defect images from the pilot",
    "unit": "images",
    "kind": "requirement",
    "source": "C03 · Facts (Datos): ≈ 300 de defectos",
    "ref": "300"
   },
   {
    "id": "n_defect_types",
    "label": "Defect types",
    "unit": "types",
    "kind": "requirement",
    "source": "C03 · Facts (Entrada): fisura, rebaba, barreno faltante o deformación",
    "ref": "4"
   },
   {
    "id": "part_id_space",
    "label": "part_id values (16 bits)",
    "unit": "ids",
    "kind": "assumption",
    "source": "C03 · Archivos: el part_id es de 16 bits y se repite cada 65,536 piezas",
    "ref": "65536"
   },
   {
    "id": "p_target",
    "label": "Percentile a naive SLO would use",
    "unit": "quantile",
    "kind": "assumption",
    "source": "C03 · Estimaciones (trampa): un p99 deja 1,152 piezas/día por encima",
    "ref": "0.99"
   },
   {
    "id": "divert_alert_frac",
    "label": "Error-DIVERT alert share of pieces",
    "unit": "fraction",
    "kind": "assumption",
    "source": "C03 · Monitoreo: > 0.02 (≈ 1 % de las piezas a 2 por segundo)",
    "ref": "0.01"
   },
   {
    "id": "reject_spike",
    "label": "Reject spike (dirty lens, light)",
    "unit": "×",
    "kind": "assumption",
    "source": "C03 · Estimaciones / Monitoreo: pico de rechazo 2×; RejectRateSpike > 2× base",
    "ref": "2"
   }
  ]
 }
};
