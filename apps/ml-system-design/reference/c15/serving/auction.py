"""Subasta de los 3 slots de una página (caso c15): ranking por eCPM, reserva, un anuncio por anunciante y
segundo precio generalizado (GSP) por click. Funciones PURAS: sin red, sin reloj, sin azar no reproducible.

Ejemplo con los números del caso (reserva eCPM US$0.80, incremento US$0.01), un solo slot:
  A  bid US$0.50  pCTR 0.60 %  →  eCPM = 0.50 × 0.0060 × 1000 = US$3.00     ← gana
  B  bid US$1.20  pCTR 0.20 %  →  eCPM = 1.20 × 0.0020 × 1000 = US$2.40     ← el siguiente
  C  bid US$0.10  pCTR 0.40 %  →  eCPM = US$0.40 < 0.80: no participa (el slot no vale la reserva con C)
  A paga por click lo MÍNIMO con lo que habría ganado igual, más un centavo:
      precio = eCPM de B ÷ (1000 × pCTR de A) + 0.01 = 2.40 ÷ 6.0 + 0.01 = US$0.41   (≤ su bid de 0.50)
  Por cada 1,000 impresiones de A el publisher espera 0.41 × 6 clicks = US$2.46: ≈ el eCPM del segundo.
Ese es el GSP: Edelman, Ostrovsky y Schwarz (2007) describen que el anunciante en la posición i paga la
puja del de la posición i + 1, y que la versión con calidad ordena por puja × calidad y cobra lo mínimo
para superar el "rank" del siguiente; Varian (2007, "Position auctions") lo escribe como
precio_s = b_(s+1) × e_(s+1) / e_s. Aquí la calidad e es el pCTR en ESE slot.

Por qué pCTR entra al PRECIO, no solo al ranking: si el pCTR de A está inflado al doble, A paga la mitad.
Por eso la calibración del modelo es dinero (training/calibration.py), no una métrica de vanidad.

Reglas, cada una con la trampa que evita:
  1. RESERVA por slot: un anuncio participa en un slot solo si su eCPM REAL ahí es ≥ la reserva; si
     nadie la pasa, el slot va al fallback programático (vale más que un anuncio que paga menos).
  2. UN ANUNCIO POR ANUNCIANTE en la página, y el anunciante se resuelve ANTES de rankear: compite su
     mejor anuncio. Si su segundo anuncio siguiera en la lista, podría fijarle el precio a su propio
     ganador (pagar contra sí mismo) o inflarle el precio a un competidor con un anuncio que nunca va a
     poder ganar.
  3. GREEDY POR SLOT, del más valioso al menos valioso: el mejor gana el slot más valioso, después se
     repite con los que quedan. Con pCTR separables (pCTR = calidad × efecto de posición) da la misma
     asignación que ordenar una vez; con pCTR por anuncio × slot (el fallback) sigue siendo correcto.
  4. TOPE: el precio nunca pasa del bid (el +0.01 podría pasarlo cuando el siguiente casi empata).
  5. EMPATES deterministas pero no sesgados: se rompen con sha256(semilla del request + ad_id). Ordenar
     por ad_id le daría todos los empates al mismo anuncio; random() sin semilla haría el resultado
     irreproducible (no se podría re-jugar una subasta para una disputa).
  6. BOOST de anuncios nuevos (exploración del caso): multiplica la puntuación de RANKING (eCPM × boost).
     El precio sale del eCPM REAL del siguiente (sin su boost) dividido por el pCTR del ganador × SU boost:
     el anuncio con boost paga lo mínimo para conservar el lugar que el boost le dio (menos que sin boost),
     y el boost de otro nunca le sube el precio a nadie (si el siguiente tiene boost, cuenta su eCPM real).
     La exploración la paga el publisher, nunca un anunciante. Con boost = 1, exactamente la fórmula de arriba.
Dinero en float con 6 decimales al final (micro-dólares). En producción, enteros en micros de punta a punta.
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import hashlib  # desempates y exploración reproducibles por request
import random  # exploración: Random con semilla derivada del request (reproducible)
from collections.abc import Mapping, Sequence  # tipos de entrada
from dataclasses import dataclass  # tipos inmutables de entrada y salida
from typing import Literal  # valores permitidos


@dataclass(frozen=True)
class Bid:
    """Un candidato que llegó a la subasta (ya pasó segmentación, frequency cap y presupuesto)."""

    ad_id: str
    campaign_id: str
    advertiser_id: str
    bid: float  # CPC máximo en US$ (lo que el anunciante está dispuesto a pagar por click)
    pctr: Mapping[str, float]  # slot → pCTR EN ESE slot (ya con el efecto de posición)
    # Anuncios nuevos: multiplica la puntuación de ranking (≥ 1) y baja el precio del propio anuncio (paga lo
    # mínimo para conservar ese lugar); nunca sube el precio de otro ni cuenta para la reserva (regla 6)
    boost: float = 1.0


@dataclass(frozen=True)
class Placement:
    """Un slot vendido: quién, cuánto paga por click y por qué ese precio."""

    slot: str
    ad_id: str
    campaign_id: str
    advertiser_id: str
    bid: float
    pctr: float  # pCTR del ganador en este slot: entra a "expected clicks" para la calibración
    ecpm: float  # eCPM real del ganador (sin boost)
    price: float  # US$ por click (GSP, con tope en el bid)
    price_source: Literal["next_ad", "reserve"]  # qué fijó el precio: el siguiente o la reserva
    runner_up: str | None  # ad_id del siguiente (None si no hubo): evidencia para una disputa
    # P(este anuncio en este slot | lo elegido en los slots anteriores): 1 en la subasta; 1/n en exploración,
    # con n = elegibles que QUEDABAN en el slot. Es la marginal solo en el primer slot (ver run_exploration)
    propensity: float = 1.0
    eligible: int = 0  # exploración: anuncios sobre la reserva en este slot ANTES de sacar los ya colocados
    explored: bool = False


def ecpm(bid: float, pctr: float) -> float:
    """Ingreso esperado por 1,000 impresiones: bid × pCTR × 1000 (US$)."""
    return bid * pctr * 1000.0


def _tie_key(seed: str, ad_id: str) -> str:
    """Orden pseudoaleatorio pero reproducible entre empatados: cambia con el request, no con el ad_id."""
    return hashlib.sha256(f"{seed}|{ad_id}".encode()).hexdigest()


def _eligible(bids: Sequence[Bid], slot: str, reserve_ecpm: float, placed: set[str]) -> list[Bid]:
    """Candidatos que pueden ganar ESTE slot: anunciante sin slot todavía y eCPM real ≥ reserva."""
    return [b for b in bids if b.advertiser_id not in placed and ecpm(b.bid, b.pctr[slot]) >= reserve_ecpm]


def _price(winner: Bid, slot: str, runner_ecpm: float | None, reserve_ecpm: float, increment: float
           ) -> tuple[float, Literal["next_ad", "reserve"]]:
    """CPC mínimo con el que el ganador conservaría el slot (y pasaría la reserva), + incremento, con tope.

    Para ganarle al siguiente: bid × pCTR × 1000 × boost ≥ eCPM real del siguiente → bid ≥ eCPM / (1000 × pCTR × boost).
    Para pasar la reserva:     bid × pCTR × 1000 ≥ reserva                     →  bid ≥ reserva / (1000 × pCTR).
    """
    p = winner.pctr[slot]
    to_reserve = reserve_ecpm / (1000.0 * p)
    to_beat = runner_ecpm / (1000.0 * p * winner.boost) if runner_ecpm is not None else 0.0
    beat_runner = runner_ecpm is not None and to_beat >= to_reserve
    source: Literal["next_ad", "reserve"] = "next_ad" if beat_runner else "reserve"
    price = min(winner.bid, max(to_beat, to_reserve) + increment)
    return round(price, 6), source


def run_auction(bids: Sequence[Bid], slots: Sequence[str], *, reserve_ecpm: float = 0.80,
                increment: float = 0.01, seed: str = "") -> list[Placement]:
    """Subasta GSP greedy por slot. `slots` en orden de VALOR (el más valioso primero).

    Devuelve un Placement por slot vendido; un slot sin Placement va al fallback programático.
    `seed` = request_id: mismos datos y misma semilla → mismo resultado (se puede re-jugar).
    """
    placed: set[str] = set()  # anunciantes que ya tienen slot en esta página
    out: list[Placement] = []
    for slot in slots:
        eligible = _eligible(bids, slot, reserve_ecpm, placed)
        # Regla 2: el mejor anuncio de cada anunciante, por puntuación de ranking (eCPM × boost)
        best: dict[str, Bid] = {}
        for b in eligible:
            cur = best.get(b.advertiser_id)
            if cur is None or _rank_key(b, slot, seed) < _rank_key(cur, slot, seed):
                best[b.advertiser_id] = b
        ranked = sorted(best.values(), key=lambda b: _rank_key(b, slot, seed))
        if not ranked:
            continue  # nadie vale la reserva aquí: programático
        winner = ranked[0]
        runner = ranked[1] if len(ranked) > 1 else None
        # El eCPM REAL del siguiente (sin su boost): el boost de otro no le sube el precio al ganador
        runner_ecpm = ecpm(runner.bid, runner.pctr[slot]) if runner else None
        price, source = _price(winner, slot, runner_ecpm, reserve_ecpm, increment)
        out.append(Placement(slot=slot, ad_id=winner.ad_id, campaign_id=winner.campaign_id,
                             advertiser_id=winner.advertiser_id, bid=winner.bid, pctr=winner.pctr[slot],
                             ecpm=round(ecpm(winner.bid, winner.pctr[slot]), 6), price=price,
                             price_source=source, runner_up=runner.ad_id if runner else None))
        placed.add(winner.advertiser_id)
    return out


def _rank(b: Bid, slot: str) -> float:
    """Puntuación de ranking: eCPM × boost (con boost = 1, el eCPM a secas)."""
    return ecpm(b.bid, b.pctr[slot]) * b.boost


def _rank_key(b: Bid, slot: str, seed: str) -> tuple[float, str]:
    """Orden: mayor puntuación primero; empate → hash del request (regla 5)."""
    return (-_rank(b, slot), _tie_key(seed, b.ad_id))


def run_exploration(bids: Sequence[Bid], slots: Sequence[str], *, reserve_ecpm: float = 0.80,
                    increment: float = 0.01, seed: str = "") -> list[Placement]:
    """Exploración (≈ 1 % de los requests): en cada slot, un anuncio AL AZAR entre los que pasan la reserva.

    Para qué: el log de la subasta normal solo tiene lo que el modelo ya prefería; con este tráfico se
    evalúa un modelo nuevo sin el sesgo del viejo y se mide el efecto de posición sin confusión (en la
    subasta, los mejores anuncios van siempre arriba).
    Propensity: se loguea 1/n, con n = elegibles que QUEDABAN en el slot (lo elegido arriba ya sacó a su
    anunciante). Es P(anuncio en el slot | lo elegido en los slots anteriores), no la probabilidad marginal
    que pide IPS por slot. Ejemplo: 3 anuncios de 3 anunciantes, los 3 sobre la reserva en los 3 slots: se
    loguea 1/3, 1/2 y 1, pero cada anuncio cae en cada slot con probabilidad 1/3 (un test lo mide).
      - slot de arriba: la propensity logueada ES la marginal;
      - slots de abajo: si cada anunciante tiene un solo anuncio y los slots comparten los mismos elegibles,
        la marginal es 1/eligible (`eligible` = los que pasan la reserva en ese slot sin sacar a nadie: cada
        orden es igual de probable); si no, hay que sumar sobre lo que pudieron tomar los slots anteriores,
        y para eso hace falta loguear los conjuntos de elegibles (esta referencia loguea solo su tamaño).
    Precio: el de la reserva (lo mínimo para pasarla) + incremento, con tope en el bid. El anunciante nunca
    paga más que en una subasta normal, en la que paga al menos eso; la exploración la paga el publisher.
    Se respeta "un anuncio por anunciante": el elegido saca a su anunciante de los slots siguientes.
    """
    placed: set[str] = set()
    out: list[Placement] = []
    for slot in slots:
        pool = _eligible(bids, slot, reserve_ecpm, set())  # sobre la reserva en este slot, sin sacar a nadie
        eligible = sorted((b for b in pool if b.advertiser_id not in placed), key=lambda b: b.ad_id)  # orden fijo
        if not eligible:
            continue
        rng = random.Random(int.from_bytes(hashlib.sha256(f"{seed}|{slot}".encode()).digest()[:8], "big"))
        winner = rng.choice(eligible)  # uniforme entre los que quedan: propensity = 1 / n
        price, _ = _price(winner, slot, None, reserve_ecpm, increment)
        out.append(Placement(slot=slot, ad_id=winner.ad_id, campaign_id=winner.campaign_id,
                             advertiser_id=winner.advertiser_id, bid=winner.bid, pctr=winner.pctr[slot],
                             ecpm=round(ecpm(winner.bid, winner.pctr[slot]), 6), price=price,
                             price_source="reserve", runner_up=None,
                             propensity=1.0 / len(eligible), eligible=len(pool), explored=True))
        placed.add(winner.advertiser_id)
    return out
