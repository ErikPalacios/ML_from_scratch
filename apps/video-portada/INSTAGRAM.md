# Instagram de TrueML: guía de trabajo

Esta guía es lo único que una sesión nueva necesita leer para hacer una pieza de Instagram (reel, carrusel o post).
Lo técnico del video está en `README.md`. Abre ese archivo solo si hace falta.

## 0. Cómo trabajamos: primero juntos, después solo

No se automatiza nada todavía. Claude va ganando autonomía por etapas, y **el usuario decide cuándo se pasa a la
siguiente**.

| Etapa | Qué hace Claude | Qué decide el usuario |
|---|---|---|
| **1 · Juntos (ahora)** | Propone 2–3 ideas, escribe el guion de la elegida, hace el render y anota en §8 lo que se corrigió | La idea, el guion, el humor, el resultado final |
| **2 · Claude propone** | Elige la idea y escribe el guion siguiendo §8; entrega la pieza terminada | Solo aprueba o corrige la pieza terminada |
| **3 · Claude solo** | Planea y produce un lote de piezas con §8 como guía | Revisa el lote antes de publicar |

En todas las etapas, **publicar lo hace el usuario** (o, si algún día se automatiza, con su OK en el chat, uno por uno).

Una señal de que ya se puede pasar a la siguiente etapa: unas 8–10 piezas seguidas que el usuario aprueba sin
cambios de fondo, solo detalles.

**Etapa actual: 1 · Juntos.**

## 1. La regla de oro: primero el valor, TrueML al final

Los siete reels de lanzamiento (`src/reels/02…07`) se ven bien, pero se leen como anuncio, y los anuncios se pasan de
largo. Desde ahora cada pieza sigue este orden:

1. **Gancho (0–3 s):** una pregunta o un dato que sorprende y que ya se lee en el frame 0.
2. **La explicación (la mayor parte):** una idea de ML contada desde cero, con una analogía y una cifra que se
   recuerde. Se tiene que entender sin conocer TrueML.
3. **Cierre corto (2–5 s):** recién aquí aparece TrueML: «Esto y más en trueml.app», gratis, sin cuenta, en español.

Además:
- **Un personaje recurrente** que explica: **pendiente de definir con el usuario** (nombre, aspecto y voz en texto).
  Mientras no exista, no se inventa uno: se pregunta.
- **Se planea antes de producir:** primero el guion (gancho, 3–5 pasos y cierre) y el usuario lo aprueba. Después
  se hace el render.
- **Se revisan los datos:** toda cifra o afirmación técnica se comprueba antes de ponerla en pantalla.
- **Las palabras:** español sencillo, con los términos técnicos en inglés cuando así se usan («embedding»,
  «batch»). Cada concepto se define la primera vez que aparece.

## 2. Formatos

| Pieza | Tamaño | Duración | Dónde se hace |
|---|---|---|---|
| Reel | 1080×1920, 30 fps, H.264 + AAC | 20–45 s | Remotion, `src/reels/` |
| Carrusel | 1080×1350 (4:5), PNG, 5–10 láminas | — | Remotion `<Still>`, `src/carruseles/` (aún no existe) |
| Post suelto | 1080×1350 o 1080×1080, PNG | — | igual que el carrusel |
| Portada del reel | frame del video (`portada` en `reels.json`) | — | `tools/reels.mjs` la exporta en PNG |

**Zona segura en el reel:** lo importante va entre y≈220 e y≈1600. Abajo a la derecha (x > 940, y > 1100) quedan
los botones de Instagram. Para comprobarlo: `tools/hoja-reel.sh out/reels/<id>.mp4 hoja.png`.

**Diseño:** el de TrueML (Dojo), en tema oscuro. Los colores salen de `src/tema.ts`, que son los mismos tokens que
`apps/trueml`. Se usan los seis colores de la T y la T de vidrio (`src/marca.ts`), y el cierre de `src/reels/kit.tsx`.
No se mete el logo donde no encaja.

**Sonido:** música hecha con código (`tools/sonido-reel.mjs`, 120 BPM). Nunca música de terceros. No hay voz: todo va
con texto en pantalla, y cada texto se tiene que poder leer en el tiempo que dura.

## 3. Cómo se hace un reel nuevo

1. Guion aprobado → se agrega una entrada en `src/reels/reels.json`: el `id` (`08-<tema>`), las escenas con su
   `dur` en frames (múltiplos de 15), `barrido`, `portada` y `sonido` (`drop`, `hat` y eventos).
2. Componente `src/reels/<Tema>.tsx` con las escenas, usando lo que ya está en `kit.tsx` y `src/piezas.tsx`
   (`Aurora`, `Ventana`, `Franja`, `Barrido`, cierre…).
3. Se registra en `src/reels/index.ts`.
4. Texto de la publicación en `src/reels/textos/<id>.txt` (ver §4).
5. Render: `node tools/reels.mjs <id>` genera la pista, el video, la portada PNG y el texto en `out/reels/`.
6. Revisión: hoja de contacto de la zona segura y, si se puede, ver unos frames clave. Todo se le manda al usuario
   (SendUserFile) para que lo apruebe.

Si una pieza necesita capturas reales de una app, se graban con `tools/capturar.mjs` y `tools/tomas.mjs`
(Playwright). Esto toma más tiempo; usarlo solo si la pieza lo pide.

## 4. El texto de la publicación

Mismo orden que el video: primero el valor.

```
<Gancho en una línea, igual o parecido al del video.>

<2–3 párrafos cortos con la idea explicada. Una cifra concreta.>

<Una línea de cierre suave: «Lo puedes probar en trueml.app», gratis · sin cuenta · en español.>
👉 Link en la bio

<6–10 hashtags: 2–3 amplios (#MachineLearning #IAenEspañol) + los del tema.>
```

Nada de «¡Descubre!», «¡No te lo pierdas!» ni tono de venta.

## 5. Publicar

- **Lo publica el usuario, a mano**, desde la app de Instagram. Claude entrega los archivos en `out/` y el texto
  listo para copiar.
- Si algún día se automatiza (API de Meta, con cuenta de creador o de empresa), cada publicación igual necesita el
  OK explícito del usuario en el chat.
- `out/` no se sube al repo. Lo que sí se guarda es el código, `reels.json` y los textos.

## 6. Para gastar pocos tokens

- **Una sesión nueva y corta por pieza.** Al terminar la pieza, se cierra la sesión.
- La sesión lee esta guía y solo los archivos que va a tocar (`reels.json`, `kit.tsx` y un reel parecido como
  modelo). No hace falta leer el README completo ni los tutoriales.
- Un buen pedido para arrancar: «Reel nuevo: <idea>. Lee apps/video-portada/INSTAGRAM.md». Con eso basta.
- Los renders largos van en segundo plano.

## 7. Ideas en cola

(Se llena con el usuario. Formato: tema · gancho · cifra memorable · herramienta de TrueML que se menciona al final.)

## 8. Gustos y humor del usuario (el registro que permite pasar de etapa)

Después de cada pieza, Claude anota aquí lo que el usuario cambió, eligió o rechazó **y por qué**, en una línea con
fecha. Esta sección es lo que más importa para trabajar solo más adelante: se lee completa antes de proponer nada.

**Lo que ya se sabe (antes de la primera pieza):**
- Nada de tono de anuncio: los reels de lanzamiento se sentían como «alguien vendiéndome algo» (2026-11-17).
- Explicar desde cero: definir cada concepto, una analogía y un solo lugar para las aclaraciones.
- Cifras que se recuerden y lenguaje sencillo, sin perder los conceptos.
- Diseño TrueML (Dojo): el logo solo donde encaja, nunca forzado.

**El humor:** por descubrir. (¿Ironía, juegos de palabras, memes de programadores, situaciones de entrevista,
referencias mexicanas…? Se anota lo que funcione y lo que no.)

**Registro por pieza:**

<!-- AAAA-MM-DD · <pieza> · lo que se cambió → lo que eso dice de sus gustos -->
