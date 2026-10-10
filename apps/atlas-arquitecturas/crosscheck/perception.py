"""Cross-check de la fase 14 (SPEC §26): tracking (SORT / ByteTrack), profundidad monocular (DPT / Depth Anything V2) y PointNet.
Solo desarrollo; nunca descarga pesos ni configs (todo se construye en código).

Tracking (modelo `bytetrack`):
- Kalman: se cuentan los MACs de las llamadas REALES (np.dot, np.linalg.multi_dot / solve / inv, scipy.linalg.cho_factor /
  cho_solve) con sus formas, inyectando un proxy de numpy en el módulo que corre el filtro:
    · ultralytics 8.4.174 KalmanFilterXYAH (instalado) — y un frame COMPLETO de su BYTETracker con 50 tracks, 40 detecciones altas
      y 10 bajas (todas las asociaciones y updates reales; también se registran las llamadas a lap.lapjv: forma y cost_limit);
    · filterpy 1.4.5 KalmanFilter (instalado) con las matrices de SORT (abewley/sort sort.py, KalmanBoxTracker: dim_x 7, dim_z 4);
    · el filtro OFICIAL de ByteTrack (ifzhang/ByteTrack yolox/tracker/kalman_filter.py), transcrito abajo línea a línea (H densa,
      multi_dot, Cholesky) porque el repo no es un paquete instalable.
  Convención de factorizaciones (igual que primitives.kalmanCost): Cholesky m(m²−1)/6, LU (m−1)m(2m−1)/6, m(m−1) por lado derecho.
- Umbrales: los del YAML instalado de ultralytics (cfg/trackers/bytetrack.yaml) y los del repo oficial (transcritos: tools/track.py
  y byte_tracker.py, rama main).
- Detector: YOLOX-X de ByteTrack (yolox/models: CSPDarknet + PAFPN + YOLOXHead, depth 1.33, width 1.25, num_classes 1) transcrito
  y construido en meta a 800×1440 (FlopCounterMode). Sanidad: con 80 clases a 640, 99,071,455 parámetros (README de YOLOX: 99.1 M).
  YOLOv8-L: crosscheck/expected/yolov8l-640.json (fase 4).
Profundidad (modelo `depth`): HF DepthAnythingForDepthEstimation / DPTForDepthEstimation desde las config.json de
  depth-anything/Depth-Anything-V2-{Small,Base,Large}-hf e Intel/dpt-large (copiadas aquí), en meta, atención eager.
PointNet (modelo `pointnet`): PyTorch transcrito del código oficial en TF (charlesq34/pointnet, charlesq34/pointnet2): conv 1×1 con
  sesgo + BN (β, γ) en cada capa; forward real en CPU (eval) para formas, FLOPs, invariancia a permutaciones y puntos críticos.
"""
import json
import os
import sys
import types

import numpy as np
import scipy.linalg

from common import EXPECTED, ShapeRecorder, count_flops, n_params, versions, write_expected, CUSTOM  # noqa: F401

import torch
import torch.nn as nn
from torch.utils.flop_counter import FlopCounterMode

HERE = os.path.dirname(os.path.abspath(__file__))


# ================================================================== contador de MACs para numpy / scipy
class Counter:
    def __init__(self):
        self.macs = 0
        self.calls = []

    def add(self, what, macs, shapes):
        self.macs += int(macs)
        self.calls.append((what, [list(s) for s in shapes], int(macs)))


def lu_macs(m):
    return (m - 1) * m * (2 * m - 1) // 6


def chol_macs(m):
    return m * (m * m - 1) // 6


def dot_macs(a, b):
    a, b = np.asarray(a), np.asarray(b)
    if a.ndim == 0 or b.ndim == 0:
        return 0
    if b.ndim == 1:
        return int(np.prod(a.shape))
    k = a.shape[-1]
    assert k == b.shape[-2], (a.shape, b.shape)
    return int(np.prod(a.shape[:-1])) * k * int(np.prod(b.shape[:-2])) * b.shape[-1]


def make_np(counter):
    """Proxy del módulo numpy: cuenta dot, linalg.multi_dot, linalg.solve y linalg.inv; el resto pasa tal cual."""
    lin = types.SimpleNamespace(**{k: getattr(np.linalg, k) for k in dir(np.linalg) if not k.startswith("__")})

    def dot(a, b, *args, **kw):
        counter.add("dot", dot_macs(a, b), [np.shape(a), np.shape(b)])
        return np.dot(a, b, *args, **kw)

    def multi_dot(arrays, **kw):
        A, B, C = [np.asarray(x) for x in arrays] if len(arrays) == 3 else (None, None, None)
        if A is not None:
            # numpy._multi_dot_three: elige el orden más barato con este mismo costo.
            c1 = A.shape[0] * A.shape[1] * B.shape[1] + A.shape[0] * B.shape[1] * C.shape[1]
            c2 = B.shape[0] * B.shape[1] * C.shape[1] + A.shape[0] * A.shape[1] * C.shape[1]
            counter.add("multi_dot", min(c1, c2), [A.shape, B.shape, C.shape])
        else:
            raise NotImplementedError("multi_dot con != 3 matrices")
        return np.linalg.multi_dot(arrays, **kw)

    def solve(a, b):
        a, b = np.asarray(a), np.asarray(b)
        m = a.shape[-1]
        rhs = b.shape[-1] if b.ndim == a.ndim else 1
        counter.add("solve", lu_macs(m) + rhs * m * (m - 1), [a.shape, b.shape])
        return np.linalg.solve(a, b)

    def inv(a):
        a = np.asarray(a)
        m = a.shape[-1]
        counter.add("inv", lu_macs(m) + m * m * (m - 1), [a.shape])
        return np.linalg.inv(a)

    lin.multi_dot, lin.solve, lin.inv = multi_dot, solve, inv
    proxy = types.SimpleNamespace(**{k: getattr(np, k) for k in dir(np) if not k.startswith("__")})
    proxy.dot, proxy.linalg = dot, lin
    return proxy, dot, inv


def make_scipy_linalg(counter):
    def cho_factor(a, lower=False, overwrite_a=False, check_finite=True):
        counter.add("cho_factor", chol_macs(np.shape(a)[-1]), [np.shape(a)])
        return scipy.linalg.cho_factor(a, lower=lower, overwrite_a=overwrite_a, check_finite=check_finite)

    def cho_solve(c_and_lower, b, overwrite_b=False, check_finite=True):
        m = c_and_lower[0].shape[-1]
        rhs = np.shape(b)[-1] if np.ndim(b) == 2 else 1
        counter.add("cho_solve", rhs * m * (m - 1), [c_and_lower[0].shape, np.shape(b)])
        return scipy.linalg.cho_solve(c_and_lower, b, overwrite_b=overwrite_b, check_finite=check_finite)

    return types.SimpleNamespace(cho_factor=cho_factor, cho_solve=cho_solve)


# ------------------------------------------------------------------ filtro OFICIAL de ByteTrack (transcrito)
# ifzhang/ByteTrack, yolox/tracker/kalman_filter.py (rama main): estado 8-D (x, y, a, h, vx, vy, va, vh), H = eye(4, 8) densa,
# predict = dot(mean, Fᵀ) + multi_dot((F, P, Fᵀ)) + Q; project = dot(H, mean) + multi_dot((H, P, Hᵀ)) + R; update con
# scipy.linalg.cho_factor / cho_solve sobre dot(P, Hᵀ)ᵀ, dot(innovation, Kᵀ) y multi_dot((K, S, Kᵀ)).
class OfficialKF:
    def __init__(self, np_, sla):
        self.np, self.sla = np_, sla
        ndim, dt = 4, 1.0
        self._motion_mat = np.eye(2 * ndim, 2 * ndim)
        for i in range(ndim):
            self._motion_mat[i, ndim + i] = dt
        self._update_mat = np.eye(ndim, 2 * ndim)
        self._std_weight_position = 1.0 / 20
        self._std_weight_velocity = 1.0 / 160

    def initiate(self, measurement):
        mean = np.r_[measurement, np.zeros_like(measurement)]
        h = measurement[3]
        std = [2 * self._std_weight_position * h, 2 * self._std_weight_position * h, 1e-2, 2 * self._std_weight_position * h,
               10 * self._std_weight_velocity * h, 10 * self._std_weight_velocity * h, 1e-5, 10 * self._std_weight_velocity * h]
        return mean, np.diag(np.square(std))

    def predict(self, mean, covariance):
        _np = self.np
        std_pos = [self._std_weight_position * mean[3], self._std_weight_position * mean[3], 1e-2, self._std_weight_position * mean[3]]
        std_vel = [self._std_weight_velocity * mean[3], self._std_weight_velocity * mean[3], 1e-5, self._std_weight_velocity * mean[3]]
        motion_cov = np.diag(np.square(np.r_[std_pos, std_vel]))
        mean = _np.dot(mean, self._motion_mat.T)
        covariance = _np.linalg.multi_dot((self._motion_mat, covariance, self._motion_mat.T)) + motion_cov
        return mean, covariance

    def project(self, mean, covariance):
        _np = self.np
        std = [self._std_weight_position * mean[3], self._std_weight_position * mean[3], 1e-1, self._std_weight_position * mean[3]]
        innovation_cov = np.diag(np.square(std))
        mean = _np.dot(self._update_mat, mean)
        covariance = _np.linalg.multi_dot((self._update_mat, covariance, self._update_mat.T))
        return mean, covariance + innovation_cov

    def update(self, mean, covariance, measurement):
        _np, sla = self.np, self.sla
        projected_mean, projected_cov = self.project(mean, covariance)
        chol_factor, lower = sla.cho_factor(projected_cov, lower=True, check_finite=False)
        kalman_gain = sla.cho_solve((chol_factor, lower), _np.dot(covariance, self._update_mat.T).T, check_finite=False).T
        innovation = measurement - projected_mean
        new_mean = mean + _np.dot(innovation, kalman_gain.T)
        new_covariance = covariance - _np.linalg.multi_dot((kalman_gain, projected_cov, kalman_gain.T))
        return new_mean, new_covariance


def kalman_official():
    c = Counter()
    proxy, _, _ = make_np(c)
    kf = OfficialKF(proxy, make_scipy_linalg(c))
    m, P = kf.initiate(np.array([100.0, 200.0, 0.5, 80.0]))
    c0 = c.macs
    m, P = kf.predict(m, P)
    pred = c.macs - c0
    c1 = c.macs
    kf.update(m, P, np.array([102.0, 201.0, 0.5, 81.0]))
    upd = c.macs - c1
    return {"predict": pred, "update": upd, "F": list(kf._motion_mat.shape), "H": list(kf._update_mat.shape), "calls": c.calls}


def kalman_ultralytics():
    import ultralytics.trackers.utils.kalman_filter as kfm
    c = Counter()
    proxy, _, _ = make_np(c)
    orig = kfm.np
    kfm.np = proxy
    try:
        kf = kfm.KalmanFilterXYAH()
        m, P = kf.initiate(np.array([100.0, 200.0, 0.5, 80.0]))
        c0 = c.macs
        m, P = kf.predict(m, P)
        pred = c.macs - c0
        c1 = c.macs
        kf.update(m, P, np.array([102.0, 201.0, 0.5, 81.0]))
        upd = c.macs - c1
        c2 = c.macs
        kf.multi_predict(np.tile(m, (5, 1)), np.tile(P, (5, 1, 1)))
        multi5 = c.macs - c2
    finally:
        kfm.np = orig
    return {"predict": pred, "update": upd, "multi_predict_5": multi5, "F": list(kf._motion_mat.shape), "H": list(kf._update_mat.shape), "calls": c.calls}


def kalman_sort():
    import filterpy.kalman.kalman_filter as fkm
    from filterpy.kalman import KalmanFilter
    c = Counter()
    _, dot, inv = make_np(c)
    orig = fkm.dot
    fkm.dot = dot
    try:
        # abewley/sort sort.py, KalmanBoxTracker.__init__ (transcrito): velocidad constante con estado (u, v, s, r, u̇, v̇, ṡ).
        kf = KalmanFilter(dim_x=7, dim_z=4)
        kf.F = np.array([[1, 0, 0, 0, 1, 0, 0], [0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, 0, 1], [0, 0, 0, 1, 0, 0, 0],
                         [0, 0, 0, 0, 1, 0, 0], [0, 0, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 0, 1]], dtype=float)
        kf.H = np.array([[1, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0], [0, 0, 1, 0, 0, 0, 0], [0, 0, 0, 1, 0, 0, 0]], dtype=float)
        kf.R[2:, 2:] *= 10.0
        kf.P[4:, 4:] *= 1000.0
        kf.P *= 10.0
        kf.Q[-1, -1] *= 0.01
        kf.Q[4:, 4:] *= 0.01
        kf.x[:4] = np.array([[100.0], [200.0], [3200.0], [0.5]])
        kf.inv = inv
        c0 = c.macs
        kf.predict()
        pred = c.macs - c0
        c1 = c.macs
        kf.update(np.array([[102.0], [201.0], [3300.0], [0.5]]))
        upd = c.macs - c1
    finally:
        fkm.dot = orig
    return {"predict": pred, "update": upd, "F": list(kf.F.shape), "H": list(kf.H.shape), "calls": c.calls}


class Dets:
    """Detecciones con la interfaz que usa el BYTETracker de ultralytics (conf, xywh, cls; indexado booleano)."""

    def __init__(self, xywh, conf):
        self.xywh = np.asarray(xywh, dtype=np.float32)
        self.conf = np.asarray(conf, dtype=np.float32)
        self.cls = np.zeros(len(self.conf), dtype=np.float32)

    def __len__(self):
        return len(self.conf)

    def __getitem__(self, m):
        return Dets(self.xywh[m], self.conf[m])


def ultralytics_frame(T=50, n_low=10):
    """Un frame real del BYTETracker de ultralytics: T tracks confirmados (frame 1), luego T − n_low detecciones altas en el mismo
    lugar y n_low bajas (score 0.15) sobre los tracks restantes. Se cuentan los MACs del Kalman del frame 2 y las llamadas a lapjv."""
    import ultralytics.trackers.utils.kalman_filter as kfm
    import ultralytics.trackers.utils.matching as mt
    from ultralytics.trackers.byte_tracker import BYTETracker
    import ultralytics
    import yaml
    ypath = os.path.join(os.path.dirname(ultralytics.__file__), "cfg", "trackers", "bytetrack.yaml")
    with open(ypath, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    args = types.SimpleNamespace(**cfg)
    tr = BYTETracker(args)
    xy = np.array([[60 + 100 * (i % 10), 60 + 120 * (i // 10), 40, 80] for i in range(T)], dtype=np.float32)
    tr.update(Dets(xy, np.full(T, 0.9)))
    c = Counter()
    proxy, _, _ = make_np(c)
    lap_calls = []
    real_lap = mt.lap

    class LapProxy:
        @staticmethod
        def lapjv(cost, extend_cost=False, cost_limit=np.inf, return_cost=True):
            n = cost.shape[0] + cost.shape[1] if cost_limit < np.inf else (max(cost.shape) if extend_cost else cost.shape[0])
            res = real_lap.lapjv(cost, extend_cost=extend_cost, cost_limit=cost_limit, return_cost=return_cost)
            lap_calls.append({"shape": list(cost.shape), "cost_limit": float(cost_limit), "n": int(n), "matches": int((res[1] >= 0).sum())})
            return res

    orig = kfm.np
    kfm.np, mt.lap = proxy, LapProxy
    snap = {}
    real_mp = tr.multi_predict

    def mp(tracks):
        snap["before"] = c.macs
        real_mp(tracks)
        snap["after"] = c.macs
        snap["tracks"] = len(tracks)
    tr.multi_predict = mp
    try:
        conf = np.r_[np.full(T - n_low, 0.9), np.full(n_low, 0.15)]
        out = tr.update(Dets(xy, conf))
    finally:
        kfm.np, mt.lap = orig, real_lap
    pred = snap["after"] - snap["before"]
    upd = c.macs - pred
    return {"yaml": cfg, "yaml_path": "ultralytics/cfg/trackers/bytetrack.yaml", "kalman_macs": c.macs, "predict_macs": pred, "update_macs": upd, "predicted_tracks": snap["tracks"],
            "lapjv": lap_calls, "tracks_out": int(len(out)), "max_frames_lost": int(tr.max_frames_lost), "calls": len(c.calls)}


# ------------------------------------------------------------------ YOLOX-X (transcrito de ByteTrack yolox/models)
class BaseConv(nn.Module):
    def __init__(s, cin, cout, k, st):
        super().__init__()
        s.conv = nn.Conv2d(cin, cout, k, st, (k - 1) // 2, bias=False)
        s.bn = nn.BatchNorm2d(cout)
        s.act = nn.SiLU()

    def forward(s, x):
        return s.act(s.bn(s.conv(x)))


class Bottleneck(nn.Module):
    def __init__(s, cin, cout, shortcut=True):
        super().__init__()
        s.conv1, s.conv2 = BaseConv(cin, cout, 1, 1), BaseConv(cout, cout, 3, 1)
        s.add = shortcut and cin == cout

    def forward(s, x):
        y = s.conv2(s.conv1(x))
        return y + x if s.add else y


class SPP(nn.Module):
    def __init__(s, cin, cout):
        super().__init__()
        h = cin // 2
        s.conv1, s.m, s.conv2 = BaseConv(cin, h, 1, 1), nn.ModuleList([nn.MaxPool2d(k, 1, k // 2) for k in (5, 9, 13)]), BaseConv(4 * h, cout, 1, 1)

    def forward(s, x):
        x = s.conv1(x)
        return s.conv2(torch.cat([x] + [m(x) for m in s.m], 1))


class CSP(nn.Module):
    def __init__(s, cin, cout, n, shortcut=True):
        super().__init__()
        h = int(cout * 0.5)
        s.conv1, s.conv2, s.conv3 = BaseConv(cin, h, 1, 1), BaseConv(cin, h, 1, 1), BaseConv(2 * h, cout, 1, 1)
        s.m = nn.Sequential(*[Bottleneck(h, h, shortcut) for _ in range(n)])

    def forward(s, x):
        return s.conv3(torch.cat((s.m(s.conv1(x)), s.conv2(x)), 1))


class Focus(nn.Module):
    def __init__(s, cin, cout, k):
        super().__init__()
        s.conv = BaseConv(4 * cin, cout, k, 1)

    def forward(s, x):
        return s.conv(torch.cat((x[..., ::2, ::2], x[..., 1::2, ::2], x[..., ::2, 1::2], x[..., 1::2, 1::2]), 1))


class YOLOX(nn.Module):
    def __init__(s, dep=1.33, wid=1.25, nc=1):
        super().__init__()
        b, d = int(wid * 64), max(round(dep * 3), 1)
        s.stem = Focus(3, b, 3)
        s.dark2 = nn.Sequential(BaseConv(b, 2 * b, 3, 2), CSP(2 * b, 2 * b, d))
        s.dark3 = nn.Sequential(BaseConv(2 * b, 4 * b, 3, 2), CSP(4 * b, 4 * b, 3 * d))
        s.dark4 = nn.Sequential(BaseConv(4 * b, 8 * b, 3, 2), CSP(8 * b, 8 * b, 3 * d))
        s.dark5 = nn.Sequential(BaseConv(8 * b, 16 * b, 3, 2), SPP(16 * b, 16 * b), CSP(16 * b, 16 * b, d, shortcut=False))
        c0, c1, c2 = int(256 * wid), int(512 * wid), int(1024 * wid)
        n = round(3 * dep)
        s.up = nn.Upsample(scale_factor=2, mode="nearest")
        s.lateral_conv0, s.C3_p4 = BaseConv(c2, c1, 1, 1), CSP(2 * c1, c1, n, False)
        s.reduce_conv1, s.C3_p3 = BaseConv(c1, c0, 1, 1), CSP(2 * c0, c0, n, False)
        s.bu_conv2, s.C3_n3 = BaseConv(c0, c0, 3, 2), CSP(2 * c0, c1, n, False)
        s.bu_conv1, s.C3_n4 = BaseConv(c1, c1, 3, 2), CSP(2 * c1, c2, n, False)
        w = int(256 * wid)
        s.stems = nn.ModuleList([BaseConv(c, w, 1, 1) for c in (c0, c1, c2)])
        s.cls_convs = nn.ModuleList([nn.Sequential(BaseConv(w, w, 3, 1), BaseConv(w, w, 3, 1)) for _ in range(3)])
        s.reg_convs = nn.ModuleList([nn.Sequential(BaseConv(w, w, 3, 1), BaseConv(w, w, 3, 1)) for _ in range(3)])
        s.cls_preds = nn.ModuleList([nn.Conv2d(w, nc, 1) for _ in range(3)])
        s.reg_preds = nn.ModuleList([nn.Conv2d(w, 4, 1) for _ in range(3)])
        s.obj_preds = nn.ModuleList([nn.Conv2d(w, 1, 1) for _ in range(3)])

    def forward(s, x):
        x = s.dark2(s.stem(x))
        x2 = s.dark3(x)
        x1 = s.dark4(x2)
        x0 = s.dark5(x1)
        f0 = s.lateral_conv0(x0)
        f = s.C3_p4(torch.cat([s.up(f0), x1], 1))
        f1 = s.reduce_conv1(f)
        p2 = s.C3_p3(torch.cat([s.up(f1), x2], 1))
        p1 = s.C3_n3(torch.cat([s.bu_conv2(p2), f1], 1))
        p0 = s.C3_n4(torch.cat([s.bu_conv1(p1), f0], 1))
        outs = []
        for k, t in enumerate((p2, p1, p0)):
            t = s.stems[k](t)
            rf = s.reg_convs[k](t)
            outs.append(torch.cat([s.reg_preds[k](rf), s.obj_preds[k](rf).sigmoid(), s.cls_preds[k](s.cls_convs[k](t)).sigmoid()], 1))
        return outs


def yolox_count(nc, H, W):
    params = n_params(YOLOX(nc=nc))
    with torch.device("meta"):
        m = YOLOX(nc=nc).eval()
    f = FlopCounterMode(display=False)
    with f, torch.no_grad():
        m(torch.zeros(1, 3, H, W, device="meta"))
    return params, int(f.get_total_flops())


def iou_np(a, b):
    """IoU de cajas tlbr (como bbox_overlaps de cython_bbox, sin el +1 de píxel: con cajas idénticas da 1 igual)."""
    lt = np.maximum(a[:, None, :2], b[None, :, :2])
    rb = np.minimum(a[:, None, 2:], b[None, :, 2:])
    wh = np.clip(rb - lt, 0, None)
    inter = wh[..., 0] * wh[..., 1]
    ar = lambda x: (x[:, 2] - x[:, 0]) * (x[:, 3] - x[:, 1])
    return inter / (ar(a)[:, None] + ar(b)[None, :] - inter)


def synthetic(T=50, n_low=10):
    xy = np.array([[60 + 100 * (i % 10), 60 + 120 * (i // 10), 40, 80] for i in range(T)], dtype=float)
    tlbr = np.c_[xy[:, :2] - xy[:, 2:] / 2, xy[:, :2] + xy[:, 2:] / 2]
    conf = np.r_[np.full(T - n_low, 0.9), np.full(n_low, 0.15)]
    return xy, tlbr, conf


def official_frame(T=50, n_low=10):
    """Pasos 2–3 de BYTETracker.update del repo oficial (byte_tracker.py), portados con el filtro oficial transcrito y lap.lapjv real:
    T tracks confirmados en las cajas sintéticas; T − n_low detecciones altas (0.9) en su lugar y n_low bajas (0.15) sobre el resto."""
    import lap
    kf = OfficialKF(np, scipy.linalg)
    xy, tlbr, conf = synthetic(T, n_low)
    xyah = np.c_[xy[:, :2], xy[:, 2] / xy[:, 3], xy[:, 3]]
    tracks = [kf.initiate(z) for z in xyah]
    dets = np.c_[tlbr, conf]
    hi = dets[conf > OFFICIAL["trackHigh"]]
    lo = dets[np.logical_and(conf > 0.1, conf < OFFICIAL["trackHigh"])]
    pred = [kf.predict(m, P) for m, P in tracks]
    pm = np.stack([m for m, _ in pred])
    tl = np.c_[pm[:, :2] - np.c_[pm[:, 2] * pm[:, 3], pm[:, 3]] / 2, pm[:, :2] + np.c_[pm[:, 2] * pm[:, 3], pm[:, 3]] / 2]
    d1 = 1 - iou_np(tl, hi[:, :4])
    d1f = 1 - (1 - d1) * hi[None, :, 4]                       # fuse_score (no MOT20)
    _, x1, _ = lap.lapjv(d1f, extend_cost=True, cost_limit=OFFICIAL["matchThresh"])
    m1 = np.array([[i, j] for i, j in enumerate(x1) if j >= 0])
    rest = [i for i, j in enumerate(x1) if j < 0]
    d2 = 1 - iou_np(tl[rest], lo[:, :4])
    _, x2, _ = lap.lapjv(d2, extend_cost=True, cost_limit=OFFICIAL["matchThresh2"])
    m2 = np.array([[i, j] for i, j in enumerate(x2) if j >= 0])
    upd = [kf.update(pred[i][0], pred[i][1], xyah[i]) for i in list(m1[:, 0]) + [rest[i] for i in m2[:, 0]]]
    return {"dets": list(dets.shape), "dets-high": list(hi.shape), "dets-low": list(lo.shape), "pred-mean": list(pm.shape),
            "pred-cov": [len(pred)] + list(pred[0][1].shape), "iou-1": list(d1.shape), "cost-1": list(d1f.shape), "matches-1": list(m1.shape),
            "iou-2": list(d2.shape), "cost-2": list(d2.shape), "matches-2": list(m2.shape), "track-mean-new": [len(upd), len(upd[0][0])],
            "lapjv_n": [d1.shape[0] + d1.shape[1], d2.shape[0] + d2.shape[1]]}


def sort_frame(T=50, n_low=10):
    """associate_detections_to_trackers de sort.py (portado) con lap.lapjv real: costo −IoU, extend_cost, sin cost_limit; solo las
    detecciones con score ≥ el umbral; parejas con IoU < 0.3 descartadas."""
    import lap
    xy, tlbr, conf = synthetic(T, n_low)
    dets = np.c_[tlbr, conf][conf >= 0.6]
    iou = iou_np(tlbr, dets[:, :4])                            # trackers predichos (velocidad 0) en su lugar
    _, x, y = lap.lapjv(-iou, extend_cost=True)
    m = np.array([[i, j] for i, j in enumerate(x) if j >= 0 and iou[i, j] >= SORT["iouThreshold"]])
    return {"dets-high": list(dets.shape), "iou-1": list(iou.shape), "cost-1": list(iou.shape), "matches-1": list(m.shape), "lapjv_n": max(iou.shape)}


# Valores del repo oficial (ifzhang/ByteTrack, rama main), transcritos:
#   tools/track.py: --track_thresh 0.6, --track_buffer 30, --match_thresh 0.9 (defaults; el comando del README para MOT17 no los cambia)
#   yolox/tracker/byte_tracker.py: inds_low = scores > 0.1; det_thresh = track_thresh + 0.1; 2.ª asociación thresh 0.5;
#   no confirmados thresh 0.7; buffer_size = int(frame_rate / 30.0 * track_buffer)
#   exps/example/mot/yolox_x_mix_det.py: num_classes 1, depth 1.33, width 1.25, test_size (800, 1440)
OFFICIAL = {"trackHigh": 0.6, "trackLow": 0.1, "newTrackThresh": 0.7, "matchThresh": 0.9, "matchThresh2": 0.5, "unconfirmedThresh": 0.7, "trackBuffer": 30}
# abewley/sort sort.py: Sort(max_age=1, min_hits=3, iou_threshold=0.3).
SORT = {"iouThreshold": 0.3, "maxAge": 1, "minHits": 3}


def tracking():
    off, ul, so = kalman_official(), kalman_ultralytics(), kalman_sort()
    frame = ultralytics_frame()
    ofr, sfr = official_frame(), sort_frame()
    y8 = json.load(open(os.path.join(EXPECTED, "yolov8l-640.json")))
    px_mot, fl_mot = yolox_count(1, 800, 1440)
    px_coco, fl_coco = yolox_count(80, 640, 640)
    T, D, low = 50, 50, 10
    high = D - low
    common_notes = [
        "Carga de referencia del calculador (knobs por defecto): nDet 50 (40 altas + 10 bajas, lowPct 20), nTracks 50, fps 30.",
        "MACs del tracker = productos de matrices del Kalman contados en las llamadas reales con sus formas (np.dot, multi_dot, solve, "
        "inv, cho_factor, cho_solve; factorizaciones con las fórmulas de libro). IoU y asignación no son MACs (el calculador las pone "
        "en 'otros' ≈).",
    ]
    yx = {"what": "YOLOX-X (num_classes 1) a 800×1440", "params": px_mot, "flops": fl_mot,
          "sanity_coco_640": {"params": px_coco, "flops": fl_coco, "readme": "YOLOX README: YOLOX-x 99.1 M parámetros, 281.9 GFLOPs a 640"}}
    # ---- bytetrack-mot17 (filtro oficial; detector YOLOX-X)
    k_off = T * off["predict"] + T * off["update"]
    write_expected("bytetrack-mot17", {
        "config_id": "bytetrack-mot17", "model": "bytetrack",
        "params_total": px_mot, "params_by_node": {"detector": px_mot, "tracker": 0},
        "flops_total": fl_mot + 2 * k_off, "flops_by_node": {"detector": fl_mot, "tracker": 2 * k_off},
        "metrics_checks": dict({"kalmanPredictMacs": off["predict"], "kalmanUpdateMacs": off["update"], "stateDim": off["F"][0], "measDim": off["H"][0],
                                "detectorParams": px_mot, "detectorMacs": fl_mot // 2, "assignN1": ofr["lapjv_n"][0], "assignN2": ofr["lapjv_n"][1]}, **OFFICIAL),
        "shapes": dict({"track-mean": [T, off["F"][0]], "track-cov": [T, off["F"][0], off["F"][0]], "frame": [800, 1440, 3]}, **{k: v for k, v in ofr.items() if k != "lapjv_n"}),
        "kalman": {"official": off}, "detector": yx, "frame_port": ofr,
        "source": {"lib": "numpy+scipy (filtro oficial transcrito) / torch (YOLOX-X transcrito)", "versions": versions(), "repo": "ifzhang/ByteTrack (main)"},
        "notes": common_notes + [
            "Kalman oficial (yolox/tracker/kalman_filter.py, transcrito): predict = 64 + 1,024; update = H·x 32 + H·P·Hᵀ 384 + P·Hᵀ 256 + "
            "Cholesky 10 + cho_solve con 8 lados 96 + y·Kᵀ 32 + K·S·Kᵀ 384.",
            "match_thresh = 0.9: default de tools/track.py (el comando del README para MOT17 no lo cambia). El paper rechaza IoU < 0.2 "
            "(costo 0.8) y tools/demo_track.py usa 0.8. El evaluador cambia track_buffer (14 / 25) y track_thresh en algunas secuencias.",
            "lapjv con cost_limit extiende la matriz a (filas + columnas) en cuadrado (lap 0.5.12 _lapjv.pyx: n = n_rows + n_cols); "
            "assignN1 = 50 + 40, assignN2 = 10 + 10 con el modelo de asociación del calculador.",
        ],
    })
    # ---- sort (filterpy con las matrices de sort.py; mismo detector)
    k_so = T * so["predict"] + high * so["update"]
    write_expected("sort", {
        "config_id": "sort", "model": "bytetrack",
        "params_total": px_mot, "params_by_node": {"detector": px_mot, "tracker": 0},
        "flops_total": fl_mot + 2 * k_so, "flops_by_node": {"detector": fl_mot, "tracker": 2 * k_so},
        "metrics_checks": dict({"kalmanPredictMacs": so["predict"], "kalmanUpdateMacs": so["update"], "stateDim": so["F"][0], "measDim": so["H"][0],
                                "assignN1": sfr["lapjv_n"], "updates": sfr["matches-1"][0]}, **SORT),
        "shapes": dict({"track-mean": [T, so["F"][0]], "track-cov": [T, so["F"][0], so["F"][0]], "pred-mean": [T, so["F"][0]], "pred-cov": [T, so["F"][0], so["F"][0]],
                        "track-mean-new": [sfr["matches-1"][0], so["F"][0]], "frame": [800, 1440, 3]}, **{k: v for k, v in sfr.items() if k != "lapjv_n"}),
        "kalman": {"filterpy": so}, "detector": yx, "frame_port": sfr,
        "source": {"lib": "filterpy 1.4.5 (KalmanFilter real) + matrices de abewley/sort", "versions": versions()},
        "notes": common_notes + [
            "SORT solo usa las detecciones altas (40): 40 updates; los 10 tracks restantes quedan sin pareja y, con max_age 1, se borran "
            "al frame siguiente.",
            "filterpy: predict = F·x 49 + F·P·Fᵀ 686; update = P·Hᵀ 196 + H·x 28 + H·PHᵀ 112 + inv(S) 62 + PHᵀ·S⁻¹ 112 + K·y 28 + K·H 196 + "
            "(I−KH)·P·(I−KH)ᵀ 686 + K·R·Kᵀ 308 (forma de Joseph).",
            "lapjv con extend_cost y sin cost_limit: cuadrada de lado máx(T, D) = 50.",
        ],
    })
    # ---- bytetrack-ultralytics (frame real del BYTETracker instalado; detector yolov8l-640)
    yml = frame["yaml"]
    k_ul = frame["kalman_macs"]
    write_expected("bytetrack-ultralytics", {
        "config_id": "bytetrack-ultralytics", "model": "bytetrack",
        "params_total": y8["params_total"], "params_by_node": {"detector": y8["params_total"], "tracker": 0},
        "flops_total": y8["flops_total"] + 2 * k_ul, "flops_by_node": {"detector": y8["flops_total"], "tracker": 2 * k_ul},
        "metrics_checks": {"kalmanPredictMacs": ul["predict"], "kalmanUpdateMacs": ul["update"], "stateDim": ul["F"][0], "measDim": ul["H"][0],
                           "trackHigh": yml["track_high_thresh"], "trackLow": yml["track_low_thresh"], "newTrackThresh": yml["new_track_thresh"],
                           "matchThresh": yml["match_thresh"], "trackBuffer": yml["track_buffer"], "framesLost": frame["max_frames_lost"],
                           "assignN1": frame["lapjv"][0]["n"], "assignN2": frame["lapjv"][1]["n"], "matchThresh2": frame["lapjv"][1]["cost_limit"],
                           "trackerMacs": k_ul},
        "shapes": {"frame": [640, 640, 3], "pred-mean": [T, 8], "pred-cov": [T, 8, 8], "iou-1": frame["lapjv"][0]["shape"], "iou-2": frame["lapjv"][1]["shape"],
                   "cost-1": frame["lapjv"][0]["shape"], "cost-2": frame["lapjv"][1]["shape"], "track-mean-new": [T, 8],
                   "matches-1": [frame["lapjv"][0]["matches"], 2], "matches-2": [frame["lapjv"][1]["matches"], 2]},
        "frame_run": frame, "kalman": {"ultralytics": ul},
        "source": {"lib": "ultralytics 8.4.174 (BYTETracker y KalmanFilterXYAH reales) + lap 0.5.12", "versions": versions(),
                   "detector": "crosscheck/expected/yolov8l-640.json (fase 4)"},
        "notes": common_notes + [
            "Frame real: 50 tracks confirmados en el frame 1; en el frame 2, 40 detecciones altas (0.9) en el mismo lugar y 10 bajas (0.15) "
            "sobre los otros 10 tracks. multi_predict de 50 tracks = 50 × 1,088 MACs; 50 updates (40 en la 1.ª asociación con fuse_score y "
            "10 en la 2.ª, umbral 0.5) × 526 MACs.",
            "lapjv: 1.ª llamada 50×40 con cost_limit 0.8 → cuadrada de 90; 2.ª 10×10 con cost_limit 0.5 → 20. Los no confirmados (vacío) no "
            "llaman a lapjv.",
            "KalmanFilterXYAH 8.4: project por slicing (sin H·P·Hᵀ), K con np.linalg.solve(S, P[:, :4]ᵀ): update = LU 14 + 8 lados 96 + "
            "y·Kᵀ 32 + K·S·Kᵀ 384 = 526.",
        ],
    })


# ================================================================== profundidad (HF, meta)
DA_BACKBONE = {"architectures": ["Dinov2Model"], "image_size": 518, "model_type": "dinov2", "patch_size": 14, "reshape_hidden_states": False}
DEPTH = {
    "depth-anything-v2-small": {"kind": "da", "hf": "depth-anything/Depth-Anything-V2-Small-hf",
                                "cfg": {"backbone_config": dict(DA_BACKBONE, hidden_size=384, num_attention_heads=6, out_features=["stage3", "stage6", "stage9", "stage12"], out_indices=[3, 6, 9, 12]),
                                        "fusion_hidden_size": 64, "head_hidden_size": 32, "head_in_index": -1, "neck_hidden_sizes": [48, 96, 192, 384], "patch_size": 14,
                                        "reassemble_factors": [4, 2, 1, 0.5], "reassemble_hidden_size": 384}},
    "depth-anything-v2-base": {"kind": "da", "hf": "depth-anything/Depth-Anything-V2-Base-hf",
                               "cfg": {"backbone_config": dict(DA_BACKBONE, hidden_size=768, num_attention_heads=12, out_features=["stage3", "stage6", "stage9", "stage12"], out_indices=[3, 6, 9, 12]),
                                       "fusion_hidden_size": 128, "head_hidden_size": 32, "head_in_index": -1, "neck_hidden_sizes": [96, 192, 384, 768], "patch_size": 14,
                                       "reassemble_factors": [4, 2, 1, 0.5], "reassemble_hidden_size": 768}},
    "depth-anything-v2-large": {"kind": "da", "hf": "depth-anything/Depth-Anything-V2-Large-hf",
                                "cfg": {"backbone_config": dict(DA_BACKBONE, hidden_size=1024, num_attention_heads=16, num_hidden_layers=24, out_features=["stage5", "stage12", "stage18", "stage24"], out_indices=[5, 12, 18, 24]),
                                        "fusion_hidden_size": 256, "head_hidden_size": 32, "head_in_index": -1, "neck_hidden_sizes": [256, 512, 1024, 1024], "patch_size": 14,
                                        "reassemble_factors": [4, 2, 1, 0.5], "reassemble_hidden_size": 1024}},
    "dpt-large": {"kind": "dpt", "hf": "Intel/dpt-large",
                  "cfg": {"backbone_out_indices": [5, 11, 17, 23], "fusion_hidden_size": 256, "head_in_index": -1, "hidden_act": "gelu", "hidden_size": 1024, "image_size": 384,
                          "intermediate_size": 4096, "layer_norm_eps": 1e-12, "neck_hidden_sizes": [256, 512, 1024, 1024], "num_attention_heads": 16, "num_channels": 3,
                          "num_hidden_layers": 24, "patch_size": 16, "qkv_bias": True, "readout_type": "project", "reassemble_factors": [4, 2, 1, 0.5],
                          "use_auxiliary_head": True, "use_batch_norm_in_fusion_residual": False}},
}


def depth_build(cid):
    from transformers import DepthAnythingConfig, DepthAnythingForDepthEstimation, DPTConfig, DPTForDepthEstimation
    spec = DEPTH[cid]
    if spec["kind"] == "da":
        cfg = DepthAnythingConfig(**spec["cfg"])
        cls, ctor = DepthAnythingForDepthEstimation, "DepthAnythingForDepthEstimation._from_config(DepthAnythingConfig(**config.json), attn_implementation='eager')"
    else:
        cfg = DPTConfig(**spec["cfg"])
        cls, ctor = DPTForDepthEstimation, "DPTForDepthEstimation._from_config(DPTConfig(**config.json), attn_implementation='eager')"
    with torch.device("meta"):
        model = cls._from_config(cfg, attn_implementation="eager").eval().requires_grad_(False)
    return model, cfg, ctor


class MultiRecorder:
    """Formas de salida de módulos por nombre (todas las llamadas: la LayerNorm del backbone de DA corre 4 veces)."""

    def __init__(self, model, names):
        self.raw, self.h = {}, []
        mods = dict(model.named_modules())
        for n in names:
            def hook(_m, _i, out, n=n):
                t = out.to_tuple()[0] if hasattr(out, "to_tuple") else (out[0] if isinstance(out, (tuple, list)) else out)
                self.raw.setdefault(n, []).append(list(t.shape))
            self.h.append(mods[n].register_forward_hook(hook))

    def remove(self):
        for x in self.h:
            x.remove()


def grid(s):
    assert s[0] == 1
    return [s[2], s[3], s[1]]


def seq(s):
    assert s[0] == 1
    return s[1:]


def by_module(counts, name):
    return int(sum(counts.get(name, {}).values()))


def depth_forward(model, kind, res):
    root = "backbone" if kind == "da" else "dpt"
    head = ["head.conv1", "head.conv2", "head.conv3"] if kind == "da" else ["head.head.0", "head.head.2", "head.head.4"]
    names = [f"{root}.embeddings.patch_embeddings.projection", f"{root}.embeddings"] + [f"neck.reassemble_stage.layers.{i}.projection" for i in range(4)] + \
        [f"neck.reassemble_stage.layers.{i}.resize" for i in range(4)] + [f"neck.convs.{i}" for i in range(4)] + \
        [f"neck.fusion_stage.layers.{i}" for i in range(4)] + [f"neck.fusion_stage.layers.{i}.residual_layer2" for i in range(4)] + \
        [f"neck.fusion_stage.layers.{i}.residual_layer1" for i in range(1, 4)] + head
    if kind == "da":
        names.append("backbone.layernorm")
    else:
        names += [f"neck.reassemble_stage.readout_projects.{i}" for i in range(4)]
    rec = MultiRecorder(model, names)
    f = FlopCounterMode(display=False, custom_mapping=CUSTOM)
    with f, torch.no_grad():
        out = model(pixel_values=torch.zeros(1, 3, res, res, device="meta"))
    rec.remove()
    R = {k: v for k, v in rec.raw.items()}
    sh = {"x-img": [res, res, 3], "x-patch-grid": grid(R[names[0]][0]), "x0": seq(R[names[1]][0])}
    for i in range(4):
        b = i + 1
        sh[f"proj-{b}"] = grid(R[f"neck.reassemble_stage.layers.{i}.projection"][0])
        sh[f"rs-{b}"] = grid(R[f"neck.reassemble_stage.layers.{i}.resize"][0])
        sh[f"feat-{b}"] = grid(R[f"neck.convs.{i}"][0])
        sh[f"fused-{4 - i}"] = grid(R[f"neck.fusion_stage.layers.{i}"][0])
        sh[f"fz-{4 - i}-r2"] = grid(R[f"neck.fusion_stage.layers.{i}.residual_layer2"][0])
        if i:
            sh[f"fz-{4 - i}-r1"] = grid(R[f"neck.fusion_stage.layers.{i}.residual_layer1"][0])
        if kind == "dpt":
            sh[f"tok-{b}"] = seq(R[f"neck.reassemble_stage.readout_projects.{i}"][0])
    if kind == "da":
        for i, s in enumerate(R["backbone.layernorm"]):
            sh[f"tap-n-{i + 1}"] = seq(s)
    sh["hd-c1"], sh["hd-c2"], sh["hd-c3"] = grid(R[head[0]][0]), grid(R[head[1]][0]), grid(R[head[2]][0])
    sh["depth"] = seq(list(out.predicted_depth.shape))
    counts = f.get_flop_counts()
    cls = type(model).__name__
    m = lambda n: by_module(counts, f"{cls}.{n}")
    fl = {"patch-embed+cls+pos-embed+add-pos+encoder+taps": m(root),
          "reassemble": m("neck.reassemble_stage") + sum(m(f"neck.convs.{i}") for i in range(4)),
          "fusion": m("neck.fusion_stage"), "head": m("head")}
    total = int(f.get_total_flops())
    assert sum(fl.values()) == total, (fl, total)
    return sh, fl, total


def depth(cid):
    spec = DEPTH[cid]
    kind = spec["kind"]
    model, cfg, ctor = depth_build(cid)
    res = 518 if kind == "da" else 384
    sh, fl, total = depth_forward(model, kind, res)
    root = model.backbone if kind == "da" else model.dpt
    emb = root.embeddings
    pbn = {
        "patch-embed": n_params(emb.patch_embeddings), "cls": int(emb.cls_token.numel()), "pos-embed": int(emb.position_embeddings.numel()),
        "encoder": n_params(root.encoder), "reassemble": n_params(model.neck.reassemble_stage) + n_params(model.neck.convs),
        "fusion": n_params(model.neck.fusion_stage), "head": n_params(model.head),
        "idle": int(emb.mask_token.numel()) if kind == "da" else n_params(root.layernorm),
    }
    if kind == "da":
        pbn["taps"] = n_params(root.layernorm)
    total_p = n_params(model)
    assert sum(pbn.values()) == total_p, (pbn, total_p)
    data = {
        "config_id": cid, "model": "depth", "params_total": total_p, "params_by_node": pbn,
        "params_by_path": {"fusion>fusion-4>rcu1": n_params(model.neck.fusion_stage.layers[0].residual_layer1)},
        "params_by_module": {n: n_params(c) for n, c in model.named_children()},
        "shapes": sh, "flops_total": total, "flops_by_node": fl,
        "source": {"lib": "transformers", "ctor": ctor, "hf_config": spec["hf"] + " (config.json copiada en crosscheck/perception.py)", "versions": versions()},
        "notes": [
            "Construido en meta desde la config.json del checkpoint (sin pesos), atención eager. FlopCounterMode = 2 × MACs de convs, "
            "conv transpuestas, matmuls y bmm de la atención; las interpolaciones bilineales y la de la posición no cuentan.",
            "params_by_path fusion>fusion-4>rcu1: la RCU 1 de la primera fusión existe pero el forward no la usa (no hay entrada "
            "residual): el calculador la cuenta como idle_params.",
        ] + (["Depth Anything: la LayerNorm final de DINOv2 se aplica a CADA una de las 4 salidas intermedias (Dinov2Backbone, "
              "apply_layernorm); el mask_token (iBOT) no se usa en inferencia; el CLS se descarta antes del reassemble."] if kind == "da" else
             ["DPT-Large: readout 'project' (concatena el CLS a cada token → Linear 2048 → 1024 + GELU); la LayerNorm final de DPTModel "
              "se aplica a la última capa pero el neck usa las salidas intermedias (hidden_states 6, 12, 18 y 24) sin ella."]),
    }
    oc_res = 364 if kind == "da" else 512
    sh2, fl2, total2 = depth_forward(model, kind, oc_res)
    data["override_checks"] = [{"calc_overrides": {"res": oc_res}, "params_total": total_p, "flops_total": total2,
                                "shapes": {k: sh2[k] for k in ("x-patch-grid", "rs-1", "rs-4", "fused-1", "depth")},
                                "note": "otra resolución: la tabla de posición guardada no cambia (se interpola en el forward)"}]
    write_expected(cid, data)


# ================================================================== PointNet (PyTorch transcrito del código oficial en TF)
class PMLP(nn.Module):
    """conv 1×1 (Conv1d k = 1) con sesgo + BatchNorm + ReLU, como tf_util.conv2d(..., bn=True)."""

    def __init__(s, cin, cout, bn=True, relu=True, dims=1):
        super().__init__()
        Conv, BN = (nn.Conv1d, nn.BatchNorm1d) if dims == 1 else (nn.Conv2d, nn.BatchNorm2d)
        s.conv = Conv(cin, cout, 1)
        s.bn = BN(cout) if bn else None
        s.relu = relu

    def forward(s, x):
        x = s.conv(x)
        if s.bn is not None:
            x = s.bn(x)
        return torch.relu(x) if s.relu else x


class FC(nn.Module):
    def __init__(s, cin, cout, bn=True, relu=True):
        super().__init__()
        s.fc = nn.Linear(cin, cout)
        s.bn = nn.BatchNorm1d(cout) if bn else None
        s.relu = relu

    def forward(s, x):
        x = s.fc(x)
        if s.bn is not None:
            x = s.bn(x)
        return torch.relu(x) if s.relu else x


class TNet(nn.Module):
    def __init__(s, cin, K):
        super().__init__()
        s.K = K
        s.tconv1, s.tconv2, s.tconv3 = PMLP(cin, 64), PMLP(64, 128), PMLP(128, 1024)
        s.tfc1, s.tfc2 = FC(1024, 512), FC(512, 256)
        s.transform = nn.Linear(256, K * K)
        nn.init.zeros_(s.transform.weight)
        with torch.no_grad():
            s.transform.bias.copy_(torch.eye(K).flatten())

    def forward(s, x):   # x: B×C×N
        g = s.tconv3(s.tconv2(s.tconv1(x))).max(dim=2).values
        return s.transform(s.tfc2(s.tfc1(g))).view(-1, s.K, s.K)


class PointNet(nn.Module):
    def __init__(s, task="cls", K=40, tnet=True):
        super().__init__()
        s.task, s.tnet = task, tnet
        if tnet:
            s.input_tnet, s.feature_tnet = TNet(3, 3), TNet(64, 64)
        s.conv1, s.conv2 = PMLP(3, 64), PMLP(64, 64)
        s.conv3, s.conv4, s.conv5 = PMLP(64, 64), PMLP(64, 128), PMLP(128, 1024)
        if task == "cls":
            s.fc1, s.fc2, s.fc3 = FC(1024, 512), FC(512, 256), FC(256, K, bn=False, relu=False)
            s.dp = nn.Dropout(0.3)   # keep_prob 0.7 (eval: identidad)
        else:
            s.conv6, s.conv7, s.conv8, s.conv9 = PMLP(1088, 512), PMLP(512, 256), PMLP(256, 128), PMLP(128, 128)
            s.conv10 = PMLP(128, K, bn=False, relu=False)

    def forward(s, pts):   # pts: B×N×3
        x = pts
        if s.tnet:
            x = torch.bmm(x, s.input_tnet(x.transpose(1, 2)))
        h = s.conv2(s.conv1(x.transpose(1, 2)))   # B×64×N
        if s.tnet:
            h = torch.bmm(h.transpose(1, 2), s.feature_tnet(h)).transpose(1, 2)
        h5 = s.conv5(s.conv4(s.conv3(h)))
        g, idx = h5.max(dim=2)
        s.critical = idx
        if s.task == "cls":
            return s.fc3(s.dp(s.fc2(s.dp(s.fc1(g)))))
        cat = torch.cat([h, g.unsqueeze(2).expand(-1, -1, h.shape[2])], 1)
        return s.conv10(s.conv9(s.conv8(s.conv7(s.conv6(cat))))).transpose(1, 2)


def fps(xyz, S):
    """Farthest point sampling (B = 1) con operaciones elementwise (sin matmuls: FlopCounterMode no las cuenta)."""
    N = xyz.shape[0]
    idx = torch.zeros(S, dtype=torch.long)
    dist = torch.full((N,), 1e10)
    far = 0
    for i in range(S):
        idx[i] = far
        d = ((xyz - xyz[far]) ** 2).sum(-1)
        dist = torch.minimum(dist, d)
        far = int(dist.argmax())
    return idx


def ball_query(xyz, ctr, r, k):
    d = ((ctr[:, None, :] - xyz[None, :, :]) ** 2).sum(-1)   # S×N
    out = torch.zeros(ctr.shape[0], k, dtype=torch.long)
    for i in range(ctr.shape[0]):
        nb = torch.nonzero(d[i] <= r * r).flatten()[:k]
        out[i, :] = nb[0]
        out[i, :len(nb)] = nb
    return out


class SA(nn.Module):
    def __init__(s, cin, mlp, S=None, r=None, k=None):
        super().__init__()
        s.S, s.r, s.k = S, r, k
        chans = [cin + 3] + mlp
        s.mlp1, s.mlp2, s.mlp3 = [PMLP(chans[i], chans[i + 1], dims=2) for i in range(3)]

    def forward(s, xyz, feats):   # xyz N×3, feats N×C o None
        if s.S is None:
            g = torch.cat([xyz, feats], -1)[None]                       # 1 × N × (3 + C): group_all
            new_xyz = torch.zeros(1, 3)
        else:
            new_xyz = xyz[fps(xyz, s.S)]
            idx = ball_query(xyz, new_xyz, s.r, s.k)
            gx = xyz[idx] - new_xyz[:, None, :]                          # S × k × 3
            g = gx if feats is None else torch.cat([gx, feats[idx]], -1)
        s.grouped = list(g.shape)
        h = g.permute(2, 0, 1)[None]                                     # 1 × C × S × k
        h = s.mlp3(s.mlp2(s.mlp1(h)))
        return new_xyz, h.max(dim=3).values[0].transpose(0, 1)          # S × C


class PointNet2(nn.Module):
    def __init__(s, K=40):
        super().__init__()
        s.sa1 = SA(0, [64, 64, 128], 512, 0.2, 32)
        s.sa2 = SA(128, [128, 128, 256], 128, 0.4, 64)
        s.sa3 = SA(256, [256, 512, 1024])
        s.fc1, s.fc2, s.fc3 = FC(1024, 512), FC(512, 256), FC(256, K, bn=False, relu=False)

    def forward(s, pts):   # 1 × N × 3
        x1, f1 = s.sa1(pts[0], None)
        x2, f2 = s.sa2(x1, f1)
        _, g = s.sa3(x2, f2)
        s.shapes = {"sa1-xyz": list(x1.shape), "sa1-out": list(f1.shape), "sa2-xyz": list(x2.shape), "sa2-out": list(f2.shape), "global": list(g.shape[1:]),
                    "sa1-grouped": s.sa1.grouped, "sa2-grouped": s.sa2.grouped, "sa3-grouped": s.sa3.grouped[1:]}
        return s.fc3(s.fc2(s.fc1(g)))


PN = {
    "pointnet-cls": dict(task="cls", K=40, tnet=True, N=1024),
    "pointnet-seg": dict(task="seg", K=50, tnet=True, N=2048),
    "pointnet-cls-no-tnet": dict(task="cls", K=40, tnet=False, N=1024),
    "pointnet2-ssg-cls": dict(task="cls", K=40, tnet=False, N=1024, pp=True),
}


def pointnet(cid):
    spec = PN[cid]
    torch.manual_seed(0)
    N = spec["N"]
    pp = spec.get("pp", False)
    model = (PointNet2(spec["K"]) if pp else PointNet(spec["task"], spec["K"], spec["tnet"])).eval()
    pts = torch.rand(1, N, 3) * 2 - 1
    hooked = {}
    if not pp:
        names = {"conv1": "h1", "conv2": "h2", "conv3": "h3", "conv4": "h4", "conv5": "h5"}
        names.update({"fc1": "f1", "fc2": "f2"} if spec["task"] == "cls" else {"conv6": "s6", "conv7": "s7", "conv8": "s8", "conv9": "s9"})
        if spec["tnet"]:
            names.update({"input_tnet.tconv1": "itn-h1", "input_tnet.tconv3": "itn-h3", "feature_tnet.tconv2": "ftn-h2", "feature_tnet.tfc2": "ftn-f2"})
        mods = dict(model.named_modules())
        for n, tid in names.items():
            def hk(_m, _i, o, tid=tid):
                hooked[tid] = list(o.shape[1:])[::-1] if o.dim() == 3 else list(o.shape[1:])
            mods[n].register_forward_hook(hk)
    f = FlopCounterMode(display=False)
    with f, torch.no_grad():
        out = model(pts)
    counts = f.get_flop_counts()
    total = int(f.get_total_flops())
    m = lambda n: by_module(counts, f"{type(model).__name__}.{n}")
    shapes = {"points": [N, 3]}
    if pp:
        shapes.update(model.shapes)
        shapes["logits"] = list(out.shape[1:])
        pbn = {"sa1": n_params(model.sa1), "sa2": n_params(model.sa2), "sa3": n_params(model.sa3), "head": n_params(model.fc1) + n_params(model.fc2) + n_params(model.fc3)}
        fl = {"sa1": m("sa1"), "sa2": m("sa2"), "sa3": m("sa3"), "head": m("fc1") + m("fc2") + m("fc3")}
    else:
        shapes["global"] = [1024]
        shapes.update(hooked)
        shapes["logits" if spec["task"] == "cls" else "point-logits"] = list(out.shape[1:]) if spec["task"] == "cls" else list(out.shape[1:])
        if spec["task"] == "seg":
            shapes["concat"] = [N, 1088]
        pbn = {"shared-mlp-1": n_params(model.conv1) + n_params(model.conv2), "shared-mlp-2": n_params(model.conv3) + n_params(model.conv4) + n_params(model.conv5)}
        fl = {"shared-mlp-1": m("conv1") + m("conv2"), "shared-mlp-2": m("conv3") + m("conv4") + m("conv5")}
        if spec["tnet"]:
            pbn["input-tnet"], pbn["feature-tnet"] = n_params(model.input_tnet), n_params(model.feature_tnet)
            # El bmm de aplicar cada transformación pertenece al nodo de su T-Net (calc: input-tnet › apply, feature-tnet › apply).
            bmm = int(counts.get("Global", {}).get(torch.ops.aten.bmm, 0))
            fl["input-tnet"] = m("input_tnet") + 2 * N * 3 * 3
            fl["feature-tnet"] = m("feature_tnet") + 2 * N * 64 * 64
            assert bmm == 2 * N * 9 + 2 * N * 64 * 64, bmm
            shapes["t-in"], shapes["t-feat"] = [3, 3], [64, 64]
        if spec["task"] == "cls":
            pbn["head"] = n_params(model.fc1) + n_params(model.fc2) + n_params(model.fc3)
            fl["head"] = m("fc1") + m("fc2") + m("fc3")
        else:
            pbn["seg-head"] = sum(n_params(getattr(model, f"conv{i}")) for i in range(6, 11))
            fl["seg-head"] = sum(m(f"conv{i}") for i in range(6, 11))
    total_p = n_params(model)
    assert sum(pbn.values()) == total_p, (pbn, total_p)
    assert sum(fl.values()) == total, (fl, total)
    data = {"config_id": cid, "model": "pointnet", "params_total": total_p, "params_by_node": pbn, "shapes": shapes,
            "flops_total": total, "flops_by_node": fl,
            "source": {"lib": "torch (transcrito de charlesq34/pointnet" + ("2" if pp else "") + ", TF)", "versions": versions()}}
    notes = ["Cada conv 1×1 / fc con sesgo + BatchNorm (β, γ); medias y varianzas móviles = buffers (no cuentan). BN y dropout en eval.",
             "FlopCounterMode cuenta conv1d / conv2d 1×1, linear y los bmm de aplicar las T-Nets; el max-pool, FPS y ball query no son MACs."]
    if not pp:
        # Invariancia a permutaciones y puntos críticos (pesos aleatorios, semilla 0).
        perm = torch.randperm(N)
        with torch.no_grad():
            o2 = model(pts[:, perm])
            crit = int(torch.unique(model.critical).numel())
            model(pts)
            crit = int(torch.unique(model.critical).numel())
        same = bool(torch.allclose(out[:, perm] if spec["task"] == "seg" else out, o2, atol=1e-5))
        data["permutation_check"] = {"same_output": same, "note": "mismo resultado con los puntos permutados" + (" (por punto, reordenado)" if spec["task"] == "seg" else "")}
        assert same
        data["range_checks"] = [{"what": "puntos críticos medidos (pesos aleatorios) ≤ min(N, 1024)", "metric": "criticalPointsMax", "calc_overrides": {}, "ref": crit, "min_ratio": 0.0, "max_ratio": 1.0}]
        notes.append(f"Puntos críticos (los que ganan algún canal del max-pool) con pesos aleatorios: {crit} de {N}; la cota es min(N, 1024).")
        if spec["tnet"]:
            data["tnet_init_identity"] = True
            notes.append("La salida de cada T-Net empieza en la identidad: transform = Linear(256, K²) con W = 0 y b = I (transform_nets.py).")
    data["notes"] = notes
    if cid == "pointnet-cls":
        model2 = PointNet("cls", 40, True).eval()
        f2 = FlopCounterMode(display=False)
        with f2, torch.no_grad():
            model2(torch.rand(1, 2048, 3))
        data["override_checks"] = [{"calc_overrides": {"N": 2048}, "params_total": total_p, "flops_total": int(f2.get_total_flops()), "shapes": {"h5": [2048, 1024]}}]
    write_expected(cid, data)


if __name__ == "__main__":
    print("▸ tracking (bytetrack-mot17, sort, bytetrack-ultralytics)", file=sys.stderr)
    tracking()
    for cid in DEPTH:
        print("▸", cid, file=sys.stderr)
        depth(cid)
    for cid in PN:
        print("▸", cid, file=sys.stderr)
        pointnet(cid)
