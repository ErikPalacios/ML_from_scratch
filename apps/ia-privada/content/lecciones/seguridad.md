---
titulo: Seguridad: aislamiento, sin internet y actualizaciones
en: Security: isolation, no internet and updates
subtitulo: Qué tiene que ser verdad en la red, en el servidor y en el software para que ningún expediente salga del despacho, cómo se instala y se actualiza todo sin internet, y qué se hace cuando sale una vulnerabilidad un viernes.
pregunta: El despacho prometió a sus clientes que ningún expediente sale de su red. ¿Qué tiene que ser verdad en la red, en el servidor y en el software para que esa promesa se cumpla, cómo se instala y se actualiza todo si el servidor no puede salir a internet, y qué se hace cuando sale una vulnerabilidad en vLLM un viernes?
sensei: ataques, cifrado, identidad, privacidad, redes-nube
dojo: entrega
---

:::idea
«Ningún expediente sale de la red» no lo cumple una contraseña: lo cumple la **forma de la red**. El servidor de modelos vive en una zona sin ruta a internet, solo el gateway y la búsqueda llegan a él, y todo lo que entra (imágenes, pesos, parches) cruza por una sola puerta, una [[maquina-puente|máquina puente]], fijado por su huella y probado contra el examen antes de tocar producción. Las actualizaciones no son un evento: son un ciclo mensual con una ventana, una réplica a la vez, y un atajo para el día en que un aviso sí es grave y sí es alcanzable.
:::

## Una promesa que se cumple con la red {A promise kept by the network}

Esta lección sigue a un ejemplo ficticio, **el despacho**: un despacho de abogados en la Ciudad de México que quiere preguntarle a sus expedientes con un LLM sin que un solo documento salga de su red. Lo usan **200 personas**, sobre **30,000 expedientes**. El modelo es Qwen3 32B en INT4 de [[awq|AWQ]], servido con [[vllm|vLLM]] 0.34.0 en **3 L40S**, una [[replica|réplica]] en cada una, dentro de un servidor Exxact 4U con la cuarta ranura libre. Delante va un [[gateway-de-llm|gateway]]: LiteLLM 1.111.0 y Open WebUI 0.13.5, con el inicio de sesión único de Microsoft ([[sso|SSO]] con [[entra-id|Entra ID]]). La búsqueda usa Qdrant 1.20.2 y un modelo de embeddings local. Su equipo de TI son **2 personas** que saben de redes y de Windows y nunca han operado una GPU.

La razón del proyecto está en su ficha: **secreto profesional**, datos personales protegidos por la ley, y clientes que **prohíben por contrato** mandar sus documentos a servicios de fuera. Hoy algunos abogados pegan contratos en chatbots públicos (el [[shadow-ai|shadow AI]] de [El recorrido](/recorrido/)). Si el servidor propio también deja salir cosas, el proyecto no sirvió.

### Lo que ya sabes de Sensei

- [Ataques y cadena de suministro](https://sensei.trueml.app/ataques/): la **superficie de ataque** (todo lo que un atacante puede tocar), la **defensa en profundidad** (varias capas, para que una sola falla no baste), que un archivo pickle puede correr código y safetensors no, y la cadena de suministro: fijar con hash, SBOM, escaneo y firma con cosign.
- [Cifrado, llaves y certificados](https://sensei.trueml.app/cifrado/), [Autenticación y permisos](https://sensei.trueml.app/identidad/) y [Datos personales y la ley](https://sensei.trueml.app/privacidad/): TLS, cifrado en reposo en la nube, quién eres contra qué puedes hacer, y la ley mexicana de 2025.
- [Redes en la nube: VPC, subredes y egress](https://sensei.trueml.app/redes-nube/): redes privadas, grupos de seguridad y lo que sale a internet, en una nube.

### Lo que cambia con hardware propio

En la nube, red privada, firewall y llaves los da el proveedor con un clic. En el cuarto del despacho, la red es un switch con VLANs, el firewall es un aparato con reglas que alguien escribe, la llave del disco vive en el servidor y los parches no llegan solos. Y hay algo que la nube casi nunca pide: **instalar sin internet**.

Aquí se cierra lo que otras lecciones dejaron pendiente: las puertas de red del gateway ([Gateway](/gateway/)), de Qdrant ([RAG privado](/rag-privado/)) y de los modelos, sin ruta a internet ([Agentes](/agentes/)); la máquina del examen sin salida ([Evals](/evals/)); el [[bmc|BMC]] y el [[colocation|colocation]] ([El cuarto](/el-cuarto/)); y la flecha de «actualizaciones» de [El recorrido](/recorrido/), convertida en un procedimiento con horas.

## El modelo de amenazas del despacho {The despacho's threat model}

Un [[modelo-de-amenazas|modelo de amenazas]] (*threat model*) es una lista honesta de **quién** podría querer hacerte daño, **qué** querría, **por dónde** entraría y **qué capa** lo frena. Sirve para gastar el esfuerzo donde está el riesgo y no en lo que suena peligroso. Sensei da la versión general en [Ataques y cadena de suministro](https://sensei.trueml.app/ataques/); aquí va la del despacho.

:::analogia El plano de seguridad de una joyería
Antes de comprar cámaras, el dueño de una joyería se pregunta quién entraría (un ladrón, un empleado, el de la limpieza), por dónde, y qué frena a cada uno. La caja fuerte frena al ladrón, no al empleado que sabe la combinación: a ese lo frena el inventario diario.

Dónde se rompe: los ladrones de joyas no se multiplican. Una falla de software publicada un viernes la prueba el sábado un programa automático contra todo lo que encuentre abierto. El plano se revisa cada vez que cambia el software.
:::

| Quién | Qué querría | Por dónde entraría | Qué lo frena |
|---|---|---|---|
| **Alguien de fuera** | Los expedientes, o cifrarlos y pedir rescate | Un puerto expuesto (el BMC, un puerto que Docker abrió sin avisar), una falla del inicio de sesión, una laptop con malware dentro de la oficina | Nada publicado a internet; zonas; firewall de entrada **y de salida**; parches |
| **Un empleado curioso** | El expediente de un cliente que no le toca | Su propia cuenta en Open WebUI; su laptop, que está en la red | La [[acl-por-chunk\|ACL de cada chunk]] y la [[muralla-etica\|muralla ética]]; su laptop no alcanza ni vLLM ni Qdrant; el [[registro-de-auditoria\|registro]] |
| **Un proveedor** | Nada malo, en principio: el integrador, el soporte remoto, el colocation, Microsoft, y los autores del software | Acceso remoto, el rack, **una actualización comprometida** | Acceso que abre el cliente cada vez; imágenes fijadas, con espera y probadas; servidor sin salida |
| **Un contrato envenenado** | Que el modelo copie datos hacia afuera | Texto escondido en un documento ([[inyeccion-indirecta\|inyección indirecta]]) | Tools de solo lectura ([Agentes](/agentes/)) y, sobre todo, **ninguna ruta a internet** desde los modelos: no hay a dónde mandar nada |
| **Un robo o un disco devuelto** | El disco | Físico: el cuarto, una garantía, el colocation | Cifrado en reposo |

La fila del proveedor no es exagerada. En 2026, LiteLLM, el gateway del despacho, publicó **dos veces** versiones con código malicioso en sus canales oficiales (marzo y octubre; los ves en la sección de firmas). Nadie tuvo que entrar a la red: la red bajó el paquete sola.

Dos conclusiones ordenan el resto de la lección:

1. **Casi todo lo grave exige llegar a un puerto.** Si una laptop no tiene camino hasta vLLM, una falla de vLLM no es alcanzable desde ella. La forma de la red es la primera defensa.
2. **Lo que no puede salir no se puede robar por la red.** Sin ruta a internet, una intrusión se vuelve un problema de quien está **dentro**, una lista mucho más corta que «cualquiera en internet».

## Zonas: quién puede hablar con quién {Zones: who may talk to whom}

El [[aislamiento]] (*isolation*) es dejar que cada pieza hable **solo** con lo que necesita para trabajar. En una red se logra con [[segmentacion-de-red|segmentación]]: partir la red en zonas y poner entre ellas un firewall con reglas que dicen qué conversación sí y cuál no. Sin segmentación, la red de una oficina es plana: cualquier laptop alcanza cualquier máquina.

### VLANs: varias redes en el mismo switch

Una [[vlan|VLAN]] (*virtual LAN*) es una red separada que vive dentro del mismo switch físico: dos equipos en VLANs distintas no se ven, aunque estén conectados al mismo aparato. Para pasar de una a otra, el tráfico cruza un **router o firewall**, y ahí se aplican las reglas. El TI del despacho ya lo hace con las redes de invitados y de impresoras.

:::analogia Los pisos de un edificio con un solo elevador
Las VLANs son pisos del mismo edificio: comparten estructura (el switch), y de un piso a otro solo se llega por el elevador (el firewall), con un guardia y una lista.

Dónde se rompe: **un equipo con dos cables**, uno en cada VLAN, es una escalera que el guardia no ve. Por eso cada máquina va en una sola zona, salvo el firewall.
:::

### Las zonas del despacho

El despacho reparte sus máquinas en cinco zonas. La decisión que más simplifica: el **servidor de GPUs solo corre modelos y Qdrant**, y lo que habla con personas o con Microsoft (Open WebUI, LiteLLM, la búsqueda, el servidor del agente, la máquina del examen) va en **otra máquina**, de CPU, o una máquina virtual en un equipo que ya tienen. Así, «el servidor de modelos no sale a internet» es una regla del firewall que el TI puede leer.

:::diagrama seguridad-zonas
Las cinco zonas del despacho y lo único que puede hablar con qué. Toca cada caja para ver su regla, o sigue los recorridos: una pregunta, un inicio de sesión, una noche de mantenimiento y lo que no debe pasar nunca.
:::

| Desde | Hacia | Puerto | Para qué |
|---|---|---|---|
| Oficina (laptops) | Open WebUI | 443 | El chat, con HTTPS |
| Open WebUI | LiteLLM | 4000 | Las rutas `/v1` del gateway |
| Open WebUI | `login.microsoftonline.com` (y `graph.microsoft.com` si pide foto o grupos) | 443 | El SSO: una de las dos salidas a internet |
| Alertmanager (gestión, el que manda las [[alerta\|alertas]]) | El correo de Microsoft 365 | 587 (o 25, según el método) | Las alertas al TI: la otra salida |
| Servicio de búsqueda | Qdrant; LiteLLM (embeddings); el reranker | 6333; 4000; el del reranker | Buscar con la identidad de quien pregunta |
| LiteLLM | Las 3 copias de vLLM y el de embeddings | 8000…; 8001 | Solo desde la IP del gateway |
| [[prometheus\|Prometheus]] (gestión) | El `/metrics` de cada pieza | El de cada una | Leer métricas |
| Admin (gestión, por VPN) | BMC, SSH de cada servidor | 22 y el del BMC | Administrar |
| Puente | Registro local (gestión) | 443 | Empujar imágenes **ya verificadas** |
| Zona de modelos | Registro local | 443 | Bajar las imágenes fijadas |
| **Todo lo demás** | — | — | **Negado y registrado** |

Una regla se lee en el sentido de quien **abre** la conexión; la respuesta regresa por la misma, porque el firewall recuerda las conexiones abiertas (*stateful*). «El servidor de modelos no sale» quiere decir que no puede **abrir** una conexión hacia afuera; contestarle a LiteLLM sí puede.

### Dos candados para «sin ruta»

1. **El firewall** de la zona de modelos niega toda salida, salvo hacia el registro local.
2. **El servidor no tiene puerta de enlace** (*default gateway*): su tabla de rutas solo conoce las redes del despacho. Un programa que intente llegar a internet recibe «red inalcanzable» antes de que el paquete salga de la tarjeta.

:::ojo Docker y el firewall del sistema
Si el TI configura `ufw` (el firewall sencillo de Ubuntu) y levanta un contenedor con `-p 8000:8000`, el puerto **queda abierto** aunque `ufw` diga negar: la documentación de Docker dice que los dos usan las reglas de formas incompatibles. Remedio: publica cada puerto **en una sola IP** (`-p 10.0.30.10:8000:8000`) y deja que decida el firewall **de la red**, que Docker no toca.
:::

:::profundo Si todo vive en un solo servidor
Hay despachos que no quieren otra máquina. Entonces las zonas se arman dentro del servidor con redes de Docker. Una red creada con `docker network create --internal` deja que sus contenedores se hablen entre sí, pero **con ninguna otra red**: no tiene ruta por omisión, y Docker descarta el tráfico hacia afuera. vLLM, Qdrant y el de embeddings van en una red interna; LiteLLM y Open WebUI en dos redes, la interna y la de servicio. Funciona, pero las reglas viven en archivos de Docker que el TI no está acostumbrado a leer, y un `-p` de más rompe la zona sin que nadie lo note. Por eso el despacho prefiere dos cajas.
:::

## Las puertas que vienen abiertas de fábrica {Doors that ship open}

El software de servidor viene listo para probarse en una laptop en cinco minutos: escucha en todas las interfaces, sin contraseña, y a veces llama a casa. Esto trae cada pieza del despacho a noviembre de 2026, según el código o la documentación de su versión:

:::figura seguridad-fabrica
Seis piezas del despacho, cómo vienen de fábrica y cómo quedan. Naranja: lo que trae por omisión; verde: lo que decide el despacho.
:::

### vLLM: la llave no basta

**vLLM 0.34.0 escucha en todas las interfaces por omisión**: sin `--host`, abre el puerto 8000 en `0.0.0.0` (todas las tarjetas de red). Ya sabes por [Gateway](/gateway/) que su `--api-key` solo cubre `/v1`, `/v2`, `/inference` y `/cohere`, y deja sin llave `/invocations`, `/metrics`, `/tokenize`, `/pause` y otras. Su documentación de seguridad agrega dos cosas:

- **`torch.distributed` es inseguro por omisión.** Es la biblioteca con que vLLM coordina sus procesos. Cuando arranca por TCP, abre un puerto de control en todas las interfaces, **aun en una sola máquina**, sin autorización ni cifrado. La regla de la documentación: bloquear todo lo entrante salvo el puerto de la API, y fijar `VLLM_HOST_IP` (la IP por la que se hablan los procesos de vLLM) a una IP concreta.
- **La llave se puede esquivar.** La CVE-2026-48746 (crítica, 9.1 de 10): con un encabezado `Host:` manipulado se usaba la API **sin** `--api-key`, de la 0.3.0 a la 0.21; se arregló en la 0.22.0. La llave es una capa más; la defensa es que **nadie más que el gateway llegue al puerto**.

Una [[cve|CVE]] (*Common Vulnerabilities and Exposures*) es el número público de una falla de seguridad conocida, con su descripción, las versiones que afecta y su severidad. Muchos proyectos publican primero un aviso en GitHub, con un identificador **GHSA**, y la CVE llega después. La severidad se da con **CVSS**, de 0 a 10: qué tan fácil es explotarla y cuánto daño hace. Un 9.1 es crítico, pero el número no sabe si **tu** puerto es alcanzable. Eso lo sabe tu modelo de amenazas.

### Las demás

- **Qdrant 1.20.2**: en `0.0.0.0`, en el 6333 (HTTP) y el 6334 (gRPC), **sin llave** (viene comentada), con CORS abierto (cualquier página web abierta en un navegador de la oficina puede llamarlo) y telemetría prendida; su documentación admite que no es seguro por omisión. El despacho ya decidió en [RAG privado](/rag-privado/): llave de administración, **llave de solo lectura** para la búsqueda, TLS y el puerto 6333 solo para la búsqueda y la ingesta; el 6334, cerrado si nadie lo usa. Y prende su registro de auditoría (desde la 1.17, apagado por omisión).
- **[[prometheus|Prometheus]]**: sin `--web.config.file` no tiene **ninguna** autenticación (y la que se prende con él, su documentación la llama experimental). Va en gestión, donde la oficina no llega ([Observabilidad](/observabilidad/) dice qué mide).
- **Open WebUI 0.13.5**: telemetría apagada de fábrica, pero su imagen **corre como root** (el usuario con todos los permisos): su Dockerfile trae `UID=0`. Para que no, la imagen se arma en la puente con `--build-arg UID=… --build-arg GID=…` distintos de 0. La tocan las 200 laptops: es la pieza más expuesta.
- **LiteLLM 1.111.0**: al arrancar **baja un archivo de GitHub** (su catálogo de precios de modelos) si no le dices que no. Se apaga en la siguiente sección.
- **El BMC**: ya lo cerró [El cuarto](/el-cuarto/). No sabemos qué BMC trae el Exxact; la contraseña de fábrica se cambia el primer día, venga el que venga.

:::profundo Así se ve en la configuración
Un fragmento de cómo arranca la zona de modelos, con lo de esta sección y la siguiente. Es ilustrativo: los nombres, las IPs y el digest (abreviado) son del ejemplo.

```yaml
# Ilustrativo (Docker Compose), servidor de GPUs, VLAN de modelos 10.0.30.0/24
services:
  vllm-1:
    image: registro.despacho.local/vllm/vllm-openai@sha256:20fdb089…   # por digest, del registro local
    ports: ["10.0.30.10:8000:8000"]          # solo en la IP de la zona, nunca en todas
    volumes: ["/modelos/qwen3-32b-awq:/modelos/qwen3-32b-awq:ro"]
    environment:
      HF_HUB_OFFLINE: "1"                     # ninguna llamada al Hub de Hugging Face
      VLLM_NO_USAGE_STATS: "1"                # sin telemetría de uso
      DO_NOT_TRACK: "1"
      VLLM_HOST_IP: "10.0.30.10"
    command: ["/modelos/qwen3-32b-awq", "--served-model-name", "qwen3-32b",
              "--max-model-len", "8192", "--max-num-seqs", "8", "--api-key", "${VLLM_CLAVE}"]
```

Tres detalles. El modelo se sirve **desde una carpeta local** de solo lectura, no por su nombre en Hugging Face: vLLM no tiene a quién preguntarle nada. La imagen va **por digest** (la huella, en la sección de la puente). Y `trust_remote_code` (la opción que deja correr el código Python que venga en la carpeta del modelo) no aparece porque viene apagado y no hace falta: los tres modelos de Qwen traen solo `.safetensors` y configuración, ningún archivo de código.
:::

## La salida: negar todo, salvo lo que tiene nombre {Egress: deny everything except what is named}

Un [[firewall-de-salida|firewall de salida]] (*egress firewall*) es el conjunto de reglas que decide qué conexiones pueden **abrir hacia afuera** las máquinas de una zona. La regla del despacho es **negar por omisión** (*default deny*): nada sale, y cada excepción lleva nombre, puerto y razón. «Todo sale salvo lo prohibido» obliga a adivinar todo lo malo; negar por omisión solo obliga a saber lo bueno.

### La excepción honesta: el inicio de sesión

¿Puede el despacho tener **cero** salidas? No, si los abogados entran con su cuenta de Microsoft. Al iniciar sesión, el navegador va a Microsoft y regresa con un código; luego **el servidor de Open WebUI** cambia ese código por un token con `login.microsoftonline.com`, y por omisión pide la foto a `graph.microsoft.com`. Cómo funciona [[oidc|OIDC]] por dentro lo explica [Autenticación y permisos](https://sensei.trueml.app/identidad/).

La conclusión: **el SSO necesita salida desde Open WebUI hacia Microsoft, no desde el servidor de modelos**. Por eso viven en zonas distintas:

- **Zona de servicio → `login.microsoftonline.com` y `graph.microsoft.com`, puerto 443.** Nada más (solo la máquina de Open WebUI).
- **Zona de modelos → nada** (salvo el registro local, que está adentro).
- **Máquina del examen → nada.** Si una variable de telemetría se olvida, la llamada falla en vez de salir (lo que pidió [Evals](/evals/)).

Las IPs de Microsoft cambian: una regla por IP se rompe sola. Una regla por **nombre** pide un firewall o proxy que filtre por dominio. Si el del despacho no lo hace, es una compra, no un detalle.

:::profundo Y las alertas: la segunda excepción
[Observabilidad](/observabilidad/) manda las [[alerta|alertas]] por correo, y el correo del despacho vive en Microsoft 365: una alerta **sí cruza** a internet. Es la **segunda excepción**, con nombre: solo Alertmanager, en gestión, abre conexión al correo de Microsoft, y una alerta lleva nombres de métricas y de máquinas, nunca texto de una pregunta. Teams sería la misma excepción, y no hace falta.

Ojo, cambia rápido: Alertmanager manda con usuario y contraseña (SMTP AUTH, puerto 587), y Microsoft anunció que a fines de diciembre de 2026 apaga ese método por omisión en Exchange Online (se puede volver a prender; la fecha final la dará en 2027). El TI confirma con Microsoft qué método sigue vigente, por ejemplo un conector que acepte el correo por la IP pública del despacho (puerto 25).
:::

:::profundo Por qué la salida salva cuando falla el software
En octubre de 2026 salió un aviso crítico de LiteLLM (10.0, GHSA-w4c7-34wj-hqm8): una lectura de archivos sin autenticación que filtraba la llave maestra. Solo afectaba a instalaciones con licencia Enterprise, así que el despacho no estaba expuesto. Pero la mitigación del propio aviso es la idea de esta sección: con la salida del proxy en **lista blanca**, la [[exfiltracion|exfiltración]] falla aun si el atacante llega al código.
:::

### Apagar las llamadas a casa

La [[telemetria|telemetría]] es lo que un programa manda solo a sus autores (versión, hardware, cómo se usa). Aunque no mande expedientes, es una salida que nadie autorizó. Cada pieza trae su variable para apagarla.

:::profundo Las variables, pieza por pieza (noviembre de 2026)
| Pieza | Qué se pone | Qué hace |
|---|---|---|
| vLLM 0.34.0 | `VLLM_NO_USAGE_STATS=1` o `DO_NOT_TRACK=1` | Apaga sus estadísticas de uso, prendidas por omisión (proveedor, CPU, GPU, arquitectura del modelo, versión…) |
| Bibliotecas de Hugging Face | `HF_HUB_OFFLINE=1`, `HF_HUB_DISABLE_TELEMETRY=1` | Ninguna llamada al Hub; sin telemetría. `TRANSFORMERS_OFFLINE` ya no está en la documentación de Transformers, aunque `huggingface_hub` 2.5.0 todavía la respeta |
| LiteLLM 1.111.0 | `LITELLM_OFFLINE_MODE=true`, `LITELLM_LOCAL_MODEL_COST_MAP=True`, `LITELLM_TELEMETRY_DISABLED=True` | No baja su catálogo de GitHub ni otros catálogos; sin telemetría |
| Open WebUI 0.13.5 | `OFFLINE_MODE=true` | Pone `HF_HUB_OFFLINE`, apaga el aviso de versiones nuevas y las descargas automáticas de modelos |
| Qdrant 1.20.2 | `telemetry_disabled: true` en su configuración | Apaga su telemetría, prendida por omisión |
| Herramientas del examen | Las de [Evals](/evals/) (`RAGAS_DO_NOT_TRACK`, `DEEPEVAL_TELEMETRY_OPT_OUT`, `PROMPTFOO_DISABLE_TELEMETRY`) | Igual, y el juez fijado al gateway |

Una trampa: la imagen `-slim` de Open WebUI (0.20 GB) **no trae** el modelo de embeddings que usa por dentro y lo bajaría de Hugging Face. El despacho usa la imagen completa (1.65 GB).
:::

:::ojo Las variables no son la prueba
Aunque pongas todas, no sabes qué más intenta salir. La prueba es el firewall: durante el [[prueba-piloto|piloto]], la salida va en **«negar y registrar»**, y todo intento queda anotado con su destino. Al final, ese registro debe tener solo las llamadas a Microsoft. Lo demás se investiga.
:::

## Air-gapped de verdad contra «sin salida» {Truly air-gapped versus “no egress”}

Las dos frases se usan como si fueran lo mismo, y un cliente o un auditor puede preguntar cuál tienes.

**[[air-gapped|Air-gapped]]** («separado por aire») tiene definición formal, la del RFC 4949, que adopta el glosario de NIST: dos sistemas que (a) **no están conectados físicamente** y (b) entre los que **ninguna conexión lógica es automática**: los datos pasan solo a mano. El ejemplo del RFC es una persona que cruza el cuarto con un disco.

**Sin salida** (*no egress*) es lo del despacho: el servidor de modelos está conectado a una red y habla solo con el gateway, pero no puede abrir ninguna conexión hacia internet.

:::figura seguridad-espectro
Cuatro grados de separación, de la oficina normal al aire de verdad. El despacho está en el segundo; una dependencia de gobierno con información reservada estaría en el tercero o el cuarto.
:::

Por esa definición, **el despacho no es air-gapped**, y no debe decirlo. Lo que sí puede prometer: «el servidor que lee los expedientes no tiene ninguna ruta a internet; lo único que sale va a Microsoft: el inicio de sesión y el correo de las alertas».

### Por qué el despacho no elige el aire total

1. **El SSO.** Sin Microsoft no hay inicio de sesión con la cuenta del correo: 200 contraseñas locales más que administrar.
2. **El reloj de los parches.** Cada actualización cruzaría en un disco: un parche que en el despacho queda en ≈ 4.5 horas (la cuenta va más adelante) tardaría días.
3. **El equipo.** Dos personas de TI no sostienen una bitácora de medios con dos firmas por cambio.

Y ganaría poco: el riesgo grande del despacho es que los expedientes **salgan por la red**, y eso ya lo corta «sin salida». El aire total es para cuando el riesgo es que **entre** algo, o cuando una norma lo exige.

:::profundo Lo que cambia con aire de verdad
En una red air-gapped no hay puente conectada: hay **medios** (un disco, una USB) que una persona cruza, revisa y registra, a menudo con dos presentes. Para sacar datos (un reporte, una métrica) se usa un **diodo de datos** (*data diode*): un aparato que deja pasar los datos **en un solo sentido** (definición de NIST SP 800-82). Al conjunto de controles para mover información entre redes de distinto nivel se le llama *cross-domain solution*. Está en el caso de gobierno de «En la vida real».
:::

## Instalar sin internet: la máquina puente {Installing without internet: the bridge machine}

Si el servidor no sale a internet, ¿cómo llegan los 19 GB del modelo, las imágenes y cada parche? Por una sola puerta. La [[maquina-puente|máquina puente]] es una computadora **con** internet, en su propia VLAN, que baja cada pieza, la verifica y la **empuja** a un almacén dentro del despacho. Nadie de adentro le jala nada a internet.

:::analogia La aduana
Todo lo que entra pasa por la aduana: se revisa que sea lo que dice la factura (la huella), que venga de quien dice (la firma), que no traiga contrabando (el escaneo), y se sella. Del otro lado confían en el sello.

Dónde se rompe: la puente no puede «ver» si un programa es malicioso, solo que es **el mismo** que publicó su autor. Si el autor publicó algo malo con su firma de siempre, pasa. Para eso están la espera y el examen.
:::

### Qué cruza y cuánto pesa

Lo que entra la primera vez, con el tamaño comprimido que reporta cada registro (linux/amd64), a noviembre de 2026:

| Pieza | Tamaño |
|---|---|
| Imagen de vLLM v0.34.0 | 10.04 GB |
| Imagen de Open WebUI v0.13.5 (completa) | 1.65 GB |
| Imagen de LiteLLM v1.111.0 | 0.71 GB |
| Imagen de Qdrant v1.20.2 | 0.074 GB |
| Pesos de Qwen3-32B-AWQ (4 archivos `.safetensors` y el tokenizer) | 19.34 GB |
| Qwen3-Embedding-0.6B y Qwen3-Reranker-0.6B | 1.21 GB cada uno |
| **Total** (con [[prometheus\|Prometheus]] y lo chico) | **≈ 34.3 GB** |

:::formula El tiempo de cruzar la puente
t = frac{S}{r}
- t: lo que tarda la copia, en s
- S: lo que hay que copiar, en bytes
- r: la velocidad real de la copia, en bytes por segundo (no la del cable: la que se mide)
:::

:::cuenta Lo que cruza la primera vez
Lo que hay que copiar, \(S\) // imágenes ≈ 12.58 GB + pesos ≈ 21.76 GB | 12.58 + 21.76 | ≈ 34.3 GB
Velocidad real en 1 GbE, \(r\) // ≈ 110 MB/s de los 125 teóricos | — | 110 MB/s
Tiempo, \(t\) // \(S ÷ r\) | 34,300 ÷ 110 | ≈ 312 s ≈ 5.2 min
Con 10 GbE // supuesto: ≈ 1,100 MB/s reales | 34,300 ÷ 1,100 | ≈ 31 s
= Copiar no es el cuello: son minutos. Lo que tarda es **verificar, escanear y probar**, que va en horas. Un parche de vLLM trae los 10 GB de su imagen otra vez (las capas que no cambiaron se reutilizan si el registro ya las tiene).
:::

### El registro local y el digest

Las imágenes se guardan en un [[registro-de-contenedores|registro de contenedores]] local: un servidor que guarda imágenes y las entrega a quien las pide, como Docker Hub pero propio. Opciones activas a noviembre de 2026: `distribution` 3.1.2 (el `registry:3`, un solo programa) y Harbor 2.16.0 (con interfaz, escaneo y firmas). El despacho elige el simple: verificar y escanear ya se hizo en la puente.

Cada imagen se fija por su [[digest]], nunca por su etiqueta. Una etiqueta (`v0.34.0`, `latest`) es un nombre que el autor puede mover a otra imagen. El digest es la huella SHA-256 del contenido (`sha256:20fdb089…`): si cambia un byte, cambia el digest. Ese digest va al inventario, y como el anterior sigue en el registro, regresar de versión toma un minuto.

### Los pesos: la huella de cada archivo

Los pesos se bajan en la puente **fijando la revisión** (el commit exacto del repositorio), no «la última»:

```bash
# En la puente (huggingface_hub 2.5.0). El commit es el de Qwen3-32B-AWQ que revisó el despacho
hf download Qwen/Qwen3-32B-AWQ --revision 0499c3ac…eddd8 --local-dir /puente/modelos/qwen3-32b-awq
```

Hugging Face publica el SHA-256 de cada archivo grande (los `.safetensors` y el `tokenizer.json`), pero **no** de los chicos, como `config.json`. Así que el manifiesto del despacho tiene dos partes: los grandes se comparan contra la huella de la fuente; los chicos se leen (son texto), se hashean **en la puente después de revisarlos**, y el despacho firma el manifiesto. Ni Qwen ni Hugging Face publican firma de estos modelos: la única es la propia.

Antes de servir el modelo, un programa compara cada archivo contra el manifiesto. Este lo hace con una carpeta de juguete: arma el manifiesto, cambia un archivo «en el camino», le cuela un `.py` y verifica.

```python
import hashlib, pathlib, tempfile

def sha256(ruta, bloque=8 * 1024 * 1024):           # en bloques de 8 MiB: un archivo de 5 GB no se carga de golpe
    h = hashlib.sha256()
    with open(ruta, "rb") as f:
        while trozo := f.read(bloque):
            h.update(trozo)
    return h.hexdigest()

def verificar(manifiesto, carpeta):
    malos = 0
    for nombre, (tam, huella) in manifiesto.items():
        p = carpeta / nombre
        estado = ("FALTA" if not p.is_file() else "TAMAÑO" if p.stat().st_size != tam
                  else "DISTINTO" if sha256(p) != huella else "OK")
        print(f"{estado:<9}{nombre}"); malos += estado != "OK"
    for p in sorted(carpeta.iterdir()):                # lo que llegó y nadie pidió
        if p.name not in manifiesto and p.suffix in (".py", ".pkl", ".pt", ".bin", ".sh"):
            print(f"{'EXTRA':<9}{p.name}"); malos += 1
    return malos

d = pathlib.Path(tempfile.mkdtemp())                  # una carpeta de modelo de juguete
for nombre, texto in [("config.json", b'{"model_type": "qwen3"}'), ("model-00001.safetensors", b"pesos 1"),
                      ("model-00002.safetensors", b"pesos 2")]:
    (d / nombre).write_bytes(texto)
manifiesto = {p.name: (p.stat().st_size, sha256(p)) for p in sorted(d.iterdir())}  # se hace en la puente
(d / "model-00002.safetensors").write_bytes(b"pesos X")                            # cambió en el camino
(d / "modeling_qwen3.py").write_text("import os  # código que nadie pidió")
print("archivos con problema:", verificar(manifiesto, d))
```

```salida
OK       config.json
OK       model-00001.safetensors
DISTINTO model-00002.safetensors
EXTRA    modeling_qwen3.py
archivos con problema: 2
```

El archivo cambiado tiene el **mismo tamaño** (7 bytes) y aun así lo delata la huella. Y un `.py` en la carpeta de un modelo que no lo necesita es razón para detenerse: con `trust_remote_code` prendido, vLLM lo ejecutaría.

### Paquetes de Python y del sistema

Para lo que no va en contenedores (las herramientas del examen y de la ingesta) se arma un [[mirror-local|mirror local]]: una copia, dentro del despacho, de los paquetes que se usan. Lo más simple es una carpeta de *wheels* (paquetes de Python ya armados): `pip download` en la puente, y en el despacho `pip install --no-index --find-links /wheels --require-hashes -r requirements.txt`, que instala solo de esa carpeta y solo si cada huella coincide. Los paquetes de Ubuntu y el driver de NVIDIA entran igual: NVIDIA tiene un repositorio para Ubuntu 26.04 (a noviembre de 2026, drivers de la rama 595 a la 620) y la puente guarda copia de lo aprobado. La imagen de vLLM 0.34.0 trae CUDA 13.0.3, que pide driver 580 o más nuevo: cualquiera de esas ramas sirve. Cuál recomienda NVIDIA para la L40S en producción se confirma en su matriz de soporte.

## Firmas, SBOM y el día en que la firma era válida {Signatures, SBOMs and the day the signature was valid} [extra]

Sensei explica la firma de imágenes con cosign, el SBOM y el escaneo ([Ataques y cadena de suministro](https://sensei.trueml.app/ataques/)). Aquí va lo que cambia sin internet, y una historia de 2026 que obliga a no confiar de más en una firma.

### Qué es cada cosa, en una línea

- Una [[firma-de-artefactos|firma de artefactos]] dice **quién** armó un archivo (una imagen, un paquete, un modelo) y que no cambió desde entonces. A noviembre de 2026, cosign va en la 3.1.6. Para modelos existe OpenSSF *model-signing* (paquete `model-signing` 1.1.1), que firma la huella de cada archivo del modelo, con Sigstore o con llaves propias.
- Un [[sbom|SBOM]] (*software bill of materials*) es la lista de ingredientes de una imagen: cada biblioteca con su versión. Con él, cuando sale una CVE en una biblioteca, sabes en minutos si la tienes.
- Un **escáner** (Grype, Trivy) cruza el SBOM contra las bases de CVEs conocidas.

### Todo eso se hace en la puente

La verificación *keyless* de cosign (la que no usa una llave guardada, sino un certificado de corta vida) se apoya en la infraestructura pública de Sigstore: por omisión baja su raíz de confianza y puede consultar su registro público. Se puede verificar sin red copiando antes esa raíz (`--trusted-root`), pero es un paso más que mantener. Y los escáneres necesitan su base de CVEs al día. Por eso la verificación y el escaneo ocurren **en la puente**, que tiene internet, y hacia adentro viaja solo el digest ya verificado más el manifiesto firmado por el despacho. Por ejemplo, LiteLLM firma sus imágenes así desde `v1.111.0-dev.3` (15 de noviembre de 2026), y se verifica con la identidad del flujo que la publicó:

```bash
# En la puente: ¿la firmó el flujo de publicación de LiteLLM y nadie más?
cosign verify ghcr.io/berriai/litellm:v1.111.0 \
  --certificate-identity https://github.com/BerriAI/project-releaser/.github/workflows/release.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Octubre de 2026: malware con firma válida

El 21 de octubre de 2026, LiteLLM publicó la versión **1.107.0** con código malicioso, desde **su propio** flujo de publicación, que alguien había comprometido. Estuvo en PyPI (el índice público de paquetes de Python) ≈ **1 h 44 min** (de 11:39 a 13:23 UTC), y las imágenes de Docker `v1.107.0`, `latest`, `main-latest` y `main-stable` de 11:46 a 14:20. La causa, según su informe del 30 de octubre: la llave de administración de un servicio interno experimental, subida por error a un repositorio público en mayo y nunca revocada; ese servicio guardaba el token de GitHub de uno de los dos dueños de la organización. El dato que importa: **el artefacto malicioso tenía una firma cosign válida y una procedencia válida** (la procedencia es el registro firmado de qué flujo lo armó y desde qué código), porque lo firmó el sistema legítimo.

Siete meses antes, en marzo, `litellm` 1.82.7 y 1.82.8 estuvieron en PyPI con un ladrón de credenciales durante ≈ **40 minutos**. El origen sospechado fue otro: Trivy, un escáner de seguridad que el propio sistema de publicación de LiteLLM usaba sin fijar su versión. Esa vez los paquetes iban sin firma y se subieron por fuera del flujo oficial; la imagen oficial del proxy no se vio afectada.

La moraleja: **una firma dice quién lo armó, no que sea seguro**. Lo que habría protegido al despacho las dos veces es más aburrido:

1. **Fijar la versión** por digest y no seguir `latest`.
2. **Esperar** antes de adoptar una versión nueva. `pip` trae `--uploaded-prior-to` desde la 26.0 (enero de 2026): solo considera paquetes subidos antes de una fecha, y desde la 26.1 acepta una duración, como `P3D` (tres días). En la puente, la regla equivalente para imágenes: no se baja nada publicado hace menos de tres días.
3. **Probar en staging** (una copia de prueba con la configuración de producción) y comparar qué cambió: procesos nuevos, conexiones de salida intentadas (el registro del firewall en «negar y registrar»).

:::figura seguridad-cooldown
Las dos versiones comprometidas de LiteLLM en 2026 contra una espera de tres días. Cuando la espera dejaba bajar la versión, ya la habían retirado hacía casi tres días.
:::

:::cuenta Cuánto más larga es la espera que el compromiso
Ventana de octubre, \(w_{oct}\) // PyPI de 11:39 a 13:23 UTC | 13:23 − 11:39 | 104 min ≈ 1.73 h
Ventana de marzo, \(w_{mar}\) // según LiteLLM | — | ≈ 40 min
Espera de la puente, \(E\) // 3 días | 3 × 24 | 72 h
Veces más larga que la de octubre // \(E ÷ w_{oct}\) | 72 ÷ 1.73 | ≈ 41.5×
= Las dos ventanas duraron menos de 2 h y la espera es de 72 h: con la regla de los tres días, el despacho nunca habría visto ninguna de las dos. No es una garantía general (otro ataque podría durar semanas), pero los dos de 2026 los habría frenado una regla que cuesta tres días de paciencia.
:::

LiteLLM sigue siendo una buena elección (su respuesta fue pública y detallada), pero es la pieza del despacho con más versiones: **166** versiones en PyPI en los últimos 180 días, varias por día. Por eso su versión se fija y se cambia a propósito, nunca «la que salió hoy».

## El ciclo de las actualizaciones {The update cycle}

Un [[parche]] (*patch*) es una versión nueva que corrige fallas, de seguridad o no. Sin internet, los parches no llegan solos. Para que no dependa de la memoria de nadie, el despacho tiene un ciclo, igual para cada pieza.

:::diagrama seguridad-actualizacion
El camino de una actualización, del aviso al servidor. Sigue el recorrido normal (el ciclo mensual), el urgente (un aviso grave y alcanzable) y el que sale mal (el gate lo detiene y se regresa al digest anterior).
:::

:::pasos
1. Inventario
Cada pieza con su versión exacta y su digest: sistema operativo, driver de NVIDIA, CUDA, NVIDIA Container Toolkit, vLLM, el modelo (con su commit), embeddings y reranker, Qdrant, LiteLLM, Open WebUI, [[prometheus|Prometheus]] y el firmware del BMC. Sin inventario no sabes si un aviso te toca.
2. Leer los boletines
Los avisos de seguridad de GitHub de vLLM, LiteLLM, Open WebUI y Qdrant; los de NVIDIA (desde el 1 de octubre de 2026 los publica **solo** en GitHub, en `NVIDIA/product-security`); los de Ubuntu; y el catálogo de vulnerabilidades explotadas de CISA.
3. Evaluar
Tres preguntas: ¿tengo la versión afectada? ¿es **alcanzable** desde una zona que no sea de confianza? ¿se sabe que se está explotando? Con eso: mitigar ya, parchar en la siguiente ventana o esperar al ciclo mensual.
4. Traer y verificar
En la puente: por digest o hash, con la espera de tres días salvo urgencia, firma, escaneo y SBOM.
5. Staging
La versión nueva corre primero en una copia de prueba (*staging*), con la configuración de producción. La GPU rentada del piloto ya se devolvió: el staging es la cuarta L40S si se compró, o una de las tres réplicas sacada de la rotación fuera de la hora pico (la sección siguiente cuenta por qué alcanza).
6. El gate
El examen de 200 con su juez y el [[gate-de-calidad|gate de calidad]] de [Evals](/evals/) (0 fugas, 0 citas inventadas nuevas, la prueba pareada y se leen los flips), más una prueba de humo con carga. Examen y juez: ≈ 25 min.
7. La ventana y el regreso
Se instala en la ventana, una réplica a la vez. Si algo falla, se regresa (*rollback*) al digest anterior.
:::

Una [[ventana-de-mantenimiento|ventana de mantenimiento]] es un horario acordado para tocar producción, cuando un error afecta a la menor cantidad de gente. Para el despacho, cualquier hora fuera de 9:00 a 19:00 es una ventana natural. La sección siguiente pregunta si también se puede parchar **a media jornada**.

### Con qué frecuencia sale cada pieza

En los últimos 180 días (al 26 de noviembre de 2026): vLLM sacó **14** versiones estables (una cada 13 días en mediana), Open WebUI **21**, Qdrant **8**, el NVIDIA Container Toolkit **3** y LiteLLM **27** versiones menores. Y vLLM publicó **63** avisos en 90 días (45 medios, 14 altos, 4 bajos, ningún crítico): ≈ **21 al mes**. Nadie parcha cada uno el día que sale: el ciclo es **mensual**, con un atajo para lo urgente.

:::formula Las horas de TI al mes
H = sum_{i} f_i × h_i + H_{urg}
- H: horas de TI al mes para mantener todo al día
- f_i: ciclos al mes de la pieza i (1 = mensual, 1/3 = trimestral)
- h_i: horas de un ciclo de esa pieza: leer, traer, staging, gate, ventana y documentar
- H_{urg}: horas al mes reservadas para urgencias
:::

:::cuenta Las horas de TI del despacho
vLLM // mensual, 4.5 h por ciclo (supuesto) | 1 × 4.5 | 4.5 h
LiteLLM // mensual, 3 h | 1 × 3 | 3.0 h
Open WebUI // mensual, 2.25 h (sin gate de modelo) | 1 × 2.25 | 2.25 h
Qdrant // cada 2 meses, 2.75 h | 0.5 × 2.75 | 1.38 h
Driver y container toolkit // trimestral, 4.5 h | 0.33 × 4.5 | 1.5 h
Ubuntu // parches semanales y reinicio mensual, 1.5 h | 1 × 1.5 | 1.5 h
Ordinario, \(sum f_i × h_i\) // la suma | 4.5 + 3 + 2.25 + 1.38 + 1.5 + 1.5 | 14.1 h
Urgencias, \(H_{urg}\) // un aviso grave al trimestre × 6 h | 6 ÷ 3 | 2 h
= \(H\) ≈ **16 horas al mes** entre las 2 personas de TI, ≈ 8 cada una. Los tiempos por ciclo son supuestos de partida; el piloto los mide. Es el número que va al costo de operar el servidor, junto con la luz.
:::

:::calculadora seguridad-ventana
Mueve la hora del aviso y lo que tarda cada paso: la calculadora suma el camino, espera la ventana si hace falta y dice a qué hora queda instalado el parche en las tres réplicas.
:::

## Actualizar sin cortar: una réplica a la vez {Updating without downtime: one replica at a time}

El despacho tiene 3 réplicas, una por L40S ([[data-parallel|data parallel]]). Para actualizar vLLM se saca una de la rotación del gateway, se reinicia con la versión nueva, se prueba y se regresa. Mientras, las otras dos atienden todo. ¿Alcanzan?

Cada L40S atiende ≈ **2 conversaciones** a ≥ 20 tokens/s, y una respuesta tarda ≈ **27 s** (2 s al primer token y 500 tokens a 20 por segundo). La [[ley-de-little|ley de Little]] (conversaciones a la vez = tasa × duración) lo convierte en preguntas por hora.

:::formula Lo que sostienen las réplicas que quedan
Q_k = frac{(n − k) × c × 3600}{W}
- Q_k: preguntas por hora que se sostienen con k réplicas fuera
- n: réplicas en total
- k: réplicas fuera (actualizándose o descompuestas)
- c: conversaciones por réplica que van a la velocidad pedida
- W: duración de una respuesta, en s
:::

:::cuenta Una L40S fuera, en el despacho
Réplicas que quedan, \(n − k\) // 3 en total, 1 fuera | 3 − 1 | 2
Conversaciones a la vez // \((n − k) × c\), con \(c\) = 2 | 2 × 2 | 4
Lo que sostienen, \(Q_1\) // \(4 × 3600 ÷ W\), con \(W\) = 27 s | 14,400 ÷ 27 | ≈ 533 preguntas/h
Lo que pide la hora pico // 200 × 15 ÷ 10 h × 2.5 | — | 750 preguntas/h
Lo que pide una hora normal // supuesto: las otras 9 h reparten 3,000 − 750 | 2,250 ÷ 9 | 250 preguntas/h
Con la cuarta L40S, \(Q_1\) // \((4 − 1) × 2 × 3600 ÷ 27\) | 21,600 ÷ 27 | 800 preguntas/h
= Con 3 L40S, una fuera **no alcanza en la hora pico** (533 < 750) pero **sí en cualquier otra hora** (533 > 250, más del doble). Con el [[n-mas-1|N+1]] (la cuarta L40S en la ranura libre), una fuera deja 800 ≥ 750: se puede parchar incluso en el pico.
:::

El perfil «una hora pico y nueve normales» es un supuesto: la ficha solo da el promedio (300 por hora) y el pico (750). El piloto mide la curva, y con ella se escribe la regla: con 3 L40S, **nunca se saca una réplica en la hora pico** (la que el piloto diga), y fuera de 9:00 a 19:00 se pueden sacar las tres.

:::calculadora seguridad-sin-cortar
Prueba con 3 L40S, con la cuarta y con 2 RTX PRO 6000 Server Edition, y saca una o dos réplicas: mira en qué horas alcanza.
:::

:::profundo El drenado y lo que se pierde
Sacar una réplica no es apagarla. Primero se **drena**: el gateway deja de mandarle preguntas nuevas y se espera a que terminen las suyas. Una respuesta típica tarda ≈ 27 s: un minuto sobra.

Hay un costo chico: el gateway manda las repreguntas de una conversación a la réplica que ya tiene su [[prefix-caching|prefix cache]]; las de la réplica que sale pagan el [[prefill]] completo en la siguiente pregunta. Y dos cosas que esta lección no pudo verificar y el piloto mide: cómo se saca una réplica de la rotación en LiteLLM 1.111.0 sin reiniciar el gateway, y cuánto tarda vLLM en arrancar con Qwen3 32B AWQ en una L40S. Las cuentas suponen 15 minutos por réplica.
:::

:::ojo Con 2 RTX PRO 6000, una fuera alcanza, pero sin red
Cada Server Edition atiende ≈ 6 conversaciones: una sola sostiene ≈ 800 preguntas por hora. Pero mientras dura la actualización **no hay repuesto**: si la que queda falla, se cae todo. Con 4 L40S y una fuera, si otra falla todavía quedan dos.
:::

## Un aviso en vLLM un viernes {A vLLM advisory on a Friday}

Viernes, 16:00. Llega un aviso de seguridad de vLLM. El TI **no** instala la versión nueva directo en producción a las 16:05: recorre el ciclo, más rápido.

### Primero: ¿es alcanzable y está explotada?

Una vulnerabilidad que ninguna zona no confiable alcanza espera a la ventana; una alcanzable **y** explotada se **mitiga en minutos** y se parcha ese día. Para lo segundo existe el [[kev|catálogo KEV]] de CISA (*Known Exploited Vulnerabilities*): la lista pública de fallas que la agencia de ciberseguridad de EE. UU. sabe que se están explotando. No es ley en México, pero es la mejor señal pública de «esto ya lo están usando».

Algunos avisos reales de 2025–2026 pasados por esa pregunta:

| Aviso | Severidad | ¿Le llega al despacho? | Qué se hace |
|---|---|---|---|
| vLLM CVE-2026-48746: esquivar `--api-key` con un `Host:` manipulado | Crítica 9.1 | Solo desde la IP de LiteLLM: el resto de las zonas no llega al puerto | Parchar en la ventana; la segmentación ya lo frena |
| vLLM CVE-2026-22778: ejecución de código con un video | Crítica 9.8 | **No**: el aviso dice que no afecta si no sirves un modelo de video, y Qwen3 32B es solo texto | Nada urgente; saber qué modalidades sirves |
| vLLM GHSA-q9v9-qpjp-fc24: una petición tumba el motor | Alta 7.5 | Solo con `--skip-tokenizer-init`, que el despacho no usa | Nada; si aplicara, 3 réplicas degradan en vez de caer |
| LiteLLM CVE-2026-42208: inyección SQL **sin autenticación** en `/chat/completions` | Crítica, **explotada** (en KEV con plazo de 3 días) | LiteLLM sí es alcanzable desde la zona de servicio | Mitigar y parchar **ese día** |
| Open WebUI CVE-2026-70482 y otras del verano: tomas de cuenta por OAuth, usuarios revocados que siguen entrando | Altas (8.1) | **Sí, varias**: Open WebUI es lo que tocan las 200 laptops, y el despacho usa SSO (la 70482, de la 0.8.0 a la 0.10, solo con `ENABLE_OAUTH_TOKEN_EXCHANGE` prendido) | Ciclo corto para Open WebUI; ya cerradas en 0.13.5 |
| NVIDIA Container Toolkit CVE-2025-23266: un contenedor hostil corre código con privilegios en el servidor | Crítica 9.0 | Solo si corre una imagen hostil: por eso solo imágenes fijadas por digest | Inventariar el toolkit y parcharlo en su ciclo (se arregló en la 1.17.8; el despacho va en la 1.20.2) |

Los críticos son de tres clases: **una autenticación que se rompe**, **código que corre por una entrada rara** (un video, una imagen EPS, un pickle, `trust_remote_code`) o **un escape de contenedor**. Casi todos los cortó la arquitectura: puertos que la oficina no alcanza, modelos sin salida, `trust_remote_code` apagado, servir solo lo que se usa y versiones al día. La llave de API **no** cortó el primero de la tabla.

:::nota Qué tan rápido pasa de «publicado» a «explotado»
Para las cuatro CVEs de LiteLLM en el catálogo KEV, los días entre su publicación en la base de NIST y su entrada al catálogo fueron 0, 31, 56 y 222. A veces el mismo día; a veces siete meses después. «Nadie la está usando todavía» no es un plan.
:::

### La cuenta del viernes

Si el aviso sí aplica, el camino entero cabe en la tarde. Los tiempos son supuestos, salvo el del examen y su juez, que sale de la ficha.

:::formula La hora en que queda instalado
T = max(t_0 + sum_{j} d_j, V) + n × t_r
- T: hora en que el parche queda instalado en todas las réplicas
- t_0: hora del aviso
- d_j: lo que tarda cada paso antes de producción (leer, traer, staging, gate, prueba de humo), en h
- V: hora en que abre la ventana (si se puede instalar en horario de oficina, V = t_0)
- n: réplicas; t_r: lo que tarda cada una (drenar, reiniciar, probar), en h
:::

:::cuenta Aviso a las 16:00 del viernes
Hora del aviso, \(t_0\) // viernes | — | 16:00
Leer el aviso y decidir, \(d_1\) // supuesto | — | 0.5 h
Bajar en la puente, verificar y escanear, \(d_2\) // supuesto; sin la espera de 3 días, por urgencia | — | 1 h
Subir al registro y armar staging, \(d_3\) // supuesto | — | 1 h
Examen, juez y leer los flips, \(d_4\) // examen y juez ≈ 25 min (ficha) más la lectura | — | 0.75 h
Prueba de humo con carga, \(d_5\) // supuesto | — | 0.5 h
Listo para producción // \(t_0 + sum d_j\) = 16:00 + 3.75 h | — | 19:45
La ventana, \(V\) // abre a las 19:00: ya está abierta | max(19:45, 19:00) | 19:45
Tres réplicas en serie, \(n × t_r\) // supuesto: 15 min cada una | 3 × 0.25 | 0.75 h
= \(T\) = 19:45 + 0.75 h = **20:30 del mismo viernes**, ≈ 4.5 horas después del aviso, sin que ningún abogado lo note. Si el aviso fuera grave **y** alcanzable a media jornada, primero se mitiga (cerrar la ruta en el firewall o apagar la pieza afectada) y el reloj corre igual.
:::

### Revisar el inventario contra los avisos

Lo que convierte «leí un aviso» en «sé si me toca» es cruzar el inventario contra las versiones afectadas.

:::profundo El cruce, en Python
Este programa lo hace con avisos reales de 2026 y dos inventarios: el del despacho hoy y uno de ejemplo, instalado en primavera y olvidado.

```python
def v(s): return tuple(int(x) for x in s.split("."))

# Avisos reales de 2026 (pieza, id, severidad, primera afectada, la que lo arregla). "0.0.0" = toda versión anterior.
AVISOS = [("vllm", "CVE-2026-48746", "crítica 9.1", "0.3.0", "0.22.0"),
          ("vllm", "CVE-2026-22778", "crítica 9.8", "0.8.3", "0.14.1"),
          ("vllm", "GHSA-q9v9-qpjp-fc24", "alta 7.5", "0.28.0", "0.33.0"),
          ("litellm", "CVE-2026-42208", "crítica, explotada", "1.81.16", "1.83.7"),
          ("litellm", "CVE-2026-40217", "explotada", "1.81.8", "1.83.10"),
          ("litellm", "CVE-2026-93355", "alta", "0.0.0", "1.111.0"),
          ("nvidia-container-toolkit", "CVE-2026-24260", "alta 8.5", "0.0.0", "1.19.1")]

def revisar(nombre, inventario):
    print(f"== {nombre}")
    pendientes = [(p, i, s, arr) for p, i, s, desde, arr in AVISOS
                  if p in inventario and v(desde) <= v(inventario[p]) < v(arr)]
    for p, i, s, arr in pendientes:
        print(f"  {p:<25}{inventario[p]:<9}{i:<21}{s:<19}-> subir a {arr}")
    print(f"  {len(pendientes)} avisos abiertos")

revisar("el despacho, noviembre de 2026", {"vllm": "0.34.0", "litellm": "1.111.0", "nvidia-container-toolkit": "1.20.2"})
revisar("instalado en abril y olvidado", {"vllm": "0.21.0", "litellm": "1.83.0", "nvidia-container-toolkit": "1.19.0"})
```

```salida
== el despacho, noviembre de 2026
  0 avisos abiertos
== instalado en abril y olvidado
  vllm                     0.21.0   CVE-2026-48746       crítica 9.1        -> subir a 0.22.0
  litellm                  1.83.0   CVE-2026-42208       crítica, explotada -> subir a 1.83.7
  litellm                  1.83.0   CVE-2026-40217       explotada          -> subir a 1.83.10
  litellm                  1.83.0   CVE-2026-93355       alta               -> subir a 1.111.0
  nvidia-container-toolkit 1.19.0   CVE-2026-24260       alta 8.5           -> subir a 1.19.1
  5 avisos abiertos
```

El inventario «olvidado» es de ejemplo (sus versiones y fechas son ilustrativas), y la lista de avisos es una muestra: la de verdad sale de los boletines de cada pieza.
:::

Con todos los avisos publicados al 26 de noviembre de 2026, las versiones del despacho son **justo** las que los cierran todos. Pero dos, vLLM 0.34.0 y LiteLLM 1.111.0, son la que arregla un aviso de hace 8 y 2 días: «ya estamos al día» dura un mes.

## Cifrado en reposo y respaldos {Encryption at rest and backups}

### Lo que protege un disco cifrado

El [[cifrado-en-reposo|cifrado en reposo]] (*encryption at rest*) es guardar los datos cifrados en el disco: quien se lo lleve sin la llave solo ve ruido. Sensei lo explica con el servicio de llaves de una nube ([Cifrado, llaves y certificados](https://sensei.trueml.app/cifrado/)). En un servidor Linux propio se usa **LUKS**, el formato estándar de disco cifrado, con la herramienta `cryptsetup` (la de origen va en la 2.8.9 a noviembre de 2026; Ubuntu 26.04 trae la 2.8.4 con sus parches).

Lo difícil es **dónde vive la llave** cuando el servidor arranca:

| Cómo se desbloquea | Lo que gana | Lo que cuesta |
|---|---|---|
| Una persona escribe la frase al arrancar | Quien se lleve el servidor entero no lo arranca | Tras cada corte de luz, alguien de TI tiene que ir al cuarto (o entrar al BMC) |
| El chip **TPM** del servidor guarda la llave (`systemd-cryptenroll`) | Arranca solo | Quien se lleve **el servidor entero** también lo arranca: solo protege el disco suelto |
| **Clevis** contra un servidor **Tang** en la red del despacho | Arranca solo, pero **solo dentro de la red del despacho**: fuera de ella no encuentra a Tang y no abre | Otra pieza que operar; Tang debe vivir en otra máquina, idealmente en otro cuarto |

Tang es un servidor chico que ayuda a reconstruir la llave sin guardarla; Clevis es el programa que le pregunta al arrancar. Ubuntu 26.04 trae los dos (Clevis 20, Tang 15) en *universe*, la sección que mantiene la comunidad, con menos garantía de parches que *main*: va al inventario.

El despacho elige Clevis con Tang en la zona de gestión, en una máquina fuera del rack, con una frase de respaldo en un sobre cerrado que guarda un socio. Un disco devuelto por garantía o un servidor robado no abren fuera del despacho.

Lo que **no** hace: no protege a un servidor **encendido** y comprometido (el disco ya está abierto), ni cifra la memoria de la GPU, donde viven el [[kv-cache|KV cache]] y los prompts. Contra eso están las zonas y los parches.

:::profundo Si el servidor se va a colocation
[El cuarto](/el-cuarto/) dejó abierta la opción de rentar espacio en un centro de datos. En seguridad cambian cuatro cosas. Los expedientes salen **físicamente** de la oficina, aunque no de máquinas del despacho: hay que revisar que los contratos con los clientes lo permitan. El único camino entre la oficina y el servidor es el **enlace privado**, que se vuelve parte de la zona de servicio (un túnel cifrado de sitio a sitio, sin salida a internet en el lado del servidor). Las **manos remotas** del sitio pueden tocar el rack: se registra quién entra y para qué, y el cifrado del disco pasa de «por si acaso» a indispensable. Y Tang no puede vivir en el mismo rack: se queda en la oficina, al otro lado del enlace, así que si el enlace cae, el servidor que reinicie espera a que vuelva.
:::

### Qué se respalda y qué no

Un [[respaldo]] (*backup*) es una copia para recuperar algo que se perdió. La pregunta útil es «¿qué cuesta **volver a tener** cada cosa?»:

- **La configuración** (Compose, LiteLLM, Qdrant, reglas del firewall, inventario, manifiestos firmados): pesa poco y son horas de alguien. Siempre.
- **La base de LiteLLM** (PostgreSQL: claves, cuotas y el registro de 90 días) y **la de Open WebUI** (SQLite). Ojo: la de Open WebUI guarda **los chats**, con el texto de preguntas y respuestas. Su respaldo es otra copia del secreto profesional: se cifra y se borra con la misma regla.
- **El índice de Qdrant**, con sus *snapshots* (fotos de una colección). Pero «el índice se reconstruye» es verdad a medias, como muestra la cuenta.
- **Los pesos y las imágenes** no: se vuelven a traer **de la puente**, que guarda cada versión con su manifiesto.

:::formula Lo que pesa el texto que ya se leyó
S_{txt} = T × b
- S_{txt}: tamaño del texto que salió de leer los expedientes, en bytes
- T: tokens de todos los expedientes
- b: bytes de texto por token (≈ 4, el supuesto de [El cuarto](/el-cuarto/))
:::

:::cuenta Reconstruir el índice: con y sin el texto
Tokens del despacho, \(T\) // 30,000 expedientes × 40,250 tokens, el caso pesado | 30,000 × 40,250 | ≈ 1,207.5 M
Texto guardado, \(S_{txt}\) // \(T × b\), con \(b\) ≈ 4 | 1,207.5 M × 4 | ≈ 4.8 GB
Rehacer los embeddings // ficha: en 1 L40S, según la eficiencia | — | ≈ 1.8 a 4.3 h
Volver a leer los archivos // ficha: de Marker sin OCR a Docling | — | ≈ 7 h a ≈ 14 noches
= Con ≈ 5 GB de texto respaldado, el índice se rehace en una noche. Sin ese texto, hay que volver a leer 1.5 millones de páginas: hasta **dos semanas de noches**. El texto leído es lo más barato de guardar y lo más caro de rehacer.
:::

La regla: al menos una copia **fuera del cuarto** (un incendio se lleva todo lo que está junto), **cifrada** con una llave que se queda en el despacho, y probada: un respaldo que nunca se restauró es una esperanza.

## La ley: lo que hay que poder mostrar {The law: what you must be able to show} [extra]

[Datos personales y la ley](https://sensei.trueml.app/privacidad/) explica la ley mexicana de datos personales de 2025 en general. Aquí va solo la parte de seguridad, porque una auditoría o una vulneración la van a preguntar. Es orientación con su fuente: la confirma un abogado, y en este caso lo hay en casa.

### Lo que dice la ley vigente

La Ley Federal de Protección de Datos Personales en Posesión de los Particulares se publicó en el Diario Oficial el 20 de marzo de 2025, con última reforma del 14 de noviembre de 2025, y la vigila la Secretaría Anticorrupción y Buen Gobierno. Tres artículos tocan esta lección:

- **Art. 18**: todo responsable debe establecer y mantener **medidas de seguridad administrativas, técnicas y físicas** contra daño, pérdida, alteración, destrucción o uso, acceso o tratamiento no autorizado; **no menores** a las que usa para su propia información; y considerando el riesgo, las consecuencias para las personas, la sensibilidad de los datos y el desarrollo tecnológico. Las zonas, el firewall de salida, LUKS y el ciclo de parches son medidas técnicas; el cuarto con llave, físicas; el inventario y los procedimientos, administrativas.
- **Art. 19**: las vulneraciones que afecten de forma significativa los derechos patrimoniales o morales se informan **de forma inmediata a las personas titulares**. La ley no pide aviso a la autoridad.
- **Art. 20**: controles para que **todas las personas que intervengan** guarden confidencialidad, aun después de terminar la relación. Eso incluye al TI, al integrador y a quien dé soporte.

### Lo que cuesta no cumplir

El art. 58 lista como infracción «vulnerar la seguridad de bases de datos, locales, programas o equipos, cuando resulte imputable al responsable» (fracción XI) e incumplir la confidencialidad (fracción VIII). El art. 59 las multa con **200 a 320,000 veces la UMA** (la Unidad de Medida y Actualización, el valor en pesos con que se calculan multas en México), y hasta el doble con datos sensibles.

:::cuenta La multa en pesos, con la UMA de 2026
UMA diaria de 2026 // INEGI, desde el 1 de febrero de 2026 | — | $117.31
Mínimo // 200 UMA | 200 × 117.31 | $23,462
Máximo // 320,000 UMA | 320,000 × 117.31 | $37,539,200
Con datos sensibles // hasta el doble | 2 × 37,539,200 | $75,078,400
= De ≈ 23 mil a ≈ 37.5 millones de pesos, y hasta ≈ 75 millones con datos sensibles. El art. 60 pondera la naturaleza del dato, la intención, la capacidad económica y la reincidencia. Y el art. 62 agrega cárcel, de 3 meses a 3 años, a quien, autorizado a tratar los datos, provoque una vulneración con ánimo de lucro; el art. 64 duplica la pena con datos sensibles.
:::

Y por encima de la ley de datos está el **secreto profesional**. El Código Penal Federal castiga a quien, sin justa causa, con perjuicio de alguien y sin su consentimiento, revela un secreto que conoció por su trabajo (art. 210); y si lo revela quien **presta servicios profesionales o técnicos**, la sanción sube a **1 a 5 años** y suspensión de la profesión (art. 211; texto con su última reforma del 13 de noviembre de 2026). Es el caso del abogado, y también el del TI o el integrador contratados por el despacho.

### Qué se documenta

El Reglamento de 2011 (el texto vigente que publica la Cámara) pide, entre otras cosas: inventario de datos y sistemas, funciones y obligaciones de cada persona, **análisis de riesgos**, análisis de brecha, plan de trabajo, auditorías, capacitación y **registro de medios de almacenamiento**; actualizar las medidas cuando cambia el tratamiento o tras una vulneración y, con datos sensibles, **una vez al año**; y ante una vulneración, analizar la causa y corregir. Una advertencia honesta: ese Reglamento cita la ley de 2010 y un instituto que ya no existe. La ley de 2025 le dio al Ejecutivo 90 días para adecuar los reglamentos; a noviembre de 2026 la Cámara sigue publicando el de 2011 como texto vigente y no encontramos uno nuevo, pero esto lo confirma el abogado.

Lo bueno: casi todo ya lo produjo esta lección. El análisis de riesgos es la tabla del modelo de amenazas; las medidas son la tabla de zonas y las variables de salida; el inventario de sistemas es el inventario de versiones; el registro de medios es la bitácora de la puente (qué entró, cuándo, con qué huella); y el procedimiento de vulneración es la cuenta del viernes. Una carpeta con esos documentos, fechados y revisados una vez al año, es lo que el despacho muestra si alguien pregunta.

## Errores comunes {Common mistakes}

1. **Confiar en `--api-key` y dejar el puerto de vLLM en `0.0.0.0`.** La llave no cubre `/invocations` ni `/metrics`, y en 2026 se pudo esquivar con un encabezado `Host:`. **Cómo evitarlo:** el puerto en la IP de la zona de modelos, alcanzable solo desde el gateway, y la llave como capa extra.
2. **Creer que `ufw` cerró el puerto de un contenedor.** Docker publica sus puertos antes de que ufw los vea. **Cómo evitarlo:** publica en una sola IP y deja las reglas al firewall de la red; verifica desde otra VLAN con una conexión de prueba.
3. **Llamar «air-gapped» a un servidor sin salida.** Promete algo que no es verdad y que un auditor puede revisar. **Cómo evitarlo:** di «el servidor de modelos no tiene ruta a internet; lo único que sale es el inicio de sesión y el correo de las alertas, y solo a Microsoft».
4. **Seguir `latest` o bajar la versión que salió hoy.** Las dos versiones comprometidas de LiteLLM en 2026 duraron menos de 2 horas. **Cómo evitarlo:** fija por digest, espera tres días en la puente y pasa por staging y el gate.
5. **Poner las variables de offline y no probar.** Siempre hay una llamada que nadie documentó. **Cómo evitarlo:** en el piloto, salida en «negar y registrar», y al final el registro solo debe mostrar a Microsoft.
6. **Respaldar el índice y no el texto leído.** Sin el texto, reconstruir es volver a leer 1.5 millones de páginas. **Cómo evitarlo:** respalda los ≈ 5 GB de texto, cifrados, fuera del cuarto, y prueba restaurar.
7. **Olvidar el prototipo.** El TI probó el modelo con [[ollama|Ollama]] en una laptop con Windows; entre 2025 y noviembre de 2026 la base de NIST registró 42 CVEs que mencionan Ollama, 31 con severidad 7 o más, entre ellas un actualizador de Ollama para Windows que no verificaba lo que bajaba (9.8). **Cómo evitarlo:** al terminar el piloto se apaga y se desinstala, y esa laptop no guarda expedientes.

## En la vida real {In real life} [extra]

**El despacho.** Dos cajas en cinco zonas: el servidor de GPUs con vLLM, los modelos de búsqueda y Qdrant en una VLAN sin puerta de enlace; Open WebUI, LiteLLM, la búsqueda, el agente y el examen en otra máquina; gestión aparte con el BMC, [[prometheus|Prometheus]], el registro local y Tang. Dos salidas a internet, las dos a Microsoft: Open WebUI para el inicio de sesión y Alertmanager para el correo de las [[alerta|alertas]]. Todo entra por la puente, fijado por digest o hash, con tres días de espera, verificado y escaneado. Ciclo mensual de actualizaciones con el gate, una réplica a la vez fuera de la hora pico (o a cualquier hora, con la cuarta L40S), ≈ 16 horas de TI al mes, y discos con LUKS que solo abren dentro de su red.

**Una dependencia de gobierno con información reservada.** Supuesto del ejemplo: quiere el mismo asistente sobre sus expedientes, sin ninguna conexión con otra red. Aquí sí es air-gapped: no hay SSO de Microsoft (usuarios locales o un directorio propio), no hay puente conectada, y cada actualización cruza en un disco que dos personas revisan, firman y registran. El reloj cambia: el parche que en el despacho queda en 4.5 horas tarda días, porque cada pieza viaja físicamente; la espera de tres días se vuelve natural. Si hay que sacar métricas, van por un diodo de datos. Y la ley es otra: los sujetos obligados públicos se rigen por la Ley General de Protección de Datos Personales en Posesión de Sujetos Obligados, expedida el mismo día que la de particulares; sus lineamientos de seguridad no los verificamos aquí.

**Una clínica con el equipo médico en la misma red.** Supuesto del ejemplo: un hospital chico quiere un asistente para resumir notas clínicas, y en su red plana conviven las computadoras de recepción, el servidor nuevo y equipos médicos con sistemas viejos que no se pueden parchar. Lo primero no es el modelo: es separar. Los equipos médicos van en su propia VLAN, sin ruta al servidor de modelos ni a internet; el servidor, en la suya, como en el despacho. Y los datos son de otra clase: los de salud son **datos sensibles**, que la ley de 2025 trata con consentimiento expreso y por escrito (art. 8) y con multas que pueden duplicarse. Las normas sanitarias de expediente clínico electrónico aplican también; no las verificamos y no se citan por número sin leerlas.

## Ejercicios {Exercises}

:::ejercicios
? [facil] Un servidor tiene un puerto de vLLM con `--api-key` en `0.0.0.0:8000`, en la misma VLAN que las laptops. Nombra dos rutas que una laptop puede usar sin llave, y la regla que lo arregla.
Por la documentación de vLLM 0.34.0, entre otras: `/invocations` (la misma inferencia que `/v1`), `/metrics`, `/tokenize`, `/pause`. La regla: el puerto en la IP de la zona de modelos y el firewall dejando entrar solo desde la IP del gateway. Con eso, la laptop no tiene camino, con o sin llave.
? [facil] El despacho quiere copiar a la puente una imagen nueva de vLLM de 10.04 GB por una red de 1 GbE (≈ 110 MB/s reales). ¿Cuánto tarda la copia? ¿Es el paso que más tarda del ciclo?
\(t = S ÷ r\) = 10,040 ÷ 110 ≈ **91 s**, poco más de minuto y medio. No: el examen con su juez (≈ 25 min), el staging y la prueba de humo tardan mucho más. Copiar nunca es el cuello.
? [facil] Un aviso de vLLM dice «crítico, 9.8; los despliegues que no sirven un modelo de video no están afectados». El despacho sirve Qwen3 32B, solo texto. ¿Qué hace el viernes?
Nada urgente: anotarlo en el inventario como «no aplica» con la razón, y la versión que lo arregla entra en el ciclo mensual. La severidad de 9.8 no sabe qué modalidades sirves; el modelo de amenazas sí.
? [medio] Con 3 L40S (2 conversaciones a ≥ 20 tokens/s cada una, 27 s por respuesta), ¿cuántas preguntas por hora se sostienen con **dos** réplicas fuera? ¿En qué horas del despacho alcanza?
\(Q_2 = (3 − 2) × 2 × 3600 ÷ 27\) ≈ **267 preguntas/h**. No alcanza en la hora pico (750) ni en una hora promedio (300); con el perfil supuesto de 250 en las horas normales, apenas (267 ÷ 250 ≈ 1.07×). Conclusión práctica: dos fuera, solo de noche.
? [medio] Un parche llega el martes a las 10:00. Los pasos antes de producción suman 3.75 h y cada réplica tarda 15 min. Con 3 L40S, la ventana abre a las 19:00. ¿A qué hora queda instalado? ¿Y con 4 L40S, si se permite instalar a media jornada?
Listo a las 10:00 + 3.75 h = 13:45. Con 3 L40S espera la ventana: \(T = max(13:45, 19:00) + 3 × 0.25\) = **19:45**. Con 4 no hace falta esperar: \(T = 13:45 + 4 × 0.25\) = **14:45** (cuatro réplicas en serie), aunque caiga en la hora pico, porque con una fuera quedan 800 preguntas por hora contra 750.
? [medio] Explica con la historia de LiteLLM de octubre de 2026 por qué una firma válida no basta, y qué tres reglas habrían protegido al despacho.
La versión 1.107.0 la publicó el propio flujo de LiteLLM, comprometido, con firma cosign y procedencia válidas: la firma decía «la armó LiteLLM», y era verdad. Las reglas: fijar por digest (no seguir `latest`), esperar tres días antes de adoptar una versión (la maliciosa duró ≈ 1 h 44 min en PyPI) y pasar por staging y el gate comparando procesos y conexiones de salida.
? [medio] Si se pierde el disco de Qdrant y no hay snapshot, pero sí el texto leído, ¿cuánto tarda rehacer el índice? ¿Y sin el texto? ¿Cuánto pesa ese texto?
Con el texto: solo los embeddings, ≈ 1.8 a 4.3 h en una L40S: una noche. Sin el texto: volver a leer 1.5 M de páginas, de ≈ 7 h a ≈ 14 noches. El texto pesa \(S = T × b\) ≈ 1,207.5 M × 4 ≈ **4.8 GB**: lo más barato de guardar.
? [reto] Diseña la regla de salida de la máquina del examen. Corre DeepEval y promptfoo, su juez es `chat-grande` del gateway, y alguien de TI tiene `OPENAI_API_KEY` en su perfil. ¿Qué puede salir, qué se niega, y qué pasa si la variable se cuela?
Salida: **ninguna** a internet; solo hacia LiteLLM (zona de servicio, puerto 4000). Todo lo demás, negado y registrado. Si la variable se cuela y promptfoo intenta llamar a OpenAI, la conexión falla y queda en el registro del firewall: se descubre el error sin que salga un solo fragmento. Además: telemetría apagada con sus variables, el juez fijado en la configuración (no por credenciales del entorno) y las variables de nubes borradas.
? [reto] El socio pregunta: «¿por qué no compramos la cuarta L40S solo para parchar?». Arma el argumento con números de esta lección.
Con 3 L40S, una réplica fuera sostiene ≈ 533 preguntas/h contra 750 del pico: los parches de vLLM (≈ 14 versiones en 180 días) solo se pueden instalar fuera de la hora pico o de noche, y una falla de hardware en el pico deja al despacho corto. Con la cuarta, una fuera deja 800 ≥ 750: se parcha a cualquier hora, la ventana del viernes no obliga a nadie a quedarse, y si una GPU falla mientras otra se actualiza todavía quedan dos (533/h, suficiente fuera del pico). Además, es la que pide la ficha para que las 8 conversaciones de diseño vayan a ≥ 20 tokens/s y la que permite probar tensor parallel de 2. El costo: con 4 L40S el servidor pasa de US$67,191.30 a US$76,101.30 (configurador de Exxact, 25 de noviembre de 2026).
:::

## Lo que sigue {What comes next} [extra]

- **[Observabilidad de GPUs e inferencia](/observabilidad/)** vigila lo que esta lección cerró: que cada réplica vuelva sana después de un parche y las [[alerta|alertas]]. Sus herramientas entran por la puente como todo lo demás.
- **[TCO: API, nube o servidor propio](/costo-total/)** suma las ≈ 16 horas de TI al mes de esta lección al costo de operar, junto con la luz, y la cuarta L40S como seguro de las actualizaciones.
- **[Cotizar, proponer y dar soporte](/cotizar/)** convierte el ciclo de actualizaciones en la [[iguala|iguala]] de soporte y resuelve cómo da soporte un proveedor a un servidor sin salida: con una puerta que abre el cliente cada vez.
- De esta app: [Gateway](/gateway/), [RAG privado](/rag-privado/), [Agentes](/agentes/), [Evals](/evals/) (el gate de cada actualización) y [El cuarto](/el-cuarto/) (el BMC y el colocation).
- En Sensei: [Ataques y cadena de suministro](https://sensei.trueml.app/ataques/), [Cifrado, llaves y certificados](https://sensei.trueml.app/cifrado/), [Autenticación y permisos](https://sensei.trueml.app/identidad/), [Datos personales y la ley](https://sensei.trueml.app/privacidad/) y [Redes en la nube](https://sensei.trueml.app/redes-nube/); para el rollout de una réplica a la vez, [Rollout seguro](https://sensei.trueml.app/e10-rollout/).

## Palabras que vas a oír {Words you'll hear}

:::conceptos
aislamiento modelo-de-amenazas segmentacion-de-red vlan firewall-de-salida air-gapped maquina-puente mirror-local registro-de-contenedores digest firma-de-artefactos sbom cve kev parche ventana-de-mantenimiento cifrado-en-reposo respaldo
:::

## Chequeo {Check}

:::chequeo
? ¿Por qué la segmentación protege más que la `--api-key` de vLLM?
Porque la llave no cubre todas las rutas y en 2026 se pudo esquivar (CVE-2026-48746). Si nadie más que el gateway alcanza el puerto, una falla de vLLM no es alcanzable desde la oficina, con llave o sin ella.
? ¿Qué quiere decir «el servidor de modelos no tiene ruta a internet», en dos candados?
El firewall de su zona niega toda salida (salvo el registro local), y el propio servidor no tiene puerta de enlace: no conoce ningún camino hacia afuera.
? ¿Por qué el despacho no es air-gapped, y qué sí puede prometer?
Porque su servidor de modelos está conectado a una red con el gateway (conexión automática) y el gateway habla con Microsoft. Puede prometer que el servidor que lee los expedientes no tiene ninguna ruta a internet.
? ¿Qué es un digest, y por qué se fija la imagen por digest y no por etiqueta?
La huella SHA-256 del contenido de la imagen. Una etiqueta es un nombre que el autor puede mover; el digest cambia si cambia un solo byte, y permite regresar a la versión exacta anterior.
? ¿Qué tres preguntas deciden si un aviso se mitiga ya, se parcha en la ventana o espera al ciclo mensual?
¿Tengo la versión afectada? ¿Es alcanzable desde una zona no confiable? ¿Se sabe que se está explotando (por ejemplo, está en el catálogo KEV)?
? Con 3 L40S, ¿se puede actualizar una réplica en la hora pico? ¿Y con 4?
Con 3, no: quedan ≈ 533 preguntas/h contra 750. Con 4, sí: quedan 800.
? ¿Qué hay que respaldar para que «el índice se reconstruye» sea verdad en una noche?
El texto que salió de leer los expedientes (≈ 4.8 GB): con él, solo se rehacen los embeddings (≈ 1.8–4.3 h); sin él, se vuelven a leer 1.5 M de páginas (hasta ≈ 14 noches).
:::
