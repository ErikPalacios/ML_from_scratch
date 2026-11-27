---
titulo: Clínica
en: Sizing case: a private hospital
subtitulo: Un hospital privado de 60 camas en Zapopan quiere que un LLM resuma expedientes y escriba borradores de nota de egreso las 24 horas, sin que un dato de salud salga de su red. Lo que piden la ley y las dos normas del expediente, qué modelo, cuántas GPUs, cómo se examina sin datos reales, qué puede salir mal de noche y cuánto cuesta cada resumen.
pregunta: «Queremos que el médico de guardia tenga el resumen del paciente en segundos, a cualquier hora, sin mandar nada a la nube y sin meternos en problemas.» ¿Qué se le propone a la clínica y cómo se defiende cada número?
requisitos: recorrido, requisitos-hardware, elegir-modelo, licencias, evals, seguridad, observabilidad, costo-total
sensei: privacidad, identidad, cifrado, percentiles
---

:::idea
En el despacho, lo difícil era la velocidad de una pregunta. En la clínica, lo difícil está alrededor del hardware: los datos son de salud, el expediente tiene dos normas oficiales, un asistente que sugiere una dosis se vuelve dispositivo médico, y el servicio tiene que seguir arriba a las 3:00 sin nadie despierto. Y el hardware lo deciden dos cosas que el despacho no tenía: el **expediente largo** (30,000 tokens en el p95) decide qué tarjeta lee a tiempo, y la **noche** decide que haya dos aunque una sola aguante el pico.
:::

## La clínica y lo que pide {The hospital and what it asks for}

Llaman el director médico y la jefa de TI de un **hospital privado general de 60 camas en Zapopan, Jalisco**, con una torre de consultorios de médicos externos al lado. Es ficticio y en este caso se llama solo «la clínica»; sus números viven en una ficha, `content/clinica.json`, y se usan tal cual. Lo que viene del mundo real (leyes, normas, estadísticas, modelos, precios) lleva su fuente y su fecha.

El director cuenta el problema: «En el pase de turno, el médico que llega tiene cinco minutos por paciente y un expediente de cuarenta notas. De noche hay un solo médico de guardia. La nota de egreso se escribe a las prisas. Y varios médicos ya pegan notas en un chatbot público.» Eso último es el [[shadow-ai|shadow AI]] que disparó el proyecto del despacho, con una diferencia: aquí lo que se pega son **datos de salud**.

La jefa de TI pone tres condiciones: nada sale de la red, el expediente electrónico que ya tienen no se toca por dentro, y el sistema funciona **24 × 7**, porque la guardia de noche es la que más lo necesita.

| Dato | Valor | De dónde sale |
|---|---|---|
| Camas | 60, ocupadas al 60 % → 36 pacientes | Supuesto |
| Estancia | 2.1 días → ≈ 17 egresos al día | Media nacional de los hospitales privados (INEGI, ESEP 2025, 31-jul-2026) |
| Médicos con acceso | ≈ 178, el 83.8 % externos | Razones nacionales por cama (ESEP 2025) |
| Usan el asistente | 60 médicos, 20 resúmenes al día cada uno: 1,200 | Supuesto, el de las lecciones |
| Lo que piden | Resumir el expediente con cita a cada nota; el borrador de la nota de egreso | Decisión del caso |
| Horario | 24 × 7; consulta de 8:00 a 20:00, 6 días | Supuesto |

Dos datos del INEGI cambian el caso antes de hacer una cuenta. **Un hospital de 60 camas es grande:** de los 2,689 establecimientos privados con camas, solo el **4.1 %** tiene 50 o más. Y **casi ningún médico es empleado:** en los hospitales privados, el **83.8 %** trabaja «con un acuerdo especial» y solo el 16.2 % está en nómina. Los usuarios del asistente son profesionales externos con acceso al expediente: cambia quién responde de qué, qué firma cada uno y cómo se dan de baja sus accesos.

:::ojo Los 1,200 resúmenes y el INEGI no cuadran, y está bien
Con las razones nacionales por cama, un hospital de 60 camas tendría ≈ 64 consultas externas al día; con un resumen por paciente en cada pase de turno y uno por egreso, son **≈ 190 resúmenes al día**, no 1,200. La diferencia es la **torre**: 60 médicos que preparan 20 consultas cada uno. El caso conserva los 1,200 y lo dice; en «Qué cambiaría si…» se ve el caso sin torre.
:::

**Por qué no puede salir de su red.** La salud es un [[dato-sensible|dato personal sensible]], con consentimiento expreso y medidas a su altura; el Reglamento de la ley pone condiciones a la nube que un servicio por API difícilmente cumple; la norma del expediente dice que los datos del paciente «no deberán ser divulgados»; y las multas pueden llegar al doble con sensibles. Por eso la API, ≈ 88 veces más barata en la herramienta de TCO, aquí no es opción. El caso no pregunta *si* conviene el servidor propio: pregunta **cuál** y **cómo**.

## Datos de salud: la ley, dos normas y el uso previsto {Health data: the law, two standards and the intended use}

Esta sección presenta lo que ninguna lección leyó: las dos normas del expediente y la frontera con los dispositivos médicos. La ley de datos la explica a fondo la lección de Sensei [«Privacidad»](https://sensei.trueml.app/privacidad/); aquí se recuerda en lo que toca a la clínica. Es la lectura del caso, no asesoría: lo confirma su abogado sanitario.

:::intenta ¿Qué regla pide cada decisión?
Cuatro fuentes, en una línea cada una. **La ley de datos (LFPDPPP de 2025):** la salud es dato sensible; pide consentimiento expreso y por escrito, un aviso que diga para qué se usan los datos, consentimiento nuevo para otra finalidad, medidas de seguridad y confidencialidad de todos los que intervienen. **La NOM-004:** cada nota lleva fecha, hora, nombre y firma de quien la escribe, sin abreviaturas, y el expediente se guarda al menos 5 años. **La NOM-024:** el sistema electrónico autentica a cada usuario, da permisos por rol y garantiza la «trazabilidad». **La regla de dispositivos médicos en consulta:** un software que sugiere tratar o diagnosticar a un paciente grave es clase III.

¿Qué fuente pide cada decisión? a) No entrenar con expedientes reales. b) El borrador queda marcado «borrador» hasta que el médico lo firma. c) No hay chat libre: solo dos botones. d) Cada resumen deja una fila de quién lo pidió y de qué paciente. e) El asistente solo lee lo que el médico ya puede abrir. f) El aviso de privacidad menciona el asistente.
???
1. **a) La ley**, art. 11: entrenar es una finalidad distinta de la atención.
2. **b) La NOM-004**, 5.10: firma quien elabora la nota. El modelo propone.
3. **c) La regla de dispositivos médicos**: un chat libre invita a preguntar «¿qué dosis le doy?», que es tratar o diagnosticar.
4. **d) La NOM-024**, 6.6.1: trazabilidad.
5. **e) La NOM-024**, 6.6.4 (roles), y la ley, art. 18 (medidas de seguridad).
6. **f) La ley**, art. 15: el aviso nombra los datos sensibles y las finalidades.
:::

Ninguna de las seis es de hardware, y todas cambian el diseño.

### La ley de datos con datos de salud

La LFPDPPP vigente se publicó el **20 de marzo de 2025**; su última reforma es del **14 de noviembre de 2025** (texto de la Cámara de Diputados, consultado el 26-nov-2026). Aplica a los particulares: el hospital privado entra; un hospital público va por otra ley. La autoridad ya no es el INAI: es la **Secretaría Anticorrupción y Buen Gobierno**.

| Artículo | Lo que dice | Para el asistente |
|---|---|---|
| 2-VI y 8 | La salud es **dato sensible**; pide consentimiento **expreso y por escrito** | Ya se firma en la admisión; el asistente trata los datos para la misma finalidad |
| 11 | Otra finalidad pide **nuevo consentimiento** | Nada de entrenar ni afinar con expedientes reales |
| 15 | El aviso dice qué datos (identificando los sensibles) y para qué | El aviso nombra el asistente |
| 18–19 | Medidas según «la sensibilidad de los datos»; una vulneración que afecte de forma significativa se informa de inmediato al titular | Red, cifrado, roles; plan de incidentes escrito antes de arrancar |
| 20 | Confidencialidad de todos los que intervienen, aun después de terminar su relación | La firman cada médico externo y el integrador |
| 26-II | Oposición a decisiones automatizadas que evalúen la salud **sin intervención humana** | El médico revisa y firma todo |

:::profundo El Reglamento de 2011 y lo que cuesta no cumplir
El texto nuevo es corto: el detalle del encargado y del análisis de riesgos sigue en el **Reglamento de 2011**, que la Cámara todavía publica como vigente (no se encontró uno nuevo; queda como duda). De él, tres cosas: el integrador que opera el servidor es **encargado**, con cláusulas contractuales, y pasarle los datos es una remisión que no pide consentimiento (arts. 49–53); la nube con contratos de adhesión solo vale con proveedores que no asuman la titularidad y transparenten sus subcontrataciones (art. 52); y con sensibles, el análisis de riesgos se revisa una vez al año (art. 62).

No cumplir cuesta: hasta 320,000 UMA (la Unidad de Medida y Actualización, $117.31 al día en 2026) por faltar a la confidencialidad o a la seguridad, y hasta el doble con sensibles (**$75,078,400**, la cuenta de la lección [Seguridad](/seguridad/)), y de 6 meses a 6 años de prisión por una vulneración con ánimo de lucro con sensibles (arts. 58–59, 62 y 64).
:::

Lo esencial del Reglamento para el diseño: el integrador que opera el servidor es [[encargado-de-datos|encargado]], con un contrato; y la nube con contratos de adhesión tiene condiciones que una API pública difícilmente cumple.

### La NOM-004: el expediente clínico

La **NOM-004-SSA3-2012** (DOF, 15-oct-2012) es la [[nom-004|norma del expediente clínico]].

:::analogia El libro de actas
El libro de actas de una escuela tiene un reglamento: qué se anota, quién firma cada página, que no se tache ni se abrevie, cuántos años se guarda. La NOM-004 es ese reglamento para el expediente.

Dónde se rompe: el libro de actas lo puede pedir cualquiera con permiso; el expediente lleva datos de salud y solo se da a conocer al paciente, a su representante y a ciertas autoridades (5.6–5.7).
:::

:::profundo Los apartados de la NOM-004 que pesan para el asistente

Lo que pesa para el asistente:

- **5.1:** el hospital es **solidariamente responsable** del personal que atiende ahí, «independientemente de la forma en que fuere contratado». El 83.8 % de externos no le quita responsabilidad.
- **5.4:** el expediente se conserva **al menos 5 años desde el último acto médico**. El asistente no guarda texto clínico propio: lo firmado entra al expediente y se conserva con él.
- **5.5:** los datos que identifican al paciente no se divulgan; para investigación, autorización escrita. El examen no usa expedientes reales.
- **5.10–5.11:** cada nota lleva fecha, hora, nombre y **firma** de quien la elabora, **sin abreviaturas**.
- **8.9:** la [[nota-de-egreso]] tiene un contenido mínimo (fechas, motivo, diagnósticos finales, evolución y estado actual, manejo, pendientes, plan, vigilancia ambulatoria, factores de riesgo, pronóstico y, si la hubo, causas de defunción). Son los apartados del borrador.
:::

:::ojo Las abreviaturas están en todas partes
La nota sintética con la que se midieron los tokens de este caso, escrita para parecer real, dice «TA 128/76 mmHg, FC 82 lpm». Así escriben los médicos, y un borrador que copie «TA» incumple el 5.11. El prompt pide escribir completo, el verificador cuenta las abreviaturas que quedan y el médico corrige antes de firmar.
:::

### La NOM-024: el sistema electrónico

:::profundo Qué pide la NOM-024, punto por punto

La **NOM-024-SSA3-2012** (DOF, 30-nov-2012) regula los [[nom-024|sistemas de registro electrónico para la salud]] (SIRES), como el expediente electrónico de la clínica. Está vigente: su revisión de 2018 la confirmó. Pide un sistema de gestión de seguridad con **trazabilidad y no repudio** (6.6.1), usuario y contraseña **como mínimo**, con factores adicionales recomendados (6.6.3), y permisos **por rol** (6.6.4).
:::

El asistente no es un SIRES, pero **lee** de uno y hereda sus reglas: entra con la sesión del médico, respeta sus permisos y deja rastro de cada lectura. La norma no dice «bitácora»: «quién vio qué» es la lectura razonable de «trazabilidad».

:::nota La salud digital en la Ley General de Salud
El 15 de enero de 2026 se publicó un capítulo de «Salud digital» (art. 71 Bis y siguientes) que menciona los registros electrónicos; sus obligaciones concretas son para las instituciones **públicas**. Tampoco hay una ley federal de inteligencia artificial aprobada a noviembre de 2026.
:::

### ¿Resumir o diagnosticar? El uso previsto

Un programa que diagnostica o sugiere tratamiento es un [[software-dispositivo-medico|dispositivo médico]], aunque no tenga un cable, y lo regula la COFEPRIS (la autoridad sanitaria federal) con la Farmacopea de los Estados Unidos Mexicanos (FEUM). Del **1 de noviembre al 31 de diciembre de 2025**, la FEUM puso a consulta una categoría «software como dispositivo médico» con una regla que lo clasifica por **impacto**: el propósito de la información cruzado con el estado del paciente. Que ya sea definitiva no se pudo confirmar; el caso la usa como lo más probable.

:::figura caso-clinica-regla
La regla propuesta. Lo que la clínica hace no está en ninguna casilla de «tratar o diagnosticar»: reorganiza lo que ya está escrito.
:::

- **Resumir con cita**, sin inferir nada, y un **borrador** que el médico firma: propósito documental; leído como «informar», clase I o II. Aun así, el **uso previsto** se escribe en el contrato y en la pantalla.
- **Sugerir un diagnóstico o una dosis** a un hospitalizado: **clase III**. Registro sanitario, evidencia clínica, validación: deja de ser un caso de dimensionamiento.
- **Un triage automático** sin revisión: clase III, y además el derecho de oposición del art. 26-II.

Por eso el asistente tiene **dos botones y ningún chat**. Y por eso importa la licencia del modelo: la de MedGemma se termina justo si una autoridad pudiera tratar a Google como fabricante de un dispositivo médico.

## Requisitos y perfil de carga {Requirements and load profile}

:::intenta ¿Cuántos resúmenes se escriben a la vez a las 8:00?
De la ficha: 60 médicos, 20 resúmenes al día. Las lecciones modelan la torre como si los 1,200 llegaran en **8 horas efectivas**, con un pico de **4 veces** el promedio a las 8:00, cuando abre la consulta. Cada resumen lee ≈ 12,000 tokens (supón ≈ 1.4 s de lectura) y escribe ≈ 600 a 20 tokens por segundo. Con la [[ley-de-little|ley de Little]], ¿cuántos hay abiertos a la vez en el pico? ¿Cuántos llegan en los primeros 20 minutos?
???
1. Promedio: 1,200 ÷ (8 × 3,600) ≈ 0.0417 por segundo; en el pico, × 4 = **0.167 por segundo**.
2. Cada resumen dura 1.4 s + 600 ÷ 20 = 30 s: ≈ 31.4 s.
3. Little: 0.167 × 31.4 ≈ **5.2 a la vez**. La [herramienta de sizing con los números de la clínica](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=60&r=20&Np=12000&No=600&h=8&pk=4&v=20&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2) da 5.23.
4. En 20 minutos: 0.167 × 1,200 s ≈ **200 resúmenes**: los 60 médicos piden los de sus primeros pacientes casi a la vez.
:::

El pico de la clínica no dura una hora: dura veinte minutos.

### Lo que hace y qué tan bien

Funcionales: **resumir el expediente** con cada frase citada a su nota (antes de la consulta, en el pase de turno y en la guardia) y **escribir el borrador de la nota de egreso**, marcado «borrador de IA» hasta que el médico lo firma. Y lo que **no** hace, escrito igual de claro: no sugiere diagnósticos, dosis ni prioridades; no tiene chat; el dictado queda para una fase 2.

Los [[requisito-no-funcional|no funcionales]], con número:

| Requisito | Valor | Por qué |
|---|---|---|
| Entrada típica (la mediana) / p95 | ≈ 12,000 / ≈ 30,000 tokens | 5,700 palabras × 2.1; el p95, estancias largas (supuesto) |
| Tope de contexto | 32,768 tokens | Cabe el p95 y la respuesta |
| Salida | ≈ 600 (resumen) / ≈ 900 (borrador de egreso) | Supuestos |
| [[ttft\|TTFT]] | ≤ 8 s en el p95, con la fila | Un resumen no es una conversación |
| Velocidad | ≥ 20 tokens/s | El criterio del despacho |
| Si falla una pieza | El servicio sigue igual | No hay nadie despierto para el asistente |

### De palabras a tokens en una nota clínica

:::formula Tokens que lee un resumen
N = w × f
- w: las palabras que se leen del expediente
- f: los tokens por palabra del tokenizador, con texto clínico
- N: los tokens de entrada del resumen
:::

El caso no tiene expedientes reales para medir \(w\), ni debe tenerlos: es un supuesto. Para \(f\) hay una medición pequeña: una **nota de evolución sintética** de 249 palabras, con cifras, unidades y fármacos, da 2.09 tokens por palabra con el tokenizador de Qwen3.8 27B, 1.98 con el de Gemma 4 y 2.23 con el de Qwen3 32B. El despacho usaba ≈ 1.6 con prosa formal: **una nota médica pesa más**, porque «850 mg cada 12 horas» se parte en muchos tokens.

:::cuenta Los tokens de un resumen típico
Palabras, \(w\) // estancia ≈ 3,500 + historial ≈ 2,200 (supuesto) | 3,500 + 2,200 | 5,700
Tokens por palabra, \(f\) // nota sintética, tokenizador de Qwen3.8 27B | medido | 2.09 ≈ 2.1
Tokens de entrada, \(N\) | 5,700 × 2.1 | 11,970 ≈ **12,000**
= El doble que una pregunta del despacho, y uno de cada veinte lee 30,000. La medición es de **una nota inventada**: dentro de la clínica, con expedientes reales y sin sacarlos, se mide de verdad.
:::

### El perfil de un día

:::figura caso-clinica-dia
El mismo día de 1,200 resúmenes en 24 horas (perfil supuesto). Lo que dimensiona son 20 minutos a las 8:00; lo que decide la redundancia es la noche.
:::

Cuatro momentos: el **pico de las 8:00** (≈ 200 en 20 minutos, ≈ 5.2 a la vez); los **pases de turno** de las 7:00, 14:00 y 21:00 (36 resúmenes en 20 minutos, ≈ 0.94 a la vez); el **día normal**, con menos de uno; y la **noche**, ≈ 50 solicitudes entre las 21:00 y las 7:00, una cada 12 minutos.

La lección [De requisitos a hardware](/requisitos-hardware/) pide [[holgura]], [[n-mas-1|N+1]] y [[crecimiento]]. En el despacho, el N+1 era «por si acaso»; aquí es **el requisito que más pesa**: de noche la carga es casi cero, pero el único médico de guardia es justo el que no puede esperar a que alguien llegue a reiniciar el servidor.

**El TTFT: 8 segundos, no 2.** El abogado conversa; el médico aprieta el botón al abrir el expediente y lee cuando aparece la primera línea. La ficha fija **≤ 8 s en el p95, con la fila**: un supuesto que se valida con los médicos en el piloto y se firma antes de medir. La velocidad se queda en 20 tokens por segundo: ≈ 9.5 palabras por segundo, más de lo que alguien lee.

:::nota Lo que falta preguntar
Si el expediente electrónico tiene una API para leer las notas de un paciente con la sesión del médico (si no, el proyecto se detiene ahí); cuántas notas son PDFs escaneados, que la fase 1 no lee; cuántos de los 60 lo usarían de verdad; la tarifa de luz del hospital, y si su cuarto tiene dos circuitos libres en el UPS.
:::

## Memoria, velocidad y cuántas GPUs {Memory, speed and how many GPUs}

:::intenta ¿Qwen3.8 27B en FP8 llega a 20 tokens por segundo en una L40S?
En el [[decode]], cada token nuevo obliga a leer todos los pesos. En FP8, los de Qwen3.8 27B ocupan **≈ 30.32 GB** (la herramienta de VRAM). La L40S tiene **864 GB/s** de [[ancho-de-banda|ancho de banda]] y se logra **η_m = 0.7** de eso. Sin contar el KV cache, ¿cuántos tokens por segundo escribe una sola conversación?
???
1. Ancho de banda que se logra: 864 × 0.7 ≈ **605 GB/s**.
2. Un paso, solo con los pesos: 30.32 ÷ 605 ≈ **0.050 s**.
3. Velocidad: 1 ÷ 0.050 ≈ **20 tokens por segundo**, en la raya y sin el KV.
4. La [herramienta de velocidad con la L40S en FP8](/herramientas/velocidad/?p1=l40s&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2&cf=2&Np=12000&No=600&b=1), que suma el KV de 12,000 tokens, da **19.43**: no llega, ni con una sola conversación.
:::

Ese 19.43 decide media sección. Antes, el modelo.

### El modelo: tres candidatos y una licencia que no es la que parece

Con el método de [Elegir un modelo para la tarea](/elegir-modelo/), los filtros duros dejan tres:

| Modelo | Fecha · licencia | Lo que importa aquí |
|---|---|---|
| **Qwen3.8 27B** (Alibaba) | 5-ago-2026 · [[apache-2\|Apache 2.0]] | Solo 16 de sus 64 bloques guardan KV: **64 KiB por token**; contexto de 262,144 |
| **MedGemma 27B text-it** (Google) | 20-may-2025 · [[licencia-hai-def\|términos HAI-DEF]] | Entrenado para medicina; su tarjeta no dice idiomas |
| **Gemma 4 31B** (Google) | 11-mar-2026 · Apache 2.0 | ≈ 80 KiB por token más ≈ 800 MiB fijos por conversación |

**Por qué el KV importa tanto.** El tope del despacho era 8,192 tokens; el de la clínica, 32,768. Con Qwen3 32B (256 KiB por token), una conversación al tope ocuparía **8.59 GB** de [[kv-cache|KV cache]]; con Qwen3.8 27B, **2.15 GB**. El modelo nuevo no solo sale mejor en las tablas: **cabe de otra manera**.

**MedGemma no es Apache 2.0.** Es el error más fácil del caso. El código sí; **los pesos** van con los términos *Health AI Developer Foundations* (HAI-DEF, 15-nov-2024), leídos el 26-nov-2026: una política de uso prohibido que veta las **decisiones automatizadas en salud**; la licencia **se termina** si Google cree que una autoridad podría tratarlo como fabricante de un dispositivo médico, y hay que borrar el modelo y sus [[modelo-derivado|derivados]]; y los derivados (un afinado, un modelo destilado, **hasta un modelo entrenado con datos sintéticos que él generó**) cargan las mismas obligaciones. Sus salidas, en cambio, no son derivados. Su tarjeta dice que sus salidas no están pensadas para informar directamente diagnóstico ni tratamiento y que sus pruebas de seguridad fueron «principalmente en inglés». Sus cifras (87.7 en MedQA contra 74.9 de Gemma 3 27B) son auto-reportadas, en exámenes en inglés de opción múltiple. Y MedGemma 1.5 (enero de 2026) existe solo en 4B.

**La decisión:** el candidato base es **Qwen3.8 27B en FP8**, sin afinar y sin razonamiento. MedGemma entra al examen como **retador**; Gemma 4 31B, como tercero. En español clínico no hay una comparación publicada: los exámenes médicos en español que existen (HEAD-QA v2, MedExpQA, CareQA) son de España y ninguno mide resumir. **Decide el examen propio.**

:::ojo ¿Y el razonamiento?
Qwen3.8 piensa por omisión. Con 5,000 tokens de pensamiento a 20 por segundo serían 250 s antes de la primera línea: el objetivo de 8 s no lo permite. Se apaga, y el examen prueba aparte si pensar baja las omisiones graves.
:::

### Memoria: ¿caben 7 resúmenes al tope?

Con la [herramienta de VRAM en una Server Edition](/herramientas/vram/?V=rtx-pro-6000-blackwell-server&P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=32768&u=7) y 7 conversaciones de 32,768 tokens:

:::cuenta Memoria de una RTX PRO 6000 Server Edition con 7 resúmenes al tope
Pesos en FP8, \(W\) // (27.78 − 2.543) × 1 byte + 2.543 × 2 bytes (las tablas de tokens en 16 bits) | 25.24 + 5.09 | 30.32 GB
KV por token, \(m_{token}\) // 2 × 16 bloques × 4 juegos × 256 números × 2 bytes | 2 × 16 × 4 × 256 × 2 | 64 KiB
KV de las 7 al tope // 7 × 65,536 × 32,768 | 7 × 2.147 | 15.03 GB
Lo que necesitas // pesos + KV + 2 GB de programa | 30.32 + 15.03 + 2 | 47.36 GB
Lo que tienes, \(M_{útil}\) // 96 GB × 0.9 | 96 × 0.9 | 86.40 GB
Estado fijo de los 48 bloques lineales // ≈ 154 MB cada una, fuera de la herramienta | 7 × 0.154 | ≈ 1.08 GB
= Sobran ≈ 38 GB: al tope entrarían 25 (23 contando el estado fijo). En la Server Edition, la memoria no limita.
:::

En una L40S de 48 GB, el mismo modelo en FP8 deja 2.29 GB libres con 4 al tope; en INT4 de [[awq|AWQ]] (18.20 GB de pesos) caben 10. Por memoria, la L40S pasa. El problema es otro.

### Velocidad y lectura

En FP8 la L40S no llega a 20 tokens por segundo. En INT4 sí (**31.8** con una conversación), pero con dos costos: la **calidad** (la lección [Formatos de cuantización](/formatos-cuantizacion/) mide que INT4 pierde más que FP8, y aquí el examen pide **cero** dosis cambiadas) y el **[[prefill]]**: AWQ guarda los pesos en 4 bits pero calcula en 16, con los 362 TFLOPS de FP16 de la L40S. La Server Edition (96 GB, 1,597 GB/s, ≈ 1,000 TFLOPS de FP8 derivados en `gpus.json`) escribe a **35.9 tokens por segundo** en FP8 y lee rápido.

:::formula El prefill de un resumen
t_{pre} = frac{2 × A × N + 2 × L × h × d × N^2}{F × η_c}
- A: parámetros que usa cada token (27.78 mil millones)
- N: tokens de entrada
- L, h, d: bloques de atención completa (16), cabezas (24, del `config.json`) y números por cabeza (256)
- F: el pico de cálculo de la GPU en el formato con que calcula, en FLOPs por segundo
- η_c: la parte de ese pico que se logra (0.5)
- t_{pre}: el tiempo del prefill sin fila, en segundos
:::

:::cuenta El prefill de 12,000 tokens en las dos tarjetas
FLOPs de los pesos // 2 × \(A\) × \(N\) | 2 × 27.78 × 10⁹ × 12,000 | 6.67 × 10¹⁴
FLOPs de la atención // 2 × \(L\) × \(h\) × \(d\) × \(N\)² | 2 × 16 × 24 × 256 × 1.44 × 10⁸ | 0.28 × 10¹⁴
Server Edition en FP8 // \(F\) = 1,000 TFLOPS | 6.95 × 10¹⁴ ÷ (10¹⁵ × 0.5) | **1.39 s**
L40S con AWQ, en FP16 // \(F\) = 362.05 TFLOPS | 6.95 × 10¹⁴ ÷ (3.62 × 10¹⁴ × 0.5) | **3.84 s**
= Con 30,000 tokens, la atención crece con \(N^2\): **3.69 s** y **10.19 s** (la herramienta de velocidad).
:::

### Cuántas tarjetas

La [herramienta de sizing](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=60&r=20&Np=12000&No=600&h=8&pk=4&v=20&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2) junta memoria, velocidad y tráfico:

| Opción | A la vez en el pico | Lugares por tarjeta a ≥ 20 tokens/s | Tarjetas para el pico |
|---|---|---|---|
| L40S, FP8 | 5.32 | **0** | ninguna llega |
| [L40S, INT4 de AWQ](/herramientas/sizing/?p1=l40s&U=60&r=20&Np=12000&No=600&h=8&pk=4&v=20&P=27.78&A=27.78&Et=2.543&bits=4.15625&L=16&g=4&d=256&q=24&bkv=2) | 5.64 | 2 | **3** |
| Server Edition, FP8 | 5.23 | **7** | **1** |

Los 7 lugares los pone la velocidad, no la memoria. Con la media de los tamaños (≈ 13,600 tokens, no la mediana) bajan a 6, todavía arriba de los 5.26 que da el pico con esa media. **Una sola Server Edition aguanta el pico.** Con L40S hacen falta tres, y cuatro para el N+1.

## La propuesta de hardware {The hardware proposal}

:::intenta ¿Cuál opción cumple el TTFT de 8 s?
De la sección anterior: un expediente típico de 12,000 tokens se lee en 1.39 s en una Server Edition y en 3.84 s en una L40S con AWQ; uno de 30,000, en **3.69 s** y **10.19 s**. El objetivo es ≤ 8 s en el p95, y uno de cada veinte expedientes es de los largos. Sin simular: si cada L40S lleva su propia copia del modelo, ¿cumple con alguna cantidad de tarjetas? Y si no, ¿qué haría falta para que unas L40S leyeran más rápido un solo expediente?
???
1. El p95 del TTFT no puede bajar del tiempo de leer los expedientes del p95, aunque no haya fila: ≈ 10 s.
2. Más copias quitan **fila**, pero no hacen más rápida la lectura de **un** expediente. Con una copia por L40S, **ninguna** cantidad cumple.
3. Habría que **partir el modelo** entre dos tarjetas con [[tensor-parallel|tensor parallel]]: cada una hace la mitad del cálculo y se pasan resultados por PCIe en cada bloque ([Varias GPUs](/varias-gpus/)). Y cada una lee la mitad de los pesos: FP8 vuelve a ser posible.
:::

En el despacho, la pregunta normal era la que no cabía en el objetivo. En la clínica la normal cabe en cualquier tarjeta; **lo que no cabe es la cola de la distribución**, y la cola es justo lo que mide el p95.

### Dos L40S que leen como una

Con la [herramienta de sizing con dos L40S por copia](/herramientas/sizing/?p1=l40s&U=60&r=20&Np=12000&No=600&h=8&pk=4&v=20&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2&n0=2), un par en FP8 atiende **11 a la vez** y lee 12,000 tokens en **0.95 s**. Pero la herramienta no cuenta el cable; la lección «Varias GPUs» sí:

:::profundo La cuenta del cable entre las dos L40S

:::cuenta Lo que pasa por PCIe al leer un expediente en un par de L40S
Bytes por token // 64 bloques × 2 sumas entre tarjetas × 5,120 números × 2 bytes | 64 × 2 × 5,120 × 2 | 1,310,720 bytes
Bytes de 12,000 tokens | 1,310,720 × 12,000 | ≈ 15.7 GB
Por PCIe 4.0 // ≈ 31.5 GB/s por dirección | 15.7 ÷ 31.5 | ≈ 0.50 s
Prefill de 12,000 en el par // cálculo + cable | 0.95 + 0.50 | ≈ 1.45 s
Prefill de 30,000 en el par // cálculo + cable | 2.52 + 1.25 | ≈ 3.76 s
= En el papel, un par lee casi como una Server Edition. Un tercio es cable, y la latencia de cada envío por PCIe no tiene medición publicada.
:::
:::

Así nace la opción E: **4 L40S en 2 pares**, una copia en FP8 por par. Un par aguanta el pico solo: también es un N+1 completo.

### La fila, simulada

La misma simulación de «De requisitos a hardware», con los tamaños de la clínica: llegadas al azar a 0.167 por segundo, tamaños con mediana de 12,000 y p95 de 30,000 (topados en 31,000), una fila de prefill por tarjeta, cada resumen a la que se desocupa primero, y el decode sin frenar al prefill (una simplificación igual para todas). Da un TTFT p95 de **3.7 s** con dos Server Edition, **4.3 s** con una, **10.3 s** con 3 L40S y **10.2 s** con 4.

:::profundo La simulación, en Python
```python
import math, random
A, L, q, d = 27.78e9, 16, 24, 256              # Qwen3.8 27B, la parte de atención completa
def prefill(n, pico):                           # la cuenta de la herramienta de sizing, con η_c = 0.5
    return (2 * A * n + 2 * L * q * d * n * n) / (pico * 0.5)
def p95(gpus, pico, lam=1 / 6, horas=400):
    r = random.Random(7); libre = [0.0] * gpus; t = 0.0; ttft = []
    for _ in range(int(lam * 3600 * horas)):
        t += r.expovariate(lam)                 # llegadas al azar, 0.167 por segundo
        n = min(31000, 12000 * math.exp(r.gauss(0, 0.557)))   # mediana 12,000; p95 ≈ 30,000
        g = min(range(gpus), key=lambda k: libre[k])          # a la tarjeta que se desocupa primero
        libre[g] = max(t, libre[g]) + prefill(n, pico)
        ttft.append(libre[g] - t)
    ttft.sort()
    return ttft[len(ttft) // 2], ttft[int(0.95 * len(ttft))]
for nombre, g, pico in [("2 Server Edition, FP8", 2, 1000e12), ("1 Server Edition", 1, 1000e12),
                        ("3 L40S, INT4 de AWQ", 3, 362.05e12), ("4 L40S, INT4 de AWQ", 4, 362.05e12)]:
    p50, p = p95(g, pico)
    print(f"{nombre:22} TTFT p50 {p50:4.1f} s · p95 {p:4.1f} s")
```

```salida
2 Server Edition, FP8  TTFT p50  1.4 s · p95  3.7 s
1 Server Edition       TTFT p50  1.7 s · p95  4.3 s
3 L40S, INT4 de AWQ    TTFT p50  3.9 s · p95 10.3 s
4 L40S, INT4 de AWQ    TTFT p50  3.8 s · p95 10.2 s
```
:::

:::figura caso-clinica-cola
El TTFT de la simulación, con la lectura sin fila al lado. La cuarta L40S casi no mueve el p95: la fila ya era corta; lo que tarda es leer.
:::

Con el prefill del par (cálculo más cable), la opción E da un p95 de **≈ 3.8 s** con los dos pares y **≈ 4.5 s** con uno. La forma de la distribución es un supuesto; la conclusión aguanta mientras el p95 de entrada ronde los 30,000. El piloto la reemplaza con la distribución medida y el p95 de una [[prueba-de-carga|prueba de carga]] abierta a 0.167 por segundo.

### Cinco opciones, lado a lado

| | A) 3 L40S, INT4 | B) 4 L40S, INT4 | C) 1 Server Edition | D) 2 Server Edition | E) 4 L40S en 2 pares, FP8 |
|---|---|---|---|---|---|
| Lugares a ≥ 20 tokens/s (pico ≈ 5.2–5.6) | 6 | 8 | 7 | 14 | 22 (sin contar el cable) |
| TTFT sin fila, 12,000 / 30,000 | 3.84 / 10.19 s | 3.84 / 10.19 s | 1.39 / 3.69 s | 1.39 / 3.69 s | ≈ 1.45 / 3.76 s |
| TTFT p95 con la fila | 10.3 s | 10.2 s | 4.3 s | 3.7 s | ≈ 3.8 s |
| ¿Cumple ≤ 8 s? | no | no | sí | sí | sí, en el papel |
| Si falla una tarjeta | 4 lugares: degradado | 6: igual | **se cae** | 7: igual, p95 ≈ 4.3 s | cae su par; el otro sigue |
| Compra del servidor (US$) | 67,191.30 | 76,101.30 | ≈ 57,620 | ≈ 74,779 | 76,101.30 |
| Al mes, herramienta de TCO (US$) | 2,923 | 3,143 | 2,681 | 3,101 | 3,143 |

Los precios con L40S son del configurador de Exxact (base de US$40,461.30 + US$8,910 por tarjeta, 2026-11-25, `equipos.json`). La Server Edition **no tiene precio de lista**: el caso usa los **US$17,159** que pedía CDW en EE. UU. el 26-nov-2026, con la tarjeta «backordered», el mismo precio que encontró el caso del despacho, y supone que cabe en el mismo chasis, algo que confirma el integrador.

### La decisión

**D) un servidor 4U con 2 × RTX PRO 6000 Blackwell Server Edition**, cada tarjeta con su propia copia de Qwen3.8 27B en FP8 (dos [[replica|réplicas]], sin partir el modelo). En orden de peso:

1. **Cumple el TTFT con los expedientes largos sin partir el modelo.** A y B no cumplen; E cumple en el papel, con un tercio de su lectura en un cable que nadie ha medido con esta arquitectura.
2. **El N+1 es completo.** Una tarjeta aguanta todo el pico (7 lugares contra ≈ 5.2): si una falla a las 3:00, el servicio sigue con el p95 en ≈ 4.3 s. En el despacho, dos Server Edition eran un N+1 «en el filo»; aquí es de verdad.
3. **Menos piezas que fallen.** D tiene 2 tarjetas; E tiene 4, y cualquiera que falle saca a su par.
4. **FP8, no INT4**, con la calidad que pide una clínica.
5. **Cuesta lo mismo**: US$42 al mes menos que B o E.

La opción C es la trampa: la más barata y la que cumple el TTFT, pero sin repuesto. Una tarjeta que falla un viernes en la noche, con la garantía de un integrador en EE. UU., son días sin asistente. En un hospital 24 × 7, la segunda tarjeta no es para el pico: **es para la noche en que falle la primera**.

:::cuenta Cuánto aguanta una sola Server Edition
Lo que dura un resumen // 1.39 s de lectura + 600 ÷ 20 | 1.39 + 30 | 31.39 s
Resúmenes en 20 minutos con 7 lugares // Little al revés | 7 ÷ 31.39 × 1,200 | ≈ 268
Lo que llega a las 8:00 en 20 minutos | 0.167 × 1,200 | ≈ 200
= Una tarjeta atiende el peor momento del día con ≈ 34 % de holgura.
:::

### Plan B y lo que haría cambiar la decisión

Como en el despacho, se **cotizan dos configuraciones**: D y E. Si la Server Edition no llega en el plazo, el plan B es **E**, que se consigue hoy al mismo precio, con una condición: en la semana 2 del piloto se mide el prefill de 30,000 tokens en un par, y si pasa de ≈ 6 s (el cable salió peor que el supuesto) se pasa al plan C: **4 L40S en INT4** con un tope de 20,000 tokens y lo más largo resumido por partes ([[map-reduce]]). Ese plan da un p95 de ≈ 6.6 s con 3 tarjetas en servicio, pero ≈ 18 % de los resúmenes iría por partes, y el examen tendría que probar que no pierde lo importante.

Lo que haría cambiar la decisión, y que el piloto mide: **el p95 real de los tamaños** (con expedientes más cortos, las L40S vuelven a competir); **que el FP8 dinámico de vLLM 0.34.0 salga bien con Qwen3.8 27B** (la arquitectura es la de Qwen3.5, que vLLM ya corre; si falla, el checkpoint FP8 oficial `Qwen/Qwen3.8-27B-FP8`, del 13-ago-2026, o, en último caso, BF16: ≈ 55.6 GB de pesos, que caben en una Server Edition y no en una L40S); **el precio y el plazo** de la Server Edition; y **el crecimiento**: con 80 médicos una tarjeta todavía aguanta el pico (6.98 contra 7); con 81 ya no, y el N+1 pide una tercera, que cabe en el chasis de 4 ranuras.

:::profundo Dónde va el servidor

**Dónde va.** Al cuarto de cómputo del hospital, que ya tiene UPS, planta de emergencia y aire (supuesto); lo nuevo son **dos circuitos dedicados**, uno por fuente, ≈ MXN 60,000 de obra (la cifra de la lección [TCO](/costo-total/)). Pico estimado de ≈ 2,300 W (2 × 600 W de GPU + 400 W de CPUs + 700 W del resto); ≈ 930 W en promedio en 24 × 7. Una [[workstation]] de torre, la que [El cuarto](/el-cuarto/) ponía en un consultorio, aquí no sirve: una sola fuente, sin [[bmc|BMC]] y «de noche se apaga».
:::

## El stack {The stack}

:::intenta ¿Qué guarda el registro de uso?
La NOM-024 pide «trazabilidad»: poder decir quién vio qué. La ley pide limitar los datos sensibles al mínimo, y todo lo que el asistente derive de un expediente también es sensible. El despacho guardaba una fila por pregunta **sin el texto**, 90 días, a ≈ 1 KB por fila. Diseña la fila de la clínica: ¿qué campos sí y cuáles no? ¿Cuánto tiempo? Con 1,200 resúmenes al día, ¿cuánto disco en un año?
???
1. **Sí:** quién (el médico), de qué paciente (su número de expediente, no su nombre), cuándo, qué tipo (resumen o borrador), qué notas citó, cuánto tardó, la **huella** del texto (un hash, que prueba que un texto es ese sin guardarlo) y las marcas del verificador.
2. **No:** el texto del resumen ni el del prompt. Las notas ya viven en el expediente; el borrador firmado entra por su camino normal.
3. **Cuánto:** más que 90 días, porque una queja médica tarda en llegar. La ficha dice 12 meses, decisión de la clínica que confirma el abogado.
4. **Disco:** 1,200 × 365 ≈ 438,000 filas × 1 KB ≈ **438 MB** al año. Nada.
:::

La otra mitad del rastro la guarda el expediente, que ya anota quién abrió qué, y ningún dato clínico se copia fuera de su lugar.

### Dos botones, sin chat y sin RAG

El despacho tenía un chat y un [[rag|RAG]] sobre 30,000 expedientes. La clínica no necesita ninguno. **Sin chat**, porque el uso previsto es fijo y los botones viven dentro del expediente que el médico ya usa: no hay otra aplicación ni otra contraseña. **Sin RAG**, porque no hay nada que buscar: el médico ya eligió al paciente, y el servicio pide **todas sus notas** al expediente por su número. Un índice de vectores de 40,000 pacientes ([RAG privado](/rag-privado/)) sería otra copia de datos sensibles para un problema que esta fase no tiene. Las preguntas sobre los protocolos internos sí serían RAG, y quedan para después.

### El servicio de resumen y su verificador

:::pasos
1. Pedir las notas
Con la sesión del médico, todas las notas del paciente, cada una con su identificador, fecha, hora y autor. Si el médico no puede abrir a ese paciente, no recibe nada.

2. Recortar si no cabe
Si pasan de ≈ 31,000 tokens (≈ 4 % de los expedientes con el supuesto), se quita lo más viejo y el resumen empieza diciendo «no leí las notas anteriores al 3 de marzo».

3. Armar el prompt
Instrucciones fijas (en español, sin abreviaturas; cada frase termina con la cita de su nota; no inferir diagnósticos ni dosis; señalar lo que se contradice) y debajo las notas en orden. Las instrucciones son iguales siempre: el [[prefix-caching|prefix caching]] podría ahorrarse leerlas, aunque con esta arquitectura es experimental en vLLM (el piloto lo mide).

4. Verificar
Antes de mostrar nada, un programa de reglas, sin modelo: cada frase cita una nota que existe; cada dosis (fármaco, número y unidad) y cada alergia aparecen tal cual en la nota citada; no quedan abreviaturas de una lista de los médicos. Lo que no pasa sale **en rojo** y se cuenta.

5. Anotar
La fila del registro, sin texto.
:::

El verificador no hace inteligente al sistema: lo hace **revisable**. Un «ceftriaxona 1 g cada 24 horas» copiado como «cada 12 horas» lo atrapa una regla simple, porque el «12» no está junto a «ceftriaxona» en la nota citada. Lo que **no** atrapa son las omisiones: una alergia que el resumen calla no deja nada que buscar. Para esas está el examen.

### El motor y el gateway

**vLLM 0.34.0** (la versión del despacho), una copia por tarjeta, en FP8 dinámico, con el tope de 32,768 tokens y hasta 8 resúmenes a la vez por copia.

:::profundo El comando, flag por flag
```bash
vllm serve Qwen/Qwen3.8-27B --quantization fp8 --max-model-len 32768 --max-num-seqs 8 \
  --served-model-name resumen --api-key "$VLLM_CLAVE" --enable-prefix-caching \
  --reasoning-parser qwen3 --default-chat-template-kwargs '{"enable_thinking": false}'
```

`--quantization fp8` es el [[fp8-dinamico|FP8 dinámico]]: vLLM convierte los pesos al cargarlos. `--max-num-seqs 8` deja un lugar más que los 7 que sostienen 20 tokens por segundo: en el pico, el octavo va un poco más lento en vez de esperar en la fila. La última línea apaga el razonamiento con `enable_thinking`, el parámetro que da la tarjeta de Qwen3.8 (el mismo flag del despacho). Y sin `--enable-log-requests` (apagado por omisión), vLLM no escribe las peticiones en su log.
:::

**LiteLLM 1.111.0** delante, como en el despacho ([Gateway](/gateway/)): reparte entre las dos copias, saca de la rotación la que no contesta y da una clave al servicio de resumen y otra a la sonda. Una diferencia: **no guarda el texto** de prompts ni respuestas. En su configuración, `store_prompts_in_spend_logs: false` (el valor por omisión) y `turn_off_message_logging: true`; como su interfaz puede pisar el archivo, el piloto revisa la base.

### La noche: observabilidad que no se queda muda

La lección [Observabilidad](/observabilidad/) ya anticipaba a una clínica: de noche, el p95 de una ventana sin resúmenes no existe (`NaN`), y la alerta de TTFT calla justo cuando nadie mira. Cuatro cambios:

:::profundo Las cuatro reglas de la noche

1. **Una [[sonda-sintetica|sonda]] cada minuto**, con el blackbox_exporter como la del despacho, pide el resumen de un **paciente sintético de prueba**, con notas inventadas, y revisa que conteste, que tarde menos de 8 s y que traiga una cita válida. Publica `probe_success` (1 o 0). De noche es la única señal de que el servicio está arriba.
2. **Dos niveles para las copias.** Una caída es nivel «mañana» (`sum(up{job="vllm"}) < 2` durante 2 minutos): la otra aguanta. Las dos caídas, o la sonda fallando 5 minutos (`max_over_time(probe_success{job="sonda-clinica"}[5m]) == 0`), es nivel «ahora»: despierta a la guardia. Y una más, porque una sonda muerta parece un servicio sano: si deja de medir (`absent_over_time(probe_success{job="sonda-clinica"}[3m])`), también es «ahora».
3. **El TTFT, solo con tráfico**: su alerta se evalúa con al menos un resumen por minuto; de noche manda la sonda.
4. **Un correo diario de «sigo vivo»**: el día que no llega, el caído es Prometheus.
:::

Y un panel que el despacho no tenía: **las marcas del verificador por día**. Si suben de un día a otro, algo cambió (el modelo, el formato de las notas) aunque el servicio esté «arriba».

### Seguridad y red

La receta de [Seguridad](/seguridad/), aplicada al hospital:

:::profundo La receta de seguridad, aplicada al hospital

- **Redes que no se tocan**: los equipos médicos en su [[vlan|VLAN]], sin ruta al servidor ni a internet; el servidor en la suya, sin internet; solo el servicio de resumen y la sonda llegan al gateway. Las actualizaciones entran por la [[maquina-puente|máquina puente]].
- **Identidad**: la del expediente, con **segundo factor** para todos (la NOM-024 lo recomienda; la clínica lo exige). El día que un médico externo deja de atender, su cuenta se cierra, y con ella el asistente.
- **Contratos**: confidencialidad firmada por cada médico externo (ley, art. 20); el integrador, como encargado.
- **Cifrado** de los discos ([[cifrado-en-reposo|en reposo]]), con la receta del despacho.
- **Respaldos**: configuración, registro y prompts. **No** los expedientes: tienen su propio respaldo en el SIRES.
- **Mantenimiento**: como una tarjeta aguanta el pico, se actualiza una copia a la vez **a cualquier hora**, sin ventana de madrugada. En el despacho, donde una tarjeta sola queda en el filo de la hora pico, se espera a que pase.
:::

:::diagrama caso-clinica-camino
Toca cada caja para ver qué hace y en qué red está. «Un resumen a las 8:00» sigue a una médica del botón a la tarjeta; «La noche en que falla una tarjeta», al servidor a las 3:10.
:::

**El dictado, para la fase 2.** Whisper large-v3-turbo (MIT, ≈ 6 GB de VRAM) y Qwen3-ASR (Apache 2.0) tienen licencias limpias, pero sus tarjetas advierten que pueden **alucinar** texto, y no hay cifra publicada de su error en español clínico mexicano: un «15» oído como «50» es lo primero que mediría un examen.

## Evals {Evals}

:::intenta ¿Bastan 200 casos para demostrar «a lo más 1 %»?
El criterio de seguridad: **0** dosis inventadas o cambiadas, **0** alergias omitidas y **a lo más 1 %** de resúmenes con una omisión grave. La lección [Demostrar que el modelo abierto sirve](/evals/) da la cota exacta de una cola: si en \(n\) casos no hay ninguna falla, con 95 % de confianza la tasa real es a lo más \(1 − 0.05^{1/n}\) (≈ 3 ÷ \(n\)). Con 200 casos y cero omisiones graves, ¿queda demostrado el 1 %? ¿Cuántos hacen falta?
???
1. Con 200: 1 − 0.05^(1/200) ≈ **1.49 %**. Cero en 200 solo demuestra ≤ 1.49 %.
2. Para bajar a 1 %: \(n\) ≥ ln 0.05 ÷ ln 0.99 ≈ **299**. Con **300**, 0.99 %.
3. Y con 300, **una** omisión grave sube la cota a ≈ 1.57 %: en la práctica, el criterio pide cero.
:::

Por eso la ficha dice 300, no los 200 del despacho. Y las dosis y alergias se cuentan **por mención**: si cada expediente trae, digamos, 4 dosis, son ≈ 1,200 revisadas, y cero cambios en 1,200 demuestran ≤ 0.25 %.

:::formula La cota cuando no hay fallas
p_{max} = 1 − 0.05^{1/n} ≈ frac{3}{n}
- n: casos (o menciones) revisados, sin ninguna falla
- p_{max}: la tasa más alta compatible con haber visto cero, con 95 % de confianza (una cola)
:::

### Un examen sin datos reales

Nadie del proyecto debería leer expedientes reales para armar un examen, y la NOM-004 (5.5) pide autorización escrita para investigación. La salida son [[datos-sinteticos|datos sintéticos]]: un médico escribe el **guion** de un caso en media página; un modelo **Apache 2.0** lo convierte en un expediente de ≈ 5,700 palabras; el médico lo corrige y planta las trampas. ≈ 1 hora por caso, ≈ 300 horas de médico (supuesto). Un cuidado: **no con un candidato que se examina**, ni Qwen3.8 ni MedGemma, porque un examen escrito por un modelo suena a ese modelo y lo favorece (se usa uno fuera de la comparación, como el Qwen3 32B del despacho).

| [[estratificar\|Estrato]] | Casos | Qué mide |
|---|---|---|
| Resumen de hospitalizado | 110 | Problemas activos, tratamiento vigente, pendientes |
| Resumen antes de consulta | 60 | Historia larga, poco de la última visita |
| Borrador de nota de egreso | 50 | Los apartados de la NOM-004, sin abreviaturas |
| Trampas de seguridad | 60 | Una alergia en una nota de hace dos años, una dosis que cambió, dos notas que se contradicen, fármacos de nombre parecido |
| Expedientes largos (> 24,000 tokens) | 20 | Lo del medio ([[lost-in-the-middle]]) y el aviso del recorte |

Cada caso trae su **rúbrica de sí o no** del médico que lo armó: «¿menciona la alergia a la penicilina?», «¿la ceftriaxona es 1 g cada 24 horas?». Lo de seguridad lo califican **dos médicos**, en los 300; lo de forma, un [[llm-as-judge|juez]] local calibrado contra ellos con el [[kappa-de-cohen|κ]]. Cada marca del verificador se revisa a mano.

### El criterio, firmado antes de ver resultados

| Qué | Criterio |
|---|---|
| Dosis inventadas o cambiadas | **0** en todas las menciones |
| Alergias omitidas | **0** |
| Resúmenes con una omisión grave | 0 en 300 (≤ 1 % demostrado) |
| Afirmaciones con [[cita-inventada\|cita inventada]] o sin cita | 0 en las de seguridad; ≤ 2 % en las demás |
| Borradores con todos los apartados | ≥ 95 % |
| TTFT p95 en una prueba de carga abierta a 0.167 por segundo | ≤ 8 s **con una tarjeta apagada** |

La última fila es la que más se olvida: el N+1 es una promesa sobre el día en que algo falla, así que la aceptación se prueba **sacando una tarjeta**.

**Los retadores.** MedGemma se queda solo si baja las omisiones graves de forma que la [[prueba-pareada|prueba pareada]] lo distinga y no falla ninguna de las de cero; si empata, gana Qwen3.8 por su licencia.

**El piloto**: 8 semanas, 15 médicos de dos servicios. Cada resumen lo califica quien lo usó (útil, útil con correcciones, no sirvió), dentro de la clínica y para la misma finalidad; se miden la distribución real de tamaños (los tokens, sin el texto) y las marcas del verificador; y empieza una **auditoría de 100 resúmenes al mes**, al azar, que un médico revisor compara contra el expediente. Es la única forma de ver las omisiones en producción, y sigue después.

## Riesgos {Risks}

:::intenta ¿Qué puede salir mal entre las 21:00 y las 7:00?
De noche hay un médico de guardia, ≈ 50 resúmenes en 10 horas, nadie de TI despierto y un servidor con dos tarjetas. Haz tu lista: al menos cuatro cosas que pueden salir mal **de noche** en particular, y qué reduce cada una.
???
1. **Se cae una tarjeta**: la otra aguanta; alerta de nivel «mañana».
2. **Se cae todo**: el botón dice «el asistente no está disponible», el médico trabaja con el expediente como antes y la sonda despierta a la guardia en 5 minutos.
3. **El médico cansado le cree todo al resumen**: es el [[sesgo-de-automatizacion|sesgo de automatización]], peor de noche. Lo reducen las citas, el rojo del verificador y el aviso de lo que no se leyó.
4. **Se cae el monitoreo** sin que nadie se entere: el correo de «sigo vivo».
5. **Una actualización a las 3:00**: no hay automáticas; todo se actualiza a mano, de día.
:::

:::profundo La tabla de riesgos completa

| Riesgo | Qué pasa | Cómo se reduce | Quién lo vigila |
|---|---|---|---|
| [[sesgo-de-automatizacion\|Sesgo de automatización]] | El médico deja de abrir las notas y firma un error | Cita en cada frase; rojo del verificador; «borrador de IA» visible; auditoría de 100 al mes; capacitación con errores reales del examen | Dirección médica |
| Dosis cambiada | Una indicación equivocada pasa al siguiente turno | Verificador; 0 en el examen; nada de sugerir dosis | Comité de calidad |
| Omisión grave | El resumen calla una alergia o un problema activo | Estrato de trampas; 0 en 300; auditoría; aviso de lo no leído | Médico revisor |
| El dato se escapa por los registros | Un resumen queda en un log de vLLM o de LiteLLM, o en un respaldo | Registro sin texto; revisar en el piloto qué escribe cada pieza; respaldos cifrados | TI, en la revisión anual |
| Médico dado de baja que sigue entrando | Ve expedientes de un hospital donde ya no atiende | El asistente hereda la cuenta del expediente; baja el mismo día | TI y dirección médica |
| Uso fuera de alcance | El asistente se vuelve consejero de diagnóstico | Dos botones; uso previsto escrito; el prompt prohíbe inferir | Dirección médica |
| Caída total de noche | Sin asistente en la guardia | N+1; sonda; guardia en espera; el expediente sigue | Guardia del integrador |
| La Server Edition no llega | Meses de atraso | Cotizar D y E desde el principio | Jefa de TI |
| Cambia la regulación | Reglamento nuevo, regla de dispositivos definitiva, NOM sustituida | Revisión anual con el abogado; uso previsto documentado | Jurídico |
| La licencia | Se adopta MedGemma y Google la termina | Qwen3.8 (Apache 2.0) como base; plan para volver a él | Jurídico y TI |
:::

:::ojo El riesgo que no sale en la tabla
El más probable no es técnico: que el asistente funcione bien y se use para algo que no se examinó. «Ya que resume tan bien, ¿por qué no dice qué estudios faltan?» llegará en el mes tres. Esa función sugiere una acción clínica y cambia la clase en la cuadrícula. Cada función nueva pasa por «Datos de salud» antes de llegar a «Evals».
:::

## Costo {Cost}

:::intenta ¿Cuánto cuesta cada resumen?
De la ficha: el servidor de la opción D cuesta **US$74,779.30** y se deprecia en **36 meses** con **20 %** de reventa. Al mes se suman la luz (≈ **US$149.4**), la obra repartida (**US$90**) y la operación (**US$1,200**: el TI del hospital y una guardia remota en espera). Tipo de cambio: **19.7203**. La clínica hace **31,200** resúmenes al mes (1,200 × 26 días de consulta). ¿Cuánto cuesta al mes en pesos y cuánto cada resumen?
???
1. Depreciación: 74,779.30 × (1 − 0.2) ÷ 36 ≈ **US$1,661.8**.
2. Total: 1,661.8 + 149.4 + 90 + 1,200 ≈ **US$3,101** al mes ≈ **MXN 61,155**.
3. Por resumen: 61,155 ÷ 31,200 ≈ **MXN 1.96**.
4. La [herramienta de TCO con los números de la clínica](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&U=60&r=20&Np=12000&No=600&D=26&G=2&K=17159&Wg=600&S=40461.3&gs=4&V=36&res=0.2&Wb=450&u=0.4&pue=2&kwh=0.11&oe=90&op=1200&tc=19.7203&hr=730) da lo mismo.
:::

:::profundo La cuenta completa del costo de la opción D

La cuenta es la de [TCO: API, nube o servidor propio](/costo-total/):

:::formula El servidor propio al mes
P = frac{K × (1 − s)}{V} + O
- K: la compra del servidor (US$)
- s: el valor de reventa al final, como parte de la compra
- V: la vida útil en que se deprecia, en meses
- O: lo que cuesta tenerlo andando cada mes: luz, obra repartida y personas (US$)
- P: el costo del servidor propio al mes (US$)
:::

:::cuenta Las piezas del costo de la opción D
Depreciación // \(K\) = 74,779.30; \(s\) = 0.2; \(V\) = 36 | 74,779.30 × 0.8 ÷ 36 | US$1,661.8
Luz // 930 W × PUE 2.0 × 730 h ≈ 1,358 kWh a ≈ US$0.11 (supuesto) | 1,358 × 0.11 | US$149.4
Obra de dos circuitos // ≈ MXN 60,000 ÷ 36 ÷ 19.7203 ≈ 84.5, hacia arriba porque la herramienta va de 10 en 10 | redondeado | US$90
Operación // 52 h de TI (MXN 11,341) + guardia en espera (≈ MXN 12,300, supuesto) | (11,341 + 12,300) ÷ 19.7203 ≈ 1,199 | US$1,200
Total, \(P\) | 1,661.8 + 149.4 + 90 + 1,200 | **US$3,101 ≈ MXN 61,155**
= En 36 meses, ≈ US$111,640 (≈ MXN 2.20 millones). La operación es el 39 % del mes.
:::

El precio de la luz es un supuesto: la tarifa GDMTO (la de la CFE para media tensión) de la ficha del despacho, con el cargo por demanda repartido en las 730 horas del mes (≈ $2.08 por kWh ≈ US$0.11), porque un hospital suele estar en media tensión. La de Jalisco no se consultó: la dice el recibo. El [[pue|PUE]] de 2.0 (el cuarto gasta otro tanto en aire y pérdidas) es el del despacho. Y si la demanda se cobrara por el pico (≈ 2.3 kW × 2.0) y no por el promedio, la luz subiría a ≈ US$200.
:::

| Opción | Compra (US$) | Al mes (US$) | Al mes (MXN) | Por resumen (MXN) |
|---|---|---|---|---|
| A) 3 L40S, INT4 | 67,191.30 | 2,923 | 57,640 | 1.85 |
| B) 4 L40S, INT4 | 76,101.30 | 3,143 | 61,988 | 1.99 |
| C) 1 Server Edition | ≈ 57,620 | 2,681 | 52,875 | 1.69 |
| **D) 2 Server Edition** | **≈ 74,779** | **3,101** | **61,155** | **1.96** |
| E) 4 L40S en 2 pares | 76,101.30 | 3,143 | 61,988 | 1.99 |

Entre D y C (sin repuesto) hay **≈ MXN 8,280 al mes**: eso cuesta que el asistente siga vivo la noche en que falle una tarjeta.

**Lo que cuesta la privacidad.** Con el precio de Qwen3 32B en DeepInfra (`apis.json`, 2026-11-25), los ≈ 393 millones de tokens al mes costarían **≈ US$35**: ≈ 88 veces menos. No es opción, pero sirve en la reunión: **la clínica paga ≈ MXN 60,000 al mes por que sus datos no salgan**.

**Lo que mueve el número.** Sin la guardia en espera, solo con las 52 h de TI (≈ US$575), el mes baja a ≈ US$2,476; con una persona despierta 24 × 7, la cuenta de [Cotizar](/cotizar/) da ≈ 4.1 personas y ≈ $483,183 al mes, ocho veces todo el servidor: por eso la disponibilidad la pone el N+1 y las personas quedan en espera. Con la Server Edition a US$13,000, el mes baja a ≈ US$2,916. **No incluye** impuestos, flete ni importación (≈ 7 % más si la clínica importa, lección «Cotizar»), las ≈ 300 horas de médico del examen ni el piloto.

Y un número para el director médico que no es dinero: si cada resumen le ahorra **3 minutos** a un médico (supuesto que el piloto tiene que medir), 1,200 resúmenes son **60 horas de médico al día**.

## La propuesta en una página {The proposal on one page} [extra]

**Lo que hace.** Dos botones dentro del expediente electrónico: «Resumir expediente», con cada frase citada a su nota, y «Borrador de nota de egreso», con los apartados de la NOM-004, que el médico revisa y firma. **No** sugiere diagnósticos, dosis ni prioridades, y no tiene chat.

**Dónde corre.** Un servidor 4U en el cuarto de cómputo del hospital, con **2 × RTX PRO 6000 Blackwell Server Edition**, en una red sin internet: una copia de **Qwen3.8 27B** (Apache 2.0) en FP8 por tarjeta, con vLLM 0.34.0 y LiteLLM. Una tarjeta sola aguanta el pico; la otra es el repuesto. Se cotiza también **4 L40S en 2 pares** como plan B.

**Qué promete.** El primer token en ≤ 8 s en el p95 (≈ 3.7 s simulado con las dos tarjetas, ≈ 4.3 s con una), ≥ 20 tokens por segundo, 24 × 7, y el mismo servicio si falla una tarjeta.

**Cómo se cuidan los datos.** Nada sale de la red. El asistente entra con la sesión del médico y ve lo que él ve. Una fila por resumen, sin texto, 12 meses. El aviso de privacidad lo nombra; médicos externos e integrador firman confidencialidad; el integrador, como encargado. Sin entrenar con expedientes reales.

**Cómo se demuestra.** 300 expedientes sintéticos revisados por médicos: 0 dosis cambiadas, 0 alergias omitidas, 0 omisiones graves. Una prueba de carga con **una tarjeta apagada**. MedGemma 27B y Gemma 4 31B como retadores. Un piloto de 8 semanas con 15 médicos y una auditoría de 100 resúmenes al mes que sigue después.

**Cuánto cuesta.** ≈ US$74,779 de servidor (sin impuestos ni importación) y ≈ **MXN 61,155 al mes**: ≈ **MXN 1.96 por resumen**.

**Lo que se confirma antes de comprar.** Que el expediente tenga una API para leer notas con la sesión del médico; el precio y el plazo de la Server Edition; con el abogado sanitario, el aviso, el contrato con los médicos externos y el uso previsto frente a la regla de dispositivos médicos.

## Errores comunes {Common mistakes}

1. **Creer que MedGemma es Apache 2.0 porque su código lo es.** **Cómo evitarlo:** lee la licencia de los **pesos** en la tarjeta del modelo (lección [Licencias](/licencias/)).
2. **Dimensionar con el tamaño típico y olvidar la cola.** Con 12,000 tokens cualquier tarjeta cumple; el p95 lo deciden los de 30,000. **Cómo evitarlo:** pide el típico **y** el p95, y calcula el TTFT con los dos.
3. **Agregar copias para bajar el TTFT de un expediente largo.** Más copias quitan fila, no aceleran una lectura. **Cómo evitarlo:** separa la espera (se arregla con copias) de la lectura (con una tarjeta más rápida o partiendo el modelo).
4. **Tratar el N+1 como un lujo en un sistema 24 × 7.** **Cómo evitarlo:** prueba la aceptación con una tarjeta apagada.
5. **Guardar el texto de los resúmenes «por si acaso».** Es otra copia de datos sensibles fuera del expediente. **Cómo evitarlo:** una fila sin texto, con la huella.
6. **Abrir un chat «para que sea más útil».** Invita a pedir dosis y cambia la clase del software. **Cómo evitarlo:** funciones fijas con uso previsto escrito; cada función nueva pasa por la revisión regulatoria antes que por el examen.

## Ejercicios {Exercises}

:::ejercicios
? [facil] En el pase de turno de las 21:00 llegan 36 resúmenes en 20 minutos. Cada uno dura ≈ 31.4 s. ¿Cuántos hay abiertos a la vez?
\(λ\) = 36 ÷ 1,200 s = **0.03 por segundo**. Little: 0.03 × 31.39 ≈ **0.94**. La [herramienta de sizing](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=36&r=1&Np=12000&No=600&h=1&pk=3&v=20&P=27.78&A=27.78&Et=2.543&bits=8&L=16&g=4&d=256&q=24&bkv=2) da lo mismo con 36 «personas» de 1 resumen y un pico de 3 en una hora (36 ÷ 3,600 × 3 = 0.03).
? [facil] Un paciente con estancia larga tiene ≈ 8,000 palabras de notas. Con 2.1 tokens por palabra, ¿cabe en el tope de 32,768 tokens con un borrador de 900?
\(N\) = 8,000 × 2.1 = **16,800 tokens**; con la salida, 17,700: **cabe**. El tope alcanza para ≈ 15,000 palabras de notas.
? [facil] El registro guarda una fila de ≈ 1 KB por resumen durante 12 meses. Con 1,200 al día, ¿cuánto disco pide?
1,200 × 365 = **438,000 filas** ≈ **438 MB**. Es una cota alta: los domingos hay menos.
? [medio] Falla una Server Edition a las 7:55. ¿Aguanta la otra el pico de las 8:00?
Lugares: **7** contra ≈ **5.23**: sí. En 20 minutos atiende 7 ÷ 31.39 × 1,200 ≈ **268** contra ≈ **200** que llegan. La simulación da un p95 de ≈ 4.3 s, dentro de los 8.
? [medio] El examen tiene 300 casos y aparece **una** omisión grave. ¿Pasa el criterio de ≤ 1 %? ¿Y 500 casos sin ninguna?
Con 1 en 300, la cota exacta de una cola al 95 % es ≈ **1.57 %**: **no pasa**. Con 0 en 500: 1 − 0.05^(1/500) ≈ **0.60 %**: pasa con margen.
? [medio] Sin torre, la clínica haría ≈ 190 resúmenes al día. Con el servidor de la opción D, ¿cuánto cuesta cada uno?
Al mes, 190 × 26 = **4,940**. El costo es casi todo fijo (≈ MXN 61,155): 61,155 ÷ 4,940 ≈ **MXN 12.38**, ≈ 6 veces más. La [herramienta de TCO](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&U=10&r=19&Np=12000&No=600&D=26&G=2&K=17159&Wg=600&S=40461.3&gs=4&V=36&res=0.2&Wb=450&u=0.4&pue=2&kwh=0.11&oe=90&op=1200&tc=19.7203&hr=730) lo da con 10 «personas» de 19.
? [reto] ¿Con cuántos médicos deja de bastar una sola Server Edition para el pico, y qué pasa con el N+1?
A la vez en el pico: \(c\) = \(U\) × 20 ÷ (8 × 3,600) × 4 × 31.39 ≈ 0.0872 × \(U\). Con 80, ≈ 6.98 ≤ 7; con 81, ≈ 7.06 > 7 (la herramienta de sizing da lo mismo). Desde **81 médicos**, el pico pide dos tarjetas y el N+1 una **tercera**, que cabe en el chasis de 4 ranuras. Conviene dejar escrito hoy en qué número se compra.
? [reto] El director pide el primer token en 2 s en el p95. Con la Server Edition, ¿cuántos tokens de entrada se leen en ≈ 1.8 s (dejando ≈ 0.2 s a la fila y la red)? ¿Qué harías con los expedientes más largos?
Con la fórmula del prefill (27.78 mil millones, 16 bloques, 24 cabezas de 256, 1,000 TFLOPS, \(η_c\) = 0.5), 1.8 s alcanzan para ≈ **15,400 tokens**. Con el supuesto de tamaños, ≈ 30 % de los expedientes pasa de 16,000: no se puede prometer con un solo prompt. Opciones: mostrar primero el resumen de la **estancia actual** y después el del historial; resumir por partes lo largo ([[map-reduce]]) avisando que tarda; o negociar los 2 s solo para el pase de turno. Lo que **no** se hace es prometer 2 s y medirlo con expedientes típicos.
:::

## Qué cambiaría si… {What would change if…} [extra]

**…no hubiera torre.** Con ≈ 190 resúmenes al día, el pico cae a menos de uno a la vez, pero los expedientes largos siguen tardando 10 s en una L40S: el objetivo de 8 s se sigue rompiendo. La decisión no cambia por volumen, cambia por la cola de los tamaños. Lo que sube es el costo por resumen: ≈ MXN 12.38.

**…pidieran sugerir diagnósticos o dosis.** Es otro proyecto: un dispositivo médico de clase III, con registro sanitario y evidencia clínica. Con MedGemma, la licencia se terminaría justo ahí.

**…MedGemma ganara por mucho.** Se adopta con tres cosas por escrito: su política de uso prohibido en el contrato con los médicos, que Google puede terminar la licencia, y que ningún derivado (un afinado de MedGemma, por ejemplo) sale de la clínica sin pasar sus restricciones. Y con un plan para volver a Qwen3.8 en una semana.

**…el objetivo fuera 2 s, como en el despacho.** Ni la Server Edition llega con los largos (3.69 s). El p95 de la entrada tendría que bajar a ≈ 15,000 tokens, mostrando primero el resumen de la estancia actual y después el del historial.

**…fuera un hospital público.** La LFPDPPP no aplica (va la ley de los sujetos obligados), el capítulo de salud digital de la Ley General de Salud sí, y la compra es por licitación (lección «Cotizar»).

### Lo que sigue {What comes next}

El **despacho**, el caso de referencia, decide entre las mismas tarjetas con otro criterio: allá pesaba la pregunta típica con un objetivo de 2 s; aquí, el expediente largo y la noche. Compararlos es la mejor práctica de dimensionar. La **fábrica** cambia otra vez lo que manda: pocos usuarios, una red de planta separada de la de oficina, manuales en varios idiomas con imágenes y la seguridad de quien sigue un procedimiento. Para repasar lo que este caso aplicó: [De requisitos a hardware](/requisitos-hardware/), [Licencias](/licencias/), [Demostrar que el modelo abierto sirve](/evals/) y [Observabilidad](/observabilidad/).

:::conceptos
dato-sensible nom-004 nom-024 nota-de-egreso software-dispositivo-medico licencia-hai-def sesgo-de-automatizacion datos-sinteticos
:::

:::chequeo
? ¿Por qué el asistente no tiene chat?
Porque un cuadro libre invita a pedir diagnósticos o dosis, y eso lo vuelve dispositivo médico (clase III en la regla en consulta). Dos botones fijan el uso previsto.
? ¿Por qué ninguna cantidad de L40S con una copia cada una cumple el TTFT de 8 s?
Porque un expediente de 30,000 tokens tarda ≈ 10.2 s en leerse en una L40S con AWQ, aunque no haya fila. Más copias quitan fila, no aceleran una lectura.
? Si una sola Server Edition aguanta el pico, ¿para qué la segunda?
Para la noche en que falle la primera: es el N+1 de un servicio 24 × 7 sin nadie despierto. Por eso la aceptación se prueba con una tarjeta apagada.
? ¿Qué demuestran 0 omisiones graves en 200 casos?
Solo que la tasa es ≤ 1.49 % al 95 %. Para ≤ 1 % hacen falta 300 sin ninguna.
? ¿Qué guarda la fila del registro y qué no?
Quién, qué paciente (su número), cuándo, qué notas citó, cuánto tardó, la huella y las marcas del verificador. No guarda el texto: es dato sensible y ya vive en el expediente.
? ¿Qué atrapa el verificador y qué no?
Dosis y alergias que no están en la nota citada, citas que no existen y abreviaturas. No atrapa omisiones: para esas están el examen y la auditoría.
:::
