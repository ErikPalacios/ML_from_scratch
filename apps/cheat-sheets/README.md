# Cheat sheets ML

Hojas de estudio para el trabajo de ML engineering, con versión web y PDF para imprimir. Las hojas salen del curso [Ronda de Diseño ML](../ml-system-design) y usan sus ejemplos (C01).

- **Sitio:** portada con una tarjeta por hoja; cada hoja en `/<id>/` con su PDF al lado.
- **Sin conexión:** después de la primera visita, la portada y las hojas abren sin internet (service worker). Un PDF queda guardado cuando lo abres.
- **Hojas actuales:**
  - `estimaciones`: formulario de las estimaciones del C01;
  - `docker`: cheat sheet de Docker, con diagnosticador, revisor de Dockerfile y quiz de errores;
  - `kubernetes`: cheat sheet de Kubernetes, con diagnosticador de pods, revisor de YAML (sus reglas, en el navegador) y quiz de errores;
  - `recorrido`: «Del dato a producción», el C01 de punta a punta como un mapa de metro, con fichas de herramientas, patrones, casos y un quiz de síntomas;
  - `git`: cheat sheet de Git y GitHub Actions, con grafos de commits antes y después, diagnosticador, revisor de workflows (sus reglas, en el navegador) y quiz de errores;
  - `triton`: «De PyTorch a Triton», del checkpoint a un servicio medido (ONNX, paridad, TensorRT, model repository, batching, clientes y perf_analyzer), con figuras a escala, diagnosticador, revisor de config.pbtxt (su parser de protobuf en texto y sus reglas, en el navegador) y quiz de errores;
  - `gateway`: «El gateway: FastAPI en producción», la API entre los clientes y Triton (async contra hilos, contrato, timeouts y reintentos, admisión, degradación, salud y apagado, observabilidad, tests y rendimiento), con figuras de cada proceso, diagnosticador, revisor de código del gateway (su escáner de Python y sus reglas, en el navegador) y quiz de errores;
  - `prometheus`: «Prometheus y Grafana», de un contador en el código al aviso en el teléfono (tipos de métrica, scrape, PromQL, histogramas, reglas, Alertmanager, Grafana, SLOs con burn rate y Kubernetes), con figuras a escala de cada proceso, diagnosticador (comandos que se copian y pantallas que se abren), revisor de reglas de alerta (lee el YAML con js-yaml de cdnjs; sus reglas, en el navegador) y quiz de errores;
  - `vllm`: «Serving de LLMs con vLLM», de los tokens al gateway de LLMs del C10 (prefill y decode, KV cache y VRAM, vllm serve y sus flags, la API compatible con OpenAI con streaming, continuous batching, TTFT y TPOT, paralelismo, cuantización y optimizaciones), con figuras a escala, diagnosticador, calculadora de VRAM y KV cache (un port de vram_calc.py del C10, sin librerías) y quiz de errores.

## Estructura

```
sheets.json              una entrada por hoja: id, título, tema, resumen, línea de muestra, datos, archivos, fecha
sheets/<id>/             la página de la hoja (HTML con las fórmulas ya en MathML) y su PDF
sheets/<id>/fuentes/     lo que genera esa página: contenido y generador
site/                    portada (hub.html), service worker, manifest e íconos
tools/build.mjs          arma dist/: portada + una carpeta por hoja + sw.js con el hash del build
tools/check.mjs          revisa dist/ en Chrome: ancho en celular, tablet y oscuro; páginas sin conexión
```

## Comandos

```bash
npm run build      # arma dist/
npm run check      # arma dist/ y lo revisa (usa tools/browser-check.mjs de ml-system-design)
npx vercel --prod --yes   # desde esta carpeta: sube a Vercel (proyecto cheat-sheets-ml)
```

Vercel corre `node tools/build.mjs` (sin dependencias) y publica `dist/`. `.vercelignore` deja fuera las fuentes.

## Agregar una hoja

1. Genera la página con el mismo diseño. Toma como base `sheets/docker/fuentes/`: un JSON de contenido y un generador que pasa el TeX a MathML con Chrome.
2. Crea `sheets/<id>/` con dos archivos:
   - la página completa (con `<!doctype html>`, `<title>`, `<style>` y `<div class="wrap">`);
   - su PDF, impreso de esa misma página con Chrome:
     ```bash
     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-pdf-header-footer --virtual-time-budget=10000 --print-to-pdf=<id>.pdf --user-data-dir=$(mktemp -d) file://$PWD/<pagina>.html
     ```
3. Agrega su entrada a `sheets.json`.
4. Corre `npm run check` y después súbelo a Vercel.

## Regenerar las hojas actuales

- **Docker:** `node sheets/docker/fuentes/gen-docker.mjs build` escribe dos archivos:
  - `sheets/docker/cheatsheet-docker.html`;
  - `fuentes/out/artifact.html`, la versión para el Artifact de claude.ai.

  El contenido está en `content-w1/2/3.json` y se revisó contra la documentación de Docker 29.x. El contrato del contenido está en `BRIEF.md`.
- **Kubernetes:** `node sheets/kubernetes/fuentes/gen-k8s.mjs build` escribe `sheets/kubernetes/cheatsheet-kubernetes.html` y `fuentes/out/artifact.html` con el mismo paso de MathML que Docker; el contenido está en `content-w1/2/3.json`, revisado contra Kubernetes 1.37, con el contrato en `BRIEF.md`, y el revisor de YAML lee los manifests con js-yaml de cdnjs (el service worker lo guarda para usarlo sin conexión).
- **Git y GitHub Actions:** `node sheets/git/fuentes/gen-git.mjs build` escribe `sheets/git/cheatsheet-git.html` y `fuentes/out/artifact.html` con el mismo paso de MathML (con `pdf` en vez de `build` también imprime `cheatsheet-git.pdf`); el contenido está en `content-w1/2/3.json`, con el contrato en `BRIEF.md`, y el revisor de workflows lee el YAML con el mismo js-yaml de cdnjs que el de Kubernetes.
- **De PyTorch a Triton:** `node sheets/triton/fuentes/gen-triton.mjs build` escribe `sheets/triton/cheatsheet-triton.html` y `fuentes/out/artifact.html` con el mismo paso de MathML (con `pdf` en vez de `build` también imprime `cheatsheet-triton.pdf`); el contenido está en `content-w1/2/3.json`, con el contrato en `BRIEF.md`, y el revisor de config.pbtxt lee el archivo con un parser de protobuf en texto propio (sin librerías: funciona sin conexión).
- **El gateway (FastAPI en producción):** `node sheets/gateway/fuentes/gen-gateway.mjs build` escribe `sheets/gateway/cheatsheet-gateway.html` y `fuentes/out/artifact.html` con el mismo paso de MathML (con `pdf` en vez de `build` también imprime `cheatsheet-gateway.pdf`); el contenido está en `content-w1/2/3.json`, con el contrato en `BRIEF.md`, y el revisor de código lee el Python con un escáner por líneas propio, el de las reglas de `content-w1.json` (sin librerías: funciona sin conexión).
- **Prometheus y Grafana:** `node sheets/prometheus/fuentes/gen-prom.mjs build` escribe `sheets/prometheus/cheatsheet-prometheus.html` y `fuentes/out/artifact.html` con el mismo paso de MathML (con `pdf` en vez de `build` también imprime `cheatsheet-prometheus.pdf`); el contenido está en `content-w1/2/3.json`, con el contrato en `BRIEF.md`, y el revisor de reglas lee el YAML con el mismo js-yaml de cdnjs que los de Kubernetes y Git. El build también corre el revisor en Chrome: el `alerts.yml` del C01 tiene que dar 0 hallazgos.
- **Serving de LLMs con vLLM:** `node sheets/vllm/fuentes/gen-vllm.mjs build` escribe `sheets/vllm/cheatsheet-vllm.html` y `fuentes/out/artifact.html` con el mismo paso de MathML (con `pdf` en vez de `build` también imprime `cheatsheet-vllm.pdf`); el contenido está en `content-w1/2/3.json`, con el contrato en `BRIEF.md`. La calculadora compila en el build las fórmulas de `content-w1.json` (solo expresiones) a funciones normales: los checks de los tests del C10 corren en node y otra vez en Chrome, y la página no usa eval ni librerías (funciona sin conexión).
- **Estimaciones:** `node sheets/estimaciones/fuentes/gen.mjs <dir>` escribe `head.html`, `body.html` y `src.html` (con KaTeX). El paso que pasa el TeX a MathML es el mismo que el modo `build` de `gen-docker.mjs`.
- **Recorrido (Del dato a producción):** `node sheets/recorrido/fuentes/gen-recorrido.mjs` escribe `sheets/recorrido/recorrido.html` y `fuentes/out/artifact.html`; con `pdf` también imprime `recorrido.pdf` con Chrome (el mapa va en una página apaisada). No necesita KaTeX: escribe el HTML directo.
  - El contenido está en `content-w1..w4.json`, con el contrato en `BRIEF.md`. El generador no lo cambia: al final lista los avisos del contenido y las figuras donde un texto no cabe.
