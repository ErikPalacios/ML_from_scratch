# Taller de AI Engineer

Proyectos chicos de ML engineering que corren en una Mac, uno por cada estación del mapa «Del dato a producción». Cada uno se trabaja en cuatro rondas: Guiado, Solo, Romper con ayuda y Romper solo. La app es la guía (conceptos, pasos, prompts, catálogo de fallas); el trabajo pasa en el kit, con Claude Code. El plan completo está en [docs/plan-taller-ai.md](../../docs/plan-taller-ai.md).

## Estructura

| Carpeta | Qué es |
|---|---|
| `content/estaciones/<caso>-<id>.json` | El contenido de cada estación, con la forma que define `tools/schema.mjs`. |
| `content/estaciones/<caso>-<id>/prompts/` | Los prompts de las cuatro rondas. |
| `content/tronco.json` | Las 12 estaciones de C01, para la portada. |
| `content/mapa-c01.json` | El mapa del C01 de la portada, copiado de la cheat sheet «Del dato a producción» con `node tools/importar-mapa.mjs` (córrelo cuando cambie la hoja). |
| `kits/<caso>-<id>/` | El kit que se descarga: el mundo simulado, `verificar.py`, `romper.py`, `CLAUDE.md`. El esqueleto del pipeline vive en `mundo/esqueleto/`. |
| `kits/<caso>-<id>-solucion/` | La solución de referencia (no se publica). Sirve para probar el kit y es el código que muestra el Guiado. |
| `site/` | Estilos, script, service worker, ícono e imagen para redes. |
| `tools/` | `validate.mjs`, `build.mjs`, `check.mjs`, `zip.mjs` e `importar-mapa.mjs`. |

## Comandos

```bash
npm run validate   # cada estación contra el molde
npm run build      # arma dist/: portada, páginas de estación y los .zip de los kits
npm run check      # build + Chrome headless: 375/768/1024 px, oscuro, tema y modo sin conexión
```

`check` usa `apps/ml-system-design/tools/browser-check.mjs`. El build no depende de otras carpetas: se puede desplegar desde aquí.

## Agregar una estación

1. Escribe el kit y su solución, y córrelo de punta a punta en una carpeta limpia.
2. Escribe `content/estaciones/<caso>-<id>.json`. Solo pon en `salida` lo que salió de verdad. Los precálculos van en las dos escalas (C01 y el taller); cada uno se comprueba con un comando sobre el mundo recién creado o apunta al paso del Guiado que lo confirma.
3. Prueba cada falla: que su check la detecte, que su arreglo la resuelva y que `romper.py --restaurar` deje todo en verde.
4. Revisa los hechos contra la documentación oficial.
5. `npm run check`.

## Despliegue

En producción en https://taller-ai-engineer.vercel.app (proyecto de Vercel `taller-ai-engineer`, sin Git conectado, como las otras apps). Se despliega desde esta carpeta con `vercel deploy --prod`; `vercel.json` hace el build sin instalar nada y publica `dist/`. Para comprobar que subió lo que construiste, compara el `BUILD` de `/sw.js` en producción con el de `dist/sw.js`.

La imagen para redes (`site/og.png`) sale de `apps/portada/tools/og.mjs`: `node tools/og.mjs taller-ai` desde `apps/portada`. Si cambia la dirección, cambia también `SITE_URL` en `tools/build.mjs`.
