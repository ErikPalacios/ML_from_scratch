"""Tokens de impresión firmados (caso c15): lo que viaja en las URLs del beacon de visibilidad y del click.

El problema: el click llega horas o segundos después del request, desde el navegador de la persona, por
GET /v1/click?t=…. Para cobrarlo hay que saber QUÉ se mostró, en qué slot y a qué PRECIO (el precio se
decidió en la subasta, no al hacer click). Si esos datos viajaran en claro sin firma, cualquiera podría
cambiar el precio o el ad_id en la URL, o fabricar clicks de anuncios que nunca se mostraron.
La solución: el ad-api firma los datos con HMAC-SHA256 y una llave que solo tiene el servidor; /v1/imp y
/v1/click verifican la firma antes de contar nada.

Formato: <payload en base64url>.<firma en base64url>
  payload = JSON compacto: v (versión del formato), kid (qué llave firmó), rid (request_id), ad, c
            (campaña), slot, px (precio por click en US$), p (pCTR en ese slot), src (model | explore |
            fallback) y ts (segundos epoch del serve)
  firma   = HMAC-SHA256(llave[kid], payload en base64url) — se firma el texto EXACTO que viaja y se
            verifica ese mismo texto: nunca se re-serializa el JSON para verificar (otro orden de llaves,
            otros espacios = otra firma)
Ejemplo, recortado: eyJhZCI6ImEwMTIzIiwi….q3Xk… (≈ 270 caracteres con un request_id de 32 caracteres:
cabe sin problema en una URL).

Lo que NO resuelve (trampas):
  - FIRMADO no es CIFRADO: cualquiera que lea la URL ve el precio y el pCTR (base64 no es secreto). Si el
    precio debe ser confidencial, cifra (AEAD, p. ej. AES-GCM) o guarda los datos del lado del servidor
    con el imp_id como llave.
  - Un bot que hace click en una URL REAL produce un token válido: la firma evita falsificar, no el
    tráfico inválido (IVT). Eso lo filtra un job aparte (fuera de esta carpeta).
  - Un token válido puede repetirse (doble click, recarga): la deduplicación por imp_id es del ad-api.
Rotación de llaves: se firma con la activa y se aceptan todas las configuradas (la activa y la anterior),
así se puede rotar sin invalidar los tokens que ya están en páginas abiertas.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import base64  # base64url sin relleno: seguro dentro de una URL
import hashlib  # sha256 para el HMAC
import hmac  # firma y comparación en tiempo constante
import json  # payload compacto
from collections.abc import Mapping  # llaves por kid

VERSION = 1  # versión del FORMATO del token (no del modelo): permite cambiarlo sin romper los viejos
FIELDS = ("rid", "ad", "c", "slot", "px", "p", "src", "ts")  # lo que el ad-api tiene que mandar


class TokenError(ValueError):
    """Token rechazado. `reason` es el label de la métrica (malformed, unknown_key, bad_signature…)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _mac(key: bytes, payload_b64: str) -> bytes:
    return hmac.new(key, payload_b64.encode("ascii"), hashlib.sha256).digest()


def sign(data: Mapping[str, object], key: bytes, kid: str) -> str:
    """Firma los campos de una impresión. Falta un campo → error en el ad-api, no un token incompleto."""
    missing = [f for f in FIELDS if f not in data]
    if missing:
        raise ValueError(f"faltan campos en el token: {missing}")
    payload = {"v": VERSION, "kid": kid, **{f: data[f] for f in FIELDS}}
    payload_b64 = _b64e(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    return payload_b64 + "." + _b64e(_mac(key, payload_b64))


def verify(token: str, keys: Mapping[str, bytes], *, now: float, max_age_s: float,
           max_skew_s: float = 60.0) -> dict:
    """Devuelve el payload si la firma es válida y el token no venció; si no, TokenError(reason).

    Orden: primero la FIRMA y después se confía en el contenido (la edad, el precio). max_skew_s tolera
    relojes de pods un poco adelantados; un ts muy en el futuro es un token raro, no un reloj.
    """
    try:
        payload_b64, sig_b64 = token.split(".")
        payload = json.loads(_b64d(payload_b64))
        sig = _b64d(sig_b64)
    except (ValueError, TypeError, UnicodeDecodeError):  # json.JSONDecodeError y binascii.Error son ValueError
        raise TokenError("malformed") from None
    if not isinstance(payload, dict) or payload.get("v") != VERSION:
        raise TokenError("malformed")
    key = keys.get(str(payload.get("kid")))
    if key is None:
        raise TokenError("unknown_key")  # una llave retirada o un token inventado
    if not hmac.compare_digest(sig, _mac(key, payload_b64)):  # tiempo constante: no filtra cuánto coincidió
        raise TokenError("bad_signature")
    if any(f not in payload for f in FIELDS):
        raise TokenError("malformed")
    age = now - float(payload["ts"])
    if age > max_age_s:
        raise TokenError("expired")
    if age < -max_skew_s:
        raise TokenError("future")
    return payload


def peek_unverified(token: str) -> dict | None:
    """Lee el payload SIN verificar la firma. Solo para elegir a dónde redirigir un click con token
    inválido (a la landing del anuncio, sacada del índice): nunca para contar ni para cobrar."""
    try:
        payload = json.loads(_b64d(token.split(".")[0]))
    except (ValueError, TypeError, UnicodeDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def imp_id(payload: Mapping[str, object]) -> str:
    """Llave de UNA impresión: request + slot (un request llena cada slot una sola vez).

    Es la llave de deduplicación de beacons y clicks y la llave del join en build_training_set.py.
    """
    return f"{payload['rid']}:{payload['slot']}"
