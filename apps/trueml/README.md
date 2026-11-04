# TrueML · sistema de diseño

La fuente única de la marca TrueML: la T de vidrio, sus 6 etapas, los colores en claro y oscuro y las piezas que comparten todas las apps. Sale del proyecto de Claude Design «ML desde cero portada» (archivos «Portada TrueML», «Dojo TrueML» y «Dojo Estacion 01»).

| Archivo | Qué es |
|---|---|
| `trueml-mark.js` | El generador de la T, copia exacta del diseño (`window.TrueMLMark`). No se edita a mano. |
| `etapas.json` | Las 6 etapas (Datos, Modelo, API, Contenedor, Orquestación, Monitoreo) y en cuál cae cada estación del C01. |
| `lib.mjs` | Para los builds (Node): `marca()` dibuja la T con etiquetas y etapas encendidas, más `miniT()`, `franja()`, `selectorTema()`, `resumen()` y `etapaDeEstacion()`. |
| `tokens.css` | Los colores `--tm-*` en claro y oscuro, más la franja, la T chica y el selector de tema. |
| `cliente.js` | Lo que hace la marca en el navegador, todo con atributos `data-*`: el tema, encender etapas al pasar el cursor por una herramienta, la animación de entrada y la T fija. |
| `sync.mjs` | Copia todo a cada app y genera los datos que una app toma de otra. |

## Cómo se usa

Cada app se despliega sola desde su carpeta en Vercel, así que lleva una copia en `vendor/trueml/`. Esta carpeta es la fuente:

```bash
node apps/trueml/sync.mjs           # copia a cada app y regenera los datos compartidos
node apps/trueml/sync.mjs --check   # solo revisa que nada se haya desfasado
```

Hoy lo usan `taller-ai` (el Dojo: su `dojo.css` lleva primero `tokens.css`) y `portada` (su `style.css` también). `sync.mjs` además escribe `apps/portada/data/dojo.json`, el avance del Dojo leído de su contenido: cuando el Dojo suma una estación, se corre el sync y la portada la marca como lista sin tocar nada más.

- **Para sumar una app:** agrégala a `APPS` en `sync.mjs`, corre el sync, y en su build usa `vendor/trueml/lib.mjs` y `tokens.css`.
- **Para sumar una herramienta a la portada:** una entrada en `apps/portada/site.json` con sus `etapas` (ids de `etapas.json` o `"todas"`).

## Reglas

- La T va donde se vea natural (la marca en la barra, un hero, el marcador de etapa) y nunca forzada ni invasiva.
- Se dibuja al construir: la página se ve completa sin JavaScript y abre sin conexión.
- Nada de paletas nuevas: todo color sale de `tokens.css`.
