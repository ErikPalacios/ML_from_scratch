# Pasada de probadores simulados (2026-11-02)

Seis agentes recorrieron las herramientas con los perfiles de la beta (entrevista, producción, curiosidad, primera visita en celular), solo lectura. Cada hallazgo se verificó antes de tocar nada. Esto es lo que salió, para que no se pierda.

## Corregido y publicado

| Dónde | Qué |
|---|---|
| Curso | Disponibilidad: todo en mes de 30 días (4.3 min, 7.2 h); margen de costo de C01 «23–33 %»; aclaración del SLI de 300 ms frente al p99 de 200 ms; p50 de 30–50 ms frente a la suma de 20–45 ms; «11.6 exacto» junto a 12 req/s |
| Hoja gateway | `max_body_size` **no existe en Starlette** (verificado en su código): ahora dice que el tope lo pones tú |
| Hoja Triton | `batch_size` del warmup debe ser ≥ 1 (lo dice `model_config.proto`); se quitó una afirmación sin respaldo |
| Hoja Docker | `dd bs=1m` y `sed -i ''` solo funcionaban en macOS: ahora `bs=1048576` y `perl -pi -e` |
| Hoja Kubernetes | «1.34 dejó de recibir parches» (la fecha ya pasó) |
| Laboratorio | **Service worker**: ahora abre sin conexión después de la primera visita (MathJax y fuentes precargados); `h1` oculto; 4 textos más claros (máscara causal, pérdida inicial 3.1–3.5, tour de la atención, sumas residuales); conteo de «productos» ≈ 2 FLOP |
| Atlas | T* ≈ 6.5·D aclarado (lineales de los bloques; ≈ 7·D con la LM head); una cita traducida ya no va entre comillas |
| Portada | Nueve hojas bien listadas; la demo dice que está en inglés |

Verificado a mano: `PreferSameZone` es alfa en 1.33, beta en 1.34 y estable en 1.35 (el curso lo decía bien). Las cifras del curso (≈ 60), del Atlas (9 modelos), del laboratorio (1208 parámetros, gradientes) y de las hojas de serving (24 cálculos) coinciden con su recálculo.

## Pendiente (verificado o creíble, sin hacer)

**Diseño del curso (decisión tuya)**
- La rúbrica de C01 exige en «Estimaciones» cálculos que el texto dice que van en un deep dive (CPU, red, latencia).
- El checklist «obligatorio» tiene 19 puntos para 45 minutos.
- La rúbrica de 4 niveles no trae un ejemplo por nivel.

**Revisores de las hojas (lógica)**
- Kubernetes `secreto-literal`: falsos positivos (`PASSWORD_MIN_LENGTH`, `ENABLE_PASSWORD_LOGIN`) y falso negativo (`postgres://user:pass@host`).
- Kubernetes: no detecta `requests > limits` ni `apiVersion` retiradas; `targetport-sin-puerto` afirma más de lo que sabe (`containerPort` es informativo); `namespace-faltante` no conoce todos los kinds cluster-scoped.
- Git: `inyeccion-en-run` marca `repository.name` (no es explotable); no detecta claves desconocidas (`runs_on`), `ubuntu-20.04` ni `::set-env`.
- Prometheus: `causa-no-sintoma` marca `predict_linear` (alerta predictiva legítima).
- Docker: no detecta `ADD` de URL sin checksum ni algunos `curl | sh` multilínea.

**Contenido por verificar o actualizar**
- vLLM: la calculadora usa GB decimales nominales (la H100 reporta 81,559 MiB); aclarar la unidad. Verificar `--max-num-queued-reqs` y `vllm:admission_rejections_total`.
- Alertmanager existe en 0.34.2 (la hoja fija 0.34.1).
- Estimaciones: el 1,200 img/s por T4 puede ser optimista con el batch real de 1–3.
- Sospecha: `gpu-sin-toleration` atribuye a EKS un admission plugin que no se confirmó.

**Experiencia (celular y accesibilidad)**
- Falta un enlace de regreso a la portada desde el curso, el atlas y el laboratorio.
- Objetivos táctiles menores de 44 px en varios botones (el mínimo de WCAG 2.2 AA es 24 px; 44 px es la recomendación de Apple).
- Contraste ligeramente bajo (3.7–4.4:1) en etiquetas pequeñas de la hoja del gateway.
- Atlas: las celdas de progreso no tienen nombre accesible.
- Demo del tablero: «entry gate», «DoD» y el chip «Online synchronous» sin explicar.
- Laboratorio: el gorro `^` significa cuatro cosas y hay dos ε distintas; términos usados antes de definirse («flujo residual»).

## Límites de esta pasada
No se probó modo sin conexión real, labs ejecutados, ni los PDF; las cifras de varios papers se compararon con memoria, no abriendo la fuente. Los agentes compartieron un solo navegador en un punto y sus pestañas se cruzaron: algunos «hallazgos» de redirección eran de eso. Nada de esto sustituye a personas reales.
