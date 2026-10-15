"""Tests de features.py: hash estable, buckets reservados, normalización, intereses sensibles y paridad."""

import os
import random
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

import features as F

SERVING = Path(__file__).resolve().parents[1]
CTX = {"section": "deportes", "device": "mobile", "geo": "MX-NLE", "hour": 8, "dow": 1}
AD = {"ad_id": "a123", "campaign_id": "c45", "advertiser_id": "v9", "ad_category": "autos", "ad_format": "native"}


def _in_fresh_process(code: str, seed: str) -> str:
    env = {**os.environ, "PYTHONHASHSEED": seed, "PYTHONPATH": str(SERVING)}
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True)
    return out.stdout.strip()


def test_bucket_is_stable_across_processes_and_python_hash_is_not():
    # La trampa: hash() de Python cambia con la semilla del proceso; blake2b no. Training y serving son
    # procesos distintos (y máquinas distintas): con hash(), la misma feature caería en otro bucket.
    code = "import features as F; print(F.bucket('section=deportes'), hash('section=deportes'))"
    a = _in_fresh_process(code, "1").split()
    b = _in_fresh_process(code, "2").split()
    assert a[0] == b[0] == str(F.bucket("section=deportes"))  # el nuestro: igual en todos lados
    assert a[1] != b[1]  # hash(): otro valor en cada proceso


def test_buckets_stay_out_of_the_reserved_zone():
    rng = random.Random(0)
    feats = [f"ad_id=a{rng.randrange(10**9)}" for _ in range(20_000)]
    idx = np.array([F.bucket(s) for s in feats])
    assert idx.min() >= F.RESERVED and idx.max() < F.N_BUCKETS


def test_position_indices_are_reserved_and_distinct():
    seen = set()
    for slot in F.SLOTS:
        for fmt in F.FORMATS:
            idx = F.position_indices(slot, fmt)
            assert len(idx) == 2 and np.all(idx < F.RESERVED)
            seen.add(tuple(idx))
    assert len(seen) == len(F.SLOTS) * len(F.FORMATS)  # 9 combinaciones, ninguna comparte índices de cruce
    assert len({F.position_indices(s, None)[0] for s in F.SLOTS}) == 3
    assert list(F.position_indices("top", "formato-raro")) == [0]  # formato desconocido: solo la posición
    with pytest.raises(ValueError):
        F.position_indices("sidebar", "native")  # un slot inventado es un bug, no un índice nuevo


def test_field_name_is_part_of_the_feature():
    # "deportes" como sección y como categoría son features distintas: el valor solo no alcanza
    assert F.bucket("section=deportes") != F.bucket("ad_category=deportes")


def test_unicode_normalization_and_case():
    nfd = unicodedata.normalize("NFD", "Política")  # la tilde como carácter combinado (otro CMS)
    nfc = unicodedata.normalize("NFC", "política")
    assert nfd != nfc and nfd.encode() != nfc.encode()  # bytes distintos…
    assert F.bucket("section=" + nfd) != F.bucket("section=" + nfc)  # …buckets distintos sin normalizar
    assert F.norm(nfd) == F.norm(nfc) == F.norm("  POLÍTICA ")  # con norm(), la misma feature


def test_separators_cannot_be_injected():
    v = F.norm("deportes|ad_category=autos")
    assert "|" not in v and "=" not in v
    raw = F.make_raw({**CTX, "section": "deportes|ad_category=autos"}, [], AD)
    assert "ad_category=autos" in F.feature_strings(raw)  # la feature real, una sola vez
    assert F.feature_strings(raw).count("ad_category=autos") == 1


def test_sensitive_sections_never_reach_the_profile():
    got = F.clean_interests(["politica", "Deportes", "salud", "autos", "deportes", "religion", "economia",
                             "tecnologia", "mundo", "espectaculos"])
    assert got == ("autos", "deportes", "economia", "mundo", "tecnologia")  # 5 primeras no sensibles, ordenadas
    raw = F.make_raw(CTX, ["politica", "salud", "autos"], AD)
    strings = F.feature_strings(raw)
    assert not any(s.startswith("interest=politica") or s.startswith("interest=salud") for s in strings)
    # el CONTEXTO sí puede ser "salud": es dónde aparece el anuncio, no quién es la persona
    assert "section=salud" in F.feature_strings(F.make_raw({**CTX, "section": "salud"}, [], AD))


def test_no_interests_is_one_explicit_feature():
    strings = F.feature_strings(F.make_raw(CTX, [], AD))
    assert [s for s in strings if s.startswith("interest=")] == [
        "interest=__none__", "interest=__none__|ad_category=autos"]


def test_docstring_example_is_exact():
    # El ejemplo del docstring de features.py, string por string (si alguien cambia un cruce, esto avisa)
    raw = F.make_raw(CTX, ["deportes", "autos"], AD)
    assert F.feature_strings(raw) == [
        "section=deportes", "device=mobile", "geo=mx-nle", "hour=8", "dow=1",
        "interest=autos", "interest=deportes",
        "ad_id=a123", "campaign_id=c45", "advertiser_id=v9", "ad_category=autos", "ad_format=native",
        "section=deportes|ad_category=autos",
        "interest=autos|ad_category=autos", "interest=deportes|ad_category=autos",
        "hour=8|section=deportes", "device=mobile|ad_format=native", "geo=mx-nle|advertiser_id=v9"]


def test_encode_candidates_is_the_same_definition():
    rng = random.Random(1)
    ads = [{"ad_id": f"a{i}", "campaign_id": f"c{i // 3}", "advertiser_id": f"v{i // 5}",
            "ad_category": rng.choice(["autos", "retail", "viajes"]), "ad_format": rng.choice(F.FORMATS)}
           for i in range(150)]
    interests = ["autos", "politica", "deportes"]
    fast = F.encode_candidates(CTX, interests, ads)
    slow = [F.base_indices(F.make_raw(CTX, interests, ad)) for ad in ads]
    assert all(np.array_equal(a, b) for a, b in zip(fast, slow, strict=True))


def test_training_row_is_base_plus_real_position():
    raw = F.make_raw(CTX, ["autos"], AD)
    row = F.row_indices(raw, "bottom")
    assert np.array_equal(row, np.concatenate([F.base_indices(raw), F.position_indices("bottom", "native")]))


def test_local_time_uses_the_publisher_timezone():
    ts = datetime(2026, 10, 15, 14, 0, tzinfo=timezone.utc).timestamp()
    assert F.local_time(ts, "America/Mexico_City") == (8, 3, "2026-10-15")  # jueves 8 a. m. en CDMX
    assert F.local_time(ts, "UTC") == (14, 3, "2026-10-15")  # el mismo instante en UTC: otra "hora"
    # Por eso el ad-api loguea la hora que usó y training NO la recalcula


def test_encoding_150_candidates_fits_the_budget():
    """Informativo: cuánto cuesta hashear 150 candidatos en ESTA máquina (caché caliente)."""
    ads = [{**AD, "ad_id": f"a{i}", "campaign_id": f"c{i // 4}", "advertiser_id": f"v{i // 6}"} for i in range(150)]
    F.encode_candidates(CTX, ["autos", "deportes"], ads)  # calienta el lru_cache
    times = []
    for _ in range(50):
        t = time.perf_counter()
        F.encode_candidates(CTX, ["autos", "deportes"], ads)
        times.append(time.perf_counter() - t)
    p50 = sorted(times)[25] * 1000
    print(f"\nencode_candidates(150): p50 {p50:.2f} ms")
    assert p50 < 20  # holgado: el presupuesto del scoring es 10 ms y esto es lo que hay que medir en el pod
