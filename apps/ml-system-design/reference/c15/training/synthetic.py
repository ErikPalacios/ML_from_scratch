"""Datos SINTÉTICOS para los tests y la demo del caso c15. No describen a ningún publisher real.

Un "mundo" con anuncios, campañas con presupuesto y una VERDAD oculta de CTR por impresión visible:
  logit = −4.6 (≈ 1 %)
        + efecto del slot              top 0 · in_article −0.25 · bottom −0.8
        + slot × formato               video en in_article +0.35 · banner en bottom −0.2
        + calidad oculta del anuncio   ~ N(0, 0.4)
        + sección × categoría          deportes × autos +0.3 · economia × inmobiliario +0.4 · …
        + interés × categoría          +0.5 si la persona lee una sección afín a la categoría (el modelo solo
                                       lo ve con consentimiento; la persona se comporta igual sin él)
        + dispositivo × formato        native en celular +0.25 · banner en escritorio +0.1
        + mañana (7–9 h)               +0.1
CTR promedio ≈ 1 %: más alto que el 0.35 % del caso a propósito, para que los tests tengan clicks
suficientes con pocas filas. Las páginas reparten los anuncios AL AZAR entre los 3 slots (como el
tráfico de exploración): así el efecto de la posición es identificable. En la subasta real los mejores
anuncios van arriba y la posición se confunde con la calidad (por eso existe la exploración).
"""

from __future__ import annotations  # anotaciones como texto: sintaxis moderna sin costo en runtime

import math  # techo de divisiones
from collections.abc import Sequence  # tipos

import numpy as np  # muestreo vectorizado

import features as F  # serving/features.py: slots y formatos válidos
from build_training_set import LabelConfig, build  # el pipeline real de etiquetas

T0 = 1_791_000_000.0  # 2026-10-03 04:00 UTC: un "día" cualquiera para los timestamps
SECTIONS = ("deportes", "politica", "economia", "espectaculos", "autos", "tecnologia", "salud", "mundo")
DEVICES = ("mobile", "desktop", "tablet")
DEVICE_P = (0.70, 0.25, 0.05)
GEOS = ("MX-CMX", "MX-JAL", "MX-NLE", "MX-PUE", "MX-YUC")
CATEGORIES = ("autos", "retail", "educacion", "inmobiliario", "telecom", "viajes")
FORMAT_P = (0.35, 0.50, 0.15)  # banner, native, video (el orden de F.FORMATS)
# Sección leída → categoría afín (el "interés" de la verdad oculta)
INTEREST_TO_CATEGORY = {"autos": "autos", "deportes": "autos", "tecnologia": "telecom",
                        "economia": "inmobiliario", "mundo": "viajes", "espectaculos": "retail"}
SECTION_CATEGORY = {("deportes", "autos"): 0.3, ("economia", "inmobiliario"): 0.4, ("tecnologia", "telecom"): 0.4,
                    ("mundo", "viajes"): 0.3, ("espectaculos", "retail"): 0.2, ("economia", "educacion"): 0.2}
SLOT_EFFECT = (0.0, -0.25, -0.8)  # top, in_article, bottom (el orden de F.SLOTS)
SLOT_FORMAT = {("in_article", "video"): 0.35, ("bottom", "banner"): -0.2}
DEVICE_FORMAT = {("mobile", "native"): 0.25, ("desktop", "banner"): 0.1}
BASE_LOGIT = -4.6
VIEWABILITY = (0.85, 0.70, 0.45)  # P(visible) por slot: el de abajo se ve menos (ilustrativo)


def _table(pairs: dict, rows: Sequence[str], cols: Sequence[str]) -> np.ndarray:
    t = np.zeros((len(rows), len(cols)))
    for (r, c), v in pairs.items():
        t[rows.index(r), cols.index(c)] = v
    return t


SEC_CAT = _table(SECTION_CATEGORY, SECTIONS, CATEGORIES)
SLOT_FMT = _table(SLOT_FORMAT, F.SLOTS, F.FORMATS)
DEV_FMT = _table(DEVICE_FORMAT, DEVICES, F.FORMATS)
# Por categoría, la máscara de bits de las secciones cuyo interés la vuelve afín
CAT_INTEREST_MASK = np.array([sum(1 << SECTIONS.index(s) for s, c in INTEREST_TO_CATEGORY.items() if c == cat)
                              for cat in CATEGORIES], dtype=np.int64)


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-z))


class World:
    """Anuncios + campañas + la verdad oculta. `targeted=False`: todos los anuncios aceptan todo contexto."""

    def __init__(self, seed: int = 0, n_ads: int = 60, n_advertisers: int = 25, ads_per_campaign: int = 4,
                 targeted: bool = True, new_share: float = 0.1) -> None:
        rng = np.random.default_rng(seed)
        self.rng_seed = seed
        n_campaigns = math.ceil(n_ads / ads_per_campaign)
        camp_adv = rng.integers(0, n_advertisers, size=n_campaigns)
        camp_cap = rng.choice(np.array([5, 3, 0]), p=(0.7, 0.2, 0.1), size=n_campaigns)  # 0 = sin cap
        self.cat = rng.integers(0, len(CATEGORIES), size=n_ads)
        self.fmt = rng.choice(len(F.FORMATS), p=FORMAT_P, size=n_ads)
        self.quality = rng.normal(0.0, 0.4, size=n_ads)  # la verdad oculta
        self.bid = np.exp(rng.uniform(np.log(0.05), np.log(1.50), size=n_ads))  # CPC log-uniforme, rango del caso
        self.camp = np.arange(n_ads) // ads_per_campaign
        self.adv = camp_adv[self.camp]
        is_new = rng.random(n_ads) < new_share
        lifetime = np.where(is_new, rng.integers(0, 10_000, size=n_ads), rng.integers(10_000, 2_000_000, size=n_ads))
        self.ads: list[dict] = []
        for i in range(n_ads):
            t = self._targeting(rng) if targeted else {}
            cap = int(camp_cap[self.camp[i]])
            self.ads.append(dict(
                ad_id=f"a{i:04d}", campaign_id=f"c{self.camp[i]:03d}", advertiser_id=f"v{self.adv[i]:03d}",
                bid=round(float(self.bid[i]), 2) or 0.05, ad_category=CATEGORIES[self.cat[i]],
                ad_format=F.FORMATS[self.fmt[i]], title=f"Oferta {CATEGORIES[self.cat[i]]} {i}",
                image_url=f"https://cdn.example.com/creativos/a{i:04d}.jpg",
                landing_url=f"https://anunciante{self.adv[i]:03d}.example.com/a{i:04d}",
                advertiser_name=f"Anunciante {self.adv[i]:03d}", freq_cap_per_day=cap or None,
                lifetime_impressions=int(lifetime[i]), **t))
        self.bid = np.array([a["bid"] for a in self.ads])  # el bid redondeado es el que se sirve
        rngb = np.random.default_rng(seed + 1)
        self._budgets = {}
        for c in range(n_campaigns):
            daily = float(np.exp(rngb.uniform(np.log(50), np.log(5000))))
            spent = daily * (1.05 if rngb.random() < 0.05 else rngb.uniform(0.0, 0.9))  # ≈ 5 % ya agotadas
            self._budgets[f"c{c:03d}"] = {"spent_usd": round(spent, 2), "daily_budget_usd": round(daily, 2),
                                          "serve_rate": round(float(rngb.uniform(0.2, 0.8)), 3)}

    @staticmethod
    def _targeting(rng: np.random.Generator) -> dict:
        """Segmentación aleatoria: con 2,500 anuncios deja ≈ 150–200 elegibles por request (test de latencia)."""
        t: dict = {}
        if rng.random() > 0.25:
            t["target_sections"] = frozenset(rng.choice(SECTIONS, size=int(rng.integers(1, 3)), replace=False))
        if rng.random() > 0.70:
            t["target_devices"] = frozenset({"mobile"}) if rng.random() < 0.5 else frozenset({"desktop", "tablet"})
        if rng.random() > 0.50:
            t["target_geos"] = frozenset({str(rng.choice(GEOS))})
        if rng.random() > 0.85:
            start = int(rng.choice([6, 12, 18]))
            t["target_hours"] = frozenset(range(start, start + 6))
        if rng.random() < 0.15:  # segmentación por interés (solo secciones NO sensibles)
            ok = [s for s in SECTIONS if s not in F.SENSITIVE_SECTIONS]
            t["target_interests"] = frozenset(rng.choice(ok, size=int(rng.integers(1, 3)), replace=False))
        return t

    # -------------------------------------------------------------------------- la verdad oculta
    def true_logit(self, sec: np.ndarray, dev: np.ndarray, hour: np.ndarray, imask: np.ndarray,
                   ad: np.ndarray, slot: np.ndarray) -> np.ndarray:
        cat, fmt = self.cat[ad], self.fmt[ad]
        return (BASE_LOGIT + np.asarray(SLOT_EFFECT)[slot] + SLOT_FMT[slot, fmt] + self.quality[ad]
                + SEC_CAT[sec, cat] + 0.5 * ((imask & CAT_INTEREST_MASK[cat]) != 0) + DEV_FMT[dev, fmt]
                + 0.1 * ((hour >= 7) & (hour <= 9)))

    def sample_contexts(self, n: int, rng: np.random.Generator) -> dict[str, np.ndarray]:
        """n páginas vistas: sección, dispositivo, geo, hora, día, consentimiento e intereses (máscara)."""
        hours = rng.choice(24, size=n, p=_diurnal())
        imask = np.zeros(n, dtype=np.int64)
        for k in range(len(SECTIONS)):  # cada sección, leída por ≈ 15 % de las personas (incluye sensibles)
            imask |= (rng.random(n) < 0.15).astype(np.int64) << k
        return {"sec": rng.integers(0, len(SECTIONS), size=n), "dev": rng.choice(3, p=DEVICE_P, size=n),
                "geo": rng.integers(0, len(GEOS), size=n), "hour": hours, "dow": rng.integers(0, 7, size=n),
                "consent": rng.random(n) < 0.7, "imask": imask, "user": rng.integers(0, 50_000, size=n)}

    def mean_ctr(self, ad: int, slot: int, n: int = 2000, seed: int = 0) -> float:
        """CTR esperado de un anuncio en un slot, promediando contextos (para la tabla del fallback)."""
        ctx = self.sample_contexts(n, np.random.default_rng(seed))
        z = self.true_logit(ctx["sec"], ctx["dev"], ctx["hour"], ctx["imask"], np.full(n, ad), np.full(n, slot))
        return float(sigmoid(z).mean())

    # -------------------------------------------------------------------------- eventos de ad-events
    def make_events(self, n_pageviews: int, seed: int = 0, start_ts: float = T0, late_click_share: float = 0.02,
                    lost_beacon_share: float = 0.03, dup_share: float = 0.01
                    ) -> tuple[list[dict], list[dict], list[dict]]:
        """(serves, impressions, clicks) como los escribiría el ad-api: un día de tráfico sintético."""
        rng = np.random.default_rng(seed)
        ctx = self.sample_contexts(n_pageviews, rng)
        n_ads = len(self.ads)
        picks = rng.integers(0, n_ads, size=(n_pageviews, 8))
        ad_of = np.zeros((n_pageviews, 3), dtype=np.int64)
        for r in range(n_pageviews):  # 3 anuncios de anunciantes distintos (regla de la subasta)
            seen, k = set(), 0
            for a in picks[r]:
                if self.adv[a] not in seen:
                    seen.add(self.adv[a])
                    ad_of[r, k] = a
                    k += 1
                    if k == 3:
                        break
            while k < 3:  # muy raro con pocos anunciantes: completa sin la regla
                ad_of[r, k] = picks[r, k]
                k += 1
        slot_of = np.tile(np.arange(3), (n_pageviews, 1))
        rep = lambda a: np.repeat(a, 3)  # noqa: E731 — una columna por placement
        z = self.true_logit(rep(ctx["sec"]), rep(ctx["dev"]), rep(ctx["hour"]), rep(ctx["imask"]),
                            ad_of.ravel(), slot_of.ravel())
        viewable = rng.random(z.size) < np.asarray(VIEWABILITY)[slot_of.ravel()]
        clicked = viewable & (rng.random(z.size) < sigmoid(z))
        serve_ts = start_ts + np.sort(rng.uniform(0, 86_400, size=n_pageviews))
        view_delay = 1.0 + rng.exponential(np.where(slot_of.ravel() == 2, 30.0, 5.0))
        click_delay = np.where(rng.random(z.size) < late_click_share, rng.uniform(31 * 60, 3 * 3600, size=z.size),
                               rng.exponential(15.0, size=z.size))
        lost = rng.random(z.size) < lost_beacon_share  # beacon bloqueado o perdido
        serves, imps, clicks = [], [], []
        for r in range(n_pageviews):
            rid = f"r{seed}x{r:07d}"
            consent = bool(ctx["consent"][r])
            interests = [SECTIONS[k] for k in range(len(SECTIONS)) if ctx["imask"][r] >> k & 1] if consent else []
            context = {"section": SECTIONS[ctx["sec"][r]], "device": DEVICES[ctx["dev"][r]],
                       "geo": GEOS[ctx["geo"][r]], "hour": int(ctx["hour"][r]), "dow": int(ctx["dow"][r])}
            placements = []
            for j in range(3):
                i, a = r * 3 + j, int(ad_of[r, j])
                ad = self.ads[a]
                slot = F.SLOTS[j]
                iid = f"{rid}:{slot}"
                placements.append({"imp_id": iid, "slot": slot, **{f: ad[f] for f in F.AD_FIELDS},
                                   "bid": ad["bid"], "pctr": None, "price": None, "src": "explore",
                                   "propensity": None})
                vts = float(serve_ts[r] + view_delay[i])
                if viewable[i] and not lost[i]:
                    imps.append({"type": "impression", "event_id": f"i-{iid}", "imp_id": iid, "ts": vts})
                if clicked[i]:
                    clicks.append({"type": "click", "event_id": f"k-{iid}", "imp_id": iid,
                                   "ts": vts + float(click_delay[i]), "price": ad["bid"]})
            serves.append({"type": "serve", "event_id": f"s-{rid}", "request_id": rid, "ts": float(serve_ts[r]),
                           "consent": consent, "context": context, "interests": interests,
                           "model_version": None, "placements": placements})
        # at-least-once: una fracción de eventos llega dos veces (mismo event_id)
        for lst in (imps, clicks):
            lst += [dict(e) for e in lst if rng.random() < dup_share]
        return serves, imps, clicks

    # -------------------------------------------------------------------------- tablas para el serving
    def budgets(self) -> dict[str, dict]:
        """campaign_id → {spent_usd, daily_budget_usd, serve_rate} (≈ 5 % ya agotadas)."""
        return {c: dict(b) for c, b in self._budgets.items()}

    def ctr_table(self, seed: int = 0) -> dict[tuple[str, str], tuple[float, float]]:
        """(ad_id, slot) → (clicks, impresiones visibles) de "7 días": la tabla del fallback."""
        rng = np.random.default_rng(seed)
        out = {}
        for a, ad in enumerate(self.ads):
            for s, slot in enumerate(F.SLOTS):
                imps = int(rng.poisson(min(ad["lifetime_impressions"], 30_000) / 10 + 1))
                out[(ad["ad_id"], slot)] = (float(rng.binomial(imps, self.mean_ctr(a, s, n=200, seed=a))), float(imps))
        return out

    def slot_priors(self) -> dict[str, float]:
        """CTR promedio por slot (el prior del fallback)."""
        sample = range(0, len(self.ads), max(1, len(self.ads) // 50))
        return {slot: float(np.mean([self.mean_ctr(a, s, n=400, seed=a) for a in sample]))
                for s, slot in enumerate(F.SLOTS)}


def _diurnal() -> np.ndarray:
    """Distribución de la hora del día: pico en la mañana (07–09), como el tráfico del caso."""
    w = np.array([1, 0.6, 0.4, 0.3, 0.3, 0.6, 1.5, 3.0, 3.2, 2.6, 2.0, 1.8,
                  1.8, 1.7, 1.6, 1.6, 1.6, 1.7, 1.9, 2.1, 2.2, 2.0, 1.6, 1.2])
    return w / w.sum()


def training_rows(world: World, *, n_pageviews: int, neg_rate: float, seed: int = 0,
                  uniform_rate: float = 1.0) -> list[dict]:
    """Un día sintético → eventos → build_training_set (el pipeline real) → filas."""
    serves, imps, clicks = world.make_events(n_pageviews, seed=seed, start_ts=T0 + seed * 86_400)
    as_of = T0 + (seed + 1) * 86_400 + 4 * 3600  # el día ya cerró y pasó la gracia
    rows, _ = build(serves, imps, clicks, as_of=as_of,
                    cfg=LabelConfig(neg_rate=neg_rate, uniform_rate=uniform_rate))
    return rows
