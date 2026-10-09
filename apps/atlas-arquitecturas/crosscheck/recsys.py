"""Cross-check de la fase 13 (recomendación): two-tower y DLRM / DCN v2 / Wide & Deep (SPEC §25.1–25.2). Solo desarrollo.

No hay checkpoints oficiales: los modelos se construyen AQUÍ, en PyTorch, desde las configs de referencia citadas (escritas de nuevo
en este archivo, no leídas del calculador), en el dispositivo META (tablas de 40M filas sin memoria):
- DLRM: réplica de DLRM_Net de facebookresearch/dlrm (dlrm_s_pytorch.py): create_mlp (Linear + ReLU, sigmoide en la última capa
  del top), create_emb (nn.EmbeddingBag mode='sum'), interact_features 'dot' (cat → bmm T·Tᵀ → triángulo inferior estricto con
  li/lj, offset 0 → cat con el vector denso). Configs: bench/dlrm_s_criteo_kaggle.sh y bench/run_and_time.sh.
- DLRM-DCNv2: torchrec DLRM_DCN (MLPerf v3.0+): DenseArch (MLP con ReLU), EmbeddingBagCollection multi-hot (suma), InteractionDCNArch
  (cat de denso + 26 embeddings → reshape (B, 27·128) → LowRankCrossNet: x_{l+1} = x_0 * (W(V x_l) + b) + x_l, con W (in × r),
  V (r × in) y F.linear como torchrec) y OverArch (MLP con ReLU + Linear final; la sigmoide va en la pérdida).
- Wide & Deep: referencia de la página (Cheng et al. 2016, Fig. 4): parte wide = EmbeddingBag(filas, 1) por tabla, sumadas; parte
  deep = EmbeddingBag(filas, 32) por tabla → cat con las 13 densas → 1024-512-256 → 1; logit = wide + deep.
- Two-tower: referencia de la página (torres como Yi et al. 2019): EmbeddingBag para ids, historial (mean, tabla de ítems
  COMPARTIDA: el mismo módulo, parameters() no la duplica) y categóricas; MLP 256-128-dim; F.normalize; puntaje u·v con bmm;
  logits del lote U·Vᵀ (mm) y búsqueda por fuerza bruta u·Vᵀ_all contra N_items vectores meta.

FLOPs con FlopCounterMode (2·MACs de mm / addmm / bmm; EmbeddingBag, ReLU, normalize, sigmoide: 0, como el calculador). Formas
registradas en el forward (sin batch). Parámetros por módulo con sum(numel). Cuentas de filas independientes:
- Criteo Kaggle procesado por el repo de DLRM, sin filtrar ids raros: Desai et al., ROBE, arXiv:2108.02191, §7.5 (33,762,577).
- Criteo 1TB con max-ind-range 40M: --num_embeddings_per_feature del README de torchrec_dlrm (MLPerf training, recommendation_v2).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import versions, write_expected  # noqa: E402

import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import torch.nn.functional as Fn  # noqa: E402
from torch.utils.flop_counter import FlopCounterMode  # noqa: E402

KAGGLE = [1460, 583, 10131227, 2202608, 305, 24, 12517, 633, 3, 93145, 5683, 8351593, 3194, 27, 14992, 5461306, 10, 5652, 2173, 4,
          7046547, 18, 15, 286181, 105, 142572]
TB40M = [40000000, 39060, 17295, 7424, 20265, 3, 7122, 1543, 63, 40000000, 3067956, 405282, 10, 2209, 11938, 155, 4, 976, 14,
         40000000, 40000000, 40000000, 590152, 12973, 108, 36]
HOTS = [3, 2, 1, 2, 6, 1, 1, 1, 1, 7, 3, 8, 1, 6, 9, 5, 1, 1, 1, 12, 100, 27, 10, 3, 1, 1]
assert sum(KAGGLE) == 33762577 and len(KAGGLE) == 26 and len(TB40M) == 26 and sum(HOTS) == 214

DLRM_CONFIGS = {
    "dlrm-criteo-kaggle": dict(kind="dot", rows=KAGGLE, d=16, bot="13-512-256-64-16", top="512-256-1", hots=None,
                               src="facebookresearch/dlrm bench/dlrm_s_criteo_kaggle.sh"),
    "dlrm-mlperf": dict(kind="dot", rows=TB40M, d=128, bot="13-512-256-128", top="1024-1024-512-256-1", hots=None,
                        src="facebookresearch/dlrm bench/run_and_time.sh (--max-ind-range=40000000)"),
    "dlrm-dcnv2": dict(kind="dcn", rows=TB40M, d=128, bot="13-512-256-128", top="1024-1024-512-256-1", hots=HOTS, layers=3, rank=512,
                       src="mlcommons/training recommendation_v2/torchrec_dlrm README (DLRM_DCN, --dcn_num_layers=3 --dcn_low_rank_dim=512)"),
    "wide-and-deep": dict(kind="wd", rows=KAGGLE, d=32, bot=None, top="1024-512-256-1", hots=None,
                          src="Cheng et al. 2016 (Fig. 4) sobre las tablas de Criteo Kaggle; referencia de la página"),
}


def sizes(s):
    return [int(x) for x in s.split("-")]


class Rec:
    def __init__(self):
        self.shapes = {}

    def put(self, tid, t):
        s = list(t.shape)
        assert s[0] == 1, (tid, s)
        self.shapes[tid] = s[1:] if len(s) > 1 else [1]


def create_mlp(ln, sigmoid_layer):
    # dlrm_s_pytorch.py DLRM_Net.create_mlp: Linear(n, m, bias=True) + (Sigmoid si i == sigmoid_layer, si no ReLU)
    layers = []
    for i in range(len(ln) - 1):
        layers.append(nn.Linear(ln[i], ln[i + 1], bias=True))
        layers.append(nn.Sigmoid() if i == sigmoid_layer else nn.ReLU())
    return nn.Sequential(*layers)


class DLRM(nn.Module):
    """Réplica de DLRM_Net (interacción dot) y de DLRM_DCN de torchrec (kind='dcn')."""

    def __init__(self, c):
        super().__init__()
        self.c = c
        d = c["d"]
        n = len(c["rows"]) + 1
        self.emb_l = nn.ModuleList([nn.EmbeddingBag(r, d, mode="sum") for r in c["rows"]])
        ln_bot = sizes(c["bot"])
        self.bot_l = create_mlp(ln_bot, -1)   # sigmoid_bot = -1: ReLU en todas
        if c["kind"] == "dot":
            num_int = n * (n - 1) // 2 + ln_bot[-1]   # dlrm_s_pytorch.py: (num_fea * (num_fea - 1)) // 2 + m_den_out
            ln_top = [num_int] + sizes(c["top"])
            self.top_l = create_mlp(ln_top, len(ln_top) - 2)
        else:
            inf = n * d
            r = c["rank"]
            self.W_kernels = nn.ParameterList([nn.Parameter(torch.empty(inf, r)) for _ in range(c["layers"])])
            self.V_kernels = nn.ParameterList([nn.Parameter(torch.empty(r, inf)) for _ in range(c["layers"])])
            self.bias = nn.ParameterList([nn.Parameter(torch.empty(inf)) for _ in range(c["layers"])])
            top = sizes(c["top"])
            mlp = []
            prev = inf
            for s in top[:-1]:
                mlp += [nn.Linear(prev, s), nn.ReLU()]
                prev = s
            mlp.append(nn.Linear(prev, top[-1]))   # OverArch: Linear final sin activación
            self.top_l = nn.Sequential(*mlp)

    def forward(self, dense, idx, offs, rec):
        c = self.c
        rec.put("dense", dense)
        x = dense
        for i, m in enumerate(self.bot_l):
            x = m(x)
            k = i // 2 + 1
            rec.put(("b-h%d" if isinstance(m, nn.Linear) else "b-a%d") % k, x)
        rec.shapes["bot-out"] = rec.shapes.pop("b-a%d" % (len(self.bot_l) // 2))
        ly = [e(idx[i], offs[i]) for i, e in enumerate(self.emb_l)]
        B, d = x.shape
        T = torch.cat([x] + ly, dim=1).view((B, -1, d))
        rec.shapes["emb"] = [len(ly), d]
        rec.put("feats", T)
        if c["kind"] == "dot":
            Z = torch.bmm(T, torch.transpose(T, 1, 2))
            rec.put("gram", Z)
            _, ni, nj = Z.shape
            li = torch.tensor([i for i in range(ni) for j in range(i)])
            lj = torch.tensor([j for i in range(nj) for j in range(i)])
            Zflat = Z[:, li, lj]
            rec.put("pairs", Zflat)
            R = torch.cat([x] + [Zflat], dim=1)
        else:
            x0 = T.reshape([B, -1])
            rec.put("x0", x0)
            xl = x0
            for layer in range(c["layers"]):
                xv = Fn.linear(xl, self.V_kernels[layer])
                xw = Fn.linear(xv, self.W_kernels[layer])
                if layer == 0:
                    rec.put("c-low", xv)
                    rec.put("c-up", xw)
                xl = x0 * (xw + self.bias[layer]) + xl
            R = xl
        rec.put("top-in", R)
        y = R
        mods = list(self.top_l)
        for i, m in enumerate(mods):
            y = m(y)
            k = i // 2 + 1
            if isinstance(m, nn.Linear):
                rec.put("t-h%d" % k, y)
            elif isinstance(m, nn.ReLU):
                rec.put("t-a%d" % k, y)
            else:   # create_mlp: la última capa del top termina en Sigmoid (dentro del top MLP de dlrm)
                rec.put("ctr", y)
        rec.shapes["logit"] = rec.shapes.pop("t-h%d" % sum(isinstance(x, nn.Linear) for x in mods))
        if c["kind"] != "dot":
            y = torch.sigmoid(y)
            rec.put("ctr", y)
        return y


class WideDeep(nn.Module):
    def __init__(self, c):
        super().__init__()
        self.c = c
        self.wide = nn.ModuleList([nn.EmbeddingBag(r, 1, mode="sum") for r in c["rows"]])
        self.emb_l = nn.ModuleList([nn.EmbeddingBag(r, c["d"], mode="sum") for r in c["rows"]])
        top = sizes(c["top"])
        mlp = []
        prev = len(c["rows"]) * c["d"] + 13
        for s in top[:-1]:
            mlp += [nn.Linear(prev, s), nn.ReLU()]
            prev = s
        mlp.append(nn.Linear(prev, top[-1]))
        self.deep = nn.Sequential(*mlp)

    def forward(self, dense, idx, offs, rec):
        w = torch.cat([e(idx[i], offs[i]) for i, e in enumerate(self.wide)], dim=1)
        rec.shapes["w-emb"] = [w.shape[1], 1]
        wide = w.sum(dim=1, keepdim=True)
        rec.put("wide-logit", wide)
        ly = [e(idx[i], offs[i]) for i, e in enumerate(self.emb_l)]
        rec.shapes["emb"] = [len(ly), ly[0].shape[1]]
        ef = torch.cat(ly, dim=1)
        rec.put("e-flat", ef)
        x = torch.cat([ef, dense], dim=1)
        rec.put("top-in", x)
        mods = list(self.deep)
        for i, m in enumerate(mods):
            x = m(x)
            k = i // 2 + 1
            rec.put(("t-h%d" if isinstance(m, nn.Linear) else "t-a%d") % k, x)
        rec.shapes["deep-logit"] = rec.shapes.pop("t-h%d" % ((len(mods) + 1) // 2))
        logit = wide + x
        rec.put("logit", logit)
        y = torch.sigmoid(logit)
        rec.put("ctr", y)
        return y


class ByModule(dict):
    """FLOPs por módulo (FQN de FlopCounterMode). get(nombre): el del módulo, o la suma de sus hijos directos si el contenedor no se
    llamó como módulo (DLRM recorre las capas de su Sequential una por una, como dlrm_s_pytorch.apply_mlp)."""

    def get(self, name, default=0):
        if name in self:
            return self[name]
        kids = [v for k, v in self.items() if k.startswith(name + ".") and k.count(".") == name.count(".") + 1]
        return sum(kids) if kids else default


def flops_by_module(fc):
    return ByModule({k: int(sum(v.values())) for k, v in fc.get_flop_counts().items()})


def dlrm_expected(cid, c):
    with torch.device("meta"):
        m = DLRM(c) if c["kind"] != "wd" else WideDeep(c)
        hots = c["hots"] or [1] * len(c["rows"])
        idx = [torch.zeros(h, dtype=torch.long) for h in hots]
        offs = [torch.zeros(1, dtype=torch.long) for _ in hots]
        dense = torch.zeros(1, 13)
    rec = Rec()
    fc = FlopCounterMode(display=False)
    with fc, torch.no_grad():
        m(dense, idx, offs, rec)
    total = int(fc.get_total_flops())
    by_op = {str(k): int(v) for k, v in fc.get_flop_counts().get("Global", {}).items()}
    by_mod = flops_by_module(fc)
    n = lambda mod: int(sum(p.numel() for p in mod.parameters()))  # noqa: E731
    emb = n(m.emb_l) + (n(m.wide) if c["kind"] == "wd" else 0)
    shapes = dict(rec.shapes)
    shapes["sparse-ids"] = [sum(hots)]
    data = {"config_id": cid, "model": "dlrm", "params_total": n(m), "params_by_node": {}, "shapes": shapes, "flops_total": total,
            "flops_by_op_torch": by_op}
    pbn = data["params_by_node"]
    if c["kind"] == "wd":
        pbn.update({"wide": n(m.wide), "embeddings": n(m.emb_l), "top-mlp": n(m.deep)})
        data["flops_by_node"] = {"top-mlp": by_mod.get(type(m).__name__ + ".deep", 0)}
        data["flops_by_op_groups"] = [{"ops": ["aten.addmm"], "prims": ["linear"]}]
    else:
        pbn.update({"embeddings": n(m.emb_l), "bottom-mlp": n(m.bot_l), "top-mlp": n(m.top_l)})
        name = type(m).__name__
        data["flops_by_node"] = {"bottom-mlp": by_mod.get(name + ".bot_l", 0), "top-mlp": by_mod.get(name + ".top_l", 0)}
        if c["kind"] == "dot":
            data["flops_by_op_groups"] = [{"ops": ["aten.bmm"], "prims": ["pairwise_dot"]}, {"ops": ["aten.addmm"], "prims": ["linear"]}]
        else:
            inter = n(m) - emb - n(m.bot_l) - n(m.top_l)
            pbn["interaction"] = inter
            # cross-v / cross-w: F.linear sin sesgo → aten.mm; los MLPs → aten.addmm
            data["flops_by_op_groups"] = [{"ops": ["aten.addmm", "aten.mm"], "prims": ["linear"]}]
    mlp = n(m.deep) if c["kind"] == "wd" else n(m.bot_l) + n(m.top_l)
    data["metrics_checks"] = {"embeddingParams": emb, "mlpParams": mlp, "lookupsPerSample": sum(hots) * (2 if c["kind"] == "wd" else 1),
                              "tables": len(c["rows"]), "totalRows": sum(c["rows"])}
    if c["kind"] == "dot":
        data["metrics_checks"]["interactionMacs"] = by_op.get("aten.bmm", 0) // 2
    if c["kind"] == "dcn":
        data["metrics_checks"]["interactionMacs"] = by_op.get("aten.mm", 0) // 2
        data["metrics_checks"]["interactionParams"] = pbn["interaction"]
    data["notes"] = [
        "Construido en código en el dispositivo meta (sin pesos ni datos). " + c["src"] + ".",
        "EmbeddingBag (lookup + suma), ReLU, sigmoide y el producto x0 ⊙ (…) de DCN no cuentan en FlopCounterMode, igual que el calculador ('otros').",
    ]
    if c["kind"] == "dot":
        data["notes"].append("La interacción es un bmm de la matriz ENTERA 27×27 (FlopCounterMode cuenta 27²·d MACs); se usan los 351 pares del triángulo inferior estricto.")
    data["source"] = dict(lib="torch (réplica de DLRM_Net de facebookresearch/dlrm / DLRM_DCN de torchrec)" if c["kind"] != "wd" else "torch (referencia Wide & Deep)",
                          ctor=f"{type(m).__name__}({ {k: v for k, v in c.items() if k not in ('rows', 'src')} })", rows_sum=sum(c["rows"]), **versions())
    write_expected(cid, data)


# ------------------------------------------------------------------ two-tower
USER_CATS = [250, 100, 8, 24]
ITEM_CATS = [1000, 100, 32, 64]
TT = {
    "two-tower-base": dict(ids=True, idBuckets=10000000, nItems=2000000, idDim=64, hist=50, dim=64),
    "two-tower-small": dict(ids=True, idBuckets=1000000, nItems=100000, idDim=64, hist=50, dim=64),
    "two-tower-no-ids": dict(ids=False, idBuckets=0, nItems=2000000, idDim=64, hist=0, dim=64),
}


def mlp(sizes_):
    out = []
    for i in range(len(sizes_) - 1):
        out.append(nn.Linear(sizes_[i], sizes_[i + 1]))
        if i < len(sizes_) - 2:
            out.append(nn.ReLU())
    return nn.Sequential(*out)


class Tower(nn.Module):
    def __init__(self, id_table, cats, din, dim, hist_table=None, hist=0):
        super().__init__()
        self.id_table = id_table
        self.hist_table = hist_table     # el MISMO módulo que la tabla de ítems: parameters() no lo duplica
        self.hist = hist
        self.cats = nn.ModuleList([nn.EmbeddingBag(r, 16, mode="sum") for r in cats])
        self.mlp = mlp([din, 256, 128, dim])

    def forward(self, ids, hist, cats, rec, p):
        parts = []
        if self.id_table is not None:
            e = self.id_table(ids)
            rec.put(p + "id-emb", e)
            parts.append(e)
        if self.hist_table is not None and self.hist:
            h = Fn.embedding_bag(hist, self.hist_table.weight, mode="mean")
            rec.put(p + "hist-emb", h)
            parts.append(h)
        ce = torch.cat([m(cats[:, i:i + 1]) for i, m in enumerate(self.cats)], dim=1)
        rec.put(p + "cat-emb", ce)
        parts.append(ce)
        x = torch.cat(parts, dim=1)
        rec.put(p + "in", x)
        for i, m in enumerate(self.mlp):
            x = m(x)
            k = i // 2 + 1
            rec.put((p + "h%d" if isinstance(m, nn.Linear) else p + "a%d") % k, x)
        return Fn.normalize(x, dim=-1)


class TwoTower(nn.Module):
    def __init__(self, c):
        super().__init__()
        item_table = nn.EmbeddingBag(c["nItems"], c["idDim"], mode="sum") if c["ids"] else None
        user_table = nn.EmbeddingBag(c["idBuckets"], c["idDim"], mode="sum") if c["ids"] else None
        du = (2 * c["idDim"] if c["ids"] and c["hist"] else (c["idDim"] if c["ids"] else 0)) + 64
        dv = (c["idDim"] if c["ids"] else 0) + 64
        self.item = Tower(item_table, ITEM_CATS, dv, c["dim"])
        self.user = Tower(user_table, USER_CATS, du, c["dim"], hist_table=item_table, hist=c["hist"])
        self.c = c

    def forward(self, B, rec):
        c = self.c
        with torch.device("meta"):
            uid = torch.zeros(B, 1, dtype=torch.long)
            hist = torch.zeros(B, max(1, c["hist"]), dtype=torch.long)
            iid = torch.zeros(B, 1, dtype=torch.long)
            ucat = torch.zeros(B, 4, dtype=torch.long)
            icat = torch.zeros(B, 4, dtype=torch.long)
            index = torch.zeros(c["nItems"], c["dim"])     # el índice offline (los v de todos los ítems)
        u = self.user(uid, hist, ucat, rec, "u-")
        rec.put("u", u)
        v = self.item(iid, None, icat, rec, "v-")
        rec.put("v", v)
        score = torch.bmm(u.unsqueeze(1), v.unsqueeze(2)).squeeze(-1)    # u·v por par
        rec.put("score", score)
        logits = u @ v.T                                                   # B×B: la diagonal son los positivos
        rec.shapes["logits"] = list(logits.shape)
        scores = u @ index.T                                               # fuerza bruta: N_items puntajes por usuario
        rec.put("item-scores", scores)
        return score, logits, scores


def tt_run(c, B):
    with torch.device("meta"):
        m = TwoTower(c)
    rec = Rec() if B == 1 else type("R", (), {"shapes": {}, "put": lambda self, t, x: self.shapes.setdefault(t, list(x.shape))})()
    fc = FlopCounterMode(display=False)
    with fc, torch.no_grad():
        m(B, rec)
    return m, rec, fc


def tt_expected(cid, c):
    m, rec, fc = tt_run(c, 1)
    n = lambda mod: int(sum(p.numel() for p in mod.parameters()))  # noqa: E731
    total = int(fc.get_total_flops())
    by_op = {str(k): int(v) for k, v in fc.get_flop_counts().get("Global", {}).items()}
    by_mod = flops_by_module(fc)
    shapes = dict(rec.shapes)
    del shapes["logits"]   # B×B: se compara en batch_check (con B = 1 es 1×1)
    item_tab = n(m.item.id_table) if m.item.id_table is not None else 0
    user_tab = n(m.user.id_table) if m.user.id_table is not None else 0
    cats = n(m.user.cats) + n(m.item.cats)
    data = {
        "config_id": cid, "model": "two-tower", "calc_overrides": {"B": 1},
        "params_total": n(m),
        "params_by_node": {"user-tower": n(m.user) - (item_tab if c["ids"] and c["hist"] else 0), "item-tower": n(m.item)},
        "params_by_path": {"user-tower>mlp": n(m.user.mlp), "item-tower>mlp": n(m.item.mlp), "user-tower>cat-embed": n(m.user.cats),
                           "item-tower>cat-embed": n(m.item.cats)},
        "shapes": shapes, "flops_total": total, "flops_by_op_torch": by_op,
        "flops_by_node": {"user-tower": by_mod.get("TwoTower.user", 0), "item-tower": by_mod.get("TwoTower.item", 0)},
        "flops_by_op_groups": [{"ops": ["aten.addmm", "aten.mm", "aten.bmm"], "prims": ["linear", "similarity_logits", "dot_score"]}],
        "metrics_checks": {"embeddingParams": user_tab + item_tab + cats, "mlpParams": n(m.user.mlp) + n(m.item.mlp),
                           "userTowerMacs": by_mod.get("TwoTower.user", 0) // 2, "itemTowerMacs": by_mod.get("TwoTower.item", 0) // 2,
                           "bruteForceMacs": c["nItems"] * c["dim"]},
    }
    if c["ids"]:
        data["params_by_path"]["item-tower>id-embed"] = item_tab
        data["params_by_path"]["user-tower>id-embed"] = user_tab
        if c["hist"]:
            data["params_by_path"]["user-tower>hist-embed"] = 0
    # Lote B = 4: torres × 4, puntajes 4·dim, logits 4·4·dim, búsqueda 4·N_items·dim = 4 × (total del calculador con B = 4).
    _, rb, fb = tt_run(c, 4)
    data["batch_check"] = {"B": 4, "flops_total": int(fb.get_total_flops()), "shapes": {"logits": rb.shapes["logits"], "U": rb.shapes["u"], "V": rb.shapes["v"]}}
    data["notes"] = [
        "Referencia de la página (no hay checkpoint): construida en código en meta. La tabla de ítems es UN módulo usado por la torre de ítem (item-id) y por el historial (mean): parameters() la cuenta una vez; el calculador la pone en item-tower > id-embed.",
        "Puntaje u·v con bmm, logits U·Vᵀ y la búsqueda u·Vᵀ_all con mm (FlopCounterMode). Con B = 1 los logits son 1×1 (B·dim por par); batch_check corre B = 4.",
    ]
    data["source"] = dict(lib="torch (referencia two-tower)", ctor=f"TwoTower({c})", **versions())
    write_expected(cid, data)


if __name__ == "__main__":
    only = sys.argv[1:]
    for cid, c in TT.items():
        if not only or cid in only:
            print("▸", cid, file=sys.stderr)
            tt_expected(cid, c)
    for cid, c in DLRM_CONFIGS.items():
        if not only or cid in only:
            print("▸", cid, file=sys.stderr)
            dlrm_expected(cid, c)
