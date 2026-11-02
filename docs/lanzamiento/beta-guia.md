# Guía de la beta cerrada

Una semana, 10 a 20 personas, para encontrar lo que tú ya no ves antes de anunciar. Lo que haces tú está marcado con **(tú)**; el resto ya está preparado.

## 1. Objetivo y criterio de salida

Salir de la beta cuando:
- ninguna falla **grave** (ver tabla) queda abierta,
- al menos **8 de 10** personas completaron una tarea de su perfil sin pedirte ayuda,
- hay **5 comentarios** concretos de «qué me sirvió» que puedas citar (con su permiso) en el lanzamiento.

| Gravedad | Ejemplo | Qué hacer |
|---|---|---|
| Grave | No abre, pierde el progreso, un comando o cifra de la hoja es incorrecto | Corregir el mismo día |
| Media | Se ve mal en un dispositivo, texto confuso, enlace roto | Corregir antes del lanzamiento |
| Baja | Sugerencia, pulido | Anotar para después |

## 2. A quién invitar (tú)

Busca **tres perfiles**, con 4 a 6 personas cada uno. Invita por mensaje directo, no en público: así recibes respuestas más honestas.

| Perfil | Quién | Qué probar (15–20 min) |
|---|---|---|
| **Entrevista** | Gente que prepara o hizo una entrevista de ML/SWE en el último año | Una práctica cronometrada del curso (caso C01) y la hoja de estimaciones |
| **Producción** | Quien ya trabaja con ML o backend | Una hoja de su elección (Docker, Kubernetes o vLLM) y su revisor o diagnosticador |
| **Curiosidad** | Estudiantes o gente de otra área | El laboratorio Transformer (paso 1 al 10) y la demo del tablero |

Incluye al menos 3 personas que usen **celular o tablet** y 2 que usen **Safari**.

## 3. Mensaje de invitación (tú: personalízalo)

> Hola, [nombre]. Armé unas herramientas gratuitas para estudiar ML engineering (un curso de diseño de sistemas, hojas de Docker/Kubernetes/vLLM, un atlas de arquitecturas y un transformer que se entrena paso a paso). Antes de compartirlas quiero que alguien que [prepara entrevistas / trabaja con ML / es curioso del tema] las pruebe 15–20 minutos y me diga qué se entiende, qué falla y qué falta.
>
> Empieza aquí: https://ml-desde-cero.vercel.app
> Tu tarea sugerida: [tarea de su perfil].
> Cuando termines, cuéntame en 2 minutos aquí: https://github.com/ErikPalacios/ML_from_scratch/issues/new?template=beta.yml (si no tienes cuenta de GitHub, respóndeme por este chat con lo mismo).
>
> No tienes que ser amable: me sirve más lo que no se entendió. ¡Gracias!

## 4. Preguntas que importan (también están en la plantilla «Comentarios de la beta»)

1. ¿Qué probaste y cuánto tiempo le dedicaste?
2. ¿Qué te sirvió? ¿Qué aprendiste que no sabías?
3. ¿Qué te confundió, qué falló o qué te faltó?
4. ¿Se lo recomendarías a alguien que prepara una entrevista de ML?
5. ¿Con qué dispositivo y navegador lo abriste?

Si hablas con alguien en persona o por llamada, **mira sin ayudar**: pídele que comparta pantalla y anota dónde duda más de 10 segundos.

## 5. Seguimiento (tú)

Lleva una tabla simple (hoja de cálculo o nota):

| Persona | Perfil | Invitada | Probó | Respondió | Falla/idea (enlace al comentario) | Permiso para citar |
|---|---|---|---|---|---|---|

- **Día 1:** envía las invitaciones. **Día 3:** recordatorio amable a quien no ha probado. **Día 5–6:** pregunta por el permiso para citar. **Día 7:** cierra la beta y agradece por mensaje.
- Revisa los comentarios nuevos una vez al día: <https://github.com/ErikPalacios/ML_from_scratch/issues>. Las etiquetas `beta`, `contenido`, `bug` y `sugerencia` ya existen.
- Para corregir: cualquier sesión con Claude Code puede tomar un comentario («arregla el comentario #N»), reproducirlo, corregirlo, correr las pruebas y desplegar.

## 6. Qué medir

- **Vercel Web Analytics** en la portada, **cuando lo actives** (Vercel → proyecto `ml-desde-cero` → Analytics → Enable): visitas, páginas, país y de dónde llegan. Hasta entonces no hay cifras de visitas.
- GitHub: estrellas, comentarios abiertos y cerrados.
- Cualitativo: las respuestas a las preguntas 2 y 3. Es lo más valioso de la beta.

## 7. Antes de invitar: revisión rápida (tú)

- [ ] `node apps/portada/tools/qa.mjs` termina con «todo bien».
- [ ] Abres cada sitio en tu celular y en modo oscuro.
- [ ] Probaste compartir la portada por WhatsApp o LinkedIn y se ve la imagen.
- [ ] Leíste el [aviso de privacidad](https://ml-desde-cero.vercel.app/privacidad/) y estás de acuerdo con lo que dice.
- [ ] Activaste Web Analytics (opcional pero recomendado).
