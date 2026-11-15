# Correcciones de hechos que encontraron las revisiones de Sensei

Fecha: 2026-11-15. Rama: parte de `claude/sensei-fase-16-5ce5d7` (096edb4).

**De dónde salen.** Cada fase de Sensei tuvo una revisión de hechos con una sección «Para la Ronda». Están en `apps/sensei/.solo/fase*/revision/*-hechos.md`, que no está en git, en estos worktrees:

- fase 8: `sensei-fase-8-b3cb7c`
- fase 9: `gifted-shaw-d558a2`
- fase 10: `sensei-fase-10-028467`
- fase 11: `sensei-fase-11-3a6aae`
- fases 12 y 13: `sensei-fase-12-13-6ca582`
- fase 14: `sensei-fase-14-7844ce`
- fase 15: `sensei-fase-15`

Las copias de plantilla en los worktrees de las fases siguientes son iguales byte por byte, así que no se contaron dos veces.

**Cómo se trabajó.**
1. Se juntaron las anotaciones sin repetir: 65 en total.
2. Se buscó cada una en `js/content/*.js` y en `reference/`.
3. Se revisó con fuente primaria que la Ronda siguiera diciendo lo mismo y que la fuente lo respaldara. Las fuentes fueron docs oficiales, código fuente, el JSON del Spot Advisor y textos de ley en DOF y EUR-Lex.
4. Se corrigió lo mínimo, con el estilo de la Ronda.

**Resultado.**
- **35 se aplicaron**, en 23 archivos de contenido y código, más `reference-files.js` regenerado.
- **30 se descartaron**: la Ronda no lo dice, ya estaba bien, o la anotación no se sostuvo.

Se regeneró `reference-files.js` con `npm run embed`. Pasan `npm test` (21), `npm run validate` (0 avisos), `npm run build:vercel` y `npm run smoke` (563/563). El YAML del Rollout de M11 se revisó con un parser de YAML.

**Corrección posterior.** La C1 (forma shell de `CMD`) se aplicó en 3a58647 y salió en el deploy `dpl_Doc3GmeG9xDkcYRJxePH5HoVbcTp`. Luego se revirtió, porque el `sh` de Debian no hace ese exec. Está en la tabla de descartadas.

**Dónde difiere de la anotación original.**
- **RG4:** la revisión decía ≈ 60 s; con los valores del AWS Load Balancer Controller, que es lo que usa c01, son ≈ 30 s.
- **A4:** la revisión decía ≈ 450 B; la cuenta sobre el código da ≈ 350–360 B.
- **K4:** se usó 36, como proponía la revisión, y se dice que con el nodo de reserva serían 40.
- **T1:** no se cambiaron las cifras de precio spot, porque el JSON del Advisor dice `Last-Modified` 20-mar-2026 y no se pudo confirmar que esté al día. Solo se agregó la frecuencia de interrupción.

## Aplicadas

### G2 · fase 8 · gestionados

**Qué estaba mal:** Cloud Run con GPU cobra toda la vida de la instancia y la deja ociosa hasta ≈ 10 min; US$1.05/h es la L4 sin redundancia zonal (con ella, la opción por omisión, ≈ US$1.42/h).

**Fuente:** https://cloud.google.com/run/pricing · https://docs.cloud.google.com/run/docs/configuring/services/gpu («GPU is billed for the entire duration of the instance lifecycle»; «By default, zonal redundancy is turned on») · https://docs.cloud.google.com/run/docs/about-instance-autoscaling («10 minutes for GPUs»)

- `js/content/m06-orquestacion.js`
  - antes: «{ label: 'Instancia de Cloud Run con L4', expr:»
  - después: «{ label: 'Instancia de Cloud Run con L4, sin redundancia zonal', expr:»
- `js/content/m06-orquestacion.js`
  - antes: «expr: '20,000 imágenes al día, repartidas en ≈ 2 h de uso', value: 'GPU activa ≈ 2 h/día', note: 'supuesto: incluye el rato ocioso antes de apagarse' }»
  - después: «expr: '20,000 imágenes al día, en lotes que suman ≈ 2 h de uso', value: 'GPU facturada ≈ 2 h/día', note: 'supuesto: incluye el arranque y el rato ocioso tras cada lote (con GPU, Cloud Run cobra la instancia encendida y la deja ociosa hasta ≈ 10 min); si las imágenes llegan sueltas todo el día, la instancia casi no se apaga y la cuenta se multiplica' }»
- `js/content/m06-orquestacion.js`
  - antes: «{ label: 'Cloud Run con L4', expr: '2 h × 1.05 × 30 días', value: est('≈ US$63/mes') }»
  - después: «{ label: 'Cloud Run con L4, sin redundancia zonal', expr: '2 h × 1.05 × 30 días', value: est('≈ US$63/mes'), note: 'con redundancia zonal, la opción por omisión, ≈ US$1.42/h: ≈ US$85/mes' }»
- `js/content/m06-orquestacion.js`
  - antes: «value: '≈ 18 h de GPU activa al día' }»
  - después: «value: '≈ 18 h facturadas al día', note: '≈ 14 h con redundancia zonal' }»
- `js/content/m06-orquestacion.js`
  - antes: «Si la GPU trabaja menos de ≈ 18 h al día, pagar por segundo gana»
  - después: «Si Cloud Run factura menos de ≈ 18 h al día, pagar por segundo gana»
- `js/content/ref-numeros.js`
  - antes: «'Por segundo; ese mensual es si nunca se apaga (<a href="#m06.serverless">M6</a>)'»
  - después: «'Por segundo, sin redundancia zonal (con ella, la opción por omisión, ≈ 1.42); cobra la instancia encendida, ociosa incluida; ese mensual es si nunca se apaga (<a href="#m06.serverless">M6</a>)'»
- `js/content/banco-estimaciones.js`
  - antes: «<li>Cloud Run con L4 ≈ US$1.05/h, por segundo.</li>»
  - después: «<li>Cloud Run con L4 ≈ US$1.05/h sin redundancia zonal (≈ 1.42 con ella), por segundo de instancia encendida, ociosa incluida.</li>»
- `js/content/banco-proyectos.js`
  - antes: «que escala a cero: ≈ US$1.05/h por instancia encendida.</li>»
  - después: «que escala a cero: ≈ US$1.05/h por instancia encendida (sin redundancia zonal).</li>»

### G3 · fase 8 · gestionados

**Qué estaba mal:** 248 + 73 + 500 + 100 = 921, no 924. Los totales (≈ 1.7k, ≈ 3.2k, 1.9×) no cambian.

**Fuente:** Aritmética interna (partidas de c01.costo)

- `js/content/m13-nube.js`
  - antes: «(${E('≈ US$924/mes')})»
  - después: «(${E('≈ US$921/mes')})»
- `js/content/m13-nube.js`
  - antes: «expr: '768 + 924 vs 2,287 + 924'»
  - después: «expr: '768 + 921 vs 2,287 + 921'»

### M1 · fase 8 · máquinas

**Qué estaba mal:** Un CUD de GPUs por recursos de Google exige adjuntar una reserva, así que sí aparta capacidad; el CUD flexible no.

**Fuente:** https://docs.cloud.google.com/compute/docs/committed-use-discounts/purchase-commitments-with-reservations («you must reserve those resources and attach the reservations»)

- `js/content/m13-nube.js`
  - antes: «['¿Garantiza que haya GPUs?', '<b>No</b>', 'Sí, en una zona', 'Sí, en las fechas compradas'],»
  - después: «['¿Garantiza que haya GPUs?', '<b>No</b>; la excepción es un CUD de GPUs por recursos, que exige adjuntar una reserva (el CUD flexible no aparta nada)', 'Sí, en una zona', 'Sí, en las fechas compradas'],»

### M2 · fase 8 · máquinas

**Qué estaba mal:** 1 − 0.27/0.526 = 48.7 % ≈ 49 %, no 48 %.

**Fuente:** Aritmética sobre la tabla de m13.spot

- `js/content/m13-nube.js`
  - antes: «['g4dn.xlarge (T4)', '0.526', E('≈ 0.27'), E('≈ 48 %')],»
  - después: «['g4dn.xlarge (T4)', '0.526', E('≈ 0.27'), E('≈ 49 %')],»
- `js/content/m13-nube.js`
  - antes: «{ label: 'c01: esa ráfaga en spot (≈ 48 %)', expr: '126 × 0.48'»
  - después: «{ label: 'c01: esa ráfaga en spot (≈ 49 %)', expr: '126 × 0.49'»
- `js/content/m13-nube.js`
  - antes: «una foto en us-east-1 daba ≈ 48 % en g4dn.xlarge»
  - después: «una foto en us-east-1 daba ≈ 49 % en g4dn.xlarge»
- `js/content/ref-numeros.js`
  - antes: «≈ 48 % en g4dn»
  - después: «≈ 49 % en g4dn»
- `js/content/banco-estimaciones.js`
  - antes: «g4dn ≈ 0.27 (≈ 48 % menos)»
  - después: «g4dn ≈ 0.27 (≈ 49 % menos)»
- `js/content/c01-clasificacion.js` y `js/content/c02-video.js` (mismo cambio en los dos)
  - antes: «en g4dn/g5 se observó ≈ 48–54 %»
  - después: «en g4dn/g5 se observó ≈ 49–54 %»

### M4 · fase 8 · máquinas

**Qué estaba mal:** Con US$0.80/h, 10 GPUs dan 5.84k, no 5.9k; con 0.805 (el precio de ref-numeros) cuadra todo: 5.9k, 3.5k y 2.35k.

**Fuente:** https://instances.vantage.sh/aws/ec2/g6.xlarge (US$0.8048/h; agregador) + ref-numeros

- `js/content/c06-moderacion.js`
  - antes: «expr: '10 × g6.xlarge × ' + E('US$0.80/h') + ' × 730 h'»
  - después: «expr: '10 × g6.xlarge × ' + E('US$0.805/h') + ' × 730 h'»
- `js/content/c06-moderacion.js`
  - antes: «'6 × g6.xlarge (4 texto + 2 imagen) × ' + E('US$0.80/h') + ' × 730 h, 24/7'»
  - después: «'6 × g6.xlarge (4 texto + 2 imagen) × ' + E('US$0.805/h') + ' × 730 h, 24/7'»
- `js/content/c06-moderacion.js`
  - antes: «['GPUs etapa 2', '4 × g6.xlarge × US$0.80/h × 730 h', E('≈ US$2.3k')],»
  - después: «['GPUs etapa 2', '4 × g6.xlarge × US$0.805/h × 730 h', E('≈ US$2.35k')],»
- `js/content/c06-moderacion.js`
  - antes: «expr: 'US$2.3k ÷ (5.4 M × 30)', value: '≈ US$0.000014'»
  - después: «expr: 'US$2.35k ÷ (5.4 M × 30)', value: '≈ US$0.000015'»

### M5 · fase 8 · máquinas

**Qué estaba mal:** 56 GPU-h × US$0.752 = US$42, no 40.

**Fuente:** https://instances.vantage.sh/aws/ec2/g4dn.2xlarge (on-demand US$0.752)

- `js/content/c01-clasificacion.js`
  - antes: «value: E('≈ 56 h → ≈ US$40 on-demand, menos en spot')»
  - después: «value: E('≈ 56 h × US$0.752 ≈ US$42 on-demand, menos en spot')»
- `js/content/c01-clasificacion.js`
  - antes: «GPU ${E('≈ US$40')}, lecturas de S3»
  - después: «GPU ${E('≈ US$42')} on-demand, lecturas de S3»

### N1 · fase 8 · nube

**Qué estaba mal:** Desde 2024 AWS, Google Cloud y Azure no cobran el egress si sales por completo y lo pides; copiar para quedarte sí se cobra.

**Fuente:** https://aws.amazon.com/blogs/aws/free-data-transfer-out-to-internet-when-moving-out-of-aws/ · https://cloud.google.com/blog/products/networking/eliminating-data-transfer-fees-when-migrating-off-google-cloud · aviso de Azure del 13-mar-2024 (visto en resultados de búsqueda)

- `js/content/m13-nube.js`
  - antes: «def: 'El costo de salir de un proveedor: APIs propias, formatos, procesos de despliegue y egress para mover los datos. Se acota»
  - después: «def: 'El costo de salir de un proveedor: APIs propias, formatos y procesos de despliegue que hay que rehacer. El egress ya no es la barrera: desde 2024, AWS, Google Cloud y Azure no lo cobran si te vas por completo y lo pides a soporte; copiar datos para quedarte sí se cobra. Se acota»

### R1 · fase 8 · redes

**Qué estaba mal:** AWS tiene NAT gateway regional desde el 19-nov-2025: un solo recurso que se extiende a cada zona y mantiene la afinidad por zona.

**Fuente:** https://aws.amazon.com/about-aws/whats-new/2025/11/aws-nat-gateway-regional-availability · https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateways-regional.html

- `js/content/m13-nube.js`
  - antes: «<p>Un NAT por cuenta "para ahorrar"»
  - después: «<p>Un solo NAT zonal "para ahorrar"»
- `js/content/m13-nube.js`
  - antes: «El diseño estándar es un NAT por zona (<a href="#m06.alta-disponibilidad">M6</a>), y lo pesado no pasa por ninguno.</p>»
  - después: «El diseño estándar es un NAT por zona (<a href="#m06.alta-disponibilidad">M6</a>) o, desde noviembre de 2025, un NAT gateway regional: un solo recurso que AWS extiende a cada zona con workloads y que mantiene el tráfico en su zona. En los dos casos, lo pesado no pasa por el NAT.</p>»
- `js/content/m13-nube.js`
  - antes: «en el diseño real hay un NAT por zona, porque si hay uno solo para dos zonas, el tráfico de la AZ b además cruza de AZ.»
  - después: «en el diseño real hay un NAT por zona (o uno regional, que AWS extiende a cada zona), porque si hay uno solo zonal para dos zonas, el tráfico de la AZ b además cruza de AZ.»

### R2 · fase 8 · redes

**Qué estaba mal:** La ráfaga de red dura «typically from 5 to 60 minutes», es best effort y el límite va por sentido.

**Fuente:** https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-network-bandwidth.html

- `js/content/ref-numeros.js`
  - antes: «'g4dn.xlarge 5 Gb/s (ráfaga hasta 25) · g5.xlarge y g6.xlarge 2.5 (hasta 10) · c6i.xlarge 1.56 (hasta 12.5)'»
  - después: «'g4dn.xlarge 5 Gb/s (ráfaga hasta 25) · g5.xlarge y g6.xlarge 2.5 (hasta 10) · c6i.xlarge 1.56 (hasta 12.5); por sentido (entrada y salida por separado); la ráfaga dura típicamente 5–60 min y es best effort'»
- `js/content/c01-clasificacion.js`
  - antes: «E('≈ 154 %: burst por minutos hasta que llegue otro nodo')»
  - después: «E('≈ 154 %: burst (best effort, típicamente 5–60 min) hasta que llegue otro nodo')»

### RG4 · fase 8 · regiones

**Qué estaba mal:** El ALB saca una zona tras 2 checks fallidos seguidos: ≈ 30 s con los valores del AWS Load Balancer Controller (cada 15 s), ≈ 60 s en un target group creado directo (cada 30 s). La revisión decía 60 s; c01 usa el controller.

**Fuente:** https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/ingress/annotations/ (interval '15', unhealthy-threshold '2') · https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html (30 s, 2)

- `js/content/m06-orquestacion.js`
  - antes: «si una zona entera falla, deja de enviarle en cuanto los checks fallan.'»
  - después: «si una zona entera falla, deja de enviarle cuando los checks fallan 2 veces seguidas: ≈ 30 s con los valores por omisión del AWS Load Balancer Controller (un check cada 15 s), ≈ 60 s en un target group creado directo en AWS (cada 30 s).'»
- `js/content/m06-orquestacion.js`
  - antes: «text: 'Los health checks de los targets de 1a fallan y el ALB manda todo a 1b.'»
  - después: «text: 'Los health checks de los targets de 1a fallan dos veces seguidas (≈ 30 s con los valores por omisión) y el ALB manda todo a 1b.'»
- `js/content/m06-orquestacion.js`
  - antes: «El ALB deja de mandar tráfico a los targets de esa zona en cuanto fallan sus health checks.»
  - después: «El ALB deja de mandar tráfico a los targets de esa zona cuando fallan dos health checks seguidos: ≈ 30 s con los valores por omisión del controller, y mientras tanto fallan los requests que van a esa zona.»

### S1 · fase 9 · ataques

**Qué estaba mal:** ShellTorch es un grupo de fallas: API de administración en 0.0.0.0 por omisión, CVE-2023-43654 (9.8 en la NVD; GitHub 10.0) y CVE-2022-1471 (SnakeYAML). La 0.8.2 trajo parches, no «lo corrigió» todo.

**Fuente:** https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2023-43654 · https://github.com/pytorch/serve/releases/tag/v0.8.2 · https://www.oligo.security/blog/shelltorch-torchserve-ssrf-vulnerability-cve-2023-43654

- `js/content/m07-servidores.js`
  - antes: «la de administración fue la puerta de ShellTorch (CVE-2023-43654, CVSS 9.8).»
  - después: «la de administración fue la puerta de ShellTorch: escuchaba en 0.0.0.0 por omisión, descargaba modelos de cualquier URL (CVE-2023-43654, 9.8 en la NVD) y un YAML malicioso ejecutaba código vía SnakeYAML (CVE-2022-1471).»
- `js/content/m07-servidores.js`
  - antes: «ShellTorch (CVE-2023-43654, CVSS 9.8) permitía ejecutar código remoto a través de la API de administración; se corrigió en la 0.8.2 porque el proyecto estaba vivo.»
  - después: «ShellTorch (un grupo de fallas: la API de administración abierta en 0.0.0.0 por omisión, CVE-2023-43654, con 9.8 en la NVD, y CVE-2022-1471 de SnakeYAML) permitía ejecutar código remoto a través de la API de administración; la 0.8.2 trajo los parches porque el proyecto estaba vivo.»
- `js/content/m07-servidores.js`
  - antes: «sin descargas de modelos desde URLs arbitrarias (ShellTorch fue eso)»
  - después: «sin descargas de modelos desde URLs arbitrarias (la puerta principal de ShellTorch)»

### S2 · fase 9 · cifrado

**Qué estaba mal:** Cada una de las dos primeras rotaciones suma US$1/mes (tope US$3 por llave) y hay 20,000 requests gratis al mes.

**Fuente:** https://aws.amazon.com/kms/pricing/

- `js/content/m15-seguridad.js`
  - antes: «El costo de KMS (${E('US$1 por llave al mes')} y ${E('US$0.03 por 10,000 requests')})»
  - después: «El costo de KMS (${E('US$1 por llave al mes')}, más US$1 por cada una de sus dos primeras rotaciones, con tope de US$3, y ${E('US$0.03 por 10,000 requests')}, con 20,000 gratis al mes)»
- `js/content/m15-seguridad.js`
  - antes: «KMS (US$1 por llave al mes, US$0.03 por»
  - después: «KMS (US$1 por llave al mes, +US$1 por cada una de las 2 primeras rotaciones, tope US$3; 20,000 requests gratis al mes; US$0.03 por»

### S3 · fase 9 · cifrado

**Qué estaba mal:** La política por omisión de una llave KMS delega en IAM: una política de IAM con kms:Decrypt basta.

**Fuente:** https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-default.html

- `js/content/m15-seguridad.js`
  - antes: «aunque alguien obtenga lectura sobre el bucket, sin permiso sobre la llave no descifra nada.»
  - después: «aunque alguien obtenga lectura sobre el bucket, sin permiso sobre la llave no descifra nada. Ojo: la política que KMS pone por omisión delega en IAM, así que cualquier política de IAM con <code>kms:Decrypt</code> basta; para que la llave decida de verdad, su política nombra los roles.»

### S6 · fase 9 · identidad

**Qué estaba mal:** El ALB verifica siempre firma, iss y exp; aud solo como claim adicional configurado; solo RS256 con JWKS público; reenvía el token tal cual, sin header de identidad.

**Fuente:** https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-verify-jwt.html

- `js/content/m15-seguridad.js`
  - antes: «The load balancer validates the JWT signature, expiry and audience before the request reaches us.»
  - después: «The load balancer validates the JWT signature, issuer and expiry, plus the audience claim we configured, before the request reaches us.»
- `js/content/m15-seguridad.js`
  - antes: «<p>El ALB valida firma, expiración y claims. Un request sin token válido nunca llega al gateway.»
  - después: «<p>El ALB valida siempre la firma, <code>iss</code> y <code>exp</code>; <code>aud</code> solo si lo agregas como claim adicional (agrégalo). Un request sin token válido nunca llega al gateway, y uno válido llega con el token tal cual, sin ningún header de identidad.»
- `js/content/m15-seguridad.js`
  - antes: «verifica JWTs de forma nativa desde noviembre de 2025 (firma, expiración y claims)»
  - después: «verifica JWTs de forma nativa desde noviembre de 2025 (solo RS256, con el JWKS en una URL pública: firma, emisor, expiración y los claims que configures)»

### S7 · fase 9 · identidad

**Qué estaba mal:** La vida del JWT se contradecía (≈ 5–60 min contra ≈ 15–60 min) y es configurable; por omisión Entra ID da 60–90 min al azar y Auth0 24 h.

**Fuente:** https://learn.microsoft.com/en-us/entra/identity-platform/configurable-token-lifetimes · https://auth0.com/docs/secure/tokens/access-tokens/update-access-token-lifetime

- `js/content/m15-seguridad.js`
  - antes: «Por eso su vida es corta (${E('≈ 5–60 min')}) y lo normal es dejar de emitirle tokens a ese cliente.»
  - después: «Por eso se le da una vida corta, que se configura en el emisor (${E('≈ 15–60 min')}; los valores por omisión varían: Entra ID da 60–90 min al azar y Auth0, 24 h para APIs propias), y lo normal es dejar de emitirle tokens a ese cliente.»

### P1 · fase 9 · privacidad

**Qué estaba mal:** Para la LFPDPPP, mandar datos a un encargado (cloud, vendor) es remisión, no transferencia: no pide consentimiento, sí contrato. Transferencia es hacia otro responsable.

**Fuente:** LFPDPPP (DOF 20-03-2025, última reforma 14-11-2025), art. 2 fr. XX y art. 35: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf · Reglamento 2011, arts. 2 fr. IX, 51 y 53: https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LFPDPPP.pdf

- `js/content/m15-seguridad.js`
  - antes: «{ t: 'h3', text: 'Transferencias entre países' },»
  - después: «{ t: 'h3', text: 'Datos que salen del país' },»

### P1-P2 · fase 9 · privacidad

**Qué estaba mal:** Remisión contra transferencia (ver P1). GDPR: además de adecuación y cláusulas tipo, hay BCR y otras garantías del art. 46 y las excepciones del art. 49.

**Fuente:** LFPDPPP y su reglamento (ver P1) · RGPD arts. 46 y 49: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679

- `js/content/m15-seguridad.js`
  - antes: «Mandar datos personales a otro país es una transferencia con reglas propias: en el GDPR, solo a países con decisión de adecuación o con garantías como las cláusulas contractuales tipo; la LFPDPPP también regula las transferencias y el aviso de privacidad. Los lugares donde pasa sin que lo notes:»
  - después: «Mandar datos personales a otro país tiene reglas propias. En el GDPR es una transferencia, y solo se permite a países con decisión de adecuación, con garantías adecuadas (cláusulas contractuales tipo, normas corporativas vinculantes) o, en casos puntuales, con las excepciones del art. 49. La LFPDPPP distingue dos cosas: mandarlos a un <b>encargado</b> que los trata por tu cuenta (el cloud, el vendor de etiquetado), aunque esté en otro país, es una <b>remisión</b>, que no pide el consentimiento del titular pero sí un contrato; una <b>transferencia</b> es darlos a otro responsable, con sus propias reglas de aviso y consentimiento. Los lugares donde los datos salen del país sin que lo notes:»

### P3 · fase 9 · privacidad

**Qué estaba mal:** El aviso de 72 h no aplica si es improbable que la brecha cause un riesgo.

**Fuente:** RGPD art. 33(1): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679

- `js/content/m15-seguridad.js`
  - antes: «aviso de brechas a la autoridad en 72 h;»
  - después: «aviso de brechas a la autoridad en 72 h (salvo que sea improbable que la brecha cause un riesgo);»

### T1 · fase 11 · entrenamiento

**Qué estaba mal:** El Spot Instance Advisor pone g5 y g6 (y g6e) en el rango de interrupción más alto (> 20 %) y la g4dn en 10–15 %; da ≈ 56 % de ahorro en g5.xlarge. La Ronda no decía la frecuencia de interrupción.

**Fuente:** https://aws.amazon.com/ec2/spot/instance-advisor/ · JSON público https://spot-bid-advisor.s3.amazonaws.com/spot-advisor-data.json (Last-Modified 20-mar-2026: no se pudo confirmar que esté al día; por eso no se cambió la tabla de precios)

- `js/content/m13-nube.js`
  - antes: «Otro agregador mostraba para g6.xlarge una frecuencia de interrupción de más de 20 %.»
  - después: «El Spot Instance Advisor de AWS (promedio de 30 días) pone la g5, la g6 y la g6e en el rango de interrupción más alto (más de 20 %) y la g4dn en 10–15 %, y su ahorro tampoco coincide con esta foto (≈ 56 % en g5.xlarge). El descuento no es la única cifra: la frecuencia de interrupción decide cuánto trabajo repites.»
- `js/content/c01-clasificacion.js`
  - antes: «(supuesto: en g4dn/g5 se observó ≈ 48–54 %; varía mucho por familia»
  - después: «(supuesto: en g4dn/g5 se observó ≈ 48–54 %, y la g5 está en el rango de interrupción más alto del Spot Instance Advisor, más de 20 %; varía mucho por familia»
- `js/content/c02-video.js`
  - antes: «(supuesto: en g4dn/g5 se observó ≈ 48–54 % y en g6, ≈ 25 %;»
  - después: «(supuesto: en g4dn/g5 se observó ≈ 48–54 % y en g6, ≈ 25 %, con g5 y g6 en el rango de interrupción más alto del Spot Instance Advisor, más de 20 %;»
- `js/content/ref-numeros.js`
  - antes: «≈ 54 % en g5; us-east-1, oct. 2026); varía mucho por familia y zona»
  - después: «≈ 54 % en g5; us-east-1, oct. 2026; el Spot Instance Advisor pone la g5 en el rango de interrupción más alto, más de 20 %); varía mucho por familia y zona»
- `js/content/banco-estimaciones.js`
  - antes: «g6 ≈ 0.60 (≈ 25 %).</li>»
  - después: «g6 ≈ 0.60 (≈ 25 %). Interrupción (Spot Instance Advisor): g5 y g6 más de 20 %, g4dn 10–15 %.</li>»

### T4 · fase 11 · gate

**Qué estaba mal:** El ECE es un promedio pesado por el tamaño de cada bin; un bin con pocas predicciones puede separarse bastante más.

**Fuente:** Guo et al. 2017, https://arxiv.org/abs/1706.04599 · Nixon et al. 2019, https://arxiv.org/abs/1904.01685

- `js/content/c01-clasificacion.js`
  - antes: «Un ECE de 0.05 significa que, en promedio, el score se equivoca por ≈ 5 puntos de probabilidad.»
  - después: «Un ECE de 0.05 significa que, en promedio pesado por el tamaño de cada grupo, el score se separa ≈ 5 puntos de probabilidad de la accuracy real. Un grupo con pocas predicciones puede separarse bastante más: mira también el diagrama de confiabilidad.»

### T8 · fase 11 · export

**Qué estaba mal:** Un engine de TensorRT no es portable por defecto: hay version compatibility y hardware compatibility (solo Ampere en adelante, no la T4; no en JetPack). Por eso no se tocaron c03 ni m04 (Jetson).

**Fuente:** https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/engine-compatibility.html («By default, TensorRT engines are only compatible with the type of device where they were built»)

- `js/content/c01-clasificacion.js`
  - antes: «que un <b>engine de TensorRT no es portable</b> entre GPUs»
  - después: «que un <b>engine de TensorRT no es portable</b> por defecto entre GPUs»
- `js/content/m10-mlops.js`
  - antes: «El engine no es portable entre GPUs ni entre versiones de TensorRT»
  - después: «Por defecto, el engine no es portable entre GPUs ni entre versiones de TensorRT (y la T4 no tiene el modo compatible entre GPUs)»
- `js/content/m10-mlops.js`
  - antes: «porque un engine no es portable entre GPUs ni entre versiones de TensorRT»
  - después: «porque, por defecto, un engine no es portable entre GPUs ni entre versiones de TensorRT»
- `js/content/m10-mlops.js`
  - antes: «a: 'Un engine de TensorRT no es portable entre GPUs ni versiones de TensorRT.»
  - después: «a: 'Por defecto, un engine de TensorRT no es portable entre GPUs ni versiones de TensorRT (los modos compatibles se piden al construirlo y el de GPUs no cubre la T4).»
- `js/content/m07-servidores.js`
  - antes: «El engine no es portable entre GPUs ni entre versiones de TensorRT»
  - después: «Por defecto, el engine no es portable entre GPUs ni entre versiones de TensorRT»
- `js/content/m11-despliegue.js`
  - antes: «un engine de TensorRT no es portable, así que»
  - después: «un engine de TensorRT no es portable por defecto, así que»
- `js/content/m08-optimizacion.js`
  - antes: «y una versión de TensorRT: no es portable. Construyo»
  - después: «y una versión de TensorRT: por defecto no es portable. Construyo»
- `js/content/c02-video.js`
  - antes: «(un engine no es portable entre GPUs ni versiones)»
  - después: «(por defecto, un engine no es portable entre GPUs ni versiones)»
- `js/content/c04-segmentacion.js`
  - antes: «un engine no es portable entre GPUs ni versiones (»
  - después: «por defecto, un engine no es portable entre GPUs ni versiones (»
- `js/content/c13-transcripcion.js`
  - antes: «(TensorRT no es portable entre GPUs, »
  - después: «(por defecto, un engine de TensorRT no es portable entre GPUs, »
- `reference/c01/model/build_engine.sh`
  - antes: «Un engine no es portable: TensorRT elige»
  - después: «Por defecto un engine no es portable (y el modo compatible entre GPUs no cubre la T4): TensorRT elige»
- `reference/c02/README.md`
  - antes: «el engine no es portable entre GPUs ni versiones de TensorRT.»
  - después: «por defecto, el engine no es portable entre GPUs ni versiones de TensorRT.»
- `reference/c04/worker/Dockerfile`
  - antes: «EN una L4. Un engine ⏎ # no es portable»
  - después: «EN una L4. Por defecto, un engine ⏎ # no es portable»
- `reference/c04/worker/worker.py`
  - antes: «TensorRT 11.2.1.2). Un engine no es ⏎     portable»
  - después: «TensorRT 11.2.1.2). Por defecto, un engine no es ⏎     portable»

### O1 · fase 15 · monitoreo

**Qué estaba mal:** Con ≈ 10 M predicciones al día el ruido de 500 bins en el PSI diario es ≈ 0.00005; el argumento del ruido vale para el canary horario y los slices.

**Fuente:** Fórmula del piso de ruido que la Ronda ya usa en c01 ((K−1)(1/n₁ + 1/n₂))

- `js/content/c01-clasificacion.js`
  - antes: «Con 500 categorías, las de pocos ejemplos meten ruido (un bin con 0 ejemplos hace explotar el logaritmo): suaviza con un epsilon o calcula el PSI sobre las ≈ 30 categorías padre.»
  - después: «Con ≈ 10 M predicciones al día, el ruido de muestreo de 500 categorías en el PSI diario es despreciable (≈ (K−1)/n ≈ 0.00005); lo que sí rompe es un bin con 0 ejemplos, que hace explotar el logaritmo: suaviza con un epsilon. Las ≈ 30 categorías padre sirven donde n es chico: el canary de una hora y los slices.»
- `js/content/m12-monitoreo.js`
  - antes: «<li><b>Muchos bins con pocos datos</b>: con 500 categorías en c01, las raras meten ruido; c01 lo resuelve con las ≈ 30 categorías padre.</li>»
  - después: «<li><b>Muchos bins con pocos datos</b>: el ruido del PSI crece con los bins y baja con n, ≈ (K−1)(1/n<sub>actual</sub> + 1/n<sub>ref</sub>). En el job diario de c01 (≈ 10 M predicciones), 500 categorías aportan ≈ 0.00005: nada. En el canary de una hora (3,600–7,200 predicciones) aportan 0.07–0.14, y por eso ahí c01 usa las ≈ 30 categorías padre.</li>»

### A1 · fase 12 · serving

**Qué estaba mal:** Con el AWS Load Balancer Controller en modo ip, un pod NotReady se da de baja del target group; sin targets registrados el ALB contesta 503 él mismo; con targets registrados y todos unhealthy, falla abierto. La Ronda ya estaba bien; se aclara el porqué.

**Fuente:** https://github.com/kubernetes-sigs/aws-load-balancer-controller/blob/main/pkg/backend/endpoint_resolver.go (`if !pod.IsContainersReady() { continue }`) · https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html («fails open»)

- `js/content/c01-archivos.js`
  - antes: «Si Triton cae, todos los gateways quedan NotReady, el ALB se queda sin targets y responde 503 él mismo:»
  - después: «Si Triton cae, todos los gateways quedan NotReady, el AWS Load Balancer Controller (target-type ip) los da de baja del target group y el ALB, sin targets registrados, responde 503 él mismo (si siguieran registrados y todos fallaran el health check, fallaría abierto):»

### A2 · fase 12 · serving

**Qué estaba mal:** La doc de Triton aconseja no poner preferred_batch_size en la mayoría de los modelos.

**Fuente:** https://github.com/triton-inference-server/server/blob/main/docs/user_guide/batcher.md («For most models, preferred_batch_size should not be specified»)

- `js/content/m03-latencia.js`
  - antes: «Triton también acepta <code>preferred_batch_size</code> (formar batches de los tamaños en que el engine rinde mejor)»
  - después: «Triton también acepta <code>preferred_batch_size</code> (formar batches de los tamaños en que el engine rinde mejor; su documentación aconseja no ponerlo en la mayoría de los modelos, salvo engines con varios perfiles por tamaño)»

### A3 · fase 12 · serving

**Qué estaba mal:** gRPC solo deja una GPU ociosa con más de una Triton por zona (o tras un failover); con una por zona y ruteo por zona no cambia el reparto.

**Fuente:** reference/c01 (minReplicaCount 2, trafficDistribution: PreferSameZone) · https://kubernetes.io/docs/concepts/services-networking/service/#traffic-distribution

- `js/content/c01-archivos.js`
  - antes: «así que cada gateway queda pegado a un solo pod de Triton y la otra GPU se queda ociosa.»
  - después: «así que cada gateway queda pegado a un solo pod de Triton. Con una Triton por zona y ruteo por zona eso no cambia el reparto; el problema aparece con dos o más por zona (la que agrega KEDA no recibe tráfico) o después de un failover (las conexiones que se pasaron a la otra zona no regresan solas y una GPU queda ociosa).»

### A4 · fase 12 · serving

**Qué estaba mal:** La línea de log de c01 con las 5 sugerencias pesa ≈ 350–360 B (la revisión decía ≈ 450; la cuenta sobre el `record` de reference/c01/gateway/app/main.py da ≈ 360, ≈ 400 con el prefijo del runtime). Se corrige la descripción y se dejan las cuentas con la cifra redonda de M1 (≈ 300 B → ≈ 3 GB/día).

**Fuente:** Cuenta sobre el código de referencia

- `js/content/c01-clasificacion.js`
  - antes: «Unos 300 bytes.»
  - después: «Unos 350 bytes con las 5 sugerencias; las cuentas usan la cifra redonda de ≈ 300 B (<a href="#m01.estimaciones-express">M1</a>), y el resultado (≈ 3 GB/día) apenas se mueve.»

### A5 · fase 12 · serving

**Qué estaba mal:** c01 acepta fotos de hasta 40 MP: su decode cuesta más de 100 ms de CPU (medido: 94–187 ms), no «decenas de ms».

**Fuente:** reference/c01/gateway/app/main.py (MAX_PIXELS = 40,000,000) + medición local con el preprocess de c01; coincide con ref-numeros («más de 100 ms»)

- `js/content/m15-seguridad.js`
  - antes: «una foto web de 40 MP cuesta ${E('decenas de ms')} de CPU de decode»
  - después: «una foto web de 40 MP cuesta ${E('más de 100 ms')} de CPU de decode (≈ 3× los píxeles de una de 12 MP)»


### K1 · fase 14 · kubernetes

**Qué estaba mal:** Ante un Xid crítico el device plugin de NVIDIA marca la GPU como no sana y deja de ofrecerla a pods nuevos; el pod que la usa sigue.

**Fuente:** https://github.com/NVIDIA/k8s-device-plugin/blob/main/internal/rm/health.go («XidCriticalError … marking device as unhealthy»)

- `js/content/m06-orquestacion.js`
  - antes: «'Nada automático por defecto: el device plugin marca la GPU como no sana (no entran pods nuevos), pero el contenedor se reinicia»
  - después: «'Solo en parte: ante un Xid crítico, el device plugin marca la GPU como no sana y deja de ofrecerla a pods nuevos, pero el pod que la usa sigue ahí: el contenedor se reinicia»

### K3 · fase 14 · kubernetes

**Qué estaba mal:** Con la misma carga (5 pods × 90 %), 8 pods quedan al ≈ 56 %, no al 64 %.

**Fuente:** Aritmética del ejemplo de m06.hpa

- `js/content/m06-orquestacion.js`
  - antes: «8 pods al 64 %: 64 / 60 ≈ 1.07, dentro de la tolerancia de 10 %»
  - después: «misma carga en 8 pods: 5 × 90 / 8 ≈ 56 %; 56 / 60 ≈ 0.94, dentro de la tolerancia de 10 %»

### K4 · fase 14 · kubernetes

**Qué estaba mal:** La cuota del Hot Sale mezclaba criterios: con el de M13 (réplicas + surge + staging + CI) son (6 + 1 + 1 + 1) × 4 = 36 vCPU; 40 si también cuentas la reserva encendida.

**Fuente:** Aritmética contra m13.cuotas-regiones

- `js/content/m06-orquestacion.js`
  - antes: «y pido cuota para 8 × 4 = 32 vCPU de instancias G.»
  - después: «y pido cuota para (6 réplicas + 1 de surge + 1 de staging + 1 de CI) × 4 = 36 vCPU de instancias G, con el mismo criterio que los 28 de <a href="#m13.cuotas-regiones">M13</a> (40 si cuento también el nodo de reserva encendido).»

### K5 · fase 14 · kubernetes

**Qué estaba mal:** Las GPUs sí se pueden compartir con time-slicing del device plugin o MIG.

**Fuente:** https://github.com/NVIDIA/k8s-device-plugin (README: «Shared Access to GPUs … With CUDA Time-Slicing», MIG_STRATEGY)

- `js/content/ref-comandos.js`
  - antes: «GPUs todas asignadas (un pod, una GPU entera)»
  - después: «GPUs todas asignadas (un pod, una GPU entera, salvo time-slicing o MIG)»

### K6 · fase 14 · kubernetes

**Qué estaba mal:** La zona caída sigue contando en el spread mientras sus nodos sigan registrados: nodeTaintsPolicy: Ignore por defecto, y Karpenter cuenta las zonas del NodePool.

**Fuente:** https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/ · https://github.com/kubernetes-sigs/karpenter/blob/main/pkg/controllers/provisioning/scheduling/topology.go

- `js/content/m06-orquestacion.js`
  - antes: «con DoNotSchedule, la zona caída sigue contando en el spread y KEDA no puede poner un segundo Triton en la zona sana.»
  - después: «con DoNotSchedule, la zona caída sigue contando en el spread mientras sus nodos sigan registrados (<code>nodeTaintsPolicy: Ignore</code>, el default, no mira su taint de NotReady; y Karpenter cuenta las zonas del NodePool), así que KEDA no puede poner un segundo Triton en la zona sana.»

### K7 · fase 14 · rollout

**Qué estaba mal:** En Argo Rollouts el ReplicaSet viejo de un canary con trafficRouting se apaga a los 30 s (scaleDownDelaySeconds) y volver a una versión ya promovida re-corre pasos y análisis salvo rollbackWindow; con GitOps (revert + PR + sondeo de Argo CD) son minutos. Se agregan los dos campos al Rollout de M11 (YAML verificado con un parser).

**Fuente:** https://github.com/argoproj/argo-rollouts/blob/master/docs/features/specification.md («default 30 seconds») · https://github.com/argoproj/argo-rollouts/blob/master/docs/features/rollback.md («will execute the full list of steps, and perform analysis too») · https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/

- `js/content/c01-clasificacion.js`
  - antes: «Rollback: segundos si la release anterior sigue viva (canary o bake de 24–48 h);»
  - después: «Rollback: segundos durante el canary; después de promover, solo si la release anterior sigue viva (bake de 24–48 h, que en Argo Rollouts pide subir <code>scaleDownDelaySeconds</code>, 30 s por defecto, y <code>rollbackWindow</code>), más los minutos del revert en git con GitOps;»
- `js/content/c01-clasificacion.js`
  - antes: «Después de promover, la release anterior sigue viva 24–48 h y se vuelve con un cambio de ruteo;»
  - después: «Después de promover, la release anterior sigue viva 24–48 h (en Argo Rollouts hay que configurarlo: por defecto se apaga a los 30 s) y se vuelve con un cambio de ruteo;»
- `js/content/c01-clasificacion.js`
  - antes: «así que el rollback es un cambio de ruteo. Pasado ese plazo»
  - después: «así que el rollback es un cambio de ruteo (con <code>scaleDownDelaySeconds</code> subido y <code>rollbackWindow</code> para no repetir los pasos; con GitOps, más los minutos del revert y del sync). Pasado ese plazo»
- `js/content/m11-despliegue.js`
  - antes: «El rollback en ese plazo es un cambio de ruteo; pasado el plazo»
  - después: «El rollback en ese plazo es un cambio de ruteo de segundos si el Rollout lo permite (trampa de abajo); con GitOps súmale el revert, el PR y el sync de Argo CD (hasta ≈ 3 min): minutos. Pasado el plazo»
- `js/content/m11-despliegue.js`
  - antes: «la release anterior sigue viva por el bake, así que es un cambio de ruteo de segundos.»
  - después: «la release anterior sigue viva por el bake, así que el switch es de segundos (con el revert en git y el sync de Argo CD, unos minutos).»
- `js/content/m11-despliegue.js`
  - antes: «            - {name: MODEL_VERSION, value: "2026-10-01-resnet50-fp16"} ⏎   strategy: ⏎     canary: ⏎       canaryService: gateway-canary      # Service que ve solo los pods nuevos ⏎       stableService: gateway-stable      # Service que ve solo los pods estables ⏎ »
  - después: «            - {name: MODEL_VERSION, value: "2026-10-01-resnet50-fp16"} ⏎   rollbackWindow: {revisions: 2}         # volver a una de las 2 anteriores no repite pasos ni análisis ⏎   strategy: ⏎     canary: ⏎       canaryService: gateway-canary      # Service que ve solo los pods nuevos ⏎       stableService: gateway-stable      # Service que ve solo los pods estables ⏎       scaleDownDelaySeconds: 86400       # bake de 24 h: la release anterior sigue viva (por defecto, 30 s) ⏎ »

### K8 · fase 14 · rollout

**Qué estaba mal:** La trampa de los 30 s vale también para el canary con trafficRouting, no solo para blue/green.

**Fuente:** https://github.com/argoproj/argo-rollouts/blob/master/docs/features/specification.md

- `js/content/m11-despliegue.js`
  - antes: «<p>En Argo Rollouts, la estrategia blue/green tiene <code>scaleDownDelaySeconds</code>, que por defecto es <b>30 segundos</b>: medio minuto después de promover, las réplicas de blue se reducen. Si tu plan de rollback es "volvemos a blue en segundos durante un día", súbelo y cuenta el costo.»
  - después: «<p>En Argo Rollouts, <code>scaleDownDelaySeconds</code> vale por defecto <b>30 segundos</b>, en blue/green y también en el canary con <code>trafficRouting</code> (el de c01): medio minuto después de promover, las réplicas de la versión anterior se reducen. Y volver a una versión ya promovida re-corre todos los pasos y el análisis, salvo que configures <code>rollbackWindow</code>. Si tu plan de rollback es "volvemos en segundos durante un día", sube el delay, agrega el window y cuenta el costo.»
- `js/content/m11-despliegue.js`
  - antes: «a: '30 segundos (scaleDownDelaySeconds). Si tu rollback cuenta con blue durante un día, súbelo y paga el costo.'»
  - después: «a: '30 segundos (scaleDownDelaySeconds; igual en el canary con trafficRouting). Si tu rollback cuenta con blue durante un día, súbelo y paga el costo.'»

### K9 · fase 14 · rollout

**Qué estaba mal:** Con la fórmula de dos proporciones de M11 (r = 19, 0.1 % → 0.2 %) salen 10,639–10,654 requests, no 10,700.

**Fuente:** Aritmética con la fórmula `n_por_brazo` de m11

- `js/content/m11-despliegue.js`
  - antes: «value: '≈ 10,700 requests'»
  - después: «value: '≈ 10,650 requests'»
- `js/content/m11-despliegue.js`
  - antes: «pide ≈ 10,700 requests»
  - después: «pide ≈ 10,650 requests»

## Descartadas

| Id | Anotación | Razón |
|---|---|---|
| G1 · fase 8 | Las láminas WSI de c04 caben en SageMaker AI Async (límite 1 GB) | No aparece: c04 no menciona SageMaker; m06 y m13 ya dan «hasta 1 GB» |
| G4 · fase 8 | Vertex AI se llama hoy Gemini Enterprise Agent Platform | Ya está bien en catalog, m06, m07 y m09 |
| M3 · fase 8 | c10: 4 × 55.04 × 730 = 160.7k, no 160.6k | c10 usa ≈ US$55/h (4 × 55 × 730 = 160,600 exacto), igual que `reference/c10/capacity/fleet_calc.py` y su test (`approx(160_600)`); pasar a 55.04 tocaría ≈ 15 lugares por un 0.07 % |
| M6 · fase 8 | L40S FP16 denso 366.5 → 362.05 | Ya dice ≈ 362 (c11) |
| M7 · fase 8 | Precios de RunPod son de Secure Cloud | No aparece RunPod |
| N2 · fase 8 | Tramos de egress en GiB | La revisión ya decía que no hay error: cambia < US$10 sobre ≈ US$4.3k |
| R3 · fase 8 | NAT en «EC2 - Other» | Correcto según AWS re:Post |
| R4 · fase 8 | c04 cuenta el mes con 30 días; ≈ 90 TB vs 91.5 TB | El mes de 30 días es la convención declarada de c04 (y de su ejercicio en el banco); los ≈ 90 TB son de c01 y 91.5 TB / US$1,830 caben en «≈ 90 TB → ≈ US$1,800» |
| RG1 · fase 8 | Infra de c01 «≈ US$1.75k» vs 1,689 | c01 ya dice «≈ US$1.69k + EBS, NAT, transferencia»: dos NAT zonales ya son ≈ US$66 más EBS; el 34 % de M15 sale de 1.75k |
| RG2 · fase 8 | EKS 99.95 % del control plane estándar | La revisión ya decía que M15 está bien |
| RG3 · fase 8 | Letras de zona iguales en cuentas nuevas | La Ronda no dice que `us-east-1a` cambie por cuenta |
| S4 · fase 9 | SSE-KMS con subida en partes pide `kms:Decrypt` | No aparece en c01; en c05, `docs-api` usa `put_object` simple y el worker ya tiene `kms:Decrypt` |
| S5 · fase 9 | ACM emite certificados de 198 días | La Ronda no da la vida de los certificados |
| S8 · fase 9 | El token «viaja siempre por HTTPS» | No aparece; c01 ya dice que el ALB termina TLS y M15, «mTLS dentro del cluster si hay mesh» |
| P4 · fase 9 | Seudónimo «siempre» dato personal (TJUE C-413/23 P) | La Ronda no dice «siempre»: dice que sigue siendo dato personal para quien tiene la llave, lo que coincide con la sentencia |
| P5 · fase 9 | LFPDPPP: consentimiento «expreso y por escrito»; lista de sensibles de 2025 | La Ronda no cita el tipo de consentimiento ni la lista de la ley |
| D1 · fase 10 | URL prefirmada de 15 min se firma al abrir cada foto | No aparece para el vendor; la única URL de 15 min (c02) ya se pide nueva en cada intento |
| D2 · fase 10 | `labeled/` con lifecycle de 90 días | Ningún lugar le da 90 días a `labeled/`; los 90 días de M12 son de los logs |
| D3 · fase 10 | `CopyObject` falla con `If-None-Match` exigido | Nadie publica el snapshot copiando |
| D4 · fase 10 | Delta/Iceberg: ramas y etiquetas | Ninguna tabla lo dice mal |
| T2 · fase 11 | MLflow 3.18.0 es la actual | «probado con 3.16.1» es un registro verdadero; en 3.18.0 `get_git_commit` sigue sin revisar el árbol sucio |
| T3 · fase 11 | «3–4 h» del fine-tune es un supuesto | Ya va marcado como estimación con `E()` |
| T5 · fase 11 | `source=f"{run.info.artifact_uri}/model"` con `log_model` en MLflow 3 | El snippet de M10 sube con `log_artifact(..., artifact_path="model")`, no con `log_model`: el source es correcto |
| T6 · fase 11 | Stages deprecados desde MLflow 2.9 | Correcto |
| T7 · fase 11 | Exportar sin `eval()` rompe el ONNX en general | M8 y c01 ya dan el matiz (TorchScript pone EVAL; `dynamo=True` es default desde PyTorch 2.9) |
| T9 · fase 11 | 24.5 M parámetros dentro del ONNX | 24,532,532 y 24,505,972 (con BN fundida) redondean igual a 24.5 M y 98 MB |
| C1 · fase 13 | En forma shell, el `sh` de Debian hace exec de un comando simple y el SIGTERM llega | **Falsa en Debian.** El dash de upstream sí hace ese exec, pero Debian lo desactiva con el parche `0004-SHELL-Disable-sh-c-command-sh-c-exec-command-optimiza.diff` (`evalstring(minusc, 0)`), que sigue en 0.5.12-12 (trixie) y 0.5.12-2 (bookworm): https://sources.debian.org/src/dash/0.5.12-12/debian/patches/. Medido en `python:3.13-slim` con `docker stop --stop-timeout 10`: con `sh -c 'python3 s.py'` el PID 1 es `/bin/sh`, tarda 10.15 s y sale con 137 (SIGKILL); en forma exec, 0.12 s. La Ronda ya decía lo correcto. Esta corrección se aplicó por error en 3a58647 y se revirtió en el commit siguiente |
| C2 · fase 13 | `python:3.13-slim` es Debian 13 | No aparece «bookworm» ni «Debian 12»; c06 y c07 ya dicen trixie |
| C3 · fase 13 | `concurrency` de GitHub Actions «pone en fila» | No aparece en la Ronda (el error está en la hoja de Git, ver abajo) |
| K2 · fase 14 | `rollout undo` con GitOps dura hasta el siguiente sync | ref-comandos ya distingue: «el próximo sync lo pisa; con auto-sync y self-heal, Argo CD lo revierte solo» |


## Fuera de la Ronda (no se tocaron)

- **Hoja de Git** (`apps/cheat-sheets/sheets/`, §10, `memo`): «`concurrency` pone a los deploys en fila» contradice su propia nota. Con la cola por omisión solo espera el más nuevo y los demás pendientes se cancelan. Corregirla obliga a reimprimir el PDF de esa hoja. Ya está corregida (con el PDF) en el commit 058025e de la rama `claude/fervent-napier-18290f`, sin fusionar ni desplegar; en esa misma rama, el Dojo conserva su texto, que era el correcto, y solo agrega la medición.
- **`reference/c01/k8s/gateway.yaml`:** el Ingress no configura ninguna acción `jwt-validation`, aunque M15 dice que el ALB de c01 valida el JWT. Falta revisar si el AWS Load Balancer Controller lo soporta por anotación.
- **Spot de g6 y g6e:** el Spot Instance Advisor (≈ 49 % y ≈ 50 %) no cuadra con la foto de m13.spot (≈ 25 % y ≈ 1 %). No se cambió porque no se pudo confirmar cuál fuente está al día.
- **Cuota de M13 (28 vCPU):** no cuenta el nodo GPU de reserva. Si c01 tiene uno siempre encendido (m06 dice que el NodePool «ya contaba surge y reserva»), serían 32.
