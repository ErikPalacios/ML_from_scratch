# Cheat sheets ML

Hojas de estudio para el trabajo de ML engineering, con versión web y PDF para imprimir. Las hojas salen del curso [Ronda de Diseño ML](../ml-system-design) y usan sus ejemplos (C01).

- **Sitio:** portada con una tarjeta por hoja; cada hoja en `/<id>/` con su PDF al lado.
- **Sin conexión:** después de la primera visita, la portada y las hojas abren sin internet (service worker). Un PDF queda guardado cuando lo abres.
- **Hojas actuales:**
  - `estimaciones`: formulario de las estimaciones del C01;
  - `docker`: cheat sheet de Docker, con diagnosticador, revisor de Dockerfile y quiz de errores;
  - `recorrido`: «Del dato a producción», el C01 de punta a punta como un mapa de metro, con fichas de herramientas, patrones, casos y un quiz de síntomas.

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
- **Estimaciones:** `node sheets/estimaciones/fuentes/gen.mjs <dir>` escribe `head.html`, `body.html` y `src.html` (con KaTeX). El paso que pasa el TeX a MathML es el mismo que el modo `build` de `gen-docker.mjs`.
- **Recorrido (Del dato a producción):** `node sheets/recorrido/fuentes/gen-recorrido.mjs` escribe `sheets/recorrido/recorrido.html` y `fuentes/out/artifact.html`; con `pdf` también imprime `recorrido.pdf` con Chrome (el mapa va en una página apaisada). No necesita KaTeX: escribe el HTML directo.
  - El contenido está en `content-w1..w4.json`, con el contrato en `BRIEF.md`. El generador no lo cambia: al final lista los avisos del contenido y las figuras donde un texto no cabe.
