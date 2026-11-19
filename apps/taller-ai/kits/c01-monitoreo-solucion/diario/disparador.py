"""El disparador: de los resúmenes diarios a tickets con diagnóstico (solución de referencia). No reentrena nada:
abre tickets, y una persona decide.

    python diario/disparador.py                          # evalúa ayer (mundo.comun.ayer()), después de monitoreo.py
    python diario/disparador.py --dia 2026-11-18
    python diario/disparador.py --desde 2026-10-28 --hasta 2026-11-18   # cada día, como si hubiera corrido diario
    python diario/disparador.py … --seco                 # imprime lo que abriría, sin abrir nada

Contrato:
- Lee los resúmenes de s3://ml-datos/monitoreo/diario/dt=AAAA-MM-DD/resumen.json (los de tu monitoreo.py) y el
  historial de despliegues de s3://ml-datos/plataforma/despliegues.json.
- Dos reglas, evaluadas para el día D:
  · drift: el PSI pasa de 0.2 tres días seguidos (D, D-1 y D-2). El episodio empieza el primer día de la racha.
  · aceptación: para cada slice del resumen (total, source=…, categoria=…), la semana D-6..D contra D-13..D-7
    (sumando n y aceptadas de cada día): si las dos semanas tienen n ≥ 5,000 y la aceptación cayó más de 3 puntos.
    El episodio empieza el primer día, contando hacia atrás desde D, desde el que la regla se cumple todos los días.
    Si cae más de 3 puntos pero alguna semana tiene n < 5,000, no abre ticket: lo imprime como «al reporte».
    Un ticket por causa, no por síntoma: mientras la regla se cumple para algún source=, las caídas de categoria= van
    al reporte como «arrastradas por source=…» (mobile es más de la mitad de cada categoría: si mobile cae 4 puntos,
    cada categoría cae ≈ 2.4 y, con el ruido, alguna pasa de 3). Es la misma idea que la inhibición de Alertmanager.
- Un ticket por episodio: id = «drift-psi-<inicio>» o «aceptacion-<slice>-<inicio>». Mandar el mismo id otra vez no
  duplica (el buscapersonas contesta 409): correrlo todos los días es seguro.
- Cada ticket lleva el diagnóstico de la lección, para quien lo recibe:
  · despliegues: los del historial entre 3 días antes del inicio y el inicio (¿un deploy propio?).
  · fuentes: el cambio semana contra semana de la aceptación, la baja confianza y la mediana de bytes de cada source,
    y la mezcla de versiones de app (¿un solo source? ¿una app nueva?).
  · slice: para drift, la categoría que más aporta al PSI («categoria=<la de mayor término>»); para aceptación, el slice.
  · accion_sugerida, con la tabla de la lección: deploy cerca → rollback; un solo source movido → avisar-dueno (con el
    dueño de mundo/plataforma.yaml); drift con la aceptación de esa misma categoría cayendo > 3 puntos, o aceptación
    de una categoria= con el PSI > 0.2 → reentrenar (tanda extra del slice); drift sin labels peores → etiquetar.
- Abre cada ticket con POST http://localhost:8966/api/tickets (JSON con id, titulo, regla, slice, inicio, dia,
  evidencia, diagnostico, accion_sugerida). Imprime qué abrió, qué ya estaba y qué fue al reporte.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from mundo.comun import BUCKET, BUSCAPERSONAS, MONITOREO, ayer as mundo_ayer, http, plataforma, s3  # noqa: E402

PSI_UMBRAL, PSI_DIAS = 0.2, 3
CAIDA, N_MIN, Z = 0.03, 5_000, 1.96
DESPLIEGUES = "plataforma/despliegues.json"


class Resumenes:
    def __init__(self, c):
        self.c, self.cache = c, {}

    def __call__(self, d: date) -> dict | None:
        if d not in self.cache:
            try:
                o = self.c.get_object(Bucket=BUCKET, Key=f"{MONITOREO}dt={d}/resumen.json")
                self.cache[d] = json.loads(o["Body"].read())
            except Exception:  # noqa: BLE001 — un día sin resumen
                self.cache[d] = None
        return self.cache[d]


def semana(res, fin: date, slice_: str) -> tuple[int, int] | None:
    n = k = 0
    for i in range(7):
        r = res(fin - timedelta(days=i))
        if r is None:
            return None
        x = r["aceptacion"].get(slice_, {"n": 0, "aceptadas": 0})
        n, k = n + x["n"], k + x["aceptadas"]
    return n, k


def caida(res, d: date, slice_: str) -> dict | None:
    """La comparación semana contra semana de un slice que termina en d (None si faltan días)."""
    act, ant = semana(res, d, slice_), semana(res, d - timedelta(days=7), slice_)
    if not act or not ant or not act[0] or not ant[0]:
        return None
    a, b = act[1] / act[0], ant[1] / ant[0]
    margen = Z * math.sqrt(a * (1 - a) / act[0] + b * (1 - b) / ant[0])
    return {"slice": slice_, "n": act[0], "n_antes": ant[0], "aceptacion": round(a, 4), "antes": round(b, 4),
            "cambio_pts": round((a - b) * 100, 2), "margen_pts": round(margen * 100, 2),
            "cae": b - a > CAIDA, "n_ok": min(act[0], ant[0]) >= N_MIN}


def promedio_semana(res, fin: date, campo: str, clave: str) -> float | None:
    xs = [r[campo].get(clave) for i in range(7) if (r := res(fin - timedelta(days=i))) and r[campo].get(clave) is not None]
    return sum(xs) / len(xs) if xs else None


def fuentes(res, d: date) -> dict:
    out = {}
    for s in ("mobile", "web", "internal"):
        x = caida(res, d, f"source={s}")
        bc = (promedio_semana(res, d, "baja_confianza", s), promedio_semana(res, d - timedelta(days=7), "baja_confianza", s))
        by = (promedio_semana(res, d, "bytes_mediana", s), promedio_semana(res, d - timedelta(days=7), "bytes_mediana", s))
        out[s] = {"aceptacion_cambio_pts": x["cambio_pts"] if x else None,
                  "baja_confianza": [round(v, 4) if v is not None else None for v in bc],
                  "bytes_mediana": [round(v) if v is not None else None for v in by]}
    apps_act, apps_ant = {}, {}
    for i in range(7):
        for dd, acc in ((d - timedelta(days=i), apps_act), (d - timedelta(days=7 + i), apps_ant)):
            if r := res(dd):
                for k, v in r["apps"].items():
                    acc[k] = acc.get(k, 0) + v
    ta, tb = sum(apps_act.values()) or 1, sum(apps_ant.values()) or 1
    out["apps"] = {k: [round(apps_act.get(k, 0) / ta, 3), round(apps_ant.get(k, 0) / tb, 3)]
                   for k in sorted(set(apps_act) | set(apps_ant))}
    return out


def movidos(f: dict) -> list[str]:
    """Los source que se movieron: aceptación más de 3 puntos abajo o baja confianza 1.3× arriba."""
    out = []
    for s in ("mobile", "web", "internal"):
        x = f[s]
        bc = x["baja_confianza"]
        sube = bc[0] is not None and bc[1] and bc[0] > 1.3 * bc[1]
        cae = x["aceptacion_cambio_pts"] is not None and x["aceptacion_cambio_pts"] < -CAIDA * 100
        if sube or cae:
            out.append(s)
    return out


def despliegues_cerca(desp: list, inicio: date) -> list:
    a = datetime.combine(inicio - timedelta(days=3), datetime.min.time(), timezone.utc)
    b = datetime.combine(inicio + timedelta(days=1), datetime.min.time(), timezone.utc)
    return [x for x in desp if a <= datetime.fromisoformat(x["cuando"]) < b]


def drift(res, d: date) -> tuple[bool, date]:
    racha, x = 0, d
    while (r := res(x)) and r["psi"] is not None and r["psi"] > PSI_UMBRAL:
        racha, x = racha + 1, x - timedelta(days=1)
    return racha >= PSI_DIAS, x + timedelta(days=1)


def inicio_caida(res, d: date, slice_: str) -> date:
    x = d
    while (c := caida(res, x - timedelta(days=1), slice_)) and c["cae"] and c["n_ok"]:
        x -= timedelta(days=1)
    return x


def evaluar(d: date, res, desp: list) -> tuple[list[dict], list[dict]]:
    r = res(d)
    if r is None:
        raise SystemExit(f"✗ no hay resumen del {d}: corre antes python diario/monitoreo.py --dia {d}")
    duenos = plataforma()["dueños"]
    tickets, reporte = [], []
    caidas = {s: c for s in r["aceptacion"] if (c := caida(res, d, s))}
    hay_drift, ini_drift = drift(res, d)

    def accion(ini: date, slice_: str, f: dict, labels_peores: bool) -> dict:
        cerca = despliegues_cerca(desp, ini)
        mov = movidos(f)
        if cerca:
            return {"accion": "rollback", "por": f"un deploy propio cerca del inicio: {cerca[-1]['que']}"}
        if len(mov) == 1:
            return {"accion": "avisar-dueno", "dueno": duenos.get(f"source={mov[0]}"),
                    "por": f"solo se movió source={mov[0]}; las otras fuentes siguen igual"}
        if labels_peores:
            return {"accion": "reentrenar", "slice": slice_,
                    "por": f"el PSI está alto y la aceptación de {slice_} cae: el mundo cambió y el modelo acierta menos ahí"}
        return {"accion": "etiquetar", "slice": slice_, "por": "cambió la mezcla, pero los labels no dicen que esté peor"}

    if hay_drift:
        top = max(r["psi_por_categoria"].items(), key=lambda kv: kv[1])[0]
        sl = f"categoria={top}"
        f = fuentes(res, d)
        peor = caidas.get(sl)
        tickets.append({"id": f"drift-psi-{ini_drift}", "regla": "drift", "slice": sl, "inicio": str(ini_drift), "dia": str(d),
                        "titulo": f"PSI > {PSI_UMBRAL} {(d - ini_drift).days + 1} días seguidos (hoy {r['psi']:.3f}); lo mueve {sl}",
                        "evidencia": {"psi": {str(ini_drift + timedelta(days=i)): res(ini_drift + timedelta(days=i))["psi"]
                                              for i in range((d - ini_drift).days + 1)},
                                      "psi_por_categoria": r["psi_por_categoria"], "aceptacion_slice": peor},
                        "diagnostico": {"despliegues": despliegues_cerca(desp, ini_drift), "fuentes": f},
                        "accion_sugerida": accion(ini_drift, sl, f, bool(peor and peor["cae"] and peor["n_ok"]))})
    fuentes_caidas = [s for s, c in caidas.items() if s.startswith("source=") and c["cae"] and c["n_ok"]]
    for s, c in sorted(caidas.items()):
        if not c["cae"]:
            continue
        if not c["n_ok"]:
            reporte.append(c)
            continue
        if s.startswith("categoria=") and fuentes_caidas:
            reporte.append({**c, "arrastrada_por": fuentes_caidas})
            continue
        ini = inicio_caida(res, d, s)
        f = fuentes(res, d)
        tickets.append({"id": f"aceptacion-{s}-{ini}", "regla": "aceptacion", "slice": s, "inicio": str(ini), "dia": str(d),
                        "titulo": f"La aceptación de {s} cayó {-c['cambio_pts']:.1f} puntos semana contra semana "
                                  f"({c['antes']:.1%} → {c['aceptacion']:.1%}, n {c['n']:,})",
                        "evidencia": c, "diagnostico": {"despliegues": despliegues_cerca(desp, ini), "fuentes": f},
                        "accion_sugerida": accion(ini, s, f, s.startswith("categoria=") and r["psi"] > PSI_UMBRAL)})
    return tickets, reporte


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dia")
    ap.add_argument("--desde")
    ap.add_argument("--hasta")
    ap.add_argument("--seco", action="store_true")
    a = ap.parse_args()
    ayer = mundo_ayer()
    if a.desde:
        d0, d1 = date.fromisoformat(a.desde), date.fromisoformat(a.hasta) if a.hasta else ayer
    else:
        d0 = d1 = date.fromisoformat(a.dia) if a.dia else ayer
    c = s3()
    res = Resumenes(c)
    desp = json.loads(c.get_object(Bucket=BUCKET, Key=DESPLIEGUES)["Body"].read())
    d = d0
    while d <= d1:
        tickets, reporte = evaluar(d, res, desp)
        for t in tickets:
            if a.seco:
                print(f"{d}  abriría {t['id']}: {t['titulo']} → {t['accion_sugerida']['accion']}")
                continue
            st, b, _ = http(f"{BUSCAPERSONAS}/api/tickets", "POST", json.dumps(t, ensure_ascii=False).encode(),
                            {"Content-Type": "application/json"})
            if st == 201:
                print(f"{d}  🎫 abrí {t['id']}: {t['titulo']} → sugiero {t['accion_sugerida']['accion']}")
            elif st == 409:
                print(f"{d}  ya estaba abierto {t['id']}")
            else:
                raise SystemExit(f"✗ el buscapersonas contestó {st} al abrir {t['id']}: {b[:200]!r}")
        for x in reporte:
            por = (f"arrastrada por {', '.join(x['arrastrada_por'])}" if x.get("arrastrada_por")
                   else f"n chico: {x['n']:,} / {x['n_antes']:,} < {N_MIN:,}")
            print(f"{d}  al reporte: {x['slice']} cambió {x['cambio_pts']:+.1f} pts ({por})")
        if not tickets and not reporte:
            print(f"{d}  nada que abrir")
        d += timedelta(days=1)


if __name__ == "__main__":
    main()
