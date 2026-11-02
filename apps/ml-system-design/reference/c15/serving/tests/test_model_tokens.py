"""Tests de model.py (corrección de muestreo, scoring por slot exacto, artefacto) y tokens.py (firma)."""

import base64
import json
import math

import numpy as np
import pytest

import features as F
import model as M
import tokens as T

CTX = {"section": "economia", "device": "desktop", "geo": "MX-CMX", "hour": 13, "dow": 4}


def random_model(seed=0, neg_rate=0.05, **kw):
    """Pesos al azar (sin entrenar): para probar la MECÁNICA del scoring, no la calidad."""
    rng = np.random.default_rng(seed)
    w = np.zeros(F.N_BUCKETS, dtype=np.float32)
    w[: F.RESERVED] = rng.normal(0, 0.5, F.RESERVED)  # posiciones y posición × formato
    touched = rng.integers(F.RESERVED, F.N_BUCKETS, size=50_000)
    w[touched] = rng.normal(0, 0.3, touched.size)
    return M.HashedLogisticModel(weights=w, bias=-2.0, neg_rate=neg_rate, version="test", **kw)


def ads(n=40, seed=1):
    rng = np.random.default_rng(seed)
    return [{"ad_id": f"a{i}", "campaign_id": f"c{i // 4}", "advertiser_id": f"v{i // 6}",
             "ad_category": str(rng.choice(["autos", "retail", "viajes"])), "ad_format": str(rng.choice(F.FORMATS))}
            for i in range(n)]


# ---------------------------------------------------------------------------- corrección de muestreo
def test_correction_numbers_from_the_docstring():
    # CTR real 0.35 %, w = 5 % → en el set submuestreado el CTR es ≈ 6.56 %; la corrección lo devuelve
    p_ds = 0.0035 / (0.0035 + 0.9965 * 0.05)
    assert p_ds == pytest.approx(0.065635, abs=1e-6)
    assert float(M.correct_downsampling(p_ds, 0.05)) == pytest.approx(0.0035, rel=1e-9)
    assert float(M.correct_downsampling(0.3, 1.0)) == pytest.approx(0.3)  # w = 1: sin submuestreo, sin cambio


def test_correction_is_a_logit_shift_of_ln_w():
    p = np.array([0.01, 0.06, 0.3, 0.9])
    q = M.correct_downsampling(p, 0.05)
    logit = lambda x: np.log(x / (1 - x))  # noqa: E731
    assert np.allclose(logit(q), logit(p) + math.log(0.05))  # ln 0.05 ≈ −3.0


def test_correcting_twice_is_the_trap():
    # Un modelo entrenado con peso 1/w ya predice en escala real (0.35 %); corregirlo OTRA vez lo multiplica por ≈ w
    corrected_again = float(M.correct_downsampling(0.0035, 0.05))
    assert corrected_again == pytest.approx(0.0035 * 0.05, rel=0.01)  # ≈ 0.0175 %: 20 veces menos


def test_correction_rejects_invalid_rates():
    with pytest.raises(ValueError):
        M.correct_downsampling(0.1, 0.0)


# ---------------------------------------------------------------------------- scoring por slot
def test_predict_slots_equals_scoring_the_row_of_each_slot():
    """Un scoring por candidato + el término de posición = EXACTAMENTE la fila con ese slot."""
    m = random_model()
    cands = ads()
    rows = F.encode_candidates(CTX, ["autos"], cands)
    by_slot = m.predict_slots(rows, [a["ad_format"] for a in cands], F.SLOTS)
    assert by_slot.shape == (len(cands), 3)
    for j, slot in enumerate(F.SLOTS):
        full = [F.row_indices(F.make_raw(CTX, ["autos"], a), slot) for a in cands]
        assert np.allclose(by_slot[:, j], m.predict_rows(full), rtol=1e-12, atol=0)


def test_position_term_depends_on_format():
    m = random_model()
    assert m.position_term("bottom", "video") != m.position_term("bottom", "native")
    assert m.position_term("top", None) == pytest.approx(float(m.weights[0]))  # sin formato: solo "pos=top"


def test_rows_must_not_be_empty():
    with pytest.raises(ValueError):
        random_model().predict_rows([np.array([], dtype=np.int64)])


def test_calibration_map_is_applied_after_the_correction():
    x = np.array([0.0, 0.01, 0.02, 1.0])
    y = np.array([0.0, 0.005, 0.03, 1.0])
    m = random_model(calib_x=x, calib_y=y)
    m_raw = random_model()
    rows = F.encode_candidates(CTX, [], ads(5))
    full = [np.concatenate([r, F.position_indices("top", None)]) for r in rows]
    assert np.allclose(m.predict_rows(full), np.interp(m_raw.predict_rows(full), x, y))


def test_bad_calibration_is_rejected_at_load_time():
    with pytest.raises(ValueError):
        random_model(calib_x=np.array([0.0, 0.5, 0.4]), calib_y=np.array([0.0, 0.1, 0.2]))


# ---------------------------------------------------------------------------- artefacto
def test_artifact_roundtrip_with_sha256(tmp_path):
    m = random_model(calib_x=np.array([0.0, 1.0]), calib_y=np.array([0.0, 0.9]))
    path = tmp_path / "ctr.npz"
    sha = m.save(path)
    loaded = M.HashedLogisticModel.load(path, sha)
    assert loaded.version == "test" and loaded.neg_rate == 0.05 and loaded.bias == -2.0
    assert np.array_equal(loaded.weights, m.weights) and np.array_equal(loaded.calib_y, m.calib_y)
    with np.load(path, allow_pickle=False) as z:  # se lee sin pickle: no ejecuta código
        assert set(z.files) == {"weights", "bias", "neg_rate", "version", "feature_set_version", "calib_x", "calib_y"}
    print(f"\nartefacto: {path.stat().st_size / 1e6:.1f} MB comprimido (64 MiB de float32 en memoria)")
    with pytest.raises(ValueError, match="sha256"):
        M.HashedLogisticModel.load(path, "0" * 64)


def test_model_from_another_feature_schema_does_not_load():
    with pytest.raises(ValueError, match="features"):
        random_model(feature_set_version="ctr-hash-v0")


# ---------------------------------------------------------------------------- tokens
KEYS = {"k2026b": b"llave-nueva-32-bytes-de-ejemplo!", "k2026a": b"llave-vieja-32-bytes-de-ejemplo!"}
DATA = {"rid": "r" * 32, "ad": "a0123", "c": "c045", "slot": "in_article", "px": 0.41, "p": 0.006123,
        "src": "model", "ts": 1_791_000_000.0}


def _forge(token, **changes):
    """Cambia campos del payload y conserva la firma original (lo que haría alguien que edita la URL)."""
    payload_b64, sig = token.split(".")
    payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
    payload.update(changes)
    new_b64 = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).rstrip(b"=").decode()
    return new_b64 + "." + sig


def test_sign_and_verify_roundtrip():
    tok = T.sign(DATA, KEYS["k2026b"], "k2026b")
    got = T.verify(tok, KEYS, now=DATA["ts"] + 5, max_age_s=600)
    assert {k: got[k] for k in T.FIELDS} == DATA and got["kid"] == "k2026b"
    assert T.imp_id(got) == "r" * 32 + ":in_article"
    print(f"\ntoken: {len(tok)} caracteres")
    assert len(tok) < 400  # cabe en una URL sin problemas


def test_edited_price_is_rejected():
    tok = T.sign(DATA, KEYS["k2026b"], "k2026b")
    with pytest.raises(T.TokenError) as e:
        T.verify(_forge(tok, px=0.01), KEYS, now=DATA["ts"], max_age_s=600)
    assert e.value.reason == "bad_signature"


def test_key_rotation():
    old = T.sign(DATA, KEYS["k2026a"], "k2026a")
    assert T.verify(old, KEYS, now=DATA["ts"], max_age_s=600)["kid"] == "k2026a"  # las dos llaves activas
    with pytest.raises(T.TokenError) as e:
        T.verify(old, {"k2026b": KEYS["k2026b"]}, now=DATA["ts"], max_age_s=600)  # la vieja ya se retiró
    assert e.value.reason == "unknown_key"


@pytest.mark.parametrize("now,reason", [(DATA["ts"] + 601, "expired"), (DATA["ts"] - 120, "future")])
def test_age_limits(now, reason):
    tok = T.sign(DATA, KEYS["k2026b"], "k2026b")
    with pytest.raises(T.TokenError) as e:
        T.verify(tok, KEYS, now=now, max_age_s=600)
    assert e.value.reason == reason


@pytest.mark.parametrize("bad", ["", "abc", "a.b.c", "!!!.???", "eyJ2IjoxfQ.AAAA"])
def test_malformed_tokens(bad):
    with pytest.raises(T.TokenError) as e:
        T.verify(bad, KEYS, now=DATA["ts"], max_age_s=600)
    assert e.value.reason in {"malformed", "unknown_key"}


def test_missing_fields_cannot_be_signed():
    with pytest.raises(ValueError):
        T.sign({k: v for k, v in DATA.items() if k != "px"}, KEYS["k2026b"], "k2026b")


def test_peek_reads_without_trusting():
    forged = _forge(T.sign(DATA, KEYS["k2026b"], "k2026b"), ad="a9999")
    assert T.peek_unverified(forged)["ad"] == "a9999"  # se puede leer…
    with pytest.raises(T.TokenError):
        T.verify(forged, KEYS, now=DATA["ts"], max_age_s=600)  # …pero no vale para contar ni cobrar
    assert T.peek_unverified("basura") is None
