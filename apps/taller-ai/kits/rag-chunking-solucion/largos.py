"""Los tres documentos largos que el kit de la estación 2 suma a lo que dejó la estación 1. Ficticios, escritos para
el dojo. Los usa hacer_entrada.py. Van ya como texto parseado, con la forma que deja el parsing de la estación 1:
un markdown tal cual (con tablas de barras) y una página de la wiki con «# », «## », «- » y cada fila de tabla
como «Encabezado: valor; Encabezado: valor».

Sin ellos, el documento más largo del mundo tiene ≈ 300 tokens y todo cabría en un solo chunk: no habría nada que partir.
"""
from __future__ import annotations

D = "marketplace.test"

MANUAL = """# Manual del vendedor

Este manual explica, de punta a punta, cómo vende una persona o una empresa en el marketplace: desde el alta hasta el pago. Lo usan los equipos de operaciones y de soporte para contestar dudas de vendedores. Si algo de aquí contradice una política del repositorio de políticas, manda la política.

## Alta y verificación

Para vender se necesita RFC, una cuenta bancaria a nombre de quien vende y una identificación vigente. La revisión tarda hasta 2 días hábiles y la hace el equipo de operaciones, no un sistema automático.

### Documentos que se piden

- Constancia de situación fiscal con no más de 3 meses de antigüedad.
- Estado de cuenta bancario donde se vea el nombre del titular y la CLABE.
- Identificación oficial vigente de la persona o del representante legal.
- Acta constitutiva y poder notarial, solo si vende una empresa.

### Motivos de rechazo frecuentes

La mayoría de los rechazos son por datos que no coinciden entre documentos. Si la cuenta bancaria está a nombre de otra persona, se rechaza aunque sea de un familiar. Si el RFC no coincide con el nombre registrado, se pide corregir el registro antes de volver a revisar. Una persona que ya tuvo una cuenta cerrada por fraude no puede abrir otra, ni a nombre de una empresa nueva.

## Publicar productos

Cada publicación necesita título, categoría, precio con IVA, existencias y al menos tres fotos. El título describe el producto, no la promoción: «Licuadora de 1.5 litros, 600 W» y no «¡Oferta increíble!». La categoría decide la comisión y el plazo de devolución, así que elegir una categoría equivocada para pagar menos comisión es motivo de baja de la publicación.

Las fotos siguen los lineamientos de fotos de producto: fondo claro, el producto ocupa la mayor parte de la imagen y nada de textos encima. Una publicación sin existencias se pausa sola y vuelve a mostrarse cuando quien vende actualiza el inventario.

## Comisiones

La comisión se cobra sobre el precio de venta sin IVA y se descuenta del pago. Estos son los porcentajes vigentes:

| Categoría | Comisión | Días para pagar a quien vende |
|---|---|---|
| Electrónica | 8 % | 15 |
| Moda | 12 % | 10 |
| Hogar | 10 % | 10 |
| Juguetes | 11 % | 10 |

En temporada alta (noviembre y diciembre), la comisión de Moda baja a 10 % para vendedores con calificación mayor a 4.5.

## Envíos

Quien vende elige entre dos modalidades: envío con guía del marketplace o envío propio. Con guía del marketplace, la paquetería se asigna sola según el código postal de destino y la tarifa se descuenta del pago. Con envío propio, quien vende contrata la paquetería y tiene que subir el número de guía en menos de 24 horas desde la venta.

El paquete sale en un plazo de 2 días hábiles desde la venta. Si sale tarde, la venta cuenta como envío tardío en la calificación de quien vende. Tres envíos tardíos en un mes pausan la cuenta una semana. Un paquete que la paquetería reporta como dañado o perdido no cuenta como tardío: lo investiga operaciones con la paquetería.

Las tarifas por estado y por peso están en el documento «Tarifas de envío por estado 2026», en el Drive de operaciones. Un paquete de más de 20 kg no se puede mandar con guía del marketplace: quien vende lo manda por su cuenta.

## Devoluciones

Quien compra puede devolver dentro del plazo de su categoría, contado desde la entrega. Quien vende no puede negarse a una devolución en plazo, pero sí puede pedir revisar el producto antes del reembolso cuando es electrónica: tiene 3 días hábiles para confirmar que llegó completo y sin daños de uso. Si no contesta en ese plazo, el reembolso se libera solo.

El envío de regreso lo paga quien vende si el producto llegó dañado, era distinto al publicado o le faltaban piezas. En los demás casos lo paga quien compra, salvo en Moda y Juguetes, donde lo absorbe el marketplace. Un producto devuelto vuelve al inventario de quien vende solo cuando quien vende confirma que está en condiciones de venderse otra vez.

## Pagos

Los pagos a vendedores salen los martes, por transferencia a la cuenta registrada en el alta. Cada pago incluye las ventas entregadas cuyo plazo de pago ya se cumplió, según la tabla de comisiones, menos la comisión, la tarifa de envío y las devoluciones del periodo.

### Retenciones

Se retiene el pago de una venta con una devolución abierta hasta que se cierre. También se retiene todo el pago de una cuenta en revisión por fraude, hasta que operaciones termine la revisión. Una retención nunca dura más de 30 días sin que alguien de operaciones la revise y deje una nota en el caso.

### Facturación de la comisión

El marketplace emite cada mes una factura por las comisiones cobradas, a nombre de quien vende y con el RFC del alta. La factura llega por correo los primeros 5 días del mes siguiente. Si quien vende cambia de régimen fiscal, tiene que actualizar su constancia antes del día 25 para que la factura salga con los datos nuevos.

## Preguntas frecuentes de vendedores

¿Puedo cambiar el precio de una publicación con ventas abiertas? Sí. El precio nuevo aplica a las ventas que entren después del cambio; las ventas abiertas se pagan con el precio con el que se vendieron.

¿Qué pasa si quien compra no recoge el paquete en la sucursal? La paquetería lo guarda 7 días naturales y después lo regresa. Cuando llega de vuelta, la venta se cancela y quien compra recibe el reembolso completo, sin descontar el envío.

¿Puedo vender productos usados? Solo en las categorías Electrónica y Hogar, y la publicación tiene que decir «usado» en el título y describir el estado del producto. Un producto usado vendido como nuevo cuenta como producto distinto al publicado.

¿Cómo respondo una reseña negativa? Desde el detalle de la venta, una sola vez y sin datos personales de quien compra. Una respuesta no borra la reseña. Si la reseña tiene insultos o datos personales, se reporta a soporte y soporte decide si la quita.

¿Puedo ofrecer envío gratis? Sí: quien vende absorbe la tarifa y la publicación muestra «envío gratis». La tarifa se descuenta del pago igual que siempre, así que conviene sumarla al precio antes de publicar.

¿Qué hago si me llega una devolución con otro producto adentro? No la confirmes. Abre un caso con soporte en menos de 48 horas, con fotos del paquete tal como llegó y de la guía. Mientras el caso está abierto, el reembolso a quien compra queda detenido.

¿Puedo tener dos cuentas de vendedor? No. Una persona o una empresa tiene una sola cuenta. Si vende dos marcas, las publica desde la misma cuenta. Dos cuentas con el mismo RFC o la misma cuenta bancaria se cierran las dos.

¿Cuánto tarda en reflejarse un cambio de cuenta bancaria? El cambio lo revisa operaciones en hasta 2 días hábiles, como en el alta. Mientras tanto, los pagos siguen saliendo a la cuenta anterior; si esa cuenta ya está cerrada, el pago se retiene hasta que se apruebe la nueva.

## Calificación y sanciones

La calificación de quien vende va de 1 a 5 y la calculan las reseñas de los últimos 90 días, los envíos tardíos y las cancelaciones. Una calificación menor a 3.5 durante dos meses seguidos pausa la cuenta hasta que quien vende hable con operaciones. Vender productos falsificados, pedir a quien compra que pague por fuera del marketplace o publicar datos personales de quien compra cierra la cuenta sin aviso previo.
"""

MANUAL_DIA2 = MANUAL.replace("Los pagos a vendedores salen los martes, por transferencia",
                             "Desde diciembre, los pagos a vendedores salen los lunes y los jueves, por transferencia")
assert MANUAL_DIA2 != MANUAL

ESTADOS = [  # estado, zona, días hábiles
    ("Aguascalientes", "Centro", "2 a 3"), ("Baja California", "Noroeste", "3 a 5"), ("Baja California Sur", "Noroeste", "4 a 6"),
    ("Campeche", "Sureste", "3 a 5"), ("Chiapas", "Sureste", "4 a 6"), ("Chihuahua", "Norte", "3 a 4"),
    ("Ciudad de México", "Valle de México", "1 a 2"), ("Coahuila", "Norte", "2 a 4"), ("Colima", "Occidente", "3 a 4"),
    ("Durango", "Norte", "3 a 4"), ("Estado de México", "Valle de México", "1 a 2"), ("Guanajuato", "Centro", "2 a 3"),
    ("Guerrero", "Sur", "3 a 5"), ("Hidalgo", "Centro", "2 a 3"), ("Jalisco", "Occidente", "2 a 3"),
    ("Michoacán", "Occidente", "2 a 4"), ("Morelos", "Centro", "2 a 3"), ("Nayarit", "Occidente", "3 a 4"),
    ("Nuevo León", "Norte", "2 a 3"), ("Oaxaca", "Sur", "3 a 5"), ("Puebla", "Centro", "2 a 3"),
    ("Querétaro", "Centro", "2 a 3"), ("Quintana Roo", "Sureste", "3 a 5"), ("San Luis Potosí", "Centro", "2 a 4"),
    ("Sinaloa", "Noroeste", "3 a 4"), ("Sonora", "Noroeste", "3 a 5"), ("Tabasco", "Sureste", "3 a 4"),
    ("Tamaulipas", "Norte", "2 a 4"), ("Tlaxcala", "Centro", "2 a 3"), ("Veracruz", "Sureste", "2 a 4"),
    ("Yucatán", "Sureste", "3 a 5"), ("Zacatecas", "Centro", "3 a 4"),
]
TARIFA = {  # zona: (hasta 1 kg, de 1 a 5 kg, de 5 a 20 kg), en pesos con IVA
    "Valle de México": (89, 119, 189), "Centro": (99, 135, 219), "Occidente": (105, 145, 235), "Norte": (115, 159, 259),
    "Noroeste": (129, 179, 299), "Sur": (119, 165, 269), "Sureste": (125, 172, 289),
}


def _tarifas() -> str:
    filas = "\n".join(f"| {e} | {z} | {TARIFA[z][0]} | {TARIFA[z][1]} | {TARIFA[z][2]} | {d} |" for e, z, d in ESTADOS)
    return f"""# Tarifas de envío por estado 2026

Estas son las tarifas de la guía del marketplace por estado de destino, en pesos con IVA. Se descuentan del pago a quien vende cuando usa la guía del marketplace. El peso que cuenta es el mayor entre el peso real y el peso volumétrico (largo × ancho × alto en centímetros, entre 5,000).

## Tarifas por estado

| Estado | Zona | Hasta 1 kg | De 1 a 5 kg | De 5 a 20 kg | Días hábiles |
|---|---|---|---|---|---|
{filas}

## Recargos

- Zona extendida (localidades sin cobertura diaria de la paquetería): 60 pesos por paquete.
- Reintento de entrega a partir del segundo: 35 pesos.
- Paquete de más de 20 kg: no se acepta con guía del marketplace.
"""


TARIFAS = _tarifas()

CONTRATO = """# Niveles de servicio con paqueterías

Esta página resume lo que el contrato marco de logística compromete a cada paquetería. El contrato completo, con sus anexos, lo guarda Legal en el Drive. Operaciones revisa estos números cada trimestre con los reportes de entrega.

## Compromisos por paquetería
Paquetería: Envíos Express; Cobertura: Nacional; Entrega comprometida: 2 a 4 días hábiles; Penalización por retraso: 5 % de la tarifa por día, hasta 30 %; Reporte de incidencias: en 24 horas
Paquetería: Transportes del Norte; Cobertura: Norte y Bajío; Entrega comprometida: 1 a 3 días hábiles; Penalización por retraso: 4 % de la tarifa por día, hasta 25 %; Reporte de incidencias: en 24 horas
Paquetería: Última Milla CDMX; Cobertura: Valle de México; Entrega comprometida: mismo día o siguiente; Penalización por retraso: 10 % de la tarifa por día, hasta 40 %; Reporte de incidencias: en 12 horas

## Paquetes perdidos o dañados
La paquetería paga el valor declarado del paquete, hasta 15,000 pesos, si lo pierde o lo entrega dañado. Arriba de ese monto, el paquete tenía que ir con seguro adicional.
- El reclamo se abre en los 10 días naturales siguientes a la fecha comprometida de entrega.
- Se adjuntan la guía, las fotos del paquete y la factura del producto.
- La paquetería tiene 15 días hábiles para pagar o rechazar el reclamo, con su motivo por escrito.

## Cómo se calculan las penalizaciones
Operaciones calcula las penalizaciones del mes con el reporte de entregas de cada paquetería y las descuenta de su siguiente factura. Si la paquetería no está de acuerdo, tiene 5 días hábiles para objetar con evidencia; si no objeta, la penalización queda firme.

## Terminación anticipada
El marketplace puede terminar el contrato con 30 días de aviso si una paquetería incumple su entrega comprometida en más del 15 % de los paquetes durante dos meses seguidos. La paquetería puede terminarlo con 90 días de aviso.
"""

# doc_id, título, tipo, url, versión, actualizado, ACL (cláusulas), texto del día 1, texto del día 2 (o el mismo)
LARGOS = [
    ("drive:d20", "Manual del vendedor.md", "markdown", "http://localhost:8120/drive/v3/files/d20",
     "2026-11-12T16:00:00Z", [sorted([f"group:operaciones@{D}", f"group:soporte@{D}", f"user:sofia.leal@{D}"])], MANUAL, MANUAL_DIA2),
    ("drive:d21", "Tarifas de envío por estado 2026.md", "markdown", "http://localhost:8120/drive/v3/files/d21",
     "2026-11-05T18:30:00Z", [sorted([f"group:operaciones@{D}", f"user:jorge.paz@{D}"])], TARIFAS, TARIFAS),
    ("wiki:2010", "Niveles de servicio con paqueterías", "html", "http://localhost:8120/wiki/paginas/2010",
     "2026-10-30T17:15:00Z", [[f"group:operaciones@{D}"]], CONTRATO, CONTRATO),
]
