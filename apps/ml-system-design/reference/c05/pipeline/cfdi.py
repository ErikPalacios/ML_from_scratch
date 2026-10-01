"""Lectura del XML de un CFDI 4.0 (factura electrónica mexicana) → campos + UUID, SIN modelo.

Por qué este archivo es la mejor "extracción" del sistema: ≈ 60 % de las facturas llegan con su XML.
El XML ya trae RFCs, montos y UUID exactos, firmados y timbrados por un PAC. Hacer OCR del PDF de esa
misma factura es pagar por adivinar lo que ya está escrito. El mejor modelo es el que no corres.
Cuando solo llega el PDF, el QR impreso trae UUID, RFCs y total (parse_qr_url): también sin OCR.

Estructura que leemos (Anexo 20, CFDI 4.0):
  <cfdi:Comprobante Version="4.0" Fecha SubTotal Descuento? Total Moneda TipoDeComprobante …
      xmlns:cfdi="http://www.sat.gob.mx/cfd/4">
    <cfdi:Emisor Rfc Nombre RegimenFiscal/>
    <cfdi:Receptor Rfc Nombre DomicilioFiscalReceptor RegimenFiscalReceptor UsoCFDI/>
    <cfdi:Conceptos>…</cfdi:Conceptos>
    <cfdi:Impuestos TotalImpuestosTrasladados? TotalImpuestosRetenidos?>…</cfdi:Impuestos>
    <cfdi:Complemento>
      <tfd:TimbreFiscalDigital Version="1.1" UUID FechaTimbrado RfcProvCertif SelloCFD …
          xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"/>
      <implocal:ImpuestosLocales TotaldeTraslados TotaldeRetenciones …/>   (opcional)
    </cfdi:Complemento>
  </cfdi:Comprobante>

Seguridad (la trampa del XXE): el XML lo sube el cliente, así que es entrada hostil. Un DTD con
entidades puede pedir archivos locales (XXE) o expandirse hasta agotar la memoria ("billion laughs").
ElementTree de la biblioteca estándar no resuelve entidades externas, pero su protección contra la
expansión depende de la versión de expat enlazada (la documentación de Python advierte de versiones
anteriores a 2.7.2). defusedxml rechaza DTD y entidades sin importar esa versión, y un CFDI legítimo
nunca trae DTD: forbid_dtd=True no rompe nada real. Además se limita el tamaño ANTES de parsear.

Lo que este archivo NO hace: verificar el sello digital ni consultar el estatus en el SAT (vigente /
cancelado). La consulta vive en el worker de `validate`, detrás de una interfaz con timeout y reintentos
(el servicio público del SAT es un endpoint SOAP, ConsultaCFDIService); aquí solo se arma lo necesario.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlparse

import defusedxml.ElementTree as SafeET
from defusedxml import DefusedXmlException

NS_CFDI40 = "http://www.sat.gob.mx/cfd/4"
NS_CFDI33 = "http://www.sat.gob.mx/cfd/3"  # versión anterior: la detectamos para dar un motivo claro
NS_TFD = "http://www.sat.gob.mx/TimbreFiscalDigital"
NS_IMPLOCAL = "http://www.sat.gob.mx/implocal"
NS = {"cfdi": NS_CFDI40, "tfd": NS_TFD, "implocal": NS_IMPLOCAL}

# Un CFDI con cientos de conceptos pesa decenas o cientos de KB; 2 MB deja margen y corta abusos.
MAX_XML_BYTES = 2 * 1024 * 1024

UUID_RE = re.compile(r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$")
QR_HOST = "verificacfdi.facturaelectronica.sat.gob.mx"


class CfdiError(ValueError):
    """Error con código estable: el código va a métricas y decide el mensaje para el cliente."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Cfdi:
    version: str
    uuid: str
    fecha: dt.datetime  # hora local del lugar de expedición: el CFDI no trae zona horaria
    serie: str | None
    folio: str | None
    tipo_comprobante: str  # I ingreso, E egreso, T traslado, N nómina, P pago
    moneda: str
    tipo_cambio: Decimal | None
    subtotal: Decimal
    descuento: Decimal
    total: Decimal
    total_trasladados: Decimal
    total_retenidos: Decimal
    locales_trasladados: Decimal
    locales_retenidos: Decimal
    emisor_rfc: str
    emisor_nombre: str | None
    emisor_regimen: str | None
    receptor_rfc: str
    receptor_nombre: str | None
    receptor_cp: str | None  # DomicilioFiscalReceptor (código postal), obligatorio en 4.0
    uso_cfdi: str | None
    metodo_pago: str | None
    forma_pago: str | None
    fecha_timbrado: dt.datetime
    rfc_prov_certif: str | None
    sello_ultimos8: str  # últimos 8 caracteres del sello del emisor: el parámetro "fe" del QR

    def as_dict(self) -> dict:
        return {k: (str(v) if isinstance(v, (Decimal, dt.datetime)) else v) for k, v in asdict(self).items()}


def _dec(value: str | None, name: str, required: bool = False) -> Decimal:
    if value is None or value == "":
        if required:
            raise CfdiError("campo_faltante", f"Falta el atributo {name}.")
        return Decimal("0")
    try:
        return Decimal(value)
    except InvalidOperation as exc:
        raise CfdiError("monto_invalido", f"{name} no es un número: {value!r}.") from exc


def _dt(value: str | None, name: str) -> dt.datetime:
    try:
        return dt.datetime.fromisoformat(value or "")
    except ValueError as exc:
        raise CfdiError("fecha_invalida", f"{name} no tiene formato AAAA-MM-DDThh:mm:ss.") from exc


def parse_cfdi(xml_bytes: bytes) -> Cfdi:
    """Parsea y valida la estructura mínima. Lanza CfdiError con un código estable."""
    if len(xml_bytes) > MAX_XML_BYTES:
        raise CfdiError("xml_muy_grande", "El XML excede el tamaño máximo.")
    try:
        # forbid_dtd=True: un DTD en un CFDI es, como mínimo, sospechoso; nunca es necesario.
        root = SafeET.fromstring(xml_bytes, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except DefusedXmlException as exc:
        raise CfdiError("xml_con_dtd", "El XML trae DTD o entidades; se rechaza por seguridad.") from exc
    except SafeET.ParseError as exc:
        raise CfdiError("xml_invalido", "El archivo no es XML bien formado.") from exc

    if root.tag == f"{{{NS_CFDI33}}}Comprobante":
        raise CfdiError("version_no_soportada", "Es un CFDI 3.3; este pipeline lee CFDI 4.0.")
    if root.tag != f"{{{NS_CFDI40}}}Comprobante" or root.get("Version") != "4.0":
        raise CfdiError("no_es_cfdi", "El XML no es un Comprobante CFDI 4.0.")

    emisor = root.find("cfdi:Emisor", NS)
    receptor = root.find("cfdi:Receptor", NS)
    if emisor is None or receptor is None:
        raise CfdiError("campo_faltante", "Faltan Emisor o Receptor.")

    # Sin TimbreFiscalDigital no hay CFDI: es un XML que nadie timbró (un borrador, o un intento de fraude).
    tfd = root.find("cfdi:Complemento/tfd:TimbreFiscalDigital", NS)
    if tfd is None:
        raise CfdiError("sin_timbre", "El XML no tiene TimbreFiscalDigital: no es un CFDI timbrado.")
    uuid = (tfd.get("UUID") or "").upper()
    if not UUID_RE.match(uuid):
        raise CfdiError("uuid_invalido", "El UUID del timbre no tiene formato válido.")

    impuestos = root.find("cfdi:Impuestos", NS)  # el nodo de Comprobante, no los de cada concepto
    locales = root.find("cfdi:Complemento/implocal:ImpuestosLocales", NS)
    sello = root.get("Sello") or ""
    if len(sello) < 8:
        raise CfdiError("campo_faltante", "Falta el Sello del emisor.")

    tipo_cambio = root.get("TipoCambio")
    return Cfdi(
        version="4.0",
        uuid=uuid,
        fecha=_dt(root.get("Fecha"), "Fecha"),
        serie=root.get("Serie"),
        folio=root.get("Folio"),
        tipo_comprobante=root.get("TipoDeComprobante") or "",
        moneda=root.get("Moneda") or "",
        tipo_cambio=_dec(tipo_cambio, "TipoCambio") if tipo_cambio else None,
        subtotal=_dec(root.get("SubTotal"), "SubTotal", required=True),
        descuento=_dec(root.get("Descuento"), "Descuento"),
        total=_dec(root.get("Total"), "Total", required=True),
        total_trasladados=_dec(impuestos.get("TotalImpuestosTrasladados") if impuestos is not None else None,
                               "TotalImpuestosTrasladados"),
        total_retenidos=_dec(impuestos.get("TotalImpuestosRetenidos") if impuestos is not None else None,
                             "TotalImpuestosRetenidos"),
        locales_trasladados=_dec(locales.get("TotaldeTraslados") if locales is not None else None, "TotaldeTraslados"),
        locales_retenidos=_dec(locales.get("TotaldeRetenciones") if locales is not None else None, "TotaldeRetenciones"),
        emisor_rfc=(emisor.get("Rfc") or "").upper(),
        emisor_nombre=emisor.get("Nombre"),
        emisor_regimen=emisor.get("RegimenFiscal"),
        receptor_rfc=(receptor.get("Rfc") or "").upper(),
        receptor_nombre=receptor.get("Nombre"),
        receptor_cp=receptor.get("DomicilioFiscalReceptor"),
        uso_cfdi=receptor.get("UsoCFDI"),
        metodo_pago=root.get("MetodoPago"),
        forma_pago=root.get("FormaPago"),
        fecha_timbrado=_dt(tfd.get("FechaTimbrado"), "FechaTimbrado"),
        rfc_prov_certif=tfd.get("RfcProvCertif"),
        sello_ultimos8=sello[-8:],
    )


def to_fields(c: Cfdi) -> dict[str, dict]:
    """Campos con el MISMO esquema que produce `extract` para un PDF, para que routing no distinga.

    confidence = 1.0 y source = "xml": no hubo lectura que pudiera fallar. Aun así pasan por las
    validaciones (RFC, totales, estatus en el SAT): un XML perfecto puede ser de una factura cancelada.
    """
    vals = {
        "uuid": c.uuid,
        "emisor_rfc": c.emisor_rfc,
        "emisor_nombre": c.emisor_nombre,
        "receptor_rfc": c.receptor_rfc,
        "receptor_nombre": c.receptor_nombre,
        "fecha": c.fecha.date().isoformat(),
        "subtotal": str(c.subtotal),
        "descuento": str(c.descuento),
        "iva": str(c.total_trasladados),
        "retenciones": str(c.total_retenidos),
        "total": str(c.total),
        "moneda": c.moneda,
    }
    return {k: {"value": v, "confidence": 1.0, "source": "xml", "page": None, "bbox": None}
            for k, v in vals.items() if v is not None}


@dataclass(frozen=True)
class QrData:
    uuid: str
    emisor_rfc: str
    receptor_rfc: str
    total: Decimal
    fe: str | None


def parse_qr_url(url: str) -> QrData:
    """Texto del QR impreso en el PDF de un CFDI 4.0:
    https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=<UUID>&re=<RFC>&rr=<RFC>&tt=<total>&fe=<8>

    Decodificar un QR es barato y exacto; con UUID + RFCs + total ya se puede consultar el estatus en
    el SAT y cruzar con lo que el OCR leyó del PDF. Solo aceptamos el host del SAT: un QR que apunta a
    otro dominio es una señal de fraude, no un dato.
    """
    parsed = urlparse(url.strip())
    if parsed.scheme != "https" or parsed.hostname != QR_HOST:
        raise CfdiError("qr_dominio", "El QR no apunta al verificador del SAT.")
    # parse_qs convierte '+' en espacio; '&' dentro de un RFC (razones sociales con &) llega como %26.
    q = {k.lower(): v[0] for k, v in parse_qs(parsed.query, keep_blank_values=True).items()}
    missing = [k for k in ("id", "re", "rr", "tt") if not q.get(k)]
    if missing:
        raise CfdiError("qr_incompleto", f"Faltan parámetros en el QR: {', '.join(missing)}.")
    if not UUID_RE.match(q["id"]):
        raise CfdiError("uuid_invalido", "El UUID del QR no tiene formato válido.")
    return QrData(uuid=q["id"].upper(), emisor_rfc=q["re"].upper(), receptor_rfc=q["rr"].upper(),
                  total=_dec(q["tt"], "tt", required=True), fe=q.get("fe"))


def qr_matches(c: Cfdi, qr: QrData) -> list[str]:
    """Diferencias entre el XML y el QR (lista vacía = coinciden). Si alguien sube el XML de una factura
    y el PDF de otra, aquí se nota."""
    diffs = []
    if c.uuid != qr.uuid:
        diffs.append("uuid")
    if c.emisor_rfc != qr.emisor_rfc:
        diffs.append("emisor_rfc")
    if c.receptor_rfc != qr.receptor_rfc:
        diffs.append("receptor_rfc")
    if c.total != qr.total:
        diffs.append("total")
    if qr.fe and qr.fe != c.sello_ultimos8:
        diffs.append("fe")
    return diffs
