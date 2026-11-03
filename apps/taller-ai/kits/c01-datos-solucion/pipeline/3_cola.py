"""Paso 3 · Elegir qué etiquetar.

Entra:  data/pipeline/senales.parquet, config.yaml (cola.*, nuevas.*)
Sale:   data/pipeline/cola.parquet   request_id, foto_key, img_sha256_prefijo, motivo
          motivo = nueva        la categoría está en nuevas.clases (negocio la acaba de agregar)
                   desacuerdo   una persona eligió otra cosa que el top-1 del modelo
                   incertidumbre  top-1 bajo o margen chico
                   aleatoria    al azar de todo el tráfico: lo que hace que la cola se parezca a la realidad
"""
import numpy as np
import pandas as pd

from _comun import SAL, cfg

c = cfg()
k = c["cola"]
rng = np.random.default_rng(2026)

# DuckDB no garantiza el orden de las filas: ordenar antes de muestrear hace reproducible la cola.
s = pd.read_parquet(SAL / "senales.parquet").sort_values("request_id")
s = s[s.eleccion != "manual"]                    # el holdout no se toca
humano = s.categoria_corregida.fillna(s.categoria_final.where(s.eleccion == "busqueda"))

grupos = {
    "nueva": s.categoria_final.isin(c["nuevas"]["clases"]) | s.categoria_corregida.isin(c["nuevas"]["clases"]),
    "desacuerdo": humano.notna() & (humano != s.top1),
    "incertidumbre": (s.top1_score < k["umbral_top1"]) | (s.margen < k["umbral_margen"]),
}
cupo = {
    "nueva": round(k["tamano"] * k["frac_nuevas"]),
    "desacuerdo": round(k["tamano"] * k["frac_desacuerdo"]),
    "aleatoria": round(k["tamano"] * k["frac_aleatoria"]),
}
cupo["incertidumbre"] = k["tamano"] - sum(cupo.values())

# La aleatoria primero, de todo el tráfico: si se sorteara al final, ya sin los casos difíciles, saldría optimista.
elegidos: dict[str, str] = dict.fromkeys(rng.choice(s.request_id.to_numpy(), cupo["aleatoria"], replace=False), "aleatoria")
for motivo in ["nueva", "desacuerdo", "incertidumbre"]:
    candidatos = s.request_id[grupos[motivo] & ~s.request_id.isin(list(elegidos))]
    n = min(cupo[motivo], len(candidatos))
    if motivo == "incertidumbre":                # lo que no alcanzó en los otros cupos se va a incertidumbre
        n = min(len(candidatos), k["tamano"] - len(elegidos))
    elegidos |= dict.fromkeys(rng.choice(candidatos.to_numpy(), n, replace=False), motivo)

cola = s[s.request_id.isin(elegidos)][["request_id", "foto_key", "img_sha256_prefijo"]].copy()
cola["motivo"] = cola.request_id.map(elegidos)
cola.to_parquet(SAL / "cola.parquet", index=False)
print(cola.motivo.value_counts().to_string())
print(f"total: {len(cola)}")
