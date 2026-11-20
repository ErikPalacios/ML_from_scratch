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
- **Un personaje recurrente:** **Turbo**, un **hámster programador** (aprobado el 2026-11-19). Trae sudadera azul marino,
  camiseta negra corta con la T de TrueML que deja ver la panza, audífonos con micrófono, una energética y la
  ruedita, y lo acompaña un patito de hule. Él es **el que la riega**. El pato (o el texto) explica lo correcto.
  No hay voz: todo va en texto. El dibujo oficial es `personaje/hamster-2d.svg`, generado por
  `personaje/hamster-2d.mjs`, con una capa con `id` para cada parte que se anima. Detalles en §8.
  Se llama **Turbo** por ironía: corre muchísimo en su ruedita y no llega a ningún lado. El pato se llama **Debug**
  (es una propuesta que falta confirmar).
- **Se planea antes de producir:** primero el guion (gancho, 3–5 pasos y cierre) y el usuario lo aprueba. Después
  se hace el render.
- **Se revisan los datos:** toda cifra o afirmación técnica se comprueba antes de ponerla en pantalla.
- **Las palabras:** español sencillo, con los términos técnicos en inglés cuando así se usan («embedding»,
  «batch»). Cada concepto se define la primera vez que aparece.

## 1.1 El perfil (elegido el 2026-11-20)

- **Nombre:** `TrueML · ML en español` · **Link:** https://trueml.app · **Categoría:** Educación.
- **Bio (opción C, la que eligió el usuario):**
  > Aprende machine learning de verdad: teoría, un proyecto completo y práctica de entrevistas. Gratis, sin cuenta, en español 👇

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

**Sonido:** música hecha con código (`tools/sonido-reel.mjs`, 120 BPM). Nunca música de terceros. Los efectos de
Turbo (pasitos, ruedita, boing, caída) también son código (`pasos`, `rueda`, `boing`, `caida` en `reels.json`).

**Voz (desde 2026-11-20, ElevenLabs Starter):** Debug narra y Turbo habla chillón. Flujo:
1. Las líneas van en `src/reels/dialogos/<id>.json` (`quien`: `debug` o `turbo`).
2. `node tools/voz.mjs decir <id>` genera los mp3 (se guardan en el repo porque cuestan créditos), los procesa (Turbo
   +4 semitonos y 1.3× más rápido; Debug 1.1×, o lo que diga `velDebug` en el .json si el reel queda largo) y escribe `<id>.tiempos.json` con la duración y el volumen por frame.
3. En el reel, cada línea tiene su frame de inicio (`VOZ` en el .tsx). Las burbujas duran lo que dura el audio y las
   bocas se mueven con el volumen. La música va al 30 % (`volMusica`).
4. Las burbujas y los textos siguen en pantalla como subtítulos: mucha gente ve sin sonido.
La key está en `apps/video-portada/.env` (fuera del repo). `node tools/voz.mjs creditos` dice cuánto queda.

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

- Clases desbalanceadas · «Cuando tu modelo de fraude tiene 99 % de accuracy 😎» · 99 % de accuracy y 0 fraudes
  atrapados · TrueML (Sensei).
- Evaluar con los datos de entrenamiento · «Cuando tu modelo saca 100 % a la primera» · un árbol sin límite de
  profundidad memoriza casi todo el entrenamiento · TrueML (Sensei).
- (Hecho: 08 · overfitting / early stopping, el debut de Turbo.)
- (Hecho: 09 · la T: entrenar el modelo es solo 1 de las 6 piezas; analogía del platillo y el restaurante.)
- (Hecho, lote del 2026-11-20, tono «la brecha entre saber ML y que te contraten»: 10 · presumir 99 % en la entrevista
  (baseline y recall) · 11 · el vibecoding no basta (`except: pass`, traceback, un test) · 12 · diseño de sistemas, el
  modelo va casi al final · 13 · Docker vs Kubernetes en el CV (la caja y el timonel) · 14 · estimaciones, «muchos»
  servidores = 5 · 15 · el portafolio de 5 notebooks del Titanic.)

## 8. Gustos y humor del usuario (el registro que permite pasar de etapa)

Después de cada pieza, Claude anota aquí lo que el usuario cambió, eligió o rechazó **y por qué**, en una línea con
fecha. Esta sección es lo que más importa para trabajar solo más adelante: se lee completa antes de proponer nada.

**Lo que ya se sabe (antes de la primera pieza):**
- Nada de tono de anuncio: los reels de lanzamiento se sentían como «alguien vendiéndome algo» (2026-11-17).
- Explicar desde cero: definir cada concepto, una analogía y un solo lugar para las aclaraciones.
- Cifras que se recuerden y lenguaje sencillo, sin perder los conceptos.
- Diseño TrueML (Dojo): el logo solo donde encaja, nunca forzado.

**El humor:** se sigue descubriendo. Lo que ya se sabe:
- 2026-11-19 · Le gustan los videos que **se burlan un poquito** de situaciones del gremio, en formato «Cuando…»:
  «Fuiste a una entrevista y no pudiste responder nada (Kubernetes, Docker…)», «Cuando crees que el vibecoding es
  suficiente». Se imagina **un monito** y a todos riéndose en un **ambiente negro**, o una escena actuada con voces
  (ElevenLabs). Eran ejemplos del tono, no ideas concretas.
  → La burla es para la situación (la que el espectador ya vivió), no para una persona ni para los principiantes. La
  burla sirve de gancho, y después viene la explicación: «lo que debiste responder».

**El personaje (en definición):**
- 2026-11-19 · El estereotipo de un **programador joven** con **un detalle muy contrastante** que lo haga único.
  Cambio de planes el mismo día: **no es humano, es un animal súper tierno** (un perrito panzón o nalgón, u otro
  animal original) con todo el estereotipo del programador encima. El contraste es lo tierno contra la sudadera, las
  ojeras y la energética.
- 2026-11-19 · Eligió un **hámster cachetón** (sudadera, audífonos, energética, ruedita junto al escritorio; guarda
  bugs en los cachetes «para después»). El ajolote le gustó, pero lo descartó porque **encierra la marca en lo
  mexicano** → el personaje y los chistes deben funcionar en cualquier país de habla hispana.
- 2026-11-19 · Pidió que traiga **camiseta con la T de TrueML** (bajo la sudadera abierta). Aquí la marca sí encaja:
  va en la ropa del personaje, no como anuncio.
- 2026-11-19 · Probamos un 3D tipo figurita (three.js, `personaje/hamster-3d.html`). Después el usuario trajo su
  propio diseño 2D plano (estilo vector, colores suaves, cuarto oscuro con monitores de código, teclado con luz
  cian→morado, micrófono en los audífonos, la camiseta corta que deja ver la panza) y es **la referencia oficial**.
  Se rehízo en SVG por capas: `personaje/hamster-2d.mjs` → `hamster-2d.svg`. Lo aprobó tal cual.
- 2026-11-19 · Nombre elegido: **Turbo** (entre Kernel, Turbo, Bit y Cachetes).
- 2026-11-19 · Diseños de cuerpo entero: de frente (`turbo-cuerpo.mjs`) y de espaldas (`turbo-espalda.mjs`), en la
  hoja `turbo-hoja.svg`. Pidió que **de espaldas se le vean unas nalguitas** redondas con su colita → le gusta el
  humor tierno y un poco tonto del personaje (sirve para gags: Turbo se va corriendo, se agacha, mueve la colita).
- 2026-11-20 · **La personalidad de Turbo:** súper tierno por fuera, **grosero y de «voz gruesa»** por dentro. Ese
  contraste es el chiste. Como no hay voz, la voz gruesa se hace con sus burbujas: negras, con borde blanco grueso, en
  mayúsculas pesadas y con un temblor al aparecer. Las groserías van con símbolos («¿¡#@$%&!?»), nunca con palabrotas
  escritas, y las frases son de neutro a seco («No me discutas», «Nadie te preguntó, pato», «Me voy. No me hablen»).
  Debug, en cambio, habla en burbujas claras y tranquilas.
- 2026-11-20 · El usuario se cansó de elegir ideas y dijo «dale lo que se te ocurra». Para el primer reel, Claude
  escogió la idea y el guion. Lo que se apruebe o corrija se anota abajo.
- Compañero propuesto: un **patito de hule** (*rubber duck debugging*) que sabe y explica; con burbujas de texto.
- 2026-11-19 · Es **el que la riega**: comete el error que el espectador ya cometió. Alguien más (o el texto) explica
  lo correcto.
- 2026-11-19 · **Sin voz por ahora** (nada de ElevenLabs): todo con texto en pantalla.

**Registro por pieza:**

<!-- AAAA-MM-DD · <pieza> · lo que se cambió → lo que eso dice de sus gustos -->
- 2026-11-20 · 08-overfitting (debut de Turbo) · le encantó tal cual. Pidió dos cosas para lo que sigue:
  **sonidos para los movimientos de Turbo** y, si se puede, **voz** (ElevenLabs) → quiere que el personaje se sienta
  más vivo. La voz cambia la regla de «sin voz». Las burbujas se quedan como subtítulos.
- 2026-11-20 · Voces (ElevenLabs, `tools/voz.mjs`, ids en `src/reels/voces.json`): **Debug = el narrador**, con voz
  tranquila de maestro (muestra 1). Para Turbo **rechazó la voz grave**: la quiere **chillona** (aguda, como de
  ardilla enojada). Lo grosero queda en lo que dice, no en lo grave de la voz.
- 2026-11-20 · 09-la-t (entrenar es 1 pieza de 6; platillo vs. restaurante) · el usuario dio el tema y Claude propuso
  tres ganchos; eligió el de «Cuando tu modelo saca 95 % y ya te crees ML Engineer» y lo aprobó **tal cual**, sin
  cambios. Para que quepa (52 s) se recortaron frases de la voz y Debug fue a 1.15× → le gusta el formato «Cuando…»
  con un remate tonto de Turbo (la ruedita: corre mucho y no llega).
- 2026-11-20 · **Cambio de tono para el lote 10–15:** el usuario pidió que, más que clases de ML, los reels sean
  **burlas de la brecha entre «sé modelos / hago vibecoding» y «me contratan / paso la entrevista»**. Turbo llega
  confiado a una entrevista o a un trabajo y la riega; Debug le da «lo que debiste responder», con una lección concreta.
  Claude propuso 8 ideas y el usuario eligió las 6 primeras. Las hicieron 6 sesiones en paralelo, sin él, y él aprobó
  el lote completo («¡Listo, tenemos todo para el Instagram!»). Lo que decidieron las sesiones y quedó aprobado:
  - El entrevistador **no tiene voz**: es una silueta en una videollamada, su chat o una tarjeta de texto. Debug lee
    sus preguntas. La IA tampoco tiene voz. Ninguna marca real en pantalla («la IA», «el entrevistador», «el reclutador»).
  - Remate recurrente: «Gracias. **Nosotros te llamamos**.» → Turbo: «¿Eso es un sí?» → Debug: «No.» (10, 12 y 13).
  - Gags que funcionaron: lentes oscuros que se le resbalan (10), «¡Ahora TODO es fraude!» (10), la IA que pide
    perdón en loop (11), los mini-Turbos de Kubernetes y «¡Ese era yo!» (13), el sello «AL TANTEO» y «cinco son
    muchos» (14), `titanic_v6_con_icebergs.ipynb` (15).
  - Debug va a 1.15–1.2× (`velDebug`) para quedar ≤ 50 s; lo que no cabe en voz se queda en pantalla o en el texto.
  - Cifras con fuente y solo en el texto de la publicación cuando nombran una marca (paper de YouTube 2016, estudio de
    TheLadders 2018: ~7 s por CV, dataset de fraude con 0.17 %).
  - Para ahorrar créditos se pueden reusar los mp3 que ya dicen lo mismo. Los puntos suspensivos en las líneas de
    Turbo le meten ruidos raros a la voz: mejor evitarlos.
- 2026-11-20 · **Bio del perfil:** entre tres opciones (una con Turbo y Debug, una burlona y una seria) eligió **la
  seria**, que dice qué hay en trueml.app → los reels pueden ser chistosos, pero el perfil se presenta en serio.
