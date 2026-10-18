# Fuentes de las hojas de estudio

Para regenerar `docs/cheatsheet-docker.*` y `docs/formulario-estimaciones.*` si cambia el contenido.

- `cheatsheet-docker/`: `BRIEF.md` (contrato del contenido), `content-w1/2/3.json` (contenido revisado contra la documentación de Docker 29.x) y `gen-docker.mjs`. `node gen-docker.mjs build` escribe `cheatsheet-docker.html` (el artifact) y `local.html`; usa `tools/browser-check.mjs` para pasar las fórmulas de KaTeX a MathML.
- `formulario-estimaciones/gen.mjs`: el generador del formulario de estimaciones del C01.
- PDF: imprime `local.html` con Chrome headless (`--headless=new --no-pdf-header-footer --virtual-time-budget=10000 --print-to-pdf=…`).
