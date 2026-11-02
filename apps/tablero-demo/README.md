# ML Board — demo pública

**En vivo:** https://tablero-ml-demo.vercel.app

La misma aplicación del [tablero](../tablero-ml), sin servidor ni base de datos y con un proyecto de ejemplo inventado («Sample · Receipt Classifier API»). Cada visitante tiene su propia copia: lo que edita se guarda en **su navegador** y no se envía a ningún lado. El botón «Reset demo» la deja como al principio.

## Cómo funciona

- `tools/build.mjs` copia `apps/tablero-ml/web/` a `dist/` y le agrega la capa de demo (`web/`):
  - `js/demo-boot.js`: un «servidor» dentro del navegador (localStorage) que contesta las mismas rutas que la API real y aplica los cambios con el mismo motor (`ops`, entry gate, validación). `sync.js` lo usa cuando existe `window.TABLERO_API`.
  - `js/seed-demo.mjs`: el proyecto de ejemplo. Los cálculos de entrada se responden con el propio motor del tablero y las fechas son relativas a la primera visita.
  - `js/demo-banner.js`: el aviso y el botón de reinicio.
- **Los datos reales del C01 nunca viajan a la demo.** El build reemplaza `shared/seed-c01.mjs` por un módulo vacío y no copia `seed-c01-v1.mjs`; una prueba revisa que nada privado llegue a `dist/`.
- `index.html` sale indexable, con canonical, Open Graph, `robots.txt` y `sitemap.xml`; las cabeceras de seguridad son las de producción.

## Comandos

```bash
npm test          # arma dist/ y prueba el proyecto de ejemplo, la API del navegador y que no se cuele nada privado
npm run build     # solo arma dist/
npm run deploy    # arma y sube a Vercel (proyecto tablero-ml-demo)
```

La primera vez: `npx vercel link --yes --project tablero-ml-demo` en esta carpeta (escribe `.vercel/`, que git ignora). La imagen para redes (`web/og.png`) sale de `npm run og` en `apps/portada`.
