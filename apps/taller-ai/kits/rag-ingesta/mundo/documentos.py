"""Los documentos de ejemplo del marketplace: ficticios, escritos para el dojo. Los usan crear.py y avanzar.py.

Una página de la wiki es una lista de bloques: ("h2", texto), ("p", texto), ("ul", [ítems]) o
("tabla", [encabezados], [[celdas]…]). Un PDF es una lista de páginas, cada una una lista de líneas.
"""
from __future__ import annotations

D = "marketplace.test"

# ---------------------------------------------------------------- wiki
ESPACIOS = {
    "SOP": {"nombre": "Soporte", "leer": [f"group:soporte@{D}", f"group:operaciones@{D}"]},
    "OPS": {"nombre": "Operaciones", "leer": [f"group:operaciones@{D}"]},
    "LEG": {"nombre": "Legal", "leer": [f"group:legal@{D}", f"group:soporte-lideres@{D}"]},
}

DEVOLUCIONES = [
    ("p", "Quien compra puede devolver un producto dentro del plazo de su categoría, contado desde el día en que lo recibió. El plazo lo valida el sistema con la fecha de entrega de la paquetería, no con la fecha de compra."),
    ("h2", "Plazos por categoría"),
    ("tabla", ["Categoría", "Plazo para devolver", "Quién paga el envío"], [
        ["Electrónica", "15 días", "El marketplace si llegó dañado; si no, quien compra"],
        ["Moda", "30 días", "El marketplace"],
        ["Hogar", "30 días", "Quien compra"],
        ["Juguetes", "30 días", "El marketplace"],
    ]),
    ("h2", "Qué no se puede devolver"),
    ("ul", ["Ropa interior y trajes de baño sin su etiqueta.", "Software o tarjetas de regalo ya activadas.", "Productos personalizados a pedido."]),
    ("h2", "Cómo se abre una devolución"),
    ("p", "Desde el detalle del pedido, en «Devolver». Si el sistema no lo permite y quien compra insiste en que está en plazo, revisa la fecha de entrega en la guía de la paquetería antes de escalar."),
]

PAGINAS = [
    # id, espacio, padre, título, autor, actualizado, bloques, restricción de lectura propia
    ("1001", "SOP", None, "Manual de soporte", "ana.ruiz", "2026-09-02T16:10:00Z", [
        ("p", "Este manual reúne cómo atiende el equipo de soporte del marketplace a quienes compran y a quienes venden. Si una respuesta no está aquí, pregunta en el canal de líderes antes de improvisar."),
        ("h2", "Horario y canales"),
        ("ul", ["Chat y correo: de 8:00 a 22:00, todos los días.", "Teléfono: de 9:00 a 18:00, de lunes a viernes.", "Casos de vendedores: por correo, con respuesta en 24 horas hábiles."]),
    ], None),
    ("1002", "SOP", "1001", "Devoluciones", "ana.ruiz", "2026-10-14T18:22:00Z", DEVOLUCIONES, None),
    ("1003", "SOP", "1002", "Devoluciones de electrónica", "marco.diaz", "2026-10-15T15:05:00Z", [
        ("p", "Un equipo electrónico se revisa antes de reembolsar: quien vende tiene 3 días hábiles para confirmar que llegó completo y sin daños de uso."),
        ("h2", "Si quien vende no contesta"),
        ("p", "Pasados los 3 días hábiles, el reembolso se libera solo y el caso se marca para revisión de calidad del vendedor."),
    ], None),
    ("1004", "SOP", "1001", "Reembolsos", "ana.ruiz", "2026-09-28T17:40:00Z", [
        ("p", "El reembolso vuelve siempre al mismo método con el que se pagó. Lo que cambia es cuánto tarda en verse en la cuenta de quien compró."),
        ("h2", "Tiempos por método de pago"),
        ("tabla", ["Método de pago", "Días hábiles para el reembolso"], [
            ["Tarjeta de crédito", "5 a 10"], ["Tarjeta de débito", "3 a 7"], ["Saldo del marketplace", "1"], ["Pago en tienda", "10 (se devuelve como saldo)"],
        ]),
    ], None),
    ("1005", "SOP", "1001", "Escalamiento a líderes", "lucia.mora", "2026-10-02T14:00:00Z", [
        ("p", "Lo que se escala a líderes de soporte: amenazas de demanda, pérdidas mayores a 20,000 pesos y cualquier caso con prensa o redes sociales."),
        ("h2", "Cómo escalar"),
        ("ul", ["Etiqueta el ticket con «escalado».", "Resume el caso en tres líneas: qué pasó, qué pide la persona y qué se le ofreció.", "Avisa en el canal de líderes con el número de ticket."]),
    ], {"grupos": [f"group:soporte-lideres@{D}"], "usuarios": []}),
    ("1006", "SOP", "1005", "Clientes VIP y compensaciones", "lucia.mora", "2026-10-03T19:30:00Z", [
        ("p", "Un líder puede ofrecer una compensación de hasta 500 pesos en saldo sin aprobación de finanzas. Arriba de eso, se pide aprobación en el ticket."),
        ("h2", "Topes por nivel de cliente"),
        ("tabla", ["Nivel", "Compensación máxima sin aprobación"], [["Oro", "500 pesos"], ["Plata", "300 pesos"], ["Sin nivel", "150 pesos"]]),
    ], None),
    ("1017", "SOP", "1001", "Macros de respuesta", "marco.diaz", "2026-09-05T13:00:00Z", [
        ("p", "Las macros son respuestas base. Siempre se personalizan con el nombre de la persona y el número de pedido antes de enviarlas."),
    ], None),
    ("2001", "OPS", None, "Operaciones", "sofia.leal", "2026-09-01T12:00:00Z", [
        ("p", "El espacio de operaciones documenta cómo se da de alta a quien vende, cómo se le paga y cómo se mueve el inventario de los almacenes propios."),
    ], None),
    ("2002", "OPS", "2001", "Comisiones por categoría", "sofia.leal", "2026-10-20T16:45:00Z", [
        ("p", "La comisión se cobra sobre el precio de venta sin IVA y se descuenta del pago a quien vende. El pago se hace los días que marca la tabla, contados desde la entrega."),
        ("h2", "Tabla vigente"),
        ("tabla", ["Categoría", "Comisión", "Días para pagar a quien vende"], [
            ["Electrónica", "8 %", "15"], ["Moda", "12 %", "10"], ["Hogar", "10 %", "10"], ["Juguetes", "11 %", "10"],
        ]),
        ("h2", "Excepciones"),
        ("p", "Durante la temporada alta (noviembre y diciembre) la comisión de Moda baja a 10 % para vendedores con calificación mayor a 4.5."),
    ], None),
    ("2003", "OPS", "2001", "Alta de vendedores", "sofia.leal", "2026-09-18T15:30:00Z", [
        ("p", "Para vender, una persona o empresa necesita RFC, una cuenta bancaria a su nombre y una identificación vigente. La revisión tarda hasta 2 días hábiles."),
        ("h2", "Motivos de rechazo"),
        ("ul", ["La cuenta bancaria está a nombre de otra persona.", "El RFC no coincide con el nombre registrado.", "Ya tuvo una cuenta cerrada por fraude."]),
    ], None),
    ("2004", "OPS", "2001", "Inventario de fin de mes", "jorge.paz", "2026-10-29T20:10:00Z", [
        ("p", "El último día hábil de cada mes se cuenta el inventario de los almacenes propios. El acta firmada se escanea y se guarda en la unidad compartida de operaciones."),
    ], None),
    ("2005", "OPS", "2001", "Proveedores logísticos", "jorge.paz", "2026-10-08T17:00:00Z", [
        ("p", "Estas son las paqueterías con contrato vigente. La asignación es automática según el código postal de destino."),
        ("tabla", ["Paquetería", "Cobertura", "Tiempo de entrega"], [
            ["Envíos Express", "Nacional", "2 a 4 días"], ["Transportes del Norte", "Norte y Bajío", "1 a 3 días"], ["Última Milla CDMX", "Valle de México", "Mismo día o siguiente"],
        ]),
    ], None),
    ("3001", "LEG", None, "Legal", "irene.sol", "2026-09-01T12:00:00Z", [
        ("p", "Espacio del equipo legal. Lo que está aquí no se comparte fuera del marketplace."),
    ], None),
    ("3002", "LEG", "3001", "Aviso de privacidad interno", "irene.sol", "2026-09-10T18:00:00Z", [
        ("p", "Los datos de quien compra se usan solo para entregar, cobrar y atender sus pedidos. Ningún agente puede copiarlos a hojas personales ni a herramientas no aprobadas."),
    ], None),
    ("3003", "LEG", "3001", "Litigios", "irene.sol", "2026-10-11T16:20:00Z", [
        ("p", "Casos en litigio o con riesgo de demanda. La información de estas páginas es confidencial incluso dentro del equipo legal."),
    ], {"grupos": [f"group:legal-litigios@{D}"], "usuarios": []}),
    ("3004", "LEG", "3003", "Caso Transportes del Norte", "irene.sol", "2026-10-12T21:00:00Z", [
        ("p", "Reclamación por 38 paquetes perdidos en el almacén de Monterrey en septiembre. Se negocia un pago de 420,000 pesos antes de ir a juicio."),
    ], None),
    ("3005", "LEG", "3001", "Retención de datos", "irene.sol", "2026-09-22T15:00:00Z", [
        ("p", "Los tickets de soporte se guardan 2 años. Las grabaciones de llamadas, 6 meses. Los documentos de alta de vendedores, 5 años después de cerrar la cuenta."),
    ], None),
]

MACROS = [
    ("1007", "Macro: el pedido no llegó", "Revisa la guía en la página de la paquetería. Si lleva más de 3 días sin movimiento, abre una investigación con la paquetería y ofrece reenvío o reembolso."),
    ("1008", "Macro: llegó dañado", "Pide dos fotos del producto y una de la caja. Con eso se abre la devolución sin costo de envío para quien compra."),
    ("1009", "Macro: producto distinto al publicado", "Pide fotos y el número de pedido. Si se confirma, el envío de regreso lo paga quien vende y se le descuenta del siguiente pago."),
    ("1010", "Macro: cambio de dirección", "La dirección solo se puede cambiar antes de que el pedido salga del almacén. Después, ofrece recoger en sucursal."),
    ("1011", "Macro: factura", "La factura se pide desde el detalle del pedido dentro del mismo mes de la compra. Fuera de ese mes, la emite quien vende."),
    ("1012", "Macro: cupón no aplicó", "Revisa las condiciones del cupón (monto mínimo, categoría y vigencia). Si sí aplicaba, compensa con saldo por la diferencia."),
    ("1013", "Macro: cancelar un pedido", "Se cancela sin costo si el pedido no ha salido. Si ya salió, se rechaza en la entrega y se reembolsa al regresar al almacén."),
    ("1014", "Macro: vendedor no responde", "Quien vende tiene 48 horas para responder un mensaje. Si no lo hace, soporte toma el caso y decide."),
    ("1015", "Macro: cobro duplicado", "Pide los últimos 4 dígitos de la tarjeta y la fecha del cargo. Los cobros duplicados se reembolsan en 1 a 3 días hábiles."),
    ("1016", "Macro: garantía", "La garantía la da quien fabrica o quien vende, según la publicación. El marketplace solo media si no hay respuesta en 5 días hábiles."),
]
for mid, titulo, texto in MACROS:
    PAGINAS.append((mid, "SOP", "1017", titulo, "marco.diaz", f"2026-09-{int(mid) - 990:02d}T15:00:00Z",
                    [("p", texto), ("h2", "Antes de enviarla"), ("p", "Personaliza el saludo y confirma el número de pedido.")], None))


def html_pagina(espacio: str, titulo: str, autor: str, bloques: list) -> str:
    """El HTML que devuelve la wiki: el menú de navegación, la macro de índice, el cuerpo y el pie."""
    from html import escape as x

    out = [f'<div class="nav">Inicio › Espacios › {x(ESPACIOS[espacio]["nombre"])} › {x(titulo)}</div>',
           '<ac:structured-macro ac:name="toc" ac:schema-version="1"></ac:structured-macro>',
           f"<h1>{x(titulo)}</h1>"]
    for b in bloques:
        if b[0] == "h2":
            out.append(f"<h2>{x(b[1])}</h2>")
        elif b[0] == "p":
            out.append(f"<p>{x(b[1])}</p>")
        elif b[0] == "ul":
            out.append("<ul>" + "".join(f"<li>{x(i)}</li>" for i in b[1]) + "</ul>")
        elif b[0] == "tabla":
            filas = "".join("<tr>" + "".join(f"<td>{x(c)}</td>" for c in f) + "</tr>" for f in b[2])
            out.append('<table class="tabla"><tbody><tr>' + "".join(f"<th>{x(h)}</th>" for h in b[1]) + "</tr>" + filas + "</tbody></table>")
    out.append(f'<div class="pie">Última edición por {x(autor)} · Ver historial · Reportar contenido</div>')
    return "\n".join(out)


# ---------------------------------------------------------------- drive
def P(*lineas):
    return list(lineas)


ARCHIVOS = [
    # id, nombre, tipo, unidad, dueño, modificado, permisos extra, contenido (páginas de PDF o texto markdown)
    ("d01", "Política de viajes 2026.pdf", "pdf", "mi", "lucia.mora", "2026-08-30T16:00:00Z",
     [{"type": "domain", "domain": D, "role": "reader", "allowFileDiscovery": True}],
     [P("# Política de viajes 2026", "Aplica a todo el personal que viaja por trabajo dentro de México.",
        "Viáticos por día: 1,200 pesos en ciudades grandes y 900 pesos en el resto.",
        "Hotel: tope de 2,000 pesos por noche, con factura a nombre del marketplace."),
      P("# Vuelos", "Se compran con 14 días de anticipación en clase económica.",
        "Si el vuelo cuesta más de 6,000 pesos, lo aprueba la dirección del área.")]),
    ("d02", "Manual de onboarding de vendedores.pdf", "pdf", "compartida", "sofia.leal", "2026-09-12T15:00:00Z",
     [{"type": "group", "emailAddress": f"operaciones@{D}", "role": "reader"}],
     [P("# Onboarding de vendedores", "La primera semana, cada vendedor nuevo tiene un contacto de operaciones asignado.",
        "Día 1: revisión de documentos. Día 2: carga de catálogo. Día 3: primera publicación revisada."),
      P("# Primer mes", "El vendedor nuevo no paga comisión en sus primeras 10 ventas.",
        "Si su calificación baja de 3.5, el contacto lo llama antes de cualquier sanción.")]),
    ("d03", "Contrato marco de logística.pdf", "pdf", "mi", "irene.sol", "2026-07-15T18:00:00Z",
     [{"type": "group", "emailAddress": f"legal@{D}", "role": "reader"}],
     [P("# Contrato marco de logística", "Las paqueterías responden por pérdida o daño hasta 15,000 pesos por paquete.",
        "Arriba de ese monto, aplica el seguro contratado por el marketplace."),
      P("# Penalizaciones", "Por cada día de retraso sobre el tiempo comprometido, la paquetería descuenta 3 % del costo del envío.")]),
    ("d04", "Sueldos 2026.pdf", "pdf", "mi", "lucia.mora", "2026-01-20T17:00:00Z",
     [{"type": "anyone", "role": "reader", "allowFileDiscovery": False}],
     [P("# Tabulador de sueldos 2026", "Agente de soporte: de 14,000 a 18,000 pesos mensuales.",
        "Líder de soporte: de 26,000 a 32,000 pesos mensuales."),
      P("# Bonos", "Bono trimestral de hasta 10 % por calidad de atención.")]),
    ("d05", "Guía de tallas.pdf", "pdf", "compartida", "sofia.leal", "2026-08-10T14:00:00Z",
     [{"type": "domain", "domain": D, "role": "reader", "allowFileDiscovery": True}],
     [P("# Guía de tallas", "Las tallas de calzado se publican en centímetros y en número mexicano.",
        "Talla 25 mexicana equivale a 25 cm del talón a la punta."),
      P("# Ropa", "Si quien vende usa tallas de otro país, la publicación debe traer la tabla de equivalencias.")]),
    ("d06", "Acta de inventario octubre (escaneo).pdf", "escaneado", "compartida", "jorge.paz", "2026-10-31T23:00:00Z",
     [{"type": "group", "emailAddress": f"operaciones@{D}", "role": "reader"}],
     [P("# Acta de inventario", "Almacén Monterrey: 12,430 piezas contadas.", "Firmas del jefe de almacén y de auditoría."),
      P("Diferencias: 38 piezas faltantes en electrónica.", "Se abre investigación con seguridad.")]),
    ("d07", "Calendario de pagos a vendedores.pdf", "pdf", "compartida", "sofia.leal", "2026-10-01T16:00:00Z",
     [{"type": "group", "emailAddress": f"operaciones@{D}", "role": "reader"}, {"type": "group", "emailAddress": f"finanzas@{D}", "role": "reader"}],
     [P("# Calendario de pagos", "Los pagos a vendedores salen los martes y los viernes.",
        "Si el día de pago es festivo, el pago sale el día hábil siguiente."),
      P("# Retenciones", "Se retiene el pago de ventas con una devolución abierta hasta que se cierre.")]),
    ("d08", "Lineamientos de fotos de producto.pdf", "pdf", "compartida", "sofia.leal", "2026-09-03T15:00:00Z",
     [{"type": "domain", "domain": D, "role": "reader", "allowFileDiscovery": True}],
     [P("# Fotos de producto", "Mínimo 3 fotos por publicación, con fondo claro y sin marcas de agua.",
        "La primera foto muestra el producto completo."),
      P("# Lo que se rechaza", "Fotos con precios, teléfonos o enlaces a otras tiendas.")]),
    ("d09", "Plan de temporada alta.pdf", "pdf", "compartida", "jorge.paz", "2026-10-25T19:00:00Z",
     [{"type": "group", "emailAddress": f"operaciones@{D}", "role": "reader"},
      {"type": "domain", "domain": D, "role": "reader", "allowFileDiscovery": False}],
     [P("# Temporada alta 2026", "Del 15 de noviembre al 6 de enero se contratan 40 agentes temporales.",
        "Los almacenes abren también los domingos."),
      P("# Corte de pedidos", "El último pedido con entrega antes de Navidad se acepta el 19 de diciembre.")]),
    ("d10", "Código de conducta.pdf", "pdf", "mi", "irene.sol", "2026-03-01T12:00:00Z",
     [{"type": "anyone", "role": "reader", "allowFileDiscovery": True}],
     [P("# Código de conducta", "Tratamos a quien compra y a quien vende con respeto, aunque la conversación sea difícil.",
        "Nadie acepta regalos de vendedores con un valor mayor a 500 pesos."),
      P("# Conflictos de interés", "Si tienes relación con un vendedor, avisa a tu líder y no atiendas sus casos.")]),
]
for i, fecha in enumerate(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30", "2026-11-06"]):
    temas = ["entregas atrasadas en Monterrey", "nuevo almacén en Querétaro", "pico de devoluciones de moda",
             "cambio de paquetería en el Bajío", "preparación de temporada alta", "inventario de electrónica"]
    ARCHIVOS.append((f"d{11 + i}", f"Minuta semanal de operaciones {fecha}", "markdown", "compartida", "jorge.paz", f"{fecha}T22:00:00Z",
                     [{"type": "group", "emailAddress": f"operaciones@{D}", "role": "reader"}],
                     f"# Minuta semanal de operaciones · {fecha}\n\n## Tema principal\n\nSe revisó el {temas[i]}.\n\n"
                     f"## Acuerdos\n\n- Jorge da seguimiento con los almacenes.\n- Sofía actualiza la página de la wiki que corresponda.\n\n"
                     f"## Pendientes\n\n- Revisar el tablero de entregas el próximo viernes.\n"))

# ---------------------------------------------------------------- jira
PROYECTOS = {
    "SOP": {"nombre": "Soporte", "ver": [f"group:soporte@{D}", f"group:operaciones@{D}", "reportero"]},
    "SEG": {"nombre": "Seguridad y fraude", "ver": [f"group:fraude@{D}"]},
}
NIVELES = {"10001": {"nombre": "Solo líderes", "miembros": [f"group:soporte-lideres@{D}"]}}
AGENTES = ["ana.ruiz", "marco.diaz", "paula.vega", "tomas.rey", "elena.cruz"]
FIRMA = "\n\n--\nSaludos,\n{nombre}\nAgente de soporte · Marketplace\nExt. 44{n:02d}"
TEMAS_SOP = [
    ("Cliente reporta pedido sin movimiento desde hace 5 días", "La guía no se mueve desde el centro de distribución de Querétaro.", "Se abrió investigación con la paquetería y se reenvió el pedido."),
    ("Cobro duplicado en tarjeta de crédito", "La clienta ve dos cargos del mismo pedido.", "Se reembolsó el cargo duplicado; tarda de 1 a 3 días hábiles."),
    ("Vendedor no responde mensajes", "El comprador escribió hace 3 días y no tiene respuesta.", "Soporte tomó el caso y autorizó la devolución."),
    ("Producto llegó dañado", "La pantalla llegó estrellada; mandó fotos.", "Devolución sin costo de envío para quien compró."),
    ("Cupón de bienvenida no se aplicó", "El cupón pedía un mínimo de 500 pesos y el carrito era de 480.", "Se explicó la condición; no aplicaba compensación."),
    ("Cambio de dirección después de enviado", "El pedido ya había salido del almacén.", "Se ofreció recoger en sucursal."),
    ("Factura de un pedido del mes pasado", "La pide fuera del mes de compra.", "Se canalizó con quien vende para que la emita."),
    ("Talla equivocada en la publicación", "El vendedor publicó talla de Estados Unidos sin equivalencia.", "Devolución pagada por quien vende y aviso de calidad."),
]
TICKETS = []
for n in range(1, 41):
    titulo, desc, res = TEMAS_SOP[(n - 1) % len(TEMAS_SOP)]
    ag = AGENTES[(n - 1) % len(AGENTES)]
    nombre = ag.replace(".", " ").title()
    dia, hora = 1 + (n - 1) // 2, 9 + (n % 6)
    TICKETS.append({
        "key": f"SOP-{n}", "proyecto": "SOP", "titulo": titulo,
        "descripcion": desc + FIRMA.format(nombre=nombre, n=n),
        "resolucion": res, "reportero": f"{ag}@{D}", "nivel": "10001" if n in (5, 13, 21, 29, 37) else None,
        "creado": f"2026-11-{dia:02d}T{hora - 1:02d}:10:00Z", "actualizado": f"2026-11-{dia:02d}T{hora:02d}:{(n * 7) % 60:02d}:00Z",
        "comentarios": [
            {"autor": "automatizacion", "texto": "[automático] El ticket cambió a En progreso.", "fecha": f"2026-11-{dia:02d}T{hora - 1:02d}:15:00Z"},
            {"autor": f"{ag}@{D}", "texto": f"Le escribí a la persona.\n\nEl lun, 3 nov 2026 a las 10:12, cliente escribió:\n> ¿Me pueden ayudar?\n> Gracias.", "fecha": f"2026-11-{dia:02d}T{hora:02d}:00:00Z"},
        ],
    })
TICKETS[-1]["actualizado"] = "2026-11-20T14:59:40Z"   # el último del día: cae en el mismo minuto que el corte del cursor
for n in range(1, 11):
    TICKETS.append({
        "key": f"SEG-{n}", "proyecto": "SEG", "titulo": f"Posible cuenta de vendedor duplicada #{n}",
        "descripcion": f"Dos cuentas de vendedor comparten la misma cuenta bancaria (caso {n}).",
        "resolucion": "Se suspendió la cuenta más nueva mientras se revisa." if n % 2 else "",
        "reportero": f"tomas.rey@{D}", "nivel": None,
        "creado": f"2026-11-{n + 2:02d}T16:00:00Z", "actualizado": f"2026-11-{n + 2:02d}T18:30:00Z", "comentarios": [],
    })

# ---------------------------------------------------------------- políticas (un repositorio de git)
POLITICAS = {
    "devoluciones.md": "# Política de devoluciones\n\n## Plazo\n\nElectrónica: 15 días. Moda, Hogar y Juguetes: 30 días desde la entrega.\n\n## Excepciones\n\nNo se aceptan productos personalizados ni software activado.\n",
    "reembolsos.md": "# Política de reembolsos\n\nEl reembolso vuelve al método de pago original. Si el pago fue en tienda, se devuelve como saldo.\n",
    "envios.md": "# Política de envíos\n\nEnvío gratis en compras desde 599 pesos. La paquetería se asigna por código postal.\n",
    "garantias.md": "# Política de garantías\n\nLa garantía la da quien fabrica o quien vende. El marketplace media si no hay respuesta en 5 días hábiles.\n",
    "cancelaciones.md": "# Política de cancelaciones\n\nUn pedido se cancela sin costo mientras no salga del almacén.\n",
    "cupones.md": "# Política de cupones\n\nUn cupón por pedido. No se combinan con promociones de quien vende.\n",
    "vendedores.md": "# Política para vendedores\n\nQuien vende responde mensajes en 48 horas y envía en 2 días hábiles.\n",
    "privacidad.md": "# Datos personales en soporte\n\nNo pidas datos de tarjeta completos. Los últimos 4 dígitos bastan para cualquier aclaración.\n",
}
