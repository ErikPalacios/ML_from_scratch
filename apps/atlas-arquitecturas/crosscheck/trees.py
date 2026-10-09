"""Cross-check de la fase 13 (GBDT): modelos REALES de xgboost / lightgbm / catboost (SPEC §25.3). Solo desarrollo.

Corre en un proceso APARTE de torch (no lo importa): xgboost y lightgbm traen su propio enlace a libomp. En macOS sin libomp de
Homebrew, tools/crosscheck-compare.mjs pasa DYLD_FALLBACK_LIBRARY_PATH = .venv/…/torch/lib (el libomp.dylib que ya trae torch).

Carga de referencia a ESCALA REDUCIDA (el calculador corre con calc_overrides {N: 50000}): X ~ N(0, 1) de 50,000 × 100 (float32),
y = X·w + ε (semilla 13), regresión con error cuadrático. Lo que se verifica:
- defaults de las librerías instaladas (max_bin, num_leaves, max_depth, border_count, …) contra los de cada config;
- estructura de un árbol LLENO medida en el modelo real (el árbol 0, con toda la señal: 2^(d+1) − 1 nodos; 2L − 1; d cortes + 2^d
  hojas en CatBoost) → params_total = K × (umbrales + hojas del árbol lleno) + la base (1 número en XGBoost y CatBoost; 0 en
  LightGBM: boost_from_average la suma a las hojas del árbol 1, comprobado: Σ hojas = predict);
- lo REAL de todo el modelo (nodos y hojas: XGBoost poda; LightGBM llega siempre a 31 hojas; CatBoost siempre 64) ↔ los measured*
  del calculador (exactos) y ↔ la cota llena (rango);
- formas: X, y, g, h (objetivo propio de 1 ronda), bins por feature del histograma, hojas por muestra (pred_leaf), predicción;
- bytes del modelo guardado (.ubj, .txt, .cbm) ↔ primitives.tree_bytes con los nodos medidos (rango ±1–3 %);
- camino promedio de LightGBM (leaf-wise) en 2,000 filas ↔ el measured del calculador (exacto) y ≥ la cota K·⌈log₂ L⌉.
FLOPs: 0 en los dos lados (los árboles comparan y suman; no hay matmuls): el JSON lo dice.
"""
import json
import os
import sys
import tempfile
import time

import numpy as np
import xgboost as xgb
import lightgbm as lgb
import catboost as cb

HERE = os.path.dirname(os.path.abspath(__file__))
EXPECTED = os.path.join(HERE, "expected")
N, F, SEED = 50000, 100, 13
THREADS = 8


def write_expected(cid, data):
    os.makedirs(EXPECTED, exist_ok=True)
    path = os.path.join(EXPECTED, f"{cid}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"  escrito crosscheck/expected/{cid}.json", file=sys.stderr)


def data():
    rng = np.random.default_rng(SEED)
    X = rng.standard_normal((N, F)).astype(np.float32)
    w = rng.standard_normal(F).astype(np.float32)
    y = (X @ w + rng.standard_normal(N).astype(np.float32))
    return X, y


def file_size(save, ext):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "m." + ext)
        save(p)
        return os.path.getsize(p)


def versions():
    return {"python": sys.version.split()[0], "xgboost": xgb.__version__, "lightgbm": lgb.__version__, "catboost": cb.__version__, "numpy": np.__version__}


def base_doc(cid, K, extra_shapes):
    return {"config_id": cid, "model": "gbdt", "calc_overrides": {"N": N}, "flops_total": 0, "shapes": extra_shapes}


def common_shapes(nrow, ncol, histbins, tree_nodes, K):
    return {"X": [nrow, ncol], "Xb": [nrow, ncol], "y": [nrow], "F-prev": [nrow], "g": [nrow], "h": [nrow], "hist": [ncol, histbins, 2],
            "tree": [tree_nodes], "F-new": [nrow], "x": [ncol], "leaf-ids": [K], "y-hat": [1]}


def sq_obj_shapes(X, y):
    """Una ronda con un objetivo propio de error cuadrático: forma de g y h que la librería recibe."""
    got = {}

    def obj(pred, dtrain):
        lab = dtrain.get_label()
        g, h = pred - lab, np.ones_like(lab)
        got["g"], got["h"] = list(g.shape), list(h.shape)
        return g, h
    xgb.train({"max_depth": 2, "nthread": THREADS}, xgb.DMatrix(X, label=y), 1, obj=obj)
    return got


# ------------------------------------------------------------------ XGBoost
def xgb_default(key):
    """Valor por defecto de un parámetro de árbol: una ronda SIN pasarlo y leerlo de save_config."""
    X, y = data()
    b = xgb.train({"nthread": THREADS}, xgb.DMatrix(X[:1000], label=y[:1000]), 1)
    v = json.loads(b.save_config())["learner"]["gradient_booster"]["tree_train_param"][key]
    return float(v) if "." in v else int(v)


def xgb_expected(cid, K, d):
    X, y = data()
    t0 = time.time()
    dm = xgb.DMatrix(X, label=y)
    b = xgb.train({"max_depth": d, "eta": 0.1, "nthread": THREADS, "seed": 0}, dm, K)
    cfg = json.loads(b.save_config())
    tp = cfg["learner"]["gradient_booster"]["tree_train_param"]
    df = b.trees_to_dataframe()
    nodes, leaves = len(df), int((df.Feature == "Leaf").sum())
    t0nodes = int((df.Tree == 0).sum())
    full = 2 ** (d + 1) - 1
    assert t0nodes == full, (t0nodes, full)
    bs = cfg["learner"]["learner_model_param"]["base_score"]
    base = len(json.loads(bs)) if bs.startswith("[") else 1      # base_score: un número por objetivo (aquí 1)
    # bins por feature del histograma (cortes del sketch: max_bin + 1, el último es máx + ε)
    q = xgb.QuantileDMatrix(X, max_bin=int(tp["max_bin"]))
    ptr, _ = q.get_quantile_cut()
    histbins = int(np.diff(ptr).max())
    leaf = b.predict(xgb.DMatrix(X[:1]), pred_leaf=True)
    margin = b.predict(dm, output_margin=True)
    # profundidad máxima de un camino en todo el modelo (dump JSON): d si algún árbol está lleno
    def mdepth(node):
        return 0 if "leaf" in node else 1 + max(mdepth(ch) for ch in node["children"])
    maxdepth = max(mdepth(json.loads(t)) for t in b.get_dump(dump_format="json"))
    ubj, js = file_size(b.save_model, "ubj"), file_size(b.save_model, "json")
    gh = sq_obj_shapes(X, y)
    shapes = common_shapes(dm.num_row(), dm.num_col(), histbins, t0nodes, leaf.shape[1])
    shapes["F-prev"] = list(margin.shape)
    shapes["F-new"] = list(margin.shape)
    shapes["g"], shapes["h"] = gh["g"], gh["h"]
    doc = base_doc(cid, K, shapes)
    doc.update({
        "params_total": K * full + base,
        "params_by_node": {"tree": K * full, "predict": base},
        "params_real_total": nodes + base,
        "defaults": {"max_bin": int(tp["max_bin"]), "max_depth_default": xgb_default("max_depth"), "eta_default": xgb_default("eta"), "lambda": float(tp["lambda"]), "gamma": float(tp["gamma"]),
                     "min_child_weight": float(tp["min_child_weight"]), "grow_policy": tp["grow_policy"],
                     "updater": cfg["learner"]["gradient_booster"]["gbtree_train_param"]["updater"], "tree_method": cfg["learner"]["gradient_booster"]["gbtree_train_param"]["tree_method"]},
        "metrics_checks": {"measuredNodes": nodes, "measuredLeaves": leaves, "nodesPerTree": t0nodes, "leavesPerTree": 2 ** d, "nTrees": K,
                           "comparisonsPerPrediction": K * maxdepth},
        "range_checks": [
            {"what": "nodos reales / cota llena", "metric": "nodes", "calc_overrides": {}, "ref": nodes, "min_ratio": 0.5, "max_ratio": 1.0},
            {"what": "bytes .ubj (save_model) / tree_bytes con los nodos medidos", "metric": "modelBytesMeasured", "calc_overrides": {}, "ref": ubj, "min_ratio": 0.99, "max_ratio": 1.01},
        ],
        "measured": {"ubj_bytes": ubj, "json_bytes": js, "json_bytes_per_node": js / nodes, "train_seconds": round(time.time() - t0, 1)},
        "notes": [
            f"Modelo real de xgboost {xgb.__version__} (hist) con N = {N:,} × F = {F} sintéticos (y = Xw + ε, semilla {SEED}); el calculador corre con N = {N:,} (calc_overrides).",
            f"params_total = K × {full} (árbol lleno de profundidad {d}: medido en el árbol 0) + {base} (base_score). El modelo real tiene {nodes:,} nodos ({nodes / (K * full):.1%} de la cota): XGBoost no divide nodos sin ganancia ni con < 2·min_child_weight de hessiana (hojas con 1 fila).",
            f"Histograma: {histbins} cortes por feature con max_bin = {tp['max_bin']} (get_quantile_cut; el último es máx + ε).",
            "FLOPs = 0: un árbol compara y suma (0 MACs); el costo está en metrics (comparaciones, sumas de histograma).",
        ],
        "source": dict(lib="xgboost", ctor=f"xgb.train({{'max_depth': {d}, 'eta': 0.1, 'nthread': {THREADS}, 'seed': 0}}, DMatrix(X, y), {K})", **versions()),
    })
    write_expected(cid, doc)


# ------------------------------------------------------------------ LightGBM
def leaf_depths(node, dep, out):
    if "leaf_index" in node:
        out[node["leaf_index"]] = dep
        return
    leaf_depths(node["left_child"], dep + 1, out)
    leaf_depths(node["right_child"], dep + 1, out)


def lgb_expected(cid, K):
    X, y = data()
    t0 = time.time()
    ds = lgb.Dataset(X, y)
    b = lgb.train({"objective": "regression", "verbose": -1, "num_threads": THREADS, "deterministic": True, "force_row_wise": True, "seed": 0}, ds, K)
    s = b.model_to_string()
    par = s[s.index("parameters:"):]

    def p(k):
        i = par.index("[" + k + ": ")
        return par[i + len(k) + 3: par.index("]", i)]
    dm = b.dump_model()
    nl = [tr["num_leaves"] for tr in dm["tree_info"]]
    L = int(p("num_leaves"))
    assert set(nl) == {L}, set(nl)
    nodes, leaves = sum(2 * n - 1 for n in nl), sum(nl)
    leaf = b.predict(X[:2000], pred_leaf=True)
    tot = 0.0
    for ti, tr in enumerate(dm["tree_info"]):
        dd = {}
        leaf_depths(tr["tree_structure"], 0, dd)
        tot += float(np.mean([dd[int(li)] for li in leaf[:, ti]]))
    avg = tot / K
    # base dentro del árbol 1: Σ valores de hoja = predicción
    lv = [[None] * n for n in nl]

    def collect(node, ti):
        if "leaf_index" in node:
            lv[ti][node["leaf_index"]] = node["leaf_value"]
            return
        collect(node["left_child"], ti)
        collect(node["right_child"], ti)
    for ti, tr in enumerate(dm["tree_info"]):
        collect(tr["tree_structure"], ti)
    l1 = b.predict(X[:5], pred_leaf=True)
    sums = [sum(lv[ti][int(l1[r, ti])] for ti in range(K)) for r in range(5)]
    pred = b.predict(X[:5])
    base_folded = bool(np.allclose(sums, pred, rtol=1e-9, atol=1e-9))
    dsc = lgb.Dataset(X, y, params={"verbose": -1})
    dsc.construct()
    histbins = max(dsc.feature_num_bin(i) for i in range(F))
    txt = len(s)
    gh = sq_obj_shapes(X, y)
    shapes = common_shapes(N, F, histbins, 2 * L - 1, leaf.shape[1])
    shapes["g"], shapes["h"] = gh["g"], gh["h"]
    shapes["F-prev"] = list(b.predict(X, raw_score=True).shape)
    shapes["F-new"] = shapes["F-prev"]
    doc = base_doc(cid, K, shapes)
    doc.update({
        "params_total": K * (2 * L - 1),
        "params_by_node": {"tree": K * (2 * L - 1), "predict": 0},
        "params_real_total": nodes,
        "defaults": {k: p(k) for k in ["num_leaves", "max_depth", "learning_rate", "max_bin", "min_data_in_leaf", "lambda_l2", "boost_from_average"]},
        "metrics_checks": {"measuredNodes": nodes, "measuredLeaves": leaves, "nodesPerTree": 2 * L - 1, "leavesPerTree": L, "numLeaves": L, "nTrees": K,
                           "comparisonsMeasured": int(round(K * avg)), "comparisonsMax": K * (L - 1)},
        "range_checks": [
            {"what": "camino promedio medido × K / cota balanceada K·⌈log₂ L⌉", "metric": "comparisonsPerPrediction", "calc_overrides": {}, "ref": int(round(K * avg)), "min_ratio": 1.0, "max_ratio": (L - 1) / np.ceil(np.log2(L))},
            {"what": "bytes del .txt (model_to_string) / tree_bytes", "metric": "modelBytesMeasured", "calc_overrides": {}, "ref": txt, "min_ratio": 0.97, "max_ratio": 1.03},
        ],
        "measured": {"avg_path_per_tree": avg, "text_bytes": txt, "base_folded_into_tree_1": base_folded, "train_seconds": round(time.time() - t0, 1)},
        "notes": [
            f"Modelo real de lightgbm {lgb.__version__} con N = {N:,} × F = {F} sintéticos (semilla {SEED}); deterministic + force_row_wise.",
            f"Los {K} árboles tienen exactamente {L} hojas (leaf-wise llega siempre con min_data_in_leaf 20): params_total = K·(2L − 1) es REAL, no una cota.",
            f"Base: boost_from_average la suma a las hojas del árbol 1 (Σ hojas = predict: {base_folded}) → 0 números aparte.",
            f"Camino promedio medido: {avg:.3f} comparaciones por árbol (árboles desbalanceados; ⌈log₂ {L}⌉ = {int(np.ceil(np.log2(L)))} sería el balanceado).",
            "FLOPs = 0: un árbol compara y suma (0 MACs).",
        ],
        "source": dict(lib="lightgbm", ctor=f"lgb.train({{'objective': 'regression', 'deterministic': True, 'force_row_wise': True, 'num_threads': {THREADS}, 'seed': 0}}, Dataset(X, y), {K})", **versions()),
    })
    assert base_folded
    write_expected(cid, doc)


# ------------------------------------------------------------------ CatBoost
def cb_expected(cid, K, d):
    X, y = data()
    t0 = time.time()
    m = cb.CatBoostRegressor(iterations=K, depth=d, learning_rate=0.1, verbose=0, thread_count=THREADS, random_seed=0, allow_writing_files=False)
    m.fit(X, y)
    allp = m.get_all_params()
    lc = m.get_tree_leaf_counts()
    assert set(lc.tolist()) == {2 ** d}
    with tempfile.TemporaryDirectory() as dd:
        pj = os.path.join(dd, "m.json")
        m.save_model(pj, format="json")
        mj = json.load(open(pj))
        cbm = file_size(m.save_model, "cbm")
    splits = [len(t["splits"]) for t in mj["oblivious_trees"]]
    assert set(splits) == {d}
    borders = max(len(f.get("borders", [])) for f in mj["features_info"]["float_features"])
    scale, bias = m.get_scale_and_bias()
    leaf = m.calc_leaf_indexes(cb.Pool(X[:1]))
    gh = sq_obj_shapes(X, y)
    shapes = common_shapes(N, F, int(allp["border_count"]) + 1, splits[0] + int(lc[0]), leaf.shape[1])   # árbol = sus d cortes + 2^d hojas
    shapes["g"], shapes["h"] = gh["g"], gh["h"]
    shapes["F-prev"] = list(m.predict(X, prediction_type="RawFormulaVal").shape)
    shapes["F-new"] = shapes["F-prev"]
    per_tree = d + 2 ** d
    doc = base_doc(cid, K, shapes)
    doc.update({
        "params_total": K * per_tree + 1,
        "params_by_node": {"tree": K * per_tree, "predict": 1},
        "params_real_total": sum(splits) + int(lc.sum()) + 1,
        "defaults": dict({k: allp[k] for k in ["border_count", "l2_leaf_reg", "grow_policy", "boosting_type"]},
                         depth_default=cb.CatBoostRegressor(iterations=1, verbose=0, thread_count=THREADS, allow_writing_files=False).fit(X[:1000], y[:1000]).get_all_params()["depth"]),
        "metrics_checks": {"measuredNodes": K * (2 ** (d + 1) - 1), "measuredLeaves": int(lc.sum()), "leavesPerTree": 2 ** d, "paramsPerTree": per_tree, "nTrees": K,
                           "comparisonsPerPrediction": K * d},
        "range_checks": [
            {"what": "bytes del .cbm / tree_bytes", "metric": "modelBytesMeasured", "calc_overrides": {}, "ref": cbm, "min_ratio": 0.97, "max_ratio": 1.03},
        ],
        "measured": {"cbm_bytes": cbm, "max_borders_used": borders, "scale": scale, "bias": bias, "train_seconds": round(time.time() - t0, 1)},
        "notes": [
            f"Modelo real de catboost {cb.__version__} (SymmetricTree) con N = {N:,} × F = {F} sintéticos (semilla {SEED}); learning_rate 0.1 fijo.",
            f"Cada árbol: {d} cortes (uno por nivel, compartido) + {2 ** d} hojas → params_total = K·{per_tree} + 1 (bias de get_scale_and_bias; scale = 1 no es aprendido).",
            f"border_count {allp['border_count']} → hasta {int(allp['border_count']) + 1} bins; el modelo guarda solo los bordes usados (máx. {borders} por feature).",
            "FLOPs = 0: un árbol compara y suma (0 MACs).",
        ],
        "source": dict(lib="catboost", ctor=f"CatBoostRegressor(iterations={K}, depth={d}, learning_rate=0.1, thread_count={THREADS}, random_seed=0).fit(X, y)", **versions()),
    })
    write_expected(cid, doc)


if __name__ == "__main__":
    only = sys.argv[1:]
    jobs = [("xgboost-500-d6", lambda: xgb_expected("xgboost-500-d6", 500, 6)),
            ("lightgbm-500-l31", lambda: lgb_expected("lightgbm-500-l31", 500)),
            ("xgboost-2000-d8", lambda: xgb_expected("xgboost-2000-d8", 2000, 8)),
            ("catboost-oblivious-d6", lambda: cb_expected("catboost-oblivious-d6", 500, 6))]
    for cid, fn in jobs:
        if not only or cid in only:
            print("▸", cid, file=sys.stderr)
            fn()
