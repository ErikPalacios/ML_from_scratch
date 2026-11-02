"""Tests de cfdi.py con un CFDI 4.0 sintético (tests/fixtures/cfdi40_sintetico.xml)."""

from decimal import Decimal
from pathlib import Path

import pytest

import cfdi
import validators

FIXTURE = Path(__file__).parent / "fixtures" / "cfdi40_sintetico.xml"


@pytest.fixture
def xml() -> bytes:
    return FIXTURE.read_bytes()


def test_parsea_campos_y_uuid(xml):
    c = cfdi.parse_cfdi(xml)
    assert c.uuid == "6F1D1A3C-0B5E-4C7A-9E2B-1A2B3C4D5E6F"
    assert (c.emisor_rfc, c.receptor_rfc) == ("EKU9003173C9", "PSI200101AB3")
    assert (c.subtotal, c.descuento, c.total) == (Decimal("10000.00"), Decimal("500.00"), Decimal("10901.25"))
    # El nodo Impuestos del COMPROBANTE, no los de cada concepto (find no busca en profundidad).
    assert (c.total_trasladados, c.total_retenidos) == (Decimal("1520.00"), Decimal("118.75"))
    assert c.fecha.isoformat() == "2026-09-15T10:30:00" and c.fecha.tzinfo is None
    assert c.receptor_cp == "06000" and c.uso_cfdi == "G03" and c.tipo_comprobante == "I"
    assert c.sello_ultimos8 == "RVRJQw=="


def test_el_cfdi_sintetico_pasa_las_validaciones(xml):
    c = cfdi.parse_cfdi(xml)
    assert validators.validate_rfc(c.emisor_rfc).ok and validators.validate_rfc(c.receptor_rfc).ok
    assert validators.check_cfdi_totals(subtotal=c.subtotal, descuento=c.descuento, trasladados=c.total_trasladados,
                                        retenidos=c.total_retenidos, total=c.total).ok


def test_to_fields_mismo_esquema_que_extract(xml):
    f = cfdi.to_fields(cfdi.parse_cfdi(xml))
    assert f["total"] == {"value": "10901.25", "confidence": 1.0, "source": "xml", "page": None, "bbox": None}
    assert {"uuid", "emisor_rfc", "receptor_rfc", "fecha", "subtotal", "iva", "retenciones", "total"} <= set(f)


def test_xxe_se_rechaza():
    evil = b"""<?xml version="1.0"?>
<!DOCTYPE c [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0">&xxe;</cfdi:Comprobante>"""
    with pytest.raises(cfdi.CfdiError) as e:
        cfdi.parse_cfdi(evil)
    assert e.value.code == "xml_con_dtd"


def test_billion_laughs_se_rechaza():
    bomb = b"""<?xml version="1.0"?>
<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]>
<lolz>&lol2;</lolz>"""
    with pytest.raises(cfdi.CfdiError) as e:
        cfdi.parse_cfdi(bomb)
    assert e.value.code == "xml_con_dtd"


def test_sin_timbre_no_es_cfdi(xml):
    start = xml.index(b"<cfdi:Complemento>")
    end = xml.index(b"</cfdi:Complemento>") + len(b"</cfdi:Complemento>")
    with pytest.raises(cfdi.CfdiError) as e:
        cfdi.parse_cfdi(xml[:start] + xml[end:])
    assert e.value.code == "sin_timbre"


def test_cfdi_33_motivo_claro(xml):
    old = xml.replace(b"http://www.sat.gob.mx/cfd/4", b"http://www.sat.gob.mx/cfd/3").replace(b'Version="4.0"', b'Version="3.3"')
    with pytest.raises(cfdi.CfdiError) as e:
        cfdi.parse_cfdi(old)
    assert e.value.code == "version_no_soportada"


@pytest.mark.parametrize("data,code", [
    (b"no soy xml", "xml_invalido"),
    (b"<factura/>", "no_es_cfdi"),
    (b"<a>" + b"x" * (cfdi.MAX_XML_BYTES + 1) + b"</a>", "xml_muy_grande"),
])
def test_errores_con_codigo(data, code):
    with pytest.raises(cfdi.CfdiError) as e:
        cfdi.parse_cfdi(data)
    assert e.value.code == code


def test_monto_no_numerico(xml):
    with pytest.raises(cfdi.CfdiError) as e:
        cfdi.parse_cfdi(xml.replace(b'Total="10901.25"', b'Total="diez mil"'))
    assert e.value.code == "monto_invalido"


@pytest.mark.parametrize("raw", ["NaN", "Infinity", "-Infinity", "1E+3", "sNaN"])
def test_montos_que_decimal_acepta_pero_no_son_montos(xml, raw):
    # Decimal("NaN") no falla: sin este chequeo pasaría el gate y reventaría en la cuadratura.
    with pytest.raises(cfdi.CfdiError) as e:
        cfdi.parse_cfdi(xml.replace(b'SubTotal="10000.00"', f'SubTotal="{raw}"'.encode()))
    assert e.value.code == "monto_invalido"


def test_impuestos_locales():
    data = FIXTURE.read_bytes().replace(
        b"</cfdi:Complemento>",
        b'<implocal:ImpuestosLocales xmlns:implocal="http://www.sat.gob.mx/implocal" version="1.0" '
        b'TotaldeRetenciones="0.00" TotaldeTraslados="190.00"/></cfdi:Complemento>',
    ).replace(b'Total="10901.25"', b'Total="11091.25"')
    c = cfdi.parse_cfdi(data)
    assert c.locales_trasladados == Decimal("190.00")
    ok = validators.check_cfdi_totals(subtotal=c.subtotal, descuento=c.descuento, trasladados=c.total_trasladados,
                                      retenidos=c.total_retenidos, total=c.total,
                                      locales_trasladados=c.locales_trasladados, locales_retenidos=c.locales_retenidos)
    assert ok.ok


QR = ("https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=6F1D1A3C-0B5E-4C7A-9E2B-1A2B3C4D5E6F"
      "&re=EKU9003173C9&rr=PSI200101AB3&tt=10901.25&fe=RVRJQw==")


def test_qr_coincide_con_el_xml(xml):
    qr = cfdi.parse_qr_url(QR)
    assert qr.total == Decimal("10901.25") and qr.fe == "RVRJQw=="
    assert cfdi.qr_matches(cfdi.parse_cfdi(xml), qr) == []


def test_qr_de_otra_factura(xml):
    qr = cfdi.parse_qr_url(QR.replace("tt=10901.25", "tt=99.00"))
    assert cfdi.qr_matches(cfdi.parse_cfdi(xml), qr) == ["total"]


def test_qr_con_mas_literal_en_fe(xml):
    """fe son los últimos 8 caracteres del Sello (base64, que usa '+'). parse_qs a secas lo volvería
    espacio y la factura legítima saldría como "QR de otra factura"."""
    sello_mas = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=srD+Gw=="
    data = xml.replace(b'Sello="U0VMTE9fRklDVElDSU9fUEFSQV9URVNUU19TSU5URVRJQw=="', f'Sello="{sello_mas}"'.encode())
    qr = cfdi.parse_qr_url(QR.replace("fe=RVRJQw==", "fe=srD+Gw=="))
    assert qr.fe == "srD+Gw==" and cfdi.qr_matches(cfdi.parse_cfdi(data), qr) == []
    assert cfdi.parse_qr_url(QR.replace("fe=RVRJQw==", "fe=srD%2BGw==")).fe == "srD+Gw=="  # ya codificado: igual


def test_qr_rfc_con_ampersand_codificado():
    qr = cfdi.parse_qr_url(QR.replace("re=EKU9003173C9", "re=A%26B900101AB1"))
    assert qr.emisor_rfc == "A&B900101AB1"


@pytest.mark.parametrize("url,code", [
    (QR.replace("verificacfdi.facturaelectronica.sat.gob.mx", "verificacfdi.example.com"), "qr_dominio"),
    (QR.replace("https://", "http://"), "qr_dominio"),
    (QR.replace("&rr=PSI200101AB3", ""), "qr_incompleto"),
    (QR.replace("id=6F1D1A3C", "id=XXXX"), "uuid_invalido"),
])
def test_qr_invalidos(url, code):
    with pytest.raises(cfdi.CfdiError) as e:
        cfdi.parse_qr_url(url)
    assert e.value.code == code
