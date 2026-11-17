# Video de TrueML (portada e Instagram)

Un recorrido de 79 s por las herramientas de TrueML con imágenes reales. Primero engancha con el Laboratorio
Transformer y el Atlas. Después muestra Sensei y el Dojo, que son por donde se empieza. Al final aparecen la Ronda,
las cheat sheets y el tablero. Sale en dos formatos con las mismas escenas y la misma pista:

- **Portada** (16:9, 1920×1080). En el hero de `apps/portada` corre una versión chica, en bucle y **sin sonido**,
  porque el navegador no deja arrancar un video solo si tiene audio. El sonido está en «Ver en grande», que la persona
  abre con un clic.
- **Instagram** (9:16, 1080×1920, para Reels). Lo importante queda entre y≈220 e y≈1600, porque arriba y abajo
  Instagram pone su interfaz.

## Cómo está hecho

1. **Grabaciones reales** (`tools/capturar.mjs`). Playwright abre cada app publicada en modo oscuro, en 1600×900 con
   escala 2 (o sea, cuadros de 3200×1800, para que la cámara pueda acercarse sin que se vea borroso), y hace lo que dice
   `tools/tomas.mjs`: dar clic, arrastrar sliders, desplazarse. Lo que se ve en pantalla se graba con el screencast de
   Chrome y ffmpeg lo convierte en `public/capturas/<toma>.mp4`. Un círculo amarillo hace de cursor.
2. **Montaje en Remotion** (`src/`). Cada escena coloca la grabación en una ventana de navegador inclinada en 3D,
   con una cámara que se acerca a lo importante y textos que suben palabra por palabra. Cada escena tiene un acomodo
   horizontal y otro vertical (`useVertical()`). La T de vidrio es el SVG real de `apps/trueml` (lo genera
   `tools/marca.mjs`) y se arma pieza por pieza. Entre escenas pasa un barrido con los seis colores de la T.
3. **Sonido hecho con código** (`tools/sonido.mjs`). Es música electrónica suave a 120 BPM en la menor
   (Am · F · C · G), sintetizada en Node, sin muestras ni música de terceros:
   - **La estructura:** sube durante el gancho, entra de lleno en el Laboratorio Transformer, baja en el puente y
     vuelve a subir en Sensei.
   - **Los efectos:** un «whoosh» en cada barrido, una nota de la escala pentatónica por cada pieza de la T (de datos
     a monitoreo) y golpes al empezar cada sección.
   - **El ritmo:** las escenas duran múltiplos de medio segundo (`src/tiempos.json`), así que los cortes caen en el pulso.
   - **El volumen:** queda normalizado a −14 LUFS, el que recomiendan las redes.
4. **Versiones para la web** (`tools/web.mjs`). A partir del render maestro saca un video chico de 960×540 (en WebM y
   MP4, sin audio) que corre en bucle en el hero, uno grande de 1080p con sonido para «Ver en grande» y el póster.
   Todo queda en `apps/portada/src/video/`.

## Comandos

```bash
npm install
npm run capturar          # vuelve a grabar todas las tomas (o: node tools/capturar.mjs ronda hojas)
npm run studio            # abre Remotion Studio para ajustar el montaje
npm run portada           # pista + render maestro + versiones web en apps/portada/src/video/
npm run instagram         # el vertical en out/instagram.mp4 (corre antes npm run sonido si cambiaste tiempos)
```

Hay que volver a grabar cuando una app cambie su diseño. Los tiempos de cada tramo (`desde`, `vel`, `dur`) y la
cámara (`cam`) están en `src/escenas.tsx`. Si una toma cambia de duración, revisa esos números. Si cambias la duración
de una escena en `src/tiempos.json`, vuelve a generar la pista (`npm run sonido`): los efectos se acomodan solos.

Para grabar se usa el Chromium que Playwright ya tiene descargado (`tools/navegador.mjs`). Con `CHROME=<ruta>` puedes
usar otro.
