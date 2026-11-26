"""Arma kits/rag-golden/mundo/entrada/ a partir de una corrida real de la estación 3 (su probar.sh + probar-fallas.sh,
que dejan la mañana del 21 pasada y 9/9 en verde):

    bash ../rag-permisos-solucion/probar.sh /ruta/r3 && bash ../rag-permisos-solucion/probar-fallas.sh /ruta/r3
    python3 hacer_entrada.py /ruta/r3

Escribe:
- corpus-2026-11-21.json: el índice que dejó la estación 3 a las 10:30 (154 chunks, cada uno con su texto y su ACL).
- corpus-2026-11-22.json: la re-ingesta del 22 (una sección nueva que corre la numeración, una tabla editada, un
  documento borrado y dos chunks que se juntan).
- corpus-2026-11-23.json: la re-ingesta del 23, la de la falla «fuente-perdida» (chunks de 800 tokens: se juntan de dos en dos).
- directorio.json (el de las 10:30, con los cambios de la mañana) y directorio-0900.json (la foto de las 9:00).
- candidatos/expertos.jsonl: las preguntas que escribieron los expertos de cada equipo (con sus errores de verdad).
- afinado/ejemplos.jsonl: los ejemplos few-shot con los que el equipo del prompt afina.
- lote-2026-11-24.jsonl: el lote nuevo de la falla «casi-duplicadas».
"""
import copy
import json
import shutil
import sys
from pathlib import Path

R3 = Path(sys.argv[1]) if len(sys.argv) > 1 else sys.exit("uso: python3 hacer_entrada.py <carpeta de la estación 3>")
SAL = Path(__file__).resolve().parent.parent / "rag-golden" / "mundo" / "entrada"
D = "@marketplace.test"
sys.path.insert(0, str(R3))
from mundo import referencia as r3  # noqa: E402  — la verdad de la estación 3


def escribir(p: Path, d) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True) + "\n")


def jsonl(p: Path, filas) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("".join(json.dumps(f, ensure_ascii=False, sort_keys=True) + "\n" for f in filas))


def cuerpo(t: str) -> str:
    return t.split("\n\n", 1)[1] if "\n\n" in t else t


# ---------------------------------------------------------------- el corpus del 21
idx = json.loads((R3 / "indice" / "indice.json").read_text())
assert len(idx["chunks"]) == 154
c21 = {"version": "corpus-2026-11-21", "fecha": "2026-11-21T16:30:00Z",
       "chunks": {k: {f: v[f] for f in ("doc_id", "titulo", "texto", "acl", "url")} for k, v in sorted(idx["chunks"].items())}}


def por_doc(c: dict) -> dict:
    out = {}
    for k, v in sorted(c["chunks"].items()):
        out.setdefault(v["doc_id"], []).append((k, v))
    return out


def renumerar(doc_id: str, lista: list[dict]) -> dict:
    return {f"{doc_id}#{i:03d}": x for i, x in enumerate(lista)}


def juntar(a: dict, b: dict) -> dict:
    x = copy.deepcopy(a)
    x["texto"] = a["texto"] + "\n\n" + cuerpo(b["texto"])
    return x


# ---------------------------------------------------------------- la re-ingesta del 22
c22 = {"version": "corpus-2026-11-22", "fecha": "2026-11-22T15:00:00Z", "chunks": {}}
for doc, cs in por_doc(c21).items():
    xs = [copy.deepcopy(v) for _, v in cs]
    if doc == "drive:d16":                     # la minuta del 6 de noviembre se borró del Drive
        continue
    if doc == "wiki:1002":                     # una sección nueva arriba: la numeración de las demás se corre
        nueva = copy.deepcopy(xs[0])
        nueva["texto"] = ("Devoluciones › Quién puede pedirla\n\n## Quién puede pedirla\nLa pide quien compró. Si el pedido se marcó "
                          "como regalo, también la puede pedir quien lo recibió.")
        xs = [xs[0], nueva] + xs[1:]
    if doc == "wiki:1004":                     # la tabla de tiempos de reembolso cambió (el banco cambió sus plazos)
        assert "Tarjeta de crédito; Días hábiles para el reembolso: 5 a 10" in xs[1]["texto"]
        xs[1]["texto"] = xs[1]["texto"].replace("Tarjeta de crédito; Días hábiles para el reembolso: 5 a 10",
                                                "Tarjeta de crédito; Días hábiles para el reembolso: 7 a 12")
    if doc == "wiki:2010":                     # el chunker juntó dos secciones cortas en un chunk
        xs = [xs[0], juntar(xs[1], xs[2])] + xs[3:]
    c22["chunks"].update(renumerar(doc, xs))

# ---------------------------------------------------------------- la re-ingesta del 23 (la falla)
c23 = {"version": "corpus-2026-11-23", "fecha": "2026-11-23T15:00:00Z", "chunks": {}}
for doc, cs in por_doc(c22).items():
    xs = [v for _, v in cs]
    ys = [juntar(xs[i], xs[i + 1]) if i + 1 < len(xs) else copy.deepcopy(xs[i]) for i in range(0, len(xs), 2)]
    c23["chunks"].update(renumerar(doc, ys))

for c in (c21, c22, c23):
    escribir(SAL / "corpus" / f"{c['version']}.json", c)

# ---------------------------------------------------------------- el directorio
d0 = r3.directorio("2026-11-21T15:00:00Z")
d1 = r3.directorio("2026-11-21T16:30:00Z")
d1["foto"] = "2026-11-21T16:30:00Z"
escribir(SAL / "directorio-0900.json", d0)
escribir(SAL / "directorio.json", d1)

# ---------------------------------------------------------------- las preguntas de los expertos
SR = "No está en los documentos que puedo consultar."
EXP = {"soporte": "paula.vega", "operaciones": "sofia.leal", "legal": "irene.sol", "rh": "lucia.mora", "fraude": "raul.ortiz", "finanzas": "carmen.nava"}
C = []


def q(id_, equipo, persona, tipo, pregunta, respuesta, fuentes, origen="experto", **extra):
    correo = persona if "@" in persona else persona + D
    x = {"id": id_, "autor": EXP[equipo] + D, "origen": origen, "persona": correo, "tipo": tipo, "pregunta": pregunta,
         "respuesta": respuesta, "fuentes": fuentes, "corpus": "corpus-2026-11-21"}
    x.update(extra)
    C.append(x)


# directas: la respuesta está en un documento que la persona puede abrir
q("G-001", "soporte", "ana.ruiz", "directa", "¿En qué horario atiende soporte por teléfono?", "De 9:00 a 18:00, de lunes a viernes.", ["wiki:1001#001"])
q("G-002", "soporte", "elena.cruz", "directa", "¿Cuánto tarda en verse un reembolso a tarjeta de débito?", "De 3 a 7 días hábiles.", ["wiki:1004#001"])
q("G-003", "soporte", "marco.diaz", "directa", "¿Cuánto tarda un reembolso si pagó con tarjeta de crédito?", "De 5 a 10 días hábiles.", ["wiki:1004#001"])
q("G-004", "soporte", "tomas.rey", "directa", "¿Qué fotos pido cuando un producto llegó dañado?", "Dos fotos del producto y una de la caja; con eso se abre la devolución sin costo de envío para quien compra.", ["wiki:1008#000"])
q("G-005", "soporte", "diego.luna", "directa", "¿Hasta cuándo se puede cambiar la dirección de un pedido?", "Solo antes de que el pedido salga del almacén; después se ofrece recoger en sucursal.", ["wiki:1010#000"], origen="consulta")
q("G-006", "soporte", "ana.ruiz", "directa", "¿Qué datos de la tarjeta le pido a un cliente con un cobro duplicado?", "Los últimos 4 dígitos de la tarjeta y la fecha del cargo.", ["wiki:1015#000"])
q("G-007", "soporte", "elena.cruz", "directa", "¿En cuánto tiempo se reembolsa un cobro duplicado?", "De 1 a 3 días hábiles.", ["wiki:1015#000"])
q("G-008", "soporte", "marco.diaz", "directa", "¿Cuántas horas tiene un vendedor para contestar un mensaje antes de que soporte tome el caso?", "48 horas; si no contesta, soporte toma el caso y decide.", ["wiki:1014#000"])
q("G-009", "soporte", "tomas.rey", "directa", "¿Cuándo interviene el marketplace en una garantía?", "Solo si quien fabrica o quien vende no responde en 5 días hábiles.", ["wiki:1016#000"])
q("G-010", "soporte", "ana.ruiz", "directa", "¿Qué productos no se pueden devolver?", "Ropa interior y trajes de baño sin su etiqueta, software o tarjetas de regalo ya activadas y productos personalizados a pedido.", ["wiki:1002#002"])
q("G-011", "soporte", "diego.luna", "directa", "¿Desde cuándo se cuenta el plazo para devolver un producto?", "Desde el día en que quien compra lo recibió, con la fecha de entrega de la paquetería, no con la de compra.", ["wiki:1002#000"])
q("G-012", "soporte", "paula.vega", "directa", "¿Qué casos se escalan a líderes de soporte?", "Amenazas de demanda, pérdidas mayores a 20,000 pesos y cualquier caso con prensa o redes sociales.", ["wiki:1005#000"])
q("G-013", "soporte", "paula.vega", "directa", "¿Cuánto puede compensar un líder a un cliente Plata sin aprobación?", "Hasta 300 pesos en saldo.", ["wiki:1006#001"])
q("G-014", "soporte", "elena.cruz", "directa", "¿Cuántos cupones se pueden usar en un pedido?", "Uno por pedido, y no se combina con promociones de quien vende.", ["politicas:cupones.md#000"])
q("G-015", "soporte", "marco.diaz", "directa", "¿Desde qué monto el envío es gratis?", "En compras desde 599 pesos.", ["politicas:envios.md#000"])
q("G-016", "soporte", "tomas.rey", "directa", "Si el cliente pagó en tienda, ¿cómo le regresa el reembolso?", "Como saldo del marketplace.", ["politicas:reembolsos.md#000"], origen="consulta")
q("G-017", "soporte", "ana.ruiz", "directa", "¿Quién puede pedir la devolución de un pedido marcado como regalo?", "Quien lo recibe.", ["politicas:regalos.md#000"])
q("G-018", "operaciones", "hugo.salas", "directa", "¿Cuándo se cuenta el inventario de los almacenes propios?", "El último día hábil de cada mes; el acta firmada se escanea y se guarda en la unidad compartida de operaciones.", ["wiki:2004#000"])
q("G-019", "operaciones", "jorge.paz", "directa", "¿Qué paquetería cubre el Valle de México y en cuánto entrega?", "Última Milla CDMX, el mismo día o el siguiente.", ["wiki:2005#000"])
q("G-020", "operaciones", "hugo.salas", "directa", "¿Qué penalización paga Transportes del Norte por cada día de retraso?", "4 % de la tarifa por día, hasta 25 %.", ["wiki:2010#001"])
q("G-021", "operaciones", "sofia.leal", "directa", "¿Con cuántos días de aviso puede el marketplace terminar el contrato con una paquetería?", "Con 30 días, si incumple su entrega comprometida en más del 15 % de los paquetes durante dos meses seguidos.", ["wiki:2010#004"])
q("G-022", "operaciones", "jorge.paz", "directa", "¿Cuántos agentes temporales se contratan en temporada alta?", "40, del 15 de noviembre al 6 de enero.", ["drive:d09#000"])
q("G-023", "operaciones", "sofia.leal", "directa", "¿Cuál es la comisión de Electrónica?", "8 % sobre el precio de venta sin IVA; a quien vende se le paga a los 15 días.", ["wiki:2002#001"])
q("G-024", "operaciones", "jorge.paz", "directa", "¿Cuánto cuesta mandar un paquete de 3 kg a Sonora con guía del marketplace?", "179 pesos con IVA (de 1 a 5 kg, zona Noroeste).", ["drive:d21#002"])
q("G-025", "operaciones", "hugo.salas", "directa", "¿Cuántas ventas sin comisión tiene un vendedor nuevo?", "Sus primeras 10 ventas.", ["drive:d02#000"])
q("G-026", "finanzas", "carmen.nava", "directa", "¿Qué días salen los pagos a vendedores?", "Desde diciembre, los lunes y los jueves; si es festivo, el día hábil siguiente.", ["drive:d07#000"])
q("G-027", "legal", "irene.sol", "directa", "¿Hasta qué monto responde una paquetería por un paquete perdido según el contrato marco?", "Hasta 15,000 pesos por paquete; arriba de eso aplica el seguro contratado por el marketplace.", ["drive:d03#000"])
q("G-028", "legal", "irene.sol", "directa", "¿Cuándo es la audiencia de conciliación del caso Envíos Express?", "El 3 de diciembre.", ["wiki:3006#001"])
q("G-029", "rh", "lucia.mora", "directa", "¿Cuál es el tope de hotel por noche en la política de viajes?", "2,000 pesos por noche, con factura a nombre del marketplace.", ["drive:d01#000"])
q("G-030", "rh", "lucia.mora", "directa", "¿Cuánto gana un líder de soporte?", "De 26,000 a 32,000 pesos mensuales.", ["drive:d04#000"])
q("G-031", "fraude", "raul.ortiz", "directa", "¿Qué se hizo en el caso SEG-1 de cuenta de vendedor duplicada?", "Se suspendió la cuenta más nueva mientras se revisa.", ["jira:SEG-1#000"])
q("G-032", "finanzas", "carmen.nava", "directa", "¿De cuánto puede ser como máximo un regalo que acepto de un vendedor?", "De 500 pesos.", ["drive:d10#000"], origen="consulta")
q("G-033", "soporte", "paula.vega", "directa", "¿Cuánto tiempo se guardan las grabaciones de llamadas?", "6 meses.", ["wiki:3005#000"])
q("G-034", "operaciones", "hugo.salas", "directa", "¿Qué se revisó en la minuta de operaciones del 6 de noviembre?", "El inventario de electrónica.", ["drive:d16#000"])
q("G-035", "soporte", "marco.diaz", "directa", "¿Cuántas fotos necesita como mínimo una publicación?", "Mínimo 3, con fondo claro y sin marcas de agua.", ["drive:d08#000"])
q("G-036", "soporte", "elena.cruz", "directa", "¿Qué pasa si quien compra no recoge el paquete en la sucursal?", "La paquetería lo guarda 7 días naturales y lo regresa; la venta se cancela y quien compra recibe el reembolso completo, sin descontar el envío.", ["drive:d20#007"])
q("G-037", "soporte", "ana.ruiz", "directa", "¿Se pueden vender productos usados?", "Solo en Electrónica y Hogar, con «usado» en el título y el estado del producto descrito.", ["drive:d20#007"], origen="consulta")
q("G-038", "operaciones", "sofia.leal", "directa", "¿Qué documentos se piden para el alta de un vendedor?", "Constancia de situación fiscal de no más de 3 meses, estado de cuenta con el titular y la CLABE, identificación oficial vigente y, si es empresa, acta constitutiva y poder notarial.", ["drive:d20#001"])

# con varias fuentes: la respuesta junta dos documentos
q("G-040", "soporte", "ana.ruiz", "varias", "Llegó una pantalla estrellada: ¿qué fotos pido y quién paga el envío de regreso?", "Dos fotos del producto y una de la caja; la devolución va sin costo de envío para quien compró.", ["wiki:1008#000", "jira:SOP-12#000"])
q("G-041", "soporte", "elena.cruz", "varias", "¿Cuál es el plazo para devolver electrónica y qué revisa quien vende antes del reembolso?", "30 días desde la entrega; quien vende tiene 3 días hábiles para confirmar que llegó completo y sin daños de uso.", ["wiki:1002#001", "wiki:1003#000"])
q("G-042", "operaciones", "sofia.leal", "varias", "¿La rebaja de comisión de Moda en temporada alta es igual en la wiki y en el manual del vendedor?", "Sí: en las dos, la comisión de Moda baja de 12 % a 10 % en noviembre y diciembre para vendedores con calificación mayor a 4.5.", ["wiki:2002#002", "drive:d20#003"])
q("G-043", "operaciones", "jorge.paz", "varias", "¿Un paquete de 25 kg se puede mandar con guía del marketplace, y si no, qué hace quien vende?", "No: más de 20 kg no se acepta con guía del marketplace; quien vende lo manda por su cuenta.", ["drive:d21#004", "drive:d20#004"])
q("G-044", "operaciones", "sofia.leal", "varias", "¿Cuánto penaliza el contrato a Envíos Express por día de retraso y en cuánto entrega?", "5 % de la tarifa por día, hasta 30 %; entrega en 2 a 4 días, con cobertura nacional.", ["wiki:2010#001", "wiki:2005#000"])
q("G-045", "soporte", "marco.diaz", "varias", "Un cliente quiere cancelar un pedido que ya salió: ¿qué le digo?", "Ya no se cancela sin costo: se rechaza en la entrega y se reembolsa cuando regresa al almacén.", ["wiki:1013#000", "politicas:cancelaciones.md#000"], origen="consulta")
q("G-046", "soporte", "tomas.rey", "varias", "¿Cuánto tarda un reembolso a saldo del marketplace y a qué método vuelve un reembolso?", "1 día hábil; el reembolso vuelve al mismo método con el que se pagó.", ["wiki:1004#001", "politicas:reembolsos.md#000"])
q("G-047", "soporte", "diego.luna", "varias", "¿Cuánto tiempo tiene quien vende para responder un mensaje y para enviar un pedido?", "48 horas para responder y 2 días hábiles para enviar.", ["politicas:vendedores.md#000", "wiki:1014#000"])
q("G-048", "soporte", "paula.vega", "varias", "Un cliente Oro amenaza con demandar: ¿lo escalo y cuánto le puedo compensar sin aprobación?", "Sí: las amenazas de demanda se escalan a líderes, y un líder puede ofrecer hasta 500 pesos en saldo sin aprobación de finanzas.", ["wiki:1005#000", "wiki:1006#001"])
q("G-049", "legal", "irene.sol", "varias", "¿Cuánto se negocia en el caso Transportes del Norte y cuánto cubre el contrato marco por paquete?", "Se negocian 420,000 pesos por 38 paquetes perdidos; el contrato marco cubre hasta 15,000 pesos por paquete.", ["wiki:3004#000", "drive:d03#000"])
q("G-050", "operaciones", "sofia.leal", "varias", "¿Qué días se paga a los vendedores y cuándo se retiene un pago?", "Los lunes y los jueves desde diciembre; se retiene el pago de una venta con devolución abierta hasta que se cierre.", ["drive:d07#000", "drive:d20#006"])
q("G-051", "operaciones", "sofia.leal", "varias", "¿Qué necesita un vendedor para darse de alta y cuánto tarda la revisión?", "RFC, una cuenta bancaria a su nombre y una identificación vigente; la revisión tarda hasta 2 días hábiles.", ["wiki:2003#000", "drive:d20#001"])
q("G-052", "soporte", "ana.ruiz", "varias", "¿Quién paga el envío de regreso de una prenda de Moda?", "El marketplace.", ["wiki:1002#001", "drive:d20#005"], origen="consulta")

# sin respuesta: no está en ningún documento; el asistente tiene que decirlo y no inventar
q("G-060", "soporte", "ana.ruiz", "sin_respuesta", "¿Cuántos días de vacaciones tengo al año?", SR, [], origen="consulta")
q("G-061", "operaciones", "hugo.salas", "sin_respuesta", "¿Cuál es el teléfono del almacén de Querétaro?", SR, [])
q("G-062", "soporte", "tomas.rey", "sin_respuesta", "¿Se puede pagar con criptomonedas?", SR, [], origen="consulta")
q("G-063", "soporte", "elena.cruz", "sin_respuesta", "¿Cuál es la comisión de la categoría Deportes?", SR, [])
q("G-064", "operaciones", "jorge.paz", "sin_respuesta", "¿Cuánto cuesta un envío a Estados Unidos?", SR, [])
q("G-065", "soporte", "marco.diaz", "sin_respuesta", "¿Cuándo es la posada de fin de año de la empresa?", SR, [], origen="consulta")
q("G-066", "soporte", "paula.vega", "sin_respuesta", "¿Cuánto es la compensación máxima para un cliente Platino?", SR, [])
q("G-067", "finanzas", "carmen.nava", "sin_respuesta", "¿Cuánto se cobró de comisiones en octubre?", SR, [])
q("G-068", "soporte", "diego.luna", "sin_respuesta", "¿Cómo cambio la contraseña de mi correo?", SR, [], origen="consulta")

# prohibidas: la respuesta existe, pero en documentos que esa persona no puede abrir
q("G-070", "operaciones", "hugo.salas", "prohibida", "Tarifa de envío a Sonora para un paquete de 3 kilos", SR, ["drive:d21#002"])
q("G-071", "fraude", "tomas.rey", "prohibida", "¿Cómo se resolvió el caso SEG-3?", SR, ["jira:SEG-3#000"])
q("G-072", "soporte", "luis.campos@paqueteria-aliada.test", "prohibida", "¿En qué horario atiende soporte por chat?", SR, ["wiki:1001#001"])
q("G-073", "soporte", "ana.ruiz", "prohibida", "¿Cuánto le puede dar un líder a un cliente Oro sin pedir aprobación?", SR, ["wiki:1006#001"])
q("G-074", "rh", "diego.luna", "prohibida", "¿Cuánto gana un agente de soporte?", SR, ["drive:d04#000"])
q("G-075", "legal", "paula.vega", "prohibida", "¿Por cuánto se está negociando el caso Transportes del Norte?", SR, ["wiki:3004#000"])
q("G-076", "operaciones", "carmen.nava", "prohibida", "¿Qué comisión se cobra en Moda?", SR, ["wiki:2002#001"])
q("G-077", "legal", "marco.diaz", "prohibida", "¿Qué día es la audiencia con Envíos Express?", SR, ["wiki:3006#001"])
q("G-078", "rh", "raul.ortiz", "prohibida", "¿Cuánto es el viático diario en una ciudad grande?", SR, ["drive:d01#000"])
q("G-079", "operaciones", "hugo.salas", "prohibida", "Precio de un envío de 1 kg a Yucatán", SR, ["drive:d21#003"])

# los errores de verdad: lo que los expertos mandaron y no debe entrar
q("G-039", "fraude", "tomas.rey", "directa", "¿Qué pasó con la cuenta duplicada del caso SEG-5?", "Se suspendió la cuenta más nueva mientras se revisa.", ["jira:SEG-5#000"])         # Tomás ya no está en fraude
q("G-080", "operaciones", "jorge.paz", "directa", "¿En qué horario atiende soporte por teléfono?", "De 9:00 a 18:00, de lunes a viernes.", ["wiki:1001#001"])                  # la misma que G-001
q("G-081", "soporte", "elena.cruz", "directa", "¿Cuántos días tarda en verse el reembolso en una tarjeta de débito?", "De 3 a 7 días hábiles.", ["wiki:1004#001"])        # casi la misma que G-002
q("G-082", "soporte", "marco.diaz", "directa", "¿Cuánto tarda un reembolso de un pago en tienda?", "10 días hábiles, y se devuelve como saldo.", ["wiki:1040#001"])               # ese chunk no existe
q("G-083", "soporte", "ana.ruiz", "varias", "¿Desde cuándo corre el plazo de devolución y qué no se puede devolver?", "Desde la entrega; no se devuelven ropa interior sin etiqueta, software activado ni personalizados.", ["wiki:1002#000", "wiki:1002#002"])   # dos chunks del mismo documento
q("G-084", "soporte", "diego.luna", "sin_respuesta", "¿Hay envío el mismo día en Monterrey?", SR, ["politicas:envios.md#000"])                                                # sin respuesta pero con fuente
q("G-085", "operaciones", "jorge.paz", "dificil", "¿Cuántos días hábiles tarda un envío a Chiapas?", "De 4 a 6 días hábiles.", ["drive:d21#001"])                                # un tipo que no existe
q("G-086", "soporte", "elena.cruz", "directa", "¿Qué hago si me llega una devolución con otro producto adentro?", "", ["drive:d20#007"])                                         # sin respuesta de referencia
q("G-022", "operaciones", "sofia.leal", "directa", "¿Los almacenes abren en domingo en temporada alta?", "Sí, del 15 de noviembre al 6 de enero los almacenes abren también los domingos.", ["drive:d09#000"])   # id repetido
jsonl(SAL / "candidatos" / "expertos.jsonl", C)

# ---------------------------------------------------------------- lo que afina el equipo del prompt (few-shot)
AF = [
    ("¿Cómo abro una devolución para un cliente?", "Desde el detalle del pedido, en «Devolver»."),
    ("¿Qué hago si el pedido no llegó?", "Revisa la guía; si lleva más de 3 días sin movimiento, abre una investigación con la paquetería."),
    ("¿Se puede facturar un pedido del mes pasado?", "Fuera del mes de compra, la factura la emite quien vende."),
    ("¿Cómo escalo un ticket a líderes?", "Etiquétalo con «escalado», resume el caso en tres líneas y avisa en el canal de líderes."),
    ("¿Cuánto cuesta el recargo de zona extendida?", "60 pesos por paquete."),
    ("¿Desde qué monto de compra el envío es gratis?", "En compras desde 599 pesos."),               # se parece a G-015 (test): la quema
    ("¿Cuándo interviene el marketplace en una garantía?", "Si quien vende no responde en 5 días hábiles."),   # igual a G-009, que es de dev: se vale
]
jsonl(SAL / "afinado" / "ejemplos.jsonl", [{"id": f"A-{i + 1:02d}", "pregunta": p, "respuesta": r_, "autor": "equipo-prompt"} for i, (p, r_) in enumerate(AF)])

# ---------------------------------------------------------------- el lote nuevo de la falla «casi-duplicadas» (escrito el 24, con el corpus del 22)
L = []
for id_, persona, pregunta, respuesta, fuentes in [
    ("G-090", "tomas.rey", "¿Qué horario tiene soporte por teléfono?", "De 9:00 a 18:00, de lunes a viernes.", ["wiki:1001#001"]),
    ("G-091", "marco.diaz", "¿En cuánto tiempo se reembolsa un cobro que salió duplicado?", "De 1 a 3 días hábiles.", ["wiki:1015#000"]),
    ("G-092", "ana.ruiz", "¿Cuántos cupones se pueden usar en cada pedido?", "Uno por pedido.", ["politicas:cupones.md#000"]),
    ("G-093", "elena.cruz", "¿Qué productos no se pueden devolver nunca?", "Ropa interior y trajes de baño sin etiqueta, software o tarjetas de regalo activadas y productos personalizados.", ["wiki:1002#003"]),
]:
    L.append({"id": id_, "autor": EXP["soporte"] + D, "origen": "experto", "persona": persona + D, "tipo": "directa", "pregunta": pregunta,
              "respuesta": respuesta, "fuentes": fuentes, "corpus": "corpus-2026-11-22"})
jsonl(SAL / "lote-2026-11-24.jsonl", L)

n = {t: sum(1 for x in C if x["tipo"] == t) for t in ("directa", "varias", "sin_respuesta", "prohibida")}
print(f"corpus: 21 → {len(c21['chunks'])} chunks · 22 → {len(c22['chunks'])} · 23 → {len(c23['chunks'])}")
print(f"candidatos: {len(C)} ({n}) · afinado: {len(AF)} · lote: {len(L)}")
