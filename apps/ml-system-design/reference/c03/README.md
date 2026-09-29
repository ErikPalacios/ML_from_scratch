# Caso c03 — archivos de referencia (inspección visual en línea con Jetson)

Archivos **reales** del caso c03 de *Ronda de Diseño ML*: el inspector que corre en el Jetson Orin NX
de cada línea (trigger → foto → modelo → decisión → PLC con un deadline duro de 350 ms y fail-safe
que desvía la pieza), su contenedor para JetPack 6, y las herramientas para elegir umbrales por costo
y construir el engine TensorRT en el dispositivo. Cada archivo está comentado explicando **por qué**.

La parte de EPP (DeepStream en un AGX Orin) no tiene archivos aquí: su pipeline es el mismo patrón que
el caso c02 (`reference/c02/edge/deepstream/`).

## Estructura

```
c03/
├── edge/                          # lo que corre en el Jetson de cada línea
│   ├── inspector/
│   │   ├── app.py                 # el loop: deadline, fail-safe, PLC (Modbus TCP), métricas, golden check
│   │   ├── decision.py            # lógica PURA: scores + umbrales → PASS / REJECT con razones
│   │   ├── config.yaml            # una por línea: line_id, tiempos, umbrales, PLC, golden parts
│   │   ├── requirements.txt       # 4 dependencias fijadas (sin transitivas)
│   │   └── tests/test_inspector.py  # 62 tests: reloj falso, dobles y servidores Modbus TCP reales
│   ├── Dockerfile                 # l4t-tensorrt:r10.3.0-runtime (TensorRT 10.3 = JetPack 6.2.x), no root
│   └── docker-compose.yml         # runtime nvidia, red host (GigE Vision), config ro, healthcheck
└── tools/                         # corren en tu máquina o en el Jetson
    ├── choose_threshold.py        # umbral con recall >= 99.5 % por tipo dentro del objetivo de FP
    ├── build_engine_jetson.sh     # trtexec --fp16 EN el Jetson, con modo de energía fijo
    └── tests/test_choose_threshold.py  # 20 tests con datos calculables a mano
```

## Orden de lectura sugerido

1. `edge/inspector/decision.py` — la regla de negocio en 30 líneas, y por qué un NaN no puede pasar.
2. `edge/inspector/app.py` — `Inspector.inspect()`: el presupuesto de tiempo y cada camino a DIVERT.
3. `edge/inspector/tests/test_inspector.py` — cómo se prueba tiempo real sin esperar tiempo real.
4. `edge/inspector/config.yaml` — qué se configura y qué NO (el fail-safe).
5. `tools/choose_threshold.py` — de dónde salen los umbrales de `config.yaml`.
6. `tools/build_engine_jetson.sh` → `edge/Dockerfile` → `edge/docker-compose.yml` — el despliegue.

## Una pieza, de punta a punta

```
t = 0 ms     photo-eye → la cámara dispara por hardware; el PLC asigna part_id y lo sigue en la banda
≈ 50 ms      frame de 5 MP (≈ 5.0 MB) llega por 1 GigE             grab(timeout = 350 − 50 − 140 = 160 ms)
             brillo medio de la foto (microsegundos)                fuera de image_check → DIVERT (bad_image)
≈ 70 ms      preprocesamiento en el Engine: recorte + 20 tiles de 512 × 512 en un batch de shape fijo
≤ 190 ms     inferencia TensorRT (≤ 120 ms estimado: mídelo)       si tras la foto quedan < 140 + 50 ms → DIVERT sin inferir
≈ 200 ms     decide() + escritura Modbus [part_id, código]          si quedan < 50 ms → no se escribe: el PLC desvía
350 ms       DEADLINE: decisión escrita o la pieza se desvía
500 ms       la pieza llega a la compuerta (0.3 m a 0.6 m/s)
```

**El PLC es quien garantiza el fail-safe.** Python no puede interrumpir una llamada de TensorRT
colgada ni escribir nada si el proceso murió; por eso el PLC desvía toda pieza que no tenga un PASS
válido para su `part_id` al llegar a la compuerta. El inspector hace su mejor esfuerzo, mide y avisa.

### Contrato con el PLC (Modbus TCP, puerto 502)

| Holding register | Contenido | Nota |
|---|---|---|
| `register` (100) | `part_id & 0xFFFF` | contador de piezas del PLC; 16 bits porque así es un registro |
| `register + 1` (101) | código: 1 PASS · 2 REJECT · 3 DIVERT | 0 = sin decisión → el PLC desvía |

`register: 100` es la dirección de **protocolo** (base 0) = **40101** en la notación 4xxxx (base 1)
que usan muchos integradores de PLC: confírmalo con el integrador. Con un corrimiento de 1, el PLC
leería nuestro `part_id` como si fuera el código.

Los dos registros van en **una** petición (función 16, Write Multiple Registers). Una escritura que
termina después del deadline no cuenta: el PLC ya desvió la pieza (el log lo registra como DIVERT).

Regla para el programa del PLC: toma el par al deadline de **su** pieza y pone el código en 0 (una
decisión se usa una sola vez). Si el inspector deja de escribir (proceso muerto, PLC sin conexión),
el último par se queda en los registros; como el `part_id` de 16 bits se repite cada 65,536 piezas
(≈ 9.1 h a 2 piezas/s, o antes si el contador se reinicia), un PASS viejo podría coincidir con una
pieza que nadie inspeccionó.

### Razones de DIVERT en el log y en las métricas

| `reason` | Cuándo | ¿Cuenta en `inspection_deadline_miss_total`? |
|---|---|---|
| `deadline` | foto lenta, inferencia lenta o escritura tardía | sí |
| `camera_timeout` | el frame no llegó dentro del presupuesto | sí |
| `camera_error` | la cámara lanzó un error (red, driver) o el buffer llegó incompleto (paquetes GVSP perdidos: `grab()` lanza, nunca devuelve un frame parcial) | no |
| `bad_image` | brillo medio fuera de `image_check` (estrobo que no disparó, lente tapado, sobreexposición) o un frame malformado | no |
| `engine_error` | TensorRT/CUDA lanzó un error | no |
| `invalid_scores` | NaN, infinito, fuera de [0, 1], falta un tipo de defecto o algo que no es un dict de números | no |
| `internal_error` | cualquier otra excepción (un bug): la pieza se desvía y el loop sigue, en vez de tumbar el proceso | no |
| `plc_error` | la escritura falló (también suma `plc_write_errors_total`) | no |
| `golden_pending` / `golden_failed` | el modelo dijo PASS pero no hay golden check aprobado en este proceso para el turno en curso (vence al iniciar el turno siguiente: `golden.shift_starts`), o el último falló | no |

Cada DIVERT suma `inspection_divert_total{reason}`, con las 10 razones creadas en 0 al arrancar. Es
la métrica que ve una falla que desvía **todo** sin que nada más se mueva: un estrobo muerto (100 %
`bad_image`) o un error de CUDA "pegajoso" (100 % `engine_error`), con el loop avanzando, el golden
check aprobado y cero REJECTs. Tras 20 `engine_error` seguidos (10 s) el proceso sale con código 4:
un contexto CUDA roto solo se recupera con un proceso nuevo, y `restart: unless-stopped` lo levanta
(después hace falta el golden check).

Métricas (todas con label `line`): `inspection_decisions_total{decision}`,
`inspection_divert_total{reason}`, `inspection_latency_seconds`, `inspection_deadline_miss_total`,
`inspection_anomaly_score`, `golden_part_check_ok`, `plc_write_errors_total`. Log: una línea JSON
por pieza con `part_id`, `line`, `model_version`, `scores`, `decision`, `model_decision`,
`latency_ms` y `reason`.

## Correr los tests (sin hardware)

```bash
cd reference/c03/edge/inspector
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt pytest==9.1.1
pytest -q tests          # 62 tests: PASS/REJECT, deadline, cámara, foto oscura, modelo, NaN, PLC, golden, métricas, config

cd ../../tools
pytest -q tests          # 20 tests (solo necesita pytest)
```

## Ver el loop funcionando (sin hardware)

```bash
cd reference/c03/edge/inspector
# config.yaml liga /metrics a una IP de la planta: para tu máquina, copia la config y cambia metrics.addr
sed 's/addr: 10.20.1.21/addr: 127.0.0.1/' config.yaml > /tmp/c03-local.yaml
python app.py --config /tmp/c03-local.yaml --simulate --max-parts 20
curl -s localhost:9310/metrics | grep inspection_      # desde otra terminal, mientras corre
```

Cámara, modelo y PLC son simulados (2 piezas/s, 0.5 % de defectos): verás primero el golden check y
luego una línea JSON por pieza.

## Elegir umbrales

```bash
python tools/choose_threshold.py val_scores.csv     # CSV: score,is_defect,defect_type (set de VALIDACIÓN)
```

Entre los umbrales con recall >= 99.5 % en cada tipo, elige el **más bajo** cuyo FP cabe en el
objetivo de 1.5 % (el punto B del caso): con un FN 20,000× más caro que un FP, el FP que sobra se
gasta en margen de recall. No usa el de menor costo en validación porque ese queda justo sobre el
defecto más bajo del tipo que limita: debajo, el recall de validación ya es 100 % y el costo "no ve"
nada que ganar, pero un defecto nuevo de ese tipo cae debajo con probabilidad ≈ 1/(n + 1) (con 75 por
tipo, ≈ 1.3 %: recall esperado ≈ 98.7 %). El reporte muestra los dos. Si ninguno cabe en el objetivo,
usa el de menor costo dentro del tope de capacidad (≈ 2.85 % de las buenas) y lo marca **SOBRE el
objetivo**; si tampoco, sale con código 3 (úsalo como gate de CI).

También imprime qué tipo limita el umbral, piezas a inspección manual contra la capacidad
(3,840/día) y el costo esperado por línea y día. Con ≈ 75 defectos por tipo avisa que **0 fallas en
validación no demuestra 99.5 %**: la cota al 95 % del miss rate es ≈ 3.9 %, y hacen falta ≈ 598
defectos por tipo sin fallas. `--json` da una salida para que un pipeline escriba `config.yaml`
(con `on_target: false`, que no lo escriba sin revisión).

**Varias cabezas: el presupuesto es de la UNIÓN.** `decision.py` rechaza si *cualquier* score
dispara (la anomalía o una de las 4 cabezas del clasificador), y la herramienta evalúa una columna a
la vez. Los defaults (objetivo 1.5 %, tope ≈ 2.85 %) son el presupuesto entero: sirven tal cual solo
cuando decide la anomalía sola (`defects: {}`). Con clasificador, reparte: pasa a cada cabeza (y a la
anomalía) su parte con `--target-fp-rate` y `--max-fp-rate` (p. ej. 0.003 y 0.0057: 5 × 0.3 % =
1.5 %), y verifica la unión sobre validación (p. ej. con `decision.py` y todos los umbrales) antes
de escribir `config.yaml`. Con `--defect-type` las dos tasas son obligatorias: sin ellas sale con
código 1, porque 5 cabezas con el tope entero cada una podrían sumar ≈ 14 %.

```bash
python tools/choose_threshold.py crack_scores.csv --defect-type crack --target-fp-rate 0.003 --max-fp-rate 0.0057
```

## En el Jetson

1. JetPack 6.2.x (L4T r36.4.x o r36.5) en los 4 Jetson, la misma versión en todos.
2. Docker con el runtime nvidia (`sudo nvidia-ctk runtime configure --runtime=docker` si falta).
3. Red de la cámara en el **host**: NIC dedicada, jumbo frames y buffers de recepción según la guía de
   tu cámara (con red host el contenedor no puede cambiar `net.core.*`).
4. Fija el modo de energía de producción (`sudo nvpmodel -m <id>`, ids en `/etc/nvpmodel.conf`; este
   sí persiste) y construye el engine: `EXPECTED_POWER_MODE=25W bash tools/build_engine_jetson.sh modelo.onnx <version>`.
5. `jetson_clocks` en cada arranque. No persiste tras reiniciar (y los equipos se reinician de noche),
   y la latencia medida con `trtexec` supone clocks fijos: sin él, producción corre con clocks
   dinámicos. Una unidad de systemd, después de `nvpmodel` y antes de Docker:

   ```ini
   # /etc/systemd/system/jetson-clocks.service
   [Unit]
   Description=Clocks fijos (jetson_clocks) para latencia repetible
   After=nvpmodel.service
   Before=docker.service

   [Service]
   Type=oneshot
   ExecStart=/usr/bin/jetson_clocks
   RemainAfterExit=true

   [Install]
   WantedBy=multi-user.target
   ```

   `sudo systemctl enable --now jetson-clocks.service`, y tras un reinicio verifica con
   `sudo jetson_clocks --show` que CPU, GPU y EMC están en su máximo antes de producir.
6. La hora del host es la de la planta (zona horaria y NTP de la red OT): `golden.shift_starts` es
   hora local y `docker-compose.yml` monta `/etc/localtime` del host.
7. `docker compose up -d --build` en `edge/`, y el golden check desde el HMI antes de producir (y al
   inicio de cada turno: la aprobación vence al iniciar el turno siguiente; un check hasta 30 min
   antes de un inicio cuenta para ese turno).

JetPack 7.2 (junio de 2026: Jetson Linux 39.2, Ubuntu 24.04, CUDA 13.2.1, TensorRT 10.16.2) ya soporta
Orin. Migrar no es un `apt upgrade`: cambian la imagen base y el TensorRT, así que se reconstruyen y
revalidan los engines, primero en una línea (shadow mode) y después en el resto.

## Qué se verificó y qué no

Probado en macOS (Apple Silicon) sin Jetson, sin cámara, sin PLC y sin daemon de Docker:

| Qué | Cómo | Resultado |
|---|---|---|
| Tests del inspector | pytest 9.1.1 en venvs limpios con Python **3.10.21** (el de JetPack 6) y 3.13.15 | 62 passed en ambos |
| Tests de la herramienta de umbrales | ídem | 20 passed en ambos |
| `ModbusPLC` | contra el `ModbusTcpServer` de pymodbus 3.15.0 en localhost, y contra un PLC mínimo que corta la conexión con RST (dentro de los tests) | escribe y relee `[part_id, código]`; PLC caído, PLC que no responde (≈ 20 ms con `retries=0`) y sin tiempo → `PLCError`; PLC que resetea la conexión → `PLCError` y reconecta en la escritura siguiente |
| `app.py --simulate` | proceso real: /metrics con curl, heartbeat, SIGTERM, un Engine "colgado" (sleep de 60 s inyectado) con `watchdog_s: 3`, y un Engine que lanza en cada pieza después del golden check | golden check, decisiones y métricas; SIGTERM → código 0; el watchdog mata el proceso a los ≈ 4 s con código 3; 20 `engine_error` seguidos → código 4 |
| Wheels para la imagen | `pip download --only-binary=:all:` para cp310 manylinux aarch64 | las 4 dependencias tienen wheel |
| Imagen base | manifiesto y configuración de `l4t-tensorrt:r10.3.0-runtime` leídos del registry de NGC | arm64, Ubuntu 22.04, Python 3.10, TensorRT 10.3.0.26 (`python3-libnvinfer`, `trtexec`), CUDA 12.6 |
| `docker-compose.yml` | `docker compose config` (Compose v5.0.2) | OK |
| `Dockerfile` | parseado con `dockerfile-parse` | OK (no se construyó) |
| `build_engine_jetson.sh` | `bash -n`; flags de trtexec contra el código fuente de TensorRT 10.3 (`sampleOptions.cpp`) | OK (no se ejecutó) |

**No verificado** (requiere el hardware):

- No se construyó la imagen ni se corrió en un Jetson; tampoco `trtexec`, `nvpmodel`, `jetson_clocks`
  ni la unidad de systemd. Que `restart: unless-stopped` levante el proceso tras los códigos 3 y 4 es
  el comportamiento documentado de Docker; aquí no se probó (sin daemon), ni el montaje de `/etc/localtime`.
- CUDA como usuario no root dentro del contenedor en JetPack 6: hay reportes de fallas (error 801);
  pruébalo en el dispositivo (ver el comentario en `edge/Dockerfile`).
- Cámara GigE Vision y engine TensorRT: quedan detrás de su interfaz (`build_hardware` en `app.py`
  documenta las llamadas de Aravis/harvesters y de TensorRT 10.3). También falta la fuente de triggers
  real (photo-eye vía PLC o GPIO) y el emparejamiento frame ↔ pieza por FrameID.
- Contra un PLC real: los tiempos (`plc.timeout_ms: 20`) son un punto de partida; mide el round trip con
  tu PLC y su ciclo de scan.
- Todos los tiempos de inferencia y los umbrales de `config.yaml` son ilustrativos.

No incluidos a propósito (se describen en el caso): el spool local de imágenes rechazadas y el agente
de sincronización de la DMZ, el shadow mode (un segundo Engine que se llama después de escribir al
PLC y solo loguea) y las reglas de alerta.
