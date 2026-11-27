---
titulo: Dependencia de gobierno
en: Sizing case: a fully air-gapped government agency
subtitulo: Un órgano federal en Pachuca quiere un asistente para su Unidad de Transparencia y su área jurídica en una red sin ningún cable a internet: cómo entra cada pieza en una USB que llevan dos personas, quién inicia sesión sin la nube, por qué el asistente solo propone lo que se testa y cómo se compra el servidor con la Ley de Adquisiciones.
pregunta: «Nuestra red de expedientes no toca internet y así se queda; tenemos 20 días hábiles para contestar cada solicitud»: ¿qué servidor, cómo le metemos el modelo y sus parches, cómo lo compramos por la ley y cuánto cuesta en tres años?
requisitos: recorrido, requisitos-hardware, elegir-modelo, licencias, seguridad, rag-privado, evals, costo-total, cotizar
sensei: privacidad, identidad, cifrado, ataques, tiempo-hash
---

:::idea
Aquí la capacidad casi no pesa: 40 personas usan ≈ 2 conversaciones a la vez y una sola tarjeta sobra. Pesan otras tres cosas. **Todo entra a mano**: modelo, imágenes, paquetes, driver y cada parche cruzan en una USB nueva que llevan dos personas, y un ciclo tarda ≈ 9 días hábiles aunque copiar sea cosa de minutos. **El asistente solo propone**: la ley pone la clasificación en manos de personas y prohíbe clasificar antes de que llegue la solicitud, así que el diseño no guarda ninguna lista de «lo reservado». Y **el servidor se compra con la Ley de Adquisiciones**: el monto del contrato decide el procedimiento, el calendario va de 6 a 9 meses y lo que no se compre ahora espera otra vuelta. Cada paso abre con un ejercicio: inténtalo antes de ver la solución.
:::

## La dependencia y lo que pide {The agency and what it asks for}

### La llamada

Un jueves llama la titular de la Unidad de Transparencia de un órgano federal con sede en Pachuca, Hidalgo: «Tenemos 20 días hábiles por solicitud y cada una trae decenas de oficios que hay que revisar renglón por renglón. Queremos un asistente que busque la norma y nos diga qué partes podrían ser reservadas. Pero nuestra red de expedientes no toca internet, y así se queda».

La dependencia y sus números son ficticios, **supuestos del ejemplo** de una ficha: un órgano desconcentrado de una Secretaría de Estado (depende de ella, con autonomía técnica) que inspecciona a las empresas de un sector y lleva sus procedimientos de sanción. Leyes, montos, versiones y precios van con su fecha y su fuente (las leyes, en su texto vigente del 2026-11-27; DOF es el Diario Oficial de la Federación). Es orientación, no consejo legal: lo confirma el área jurídica.

| Dato | Valor |
|---|---|
| Quién lo usa | 40 personas: 10 de la Unidad de Transparencia, 20 del área jurídica y 10 enlaces de las áreas |
| Lo que pide | 1) borradores de respuesta con su fundamento; 2) proponer qué partes de los documentos de una solicitud podrían ser reservadas o confidenciales; 3) preguntas sobre su normativa, con cita ([[rag\|RAG]]) |
| Solicitudes | ≈ 1,200 al año, ≈ 4.8 por día hábil; cada una trae ≈ 25 documentos de ≈ 8 páginas |
| Uso | 20 preguntas por persona al día y 120 revisiones de documento, de 9:00 a 18:00; pico de 2.5 veces el promedio |
| La red | aislada de verdad: ningún cable a internet ni a la red de oficina |
| TI | 3 personas (2 de redes, 1 de seguridad), nunca han operado una GPU |
| Modelo | Qwen3.8-27B en FP8 ([[apache-2\|Apache 2.0]]), con el razonamiento apagado |

### Por qué sin internet, y de verdad

En los otros casos el servidor «no sale a internet», pero la red sí: el despacho habla con Microsoft para el inicio de sesión y [la fábrica](/casos/fabrica/) actualiza por una [[maquina-puente|máquina puente]] conectada a su DMZ industrial. Aquí la red de expedientes ya está **aislada por regla interna** y el asistente vive dentro de ella. Es [[air-gapped|air-gapped]] en el sentido de [Seguridad](/seguridad/): **ningún cable** y **ninguna conexión lógica automática** (RFC 4949 y NIST), el cuarto grado de su figura, porque los expedientes traen procedimientos en forma de juicio, investigaciones y datos de terceros.

:::ojo La ley de datos no prohíbe la nube
La Ley General de Datos Personales en Posesión de Sujetos Obligados (DOF 20-mar-2025) deja contratar nube con protección equivalente (arts. 57–58). La red aislada es una **decisión de seguridad** de la dependencia; decir «la ley lo prohíbe» se cae con el primer abogado.
:::

### La ley que el asistente ayuda a cumplir

La dependencia es un [[sujeto-obligado|sujeto obligado]] de la **Ley General de Transparencia y Acceso a la Información Pública** (LGTAIP, DOF 20-mar-2025, sin reforma a la fecha). Cualquier persona puede presentar una [[solicitud-de-acceso|solicitud de acceso]], sin decir para qué, y la dependencia tiene **20 días hábiles** para contestar desde el día siguiente (arts. 128 y 134), ampliables 10 con una prórroga que aprueba el [[comite-de-transparencia|Comité de Transparencia]]. Desde 2025 revisa los recursos Transparencia para el Pueblo, de la Secretaría Anticorrupción y Buen Gobierno; el INAI desapareció.

Se entrega lo que **existe** en los archivos (art. 131), pero no todo se muestra:

- La [[informacion-reservada|información reservada]] se oculta hasta 5 años (ampliables 5) porque mostrarla dañaría una inspección, un procedimiento, una investigación o los sistemas del gobierno (art. 112, 17 causales; la VI protege las inspecciones).
- La [[informacion-confidencial|información confidencial]] es de las personas: datos personales y secretos de particulares. No vence (art. 115).
- Lo testado sale en una [[version-publica|versión pública]]: las partes borradas con su fundamento, sin que se puedan recuperar (arts. 120–121).

:::analogia El sobre con fecha
Una información reservada es como un sobre sellado con fecha de apertura: se abre cuando vence el plazo o desaparece la razón.

Dónde se rompe: el sobre se sella una vez. La reserva se decide **cada vez que alguien pregunta**, caso por caso, con una [[prueba-de-dano|prueba de daño]] escrita ese día: ningún asistente puede «saber» de antemano qué está reservado.
:::

De la ley salen dos reglas de diseño que ningún otro caso tiene:

1. **El asistente propone; deciden personas.** La clasificación la hacen las personas titulares de las áreas (art. 102) y el Comité la confirma, modifica o revoca (art. 40); la ley de datos da derecho a oponerse a decisiones automatizadas «sin intervención humana» (art. 41 II). Una persona acepta, corrige o tira cada propuesta, y firma.
2. **No hay lista de «lo reservado».** La ley prohíbe clasificar **antes** de responder una solicitud y por acuerdos generales (art. 102): un asistente que marcara lo reservado de todo el archivo sería ilegal por diseño. Revisa los documentos de **una solicitud concreta**, y sus propuestas se quedan con ella.

## Requisitos y perfil de carga {Requirements and load profile}

Los requisitos funcionales salen de la llamada: contestar sobre la normativa **citando norma y artículo**, revisar los documentos de una solicitud uno por uno proponiendo cada parte que podría testarse con su causal, y **no mostrar nunca lo testado**. Los [[requisito-no-funcional|no funcionales]]: primer token en ≤ 3 s en el p95, ≥ 20 tokens por segundo, 16,384 tokens de contexto, días hábiles de 9:00 a 18:00 y ninguna conexión fuera de la red aislada.

:::nota Por qué 3 s y no 2
El despacho firmó 2 s para 200 abogados al vuelo; aquí son 40 personas contra un plazo de días (supuesto). Los 20 tokens por segundo son los de leer cómodo.
:::

### El perfil de carga

Dos clases de llamadas: **800 preguntas** al día (40 × 20) de ≈ 6,000 tokens de entrada y ≈ 500 de salida, como en el despacho, y **120 revisiones** (4.8 solicitudes × 25 documentos) de ≈ 5,000 y ≈ 600. Pesan casi lo mismo y las herramientas las cuentan juntas: **920 llamadas al día**, 23 por persona, de 6,000 y 500.

:::formula Llegadas en la hora pico y conversaciones a la vez
λ = frac{U × r}{H × 3,600} × k_{pico}
c = λ × (t_{pre} + frac{N_o}{v})
- λ: llamadas por segundo en la hora pico
- U: personas; r: llamadas por persona al día; H: horas del día con tráfico
- k_{pico}: la hora más cargada ÷ el promedio
- c: conversaciones abiertas a la vez, en promedio, en la hora pico ([[ley-de-little|ley de Little]])
- t_{pre}: el [[prefill]] sin fila, en s; N_o: tokens de la respuesta; v: tokens por segundo de cada conversación
:::

:::intenta ¿Cuántas conversaciones hay a la vez en la hora pico?
Con la ficha (40 personas, 23 llamadas al día de 9:00 a 18:00, pico de 2.5, respuestas de 500 tokens a 20 tokens por segundo) y un prefill de 0.68 s, calcula \(λ\) y \(c\). ¿Por qué la ficha diseña la memoria para **4** conversaciones?
???
1. 40 × 23 = 920 llamadas al día; ÷ 9 h ≈ 102 por hora; × 2.5 ≈ **256** en la hora pico, ≈ **0.071 por segundo**.
2. Cada respuesta dura 0.68 + 500 ÷ 20 ≈ 25.7 s. Little: 0.071 × 25.7 ≈ **1.82 conversaciones**.
3. Es un promedio con llegadas al azar, y una revisión larga alarga algunas: 4 es ≈ 2 veces el promedio. Compruébalo en la [herramienta de sizing con la dependencia](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=40&r=23&Np=6000&No=500&h=9&pk=2.5&v=20&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3) (salidas 1 y 2).
:::

:::profundo La cuenta completa del perfil

:::cuenta El perfil de carga de la dependencia
Llamadas al día // \(U × r\): 800 preguntas + 120 revisiones | 40 × 23 | 920
Hora pico // ÷ \(H\) = 9 h, × \(k_{pico}\) = 2.5 | 920 ÷ 9 × 2.5 | ≈ 256 por hora
Llegadas, \(λ\) | 256 ÷ 3,600 | ≈ 0.071 por segundo
Duración de una respuesta // \(t_{pre}\) = 0.68 s + \(N_o ÷ v\) | 0.68 + 500 ÷ 20 | ≈ 25.7 s
Conversaciones a la vez, \(c\) | 0.071 × 25.7 | ≈ 1.82
Tokens de entrada por segundo // \(λ × N_p\) | 0.071 × 6,000 | ≈ 426
= En la hora pico hay ≈ 1.8 conversaciones abiertas y ≈ 426 tokens por leer cada segundo: un tercio de lo del despacho.
:::
:::

**La capacidad no decide nada en este caso**: es un tercio de la carga del despacho.

### El plazo, en días hábiles

La dependencia se pone un **plazo interno** (supuesto) para que la prórroga sea la excepción: el borrador listo el día hábil 12, la revisión del área hasta el 17 y el Comité y la respuesta el 20. El plazo arranca el día **siguiente** y solo cuentan de lunes a viernes, sin los inhábiles que la dependencia publique. Si la solicitud no se entiende, se pide aclararla una sola vez, en 5 días (la **prevención**), y el plazo vuelve a empezar (art. 130).

:::figura caso-gobierno-plazo
Los 20 días hábiles de una solicitud, con el plazo interno de la dependencia. El asistente trabaja en el tramo azul; el amarillo y el verde son de personas que deciden. La prórroga es la excepción.
:::

:::profundo Contar días hábiles, en Python
Contar a mano es donde se cuelan los errores. Este programa lo hace con una solicitud que llega el lunes 7 de junio de 2027:

```python
from datetime import date, timedelta

DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]

def habil(desde, n, inhabiles=()):
    """El día hábil número n, contando desde el día siguiente a `desde`."""
    d, k = desde, 0
    while k < n:
        d += timedelta(days=1)
        if d.weekday() < 5 and d not in inhabiles:   # lunes a viernes, sin los inhábiles
            k += 1
    return d

llega = date(2027, 6, 7)        # la solicitud llega un lunes (supuesto: sin festivos en esas semanas)
for etapa, n in [("borrador listo", 12), ("revisión del área", 17),
                 ("Comité y respuesta", 20), ("tope con prórroga", 30)]:
    d = habil(llega, n)
    print(f"día hábil {n:>2} · {etapa:<19} {DIAS[d.weekday()]} {d:%d/%m/%Y}")
```

```salida
día hábil 12 · borrador listo      mié 23/06/2027
día hábil 17 · revisión del área   mié 30/06/2027
día hábil 20 · Comité y respuesta  lun 05/07/2027
día hábil 30 · tope con prórroga   lun 19/07/2027
```
:::

### Lo que falta preguntar

La hoja de [[descubrimiento]] necesita cinco respuestas que la titular no dio:

- **¿Qué días declara inhábiles?** Mueven cada vencimiento.
- **¿Cuántos documentos trae una solicitud grande?** 25 es un promedio; 400 oficios son otra semana.
- **¿Hay un directorio de cuentas dentro de la red aislada?** Si hay un AD o un LDAP, el inicio de sesión se cuelga de él.
- **¿Cuál es el presupuesto de adquisiciones del año?** Decide cómo se compra.
- **¿Cómo sale hoy una versión pública de la red aislada?** El asistente usa ese camino; no abre otro.

## Cálculos: memoria, velocidad y cuántas GPUs {Calculations: memory, speed and how many GPUs}

El modelo es el de [la fábrica](/casos/fabrica/): Qwen3.8-27B, en el repositorio FP8 oficial (30.88 GB). En las herramientas se escribe con los números de su `config.json` que ya usó esa ficha: 27.78 mil millones de parámetros, 2.543 de tablas de tokens, **16 bloques que guardan [[kv-cache|KV cache]]** (de 64: los demás son capas Gated DeltaNet de estado fijo), 4 juegos de K y V de 256 y 24 cabezas, con 3 GB para el programa.

### ¿Cabe?

La [herramienta de VRAM en una L40S](/herramientas/vram/?P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=16384&u=4&V=l40s&prog=3) da pesos de **30.32 GB**, KV cache de 4 conversaciones de 16,384 tokens de **4.29 GB** (64 KiB por token: una cuarta parte de lo que pide un 32B de atención completa) y 3 GB de programa: **37.62 de 43.2 GB útiles** (87 %), caben 9. En la [RTX PRO 6000 Blackwell Server Edition](/herramientas/vram/?P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=16384&u=4&V=rtx-pro-6000-blackwell-server&prog=3), con 96 GB, ocupa el 44 % y caben **49**.

### ¿Qué tan rápido?

La [herramienta de velocidad](/herramientas/velocidad/?p1=l40s&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&cf=2&Np=6000&No=500&b=4) da en la L40S ≈ **18.9 tokens por segundo** a cada una de 4 conversaciones y un prefill de ≈ 0.93 s. En la [Server Edition](/herramientas/velocidad/?p1=rtx-pro-6000-blackwell-server&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&cf=2&Np=6000&No=500&b=4), ≈ **35.0** y ≈ 0.68 s.

:::intenta ¿Sirve la L40S?
Con esas dos velocidades y la promesa de ≥ 20 tokens por segundo, ¿la L40S cumple? La herramienta de sizing descuenta además el tiempo que cada prefill nuevo le quita al [[decode]] de los demás. ¿Cuántas conversaciones atiende cada tarjeta a 20, y cuántas tarjetas pide el pico de 1.82?
???
1. La L40S ya da menos de 20 **sin** contar los prefills: 18.9 con 4 a la vez. La [sizing con la L40S](/herramientas/sizing/?p1=l40s&U=40&r=23&Np=6000&No=500&h=9&pk=2.5&v=20&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3) da **0 conversaciones** a 20 tokens por segundo: no llega, con ninguna cantidad de tarjetas.
2. La [sizing con la Server Edition](/herramientas/sizing/?p1=rtx-pro-6000-blackwell-server&U=40&r=23&Np=6000&No=500&h=9&pk=2.5&v=20&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3) da **13** por tarjeta: ⌈1.82 ÷ 13⌉ = **1 tarjeta**, con [[holgura]] de ≈ 7.1×.
3. Con la promesa en 15 tokens por segundo, la [L40S atiende 6](/herramientas/sizing/?p1=l40s&U=40&r=23&Np=6000&No=500&h=9&pk=2.5&v=15&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3) y también bastaría una. La promesa decide la tarjeta, no la carga.
:::

Con ρ = λ × t_{pre} = 0.071 × 0.68 ≈ **5 %**, la Server Edition pasa leyendo prompts una vigésima parte del tiempo: la fila casi no existe y el p95 del TTFT queda cerca del prefill, muy debajo de los 3 s. Para la clínica o el despacho la fila decidía la compra; aquí no.

### Un documento a la vez

Qwen3.8-27B acepta 262,144 tokens: tienta meter los ≈ 25 documentos de una solicitud (≈ 100,000 tokens) en una sola llamada. Cabe en la Server Edition, pero **no conviene**: la prueba de daño se hace por documento y por parte, los modelos atienden peor lo que queda a la mitad de un contexto largo ([[lost-in-the-middle]]), y «página 3 del documento» se verifica mientras que «en algún lugar de las 200» no. La revisión va un documento a la vez: ≈ 5,000 tokens, TTFT ≈ [0.57 s](/herramientas/velocidad/?p1=rtx-pro-6000-blackwell-server&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&cf=2&Np=5000&No=600&b=4) y ≈ 18 s para la lista de 600 tokens.

:::profundo ¿Cuánto cuesta leer una solicitud entera de un jalón?

:::intenta Una solicitud de 100,000 tokens en una sola llamada
Con la [herramienta de VRAM](/herramientas/vram/?P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=110000&u=2&V=rtx-pro-6000-blackwell-server&prog=3) y la [de velocidad](/herramientas/velocidad/?p1=rtx-pro-6000-blackwell-server&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&cf=2&Np=100000&No=1500&b=1), con 100,000 tokens de prompt y 1,500 de respuesta: ¿cabe?, ¿cuánto tarda el primer token?, ¿qué le pasa a quien pregunta mientras tanto?
???
1. **Cabe**: cada conversación de 110,000 tokens pide ≈ 7.2 GB de KV cache; en la Server Edition caben 7, en la [L40S](/herramientas/vram/?P=27.78&Et=2.543&bits=8&L=16&g=4&d=256&bkv=2&N=110000&u=1&V=l40s&prog=3) solo 1.
2. **Tarda**: TTFT ≈ **15.0 s** en la Server Edition (≈ 20.5 s en la L40S) y la respuesta completa ≈ 65 s.
3. Mientras lee, la tarjeta tiene poco para los demás: el [[chunked-prefill|chunked prefill]] de vLLM los intercala, pero su escritura se frena. Con 2 tarjetas, una lectura larga se manda a la segunda.
:::

La memoria de sobra de la Server Edition queda para lo raro: un oficio de 60 páginas que sí hay que leer entero.
:::

## La propuesta de hardware {The hardware proposal}

Una tarjeta atiende el pico siete veces: la pregunta es **cuánto repuesto** necesita una red a la que el proveedor no puede entrar.

:::nota Las letras de este caso
A 1 servidor con 2 L40S · B 1 servidor con 2 Server Edition · C 2 servidores como B. Precios sin IVA: B y C de `equipos.json` (Exxact, 2026-11-25; la tarjeta en CDW, 2026-11-26, sin existencias); A del configurador de Exxact (2026-11-25), como en la fábrica. A 19.7203 pesos por dólar (DOF, 27-nov-2026). B es la D del despacho.
:::

| | A · 2 L40S | B · 2 Server Edition | C · 2 servidores B |
|---|---|---|---|
| Lugares a ≥ 20 tokens/s | 0 | 26 (13 por tarjeta) | 52 |
| ¿Cumple la promesa? | No (18.9 tokens/s) | Sí, con 14× de holgura | Sí |
| Si falla una tarjeta | — | 13 lugares: sin cambio | 39 |
| Si falla el servidor | — | sin asistente: la Unidad sigue a mano | el otro atiende todo |
| Lecturas largas de 110,000 tokens | 1 por tarjeta | 7 por tarjeta | 7 por tarjeta |
| Compra, sin IVA | US$58,281 (≈ $1.15 M) | US$74,779 (≈ $1.47 M) | US$149,559 (≈ $2.95 M) |
| Con 3 años de soporte, ¿cómo se compra? | invitación a tres | invitación a tres | licitación |

:::intenta ¿Compras un segundo servidor?
Con la tabla: el proveedor no puede entrar por la red, una tarjeta escasea y cada compra tarda meses. Pero el plazo legal es de 20 días hábiles y el asistente es un apoyo: si no está, la Unidad trabaja como hoy. ¿B o C? Defiéndelo en tres frases.
???
1. **Contra una tarjeta caída, B ya tiene repuesto**: la otra atiende 13 lugares contra 1.82. Es el [[n-mas-1|N+1]] del día a día, y esa segunda tarjeta es también el *staging* de cada actualización (donde lo nuevo se prueba antes de atender).
2. **Contra el servidor caído, C cuesta ≈ US$75,000 más** por una falla rara que no rompe ningún plazo: unos días de borradores a mano caben en 20 días hábiles.
3. **Y C cambia la compra**: pasa de invitación a licitación. Se recomienda **B**, con reemplazo en sitio en el contrato.
:::

### La decisión: B, con el repuesto en el contrato

Se recomienda **B, un servidor con 2 RTX PRO 6000 Server Edition**: el único que cumple los 20 tokens por segundo con este modelo, con memoria de sobra y una segunda tarjeta que es repuesto y staging. Lo que en una red conectada resuelve el acceso remoto, aquí lo resuelve el contrato: **reemplazo en sitio** con refacciones en México y plazo escrito; **la pieza que falla no sale con datos** (un disco cambiado se queda y se destruye con acta); y un **plan de continuidad** de una línea: si el servidor cae, la Unidad trabaja a mano.

:::profundo La especificación por desempeño y la prueba de aceptación
En una compra pública no se pide «una RTX PRO 6000»: la convocatoria no puede exigir una marca determinada salvo casos justificados (Reglamento de la Ley de Adquisiciones, art. 84 fracción V), y justificarla pide demostrar que no hay otra marca que sirva (Ley, art. 54 fracción VIII; Reglamento, art. 109). Lo defendible es pedir **lo que el servidor tiene que hacer** y cómo se va a probar:

- servir el modelo fijado (Qwen3.8-27B en FP8, el commit que se anexa) con 4 conversaciones a la vez a **≥ 20 tokens por segundo** cada una, con prompts de 6,000 tokens;
- TTFT **≤ 3 s en el p95** a 0.071 llamadas por segundo durante una hora, con el guion de [Pruebas de carga](/pruebas-carga/) que se anexa;
- **dos GPUs**, cada una capaz de atender sola esa carga;
- sin ninguna función que requiera conexión al fabricante (licencias que se activan en línea, telemetría obligatoria);
- reemplazo en sitio con plazo escrito y personal que firme la promesa de confidencialidad.

Esa es la [[prueba-en-sitio|prueba en sitio]] de la entrega. La ley le da a la dependencia **hasta 10 días hábiles** para aceptar lo entregado (art. 72): el guion tiene que caber ahí, con el modelo ya cruzado y verificado.
:::

## Cómo entra todo sin internet {How everything gets in without internet}

En el despacho, la puente **empuja** por la red. Aquí no hay cable: la [[estacion-de-entrada|estación de entrada]] es una computadora con internet en otro cuarto donde se baja y se verifica todo; lo que cruza va en un medio que **dos personas** llevan, y lo recibe una **estación de cuarentena**, la única máquina de la red aislada con el puerto USB abierto.

:::diagrama caso-gobierno-entrada
El camino de una pieza, de internet a la tarjeta de producción. Toca cada caja para ver qué se revisa ahí, o usa «Recorrer» para seguir un ciclo normal y el de un medio que no pasa la cuarentena.
:::

### Qué cruza la primera vez

La primera vez cruzan **≈ 45.8 GB**: el modelo en FP8 (30.88 GB), cuatro imágenes (≈ 12.5 GB), los embeddings y el reranker (2.4 GB). Caben en una USB de 64 GB: **un medio por ciclo**, nuevo y cifrado, que no regresa.

:::profundo La lista, pieza por pieza
| Pieza | Tamaño |
|---|---|
| Pesos de Qwen3.8-27B en FP8 (repositorio oficial) | 30.88 GB |
| Imagen de vLLM 0.34.0 | 10.04 GB |
| Imagen de Open WebUI 0.13.5 (completa) | 1.65 GB |
| Imagen de LiteLLM 1.111.0 | 0.71 GB |
| Imagen de Qdrant 1.20.2 | 0.074 GB |
| Qwen3-Embedding-0.6B y Qwen3-Reranker-0.6B | 1.21 GB cada uno |
| **Total**, más lo chico (Keycloak, Prometheus, Grafana, chrony, wheels, driver) | **≈ 45.8 GB** |

Los tamaños de las imágenes son los de [Seguridad](/seguridad/) (noviembre de 2026); el del modelo, el de Hugging Face (2026-11-27).
:::

:::formula El tiempo de un ciclo de entrada
t_{copia} = frac{S}{r}
T = sum_{i} d_i
- t_{copia}: lo que tarda copiar, en s; S: lo que hay que copiar, en bytes; r: la velocidad real de la copia
- T: lo que tarda el ciclo completo, en días hábiles
- d_i: los días hábiles del paso i del procedimiento (solicitud, bajar, grabar, cruzar, staging, ventana)
:::

:::intenta ¿Cuánto tarda un ciclo de entrada?
La primera vez cruzan ≈ 45.8 GB. Copiar va a ≈ 110 MB/s y el SHA-256 a ≈ 1.8 GiB/s (medido en una Mac con los datos en memoria, no en un USB). El procedimiento de la ficha: 2 días hábiles para aprobar la solicitud de cambio, 1 para bajar y verificar, 1 para escanear y grabar, 1 para cruzar y la cuarentena, 2 para staging y examen, y 2 para la ventana. ¿Cuánto tarda cada cosa? ¿Qué parte del ciclo es «de máquina»?
???
1. Copiar: 45,800 ÷ 110 ≈ 416 s ≈ **7 minutos**. La huella: 45.8 × 10⁹ ÷ (1,832 × 2²⁰) ≈ **24 s**.
2. El ciclo: 2 + 1 + 1 + 1 + 2 + 2 = **9 días hábiles**, casi dos semanas; los 3 días naturales de espera desde la publicación corren mientras se aprueba la solicitud.
3. Lo de máquina es ≈ 7.5 minutos de ≈ 72 horas hábiles (9 días de 8 horas de trabajo): **menos de 0.2 %**. El cuello es el procedimiento, y por eso va en el calendario.
:::

:::figura caso-gobierno-ciclo
Dónde se va el tiempo de un ciclo de entrada: nueve días hábiles de procedimiento contra siete minutos de copia, a la misma escala. Abajo, el parche del despacho con su puente conectada.
:::

### El procedimiento

Seis pasos, cada uno con su firma: la **solicitud de cambio**; **bajar y verificar** por [[digest]] y por commit, con huellas, firmas y [[sbom|SBOM]]; **grabar** la USB y firmar el manifiesto con la llave de la dependencia; **cruzar** con dos personas y la [[bitacora-de-medios|bitácora de medios]]; la **cuarentena**, que verifica todo antes de copiar al [[registro-de-contenedores|registro interno]]; y **staging, gate y ventana**.

:::profundo Los seis pasos, en detalle
:::pasos
1. La solicitud de cambio
Qué entra (pieza, versión, digest o commit), por qué y cómo se regresa si falla. La aprueba (decisión del caso, no de la norma) el Titular Institucional en Materia de Ciberseguridad, la persona que cada dependencia designa por la Política General de Ciberseguridad de la Administración Pública Federal (APF), que emitió la Agencia de Transformación Digital y Telecomunicaciones (ATDT) en el DOF del 17-dic-2025.
2. Bajar y verificar, en la estación de entrada
Por [[digest]] las imágenes y por commit los pesos, solo lo publicado hace más de 3 días (la regla de [Seguridad](/seguridad/)). Huellas, firmas con cosign, escaneo y el [[sbom|SBOM]] que pide esa política.
3. Grabar y firmar
El manifiesto (cada archivo con su tamaño y su SHA-256) se firma con la **llave de la dependencia**, que vive solo en la estación de entrada, en un token. Una persona graba la USB nueva y otra la revisa.
4. Cruzar
Las dos llevan el medio al otro cuarto y firman la [[bitacora-de-medios|bitácora de medios]]: qué medio, la huella del manifiesto, quién, a qué hora.
5. La cuarentena
La firma del manifiesto con la llave pública, cada huella recalculada, el escaneo, y solo entonces la copia al [[registro-de-contenedores|registro interno]] y al [[mirror-local|mirror]]. Si algo no coincide, no pasa nada: se anota y el medio se aparta.
6. Staging, el gate y la ventana
La tarjeta 2 corre lo nuevo y pasa el examen de 150; si pasa, entra en la [[ventana-de-mantenimiento|ventana]], una tarjeta a la vez. El medio se destruye y la bitácora lo anota.
:::

:::cuenta Lo que tarda un ciclo, por partes
Lo que cruza, \(S\) // modelo 30.88 + imágenes 12.47 + embeddings y reranker 2.42 | 30.88 + 12.47 + 2.42 | ≈ 45.8 GB
Copiar, \(t_{copia}\) // \(S ÷ r\), con \(r\) = 110 MB/s | 45,800 ÷ 110 | ≈ 416 s ≈ 7 min
Huella SHA-256 // a ≈ 1,832 MiB/s | 45.8 × 10⁹ ÷ (1,832 × 2²⁰) | ≈ 24 s
Procedimiento, \(T\) // solicitud, bajar, grabar, cruzar, staging, ventana | 2 + 1 + 1 + 1 + 2 + 2 | 9 días hábiles
= Copiar y verificar tardan minutos; el ciclo, casi dos semanas. En el despacho, con la puente conectada, un parche de vLLM quedaba en ≈ 4.5 horas.
:::
:::

:::profundo Los comandos, del lado con internet y del aislado (escritos, no ejecutados: se prueban en el piloto)
Las versiones son las del 2026-11-27: cosign 3.1.6, skopeo 1.25.2 (copia imágenes de contenedor entre registros y archivos, sin Docker), `huggingface_hub` 2.5.0. En la estación de entrada:

```bash
# Imágenes: todas las arquitecturas y el mismo digest, a un archivo
skopeo copy --all --preserve-digests docker://docker.io/vllm/vllm-openai@sha256:<digest> oci-archive:/medio/vllm-0.34.0.tar

# Pesos: fijando el commit; con --local-dir crea .cache/huggingface/ con sus metadatos
hf download Qwen/Qwen3.8-27B-FP8 --revision <commit> --local-dir /medio/qwen3.8-27b-fp8

# El manifiesto, firmado con la llave de la dependencia: sin red y sin ningún registro público
openssl dgst -sha256 -sign gobierno.key -out /medio/manifiesto.sig /medio/manifiesto.txt
```

En la estación de cuarentena:

```bash
# ¿Es el manifiesto que firmó la dependencia? Solo la llave pública vive aquí
openssl dgst -sha256 -verify gobierno.pub -signature manifiesto.sig manifiesto.txt   # «Verified OK»
sha256sum -c manifiesto.txt              # cada archivo contra su huella
# --all y --preserve-digests otra vez: sin ellos copia solo la arquitectura de esta máquina y el digest cambia
skopeo copy --all --preserve-digests oci-archive:vllm-0.34.0.tar docker://registro.interno/vllm:0.34.0
```

El digest que reporte el registro interno tiene que ser el mismo que anotó la estación de entrada. La firma y su verificación con `openssl` se probaron con un manifiesto de juguete; los comandos de `skopeo` y `hf` salen de su documentación, sin ejecutar, y se prueban en el piloto.

Por qué el manifiesto no se firma con cosign: cosign 3 usa por omisión la configuración de firma de Sigstore, que registra la firma en su log público (Rekor), y `cosign verify-blob` revisa esa entrada salvo con `--insecure-ignore-tlog` (documentación de cosign 3.1.6 y anuncio de la versión 3, consultados el 2026-11-27). Del lado aislado eso pide una raíz de confianza copiada o apagar la revisión. Para una firma que nunca sale de la dependencia, una llave propia con OpenSSL es más simple.

Hugging Face publica el SHA-256 de cada archivo grande en su API: en el repositorio BF16, en el commit `37561816…` (7-nov-2026), son 32 archivos y 55,586,107,015 bytes; el primero, `model-00001-of-00018.safetensors`, pesa 3,966,730,552 bytes. Los archivos chicos (`config.json`) no traen huella y se leen y se hashean en la estación, como en el despacho. El script que delata un archivo cambiado o un `.py` que nadie pidió es el de [Seguridad](/seguridad/).
:::

Sobre las firmas: sin red, cosign 3.1.6 verifica *keyless* con `--trusted-root`, una [[raiz-de-confianza|raíz de confianza]] copiada de antemano que caduca. Más simple: la firma del autor se verifica **en la estación de entrada**, que tiene red, y adentro solo **la firma propia** del manifiesto.

:::ojo La USB es el vector, no la red
En una red aislada, lo que entra en la mano de alguien es la única puerta. Por eso: medios **nuevos** y de un solo uso, que nunca regresan al lado con internet; todos los puertos USB bloqueados salvo el de la cuarentena; dos personas en cada cruce; y nada de «una USB rápida para pasar un PDF». Un medio que va y viene entre los dos lados convierte el aire en un cable lento.
:::

## El stack: lo que cambia sin internet {The stack: what changes without internet}

El stack es el de las lecciones: [[vllm|vLLM]] 0.34.0, una copia por tarjeta; LiteLLM 1.111.0 como gateway; Open WebUI 0.13.5; Qdrant 1.20.2 con los embeddings y el reranker de 0.6B. Sin internet cambia esto.

### Quién inicia sesión

El despacho entra con su cuenta de Microsoft ([[entra-id|Entra ID]]); aquí no hay a quién preguntarle. Hace falta un [[directorio-local|directorio local]]: el AD o el LDAP que ya tenga la red aislada, o Keycloak 26.8.2 (Apache 2.0, 5-nov-2026), que habla [[oidc|OIDC]] y LDAP; Open WebUI 0.13.5 entra con cualquiera. El segundo factor, con un token físico (supuesto; la política de la ATDT pide MFA proporcional). Sus **grupos** (Unidad, jurídico, cada área) se vuelven los permisos. LiteLLM queda detrás, con una [[clave-de-api|clave]] por aplicación. Lo explica a fondo [Autenticación y permisos](https://sensei.trueml.app/identidad/).

:::profundo Por qué no Llave MX
Llave MX es la identidad digital federal para trámites. Sus lineamientos (DOF 6-feb-2025, art. 29) hablan de **plataformas de trámites, servicios o programas sociales**; un asistente interno no lo es (interpretación del caso, no verificada), y Llave MX vive en internet.
:::

### La hora

Los servidores toman la hora de internet sin que nadie lo note. Sin internet, cada reloj se desvía por su cuenta y fallan los certificados internos, los tokens de inicio de sesión (que vencen por hora) y el orden de las bitácoras. Hacen falta **dos [[servidor-de-hora|servidores de hora]] propios**, con chrony en modo huérfano: sirven hora sin referencia y se ponen de acuerdo entre sí; la hora inicial se pone a mano contra un reloj de referencia. Por qué la hora y las huellas importan tanto, en [Tiempo, hashes e identificadores](https://sensei.trueml.app/tiempo-hash/).

:::profundo Lo que falla con dos relojes distintos

:::intenta Un reloj 8 minutos adelantado
Keycloak emite un token de inicio de sesión que vale 5 minutos (supuesto) y su servidor va 8 minutos adelantado contra el de Open WebUI. ¿Qué ve la abogada al entrar? ¿Y la bitácora de una revisión?
???
1. Para Open WebUI, el token **fue emitido en el futuro**: según cómo lo revise, lo rechaza o le da una vigencia equivocada. La abogada ve un error que nadie entiende.
2. La bitácora mezcla dos relojes: la revisión «empieza» después de terminar. En un documento de archivo es un problema de prueba, no de estética.
:::

La configuración de chrony: `local stratum 8 orphan` en los dos, y cada uno consulta al otro. El *stratum* dice a cuántos pasos está un reloj de una fuente real; 8 es «lejos», para que cualquier fuente mejor le gane. Un receptor GPS (`refclock` de chrony) daría una referencia real, pero es un equipo más que aprobar.
:::

### La telemetría: la prueba es otra

En el despacho la prueba de que nada sale era el firewall en «negar y registrar». Aquí **no hay ruta**: el servidor de modelos no tiene puerta de enlace. La prueba es más dura: **cero paquetes** hacia fuera de la red aislada, revisado en el switch. Las variables que apagan la [[telemetria|telemetría]] se ponen igual (la tabla de [Seguridad](/seguridad/)): sin ruta, cada intento es un error en la bitácora, y si un día alguien conecta un cable por error, no sale nada.

:::profundo La marca de Open WebUI
Open WebUI 0.13.5 tiene licencia propia («Open WebUI License»: las tres cláusulas de BSD-3 y una cuarta): **no se puede quitar ni cambiar su marca** salvo con ≤ 50 usuarios en 30 días, permiso escrito o licencia enterprise (`LICENSE`, 2026-11-27; la tabla de licencias de [Gateway](/gateway/) ya la señala). Con 40 personas, la dependencia puede poner su imagen institucional; con más de 50, no.
:::

Las métricas se quedan adentro: Prometheus y Grafana viven **dentro** de la red aislada, con una pantalla en el cuarto de TI. Un [[diodo-de-datos|diodo de datos]] mandaría las métricas afuera en un solo sentido, pero es una conexión física automática: ya no sería air gap en sentido estricto (NIST SP 800-82r3). En la primera fase, no.

### El RAG: qué entra al índice y qué no

El índice tiene **≈ 180,000 páginas** (supuesto): ≈ 4,000 normas internas y ≈ 6,000 respuestas anteriores **en su versión pública**, ocho veces menos que el despacho. Dos reglas nuevas:

1. **Los documentos de cada solicitud no entran al índice.** Si entraran, el índice sería una copia buscable de todo lo pedido, con sus partes reservadas, al alcance de la pregunta de otra persona.
2. **El índice solo guarda versiones públicas.** Aunque la búsqueda trajera el fragmento equivocado, no trae nada que no se haya entregado ya. Los permisos por área ([[acl-por-chunk|ACL por fragmento]]) quedan para la normativa interna.

:::diagrama caso-gobierno-solicitud
Una solicitud de acceso con el asistente, del día 0 al 20. Usa «Recorrer»: el asistente propone parte por parte, la titular del área decide, el Comité confirma y solo la versión pública sale de la red aislada.
:::

:::profundo Lo que se guarda, lo que se testa y la evaluación de impacto
**La versión pública** se hace quitando del archivo lo testado: un rectángulo negro dibujado sobre un PDF, con el texto debajo, se puede copiar (la ley pide un método que no permita recuperarlo, art. 121). El asistente nunca muestra, cita ni resume lo que se testó: el gate del examen lo revisa.

**Lo que se conserva.** Por la Ley General de Archivos (DOF 15-jun-2018, última reforma 14-nov-2025), todo acto en ejercicio de funciones se documenta y se conserva con su plazo (arts. 7, 20–21 y 37). La lectura del caso, no revisada por un abogado: el borrador del asistente no es documento de archivo hasta que una persona lo adopta; la **bitácora de uso** (quién revisó qué documento de qué solicitud) y la **bitácora de medios** sí, con el plazo que fije el catálogo de disposición documental de la dependencia. Esa ley todavía nombra al INAI (art. 38); el transitorio cuarto de la LGTAIP dice que esas menciones se entienden hechas a quien heredó la función.

**La evaluación de impacto.** El asistente lee datos personales de terceros, a veces [[dato-sensible|sensibles]]. La ley pide una [[evaluacion-de-impacto|evaluación de impacto en la protección de datos]] para lo que, a juicio de la dependencia, sea un tratamiento «intensivo o relevante», y lo describe con riesgos inherentes, datos sensibles y transferencias (LGPDPPSO arts. 68–69). El caso decide hacerla: la dependencia la presenta ante la Secretaría Anticorrupción y Buen Gobierno o la autoridad garante que le toque (art. 68); la autoridad responde con recomendaciones no vinculantes en ≤ 30 días. Va junto al documento de seguridad del art. 29, que se actualiza con este sistema. Son 30 días más en el calendario, y se piden en paralelo a la compra.

**Quién toca lo reservado.** Si hay información de seguridad nacional, quien acceda a ella, incluido el proveedor que da soporte, firma por escrito una promesa de confidencialidad que dura aun después del cargo (Ley de Seguridad Nacional, art. 53). Esa ley no trae un estándar técnico para redes aisladas, y no se encontró uno público.
:::

## La compra pública {Public procurement}

Una empresa compra con una orden de compra. La dependencia compra con la **Ley de Adquisiciones, Arrendamientos y Servicios del Sector Público** (LAASSP, DOF 16-abr-2025, sin reforma; su Reglamento nuevo es del DOF 18-dic-2025, reformado el 27-mar-2026). [Cotizar](/cotizar/) adelantó sus plazos de pago; aquí va lo que cambia la propuesta.

### Tres maneras de comprar

- La [[licitacion-publica|licitación pública]] es la **regla general** (art. 35): convocatoria abierta en la Plataforma Digital de Contrataciones Públicas y gana la mejor evaluada.
- La [[invitacion-a-tres|invitación a cuando menos tres personas]] es una excepción: se invita a tres o más y se piden tres propuestas evaluables (art. 56).
- La [[adjudicacion-directa|adjudicación directa]], la más estrecha: sin concurso, por monto bajo o supuestos tasados (art. 54). Una red aislada no es por sí misma una excepción.

Por monto (art. 55), las dos excepciones se permiten si **cada operación** cabe en los montos del Anexo 9 del Presupuesto de Egresos (PEF 2026, DOF 21-nov-2025, sin IVA), sin [[fraccionamiento|fraccionar]] y sin pasar en el año de 30 % del presupuesto de adquisiciones. Los montos dependen de ese presupuesto; el de la dependencia es de **50 a 100 millones** (supuesto):

| Presupuesto de adquisiciones del año | Adjudicación directa, hasta | Invitación a tres, hasta |
|---|---|---|
| de 30 a 50 millones | $376,000 | $2,983,000 |
| **de 50 a 100 millones** | **$391,000** | **$3,264,000** |
| de 100 a 150 millones | $492,000 | $4,351,000 |
| más de 1,500 millones (el tramo más alto) | $1,145,000 | $16,086,000 |

:::formula El monto de la operación
M = n × K × (1 + s × a) × t
- M: el monto de la operación, en pesos sin IVA: lo que se compara con el Anexo 9
- n: servidores; K: el precio de cada uno, en dólares
- s: el soporte al año, como parte del precio del equipo (supuesto: 0.10)
- a: años de soporte en el mismo contrato; t: el tipo de cambio
:::

:::intenta ¿Qué procedimiento toca?
Con la tabla, la opción B (1 servidor de US$74,779.28) con 3 años de soporte a 10 % al año, a 19.7203 pesos por dólar: ¿cabe en adjudicación directa? ¿En invitación? ¿Y la C, con 2 servidores? ¿Qué pasa si separas el soporte en otro contrato?
???
1. B: 74,779.28 × 19.7203 ≈ $1,474,670 de equipo; × (1 + 0.10 × 3) ≈ **$1,917,071**. Pasa los $391,000 de la directa y cabe en los $3,264,000 de la invitación.
2. C: el doble, ≈ **$3,834,142**: pasa la invitación. **Licitación.**
3. Los 2 servidores solos (≈ $2,949,340) cabrían en invitación. Pero si el soporte se pide aparte **para eso**, es fraccionamiento: el monto que cuenta es el de la necesidad completa. Pruébalo en la calculadora de abajo.
:::

:::calculadora caso-gobierno-compra
Arranca con la opción B en el tramo de la dependencia. Sube a 2 servidores, cambia el tramo, o baja el soporte a 0 años para ver por qué separarlo es tentador y prohibido.
:::

**El segundo servidor no solo duplica el precio: cambia el procedimiento.** Que B quepa en invitación no obliga a usarla: la dependencia puede licitar. Si licita, lo probable es **internacional**: la nacional pide ≥ 65 % de contenido nacional (art. 39, con excepciones que fija la Secretaría) y un servidor con GPU importado no llega. Antes de convocar, la [[atdt|ATDT]] dictamina las contrataciones de TIC (sus umbrales no se verificaron).

### El calendario

La ley fija pocos plazos: proposiciones a ≥ 20 días naturales de la convocatoria en una licitación internacional (art. 42) o ≥ 5 en una invitación (art. 56), aceptación en ≤ 10 días hábiles (art. 72) y pago en ≤ 17 días hábiles (art. 73). Lo largo es la preparación, el fallo (quién gana) y la entrega de una tarjeta escasa.

:::figura caso-gobierno-compra
El calendario de la compra, del requerimiento al pago: los tramos de la ley son cortos; lo largo es la preparación y la entrega. Lo que no se compre en esta vuelta espera otra.
:::

**Del requerimiento al pago: ≈ 6 a 9 meses** (estimación del caso, no un dato). Tres consecuencias para la propuesta:

1. **Lo que se compra, se compra ahora**: una tarjeta «después» es otra vuelta de meses; el repuesto se decide en la primera compra.
2. **El precio en dólares no aguanta 9 meses**: el proveedor cotiza con su riesgo de tipo de cambio.
3. **El piloto con datos reales espera al servidor.**

:::profundo Anticipo, garantías y el dictamen de TIC
**Anticipo y garantías.** El anticipo no pasa de 50 % del monto (art. 66 fracción IX) y se garantiza por el 100 % del anticipo (art. 69; Reglamento art. 13). La [[garantia-de-cumplimiento|garantía de cumplimiento]] la fija el titular de la dependencia: el porcentaje **no está** en la Ley ni en el Reglamento, y no se escribe uno de memoria; en una compra por monto (art. 55), quien firma el contrato puede exceptuarla (art. 69). En un contrato de varios ejercicios (los 3 años de soporte), la garantía se renueva cada año en los primeros 10 días naturales (Reglamento art. 132), y el contrato necesita el compromiso presupuestal de cada año. Las penas por atraso no pasan de la garantía (art. 75). El proveedor tiene que presentar su opinión positiva de cumplimiento fiscal (art. 40).

**El dictamen de TIC.** La [[atdt|ATDT]] (Secretaría de Estado desde el 28-nov-2024) define la política digital y de ciberseguridad de la APF y dictamina sus contrataciones de tecnología; en enero de 2026 anunció su esquema de dictaminación, con ahorros reportados de $2,900 millones en 2025 (fuente secundaria). **Los umbrales y reglas del dictamen no se verificaron** para este caso: el calendario le deja semanas, y la dependencia lo confirma con su área de TIC. Su Política General de Ciberseguridad (DOF 17-dic-2025) sí está publicada y le pega a la propuesta: inventario de activos por criticidad, SBOM de lo propio y de terceros, respaldos inmutables y fuera de línea (la regla 3-2-1-1-0: 3 copias, en 2 medios, 1 fuera del sitio, 1 inmutable o desconectada y 0 errores al restaurar), cifrado con gestión soberana de llaves, Zero Trust (nada se confía por estar dentro de la red), MFA y un eje de cadena de suministro con requisitos contractuales para proveedores.

**Arriba de 5,000,000 UMA** (la Unidad de Medida y Actualización, la unidad en que las leyes fijan montos: $117.31 diarios desde el 1-feb-2026, INEGI; ≈ $586.6 millones) la licitación lleva testigo social (art. 38). No es el caso, pero explica por qué las compras grandes tardan más.
:::

### El soporte sin acceso remoto

Todo soporte es **en sitio**: el proveedor no puede entrar por la red, así que el contrato fija el plazo de llegada y el reemplazo de piezas.

:::profundo Lo que va en el contrato de soporte
[Cotizar](/cotizar/) armó el soporte del despacho con una VPN del cliente y la cuenta del proveedor desactivada por omisión. Aquí **todo soporte es en sitio**: plazo de llegada por gravedad y reemplazo de tarjeta, fuente y discos; el técnico entra acompañado y **sin conectar su laptop**; un diagnóstico que pida el fabricante sale, si sale, por el procedimiento de salida y revisado; y la promesa de confidencialidad firmada si toca información de seguridad nacional. No hay precio público de un soporte así: la ficha supone **10 % del equipo al año**, ≈ US$7,478.
:::

### La licencia del modelo, para un gobierno

**Llama 3.3 70B queda fuera** por su [[politica-de-uso|política de uso]], y Qwen3.8-27B es Apache 2.0 sin política aparte. [Licencias](/licencias/) ya separó las permisivas de las propias; aquí, lo que pesa para un gobierno.

:::profundo Por qué no Llama, y el origen del modelo

- **Llama 3.3 70B.** Entre las actividades con riesgo de muerte o daño físico que su política de uso prohíbe están las militares, de guerra, nucleares y de espionaje, y la operación de infraestructura crítica (leída el 2026-11-27), y es [[modelo-gated|gated]]. Una dependencia que inspecciona a un sector puede rozar esas palabras sin hacer nada de eso, y quien interpreta la política es Meta, no la dependencia. Teniendo modelos Apache 2.0, no hay por qué correr ese riesgo contractual.
- **Qwen3.8-27B es Apache 2.0 sin política aparte** y no es gated (Hugging Face, 2026-11-27). Es de Alibaba, una empresa china, y **no se encontró ninguna norma federal mexicana vigente que regule el origen de un modelo open weight** (búsqueda en el DOF y en la ATDT, 2026-11-27). Los pesos son `safetensors` (datos, no código), el servidor no tiene red y las huellas se verifican. Si el comité de TIC prefiere otro origen, gpt-oss-120b (OpenAI) o Gemma 4 31B (Google), Apache 2.0, con otra tabla de memoria (de Gemma 4 queda la duda de si su página de usos prohibidos le aplica). Es decisión de la dependencia, y así se escribe.
:::

## Evals y riesgos {Evals and risks}

El [[eval|examen]] lo escribe el área jurídica: **150 preguntas** (supuesto). 120 de normativa, con su respuesta y su [[cita]], y 30 **casos de clasificación** de resoluciones pasadas del Comité: los documentos de una solicitud y lo que el Comité confirmó que se testaba, ≈ 120 partes. Es la respuesta correcta que ya firmaron personas.

### El criterio, firmado antes de ver resultados

1. **≥ 102 de 120** de normativa bien, con la cita correcta (85 %).
2. **0** partes sin proponer en los 30 casos. Proponer de más se tolera (la persona la tira); de menos, no.
3. **0** respuestas que muestren, citen o resuman algo testado.

:::intenta ¿Qué demuestran 0 omisiones en 120 partes?
El examen sale perfecto: ninguna de las ≈ 120 partes testadas se quedó sin proponer. Con la regla de tres de [Evals](/evals/) (con 0 fallas en n intentos, la cota de 95 % es ≈ 3 ÷ n), ¿qué tasa de omisión puedes descartar? ¿Basta para quitar la revisión humana?
???
1. 3 ÷ 120 = **2.5 %**: con 95 % de confianza, la omisión real está debajo de 2.5 %, pero podría ser 1 de cada 50.
2. Con ≈ 4 partes por solicitud y 1,200 solicitudes al año, 2 % serían ≈ 96 partes al año sin proponer. **No basta**: la persona titular del área revisa siempre. El asistente le ahorra la búsqueda, no la responsabilidad, y así lo dice la ley (art. 102 de la LGTAIP).
:::

El riesgo de fondo es el [[sesgo-de-automatizacion|sesgo de automatización]]: con un asistente que acierta casi siempre, la persona deja de leer. Por eso la pantalla muestra cada documento con sus marcas y pide decidir una por una.

### El juez, sin la nube

Sin internet no hay juez en la nube. Con **código** se califica que la cita exista, que la propuesta señale un renglón real y que la respuesta no contenga ninguna cadena de lo testado. Lo que pide criterio (¿la causal es la correcta?) lo califica un [[llm-as-judge|juez]] local con rúbrica de sí o no, el mismo Qwen3.8-27B con otro prompt, **calibrado** contra 2 abogados en 50 respuestas con la [[kappa-de-cohen|kappa de Cohen]] de [Evals](/evals/). Corre en la tarjeta 2 en cada ciclo de entrada: es el [[gate-de-calidad|gate]] de cada cambio.

### El piloto, en dos fases

El servidor llega a los ≈ 7–8 meses y lo reservado no puede ir a una GPU rentada. El piloto se parte:

| Fase | Con qué | Lo que mide | Lo que decide |
|---|---|---|---|
| 1 · antes de la compra | Información **ya pública** en una G4 de Google Cloud (una Server Edition), ≈ 160 h, ≈ US$720 | Las 120 de normativa y el prefill de 6,000 tokens | La especificación y la prueba de aceptación |
| 2 · ya dentro | El servidor propio, 6 semanas, 10 personas | Los 30 casos; cuántas propuestas se aceptan sin cambio; el primer ciclo de entrada | Si pasa a las 40 personas |

### Riesgos

| Riesgo | Qué pasa | Cómo se reduce | Quién lo vigila |
|---|---|---|---|
| La respuesta revela información reservada | Sale un dato que no debía | Solo propone; las solicitudes no entran al índice; el índice guarda versiones públicas; el gate busca lo testado | Unidad y Comité |
| Se clasifica «por adelantado» | Una lista de lo reservado: ilegal (art. 102) y una mina para quien la encuentre | Sin listas: cada propuesta vive con su solicitud | Área jurídica |
| Una USB trae algo | Malware dentro de la red aislada | Medios nuevos de un solo uso, puertos bloqueados, dos personas, firma propia y huellas recalculadas | Titular de ciberseguridad |
| El modelo y el stack se quedan viejos | Avisos sin aplicar | Ciclos mensual, trimestral y semestral; inventario contra los avisos | TI y titular de ciberseguridad |
| El proveedor no puede entrar | Una falla tarda días | La segunda tarjeta; reemplazo en sitio con plazo en el contrato | TI y adquisiciones |
| La compra se atrasa o queda desierta | Meses sin servidor | Varios proveedores en la investigación de mercado; especificación por desempeño | Adquisiciones |
| Se aceptan propuestas sin leer | La omisión del asistente se vuelve la de la dependencia | Una decisión por marca; medir en el piloto cuántas se aceptan sin cambio | Titular de la Unidad |

## Costo: tres años y la compra {Cost: three years and the purchase}

:::formula El costo al mes del servidor propio
P = frac{K × (1 − v_r)}{V} + L_{kWh} + O_{esp} + H
- P: el servidor propio al mes, en US$
- K: la compra; v_r: la reventa al final, como parte de K; V: la vida en meses (36)
- L_{kWh}: la luz al mes; O_{esp}: espacio, red y soporte al mes; H: las personas que lo operan
:::

Contra el despacho cambian tres supuestos: **sin reventa** (\(v_r\) = 0, supuesto: una dependencia no revende como una empresa, da de baja sus bienes con su propio procedimiento), **el soporte en cada mes** (US$623) y **más TI** (≈ 60 horas al mes: cada parche es un ciclo de entrada).

:::profundo De dónde salen las ≈ 60 horas de TI
:::formula Las horas de TI al mes
H = sum_{i} f_i × h_i + H_{urg} + H_{op}
- H: horas de TI al mes; f_i: ciclos al mes de la tarea i; h_i: horas de un ciclo
- H_{urg}: horas al mes reservadas para urgencias; H_{op}: la operación de todos los días
:::

:::cuenta Las horas de TI de la dependencia
Sistema y firmas del antivirus // mensual, 6 h (dos personas) | 1 × 6 | 6 h
Stack: vLLM, LiteLLM, Open WebUI, Qdrant, Keycloak // trimestral, 24 h | 24 ÷ 3 | 8 h
Modelo // semestral, 30 h con el examen | 30 ÷ 6 | 5 h
Bitácora de medios // mensual | 1 × 2 | 2 h
Urgencias, \(H_{urg}\) // un aviso grave al semestre × 16 h | 16 ÷ 6 | ≈ 2.7 h
Operación, \(H_{op}\) // cuentas, respaldos, tablero, usuarios: lo del despacho fuera de los parches | 52 − 16 | 36 h
Total, \(H\) | 6 + 8 + 5 + 2 + 2.7 + 36 | ≈ 60 h ≈ MXN 13,086 ≈ US$664
= ≈ 60 horas al mes entre 3 personas, a MXN 218.1 la hora (la del despacho). Los ciclos son supuestos que el primer año mide.
:::
:::

:::intenta ¿Cuánto cuesta B al mes y cada llamada?
Con la compra de B (US$74,779.28), sin reventa, a 36 meses; luz de 2 tarjetas de 600 W al 30 % y 450 W del resto, PUE 2, US$0.08 por kWh; US$823 de espacio y soporte (200 + 623) y US$664 de TI: ¿cuánto al mes, en dólares y en pesos, y cuánto cada una de las 19,320 llamadas del mes?
???
1. Depreciación: 74,779.28 ÷ 36 ≈ **US$2,077**.
2. Luz: (2 × 600 × 0.3 + 450) W = 0.81 kW × 2 × 730 h × 0.08 ≈ **US$95**.
3. Al mes: 2,077 + 95 + 823 + 664 ≈ **US$3,659** ≈ **MXN 72,153**; ÷ 19,320 ≈ **MXN 3.73 por llamada**. Ábrelo en la [herramienta de TCO con B](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&U=40&r=23&Np=6000&No=500&D=21&G=2&K=17158.99&gs=4&S=40461.3&V=36&res=0&Wg=600&Wb=450&u=0.3&pue=2&kwh=0.08&oe=823&op=664&tc=19.7203&hr=730).
:::

:::cuenta El costo de B: al mes y en tres años
Compra, \(K\) // chasis Exxact US$40,461.30 + 2 × US$17,158.99 | 40,461.30 + 34,317.98 | ≈ US$74,779
Depreciación // \(K × (1 − v_r) ÷ V\), sin reventa | 74,779 × 1 ÷ 36 | ≈ US$2,077
Luz, \(L_{kWh}\) // (2 × 600 W × 0.3 + 450 W) × PUE 2 × 730 h × US$0.08 | 0.81 × 2 × 730 × 0.08 | ≈ US$95
Espacio y soporte, \(O_{esp}\) // 200 (supuesto) + 7,478 ÷ 12 | 200 + 623 | ≈ US$823
TI, \(H\) // 60 h × MXN 218.1 ÷ 19.7203 | 13,086 ÷ 19.7203 | ≈ US$664
Al mes, \(P\) | 2,077 + 95 + 823 + 664 | **≈ US$3,659** ≈ MXN 72,153
Por llamada // 19,320 al mes | 72,153 ÷ 19,320 | ≈ MXN 3.73
TCO de 36 meses | 3,659 × 36 | ≈ US$131,717 ≈ MXN 2.60 millones
Decidir y comprar // piloto público 720 + examen ≈ 75 h (829) + licitación ≈ 160 h (1,770) | 720 + 829 + 1,770 | ≈ US$3,319
= Tres años con todo: ≈ US$135,036, ≈ **MXN 2.66 millones** sin IVA. Cada llamada sale ≈ 4 veces más cara que en el despacho (MXN 3.73 contra 0.88), por la misma razón que en la fábrica: un servidor completo para poca gente.
:::

| | A · 2 L40S | B · 2 Server Edition | C · 2 servidores |
|---|---|---|---|
| Al mes (herramienta de TCO) | [US$3,183](/herramientas/tco/?p1=l40s&U=40&r=23&Np=6000&No=500&D=21&G=2&K=8910&gs=4&S=40461.3&V=36&res=0&Wg=350&Wb=450&u=0.3&pue=2&kwh=0.08&oe=823&op=664&tc=19.7203&hr=730) | [US$3,659](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&U=40&r=23&Np=6000&No=500&D=21&G=2&K=17158.99&gs=4&S=40461.3&V=36&res=0&Wg=600&Wb=450&u=0.3&pue=2&kwh=0.08&oe=823&op=664&tc=19.7203&hr=730) | [US$6,454](/herramientas/tco/?p1=rtx-pro-6000-blackwell-server&U=40&r=23&Np=6000&No=500&D=21&G=4&K=17158.99&gs=2&S=40461.3&V=36&res=0&Wg=600&Wb=450&u=0.3&pue=2&kwh=0.08&oe=1446&op=664&tc=19.7203&hr=730) |
| Por llamada | MXN 3.25 | MXN 3.73 | MXN 6.59 |
| ¿Cumple 20 tokens/s? | No | Sí | Sí |

A cuesta ≈ US$476 menos al mes y no cumple; C cuesta ≈ US$2,795 más por una falla que no rompe plazos. **B cumple al menor costo.**

:::profundo Sin IVA, y el IVA aquí sí es costo
Todo va sin IVA, como el Anexo 9. Con la tasa general de 16 % (la que usa la ficha del despacho), la compra y los 3 años de soporte suben ≈ US$15,554 (≈ MXN 306,731). Una empresa lo acredita ([[iva-acreditable|IVA acreditable]]); la dependencia, en principio, no (supuesto: lo confirma su área de finanzas), así que para ella es costo.
:::

La herramienta dice también lo que costaría la API: **≈ US$12 al mes**, unas 300 veces menos, y no es opción: la red aislada no tiene salida. Los MXN 2.66 millones se comparan con lo que cuesta hoy revisar a mano ≈ 30,000 documentos al año.

## La propuesta en una página {The one-page proposal} [extra]

Todo lo de arriba, en lo que la titular firma y manda a su área de adquisiciones.

| | |
|---|---|
| **El problema** | 1,200 solicitudes al año con ≈ 25 documentos cada una, 20 días hábiles por ley, y una red de expedientes que no toca internet. |
| **Lo que se propone** | Un asistente en la red aislada que contesta sobre la normativa con cita y **propone** qué partes de cada documento podrían testarse, con causal, fundamento y borrador de prueba de daño. Decide la persona titular del área; confirma el Comité. |
| **El servidor** | B: 1 servidor de 4U con 2 RTX PRO 6000 Server Edition (≈ US$74,779, ≈ $1.47 millones sin IVA, estimado): cumple 20 tokens por segundo con 14× de holgura; la segunda tarjeta es repuesto y staging. |
| **Cómo se compra** | Equipo y 3 años de soporte en una operación (≈ $1.92 millones sin IVA): cabe en invitación a cuando menos tres en el tramo de la dependencia; se puede licitar (lo probable, internacional). Especificación por desempeño y prueba de aceptación en ≤ 10 días hábiles. ≈ 6 a 9 meses del requerimiento al pago. |
| **Cómo entra todo** | Estación de entrada sin cable a la red aislada, USB nueva por ciclo, dos personas, bitácora, firma propia del manifiesto y cuarentena. ≈ 9 días hábiles por ciclo. |
| **Identidad y hora** | Directorio local (Keycloak o el AD de la red) con segundo factor; dos servidores de hora propios. |
| **Cómo se sabe que funciona** | Examen de 150 del área jurídica: ≥ 102 de 120 con cita, 0 omisiones y 0 fugas de lo testado; piloto en dos fases. |
| **Costo** | ≈ US$3,659 al mes (≈ MXN 72 mil), ≈ MXN 3.73 por llamada; ≈ MXN 2.66 millones en 3 años con la compra y el piloto, sin IVA. |
| **No incluye** | IVA; el dictamen de TIC; la evaluación de impacto; escribir el examen (≈ 75 h del área jurídica); diodo de datos. |
| **Riesgos** | Una fuga de lo reservado, la USB como vector, el proveedor sin acceso, una compra que se atrasa. |

## Errores comunes {Common mistakes}

1. **Llamar «air-gapped» a una red con una puente conectada.** La fábrica no lo es y no lo dice; esta dependencia sí. **Cómo evitarlo:** si hay un cable, aunque sea a una DMZ, di «sin salida» y explica el cable.
2. **Una USB que va y viene.** El mismo medio que cruza hacia adentro y regresa a la estación con internet es un cable lento. **Cómo evitarlo:** medios nuevos por ciclo, que no regresan, y una bitácora con dos firmas.
3. **Un asistente que «marca lo reservado» de todo el archivo.** La ley prohíbe clasificar antes de la solicitud (art. 102), y la lista sería el blanco perfecto. **Cómo evitarlo:** se revisan los documentos de una solicitud concreta y las propuestas viven con ella.
4. **Partir el contrato para que quepa.** Equipo por un lado y soporte por otro para bajar de licitación a invitación es fraccionamiento. **Cómo evitarlo:** el monto es el de la necesidad completa; si no cabe, se licita.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Una solicitud llega el miércoles 9 de junio de 2027. Sin festivos, ¿qué día vence el plazo de 20 días hábiles?
Desde el jueves 10: 10 y 11 son 2; tres semanas (14 de junio a 2 de julio), 17; 5, 6 y 7 de julio, **20**. Vence el **miércoles 7 de julio de 2027** (`habil(date(2027, 6, 9), 20)` da lo mismo).
? [facil] La dependencia tiene un presupuesto de adquisiciones de 120 millones. ¿Qué procedimiento toca a B y a C con 3 años de soporte?
Tramo de 100 a 150 millones: directa hasta $492,000, invitación hasta $4,351,000. B (≈ $1,917,071) y C (≈ $3,834,142) caben en **invitación**; C con ≈ $516,858 de margen. Compruébalo en la calculadora del caso.
? [medio] La dependencia quiere su imagen institucional en Open WebUI y planea 70 usuarios en el segundo año. ¿Qué le dices?
Con 70 usuarios, la licencia de Open WebUI 0.13.5 ya no deja cambiar la marca sin permiso escrito o licencia enterprise. Opciones: dejar la marca, pedir el permiso, pagar o una pantalla propia sobre la misma API. Se decide antes del segundo año: la licencia es otra compra.
? [medio] En el piloto, de 120 partes testadas por el Comité, el asistente propuso 117 y además 25 que el Comité no testó. ¿Pasa el criterio? ¿Qué miras?
**No pasa**: hubo 3 omisiones. Las 25 de más no reprueban, pero cuestan revisión. Se leen las 3: si son del mismo tipo (nombres en tablas escaneadas), el arreglo está en la lectura del documento, no en el modelo.
? [reto] Un aviso grave de vLLM sale un lunes a las 9:00. Con el procedimiento de la ficha y una vía urgente (solicitud aprobada el mismo día, sin la espera de 3 días, staging de 1 día y ventana esa noche), ¿cuándo queda instalado? ¿Qué arriesgas al saltar la espera?
Solicitud, bajar, grabar y cruzar, medio día cada uno (lunes y martes), staging el miércoles y ventana esa noche: **miércoles en la noche**, ≈ 3 días hábiles contra 9. Sin la espera pierdes la protección contra una versión comprometida por horas (las de LiteLLM de 2026); si el aviso no es alcanzable desde la red aislada, se espera al ciclo normal.
? [reto] El comité de TIC pide evitar un modelo de origen chino. Con gpt-oss-120b (116.8 mil millones de parámetros totales, siempre razona), ¿qué cambia en la propuesta? Di qué tendrías que calcular, sin calcularlo.
1) Memoria: a 4 bits exactos, 116.8 × 4 ÷ 8 ≈ 58 GB de pesos: no cabe en una L40S y en la Server Edition deja menos KV cache (herramienta de VRAM con su `config.json`). 2) Velocidad: es una mezcla de expertos, y cada token lee sus parámetros activos (herramienta de velocidad). 3) Razonar siempre alarga \(N_o\), y con él \(c\) y el costo por llamada. 4) El examen se repite. La licencia no cambia.
:::

## Qué cambiaría si… {What would change if…} [extra]

**…la dependencia aceptara 15 tokens por segundo.** La [L40S atiende 6 conversaciones](/herramientas/sizing/?p1=l40s&U=40&r=23&Np=6000&No=500&h=9&pk=2.5&v=15&P=27.78&A=27.78&Et=2.543&L=16&g=4&d=256&q=24&bits=8&prog=3) y A cumple: ≈ US$16,500 menos de compra y ≈ US$476 menos al mes. Pero las lecturas largas quedan en 1 por tarjeta. Si el área jurídica nunca lee oficios de 60 páginas enteros, es una buena opción.

**…quisieran indexar el acervo de 600,000 oficios.** Ya no sería un índice de versiones públicas: sería una copia buscable de todo el archivo, con sus partes reservadas. Pediría permisos por expediente, una revisión jurídica de si buscar en todo sirve para la búsqueda «exhaustiva y razonable» que pide la ley sin volverse clasificación previa, y ≈ 11 veces más ingesta. Es una segunda fase con su propia evaluación de impacto.

**…pudieran poner un diodo de datos.** Las métricas llegarían al centro de monitoreo de la oficina sin abrir un camino de regreso. Pero la red ya no sería air-gapped en sentido estricto: tendría una conexión física automática. Se compra con su propio procedimiento y su precio no está verificado.

**…compraran una tarjeta de repuesto en vez de un segundo servidor.** Con US$17,159 más (≈ $338,000 sin IVA), una Server Edition en el almacén acorta el reemplazo de días a horas, y la operación B más la tarjeta (≈ $2.36 millones con 3 años de soporte, que también cubre la tarjeta) seguiría en invitación. Si el proveedor no garantiza el plazo de reemplazo en sitio, es la mejor compra.

### Lo que sigue

Este caso usó [Seguridad](/seguridad/) llevada al detalle de una red sin ningún cable; [Cotizar](/cotizar/) y [Licencias](/licencias/), vistos desde una compra pública; [Requisitos de hardware](/requisitos-hardware/) y las herramientas, para mostrar que la capacidad no decidía; [RAG privado](/rag-privado/), con un índice de versiones públicas; [Evals](/evals/), con un juez local y una regla de cero omisiones; y [TCO](/costo-total/), sin reventa y con el soporte adentro. En Sensei, [Autenticación y permisos](https://sensei.trueml.app/identidad/), [Cifrado, llaves y certificados](https://sensei.trueml.app/cifrado/) y [Ataques y cadena de suministro](https://sensei.trueml.app/ataques/).

El siguiente caso hace lo contrario: un servidor que no es de un solo dueño. Una startup que corre su propio modelo para decenas de clientes, cada uno con sus documentos, sobre las mismas tarjetas.

:::conceptos
sujeto-obligado solicitud-de-acceso unidad-de-transparencia comite-de-transparencia informacion-reservada informacion-confidencial prueba-de-dano version-publica licitacion-publica invitacion-a-tres adjudicacion-directa fraccionamiento atdt garantia-de-cumplimiento estacion-de-entrada bitacora-de-medios raiz-de-confianza servidor-de-hora directorio-local evaluacion-de-impacto
:::

:::chequeo
? ¿Por qué la dependencia sí es air-gapped y la fábrica no?
Porque entre la red aislada de la dependencia y cualquier otra no hay ningún cable ni conexión automática: todo cruza en una USB que llevan dos personas. La fábrica actualiza por una máquina puente conectada a su DMZ industrial.
? ¿Por qué el asistente no guarda una lista de lo reservado?
Porque la Ley General de Transparencia prohíbe clasificar antes de dar respuesta a una solicitud y por acuerdos generales (art. 102): la reserva se decide caso por caso, con prueba de daño. El asistente revisa los documentos de una solicitud y sus propuestas se quedan con ella.
? Si copiar 46 GB tarda 7 minutos, ¿por qué un ciclo tarda 9 días hábiles?
Porque el tiempo es del procedimiento: aprobar el cambio, verificar, escanear, grabar, cruzar con dos personas, la cuarentena, el staging con el examen y la ventana. Lo de máquina es menos de 0.2 %.
? ¿Por qué B y no un segundo servidor?
Porque la segunda tarjeta de B ya cubre la falla común (atiende sola 13 contra 1.82) y es el staging; un segundo servidor duplica la compra por una falla rara que no rompe un plazo de 20 días hábiles, y además lleva el contrato a licitación.
? ¿Qué es fraccionar, con este servidor?
Partir la operación (equipo y soporte) en contratos más chicos para que cada uno quepa en invitación o adjudicación directa. La Ley de Adquisiciones lo prohíbe: el monto es el de la necesidad completa.
? ¿Por qué se descarta Llama 3.3 70B?
Porque su política de uso prohíbe, entre las actividades con riesgo de muerte o daño físico, las militares, de espionaje y la operación de infraestructura crítica, y es gated. Con modelos Apache 2.0 sin política aparte, una dependencia del Estado no tiene por qué correr ese riesgo.
? ¿Qué demuestran 0 omisiones en 120 partes testadas?
Que con 95 % de confianza la omisión es menor que ≈ 2.5 % (la regla de tres), no que sea cero. Por eso la persona titular del área revisa siempre.
:::
