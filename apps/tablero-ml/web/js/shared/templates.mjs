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
   "name": "Online síncrono",
   "case": "c01",
   "cases": [
    "c01",
    "c09",
    "c15"
   ],
   "summary": "Alguien espera la respuesta en milisegundos: load balancer, gateway en CPU y model server en GPU, con timeouts y fallback. Es el C01 completo: sus 12 estaciones, del dato al monitoreo.",
   "removed": [],
   "links": [
    {
     "label": "Curso · C01 · API de clasificación · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.arquitectura"
    },
    {
     "label": "Curso · M02 · Patrones de inferencia · Online síncrona (request/response)",
     "href": "https://ronda-diseno-ml.vercel.app/#m02.online-sincrona"
    },
    {
     "label": "Hoja · Del dato a producción · mapa del C01",
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
   "summary": "Las ventas, el calendario y las promociones existen antes y nadie espera en línea: un job programado pronostica cada noche las 4.8 M series y a las 04:00 el ERP lee una tabla ya publicada. Frente al C01 desaparecen el export, la request y el autoscaling, y aparece lo que protege una ventana fija: sensores con hora de corte, un gate de salida, la publicación atómica y un fallback que nunca deja al ERP sin pronóstico.",
   "speeds": "No hay línea de milisegundos: nadie llama en línea. Aparece una línea diaria con hora límite: la corrida nocturna, de 00:30 a 03:30, antes de que el ERP lea a las 04:00. El modelo se reentrena cada domingo (≈ 2–3 h en spot) y el código sale en días. La operación mira dos relojes: la noche (minutos, page) y la precisión (días, cuando llegan las ventas; ticket).",
   "removed": [
    {
     "id": "export",
     "why": "El GBDT predice en CPU con la misma imagen que lo entrena: no hay ONNX ni TensorRT."
    },
    {
     "id": "request",
     "why": "Nadie llama en línea: el ERP lee la vista `forecast_current` a las 04:00, por fecha objetivo."
    }
   ],
   "links": [
    {
     "label": "Curso · C14 · Pronóstico de demanda · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c14.arquitectura"
    },
    {
     "label": "Curso · C14 · Pronóstico de demanda · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
    },
    {
     "label": "Curso · C14 · Pronóstico de demanda · Monitoreo, alertas y reentrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c14.monitoreo"
    },
    {
     "label": "Curso · M02 · Patrones de inferencia · Batch: precomputar en vez de servir",
     "href": "https://ronda-diseno-ml.vercel.app/#m02.batch"
    },
    {
     "label": "Hoja · Del dato a producción · patrón batch",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
    }
   ]
  },
  "llm": {
   "name": "LLMs y RAG",
   "case": "c11",
   "cases": [
    "c10",
    "c11",
    "c12"
   ],
   "summary": "En RAG casi nada se entrena: el LLM ya existe y lo sirve la plataforma del C10 (`llm-gateway` → vLLM), y el C11 es un tenant más. El trabajo se mueve a la ingestión (conectores, chunking, embeddings y permisos) y a la evaluación con un golden set, porque ahí están los errores que el LLM no puede arreglar. La request pasa de milisegundos a segundos, con streaming de tokens y citas.",
   "speeds": "La línea de semanas no entrena: la reemplaza la ingestión continua (frescura p95 ≤ 15 min, revocaciones en ≤ 5 min) y, cada trimestre, la evaluación de embeddings candidatos. La de días mueve código, prompt, índice o la revisión del LLM, todos por el mismo gate. La de milisegundos se vuelve de segundos (retrieval + rerank p95 ≤ 700 ms, primer token p95 ≤ 2.5 s). La continua corre el probe de permisos cada pocos minutos y el canary de groundedness cada 4 h.",
   "removed": [
    {
     "id": "entrenamiento",
     "why": "El LLM (`chat-default` del C10) y el modelo de embeddings vienen hechos; en su lugar se embeben ≈ 12 M chunks (≈ 44 L4-horas)."
    },
    {
     "id": "export",
     "why": "No hay ONNX ni TensorRT propios: en la plataforma del C10, vLLM carga pesos FP8 de una revisión fijada, copiados de S3 al NVMe y verificados con sha256."
    }
   ],
   "links": [
    {
     "label": "Curso · C11 · RAG empresarial · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
    },
    {
     "label": "Curso · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
    },
    {
     "label": "Curso · C11 · RAG empresarial · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
    },
    {
     "label": "Curso · C10 · Servir un LLM propio · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c10.arquitectura"
    },
    {
     "label": "Curso · M14 · Sistemas con LLMs · RAG: el modelo con tus documentos",
     "href": "https://ronda-diseno-ml.vercel.app/#m14.rag"
    },
    {
     "label": "Hoja · Del dato a producción · patrón LLM",
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
   "summary": "Es streaming inference sobre una conexión larga, no stream processing sobre Kafka: cada participante abre una sesión y manda audio en fragmentos de 160 ms mientras el modelo avanza con estado en una GPU. Por eso cambian el balanceo (por streams activos, con afinidad), el autoscaling (sube por sesiones y baja drenando) y el monitoreo (latencia de parciales y un canary que habla en producción, porque el audio de clientes no se guarda).",
   "speeds": "La línea de milisegundos dura lo que la reunión: un fragmento cada 160 ms, parciales p95 ≤ 500 ms y sesiones de horas. La continua sigue la curva del día (≈ 60 L4 de noche, ≈ 172 en el pico) con un cron antes de la rampa de la mañana. La del modelo hace fine-tune por idioma cuando un disparador lo pide, revisa cada trimestre y entra por canary de sesiones nuevas.",
   "removed": [],
   "links": [
    {
     "label": "Curso · C13 · Speech-to-text en vivo · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c13.arquitectura"
    },
    {
     "label": "Curso · C13 · Speech-to-text en vivo · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
    },
    {
     "label": "Curso · C13 · Speech-to-text en vivo · Monitoreo, alertas y reentrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c13.monitoreo"
    },
    {
     "label": "Curso · M02 · Patrones de inferencia · Streaming: inferencia sobre eventos",
     "href": "https://ronda-diseno-ml.vercel.app/#m02.streaming"
    },
    {
     "label": "Hoja · Del dato a producción · patrón streaming",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
    }
   ]
  },
  "edge": {
   "name": "Edge y on-device",
   "case": "c03",
   "cases": [
    "c02",
    "c03"
   ],
   "summary": "El modelo corre junto a la línea, en un Jetson, porque la línea no espera a la red ni puede parar si se cae internet; la nube entrena y monitorea. Nada de la nube está en el camino de una pieza: Kubernetes y el autoscaling desaparecen (4 dispositivos fijos con Docker), el release se vuelve OTA a una flota a través de la DMZ y el monitoreo funciona sin internet.",
   "speeds": "La línea de milisegundos vive en el dispositivo y es dura: 2 piezas/s por línea y decisión en ≤ 350 ms, sin red. La del modelo es mensual (o antes, por una variante o un defecto nuevo, drift o un escape que reporta la armadora) y llega en días: descarga de noche, un turno en shadow, canary y las 4 líneas. La continua es local (Prometheus y andon en la planta) y lo demás sube a la nube cuando hay enlace.",
   "removed": [
    {
     "id": "kubernetes",
     "why": "4 dispositivos fijos no justifican Kubernetes: Docker con restart policy y un watchdog. Tampoco hay autoscaling: se dimensiona por dispositivo."
    }
   ],
   "links": [
    {
     "label": "Curso · C03 · Inspección visual en planta · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c03.arquitectura"
    },
    {
     "label": "Curso · C03 · Inspección visual en planta · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
    },
    {
     "label": "Curso · C03 · Inspección visual en planta · Monitoreo, alertas y reentrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c03.monitoreo"
    },
    {
     "label": "Curso · M02 · Patrones de inferencia · Edge / on-device",
     "href": "https://ronda-diseno-ml.vercel.app/#m02.edge"
    },
    {
     "label": "Hoja · Del dato a producción · patrón edge",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
    }
   ]
  },
  "asincrono": {
   "name": "Asíncrono con colas",
   "case": "c04",
   "cases": [
    "c04",
    "c05"
   ],
   "summary": "Nadie espera la segmentación en milisegundos: una lámina ocupa la GPU ≈ 20–30 s y el resultado espera al patólogo, así que el archivo publica un evento, una cola SQS absorbe las ráfagas de los escáneres y KEDA escala los workers GPU de 0 a 4. Frente al C01 desaparece la request en ms (el SLO es turnaround p95 ≤ 60 min) y cambian casi todas las estaciones; aparecen la cola con DLQ, los resultados versionados que lee el visor y la revisión del experto, que alimenta los labels. El C05 usa el mismo patrón con otra entrada (`docs-api` responde 202 tras un quality gate síncrono) y otra orquestación: una ejecución de Step Functions por documento, todo en CPU.",
   "removed": [
    {
     "id": "request",
     "why": "Nadie espera una respuesta en ms: la lámina se procesa en ≈ 20–30 s y el patólogo abre el caso después, así que la request síncrona se reemplaza por evento → cola → worker → resultados que el visor lee."
    }
   ],
   "links": [
    {
     "label": "Curso · C04 · Segmentación de imágenes · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c04.arquitectura"
    },
    {
     "label": "Hoja · Del dato a producción · casos asíncronos",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-asincrono"
    }
   ]
  },
  "hibrido": {
   "name": "Híbridos",
   "case": "c07",
   "cases": [
    "c07",
    "c06",
    "c08"
   ],
   "summary": "La búsqueda con embeddings combina dos patrones: lo caro se precalcula (los vectores de 100 M publicaciones, en batch cuando cambia el modelo y en streaming por Kafka para lo nuevo) y la consulta se codifica y se busca online, con p99 ≤ 300 ms en texto. Elegimos el C07 porque es el mismo marketplace del C01, es el ejemplo de M02 de “los embeddings del catálogo, en batch; el de la consulta, online” y el curso dice que es la base del retrieval del C08. Frente al C01 aparece un índice con estado (re-embeber, construir green, indexar en streaming) y el rollout pasa a ser blue/green del índice; el C06 combina en cambio un chequeo síncrono con una cascada asíncrona y personas, y el C08 agrega un embudo por request con features en streaming.",
   "removed": [],
   "links": [
    {
     "label": "Curso · C07 · Búsqueda con embeddings · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
    },
    {
     "label": "Hoja · Del dato a producción · casos híbridos",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-hibrido"
    }
   ]
  }
 },
 "STATIONS": [
  {
   "id": "datos",
   "num": 1,
   "title": "Datos y etiquetas",
   "tramo": "datos",
   "speed": "semanas",
   "question": "¿De dónde salen los labels con los que el modelo aprende y se evalúa, y cuánto vale cada uno?",
   "note": "En C01 el modelo ya existe, pero el catálogo cambia y un modelo congelado se degrada: esta estación convierte lo que pasa en producción en labels nuevos cada mes. Hay cuatro fuentes de calidad muy distinta: la categoría elegida al publicar (≈ 2.5 M/día, pero contaminada por tu propia sugerencia), las correcciones de moderación, una cola humana de ≈ 5k imágenes/mes elegidas a propósito y un golden set de ≈ 50k, congelado, que solo sirve para evaluar.",
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
     "label": "Curso · C01 · API de clasificación · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
    },
    {
     "label": "Curso · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
     "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
    },
    {
     "label": "Curso · M01 · El mapa y la entrevista · El ciclo de vida de ML en producción",
     "href": "https://ronda-diseno-ml.vercel.app/#m01.ciclo-de-vida"
    },
    {
     "label": "Hoja · Del dato a producción · estación 1",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
    }
   ]
  },
  {
   "id": "versionado",
   "num": 2,
   "title": "Versionado y linaje",
   "tramo": "datos",
   "speed": "semanas",
   "question": "¿Cómo sabes, meses después, con qué datos exactos se entrenó un modelo?",
   "note": "Cada dataset es un snapshot inmutable con id (`ds-2026-09-01`) y un manifest en Parquet: por imagen, hash, ruta, label, fuente del label y fecha. No copia fotos, las referencia, así que un snapshot nuevo pesa ≈ 0.1 % de las imágenes. Cada modelo registrado guarda tres punteros (snapshot, commit y digest del contenedor de entrenamiento): con eso respondes «¿con qué datos?», «¿lo puedo reproducir?» y «¿en qué datasets está esta foto que pidieron borrar?».",
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
     "label": "Curso · C01 · API de clasificación · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
    },
    {
     "label": "Curso · M09 · Datos y features · Versionado de datos y snapshots inmutables",
     "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
    },
    {
     "label": "Curso · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
    },
    {
     "label": "Hoja · Del dato a producción · estación 2",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
    }
   ]
  },
  {
   "id": "entrenamiento",
   "num": 3,
   "title": "Entrenamiento",
   "tramo": "modelo",
   "speed": "semanas",
   "question": "¿Cómo se vuelve tu notebook de fine-tuning un job que corre solo cada mes y se puede reproducir?",
   "note": "Un pipeline orquestado lanza el fine-tune de ResNet-50 en una GPU on-demand por unas horas: warm start desde el champion, AMP y el mismo `preprocess.py` que usa el gateway. Corre cada mes, o antes si un disparador de monitoreo lo adelanta. Todo queda en MLflow: parámetros, métricas por época, artefactos, id del snapshot, commit y digest de la imagen.",
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
     "label": "Curso · C01 · API de clasificación · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
    },
    {
     "label": "Curso · M10 · MLOps · Pipelines de entrenamiento orquestados",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
    },
    {
     "label": "Curso · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
    },
    {
     "label": "Curso · M09 · Datos y features · Training-serving skew: causas, detección y prevención",
     "href": "https://ronda-diseno-ml.vercel.app/#m09.skew"
    },
    {
     "label": "Hoja · Del dato a producción · estación 3",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
    }
   ]
  },
  {
   "id": "gate",
   "num": 4,
   "title": "Gate de evaluación y registry",
   "tramo": "modelo",
   "speed": "semanas",
   "question": "¿Quién decide, y con qué números, que el modelo nuevo puede reemplazar al de producción?",
   "note": "Un gate automático y escrito antes de entrenar compara challenger contra champion sobre el mismo golden set: no inferioridad pareada (≥ −0.3 pp en top-1 y top-5), recall de las 100 categorías con más tráfico, ECE ≤ 0.05 y slices. Si pasa, el checkpoint sigue a la estación 5 (engine e imagen de Triton en una T4) y recién después de paridad y latencia se registra en MLflow con alias `challenger`; `champion` se mueve cuando termina el canary.",
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
     "label": "Curso · C01 · API de clasificación · Pipeline de datos y entrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
    },
    {
     "label": "Curso · C01 · API de clasificación · Evaluación offline y online",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
    },
    {
     "label": "Curso · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
    },
    {
     "label": "Curso · M10 · MLOps · Model registry: versiones, aliases y linaje",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.model-registry"
    },
    {
     "label": "Hoja · Del dato a producción · estación 4",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
    }
   ]
  },
  {
   "id": "export",
   "num": 5,
   "title": "Export, engine y paridad",
   "tramo": "modelo",
   "speed": "semanas",
   "question": "¿Cómo pasa el checkpoint de PyTorch a un engine que Triton sirve rápido, sin cambiar sus predicciones?",
   "note": "El checkpoint aprobado se exporta a ONNX opset 17 (batch dinámico, nombres `input`/`logits`) y pasa una primera paridad en CPU con ONNX Runtime. Después, en una T4 y con la misma release de NGC (24.08) que Triton, porque un engine no es portable, `trtexec --fp16` compila el engine, `docker build triton/` lo hornea en la imagen de Triton y, con ese Triton arriba, corren los dos gates: paridad contra PyTorch FP32 (top-1 agreement ≥ 99.5 %) y latencia con perf_analyzer (p99 ≤ champion + 10 %). Todo es parte del pipeline del modelo, en un runner de CI con T4, y solo si pasa la versión se registra como challenger (estación 4).",
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
     "label": "Curso · C01 · API de clasificación · Archivos de referencia",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
    },
    {
     "label": "Curso · C01 · API de clasificación · Evaluación offline y online",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
    },
    {
     "label": "Curso · M08 · Optimización de modelos · ONNX y ONNX Runtime",
     "href": "https://ronda-diseno-ml.vercel.app/#m08.onnx"
    },
    {
     "label": "Curso · M08 · Optimización de modelos · TensorRT",
     "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
    },
    {
     "label": "Hoja · Del dato a producción · estación 5",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
    },
    {
     "label": "Hoja · De PyTorch a Triton · ONNX",
     "href": "https://cheat-sheets-ml.vercel.app/triton/#onnx"
    },
    {
     "label": "Hoja · De PyTorch a Triton · paridad",
     "href": "https://cheat-sheets-ml.vercel.app/triton/#paridad"
    },
    {
     "label": "Hoja · De PyTorch a Triton · TensorRT",
     "href": "https://cheat-sheets-ml.vercel.app/triton/#tensorrt"
    }
   ]
  },
  {
   "id": "serving",
   "num": 6,
   "title": "Código de serving",
   "tramo": "release",
   "speed": "dias",
   "question": "¿Qué código y qué configuración ponen al modelo detrás de una API que cumple p99 ≤ 200 ms?",
   "note": "Dos piezas con trabajos distintos: un gateway FastAPI en CPU que valida, decodifica en un threadpool, preprocesa con el mismo `preprocess.py`, llama a Triton y arma el top-k, y Triton en la T4, configurado en `config.pbtxt` (dynamic batching de 2 ms, 2 instancias, rechazo en cola a los 100 ms). Los 24 tests de pytest prueban el contrato y cada error sin GPU. Es código que cambia en días; el modelo llega ya hecho de la estación 5.",
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
     "label": "Curso · C01 · API de clasificación · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.serving"
    },
    {
     "label": "Curso · C01 · API de clasificación · Archivos de referencia",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
    },
    {
     "label": "Curso · M07 · Servidores de modelos · Qué hace un model server (y qué no)",
     "href": "https://ronda-diseno-ml.vercel.app/#m07.que-hace"
    },
    {
     "label": "Curso · M07 · Servidores de modelos · NVIDIA Triton Inference Server",
     "href": "https://ronda-diseno-ml.vercel.app/#m07.triton"
    },
    {
     "label": "Hoja · Del dato a producción · estación 6",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
    },
    {
     "label": "Hoja · El gateway · contrato",
     "href": "https://cheat-sheets-ml.vercel.app/gateway/#contrato"
    },
    {
     "label": "Hoja · De PyTorch a Triton · model repository",
     "href": "https://cheat-sheets-ml.vercel.app/triton/#repositorio"
    },
    {
     "label": "Hoja · El gateway · tests",
     "href": "https://cheat-sheets-ml.vercel.app/gateway/#tests"
    }
   ]
  },
  {
   "id": "empaquetado",
   "num": 7,
   "title": "Empaquetado (Docker)",
   "tramo": "release",
   "speed": "dias",
   "question": "¿Cómo se convierten el código y el engine en algo que corre igual en tu máquina, en CI y en el cluster?",
   "note": "El C01 empaqueta cada tier en su propia imagen: el gateway (FastAPI, multi-stage sobre `python:3.13-slim`, ≈ 0.1 GB comprimida) y Triton con `config.pbtxt` y `model.plan` horneados (≈ 9.2 GB comprimida). Lo probado es, byte a byte, lo que corre, y desplegar o volver atrás es cambiar un tag. El CI construye la del gateway (estación 8), el pipeline del modelo la de Triton en la T4 (estación 5) y `docker compose` las prueba juntas en una máquina con GPU.",
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
     "label": "Curso · M05 · Contenedores · Un Dockerfile de ML, decisión por decisión",
     "href": "https://ronda-diseno-ml.vercel.app/#m05.dockerfile-ml"
    },
    {
     "label": "Curso · M05 · Contenedores · docker compose para desarrollo local",
     "href": "https://ronda-diseno-ml.vercel.app/#m05.compose-local"
    },
    {
     "label": "Curso · M05 · Contenedores · Reducir tamaño (y por qué importa para el cold start)",
     "href": "https://ronda-diseno-ml.vercel.app/#m05.tamano"
    },
    {
     "label": "Curso · C01 · API de clasificación · Archivos de referencia",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
    },
    {
     "label": "Hoja · Del dato a producción · estación 7",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
    },
    {
     "label": "Hoja · Docker · anatomía de un Dockerfile",
     "href": "https://cheat-sheets-ml.vercel.app/docker/#anatomia"
    },
    {
     "label": "Hoja · Docker · compose",
     "href": "https://cheat-sheets-ml.vercel.app/docker/#compose"
    }
   ]
  },
  {
   "id": "cicd",
   "num": 8,
   "title": "CI/CD y registro de imágenes",
   "tramo": "release",
   "speed": "dias",
   "question": "¿Cómo llega un commit a una imagen probada, inmutable y lista para desplegar?",
   "note": "Cada commit pasa por CI: los 24 tests del gateway corren sin GPU y su imagen se construye una sola vez para `linux/amd64` y sube a ECR, donde los tags no se mueven. La de Triton la arma el pipeline del modelo en la T4 antes de registrar la versión (estación 5), con la versión del modelo como tag. Desde el push todo habla del digest: se escanea, se firma y staging y producción despliegan el mismo.",
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
     "label": "Curso · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
    },
    {
     "label": "Curso · M05 · Contenedores · Registries y tags inmutables",
     "href": "https://ronda-diseno-ml.vercel.app/#m05.registries"
    },
    {
     "label": "Curso · Herramientas · Infraestructura como código, CI y seguridad",
     "href": "https://ronda-diseno-ml.vercel.app/#ref-herramientas.infra-ci-seguridad"
    },
    {
     "label": "Curso · M15 · Seguridad y confiabilidad · Supply chain: imágenes, dependencias y pesos verificados",
     "href": "https://ronda-diseno-ml.vercel.app/#m15.supply-chain"
    },
    {
     "label": "Hoja · Del dato a producción · estación 8",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
    },
    {
     "label": "Hoja · Git y GitHub Actions · workflows",
     "href": "https://cheat-sheets-ml.vercel.app/git/#workflow"
    },
    {
     "label": "Hoja · Git y GitHub Actions · tests en CI",
     "href": "https://cheat-sheets-ml.vercel.app/git/#tests-ci"
    },
    {
     "label": "Hoja · Docker · registries",
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
   "question": "¿Quién decide dónde corre cada pod, cuántos hay y cómo les llega el tráfico?",
   "note": "En EKS el C01 corre dos Deployments: el gateway en nodos de CPU (3–12 pods, HPA por CPU) y Triton en nodos `g4dn.xlarge`, una T4 por pod (2–4 pods, KEDA por tiempo en cola), repartidos entre las dos zonas. Tú escribes en YAML el estado deseado; Kubernetes reconcilia sin parar (compara lo pedido con lo que corre y corrige la diferencia): agenda cada pod donde cabe, lo reinicia si muere y lo saca del balanceo si no está listo. A partir del Ingress, el AWS Load Balancer Controller crea el ALB.",
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
     "label": "Curso · M06 · Orquestación y escalado · Los objetos que sí debes conocer",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.objetos-basicos"
    },
    {
     "label": "Curso · M06 · Orquestación y escalado · GPUs en Kubernetes",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.gpus-k8s"
    },
    {
     "label": "Curso · M06 · Orquestación y escalado · HPA: por qué escalar por CPU no sirve para un servicio de GPU",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.hpa"
    },
    {
     "label": "Curso · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
    },
    {
     "label": "Curso · M06 · Orquestación y escalado · Alta disponibilidad: multi-AZ, PDB y N+1",
     "href": "https://ronda-diseno-ml.vercel.app/#m06.alta-disponibilidad"
    },
    {
     "label": "Curso · Comandos · Depurar pods: síntoma → comandos → causa típica",
     "href": "https://ronda-diseno-ml.vercel.app/#ref-comandos.depurar"
    },
    {
     "label": "Hoja · Del dato a producción · estación 9",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
    },
    {
     "label": "Hoja · Kubernetes · Deployments",
     "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#deployments"
    },
    {
     "label": "Hoja · Kubernetes · probes",
     "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#probes"
    },
    {
     "label": "Hoja · Kubernetes · autoscaling",
     "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#autoscaling"
    }
   ]
  },
  {
   "id": "rollout",
   "num": 10,
   "title": "Rollout seguro",
   "tramo": "operacion",
   "speed": "dias",
   "question": "¿Cómo cambias de modelo sin que nadie pague el error, y cómo vuelves atrás?",
   "note": "En el C01, desplegar una versión registrada es cambiar el tag de la imagen en los manifests, pero un modelo nuevo no entra con un simple rolling update: la release es un par gateway vN + Triton vN con su propio Service, que pasa por shadow (1–2 días), canary 5 % → 25 % → 100 % con rollback automático y, si el cambio es grande, un A/B por vendedor. Al promover, el alias champion se mueve en MLflow y la release anterior queda viva 24–48 h: volver es un cambio de ruteo de segundos, no un redeploy.",
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
     "label": "Curso · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
     "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
    },
    {
     "label": "Curso · M11 · Despliegue seguro · Canary: porcentajes, tiempos y criterios para avanzar",
     "href": "https://ronda-diseno-ml.vercel.app/#m11.canary"
    },
    {
     "label": "Curso · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
     "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
    },
    {
     "label": "Curso · M11 · Despliegue seguro · Rollback: criterios automáticos y qué guardar para volver",
     "href": "https://ronda-diseno-ml.vercel.app/#m11.rollback"
    },
    {
     "label": "Curso · C01 · API de clasificación · Evaluación offline y online",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
    },
    {
     "label": "Hoja · Del dato a producción · estación 10",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
    },
    {
     "label": "Hoja · Kubernetes · rollouts",
     "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#rollouts"
    },
    {
     "label": "Hoja · Git y GitHub Actions · CD",
     "href": "https://cheat-sheets-ml.vercel.app/git/#cd"
    }
   ]
  },
  {
   "id": "request",
   "num": 11,
   "title": "La request en vivo",
   "tramo": "operacion",
   "speed": "ms",
   "question": "¿Qué le pasa a una foto desde que llega al ALB hasta que vuelve el top-5, y cuánto cuesta cada salto?",
   "note": "La foto entra por el ALB interno; el gateway la valida, la decodifica y la convierte en un tensor de 602 KB en CPU; Triton la junta con otras (≤ 2 ms) y la T4 la pasa por el engine TensorRT FP16. El SLO es p99 ≤ 200 ms server-side: el presupuesto típico da ≈ 20–45 ms en p50 y ≈ 150 ms en un p99 pesimista. Los timeouts bajan en cascada (`300 → 250 → 150 → 100 ms`) y, si algo falla, el caller muestra el selector manual.",
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
     "label": "Curso · C01 · API de clasificación · Arquitectura",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.arquitectura"
    },
    {
     "label": "Curso · C01 · API de clasificación · Estimaciones back-of-the-envelope",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.estimaciones"
    },
    {
     "label": "Curso · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
     "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
    },
    {
     "label": "Curso · C01 · API de clasificación · Serving",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.serving"
    },
    {
     "label": "Curso · M07 · Servidores de modelos · Protocolos: REST, gRPC, KServe v2 y OpenAI-compatible",
     "href": "https://ronda-diseno-ml.vercel.app/#m07.protocolos"
    },
    {
     "label": "Hoja · Del dato a producción · estación 11",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
    },
    {
     "label": "Hoja · El gateway · timeouts y reintentos",
     "href": "https://cheat-sheets-ml.vercel.app/gateway/#upstream"
    },
    {
     "label": "Hoja · El gateway · admisión",
     "href": "https://cheat-sheets-ml.vercel.app/gateway/#backpressure"
    },
    {
     "label": "Hoja · Formulario de estimaciones · latencia",
     "href": "https://cheat-sheets-ml.vercel.app/estimaciones/#latencia"
    }
   ]
  },
  {
   "id": "monitoreo",
   "num": 12,
   "title": "Monitoreo y reentrenamiento",
   "tramo": "operacion",
   "speed": "continuo",
   "question": "¿Cómo te enteras de que algo falló, en minutos o en días, y cómo vuelve el sistema a la estación 1?",
   "note": "Un modelo falla de dos maneras: ruidosamente (errores, latencia, pods caídos: Prometheus lo ve en minutos) y en silencio (responde 200 OK y rápido, pero mal: solo lo ven la confianza, el PSI y la aceptación, a veces días después). Las alertas de síntomas hacen page; las de calidad abren ticket. Los logs de predicción alimentan el etiquetado y un disparador adelanta el reentrenamiento: así se cierra el ciclo hacia la estación 1.",
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
     "label": "Curso · C01 · API de clasificación · Monitoreo, alertas y reentrenamiento",
     "href": "https://ronda-diseno-ml.vercel.app/#c01.monitoreo"
    },
    {
     "label": "Curso · M12 · Monitoreo · Métricas de sistema: golden signals con detalles de ML",
     "href": "https://ronda-diseno-ml.vercel.app/#m12.sistema"
    },
    {
     "label": "Curso · M12 · Monitoreo · Métricas de modelo: con y sin labels",
     "href": "https://ronda-diseno-ml.vercel.app/#m12.modelo"
    },
    {
     "label": "Curso · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
     "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
    },
    {
     "label": "Curso · M12 · Monitoreo · Cuándo reentrenar (y cuándo no)",
     "href": "https://ronda-diseno-ml.vercel.app/#m12.reentrenar"
    },
    {
     "label": "Curso · M10 · MLOps · Reentrenamiento: programado, disparado o continuo",
     "href": "https://ronda-diseno-ml.vercel.app/#m10.reentrenamiento"
    },
    {
     "label": "Hoja · Del dato a producción · estación 12",
     "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
    },
    {
     "label": "Hoja · Prometheus y Grafana · tipos de métrica",
     "href": "https://cheat-sheets-ml.vercel.app/prometheus/#metricas"
    },
    {
     "label": "Hoja · Prometheus y Grafana · histogramas",
     "href": "https://cheat-sheets-ml.vercel.app/prometheus/#histogramas"
    },
    {
     "label": "Hoja · Prometheus y Grafana · SLOs",
     "href": "https://cheat-sheets-ml.vercel.app/prometheus/#slos"
    }
   ]
  }
 ],
 "STEPS": {
  "sincrono": [
   {
    "id": "datos",
    "base": "datos",
    "status": "igual",
    "title": "Datos y etiquetas",
    "tramo": "datos",
    "speed": "semanas",
    "question": "¿De dónde salen los labels con los que el modelo aprende y se evalúa, y cuánto vale cada uno?",
    "note": "En C01 el modelo ya existe, pero el catálogo cambia y un modelo congelado se degrada: esta estación convierte lo que pasa en producción en labels nuevos cada mes. Hay cuatro fuentes de calidad muy distinta: la categoría elegida al publicar (≈ 2.5 M/día, pero contaminada por tu propia sugerencia), las correcciones de moderación, una cola humana de ≈ 5k imágenes/mes elegidas a propósito y un golden set de ≈ 50k, congelado, que solo sirve para evaluar.",
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
      "label": "Curso · C01 · API de clasificación · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
     },
     {
      "label": "Curso · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Curso · M01 · El mapa y la entrevista · El ciclo de vida de ML en producción",
      "href": "https://ronda-diseno-ml.vercel.app/#m01.ciclo-de-vida"
     },
     {
      "label": "Hoja · Del dato a producción · estación 1",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "igual",
    "title": "Versionado y linaje",
    "tramo": "datos",
    "speed": "semanas",
    "question": "¿Cómo sabes, meses después, con qué datos exactos se entrenó un modelo?",
    "note": "Cada dataset es un snapshot inmutable con id (`ds-2026-09-01`) y un manifest en Parquet: por imagen, hash, ruta, label, fuente del label y fecha. No copia fotos, las referencia, así que un snapshot nuevo pesa ≈ 0.1 % de las imágenes. Cada modelo registrado guarda tres punteros (snapshot, commit y digest del contenedor de entrenamiento): con eso respondes «¿con qué datos?», «¿lo puedo reproducir?» y «¿en qué datasets está esta foto que pidieron borrar?».",
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
      "label": "Curso · C01 · API de clasificación · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
     },
     {
      "label": "Curso · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Curso · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
     },
     {
      "label": "Hoja · Del dato a producción · estación 2",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "igual",
    "title": "Entrenamiento",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "¿Cómo se vuelve tu notebook de fine-tuning un job que corre solo cada mes y se puede reproducir?",
    "note": "Un pipeline orquestado lanza el fine-tune de ResNet-50 en una GPU on-demand por unas horas: warm start desde el champion, AMP y el mismo `preprocess.py` que usa el gateway. Corre cada mes, o antes si un disparador de monitoreo lo adelanta. Todo queda en MLflow: parámetros, métricas por época, artefactos, id del snapshot, commit y digest de la imagen.",
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
      "label": "Curso · C01 · API de clasificación · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
     },
     {
      "label": "Curso · M10 · MLOps · Pipelines de entrenamiento orquestados",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
     },
     {
      "label": "Curso · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
     },
     {
      "label": "Curso · M09 · Datos y features · Training-serving skew: causas, detección y prevención",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.skew"
     },
     {
      "label": "Hoja · Del dato a producción · estación 3",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "igual",
    "title": "Gate de evaluación y registry",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "¿Quién decide, y con qué números, que el modelo nuevo puede reemplazar al de producción?",
    "note": "Un gate automático y escrito antes de entrenar compara challenger contra champion sobre el mismo golden set: no inferioridad pareada (≥ −0.3 pp en top-1 y top-5), recall de las 100 categorías con más tráfico, ECE ≤ 0.05 y slices. Si pasa, el checkpoint sigue a la estación 5 (engine e imagen de Triton en una T4) y recién después de paridad y latencia se registra en MLflow con alias `challenger`; `champion` se mueve cuando termina el canary.",
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
      "label": "Curso · C01 · API de clasificación · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.datos"
     },
     {
      "label": "Curso · C01 · API de clasificación · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
     },
     {
      "label": "Curso · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Curso · M10 · MLOps · Model registry: versiones, aliases y linaje",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.model-registry"
     },
     {
      "label": "Hoja · Del dato a producción · estación 4",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "igual",
    "title": "Export, engine y paridad",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "¿Cómo pasa el checkpoint de PyTorch a un engine que Triton sirve rápido, sin cambiar sus predicciones?",
    "note": "El checkpoint aprobado se exporta a ONNX opset 17 (batch dinámico, nombres `input`/`logits`) y pasa una primera paridad en CPU con ONNX Runtime. Después, en una T4 y con la misma release de NGC (24.08) que Triton, porque un engine no es portable, `trtexec --fp16` compila el engine, `docker build triton/` lo hornea en la imagen de Triton y, con ese Triton arriba, corren los dos gates: paridad contra PyTorch FP32 (top-1 agreement ≥ 99.5 %) y latencia con perf_analyzer (p99 ≤ champion + 10 %). Todo es parte del pipeline del modelo, en un runner de CI con T4, y solo si pasa la versión se registra como challenger (estación 4).",
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
      "label": "Curso · C01 · API de clasificación · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
     },
     {
      "label": "Curso · C01 · API de clasificación · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
     },
     {
      "label": "Curso · M08 · Optimización de modelos · ONNX y ONNX Runtime",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.onnx"
     },
     {
      "label": "Curso · M08 · Optimización de modelos · TensorRT",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
     },
     {
      "label": "Hoja · Del dato a producción · estación 5",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     },
     {
      "label": "Hoja · De PyTorch a Triton · ONNX",
      "href": "https://cheat-sheets-ml.vercel.app/triton/#onnx"
     },
     {
      "label": "Hoja · De PyTorch a Triton · paridad",
      "href": "https://cheat-sheets-ml.vercel.app/triton/#paridad"
     },
     {
      "label": "Hoja · De PyTorch a Triton · TensorRT",
      "href": "https://cheat-sheets-ml.vercel.app/triton/#tensorrt"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "igual",
    "title": "Código de serving",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Qué código y qué configuración ponen al modelo detrás de una API que cumple p99 ≤ 200 ms?",
    "note": "Dos piezas con trabajos distintos: un gateway FastAPI en CPU que valida, decodifica en un threadpool, preprocesa con el mismo `preprocess.py`, llama a Triton y arma el top-k, y Triton en la T4, configurado en `config.pbtxt` (dynamic batching de 2 ms, 2 instancias, rechazo en cola a los 100 ms). Los 24 tests de pytest prueban el contrato y cada error sin GPU. Es código que cambia en días; el modelo llega ya hecho de la estación 5.",
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
      "label": "Curso · C01 · API de clasificación · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.serving"
     },
     {
      "label": "Curso · C01 · API de clasificación · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
     },
     {
      "label": "Curso · M07 · Servidores de modelos · Qué hace un model server (y qué no)",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.que-hace"
     },
     {
      "label": "Curso · M07 · Servidores de modelos · NVIDIA Triton Inference Server",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.triton"
     },
     {
      "label": "Hoja · Del dato a producción · estación 6",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     },
     {
      "label": "Hoja · El gateway · contrato",
      "href": "https://cheat-sheets-ml.vercel.app/gateway/#contrato"
     },
     {
      "label": "Hoja · De PyTorch a Triton · model repository",
      "href": "https://cheat-sheets-ml.vercel.app/triton/#repositorio"
     },
     {
      "label": "Hoja · El gateway · tests",
      "href": "https://cheat-sheets-ml.vercel.app/gateway/#tests"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "igual",
    "title": "Empaquetado (Docker)",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo se convierten el código y el engine en algo que corre igual en tu máquina, en CI y en el cluster?",
    "note": "El C01 empaqueta cada tier en su propia imagen: el gateway (FastAPI, multi-stage sobre `python:3.13-slim`, ≈ 0.1 GB comprimida) y Triton con `config.pbtxt` y `model.plan` horneados (≈ 9.2 GB comprimida). Lo probado es, byte a byte, lo que corre, y desplegar o volver atrás es cambiar un tag. El CI construye la del gateway (estación 8), el pipeline del modelo la de Triton en la T4 (estación 5) y `docker compose` las prueba juntas en una máquina con GPU.",
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
      "label": "Curso · M05 · Contenedores · Un Dockerfile de ML, decisión por decisión",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.dockerfile-ml"
     },
     {
      "label": "Curso · M05 · Contenedores · docker compose para desarrollo local",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.compose-local"
     },
     {
      "label": "Curso · M05 · Contenedores · Reducir tamaño (y por qué importa para el cold start)",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.tamano"
     },
     {
      "label": "Curso · C01 · API de clasificación · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.archivos"
     },
     {
      "label": "Hoja · Del dato a producción · estación 7",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     },
     {
      "label": "Hoja · Docker · anatomía de un Dockerfile",
      "href": "https://cheat-sheets-ml.vercel.app/docker/#anatomia"
     },
     {
      "label": "Hoja · Docker · compose",
      "href": "https://cheat-sheets-ml.vercel.app/docker/#compose"
     }
    ]
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD y registro de imágenes",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo llega un commit a una imagen probada, inmutable y lista para desplegar?",
    "note": "Cada commit pasa por CI: los 24 tests del gateway corren sin GPU y su imagen se construye una sola vez para `linux/amd64` y sube a ECR, donde los tags no se mueven. La de Triton la arma el pipeline del modelo en la T4 antes de registrar la versión (estación 5), con la versión del modelo como tag. Desde el push todo habla del digest: se escanea, se firma y staging y producción despliegan el mismo.",
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
      "label": "Curso · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Curso · M05 · Contenedores · Registries y tags inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.registries"
     },
     {
      "label": "Curso · Herramientas · Infraestructura como código, CI y seguridad",
      "href": "https://ronda-diseno-ml.vercel.app/#ref-herramientas.infra-ci-seguridad"
     },
     {
      "label": "Curso · M15 · Seguridad y confiabilidad · Supply chain: imágenes, dependencias y pesos verificados",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.supply-chain"
     },
     {
      "label": "Hoja · Del dato a producción · estación 8",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     },
     {
      "label": "Hoja · Git y GitHub Actions · workflows",
      "href": "https://cheat-sheets-ml.vercel.app/git/#workflow"
     },
     {
      "label": "Hoja · Git y GitHub Actions · tests en CI",
      "href": "https://cheat-sheets-ml.vercel.app/git/#tests-ci"
     },
     {
      "label": "Hoja · Docker · registries",
      "href": "https://cheat-sheets-ml.vercel.app/docker/#registries"
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
    "question": "¿Quién decide dónde corre cada pod, cuántos hay y cómo les llega el tráfico?",
    "note": "En EKS el C01 corre dos Deployments: el gateway en nodos de CPU (3–12 pods, HPA por CPU) y Triton en nodos `g4dn.xlarge`, una T4 por pod (2–4 pods, KEDA por tiempo en cola), repartidos entre las dos zonas. Tú escribes en YAML el estado deseado; Kubernetes reconcilia sin parar (compara lo pedido con lo que corre y corrige la diferencia): agenda cada pod donde cabe, lo reinicia si muere y lo saca del balanceo si no está listo. A partir del Ingress, el AWS Load Balancer Controller crea el ALB.",
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
      "label": "Curso · M06 · Orquestación y escalado · Los objetos que sí debes conocer",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.objetos-basicos"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · GPUs en Kubernetes",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.gpus-k8s"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · HPA: por qué escalar por CPU no sirve para un servicio de GPU",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.hpa"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · Alta disponibilidad: multi-AZ, PDB y N+1",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.alta-disponibilidad"
     },
     {
      "label": "Curso · Comandos · Depurar pods: síntoma → comandos → causa típica",
      "href": "https://ronda-diseno-ml.vercel.app/#ref-comandos.depurar"
     },
     {
      "label": "Hoja · Del dato a producción · estación 9",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     },
     {
      "label": "Hoja · Kubernetes · Deployments",
      "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#deployments"
     },
     {
      "label": "Hoja · Kubernetes · probes",
      "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#probes"
     },
     {
      "label": "Hoja · Kubernetes · autoscaling",
      "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#autoscaling"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "igual",
    "title": "Rollout seguro",
    "tramo": "operacion",
    "speed": "dias",
    "question": "¿Cómo cambias de modelo sin que nadie pague el error, y cómo vuelves atrás?",
    "note": "En el C01, desplegar una versión registrada es cambiar el tag de la imagen en los manifests, pero un modelo nuevo no entra con un simple rolling update: la release es un par gateway vN + Triton vN con su propio Service, que pasa por shadow (1–2 días), canary 5 % → 25 % → 100 % con rollback automático y, si el cambio es grande, un A/B por vendedor. Al promover, el alias champion se mueve en MLflow y la release anterior queda viva 24–48 h: volver es un cambio de ruteo de segundos, no un redeploy.",
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
      "label": "Curso · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Canary: porcentajes, tiempos y criterios para avanzar",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.canary"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Rollback: criterios automáticos y qué guardar para volver",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.rollback"
     },
     {
      "label": "Curso · C01 · API de clasificación · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.evaluacion"
     },
     {
      "label": "Hoja · Del dato a producción · estación 10",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     },
     {
      "label": "Hoja · Kubernetes · rollouts",
      "href": "https://cheat-sheets-ml.vercel.app/kubernetes/#rollouts"
     },
     {
      "label": "Hoja · Git y GitHub Actions · CD",
      "href": "https://cheat-sheets-ml.vercel.app/git/#cd"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "igual",
    "title": "La request en vivo",
    "tramo": "operacion",
    "speed": "ms",
    "question": "¿Qué le pasa a una foto desde que llega al ALB hasta que vuelve el top-5, y cuánto cuesta cada salto?",
    "note": "La foto entra por el ALB interno; el gateway la valida, la decodifica y la convierte en un tensor de 602 KB en CPU; Triton la junta con otras (≤ 2 ms) y la T4 la pasa por el engine TensorRT FP16. El SLO es p99 ≤ 200 ms server-side: el presupuesto típico da ≈ 20–45 ms en p50 y ≈ 150 ms en un p99 pesimista. Los timeouts bajan en cascada (`300 → 250 → 150 → 100 ms`) y, si algo falla, el caller muestra el selector manual.",
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
      "label": "Curso · C01 · API de clasificación · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.arquitectura"
     },
     {
      "label": "Curso · C01 · API de clasificación · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.estimaciones"
     },
     {
      "label": "Curso · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Curso · C01 · API de clasificación · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.serving"
     },
     {
      "label": "Curso · M07 · Servidores de modelos · Protocolos: REST, gRPC, KServe v2 y OpenAI-compatible",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.protocolos"
     },
     {
      "label": "Hoja · Del dato a producción · estación 11",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     },
     {
      "label": "Hoja · El gateway · timeouts y reintentos",
      "href": "https://cheat-sheets-ml.vercel.app/gateway/#upstream"
     },
     {
      "label": "Hoja · El gateway · admisión",
      "href": "https://cheat-sheets-ml.vercel.app/gateway/#backpressure"
     },
     {
      "label": "Hoja · Formulario de estimaciones · latencia",
      "href": "https://cheat-sheets-ml.vercel.app/estimaciones/#latencia"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "igual",
    "title": "Monitoreo y reentrenamiento",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "¿Cómo te enteras de que algo falló, en minutos o en días, y cómo vuelve el sistema a la estación 1?",
    "note": "Un modelo falla de dos maneras: ruidosamente (errores, latencia, pods caídos: Prometheus lo ve en minutos) y en silencio (responde 200 OK y rápido, pero mal: solo lo ven la confianza, el PSI y la aceptación, a veces días después). Las alertas de síntomas hacen page; las de calidad abren ticket. Los logs de predicción alimentan el etiquetado y un disparador adelanta el reentrenamiento: así se cierra el ciclo hacia la estación 1.",
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
      "label": "Curso · C01 · API de clasificación · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c01.monitoreo"
     },
     {
      "label": "Curso · M12 · Monitoreo · Métricas de sistema: golden signals con detalles de ML",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.sistema"
     },
     {
      "label": "Curso · M12 · Monitoreo · Métricas de modelo: con y sin labels",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.modelo"
     },
     {
      "label": "Curso · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Curso · M12 · Monitoreo · Cuándo reentrenar (y cuándo no)",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.reentrenar"
     },
     {
      "label": "Curso · M10 · MLOps · Reentrenamiento: programado, disparado o continuo",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reentrenamiento"
     },
     {
      "label": "Hoja · Del dato a producción · estación 12",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     },
     {
      "label": "Hoja · Prometheus y Grafana · tipos de métrica",
      "href": "https://cheat-sheets-ml.vercel.app/prometheus/#metricas"
     },
     {
      "label": "Hoja · Prometheus y Grafana · histogramas",
      "href": "https://cheat-sheets-ml.vercel.app/prometheus/#histogramas"
     },
     {
      "label": "Hoja · Prometheus y Grafana · SLOs",
      "href": "https://cheat-sheets-ml.vercel.app/prometheus/#slos"
     }
    ]
   }
  ],
  "batch": [
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Ventas POS y agotados",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Las ventas del POS (`sales_daily`) llegan cada noche a las 00:30 y son el label: no hace falta etiquetado humano. Los días agotados (`oos_flag`) salen de los targets porque su venta no es la demanda.",
    "artifact": "",
    "done": [
     "`sales_daily` y `stock_daily` (con `oos_flag`) llegan cada noche: las ventas a las 00:30 (las tiendas con mala conexión, hasta la 01:30) y el inventario al cierre a la 01:00.",
     "Los días con `oos_flag` quedan fuera de los targets y entran como NaN en lags y medias; `oos_days_7` y `oos_days_28` cuentan cuántos hubo.",
     "Cada serie se densifica con el surtido: cero real, agotado y sin dato quedan separados, y una tienda que no subió nada nunca cuenta como venta 0.",
     "`price_promo` entra con el plan como se conocía en el origen, y `retail_events.yaml` tiene las fechas del Buen Fin y del Hot Sale del año que miran las features.",
     "Los tests de `features/` pasan, incluido el de leakage: con todo lo posterior a `run_date` envenenado, las features salen idénticas."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.datos"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M09 · Datos y features · Data leakage: cuando el training conoce el futuro",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.leakage"
     },
     {
      "label": "Hoja · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ]
   },
   {
    "id": "sensores-con-hora-de-corte",
    "base": null,
    "status": "nuevo",
    "title": "Sensores con hora de corte",
    "tramo": "datos",
    "speed": "nuevo",
    "question": "",
    "note": "Esperan las ventas y el inventario de cada tienda hasta que reportan todas o hasta la 01:30. Las que faltan se imputan con su mismo día de la semana pasada y se marcan `imputed_input`.",
    "artifact": "",
    "done": [
     "`wait_sales` y `wait_stock` corren en modo reschedule, con poke cada 5 min, y terminan cuando reportaron todas las tiendas o a la 01:30, lo que pase antes.",
     "Ningún sensor falla por datos incompletos; su timeout de respaldo es de 2 h y, si vence, el job no corre y sale el fallback.",
     "Las tiendas que faltan al corte se imputan con su mismo día de la semana pasada (venta y marca de agotado), y sus filas salen con `imputed_input`.",
     "`InputDataIncomplete` abre un ticket con más de 2 % de tiendas imputadas, y con más de 5 % el gate bloquea la noche."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M09 · Datos y features · Pipelines batch y streaming",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.pipelines"
     },
     {
      "label": "Hoja · Del dato a producción · patrón batch",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "cambia",
    "title": "Snapshots y particiones inmutables",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Cada entrenamiento fija un snapshot (time travel de Iceberg o Delta, o una copia con fecha), y cada noche publicada queda como partición inmutable con nombre de hash: el archivo de lo que el ERP usó.",
    "artifact": "",
    "done": [
     "Cada entrenamiento usa un snapshot fijo de las tablas (time travel de Iceberg o Delta, o una copia con fecha) que queda registrado con el modelo.",
     "Cada modelo guarda su snapshot, el commit del código de features, la configuración del muestreo y las versiones de las librerías.",
     "Cada noche escribe una versión inmutable de la partición `run_date` de `forecast_daily`, nombrada por el hash de su contenido: re-correrla con los mismos datos da `already_published`.",
     "Cada fila de `forecast_daily` trae `run_date` y `model_version`, y las versiones viejas no se borran: son el archivo de pronósticos."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.datos"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Curso · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Entrenamiento semanal por cuantiles",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Cada domingo, dos GBDT por cuantiles (P50 y P90) sobre ≈ 490 M filas point-in-time, en un nodo de 96 vCPU en spot (≈ 2–3 h). Sin GPU.",
    "artifact": "",
    "done": [
     "Cada domingo se arma un training set point-in-time de ≈ 490 M filas: las series principales de 52 semanas completas, 10 % del resto con peso 10 y un horizonte sorteado por fila, con semilla registrada.",
     "Salen dos modelos de cuantiles (α = 0.5 y 0.9) en un nodo de 96 vCPU en spot, en ≈ 2–3 h; si spot lo interrumpe, se reintenta.",
     "El P50 de las series rápidas no sale en 0 (en la referencia, con jittering de conteos) y el early stopping aleatorio está apagado.",
     "El modelo guarda su versión de scikit-learn, y `train_quantile.load` se niega a cargarlo con otra."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.datos"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M10 · MLOps · Pipelines de entrenamiento orquestados",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
     },
     {
      "label": "Curso · M13 · Nube · Spot y preemptible: para qué sí y para qué no",
      "href": "https://ronda-diseno-ml.vercel.app/#m13.spot"
     },
     {
      "label": "Hoja · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Backtest de 8 orígenes",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Backtest de origen móvil con 8 orígenes semanales: mejor WAPE que el champion y ningún segmento principal peor por más de 2 puntos.",
    "artifact": "",
    "done": [
     "Un cambio de receta corre el backtest de origen móvil con 8 orígenes semanales; en cada origen se entrena solo con filas cuyo `target_date` ya pasó.",
     "El candidato tiene mejor WAPE que el champion, y ningún segmento grande (frescos, abarrotes, rápidas, lentas, con y sin promoción) empeora más de 2 puntos.",
     "WAPE, sesgo, pinball y cobertura del P90 se calculan sin días agotados, por segmento y horizonte, y contra el seasonal naive.",
     "El reentrenamiento semanal de la misma receta pasa el gate del artefacto: filas y features esperadas, pérdida en su rango, pocos cruces de cuantiles y una noche en sombra.",
     "La versión entra al registry como `challenger` con su linaje: snapshot, commit, configuración y resultados del backtest."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.evaluacion"
     },
     {
      "label": "Curso · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Curso · M10 · MLOps · Model registry: versiones, aliases y linaje",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.model-registry"
     },
     {
      "label": "Hoja · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "Job nocturno `run_forecast.py`",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "No hay endpoint: el serving es el job `run_forecast.py`, que imputa, arma features, predice 67 M filas y escribe una partición nueva.",
    "artifact": "",
    "done": [
     "`run_forecast.py nightly` hace la noche en 7 pasos: completitud e imputación, revisión del calendario, features, predicción, escritura, gate y compare-and-swap.",
     "Las features salen de la misma función que arma el training set, y antes el job verifica que `retail_events.yaml` cubra el horizonte y los 30 días que mira `days_to_`; si no, falla en voz alta.",
     "Predice P50 y P90 de ≈ 67 M filas en CPU con la versión fijada al arrancar: piezas enteras, ordenadas por fila, recortadas en 0 y con los cruces contados.",
     "Cada intento cabe en ≤ 60 min (de la 01:30 a las 03:30 queda lugar para un reintento) y empuja con `pushadd` solo las métricas de ese intento.",
     "`pytest` en `reference/c14` pasa los 73 tests (el del DAG se salta sin Airflow)."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Batch: precomputar en vez de servir",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.batch"
     },
     {
      "label": "Hoja · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ]
   },
   {
    "id": "gate-de-salida-y-swap-atomico",
    "base": null,
    "status": "nuevo",
    "title": "Gate de salida, swap atómico",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "Write–audit–publish: el gate relee lo escrito (filas = series × 14, p90 ≥ p50, bandas por categoría) y publicar es un compare-and-swap del puntero `forecast_current`. El ERP nunca ve una tabla a medias.",
    "artifact": "",
    "done": [
     "El gate lee de vuelta la partición ya escrita: filas = series × 14 (± 0.5 %), sin llaves repetidas, nulos ni negativos, p90 ≥ p50 y tiendas imputadas ≤ 5 %.",
     "La banda por categoría compara Σ P50 de 7 días contra Σ de las medianas de los últimos 4 mismos días, solo con series rápidas, dentro de ±30 %; con promoción o feriado se ensancha a [1/3×, 3×].",
     "Publicar es un compare-and-swap del puntero `forecast_current` (`UPDATE … WHERE partition = :esperado`): si afecta 0 filas, falla en vez de pisar.",
     "El puntero cumple sus reglas: nunca hacia atrás, un fallback no reemplaza al modelo de la misma noche y después de las 03:55 no se mueve.",
     "Si el gate bloquea, sale el fallback y `ForecastValidationBlocked` hace page."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M09 · Datos y features · Validación de datos: schemas y expectativas",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.validacion-datos"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Batch: precomputar en vez de servir",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.batch"
     },
     {
      "label": "Hoja · Del dato a producción · patrón batch",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
     }
    ]
   },
   {
    "id": "fallback-y-guardian-de-las-03-45",
    "base": null,
    "status": "nuevo",
    "title": "Fallback y guardián de 03:45",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "Si el job falla o el gate bloquea, se publica el pronóstico de ayer desplazado un día; un DAG aparte lo publica a las 03:45 si nada salió.",
    "artifact": "",
    "done": [
     "El fallback corre el último pronóstico publicado: los horizontes 2..14 de ayer pasan a 1..13 y el día 14 sale de seasonal naive, con `fallback` = true y su `reason`.",
     "Lo publican tres caminos: el job si el modelo o el gate fallan, `publish_fallback` (trigger rule `all_failed`, siempre en on-demand) si el job falla dos veces, y `forecast_fallback_guard` a las 03:45 si nada de la noche está publicado.",
     "El fallback no arma features (su naive lee 28 días de ventas e inventario) y pasa las reglas de estructura del gate.",
     "`FallbackForecastServed` abre un ticket en cada noche de fallback, y dos noches seguidas se escalan."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.fallas"
     },
     {
      "label": "Curso · M15 · Seguridad y confiabilidad · Degradación con gracia: contener la falla",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.degradacion"
     },
     {
      "label": "Hoja · Del dato a producción · patrón batch",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "cambia",
    "title": "Una imagen para todo",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Una sola imagen (`forecast-job`, fijada por digest) entrena y predice, porque un modelo guardado con pickle de scikit-learn no es portable entre versiones.",
    "artifact": "",
    "done": [
     "Una sola imagen (`forecast-job`) entrena y predice, y el DAG la usa por digest, no por tag.",
     "La imagen instala el lock de `train/requirements.txt` (14 paquetes) y el código de `features/`, `train/` y `batch/`.",
     "El entrypoint es `python run_forecast.py`, y `OMP_NUM_THREADS` es igual a los cores que pide el pod.",
     "Un modelo guardado con otra versión de scikit-learn no carga: el job lo rechaza en vez de predecir con él."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M05 · Contenedores · Registries y tags inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.registries"
     },
     {
      "label": "Hoja · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ]
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD, imagen y DAG",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo llega un commit a una imagen probada, inmutable y lista para desplegar?",
    "note": "Pruebas e imagen como en el C01; además se despliega el DAG `forecast_nightly` a Airflow.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "`pytest` pasa los 73 tests de las cuatro carpetas en cada commit, sin warehouse, Spark ni Airflow.",
     "`promtool check rules` y `promtool test rules` pasan sobre `monitoring/alerts.yml`.",
     "En un venv con Airflow 3.3.2 y el provider de Kubernetes, pasan los 10 tests del DAG (import, timetable, plantillas y serialización).",
     "`forecast_nightly_dag.py` y `nightly_rules.py` se despliegan al bundle de DAGs y donde los importe el triggerer, con la conexión `warehouse` creada.",
     "La imagen del job se publica una vez, y el DAG apunta a ese mismo digest."
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
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Hoja · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ]
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "Pod del job, sin Deployment",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Sin Deployment, HPA ni ALB: Airflow lanza el job como pod (KubernetesPodOperator), el primer intento en un nodo spot de Karpenter y el reintento en on-demand.",
    "artifact": "",
    "done": [
     "No hay Deployment, HPA ni ALB: `run_forecast` corre con `KubernetesPodOperator` en el namespace `forecasting`.",
     "El primer intento va a un nodo spot y el reintento a on-demand, con el `node_selector` `karpenter.sh/capacity-type`; `publish_fallback` y el guardián van siempre en on-demand.",
     "El pod del job tiene `execution_timeout` de 90 min, límite de memoria y ningún límite de CPU.",
     "Karpenter tiene los dos tipos de capacidad, y el pod que falla se queda para leer sus logs."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · Aprovisionar nodos GPU: Cluster Autoscaler y Karpenter",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.nodos"
     },
     {
      "label": "Curso · M13 · Nube · Spot y preemptible: para qué sí y para qué no",
      "href": "https://ronda-diseno-ml.vercel.app/#m13.spot"
     },
     {
      "label": "Hoja · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ]
   },
   {
    "id": "job-programado-dag-forecast-nightly",
    "base": null,
    "status": "nuevo",
    "title": "Job programado (DAG forecast_nightly)",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Airflow lo dispara a las 00:30 con `catchup=False` y `max_active_runs=1`: un pronóstico de una noche pasada no sirve para pedir hoy, y dos noches a la vez se pelearían el puntero.",
    "artifact": "",
    "done": [
     "`forecast_nightly` corre con el cron `30 0 * * *` en America/Mexico_City, `catchup=False` y `max_active_runs=1`.",
     "`run_date_for` pasa la fecha lógica a la hora de las tiendas (no usa `ds`, que va en UTC), y un test lo prueba con una corrida manual a las 19:00.",
     "El DAG tiene un Deadline Alert a las 03:30 (fecha lógica + 3 h) cuyo callback avisa a Alertmanager.",
     "Las tareas van `[wait_sales, wait_stock] >> run_forecast >> publish_fallback`, y `forecast_fallback_guard` es otro DAG, con cron `45 3 * * *`."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M10 · MLOps · Pipelines de entrenamiento orquestados",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
     },
     {
      "label": "Hoja · Del dato a producción · patrón batch",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-batch"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Sombra, alias y piloto",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Sin canary de tráfico: el challenger corre una noche en sombra por el mismo gate y se promueve moviendo el alias `champion`. El valor de negocio se mide con 40 tiendas piloto contra 40 de control.",
    "artifact": "",
    "done": [
     "El challenger corre una noche en sombra junto al champion, y su salida pasa por el mismo gate.",
     "Promover es mover el alias `champion`; cada corrida lo resuelve a una versión al arrancar, y la anterior queda lista para un rollback de un minuto.",
     "El piloto empareja 40 pares de tiendas (formato, CD, ventas) y sortea dentro de cada par: 8 semanas, con diferencia en diferencias sobre agotados y merma.",
     "Las 2 primeras semanas del piloto son de arranque y no cuentan, y los ajustes de la gerencia se registran y se miden con FVA.",
     "El rollback de una noche ya publicada es re-correrla con el champion anterior antes de las 03:55, nunca apuntar la vista a una noche vieja."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.evaluacion"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.serving"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · A/B testing: unidad, métricas y tamaño de muestra",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.ab-testing"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Rollback: criterios automáticos y qué guardar para volver",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.rollback"
     },
     {
      "label": "Hoja · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Monitoreo de dos relojes",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Dos relojes: la noche (`ForecastRunLate`, `ForecastRunFailed`: page), con métricas que el job empuja al Pushgateway, y la precisión (`WAPEDegraded`: ticket), que llega días después con las ventas.",
    "artifact": "",
    "done": [
     "Las 8 alertas de `alerts.yml` pasan sus tests de promtool: `ForecastRunLate`, `ForecastRunFailed` y `ForecastValidationBlocked` hacen page; las otras cinco abren ticket.",
     "`ForecastRunLate` mira la edad del `run_date` publicado (más de 51.5 h, o la métrica ausente), así que no depende de Airflow.",
     "Cada intento empuja al Pushgateway la hora de publicación, las filas, las tiendas imputadas, el resultado del gate y el fallback.",
     "El job diario de precisión publica WAPE y sesgo de 7 días por segmento (horizontes 1–2, sin días agotados) contra los del backtest: `WAPEDegraded` salta a más de 5 puntos y `ForecastBiasDrift` a más de 10.",
     "El modelo se reentrena cada domingo; dos semanas de `WAPEDegraded` llevan a un diagnóstico por segmento antes de reentrenar."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C14 · Pronóstico de demanda · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.monitoreo"
     },
     {
      "label": "Curso · C14 · Pronóstico de demanda · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c14.archivos"
     },
     {
      "label": "Curso · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Curso · M12 · Monitoreo · Dashboards, runbooks y on-call",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.runbooks"
     },
     {
      "label": "Hoja · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ]
   }
  ],
  "llm": [
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Documentos, ACLs y golden set",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "No hay dataset de entrenamiento: los datos son ≈ 1.5 M documentos de Confluence, Drive, Jira y políticas, cada uno con su ACL, más un golden set de ≈ 600 preguntas escritas con especialistas de cada área.",
    "artifact": "",
    "done": [
     "Las fuentes están acotadas: Confluence, Drive, Jira (solo los últimos 2 años) y el repositorio de políticas, ≈ 1.5 M documentos tras filtrar, con RH y legal fuera por defecto.",
     "Cada documento trae su ACL normalizada a principals (`user:`, `group:`, `role:`, `domain:`), y un enlace compartido cuenta como no compartido.",
     "El golden set tiene ≈ 600 preguntas escritas con especialistas de cada área, con documentos esperados y respuesta de referencia, e incluye pares de permisos, preguntas sin respuesta, tablas, versiones y varios turnos.",
     "Hay ≈ 200 respuestas calificadas por especialistas con la rúbrica, para calibrar al juez.",
     "Antes de abrir Drive, Seguridad revisó el escaneo de sobre-compartido."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
     },
     {
      "label": "Curso · M14 · Sistemas con LLMs · Evaluación: golden sets, jueces y gates",
      "href": "https://ronda-diseno-ml.vercel.app/#m14.evaluacion"
     },
     {
      "label": "Curso · M15 · Seguridad y confiabilidad · Datos personales: dónde están, cuánto duran y quién los ve",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.pii-privacidad"
     },
     {
      "label": "Hoja · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ]
   },
   {
    "id": "ingestion-con-conectores",
    "base": null,
    "status": "nuevo",
    "title": "Ingestión con conectores",
    "tramo": "datos",
    "speed": "nuevo",
    "question": "",
    "note": "Un conector por fuente detecta cambios por webhook o polling; después vienen parsing y OCR, y chunks de ≈ 400 tokens con su ruta de títulos y su ACL.",
    "artifact": "",
    "done": [
     "Cada fuente tiene su conector: eventos (webhook o feed de cambios), polling por fecha de modificación como red y un barrido de reconciliación que compara ids y versiones contra el índice.",
     "El parsing conserva la estructura: OCR en páginas sin capa de texto, tablas como filas con su encabezado, y el texto parseado se guarda en S3 por versión y hash.",
     "Los chunks miden ≈ 400 tokens (techo duro de 512), siguen las secciones, llevan la ruta de títulos, los campos de ACL y el hash, y no cortan filas de tabla.",
     "Procesar dos veces el mismo evento no cambia nada, los borrados quedan como tombstones y una pasada que quiere borrar más de 2 % de una fuente se detiene.",
     "Una página editada es respondible en p95 ≤ 15 min, y `IngestionLagHigh` vigila el atraso por fuente."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Entrega, reintentos e idempotencia",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.entrega-reintentos"
     },
     {
      "label": "Hoja · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ]
   },
   {
    "id": "carril-rapido-de-permisos",
    "base": null,
    "status": "nuevo",
    "title": "Carril rápido de permisos",
    "tramo": "datos",
    "speed": "nuevo",
    "question": "",
    "note": "ACL sync reescribe solo los campos `acl_0…acl_2` de los chunks afectados: una revocación aplica en ≤ 5 min sin re-embeber ni esperar detrás de un PDF.",
    "artifact": "",
    "done": [
     "Los cambios de permisos van a su propia cola: ACL sync reescribe solo `acl_0`…`acl_2` de los chunks afectados, sin re-embeber.",
     "Una revocación aplica en ≤ 5 min, medida de punta a punta por el probe de permisos.",
     "Lo que la cuenta de servicio ya no puede leer se borra del índice (fail-closed).",
     "La foto del IdP se refresca cada ≈ 60 s; `ACLSyncStale` salta con la foto de más de 2 min, con una fuente sin sincronizar permisos en 5 min o con un atraso p95 de más de 5 min.",
     "`test_acl_only_change_updates_metadata_without_embedding` pasa con la misma versión del documento."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Curso · M15 · Seguridad y confiabilidad · Autenticación y autorización entre servicios",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.authn-authz"
     },
     {
      "label": "Hoja · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "cambia",
    "title": "Texto, chunks e índice versionados",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Se versionan el texto parseado (en S3, por hash), cada chunk con su hash y la `model_version` del embedding, el índice detrás de un alias y el golden set como dataset.",
    "artifact": "",
    "done": [
     "El texto parseado de cada versión de cada documento vive en S3, direccionado por hash, y permite re-chunkear sin volver a las APIs ni al OCR.",
     "Cada chunk guarda su hash y la `model_version` del embedding, y solo se re-embeben los chunks cuyo hash cambió.",
     "El índice vive detrás de un alias, y el encoder de consultas no responde si su versión no es la del índice del alias.",
     "El golden set se versiona como un dataset y crece cada mes con casos del feedback."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.datos"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Curso · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ]
   },
   {
    "id": "indice-hibrido-en-opensearch",
    "base": null,
    "status": "nuevo",
    "title": "Índice híbrido en OpenSearch",
    "tramo": "modelo",
    "speed": "nuevo",
    "question": "",
    "note": "El embed-worker (L4, d = 1024) hace upsert solo de los chunks cuyo hash cambió; BM25 y HNSW viven en el mismo índice, detrás de un alias.",
    "artifact": "",
    "done": [
     "El clúster propio de OpenSearch tiene 3 nodos r7i.2xlarge en 3 zonas con 1 réplica, separado del de búsqueda del marketplace.",
     "Cada chunk lleva texto para BM25, un vector FP16 de d = 1024 (HNSW en faiss), metadatos y campos de ACL.",
     "El embed-worker en L4 hace upsert solo de los chunks cuyo hash cambió, con su `model_version`.",
     "Un backfill o re-embebido completo (≈ 44 L4-horas, ≈ US$36) va a un índice nuevo, con L4 spot temporales.",
     "El recall del ANN contra la búsqueda exacta se mide en un set canario."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Hoja · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Gate del golden set",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "El golden set corre contra el sistema completo: recall@8, faithfulness y precisión de citas con un juez calibrado, y permisos al 100 %. Lo pasa cualquier cambio de chunker, embeddings, reranker, prompt o LLM.",
    "artifact": "",
    "done": [
     "El golden set corre contra el sistema completo, como usuarios de prueba: recall@8 y MRR por fuente, área e idioma, más faithfulness y precisión de citas con el juez.",
     "La suite de permisos pasa al 100 %: ningún chunk de un documento restringido aparece en los 50 candidatos ni en el prompt, y una sola fuga bloquea.",
     "Contra la revisión actual: recall@8 pareado sin pérdida significativa ni caída de más de 5 pp en un slice, faithfulness y precisión de citas a no más de 2 puntos, y la abstención correcta no baja.",
     "El juez tiene kappa ≥ 0.6 y falso pase ≤ 10 % contra las respuestas de especialistas (puntos de partida), y se recalibra cuando cambian el juez o la rúbrica.",
     "Cualquier cambio de parser, chunker, embeddings, reranker, umbral de abstención, prompt o revisión del LLM pasa este mismo gate."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.evaluacion"
     },
     {
      "label": "Curso · M14 · Sistemas con LLMs · Evaluación: golden sets, jueces y gates",
      "href": "https://ronda-diseno-ml.vercel.app/#m14.evaluacion"
     },
     {
      "label": "Curso · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Hoja · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "`rag-api` con retrieval híbrido",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "`rag-api` (FastAPI, `POST /v1/ask` con SSE): principals → BM25 ∥ k-NN con RRF (k = 60) → reranker 50 → 8 → prompt de 8k → `llm-gateway` → citas validadas.",
    "artifact": "",
    "done": [
     "`POST /v1/ask` valida el token, resuelve los principals y lanza BM25 y k-NN en paralelo (300 ms de timeout cada uno), con el filtro de permisos dentro de las dos consultas y nunca como `post_filter`.",
     "RRF (k = 60) fusiona, la regla de ACL se re-aplica a los 50 (debe sacar cero) y el reranker deja 8, con máximo 3 chunks por documento; si no responde en 400 ms, queda el orden de RRF.",
     "El prompt entra en 8k: instrucciones fijas, historial recortado primero y 8 fuentes numeradas con fecha, ≤ 7,336 tokens y ≤ 7,500 según la estimación del gateway.",
     "Sin candidatos o debajo del umbral de abstención no se llama al LLM, y al cerrar el stream cada cita se valida contra las fuentes del prompt y los permisos.",
     "`pytest` en `reference/c11` pasa los 128 tests."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Curso · M14 · Sistemas con LLMs · RAG: el modelo con tus documentos",
      "href": "https://ronda-diseno-ml.vercel.app/#m14.rag"
     },
     {
      "label": "Hoja · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ]
   },
   {
    "id": "plataforma-llm-del-c10",
    "base": null,
    "status": "nuevo",
    "title": "Plataforma LLM del C10",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "`llm-gateway` con la llave del tenant `employee-assistant`, cuota en tokens/min y alias `chat-default` → réplicas de vLLM (≈ 70B, 8k de contexto).",
    "artifact": "",
    "done": [
     "El tenant `employee-assistant` tiene su llave en el `llm-gateway`, una cuota de ≈ 1 M tokens/min, prioridad interactiva y el alias `chat-default`, sin respaldo al proveedor externo.",
     "Cada llamada va con `stream: true` y `max_tokens` 600, y la cancelación se propaga si la persona cierra el chat.",
     "Un 429 o un 503 del gateway no se reintenta en loop: la respuesta pasa a solo resultados de búsqueda, igual que si el primer token no llega en 8 s.",
     "El tenant puede fijar su revisión del LLM hasta que su golden set apruebe la nueva."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
     },
     {
      "label": "Curso · C10 · Servir un LLM propio · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c10.arquitectura"
     },
     {
      "label": "Curso · C10 · Servir un LLM propio · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c10.serving"
     },
     {
      "label": "Hoja · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "igual",
    "title": "Contenedores del `rag-api`",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo se convierten el código y el engine en algo que corre igual en tu máquina, en CI y en el cluster?",
    "note": "Contenedores como en el C01 para `rag-api`, encoder y reranker; vLLM corre con su imagen oficial en la plataforma del C10.",
    "artifact": "Dockerfiles probados (gateway y Triton)",
    "done": [
     "La imagen del `rag-api` instala el lock de `service/requirements.txt` (con `uv pip compile`, para Linux x86_64 y Python 3.13), sin las dependencias de tests.",
     "Cada contenedor corre un solo proceso de uvicorn: se escala con réplicas, no con workers.",
     "El encoder de consultas corre en otro Deployment que el embed-worker, en las L4 del reranker.",
     "vLLM usa la imagen oficial `vllm/vllm-openai`, fijada por versión y digest en el manifest del C10."
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
      "label": "Curso · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Curso · C10 · Servir un LLM propio · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c10.archivos"
     },
     {
      "label": "Hoja · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ]
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD con el golden set",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo llega un commit a una imagen probada, inmutable y lista para desplegar?",
    "note": "Pruebas e imágenes como en el C01; lo que decide si un cambio sale es el gate del golden set.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "`pytest` pasa los 128 tests de las cinco carpetas en cada commit, sin OpenSearch, GPU ni gateway.",
     "`promtool check rules` y los dos `promtool test rules` pasan sobre `monitoring/alerts.yml`.",
     "Un cambio de chunker, embeddings, reranker, prompt o revisión del LLM no sale sin el gate del golden set aprobado.",
     "Una fuga de permisos en el golden set bloquea el release aunque el recall sea perfecto."
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
      "label": "Curso · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.evaluacion"
     },
     {
      "label": "Curso · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Hoja · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ]
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "EKS del C10 y L4",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "El LLM corre en el EKS del C10 (pods de vLLM con 2 × H100); el C11 suma L4 para encoder y reranker y su propio clúster de OpenSearch de 3 nodos.",
    "artifact": "",
    "done": [
     "El LLM corre en los pods `vllm-70b` del C10: 2 × H100 por pod, con TP=2.",
     "El C11 suma L4 para el encoder de consultas y el reranker (≈ 0.24 s para 50 pares).",
     "OpenSearch corre en su propio clúster de 3 nodos, separado del de búsqueda del marketplace.",
     "Los backfills usan L4 spot temporales y nunca hacen esperar a una pregunta."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Curso · C10 · Servir un LLM propio · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c10.arquitectura"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · GPUs en Kubernetes",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.gpus-k8s"
     },
     {
      "label": "Hoja · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Índice blue/green con alias",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Un modelo de embeddings nuevo es un índice nuevo (blue/green): se compara en shadow con preguntas reales y se cambia el alias junto con el encoder; el índice viejo queda unos días para rollback.",
    "artifact": "",
    "done": [
     "Un modelo de embeddings nuevo se embebe en un índice nuevo: los vectores de dos modelos nunca se mezclan.",
     "Pasa el gate y se compara en shadow con preguntas reales, revisando dónde cambian los top-8.",
     "El alias del índice cambia junto con la versión del encoder de consultas, y el índice viejo queda unos días para rollback.",
     "Mientras dura el cambio, el carril de permisos escribe en los dos índices.",
     "Cuando el C10 mueve `chat-default`, `employee-assistant` sigue en la revisión anterior hasta que su golden set apruebe la nueva."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.evaluacion"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.monitoreo"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Hoja · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "cambia",
    "title": "Pregunta en segundos, con streaming",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "De milisegundos a segundos: retrieval + rerank p95 ≤ 700 ms, primer token p95 ≤ 2.5 s y respuesta en streaming ≤ 10 s. Si la foto de grupos del IdP tiene más de 5 min, responde 503.",
    "artifact": "",
    "done": [
     "Retrieval + rerank p95 ≤ 700 ms, primer token p95 ≤ 2.5 s y respuesta completa en streaming ≤ 10 s.",
     "Con la foto del IdP de más de 5 min, el `rag-api` responde 503; una persona que no está en el IdP recibe 403.",
     "El evento `meta` sale con las fuentes antes de llamar al gateway, y el evento final trae un `outcome` que separa `no_sources` de `no_answer`.",
     "La traza guarda ids de chunks recuperados y citados, puntajes y latencias, sin el texto de la pregunta ni de la respuesta, durante 30 días."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.serving"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.requisitos"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Hoja · Del dato a producción · estación 11 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Monitoreo de edades y conteos",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Se suman el atraso de la ingestión y de los permisos (`ACLSyncStale`), la tasa de retrieval sin resultados y un canary de groundedness cada 4 h. No hay reentrenamiento: el lazo se cierra con cambios de chunking, prompt o índice que pasan el mismo gate.",
    "artifact": "",
    "done": [
     "Las 8 alertas de `alerts.yml` pasan sus tests de promtool, y las de latencia solo evalúan con ≥ 0.05 preguntas/s.",
     "`IngestionLagHigh` mira el atraso p95 por fuente (más de 15 min) y una fuente sin eventos en 1 h de horario de oficina; `IndexDocCountDrop`, los documentos por fuente contra hace 24 h.",
     "El canary de groundedness corre ≈ 100 preguntas fijas cada 4 h, y `GroundednessCanaryRegression` salta debajo de 85 %, a más de 5 puntos de su promedio de 7 días o si no corre en 8 h.",
     "El juez califica ≈ 1 % de las respuestas reales y se guarda solo el puntaje, los ids de chunks y el área.",
     "No hay reentrenamiento: cada cambio de chunking, prompt o índice pasa el mismo gate."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.monitoreo"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.archivos"
     },
     {
      "label": "Curso · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Hoja · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ]
   },
   {
    "id": "probe-de-permisos",
    "base": null,
    "status": "nuevo",
    "title": "Probe de permisos",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Cuentas sintéticas, con y sin acceso, preguntan cada pocos minutos por documentos canario: si alguien sin acceso los recupera, es un incidente de seguridad, no un ticket.",
    "artifact": "",
    "done": [
     "Hay documentos canario con frases únicas en cada fuente, y cuentas sintéticas con y sin acceso que preguntan cada pocos minutos.",
     "La cuenta sin acceso nunca recupera un documento canario.",
     "El probe revoca un acceso y cronometra cuánto tarda en desaparecer, contra el objetivo de ≤ 5 min.",
     "Un fallo es un incidente de seguridad con su runbook (desactivar la fuente, auditar las trazas por id de documento, avisar a Seguridad), no un ticket."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C11 · RAG empresarial · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.arquitectura"
     },
     {
      "label": "Curso · C11 · RAG empresarial · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c11.monitoreo"
     },
     {
      "label": "Curso · M15 · Seguridad y confiabilidad · Autenticación y autorización entre servicios",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.authn-authz"
     },
     {
      "label": "Hoja · Del dato a producción · patrón LLM",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-llm"
     }
    ]
   }
  ],
  "streaming": [
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Audio con licencia y consentimiento",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "El audio de clientes no se guarda: el audio etiquetado sale de corpus con licencia, grabaciones por acento con consentimiento y clientes con opt-in, transcrito por personas con una guía.",
    "artifact": "",
    "done": [
     "Cada archivo entra con su manifiesto (transcripción, hablante, slice, licencia y consentimiento); sin licencia o consentimiento rastreable, no entra.",
     "El audio sale de corpus con licencia comercial verificada, grabaciones por acento con consentimiento y organizaciones con opt-in; nunca de clientes sin consentimiento.",
     "Las transcripciones siguen una guía escrita y versionada (números, muletillas, code-switching, habla superpuesta), con doble pasada en el golden set.",
     "El acuerdo entre quienes transcriben está medido como WER entre dos transcripciones independientes.",
     "El audio opt-in vive en un bucket separado, cifrado, con acceso por rol y borrado a pedido."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Curso · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Curso · M15 · Seguridad y confiabilidad · Datos personales: dónde están, cuánto duran y quién los ve",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.pii-privacidad"
     },
     {
      "label": "Hoja · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "igual",
    "title": "Golden sets congelados por slice",
    "tramo": "datos",
    "speed": "semanas",
    "question": "¿Cómo sabes, meses después, con qué datos exactos se entrenó un modelo?",
    "note": "Golden sets congelados por idioma y slice (acento, ruido, dispositivo), separados por hablante de los datos de entrenamiento.",
    "artifact": "snapshot ds-2026-09-01 (manifest inmutable)",
    "done": [
     "Hay un golden set por idioma (español, inglés y portugués), con slices por acento o región, ruido, dispositivo, habla superpuesta, code-switching y teléfono.",
     "El golden set se separa del entrenamiento por hablante y por sesión, se deduplica por huella de audio y texto, y nunca entra a entrenamiento.",
     "La normalización del WER está escrita y versionada, y su versión se reporta junto a cada número.",
     "Los intervalos de cada slice salen de un bootstrap por hablante, no por palabra."
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
      "label": "Curso · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.evaluacion"
     },
     {
      "label": "Curso · M09 · Datos y features · Data leakage: cuando el training conoce el futuro",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.leakage"
     },
     {
      "label": "Curso · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Fine-tune de ASR streaming",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Se parte de un ASR streaming preentrenado (transducer/CTC) y, si hace falta, se ajusta por idioma: nada se entrena desde cero.",
    "artifact": "",
    "done": [
     "Se parte de un ASR streaming preentrenado (transducer o CTC); nada se entrena desde cero.",
     "El fine-tuning por idioma sale del modelo base o del de producción, en GPUs rentadas (spot con checkpoints).",
     "Lo dispara un slice que se queda atrás, y hay una revisión trimestral."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Curso · M10 · MLOps · Pipelines de entrenamiento orquestados",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.pipelines-entrenamiento"
     },
     {
      "label": "Hoja · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Gate de WER y streams",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "WER por idioma y slice con normalización fija, más latencia y streams por GPU medidos en una L4, contra el modelo en producción.",
    "artifact": "",
    "done": [
     "El WER de cada slice no es peor que el de producción más su intervalo, con la normalización fija, y el slice objetivo mejora.",
     "Ningún slice queda peor que 1.5× el promedio de su idioma.",
     "La latencia de parciales y los streams por L4 se miden en una L4 real con fragmentos de 160 ms, junto con la tasa de revisiones de parciales.",
     "Si el modelo se cuantiza, el gate corre sobre el engine, no sobre el checkpoint."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.evaluacion"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Curso · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Hoja · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "igual",
    "title": "Engine para L4 y config",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "¿Cómo pasa el checkpoint de PyTorch a un engine que Triton sirve rápido, sin cambiar sus predicciones?",
    "note": "Como en el C01, el engine se compila para la GPU que sirve (L4); el registry guarda además la config de streaming (fragmento, lookahead, endpointing).",
    "artifact": "engine model.plan (versión challenger)",
    "done": [
     "El engine se compila para L4, la GPU que sirve: TensorRT no es portable entre GPUs.",
     "El registry guarda, por idioma, el modelo, su engine para L4, la configuración de streaming (fragmento, lookahead y endpointing), las métricas del gate y la versión del golden set.",
     "FP16 o INT8 con TensorRT se valida con el WER por slice sobre el engine."
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
      "label": "Curso · C13 · Speech-to-text en vivo · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.datos"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Curso · M08 · Optimización de modelos · TensorRT",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
     },
     {
      "label": "Curso · M08 · Optimización de modelos · Cómo validar una optimización",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.validar"
     },
     {
      "label": "Hoja · Del dato a producción · estación 5 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "Gateway CPU y worker GPU",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "`asr-gateway` en CPU (Opus → 16 kHz, VAD, fragmentos de 160 ms) y `asr-worker` en L4 con el sequence batcher de Triton: estado por stream, parciales y finales.",
    "artifact": "",
    "done": [
     "El `asr-gateway` decodifica Opus, remuestrea a 16 kHz mono, aplica VAD y arma fragmentos de 160 ms con 100 ms de pre-roll; el final sale con 600 ms de silencio o con el tope de 20 s.",
     "El `asr-worker` usa el sequence batcher de Triton con una secuencia por frase, cerrada en el endpoint, y `max_sequence_idle_microseconds` (1 s por defecto) está decidido contra las pausas del VAD.",
     "Una palabra se congela cuando terminó hace más de 800 ms de audio, lo tentativo se muestra aparte y las correcciones del final se cuentan.",
     "Las colas de cada sesión están acotadas: si el modelo va ≈ 2 s atrás, el worker cierra con 1013, y quien no lee pierde parciales pero nunca finales.",
     "`pytest` en `reference/c13` pasa los 95 tests."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Curso · M07 · Servidores de modelos · NVIDIA Triton Inference Server",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.triton"
     },
     {
      "label": "Hoja · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ]
   },
   {
    "id": "sesion-por-pista-grpc-bidireccional",
    "base": null,
    "status": "nuevo",
    "title": "Sesión por pista (gRPC bidireccional)",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "El SFU abre un stream por participante hacia el `asr-gateway` (≈ 200k conectadas en el pico); con VAD, solo las pistas con voz gastan GPU.",
    "artifact": "",
    "done": [
     "El SFU abre un stream gRPC por pista hacia un `asr-gateway` de su misma zona, identificado por `meeting_id` + `participant_id`, con idioma y organización.",
     "El fork es fire-and-forget: si el gateway no recibe, el SFU descarta paquetes y la reunión sigue igual.",
     "El keepalive tiene un intervalo menor que el idle timeout más corto del camino, y el ping del cliente y la política de pings del servidor se configuran juntos.",
     "Solo las frases con voz abren una secuencia en el worker: una pista callada no gasta GPU.",
     "El gateway guarda la frase en curso (hasta 20 s) para reenviarla si el worker se cae."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.arquitectura"
     },
     {
      "label": "Curso · M07 · Servidores de modelos · Protocolos: REST, gRPC, KServe v2 y OpenAI-compatible",
      "href": "https://ronda-diseno-ml.vercel.app/#m07.protocolos"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Streaming: inferencia sobre eventos",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.streaming"
     },
     {
      "label": "Hoja · Del dato a producción · patrón streaming",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "igual",
    "title": "Contenedores de gateway y worker",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo se convierten el código y el engine en algo que corre igual en tu máquina, en CI y en el cluster?",
    "note": "Gateway y worker en contenedores, como en el C01; el worker corre como Deployment de GPU.",
    "artifact": "Dockerfiles probados (gateway y Triton)",
    "done": [
     "La imagen del `asr-worker` lleva como tag la versión del modelo y el manifest la fija además por digest.",
     "Sus dependencias salen del lock de `server/requirements.txt` (con `uv pip compile`), sin los tests.",
     "uvicorn corre con `--ws-max-size 65536`, `--timeout-graceful-shutdown 10` y pings de WebSocket cada 20 s."
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
      "label": "Curso · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Curso · M05 · Contenedores · Registries y tags inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.registries"
     },
     {
      "label": "Hoja · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ]
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD y pruebas",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo llega un commit a una imagen probada, inmutable y lista para desplegar?",
    "note": "Pruebas e imágenes como en el C01.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "`pytest` pasa los 95 tests de las cuatro carpetas en cada commit, sin GPU, modelo ni SFU.",
     "`promtool check rules` y `promtool test rules` pasan sobre las 8 alertas.",
     "El manifest pasa `kubernetes-validate --strict` en sus recursos core, y el ScaledObject y el PodMonitor pasan el esquema de sus CRDs.",
     "El CD despliega solo versiones aprobadas por el gate y registradas con su engine para L4."
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
      "label": "Curso · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Curso · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Hoja · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ]
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "KEDA por streams activos",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "KEDA escala `asr-worker` por streams activos por GPU (objetivo 350) y un cron sube el mínimo antes de la mañana. Un nodo L4 tarda 5–13 min, y bajar réplicas es drenar (`preStop`).",
    "artifact": "",
    "done": [
     "KEDA escala `asr-worker` entre 20 y 220 réplicas con `sum(asr_active_streams)` (objetivo 350 por pod) y `asr_sessions` (objetivo 1,200), y cada pod pide una L4 entera.",
     "Un trigger cron fija al menos 120 pods de lunes a viernes de 7:30 a 11:00 (hora del centro de México), y si Prometheus no contesta, el fallback de KEDA pide 120.",
     "Sube rápido y baja de a 5 pods cada 5 min, con una ventana de 20 min.",
     "El `preStop` drena hasta 60 s, `terminationGracePeriodSeconds` es 90 y el PDB permite como mucho 5 % de disrupciones voluntarias."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · Cold starts de punta a punta",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.cold-starts"
     },
     {
      "label": "Hoja · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ]
   },
   {
    "id": "router-de-sesiones-con-afinidad",
    "base": null,
    "status": "nuevo",
    "title": "Router de sesiones con afinidad",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Asigna cada sesión a un `asr-worker` de su zona contando streams activos, no requests ni CPU, y la mantiene ahí (sticky).",
    "artifact": "",
    "done": [
     "Asigna cada sesión al worker de su zona que tiene el idioma y más lugares libres en sesiones, salteando los que tienen sus streams activos en el tope (450).",
     "La asignación es sticky, y tres heartbeats perdidos (uno por segundo) marcan al worker como muerto: sus sesiones se reparten en la zona.",
     "No asigna a workers drenando y rebalancea solo en el fin de frase.",
     "Cruzar de zona es solo una degradación, y se cuenta en una métrica."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.fallas"
     },
     {
      "label": "Hoja · Del dato a producción · patrón streaming",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Canary por sesiones nuevas",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Canary por porcentaje de sesiones nuevas, no de requests, porque cada sesión queda asignada a su worker (sticky).",
    "artifact": "",
    "done": [
     "El modelo aprobado se carga en un grupo de workers y el router le manda 5 % de las sesiones nuevas de su idioma; las sesiones existentes no se mueven.",
     "Sube a 25 %, 50 % y 100 % en días, solo si `CanaryWERRegression` no salta y las señales de uso no empeoran.",
     "Un A/B de modelos se aleatoriza por reunión u organización, no por participante.",
     "El rollback vuelve a la versión anterior del registry, y los workers se reemplazan drenando."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.arquitectura"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.evaluacion"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Canary: porcentajes, tiempos y criterios para avanzar",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.canary"
     },
     {
      "label": "Hoja · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "cambia",
    "title": "Parciales y finales en vivo",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "En vez de una request, una sesión gRPC larga por pista: parciales p95 ≤ 500 ms y finales p95 ≤ 1.5 s después del fin de la frase.",
    "artifact": "",
    "done": [
     "Parciales p95 ≤ 500 ms de la palabra a la pantalla, y finales p95 ≤ 1.5 s después del fin de la frase.",
     "Los 500 ms están repartidos por tramos: red, espera del fragmento, cola, cómputo y entrega.",
     "Si cae un worker, el gateway lo nota en 1 s, reabre la sesión en otro y reenvía la frase en curso: ≈ 1–2 s sin parciales y ningún final perdido.",
     "Los parciales se agrupan a 5 por segundo por stream como máximo, y solo si el texto cambió; los finales siempre salen."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Requisitos",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.requisitos"
     },
     {
      "label": "Curso · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Hoja · Del dato a producción · estación 11 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     }
    ]
   },
   {
    "id": "caption-bus-por-reunion",
    "base": null,
    "status": "nuevo",
    "title": "caption-bus por reunión",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Pub/sub en memoria (NATS o Redis Pub/Sub): los workers publican parciales y finales, y la señalización WebSocket existente los empuja a cada cliente.",
    "artifact": "",
    "done": [
     "Hay un tema por reunión en un pub/sub en memoria (NATS o Redis Pub/Sub): los workers publican y los servidores de señalización consumen.",
     "Cada mensaje lleva `meeting_id`, hablante, `utterance_id`, número de secuencia, tipo y texto congelado y tentativo; el cliente reemplaza por `utterance_id` y descarta secuencias viejas.",
     "El bus guarda los finales de los últimos 60 s de cada reunión para quien se reconecta.",
     "`CaptionDeliveryLag` salta con el p95 de entrega a la señalización arriba de 250 ms durante 10 min.",
     "Solo los finales de reuniones con guardar activado se copian a Kafka; si no, el texto existe solo en memoria."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.arquitectura"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.serving"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.monitoreo"
     },
     {
      "label": "Hoja · Del dato a producción · patrón streaming",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Monitoreo por tramos y streams",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Latencia por tramo, streams activos (también la señal del autoscaling), reconexiones y fracción de voz; el canary golden mide WER en producción. Se reentrena por disparadores, con revisión trimestral.",
    "artifact": "",
    "done": [
     "Las 8 alertas pasan sus tests de promtool, con presupuesto por tramo del servidor: `CaptionPartialLatencyHigh` a 200 ms, `CaptionFinalLatencyHigh` a 1.2 s y `GPUStreamSaturation` con el paso del modelo arriba de 128 ms.",
     "`SessionReconnectRateHigh` cuenta solo reconexiones no planeadas (más de 2 % en 15 min), sin `migrate` ni la duración máxima.",
     "`VADActiveRatioShift` compara la fracción de voz con la misma hora de la semana pasada (debajo de 0.7× o arriba de 1.3× durante 1 h).",
     "En los logs no hay audio ni texto: solo ids, tiempos y contadores.",
     "Se reentrena por disparadores (un slice atrás, un cambio del audio de entrada, un modelo mejor), con revisión trimestral."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.monitoreo"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.archivos"
     },
     {
      "label": "Curso · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Hoja · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ]
   },
   {
    "id": "canary-golden-en-produccion",
    "base": null,
    "status": "nuevo",
    "title": "Canary golden en producción",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Un bot entra a una reunión interna y reproduce audio del golden set: mide WER y latencia de punta a punta sin tocar audio de clientes.",
    "artifact": "",
    "done": [
     "Un bot entra cada pocos minutos, por región e idioma, a una reunión interna y reproduce audio del golden set como participante.",
     "Recorre el camino real (SFU, gateway, router, worker y bus) y mide WER y latencia de punta a punta sin tocar audio de clientes.",
     "`CanaryWERRegression` salta si el WER de la versión canary supera al de la estable + 1 punto, con ≥ 5,000 palabras de referencia durante 30 min, y el rollout se detiene."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.evaluacion"
     },
     {
      "label": "Curso · C13 · Speech-to-text en vivo · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c13.monitoreo"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Canary: porcentajes, tiempos y criterios para avanzar",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.canary"
     },
     {
      "label": "Hoja · Del dato a producción · patrón streaming",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-streaming"
     }
    ]
   }
  ],
  "edge": [
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Imágenes de línea y veredictos",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Las imágenes salen de la cámara de la línea, y el veredicto que registra quien inspecciona, en la tablet, es el label más barato. Al inicio hay ≈ 2,000 piezas buenas y ≈ 300 defectos.",
    "artifact": "",
    "done": [
     "El shadow de la línea 1 junta imágenes con la cámara y el estrobo de producción; al inicio hay ≈ 2,000 piezas buenas y ≈ 300 defectos.",
     "Quien inspecciona etiqueta cada pieza desviada en la tablet con un toque: buena, uno de los 4 tipos u otro.",
     "Calidad revisa todos los desacuerdos y ≈ 5 % de los veredictos, y en ≈ 10 % la tablet oculta el motivo para medir el anclaje.",
     "Las imágenes de la línea se filtran (fuera las de score alto, con una muestra auditada) antes de entrar al set de piezas buenas.",
     "También se recolectan el 1 % de las aprobadas, los casi-rechazos y cada escape que reporta la armadora."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Curso · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "igual",
    "title": "Snapshots, golden sets y linaje",
    "tramo": "datos",
    "speed": "semanas",
    "question": "¿Cómo sabes, meses después, con qué datos exactos se entrenó un modelo?",
    "note": "Snapshots inmutables en S3, golden sets congelados por tipo de defecto y linaje pieza ↔ imagen ↔ modelo ↔ decisión.",
    "artifact": "snapshot ds-2026-09-01 (manifest inmutable)",
    "done": [
     "Cada lote de labels produce un snapshot con manifest (hash de imagen, label, fuente del label y versión) e id inmutable en S3.",
     "Los golden sets por tipo de defecto están congelados, nunca entran a entrenamiento y se arman con defectos que no pasaron por el filtro del modelo.",
     "Cada decisión es un registro inmutable con `decision` y `model_decision`, versión de modelo y umbrales, scores, latencia y acuse del PLC.",
     "Los labels son eventos con autor y hora: nunca se sobrescriben, se corrigen con uno nuevo."
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
      "label": "Curso · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Curso · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Entrenamiento en la nube",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Job de GPU en la nube, bajo demanda: anomalías entrenadas con piezas buenas y, cuando hay defectos suficientes, un clasificador por tipo. Mensual o por disparador.",
    "artifact": "",
    "done": [
     "Un job de GPU en la nube, bajo demanda, entrena la anomalía con piezas buenas y, cuando hay cientos de defectos por tipo, el clasificador.",
     "La corrida es reproducible: snapshot de datos, commit y contenedor por digest.",
     "Usa el mismo preprocesamiento (recorte, normalización y tiles) que corre en el Jetson.",
     "El split es por tiempo o por lote, nunca aleatorio."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Curso · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
     },
     {
      "label": "Curso · M09 · Datos y features · Training-serving skew: causas, detección y prevención",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.skew"
     },
     {
      "label": "Hoja · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Recall por tipo y umbral",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Recall por tipo de defecto a FP fijo en los golden sets, y umbral elegido por costo esperado con recall ≥ 99.5 % (`choose_threshold.py`).",
    "artifact": "",
    "done": [
     "El recall por tipo de defecto se mide a FP fijo en los golden sets, con slices por variante de pieza, línea y cámara, turno y lote.",
     "`choose_threshold.py` elige el umbral con recall ≥ 99.5 % por tipo, objetivo de 1.5 % de FP y tope duro de ≈ 2.85 %; si ningún umbral cumple, sale con error.",
     "Con clasificador, cada cabeza recibe su parte del presupuesto de FP (`--target-fp-rate 0.003 --max-fp-rate 0.0057`), y la combinación se verifica ≤ 1.5 % antes de escribir `config.yaml`.",
     "El recall se reporta con su cota de Clopper-Pearson: afirmar 99.5 % pide ≈ 600 defectos reales por tipo sin fallas.",
     "Si algún tipo no llega a 99.5 %, no se construye nada."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.evaluacion"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Curso · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Hoja · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "cambia",
    "title": "Engine en un Jetson idéntico",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "El engine se construye en un Jetson de CI idéntico a los de la línea (mismo módulo, JetPack y modo de energía), con paridad contra el ONNX y latencia a batch fijo.",
    "artifact": "",
    "done": [
     "El engine TensorRT FP16 se construye con `build_engine_jetson.sh` en un Orin NX con el mismo módulo, JetPack y modo de energía que la línea.",
     "El script verifica el modo con `EXPECTED_POWER_MODE` y deja el `.plan`, el log de trtexec y un JSON con el sha256 del ONNX y del plan.",
     "El shape es fijo: un batch de 20 tiles de 512 × 512 y un solo perfil.",
     "La paridad contra el ONNX pasa, y la inferencia con el batch fijo cabe en ≤ 120 ms medida con trtexec.",
     "Se empieza en FP16; INT8 solo si FP16 no cabe, calibrando con defectos incluidos."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.archivos"
     },
     {
      "label": "Curso · M08 · Optimización de modelos · TensorRT",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
     },
     {
      "label": "Hoja · Del dato a producción · estación 5 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "Loop de inspección en Jetson",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Un proceso en el Jetson Orin NX: adquiere la imagen, arma 20 tiles, corre TensorRT FP16 y escribe al PLC por Modbus TCP; si no alcanza, un deadline guard escribe `DIVERT`.",
    "artifact": "",
    "done": [
     "`app.py` mide el deadline desde el trigger (trigger + 350 ms) y consume el frame de cada trigger aunque llegue tarde.",
     "`decide()` da REJECT si cualquier score es ≥ su umbral; un NaN, un score fuera de [0, 1] o un tipo que falta es DIVERT, nunca PASS.",
     "Si tras la foto quedan menos de ≈ 140 ms, DIVERT inmediato; si no caben los 50 ms de escritura, no escribe nada.",
     "Una imagen oscura sale `bad_image` (DIVERT), y el watchdog termina el proceso tras 30 s sin avance.",
     "Pasan los 62 tests del inspector y los 20 de la herramienta de umbrales."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.archivos"
     },
     {
      "label": "Curso · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Hoja · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "cambia",
    "title": "Imagen arm64 con compose",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Imagen arm64 sobre `l4t-tensorrt`, con `docker compose` (`runtime: nvidia`, red del host); los engines se montan aparte para volver al anterior sin red.",
    "artifact": "",
    "done": [
     "La imagen parte de `nvcr.io/nvidia/l4t-tensorrt:r10.3.0-runtime`, con el mismo TensorRT que JetPack 6.2.x, y corre con un usuario no root.",
     "`docker-compose.yml` usa `runtime: nvidia`, `network_mode: host`, `restart: unless-stopped`, `read_only: true` y `cap_drop: ALL`.",
     "`config.yaml` y `/opt/inspector/models` se montan de solo lectura: el engine no va dentro de la imagen.",
     "El healthcheck lee el heartbeat (informa, no reinicia) y los logs rotan a 50 MB × 5 archivos."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.archivos"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Curso · M05 · Contenedores · GPUs dentro del contenedor: NVIDIA Container Toolkit",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.gpu-en-contenedor"
     },
     {
      "label": "Hoja · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ]
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "cambia",
    "title": "Versión firmada con plan",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Cada versión se registra firmada (ONNX, engine por módulo y JetPack, umbrales y contenedor) junto con su plan de rollout por líneas.",
    "artifact": "",
    "done": [
     "Cada versión se registra firmada: ONNX, engine por módulo y JetPack, umbrales por tipo, contenedor por digest y métricas del gate.",
     "Lleva su plan de rollout: línea 1 en shadow un turno, línea 1 canary, las 4 líneas y después las otras plantas.",
     "`choose_threshold.py` funciona como gate en CI: sin un umbral que cumpla recall y tope, el pipeline falla.",
     "Los tests del inspector y de la herramienta de umbrales pasan con Python 3.10, el de JetPack 6."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.arquitectura"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.evaluacion"
     },
     {
      "label": "Curso · M15 · Seguridad y confiabilidad · Supply chain: imágenes, dependencias y pesos verificados",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.supply-chain"
     },
     {
      "label": "Hoja · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ]
   },
   {
    "id": "ota-por-la-dmz",
    "base": null,
    "status": "nuevo",
    "title": "OTA por la DMZ",
    "tramo": "release",
    "speed": "nuevo",
    "question": "",
    "note": "La DMZ baja los artefactos firmados con conexiones salientes, verifica la firma y los copia a un registry local de la red OT: los dispositivos nunca salen a internet.",
    "artifact": "",
    "done": [
     "El gateway de la DMZ descarga con conexiones salientes, verifica la firma y copia los artefactos al registry local de la red OT.",
     "Los dispositivos solo descargan del registry local y nunca salen a internet.",
     "Las actualizaciones entran en la ventana nocturna y, si no hay enlace, esperan."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.arquitectura"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Edge / on-device",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.edge"
     },
     {
      "label": "Hoja · Del dato a producción · patrón edge",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Shadow y canary por línea",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Por línea: de noche el engine baja al slot B con un smoke test, la línea 1 corre un turno en shadow, después canary y las 4 líneas. El rollback es local, sin red.",
    "artifact": "",
    "done": [
     "De noche el engine nuevo baja al slot B, junto al actual, y pasa un smoke test con imágenes patrón.",
     "La línea 1 corre un turno completo en shadow: el challenger solo registra, después de que el champion escribió al PLC.",
     "Avanza solo si no pierde ningún defecto que el champion detectó, no sube los FP y tiene cero deadline misses; calidad revisa todos los desacuerdos.",
     "Después la línea 1 decide varios turnos (canary) y luego sigue una ola por línea.",
     "El rollback es local y en minutos: `config.yaml` vuelve a apuntar al engine anterior y se reinicia el contenedor, sin red."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.evaluacion"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Rollback: criterios automáticos y qué guardar para volver",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.rollback"
     },
     {
      "label": "Hoja · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "cambia",
    "title": "Pieza decidida en 350 ms",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "No hay HTTP: la fotocelda dispara la cámara por hardware en cada pieza (2 por segundo por línea) y la decisión tiene un deadline de 350 ms.",
    "artifact": "",
    "done": [
     "La fotocelda dispara la cámara por hardware y el PLC asigna el número de secuencia; en ≈ 50 ms la imagen está en memoria del Jetson.",
     "El p99.9 del loop queda ≤ 350 ms en turnos completos, con el gabinete cerrado.",
     "La decisión sale como `[part_id, código]` en una sola escritura Modbus TCP, sin reintentos.",
     "El shape es fijo, no hay dynamic batching, el modo de energía está fijo y `jetson_clocks` se aplica en cada arranque.",
     "`inspection_latency_seconds` tiene un bucket en 0.35 s, y `inspection_deadline_miss_total` queda ≈ 0."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.estimaciones"
     },
     {
      "label": "Curso · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Hoja · Del dato a producción · estación 11 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     }
    ]
   },
   {
    "id": "plc-con-default-seguro",
    "base": null,
    "status": "nuevo",
    "title": "PLC con default seguro",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "El PLC deja pasar una pieza solo si llegó un PASS con su número antes del deadline. Jetson caído, red caída o decisión tarde terminan igual: desviada.",
    "artifact": "",
    "done": [
     "El PLC desvía toda pieza que no tenga un PASS válido para su `part_id` antes del deadline: el código 0, sin decisión, equivale a desviar.",
     "El PLC vuelve el registro a 0 al usar una decisión, porque el `part_id` de 16 bits se repite cada 65,536 piezas.",
     "Un sensor en la rampa confirma cada pieza desviada; sin confirmación, con presostato bajo o con el contenedor lleno, el PLC para la línea y enciende el andon.",
     "Jetson caído, red caída o decisión tarde terminan igual: la pieza se desvía."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.serving"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.fallas"
     },
     {
      "label": "Curso · M15 · Seguridad y confiabilidad · Degradación con gracia: contener la falla",
      "href": "https://ronda-diseno-ml.vercel.app/#m15.degradacion"
     },
     {
      "label": "Hoja · Del dato a producción · patrón edge",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Prometheus y andon locales",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Prometheus y andon en la planta, porque puede no haber internet; a la nube suben heartbeats y agregados. Si la tasa de rechazo supera 2× su base durante 30 min, lo probable es luz, lente o foco, no defectos.",
    "artifact": "",
    "done": [
     "`app.py` exporta sus 7 métricas con series en 0 desde el arranque, y los DIVERT se cuentan por sus 10 motivos.",
     "Las alertas que hacen page se evalúan en el Prometheus y el Alertmanager de la planta, y llegan al andon y a la tablet de mantenimiento.",
     "`RejectRateSpike` salta con los REJECT arriba de 2× su base de 7 días durante 30 min, sin mezclar los DIVERT.",
     "`AnomalyScoreDrift` compara la mediana de la última hora contra la de 7 días + 0.1, durante 2 h.",
     "`DeviceOffline` en la nube solo alerta en horario de turno y si el gateway de la planta sí reporta; si falta el gateway, es un solo ticket de enlace."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.monitoreo"
     },
     {
      "label": "Curso · M12 · Monitoreo · Prometheus, Grafana y alertas por SLO",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.prometheus-grafana"
     },
     {
      "label": "Hoja · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ]
   },
   {
    "id": "store-and-forward-a-la-nube",
    "base": null,
    "status": "nuevo",
    "title": "Store-and-forward a la nube",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Decisiones, imágenes de rechazos y veredictos esperan en el almacén de planta y suben cuando hay enlace: la línea opera ≥ 72 h sin internet.",
    "artifact": "",
    "done": [
     "El almacén de planta guarda registros de decisión, imágenes de rechazos, la muestra de aprobadas y los veredictos, y la línea opera ≥ 72 h sin internet.",
     "La subida es idempotente (cada registro con id, cada imagen nombrada por su hash) y reanuda donde se quedó.",
     "Suben primero registros y veredictos, después los rechazos y al final la muestra, con límite de ancho de banda durante los turnos.",
     "El almacén aguanta semanas (≈ 69 GB/día) y el atraso de la sincronización se mide.",
     "Con el disco lleno se descarta primero lo ya sincronizado; los registros de decisión nunca."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.datos"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.fallas"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Edge / on-device",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.edge"
     },
     {
      "label": "Hoja · Del dato a producción · patrón edge",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
     }
    ]
   },
   {
    "id": "piezas-patron-en-cada-turno",
    "base": null,
    "status": "nuevo",
    "title": "Piezas patrón en cada turno",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Cada turno empieza con piezas buenas y defectuosas conocidas; sin ese chequeo, ninguna pieza recibe PASS. Así se detectan un lente sucio, un foco movido o una luz degradada antes de producir.",
    "artifact": "",
    "done": [
     "Cada turno empieza con las piezas patrón de la estación (2 buenas y 1 de cada tipo de defecto), con la línea en modo golden.",
     "Las defectuosas se rechazan y las buenas pasan al menos 0.15 por debajo del umbral de anomalía.",
     "Hasta que el chequeo pasa en ese proceso, ninguna pieza recibe PASS, y la aprobación vence al iniciar el turno siguiente.",
     "`GoldenPartCheckFailed` salta con `golden_part_check_ok == 0` durante 10 min en horario de turno.",
     "Cada pieza patrón mala tiene que confirmarse en el contenedor: así se prueba también el sensor de la rampa."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C03 · Inspección visual en planta · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.monitoreo"
     },
     {
      "label": "Curso · C03 · Inspección visual en planta · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c03.archivos"
     },
     {
      "label": "Hoja · Del dato a producción · patrón edge",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#pat-edge"
     }
    ]
   }
  ],
  "asincrono": [
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Datos y etiquetas",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Las horas de patólogo son el recurso escaso: 20 h al mes (≈ US$4k, el costo dominante del sistema) se reparten entre auditoría, set temporal y regiones elegidas por active learning. Las correcciones del sign-out son labels gratis pero sesgados: “aceptado sin cambios” no significa “correcto”.",
    "artifact": "",
    "done": [
     "El reparto del mes está hecho: ≈ 2 h de auditoría aleatoria, ≈ 2.5 h de set temporal y ≈ 15.5 h de active learning (≈ 620 regiones a 1.5 min).",
     "`select_for_labeling.py` eligió por incertidumbre y diversidad: como mucho 5 regiones por lámina, estratos por laboratorio y escáner, el laboratorio C primero y ninguna lámina del golden set.",
     "El QC corrió antes de seleccionar: marcas de plumón, pliegues, burbujas y zonas fuera de foco no gastan horas de patólogo.",
     "Las copias para etiquetar están desidentificadas: sin imagen de etiqueta ni macro, metadatos limpios con una lista de campos permitidos e ids seudonimizados.",
     "El golden set y la auditoría se anotan de forma independiente, sin ver el overlay: residentes pre-anotan y un patólogo aprueba."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.datos"
     },
     {
      "label": "Curso · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "cambia",
    "title": "Versionado y linaje",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Cada snapshot es un manifest inmutable que dice de dónde salió cada label, y el golden set de 100 láminas vive aparte, congelado. Sin linaje no puedes responder qué versión del modelo generó el resultado que alguien firmó hace 8 meses.",
    "artifact": "",
    "done": [
     "El manifest tiene el sha256 de cada lámina, la versión de anotación, la versión de la guía, la fuente del label (anotación independiente, corrección o región de active learning) y el split.",
     "El split es por paciente (como mínimo por lámina), nunca por tile; el set temporal mensual además separa por fecha.",
     "El snapshot excluye por id seudonimizado de paciente todo lo que está en el golden set o en los sets temporales.",
     "El golden set (100 láminas, 2 patólogos + consenso) se versiona como artefacto aparte y solo cambia con altas controladas."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.datos"
     },
     {
      "label": "Curso · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Entrenamiento por tiles",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Un job de GPU bajo demanda, mensual o por disparador (drift, laboratorio o escáner nuevo), entrena con tiles muestreados de las regiones anotadas. El riesgo propio de este caso es el skew: el entrenamiento y el worker tienen que leer y reducir igual.",
    "artifact": "",
    "done": [
     "La corrida es reproducible: snapshot de datos, commit y contenedor por digest.",
     "Los tiles salen con el mismo código de lectura y reducción que el worker (el 2× desde nivel 0).",
     "Con anotaciones parciales, la pérdida solo se calcula donde hay label.",
     "Si se normaliza el color en inferencia, la normalización entra al hash de configuración; la augmentation de color solo vive en entrenamiento."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.datos"
     },
     {
      "label": "Curso · M10 · MLOps · Reproducibilidad: los cinco ingredientes",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reproducibilidad"
     },
     {
      "label": "Hoja · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Gate por slice",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Los criterios se escriben antes de entrenar y se miden en el golden set por slice (laboratorio, escáner, tipo de espécimen), con intervalos y contra el techo de acuerdo entre patólogos (Dice ≈ 0.75–0.85). En el C05 el gate es por campo y el modelo se registra junto con su archivo de umbrales.",
    "artifact": "",
    "done": [
     "Ningún slice queda peor que producción por más que su intervalo (p. ej. Dice −0.02, comparación pareada con bootstrap por lámina).",
     "La sensibilidad por lesión (focos ≥ 1 mm) es ≥ 95 % con ≤ 1 región falsa por lámina, y el error del % de tumor es ≤ 5 puntos.",
     "La calibración por slice está medida y el umbral de decisión quedó registrado como parte del artefacto.",
     "El registry guarda el linaje (dataset, commit, digest, config de preprocesamiento, engine y umbral); si el candidato no pasa, no se registra."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.evaluacion"
     },
     {
      "label": "Curso · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Hoja · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "cambia",
    "title": "Engine TensorRT en L4",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Como en el C01 se exporta a ONNX y se construye un engine TensorRT FP16, pero en una L4 y para que lo cargue el propio worker, horneado en su imagen. En el C05 no hay GPU: el extractor corre en CPU con ONNX Runtime, sin Triton ni batching dinámico.",
    "artifact": "",
    "done": [
     "El engine se construyó con `trtexec --fp16` en una L4, dentro de `tensorrt:26.08-py3`, la misma imagen base del worker.",
     "El parity test del engine contra PyTorch pasó sobre tiles reales.",
     "`trtexec` midió el máximo por L4 (supuesto del caso: ≈ 300 tiles/s) y el plan queda al ≈ 70 %: 200 tiles/s por worker.",
     "Sabes que el engine queda atado a la GPU (L4 = Ada, sm_89) y a la versión exacta de TensorRT: cambiar la base o la GPU obliga a reconstruirlo y a pasar otra vez por el gate."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.archivos"
     },
     {
      "label": "Curso · M08 · Optimización de modelos · TensorRT",
      "href": "https://ronda-diseno-ml.vercel.app/#m08.tensorrt"
     },
     {
      "label": "Hoja · Del dato a producción · estación 5 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "El worker por lámina",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "No hay endpoint: el código de serving es `seg-worker`, que toma un mensaje, descarga la lámina a NVMe, valida, tilea solo el tejido con solape, infiere en batches y cose el mapa. Una lámina son ≈ 20–30 s de GPU, que romperían cualquier timeout de HTTP razonable.",
    "artifact": "",
    "done": [
     "La idempotency key es sha256 + model_version + hash de la config: una reentrega con un resultado ok ya escrito no toca la GPU.",
     "Un mpp faltante, raro o distinto (± 10 %) del calibrado del escáner, o menos de 1 mm² de tejido, escribe `qc_blocked` con el motivo y sin números.",
     "Los tiles son de 512 con 64 px de solape (stride 448) y se cosen con rampas que suman 1 en un mapa de 4 µm/px: sin costuras y dentro de la RAM del pod.",
     "Ante SIGTERM deja de pedir mensajes, aborta en el siguiente batch y devuelve la lámina con visibilidad 0.",
     "`pytest` pasa los 65 tests del worker sin AWS ni GPU."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.serving"
     },
     {
      "label": "Curso · C04 · Segmentación de imágenes · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.archivos"
     },
     {
      "label": "Hoja · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "cambia",
    "title": "Imagen con engine horneado",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Una sola imagen GPU para el worker, con el engine adentro: su digest identifica código + TensorRT + modelo y queda en cada `summary.json`. Su tamaño importa más que en el C01, porque se paga en cada arranque desde cero réplicas.",
    "artifact": "",
    "done": [
     "La base es `nvcr.io/nvidia/tensorrt:26.08-py3` y `model.plan` está en `worker/model/` antes del `docker build`.",
     "OpenSlide llega como wheel (`openslide-bin`), sin `apt-get`; el lock tiene 14 paquetes y la imagen corre con un usuario no root.",
     "pytest, moto y tifffile (`requirements-dev.txt`) no entran a la imagen.",
     "Sabes cuánto pesa: ≈ 6.8 GB comprimida, parte del arranque en frío de ≈ 3–5 min."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.archivos"
     },
     {
      "label": "Curso · M05 · Contenedores · Reducir tamaño (y por qué importa para el cold start)",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.tamano"
     },
     {
      "label": "Hoja · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ]
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "cambia",
    "title": "CI/CD con runner L4",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "Las pruebas corren sin GPU, pero el engine se construye en el pipeline, en un runner con L4 y dentro de la misma imagen base. Promover es que el CD resuelva el alias de producción, construya o tome la imagen de esa versión y haga el rollout de `seg-worker`.",
    "artifact": "",
    "done": [
     "Pasan los 65 tests del worker, los 13 de la selección y los 6 del job de PSI.",
     "`promtool test rules` pasa: las 10 alertas disparan (o no) con series sintéticas.",
     "Cada Deployment fija su `MODEL_VERSION` (= tag de la imagen) y el digest queda registrado; el worker no consulta el registry.",
     "Un cambio de imagen base o de GPU vuelve a pasar por el gate."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.arquitectura"
     },
     {
      "label": "Curso · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Hoja · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ]
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "Workers GPU con KEDA",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Un Deployment en nodos g6.2xlarge (1 × L4, 8 vCPU) que KEDA escala de 0 a 4 por la cola: de noche no hay GPU encendida. El arranque en frío de ≈ 3–5 min es aceptable contra un SLO de 60 min.",
    "artifact": "",
    "done": [
     "El ScaledObject sobre SQS tiene 0–4 réplicas, `queueLength: \"20\"`, `scaleOnInFlight` y un `cooldownPeriod` de 15 min antes de bajar a 0.",
     "El pod pide 1 GPU, no tiene límite de CPU, usa `emptyDir` sobre el NVMe local y su liveness mira un archivo que toca el loop.",
     "IRSA de mínimo privilegio: el archivo es de solo lectura y en resultados solo hay GetObject, PutObject y ListBucket, sin DeleteObject.",
     "Un aviso de spot drena el nodo (Karpenter con su cola de interrupción o el Node Termination Handler) y la gracia de 90 s alcanza; sin PodDisruptionBudget, a propósito.",
     "`seg-worker.yaml` pasa `kubernetes-validate --strict` y los esquemas de los CRDs de KEDA."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.serving"
     },
     {
      "label": "Curso · C04 · Segmentación de imágenes · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.archivos"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
     },
     {
      "label": "Hoja · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Silent mode y promoción",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "No hay canary de tráfico ni A/B sobre pacientes: un modelo o un laboratorio nuevo corre primero en silent mode, con resultados ocultos al visor. Promover pide la aprobación del gobierno clínico.",
    "artifact": "",
    "done": [
     "El candidato corrió en un Deployment aparte fijado a su versión, alimentado por la cola `slide-jobs-backfill`, de noche y fuera del SLI de turnaround.",
     "Sus resultados, bajo su propio prefijo de versión, se compararon contra producción y contra las correcciones de los patólogos.",
     "Un laboratorio nuevo pasó 2–4 semanas en silent con ≥ 30 láminas anotadas sin ver el overlay antes del modo asistido.",
     "Con la aprobación, el alias de producción cambia, CD despliega la imagen, results-api aprueba esa versión y el flag del laboratorio pasa a asistido.",
     "El rollback está claro: `kubectl rollout undo` (minutos) y sacar la versión mala de las aprobadas en results-api."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.evaluacion"
     },
     {
      "label": "Curso · C04 · Segmentación de imágenes · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.fallas"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Shadow deployment: comparar sin afectar a nadie",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.shadow"
     },
     {
      "label": "Hoja · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ]
   },
   {
    "id": "evento-cola",
    "base": null,
    "status": "nuevo",
    "title": "Evento y cola con DLQ",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "El trabajo empieza solo: al terminar una carga, el archivo emite un evento (key + sha256), una regla filtra con el LIS lo que está en alcance y publica el job en la cola SQS `slide-jobs`, que absorbe las ráfagas y aísla en `slide-jobs-dlq` lo que falla siempre. En el C05 la entrada es `docs-api` (quality gate síncrono p95 ≤ 3 s, luego 202) y cada documento es una ejecución de Step Functions con Retry y Catch por paso.",
    "artifact": "",
    "done": [
     "El mensaje trae slide_id, key, sha256, laboratorio y escáner; nunca el archivo.",
     "El visibility timeout es de 300 s, holgado sobre el p99 por lámina, y el worker lo extiende con `ChangeMessageVisibility` cada 60 s.",
     "`maxReceiveCount` 3 vive en la redrive policy: al 4.º receive el mensaje pasa a `slide-jobs-dlq`; tras un error, la visibilidad se fija en 60 s × intento.",
     "Los problemas de datos conocidos (`qc_blocked`) no se reintentan: la DLQ contiene solo lo que de verdad no entiendes.",
     "En DICOM (laboratorio C) se publica un job por Series Instance UID cuando llegaron todas sus instancias, con el manifiesto de keys."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.arquitectura"
     },
     {
      "label": "Curso · C04 · Segmentación de imágenes · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.serving"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Asíncrona con colas",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.asincrona-colas"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Entrega, reintentos e idempotencia",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.entrega-reintentos"
     },
     {
      "label": "Hoja · Del dato a producción · casos asíncronos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-asincrono"
     }
    ]
   },
   {
    "id": "resultados",
    "base": null,
    "status": "nuevo",
    "title": "Resultados versionados y visor",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "El resultado vive fuera del worker: S3 + una fila índice en Postgres, servidos por `results-api`, un servicio de CPU siempre encendido. El visor nunca depende de que haya una GPU prendida.",
    "artifact": "",
    "done": [
     "El orden de escritura se respeta: GeoJSON y heatmap en la carpeta de la corrida, luego `summary.json` (el commit), luego la fila índice y el log `slide_done`; recién entonces se borra el mensaje.",
     "`summary.json` trae mm² de tumor, % de tejido, banderas de QC, model_version, digest del contenedor, hash de la config y sha256 de entrada.",
     "results-api devuelve, entre las versiones aprobadas para ese laboratorio, el resultado más nuevo para ese sha256; en silent mode no devuelve nada.",
     "El visor solo dibuja si el sha256 del resultado coincide con el del archivo que muestra; si no, dice “sin resultado de IA”.",
     "Cada resultado, acceso y corrección queda en un audit log append-only, en un bucket con Object Lock."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.serving"
     },
     {
      "label": "Curso · C04 · Segmentación de imágenes · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.arquitectura"
     },
     {
      "label": "Hoja · Del dato a producción · casos asíncronos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-asincrono"
     }
    ]
   },
   {
    "id": "revision",
    "base": null,
    "status": "nuevo",
    "title": "Revisión del patólogo",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "El patólogo acepta o corrige antes de firmar, la firma siempre es humana, y cada corrección es un label y una métrica que vuelven a la estación 1. En el C05 la persona revisa solo los campos dudosos (≈ 45 s por documento) y QA audita el 2 % de los documentos STP.",
    "artifact": "",
    "done": [
     "Cada aceptación o corrección es una versión de anotación nueva, con autor, hora, tiempo de revisión y la versión del modelo que la originó; nunca pisa la salida del modelo.",
     "El major-edit rate se calcula: diferencia simétrica entre propuesta y máscara final ÷ área propuesta > 20 %.",
     "Las correcciones grandes entran como candidatas de alta prioridad; lo aceptado sin cambios no entra a entrenamiento como verdad.",
     "La auditoría aleatoria mensual (8 láminas anotadas de forma independiente) mide el automation bias y se lee por trimestre, no por mes."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.evaluacion"
     },
     {
      "label": "Curso · C04 · Segmentación de imágenes · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.datos"
     },
     {
      "label": "Hoja · Del dato a producción · casos asíncronos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-asincrono"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Monitoreo y reentrenamiento",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "El SLO se escribe sobre la edad del job: turnaround p95 ≤ 60 min y 99 % de lo escaneado antes de las 22:00 procesado antes de las 07:00. Las alertas miran la edad del mensaje más viejo, no la profundidad, y la calidad llega con semanas de atraso y sesgada.",
    "artifact": "",
    "done": [
     "Las 10 alertas de `alerts.yml` evalúan con sus tests; solo pagina lo que rompe el turnaround en horario (07:00–22:00), más `NightlyCoverageAtRisk` desde las 05:30.",
     "`SlideQueueBacklog` mira la edad (> 30 min sostenida 10 min) y `SlideDLQNotEmpty` existe aparte, porque un mensaje venenoso deja de contar en la edad.",
     "El job diario `stain_psi.py` empuja el PSI de color por laboratorio × escáner al Pushgateway, y `StainPsiJobStale` avisa si pasan más de 26 h sin dato.",
     "Ninguna métrica lleva slide_id como label.",
     "El reentrenamiento es mensual o por disparador (laboratorio o escáner nuevo, drift confirmado, `MajorEditRateHigh` confirmado con una revisión ciega de 20–30 láminas) y siempre pasa por gate y silent/backfill."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C04 · Segmentación de imágenes · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c04.monitoreo"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Asíncrona con colas",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.asincrona-colas"
     },
     {
      "label": "Curso · M12 · Monitoreo · Data drift, concept drift y label shift",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.drift"
     },
     {
      "label": "Hoja · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ]
   }
  ],
  "hibrido": [
   {
    "id": "datos",
    "base": "datos",
    "status": "cambia",
    "title": "Pares, clics y juicios",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Las fuentes son baratas pero sesgadas: pares (título, foto) de 100 M listings, pares (consulta, listing contactado) y clics, que solo existen para lo que el sistema mostró. La vara de medir son juicios humanos graduados 0–3 sobre consultas head, torso y tail.",
    "artifact": "",
    "done": [
     "Hay una guía escrita con ejemplos por categoría, y una fracción de pares la juzgan dos personas para medir el kappa con pesos.",
     "Una ronda de juicios (3,000 consultas × 20 resultados ≈ 60k, ≈ US$3k) se hace por trimestre y antes de cada modelo nuevo.",
     "Los negativos son skip-above y aleatorios de la misma categoría, nunca “mostrado sin clic”, y sin near-duplicates del positivo.",
     "Los logs de consultas no tienen PII, el id de usuario está seudonimizado y las fotos de consulta no se guardan: solo el vector y un hash.",
     "La búsqueda por foto se evalúa con otra foto del mismo listing como consulta, sin guardar fotos de usuarios."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.datos"
     },
     {
      "label": "Curso · M09 · Datos y features · Etiquetado: guías, calidad, costo y active learning",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.etiquetado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 1 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-datos"
     }
    ]
   },
   {
    "id": "versionado",
    "base": "versionado",
    "status": "cambia",
    "title": "Versiones hasta el vector",
    "tramo": "datos",
    "speed": "semanas",
    "question": "",
    "note": "Todo lleva versión, y además cada vector: un índice entero es de un solo model_version (el nombre la lleva: `listings-vec-v7`). Una copia de cada vector queda en S3 en Parquet por versión, para reconstruir sin GPU y medir drift.",
    "artifact": "",
    "done": [
     "El snapshot de pares de entrenamiento está versionado y la regla de retención se aplicó antes de copiar.",
     "Los sets de evaluación están congelados con su fecha y los juicios llevan la versión de la guía.",
     "Cada documento del índice guarda model_version y la versión del listing; una versión vieja nunca pisa una nueva.",
     "Los vectores de cada versión están en S3 (≈ 205 GB en FP32, ≈ US$5 al mes)."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.datos"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Curso · M09 · Datos y features · Versionado de datos y snapshots inmutables",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.versionado"
     },
     {
      "label": "Hoja · Del dato a producción · estación 2 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-versionado"
     }
    ]
   },
   {
    "id": "entrenamiento",
    "base": "entrenamiento",
    "status": "cambia",
    "title": "Fine-tuning del encoder",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Lo corre el equipo de modelos: ajusta un dual encoder tipo CLIP (d = 512) con pares (título, foto) y (consulta, listing contactado). Es trimestral, no semanal, porque cada versión nueva obliga a re-embeber el catálogo y a un A/B con dos índices.",
    "artifact": "",
    "done": [
     "Los pares se filtraron: fuera los títulos que no describen la foto (“vendo urgente”, “ver fotos”).",
     "El mismo artículo publicado dos veces no queda a la vez en train y en test.",
     "La versión queda en el registry con su linaje y las métricas del gate.",
     "Hay un disparador escrito para adelantarlo: drift de consultas junto con NDCG o CTR que cae en un slice."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Pipeline de datos y entrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.datos"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.monitoreo"
     },
     {
      "label": "Curso · M10 · MLOps · Reentrenamiento: programado, disparado o continuo",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.reentrenamiento"
     },
     {
      "label": "Hoja · Del dato a producción · estación 3 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-entrenamiento"
     }
    ]
   },
   {
    "id": "gate",
    "base": "gate",
    "status": "cambia",
    "title": "Gate de ranking",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "La calidad se mide como ranking (NDCG@10 y recall@k contra juicios humanos), no como accuracy. Como cada versión cuesta re-embeber y dos índices encendidos, el gate pide una mejora que lo valga, no solo “no peor”.",
    "artifact": "",
    "done": [
     "NDCG@10 en head, torso y tail no es peor que producción con su intervalo (bootstrap pareado por consultas), y ningún país o categoría cae más que su margen.",
     "El recall@k de “mismo artículo” en búsquedas por foto está medido.",
     "judged@10 se reporta junto a NDCG, y los huecos se juzgan antes de concluir.",
     "La evaluación final corre sobre el índice real (green), no solo con búsqueda exacta."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.evaluacion"
     },
     {
      "label": "Curso · M10 · MLOps · El validation gate: cuándo un modelo puede reemplazar al actual",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.gate"
     },
     {
      "label": "Hoja · Del dato a producción · estación 4 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-gate"
     }
    ]
   },
   {
    "id": "export",
    "base": "export",
    "status": "cambia",
    "title": "Un artefacto, tres usos",
    "tramo": "modelo",
    "speed": "semanas",
    "question": "",
    "note": "Del registry sale un solo artefacto del encoder que usan tres piezas: el encoder de consultas en Triton, el embed-worker y el job de re-embedding. Tienen que producir los mismos vectores, salvo ruido numérico.",
    "artifact": "",
    "done": [
     "Los tres usan el mismo artefacto, el mismo runtime y la misma precisión.",
     "El test de paridad sobre una muestra da coseno ≥ 0.999 entre el vector del embed-worker y el del job masivo.",
     "Triton sirve las dos torres (texto e imagen) como modelos separados, cada uno con dynamic batching.",
     "Sabes por qué no hay una ruta en CPU con otra precisión: sería training-serving skew aplicado a vectores."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Curso · M09 · Datos y features · Training-serving skew: causas, detección y prevención",
      "href": "https://ronda-diseno-ml.vercel.app/#m09.skew"
     },
     {
      "label": "Hoja · Del dato a producción · estación 5 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-export"
     }
    ]
   },
   {
    "id": "re-embedding",
    "base": null,
    "status": "nuevo",
    "title": "Re-embeber el catálogo",
    "tramo": "modelo",
    "speed": "nuevo",
    "question": "",
    "note": "Cambiar de modelo obliga a re-embeber 100 M listings: no basta con cambiar un engine. Es un job batch por shards con checkpoint, que lee un snapshot del catálogo y escribe los vectores en S3.",
    "artifact": "",
    "done": [
     "El snapshot del catálogo anotó el offset de Kafka de ese momento.",
     "Corrieron ≈ 23 GPU-h con las dos torres (imagen ≈ 14, texto ≈ 9): ≈ 3 h en 8 L4, ≈ US$19 on-demand.",
     "Hubo CPU para decodificar las miniaturas (≈ 24 núcleos) o decodificación en GPU.",
     "Los vectores de la versión nueva están en S3 y nunca se mezclan con los de otra versión en un índice."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Hoja · Del dato a producción · casos híbridos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-hibrido"
     }
    ]
   },
   {
    "id": "indice-green",
    "base": null,
    "status": "nuevo",
    "title": "Construir el índice green",
    "tramo": "modelo",
    "speed": "nuevo",
    "question": "",
    "note": "El índice es una pieza con estado que el C01 no tiene: HNSW sobre int8, 4 shards × 25 M con 2 copias, en un índice k-NN de OpenSearch aparte del de BM25. El index-builder lo arma al lado (`listings-vec-v8`) mientras un segundo embed-worker lo pone al día.",
    "artifact": "",
    "done": [
     "Cada shard tiene ≈ 19–21 GB de grafo + int8 en RAM, y los FP32 del rescoring (51.2 GB) en EBS gp3, servidos desde el page cache.",
     "Se construyó sin réplicas ni refresh y después se agregó la segunda copia; una copia nueva se precalienta antes de recibir tráfico.",
     "Los parámetros del grafo (M = 32) están fijados en el mapping, no se dejaron los defaults.",
     "Un embed-worker v8, con su propio consumer group, procesó los eventos desde el offset del snapshot y green alcanzó el presente.",
     "El recall canary de green da ANN recall@100 ≥ 0.95 contra búsqueda exacta, con y sin filtros."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
     },
     {
      "label": "Hoja · Del dato a producción · casos híbridos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-hibrido"
     }
    ]
   },
   {
    "id": "serving",
    "base": "serving",
    "status": "cambia",
    "title": "search-api híbrido",
    "tramo": "release",
    "speed": "dias",
    "question": "",
    "note": "El código de serving orquesta en vez de inferir: lanza BM25 de inmediato y, en paralelo, el encoder y el ANN; fusiona con RRF (k = 60), quita tombstones, rerankea el top-30 de texto y degrada por escalones hasta BM25 solo.",
    "artifact": "",
    "done": [
     "Pasan los 46 tests de `search/` (≈ 2 s): cada uno es un modo de falla, del encoder lento al shard con otro modelo.",
     "La versión no se configura: search-api lee a qué índice apunta el alias `listings-vec-live` y pide esa versión al encoder; la respuesta de un shard con otro model_version se descarta.",
     "Los filtros van dentro de la búsqueda y se re-chequean después de RRF.",
     "`/readyz` no mira versiones, y el log escribe [tel] y [email] en lugar del teléfono y el correo.",
     "Los empates de RRF se ordenan de forma determinista (score, mejor posición, cantidad de listas, id)."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.archivos"
     },
     {
      "label": "Hoja · Del dato a producción · estación 6 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-serving"
     }
    ]
   },
   {
    "id": "empaquetado",
    "base": "empaquetado",
    "status": "igual",
    "title": "Imagen de search-api",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo se convierten el código y el engine en algo que corre igual en tu máquina, en CI y en el cluster?",
    "note": "Como en el C01: la imagen de la API es chica y no lleva modelo. Lo pesado está detrás de la red (Triton, OpenSearch, Redis), así que no necesita numpy, Pillow ni torch.",
    "artifact": "Dockerfiles probados (gateway y Triton)",
    "done": [
     "La base es `python:3.13.15-slim-trixie` (≈ 43 MB comprimida).",
     "El lock completo (17 paquetes) se generó con `uv pip compile` para Linux x86_64 y Python 3.13, sin numpy ni Pillow.",
     "`fakes.py` y los tests no entran a la imagen.",
     "Corre un proceso uvicorn por contenedor."
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
      "label": "Curso · C07 · Búsqueda con embeddings · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.archivos"
     },
     {
      "label": "Curso · M05 · Contenedores · Un Dockerfile de ML, decisión por decisión",
      "href": "https://ronda-diseno-ml.vercel.app/#m05.dockerfile-ml"
     },
     {
      "label": "Hoja · Del dato a producción · estación 7 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-empaquetado"
     }
    ]
   },
   {
    "id": "cicd",
    "base": "cicd",
    "status": "igual",
    "title": "CI/CD y registro de imágenes",
    "tramo": "release",
    "speed": "dias",
    "question": "¿Cómo llega un commit a una imagen probada, inmutable y lista para desplegar?",
    "note": "Como en el C01: pruebas sin GPU e imágenes construidas una vez. Lo propio de este caso es que los tests cubren la escalera de fallbacks y que las métricas que usan las alertas existan.",
    "artifact": "imagen en ECR (tag inmutable + digest)",
    "done": [
     "Pasan los 88 tests de search, indexing y eval sin GPU, Kafka, OpenSearch ni Redis.",
     "`promtool test rules` pasa los 14 escenarios, y cambiar cualquiera de los 12 umbrales hace fallar su test.",
     "Un test lee `alerts.yml` y exige que cada métrica `search_*` exista en `/metrics`.",
     "Como en el C01: cada imagen se construye una vez, con tag inmutable, y staging y producción usan el mismo digest."
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
      "label": "Curso · C07 · Búsqueda con embeddings · Archivos de referencia",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.archivos"
     },
     {
      "label": "Curso · M10 · MLOps · CI/CD para modelos: la pirámide de tests",
      "href": "https://ronda-diseno-ml.vercel.app/#m10.ci-cd"
     },
     {
      "label": "Hoja · Del dato a producción · estación 8 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-cicd"
     }
    ]
   },
   {
    "id": "kubernetes",
    "base": "kubernetes",
    "status": "cambia",
    "title": "Nodos, GPUs y escalado",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Además de servicios sin estado, hay un índice que vive en RAM: 8 nodos r7i.4xlarge dedicados en el clúster de OpenSearch. Las GPUs se reparten entre el encoder de consultas (2 L4), el reranker (8 L4) y el embed-worker (1 L4, escalado por lag).",
    "artifact": "",
    "done": [
     "Los shards del índice vectorial viven en nodos de datos dedicados (atributos de nodo), separados de BM25: 4 shards × 2 copias en 2 zonas, con ≈ 64 % de la memoria usada.",
     "El encoder tiene 2 L4 en dos zonas: una alcanza para el pico y la segunda es redundancia.",
     "El reranker sobre el top-30 cabe en 8 L4 (≈ 62 %), y su throughput se midió con perf_analyzer antes de comprometer el diseño.",
     "El embed-worker escala por lag con KEDA, y search-api corre sin estado en varias zonas."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Estimaciones back-of-the-envelope",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.estimaciones"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Curso · M06 · Orquestación y escalado · KEDA: escalar por eventos y hasta cero",
      "href": "https://ronda-diseno-ml.vercel.app/#m06.keda"
     },
     {
      "label": "Hoja · Del dato a producción · estación 9 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-kubernetes"
     }
    ]
   },
   {
    "id": "rollout",
    "base": "rollout",
    "status": "cambia",
    "title": "Blue/green del índice",
    "tramo": "operacion",
    "speed": "dias",
    "question": "",
    "note": "Cambiar de modelo es reconstruir el índice al lado y mover un alias, nunca re-indexar en el lugar. Cada brazo del A/B es un par (encoder, índice) completo, nunca una mezcla.",
    "artifact": "",
    "done": [
     "El shadow mandó una copia de las consultas a green: p99 dentro del presupuesto y diferencias con blue explicables.",
     "El A/B por usuario duró 1–2 semanas: contactos por búsqueda no peor, alguna mejora significativa y guardrails sanos.",
     "El swap es un solo cambio atómico del alias (`_aliases` con remove + add en la misma petición).",
     "Blue queda 7 días para rollback y al día: el worker v7 le sigue escribiendo y el encoder mantiene la v7 cargada."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Evaluación offline y online",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.evaluacion"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Curso · M11 · Despliegue seguro · Blue/green y rollback instantáneo",
      "href": "https://ronda-diseno-ml.vercel.app/#m11.blue-green"
     },
     {
      "label": "Hoja · Del dato a producción · estación 10 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-rollout"
     }
    ]
   },
   {
    "id": "indexacion-streaming",
    "base": null,
    "status": "nuevo",
    "title": "Indexación en streaming",
    "tramo": "operacion",
    "speed": "nuevo",
    "question": "",
    "note": "Lo nuevo y lo vendido llegan por Kafka (`listing-events`, key = listing_id) al embed-worker: primero las bajas, como tombstones en Redis sin GPU, y después los embeddings y el upsert. Es lo que cumple “nuevo buscable en p95 ≤ 5 min” y “vendido fuera en ≤ 1 min”; el C08 reusa ese vector para su item tower.",
    "artifact": "",
    "done": [
     "El worker es idempotente por (listing_id, versión del evento): un updated atrasado nunca resucita un sold.",
     "Se niega a escribir si su encoder y el índice no tienen el mismo model_version, y se cae sin commitear offsets.",
     "Un cambio de precio o de ciudad actualiza solo los atributos de filtro, sin re-embeber.",
     "Una foto que no baja o no se decodifica va a una dead-letter queue con su motivo, sin bloquear la partición.",
     "Pasan los 18 tests de `test_embed_worker.py`."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Arquitectura",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.arquitectura"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Curso · M02 · Patrones de inferencia · Streaming: inferencia sobre eventos",
      "href": "https://ronda-diseno-ml.vercel.app/#m02.streaming"
     },
     {
      "label": "Hoja · Del dato a producción · casos híbridos",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#casos-hibrido"
     }
    ]
   },
   {
    "id": "request",
    "base": "request",
    "status": "cambia",
    "title": "La búsqueda en vivo",
    "tramo": "operacion",
    "speed": "ms",
    "question": "",
    "note": "Sigue habiendo una request en ms, pero es un scatter-gather: BM25 ∥ (encoder → 4 shards), RRF, tombstones, reranker e hidratación, ≈ 100 ms típicos contra p99 ≤ 300 ms en texto y ≤ 600 ms en foto. En el C06 el camino síncrono es un chequeo con p99 ≤ 150 ms y fail-open, y lo caro sigue después por Kafka.",
    "artifact": "",
    "done": [
     "Cada llamada tiene su techo (encoder 50 ms, cada shard 80, BM25 120, tombstones 20, rerank 100) y los timeouts salen de un deadline que se propaga.",
     "Los tombstones de los ≤ 400 candidatos se consultan en una sola ida y vuelta, también para lo que sale del caché.",
     "Si el encoder o todos los shards fallan, el texto se sirve solo con BM25; una foto da 503 con Retry-After.",
     "El caché de consultas lleva la versión del índice en la clave y TTL de 5 min; las búsquedas por foto no se cachean.",
     "Un shard lento recibe una hedged request a su otra copia; si no llega, la respuesta sale parcial y no se cachea."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Serving",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.serving"
     },
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Modos de falla y degradación",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.fallas"
     },
     {
      "label": "Curso · M03 · Latencia y capacidad · Presupuesto de latencia end-to-end",
      "href": "https://ronda-diseno-ml.vercel.app/#m03.presupuesto"
     },
     {
      "label": "Hoja · Del dato a producción · estación 11 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-request"
     }
    ]
   },
   {
    "id": "monitoreo",
    "base": "monitoreo",
    "status": "cambia",
    "title": "Monitoreo del índice",
    "tramo": "operacion",
    "speed": "continuo",
    "question": "",
    "note": "Hay un índice que se degrada sin que ningún servicio falle, y la frescura se mide de punta a punta en dos direcciones. El drift de las consultas es un disparador de reentrenamiento, no una alerta que pagina.",
    "artifact": "",
    "done": [
     "Las 8 alertas están cargadas: SearchLatencyHigh, ZeroResultRateHigh, IndexFreshnessLag, SoldItemsServed, ANNRecallDrop, EmbedWorkerBacklog, SearchCTRDrop y ShardMemoryHigh.",
     "El canary corre cada hora y `ANNRecallDrop` avisa si el recall@100 baja de 0.95 en algún shard o si el canary no corre hace más de 3 h.",
     "Un listing sintético publicado cada minuto mide cuándo una búsqueda lo encuentra, además del histograma de frescura del worker y del lag de cada consumer group.",
     "El reentrenamiento es trimestral (fine-tuning → gate → re-embedding → blue/green → A/B), y un índice degradado se reconstruye desde los vectores de S3, sin GPU."
    ],
    "commands": [],
    "links": [
     {
      "label": "Curso · C07 · Búsqueda con embeddings · Monitoreo, alertas y reentrenamiento",
      "href": "https://ronda-diseno-ml.vercel.app/#c07.monitoreo"
     },
     {
      "label": "Curso · M12 · Monitoreo · Data drift, concept drift y label shift",
      "href": "https://ronda-diseno-ml.vercel.app/#m12.drift"
     },
     {
      "label": "Hoja · Del dato a producción · estación 12 del C01",
      "href": "https://cheat-sheets-ml.vercel.app/recorrido/#est-monitoreo"
     }
    ]
   }
  ]
 }
};
