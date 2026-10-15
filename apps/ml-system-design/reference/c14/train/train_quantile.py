"""Entrenamiento del modelo global por cuantiles (caso c14): P50 y P90 con pérdida pinball.

Por qué cuantiles y no "el promedio": el ERP pide con orden = máx(0, pronóstico de (lead time + periodo de
revisión) + inventario de seguridad − existencia − en tránsito), y el inventario de seguridad sale del P90.
Un modelo de error cuadrático da la media: con demanda sesgada a la derecha (promos, quincenas) la media
queda arriba de la mediana y el P90 hay que inventarlo con un supuesto de distribución. Dos modelos con
pérdida pinball (α = 0.5 y α = 0.9) estiman cada cuantil directo, y `backtest.py` mide si el P90 cubre
≈ 90 % de los días.

En la entrevista dices LightGBM (objective="quantile" con alpha=0.5 y alpha=0.9; ojo: el default de alpha
es 0.9); aquí es HistGradientBoostingRegressor(loss="quantile", quantile=…) de scikit-learn (opción
disponible desde la 1.1): el mismo tipo de algoritmo (árboles sobre histogramas), sin dependencias
nativas extra. Un límite que sí cambia el diseño: HistGradientBoosting admite como máximo `max_bins`
(≤ 255) categorías por feature, y en cualquier GBDT una categórica con miles de niveles (sku_id) es mala
idea. Por eso el modelo NO recibe store_id ni sku_id: recibe atributos (formato, región, categoría) y la
historia de la propia serie, que es lo que generaliza a series nuevas.

Cuatro trampas que este archivo cierra:
0. Conteos con muchos ceros: el modelo del P50 se queda en 0 PARA TODAS LAS FILAS. Medido aquí con
   scikit-learn 1.9.1: con 62 % de días en 0, el boosting arranca en la mediana global (0); en las filas con
   y = 0 = predicción, el gradiente de la pinball es el mismo que en las filas con venta, ningún split gana,
   cada árbol sale plano y el modelo nunca se mueve (un test lo reproduce con una feature continua).
   Arreglo: "jittering" de conteos (Machado y Santos Silva, "Quantiles for Counts", JASA 2005): entrenar
   con z = y + u, u ~ Uniforme[0, 1), que es continua y sin empates. Como z ∈ [y, y + 1), el cuantil del
   conteo se recupera exacto: Q_y = ⌈Q_z − 1⌉. Ej.: Q_z(0.5) = 3.4 → P50 = 3 piezas; 0.7 → 0 piezas.
   Los pronósticos quedan en piezas enteras, que es lo que vende una tienda.
1. Cruce de cuantiles: dos modelos independientes pueden dar P90 < P50 en alguna fila. Se ordenan los
   dos valores por fila ("rearrangement", Chernozhukov, Fernández-Val y Galichon, Econometrica 2010) y se
   recortan en 0. Se cuenta cuántas filas cruzaron: si son muchas, algo está mal en los datos.
2. Categóricas con códigos distintos en training y serving: si conviertes TÚ las categorías a números
   (`.cat.codes`, un LabelEncoder ajustado en el job de inferencia), pandas numera según los valores que
   VE; la noche en que no aparece "express", "hiper" cambia de código y el modelo lee otra cosa sin error
   (skew silencioso: un test lo reproduce). scikit-learn con categorical_features="from_dtype" guarda su
   propio codificador y mapea por VALOR (el mismo test lo comprueba con la 1.9.1), pero el vocabulario
   se fija al entrenar y viaja con el modelo igual: es el contrato del job (una región nueva queda como
   faltante, NaN, en vez de recibir el código de otra) y no depende de un detalle interno de la librería.
3. Early stopping con un holdout aleatorio: con early_stopping="auto" y más de 10,000 filas, sklearn
   separa un 10 % AL AZAR para validar, y con datos temporales eso valida contra días que están en medio
   del entrenamiento. Aquí se apaga (`early_stopping=False`) y el número de árboles se elige con el
   backtest por origen móvil (backtest.py). Desde scikit-learn 1.7, `fit` también acepta X_val/y_val:
   si quieres early stopping, pásale las últimas semanas (un corte temporal), nunca un azar.
"""

from __future__ import annotations  # anotaciones como texto

import hashlib  # versión del modelo = hash del contenido
import json  # metadatos legibles junto al modelo
from dataclasses import dataclass, field  # el artefacto del modelo
from pathlib import Path  # rutas del artefacto

import joblib  # serialización de los estimadores de sklearn
import numpy as np  # cruce de cuantiles y naive
import pandas as pd  # filas de features
import sklearn  # la versión viaja en los metadatos
from sklearn.ensemble import HistGradientBoostingRegressor  # el GBDT con pérdida quantile

from build_features import CATEGORICAL, FEATURE_COLUMNS, KEYS  # LA lista de features (una sola definición)

QUANTILES = (0.5, 0.9)  # P50 para la orden base, P90 para el inventario de seguridad
JITTER_SEED = 0  # el u del jittering es fijo: mismos datos → mismo z → mismo modelo (trampa 0)
# Hiperparámetros ILUSTRATIVOS para el tamaño de los datos sintéticos; los reales salen del backtest.
DEFAULT_PARAMS = {
    "learning_rate": 0.05,
    "max_iter": 250,  # número de árboles fijo: sin early stopping aleatorio (trampa 3)
    "max_leaf_nodes": 31,
    "min_samples_leaf": 40,  # hojas con pocas filas sobreajustan las series intermitentes
    "l2_regularization": 1.0,
    "early_stopping": False,
    "random_state": 0,  # reproducible: misma data + mismo seed → mismo modelo → mismo hash
}


@dataclass
class QuantileForecaster:
    """El artefacto que se registra: los dos modelos + todo lo necesario para usarlos igual que al entrenar."""

    models: dict[float, HistGradientBoostingRegressor]
    vocab: dict[str, list[str]]  # categorías vistas al entrenar, en orden fijo (trampa 2)
    features: list[str] = field(default_factory=lambda: list(FEATURE_COLUMNS))
    meta: dict = field(default_factory=dict)  # versión, ventana de entrenamiento, sklearn, filas…

    @property
    def version(self) -> str:
        return self.meta.get("model_version", "unversioned")

    def matrix(self, rows: pd.DataFrame) -> pd.DataFrame:
        """Filas → matriz del modelo, con las categóricas codificadas con el vocabulario FIJO."""
        return to_matrix(rows, self.vocab, self.features)

    def predict(self, rows: pd.DataFrame) -> pd.DataFrame:
        """p50 y p90 por fila (piezas enteras), sin cruces y ≥ 0. También si la fila cruzó (para la métrica)."""
        x = self.matrix(rows)
        raw = {q: from_jittered(m.predict(x)) for q, m in self.models.items()}  # Q_z → Q_y (trampa 0)
        p50, p90, crossed = fix_crossing(raw[0.5], raw[0.9])
        return pd.DataFrame({"p50": p50, "p90": p90, "crossed": crossed}, index=rows.index)


def to_matrix(rows: pd.DataFrame, vocab: dict[str, list[str]], features: list[str]) -> pd.DataFrame:
    """Selecciona las features en orden y fija los códigos de las categóricas.

    Un valor que no estaba en el vocabulario (una región nueva) queda como NaN = faltante, que el
    modelo sabe manejar, en vez de recibir el código de otra categoría.
    """
    x = rows[features].copy()
    for col in CATEGORICAL:
        known = x[col].where(x[col].isin(vocab[col]))  # lo desconocido → NaN, explícito (pandas 3 avisa si no)
        x[col] = pd.Categorical(known, categories=vocab[col])  # orden y códigos de entrenamiento
    num = [c for c in features if c not in CATEGORICAL]
    x[num] = x[num].astype(float)
    return x


def build_vocab(rows: pd.DataFrame) -> dict[str, list[str]]:
    """Vocabulario de cada categórica, ordenado: determinista, no depende del orden de las filas."""
    return {col: sorted(rows[col].dropna().astype(str).unique().tolist()) for col in CATEGORICAL}


def jitter(y: np.ndarray, seed: int = JITTER_SEED) -> np.ndarray:
    """z = y + u, u ~ Uniforme[0, 1): conteos → variable continua sin empates (trampa 0)."""
    return np.asarray(y, float) + np.random.default_rng(seed).random(len(y))


def from_jittered(q_z: np.ndarray) -> np.ndarray:
    """Cuantil de z → cuantil del conteo: ⌈Q_z − 1⌉, y nunca negativo."""
    return np.maximum(np.ceil(np.asarray(q_z, float) - 1.0), 0.0)


def fix_crossing(p50: np.ndarray, p90: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Rearrangement: por fila, el menor es el P50 y el mayor el P90; después, recorte en 0."""
    lo, hi = np.minimum(p50, p90), np.maximum(p50, p90)
    crossed = p90 < p50
    return np.clip(lo, 0, None), np.clip(hi, 0, None), crossed


def fit(train_rows: pd.DataFrame, params: dict | None = None, quantiles=QUANTILES,
        sample_weight: np.ndarray | None = None) -> QuantileForecaster:
    """Entrena un modelo por cuantil sobre las filas con target (los días agotados ya vienen en NaN)."""
    rows = train_rows[train_rows["target"].notna()]  # regla 2 de build_features: sin días censurados
    if rows.empty:
        raise ValueError("no hay filas con target: ¿el rango de orígenes deja targets en el futuro?")
    vocab = build_vocab(rows)
    x = to_matrix(rows, vocab, list(FEATURE_COLUMNS))
    z = jitter(rows["target"].to_numpy(dtype=float))  # trampa 0: se entrena con y + u
    p = {**DEFAULT_PARAMS, **(params or {})}
    models = {}
    for q in quantiles:
        m = HistGradientBoostingRegressor(loss="quantile", quantile=q, categorical_features="from_dtype", **p)
        m.fit(x, z, sample_weight=sample_weight)
        models[q] = m
    seen = pd.util.hash_pandas_object(rows[["run_date", *KEYS, "horizon", "target"]], index=False)
    data_hash = hashlib.sha256(seen.to_numpy().tobytes()).hexdigest()[:16]
    meta = {
        "quantiles": list(quantiles),
        "params": p,
        "data_hash": data_hash,  # qué filas vio: dos entrenamientos con los mismos datos y params = misma versión
        "target_transform": f"jitter_u01_seed{JITTER_SEED}",  # predict deshace con ⌈Q_z − 1⌉
        "n_rows": int(len(rows)),
        "train_from": str(rows["run_date"].min().date()),
        "train_to": str(rows["target_date"].max().date()),  # el último día que el modelo "conoce"
        "sklearn_version": sklearn.__version__,  # un pickle de sklearn no es portable entre versiones
    }
    fc = QuantileForecaster(models=models, vocab=vocab, meta=meta)
    fc.meta["model_version"] = "gbdt-q-" + _fingerprint(fc)
    return fc


def _fingerprint(fc: QuantileForecaster) -> str:
    """12 hex del hash de los parámetros + vocabulario + ventana: el mismo entrenamiento → la misma versión."""
    payload = json.dumps({k: v for k, v in fc.meta.items() if k != "model_version"}, sort_keys=True, default=str)
    payload += json.dumps(fc.vocab, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


def seasonal_naive(rows: pd.DataFrame) -> pd.DataFrame:
    """La línea base del caso (mismo día de la semana pasada) y el día 14 del fallback.

    p50 = sw_lag_1; si ese día estuvo agotado (NaN), el promedio de los 4 mismos días, luego el de 28
    días, luego 0. p90 = el máximo de los 4 mismos días: una cobertura BURDA a propósito (el backtest
    muestra que no cubre 90 %); para un fallback de un día alcanza.
    """
    lags = rows[["sw_lag_1", "sw_lag_2", "sw_lag_3", "sw_lag_4"]].to_numpy(dtype=float)
    p50 = rows["sw_lag_1"].fillna(rows["sw_mean_4"]).fillna(rows["roll_mean_28"]).fillna(0.0).to_numpy()
    none = np.isnan(lags).all(axis=1)  # los 4 días agotados o sin historia
    mx = np.nanmax(np.where(none[:, None], 0.0, lags), axis=1)  # sin filas todo-NaN: sin avisos
    p90 = np.where(none, p50, np.maximum(mx, p50))
    return pd.DataFrame({"p50": p50, "p90": p90}, index=rows.index)


def save(fc: QuantileForecaster, path: str | Path) -> Path:
    """Guarda el artefacto (joblib) y sus metadatos (JSON legible) en una carpeta por versión."""
    out = Path(path) / fc.version
    out.mkdir(parents=True, exist_ok=True)
    joblib.dump({"models": fc.models, "vocab": fc.vocab, "features": fc.features}, out / "model.joblib")
    (out / "meta.json").write_text(json.dumps(fc.meta, indent=2, sort_keys=True, default=str))
    return out


def load(path: str | Path) -> QuantileForecaster:
    """Carga un artefacto y se niega si la versión de sklearn no es la misma con la que se entrenó."""
    path = Path(path)
    meta = json.loads((path / "meta.json").read_text())
    if meta["sklearn_version"] != sklearn.__version__:
        raise RuntimeError(
            f"modelo entrenado con scikit-learn {meta['sklearn_version']}, este proceso tiene "
            f"{sklearn.__version__}: usa la misma imagen (lock) para entrenar y para el job nocturno"
        )
    blob = joblib.load(path / "model.joblib")
    return QuantileForecaster(models=blob["models"], vocab=blob["vocab"], features=blob["features"], meta=meta)


def main() -> None:  # pragma: no cover - demo de consola
    """Demo: datos sintéticos → entrenamiento → backtest de 4 orígenes contra el seasonal naive."""
    from pathlib import Path as _P

    import calendar_mx
    from backtest import run_backtest, metrics_by_segment
    from synthetic import make_synthetic

    cfg = calendar_mx.load_events(_P(__file__).resolve().parents[1] / "features" / "retail_events.yaml")
    data = make_synthetic(events_cfg=cfg)
    res = run_backtest(data, n_origins=4)
    print(metrics_by_segment(res, pred="model").round(3).to_string(index=False))
    print(metrics_by_segment(res, pred="naive").round(3).to_string(index=False))


if __name__ == "__main__":  # pragma: no cover
    main()
