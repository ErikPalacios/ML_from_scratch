# Dojo de entrenamiento ML engineer's

Proyectos chicos de ML engineering que corren en una Mac, uno por cada estación del mapa «Del dato a producción». Cada uno se trabaja en cuatro rondas: Guiado, Solo, Romper con ayuda y Romper solo. La app es la guía (conceptos, pasos, prompts, catálogo de fallas); el trabajo pasa en el kit, con Claude Code. El plan completo está en [docs/plan-taller-ai.md](../../docs/plan-taller-ai.md).

## Estructura

| Carpeta | Qué es |
|---|---|
| `content/estaciones/<línea>-<id>.json` | El contenido de cada estación, con la forma que define `tools/schema.mjs`. La línea es el caso del tronco (`"caso": "c01"`) o una rama (`"rama": "ia-privada"`, con su `etapa` de la T). |
| `content/estaciones/<caso>-<id>/prompts/` | Los prompts de las cuatro rondas. |
| `content/tronco.json` | Las 12 estaciones de C01 con lo que sale de cada una, para la portada (la lista por etapas de la T y el mapa en anillo), y la etiqueta de su escala («En C01»). |
| `content/ramas.json` | Las ramas: por rama, su id, nombre, patrón, caso de referencia, la etiqueta de su escala, el camino sin GPU y sus estaciones (num, id, título, qué sale, etapa de la T y dónde corre). Hoy: IA Privada, 8 estaciones, todas «próximamente». `tools/lineas.mjs` junta el tronco y las ramas: URL `/<línea>/<estación>/`, slug, etapa y escala de cada estación. |
| `content/mapa-c01.json` | El mapa vertical del C01, copiado de la cheat sheet «Del dato a producción» con `node tools/importar-mapa.mjs` (córrelo cuando cambie la hoja). La portada lo usa en el celular; en tablet y escritorio dibuja el anillo del diseño. |
| `kits/<caso>-<id>/` | El kit que se descarga: el mundo simulado, `verificar.py`, `romper.py`, `CLAUDE.md`. El esqueleto del pipeline vive en `mundo/esqueleto/`. |
| `kits/<caso>-<id>-solucion/` | La solución de referencia (no se publica). Sirve para probar el kit y es el código que muestra el Guiado. |
| `content/estaciones/<caso>-<id>/practicas/` | Las prácticas desde cero de la estación (forma `practica` en `tools/schema.mjs`): sin kit, en una carpeta vacía, cada una con su página. |
| `kits/<caso>-desde-cero-solucion/` | Los scripts probados de esas prácticas. Las páginas leen de aquí el código de cada paso (`desde`), y `probar.sh` corre las prácticas de punta a punta en una carpeta limpia para sacar las salidas reales. |
| `site/` | Estilos (`dojo.css`, el diseño Dojo de TrueML en todas las páginas), script, service worker, ícono e imagen para redes. |
| `site/tablero/` | «Tu tablero» (`/tablero/`), ver abajo: `modelo.mjs` (el documento, sus 4 rondas y la importación de `progreso.json`), `almacen.mjs` (lo guarda en localStorage), `tablero.mjs` (la vista) y `motor/`, la copia del motor del tablero de `apps/tablero-ml`. |
| `tools/` | `validate.mjs`, `build.mjs`, `check.mjs`, `zip.mjs`, `importar-mapa.mjs`, `tablero.mjs` (la página del tablero y su plantilla), `test-tablero.mjs` y `motor.mjs` (copia el motor del tablero). `dojo.mjs` arma la portada y las páginas de estación y de práctica con el diseño Dojo de TrueML, y `trueml-mark.js` (copia exacta del proyecto de Claude Design) dibuja la T de vidrio al construir. |

## Comandos

```bash
npm run validate   # cada estación contra el molde
npm run build      # arma dist/: portada, páginas de estación y los .zip de los kits
npm run check      # build + Chrome headless: 375/768/1024 px, oscuro, tema y modo sin conexión, más las pruebas del tablero
node tools/motor.mjs   # copia el motor de apps/tablero-ml a site/tablero/motor/ (check avisa si se desfasó)
```

`check` usa `apps/ml-system-design/tools/browser-check.mjs`. El build no depende de otras carpetas: se puede desplegar desde aquí.

## Agregar una estación

1. Escribe el kit y su solución, y córrelo de punta a punta en una carpeta limpia.
2. Escribe `content/estaciones/<línea>-<id>.json`. Solo pon en `salida` lo que salió de verdad. Los precálculos van en las dos escalas: `ref` (el caso de referencia de su línea: C01 en el tronco, el de la rama en una rama; las estaciones viejas lo llaman `c01`, y se acepta igual) y `taller` (el dojo); cada uno se comprueba con un comando sobre el mundo recién creado o apunta al paso del Guiado que lo confirma.
3. Prueba cada falla: que su check la detecte, que su arreglo la resuelva y que `romper.py --restaurar` deje todo en verde.
4. Revisa los hechos contra la documentación oficial.
5. `npm run check`.

### Prácticas desde cero

Una estación puede traer prácticas sin kit (`practicas` en su JSON): la persona arma todo en una carpeta vacía con un dataset que se etiqueta a mano. Para cambiar una, edita el script en `kits/<caso>-desde-cero-solucion/`, corre `bash probar.sh <carpeta-vacía> <venv>` (necesita Docker y un venv con su `requirements.txt`; etiqueta por la API en lugar de clics) y copia las salidas del log a los `salida` de la práctica. El código de los pasos no se copia: sale de la solución al construir.

## Tu tablero

`/tablero/` es el avance de cada persona, sin cuenta: corre en el navegador y se guarda en localStorage (clave `dojo-tablero`), como la demo pública del tablero de proyectos. Funciona sin conexión.

- **Un solo JSON por app.** Todo el progreso es un documento (`app: "dojo-tablero"`, versión `v`), con fecha y hora ISO en UTC en cada avance. Es el mismo documento que se va a sincronizar cuando haya cuentas.
- **Plantilla del Dojo.** Cada estación con taller trae sus 4 rondas: Construir con ayuda, Construir solo, Romper con ayuda y Romper solo, cada una pendiente, en curso o hecha, con inicio y fin. Además, sus fallas (minutos, pistas, si te rendiste y qué aprendiste), su bitácora y las últimas 30 corridas de `verificar.py`. Las estaciones sin taller salen como «próximamente».
- **El motor del tablero.** Cada cambio es una op (`set`, `insert`, `remove`) que aplica `motor/ops.mjs` con el esquema del Dojo (`modelo.mjs`, `ESQUEMA`); la validación es la de `motor/model.mjs`. El motor vive en `apps/tablero-ml/web/js/shared`; `node tools/motor.mjs` lo copia. Al leer, `migrar()` suma las estaciones y rondas nuevas sin tocar lo tuyo.
- **Importar `taller/progreso.json`.** `verificar.py` anota cada corrida y `romper.py` cada falla cerrada (`taller/registro.py` del kit); Claude Code anota las rondas y la bitácora (`CLAUDE.md`). Importar el mismo archivo dos veces no duplica: los ids salen del contenido. Gana el estado más avanzado de cada ronda.
- **Respaldo.** «Descargar el respaldo» baja el documento completo; importarlo en otro dispositivo reemplaza su tablero.

## Despliegue

En producción en https://taller-ai-engineer.vercel.app (proyecto de Vercel `taller-ai-engineer`, sin Git conectado, como las otras apps). Se despliega desde esta carpeta con `vercel deploy --prod`; `vercel.json` hace el build sin instalar nada y publica `dist/`. Para comprobar que subió lo que construiste, compara el `BUILD` de `/sw.js` en producción con el de `dist/sw.js`.

La imagen para redes (`site/og.png`) sale de `apps/portada/tools/og.mjs`: `node tools/og.mjs taller-ai` desde `apps/portada`. Si cambia la dirección, cambia también `SITE_URL` en `tools/build.mjs`.
