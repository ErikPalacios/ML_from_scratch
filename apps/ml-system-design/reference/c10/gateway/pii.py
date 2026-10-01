"""Redacción de PII con expresiones regulares ANTES de mandar un prompt al vendor (fallback gobernado del c10).

Qué detecta (identificadores con FORMATO; México primero, porque el marketplace es de Latinoamérica):
  email · tarjeta (13–19 dígitos que pasan Luhn) · CLABE (18 dígitos con su dígito verificador) ·
  CURP (18 caracteres) · RFC (12–13) · teléfono (10 dígitos con +52/+1 opcional y separadores)

Ejemplo:
  "Soy Ana, mi correo es ana.p@mail.com y mi tel 55 1234 5678; la CLABE 002010077777777771"
  → "Soy Ana, mi correo es [EMAIL_1] y mi tel [PHONE_1]; la CLABE [CLABE_1]"
El mismo valor recibe el mismo marcador dentro de un request: el modelo sigue sabiendo que el correo de
la línea 3 es el mismo que el de la línea 9 ("coreferencia"), sin ver el dato.

LÍMITES (dilo así en la entrevista: una regex es una línea base, no una garantía):
  * NO detecta nombres ("Ana"), direcciones, números de pedido que alguien considere sensibles, ni PII
    escrita en palabras ("ana punto p arroba mail punto com") o partida entre mensajes.
  * Sobre-redacta: un número de pedido de 10 dígitos parece un teléfono. Eso baja la calidad de la respuesta
    del vendor, pero falla hacia el lado seguro.
  * Formatos de otros países (DNI, CPF, SSN) no están.
  * El siguiente paso es un detector con NER (p. ej. Microsoft Presidio, open source; verifica idiomas y
    reconocedores para español) y, sobre todo, MEDIR recall y precisión con una muestra etiquetada de
    prompts reales por tenant. Sin esa medición, "redactamos la PII" es una promesa, no un control.
Por eso el diseño no depende solo de esto: el tenant con más PII (soporte) no tiene fallback al vendor.

Solo biblioteca estándar.
"""

from __future__ import annotations  # anotaciones como texto

import re  # las expresiones regulares
from collections import Counter  # conteo por tipo para la métrica

# Orden importa: lo más específico primero (una CLABE de 18 dígitos también "parece" una tarjeta o un teléfono).
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Corridas de 13–19 dígitos con espacios o guiones opcionales entre grupos (como se escriben las tarjetas)
DIGIT_RUN = re.compile(r"(?<![\dA-Za-z])\d(?:[ -]?\d){12,18}(?![\dA-Za-z])")
# CURP: 4 letras, fecha AAMMDD, sexo (H o M), 5 letras (entidad y consonantes), homoclave, dígito
CURP = re.compile(r"(?<![A-Za-z0-9])[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d(?![A-Za-z0-9])", re.I)
# RFC: 3 (moral) o 4 (física) letras, fecha AAMMDD, homoclave de 3
RFC = re.compile(r"(?<![A-Za-z0-9])[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}(?![A-Za-z0-9])", re.I)
# Teléfono: +52 o +1 opcional, 10 dígitos en grupos (2-4-4, 3-3-4) con espacios, guiones, puntos o paréntesis
PHONE = re.compile(r"(?<![\dA-Za-z])(?:\+?(?:52|1)[ .-]?)?(?:\(?\d{2,3}\)?[ .-]?)\d{3,4}[ .-]?\d{4}(?![\dA-Za-z])")


def luhn_ok(digits: str) -> bool:
    """Dígito verificador de tarjetas (Luhn). Filtra la mayoría de las corridas de dígitos que no son tarjetas."""
    total, parity = 0, len(digits) % 2
    for i, ch in enumerate(digits):
        d = int(ch)
        if i % 2 == parity:  # se duplica cada segundo dígito contando desde la derecha
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def clabe_ok(digits: str) -> bool:
    """Dígito verificador de la CLABE: pesos 3, 7, 1 sobre los primeros 17 dígitos, módulo 10."""
    if len(digits) != 18:
        return False
    weights = (3, 7, 1) * 6
    s = sum((int(d) * w) % 10 for d, w in zip(digits[:17], weights[:17], strict=True))
    return (10 - s % 10) % 10 == int(digits[17])


class Redactor:
    """Reemplaza PII por marcadores estables dentro de un request ([EMAIL_1], [PHONE_2], …)."""

    def __init__(self) -> None:
        self._seen: dict[tuple[str, str], str] = {}  # (tipo, valor) → marcador
        self._next: Counter[str] = Counter()  # siguiente número por tipo
        self.counts: Counter[str] = Counter()  # cuántas ocurrencias se redactaron por tipo (para la métrica)

    def _mark(self, kind: str, value: str) -> str:
        key = (kind, value)
        if key not in self._seen:
            self._next[kind] += 1
            self._seen[key] = f"[{kind}_{self._next[kind]}]"
        self.counts[kind] += 1
        return self._seen[key]

    def _digits(self, m: re.Match) -> str:
        raw = m.group(0)
        digits = re.sub(r"\D", "", raw)
        if len(digits) == 18 and clabe_ok(digits):
            return self._mark("CLABE", digits)
        if luhn_ok(digits):
            return self._mark("CARD", digits)
        return raw  # una corrida larga que no es ni CLABE ni tarjeta: se deja (puede ser un SKU)

    def redact(self, text: str) -> str:
        text = EMAIL.sub(lambda m: self._mark("EMAIL", m.group(0).lower()), text)
        text = DIGIT_RUN.sub(self._digits, text)
        text = CURP.sub(lambda m: self._mark("CURP", m.group(0).upper()), text)
        text = RFC.sub(lambda m: self._mark("RFC", m.group(0).upper()), text)
        text = PHONE.sub(lambda m: self._mark("PHONE", re.sub(r"\D", "", m.group(0))[-10:]), text)
        return text

    def redact_messages(self, messages: list[dict]) -> list[dict]:
        """Copia de los mensajes con el texto redactado (content como string o como lista de partes)."""
        out = []
        for msg in messages:
            m = dict(msg)
            content = m.get("content")
            if isinstance(content, str):
                m["content"] = self.redact(content)
            elif isinstance(content, list):
                m["content"] = [
                    dict(p, text=self.redact(p["text"])) if isinstance(p, dict) and isinstance(p.get("text"), str) else p
                    for p in content
                ]
            m.pop("name", None)  # el campo opcional "name" suele traer el nombre de la persona: no sale
            out.append(m)
        return out
