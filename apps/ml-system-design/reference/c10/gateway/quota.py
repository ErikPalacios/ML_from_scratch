"""Cuotas por tenant en TOKENS por minuto (token bucket), con cobro estimado y conciliación con el uso real.

Por qué tokens y no requests: un request de 300 tokens y uno de 8,000 cuestan ≈ 27× distinto en GPU (y en la
factura del vendor). Una cuota en requests/min deja que un tenant con prompts largos se coma la flota.

El problema: el costo real se conoce al FINAL (usage.prompt_tokens + usage.completion_tokens) y la decisión
de admitir se toma al PRINCIPIO. Entonces:
  1. al llegar, se cobra una ESTIMACIÓN pesimista: prompt estimado + max_tokens (lo máximo que puede generar);
  2. al terminar, se concilia: se devuelve lo cobrado de más (o se cobra la diferencia si la estimación quedó
     corta; el balance puede quedar negativo y el tenant espera a que se recargue).

Ejemplo (soporte, 5.4 M tokens/min repartidos en 4 réplicas del gateway = 1.35 M por réplica; recarga de
22,500 tokens/s): un request con ≈ 2,000 tokens de prompt y max_tokens 1,024 cobra 3,024 al entrar; si generó
250, al final devuelve 3,024 − 2,250 = 774. Sin conciliar, el tenant pagaría ≈ 34 % de más
(3,024 ÷ 2,250 ≈ 1.34) y llegaría a su límite antes de usarlo.

Límite de esta referencia: el bucket vive en la memoria de UN proceso. Con N réplicas del gateway, cada una
tiene cuota ÷ N (lo hace llm_gateway.py con `gateway_replicas`): funciona si el balanceador reparte parejo,
y se desbalancea si no. En producción, el estado va a un store compartido (Redis con un script atómico)
que esta carpeta no incluye.

Solo biblioteca estándar.
"""

from __future__ import annotations  # anotaciones como texto

import math  # ceil de la estimación
import time  # reloj monotónico por defecto
from collections.abc import Callable  # tipo del reloj inyectable
from dataclasses import dataclass, field  # estado del bucket

# Caracteres por token para ESTIMAR sin tokenizer. ≈ 4 es la regla para inglés con tokenizers BPE; en
# español suele haber más tokens por carácter. 3.0 sobrestima a propósito (el error se devuelve al conciliar).
# Mídelo con tu tokenizer sobre una muestra de tus prompts: es una estimación, no un dato del modelo.
CHARS_PER_TOKEN = 3.0
TOKENS_PER_MESSAGE = 4  # overhead del chat template por mensaje (rol, separadores): estimación


def estimate_prompt_tokens(messages: list[dict]) -> int:
    """Tokens de entrada estimados a partir de los mensajes (texto y partes de texto; ignora imágenes)."""
    chars = 0
    for m in messages:
        content = m.get("content")
        if isinstance(content, str):
            chars += len(content)
        elif isinstance(content, list):  # formato multi-parte: [{"type": "text", "text": "..."}, ...]
            chars += sum(len(p.get("text", "")) for p in content if isinstance(p, dict))
    return math.ceil(chars / CHARS_PER_TOKEN) + TOKENS_PER_MESSAGE * len(messages)


@dataclass
class TokenBucket:
    """Bucket de `capacity` tokens que se recarga a `refill_per_s` tokens por segundo.

    capacity = la ráfaga permitida (aquí, un minuto de cuota). refill_per_s = cuota por minuto ÷ 60.
    El reloj se inyecta para que los tests no duerman.
    """

    capacity: float
    refill_per_s: float
    clock: Callable[[], float] = time.monotonic
    tokens: float = field(init=False)
    _last: float = field(init=False)

    def __post_init__(self) -> None:
        if self.capacity <= 0 or self.refill_per_s <= 0:
            raise ValueError("capacity y refill_per_s deben ser > 0")
        self.tokens = self.capacity  # arranca lleno: un tenant nuevo puede usar su ráfaga
        self._last = self.clock()

    def _refill(self) -> None:
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self._last) * self.refill_per_s)
        self._last = now

    def try_take(self, cost: float) -> tuple[bool, float]:
        """Cobra `cost` si hay saldo. Si no, devuelve cuántos segundos faltan para que alcance (Retry-After)."""
        if cost > self.capacity:
            # Nunca alcanzaría: no tiene sentido decir "reintenta en N s". Quien llama lo trata como 400.
            raise ValueError(f"un request de {cost:.0f} tokens no entra en un bucket de {self.capacity:.0f}")
        self._refill()
        if self.tokens >= cost:
            self.tokens -= cost
            return True, 0.0
        return False, (cost - self.tokens) / self.refill_per_s

    def settle(self, charged: float, actual: float) -> None:
        """Concilia: devuelve lo cobrado de más (sin pasar la capacidad) o cobra lo que faltó (puede quedar < 0)."""
        self._refill()
        self.tokens = min(self.capacity, self.tokens + (charged - actual))
