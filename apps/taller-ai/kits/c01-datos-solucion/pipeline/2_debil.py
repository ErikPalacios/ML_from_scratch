"""Paso 2 · Filtrar el label débil.

Entra:  data/pipeline/senales.parquet, config.yaml (corte, debil.*)
Sale:   data/pipeline/labels_debiles.parquet   request_id, img_sha256_prefijo, label, fuente
          fuente = correccion        moderación la corrigió (la última corrección manda)
                   busqueda          quien vende buscó la categoría en vez de aceptar la sugerencia
                   sugerencia_madura aceptó una sugerencia y nadie la corrigió en `dias_maduracion` días
        data/pipeline/holdout.parquet          request_id, label: las cuentas sin sugerencias (eleccion = manual).
          Son el termómetro del feedback loop: nunca se mezclan con el entrenamiento.
"""
from _comun import SAL, cfg, duck

c = cfg()
corte = c["corte"]
dias = c["debil"]["dias_maduracion"]
desde = c["debil"]["excluir_sugerencias_desde"]
excluir = f"AND ts_publicacion < TIMESTAMPTZ '{desde}'" if desde else ""

con = duck()
con.execute(f"""
COPY (
  SELECT request_id, img_sha256_prefijo,
         coalesce(categoria_corregida, categoria_final) AS label,
         CASE WHEN categoria_corregida IS NOT NULL THEN 'correccion'
              WHEN eleccion = 'busqueda' THEN 'busqueda'
              ELSE 'sugerencia_madura' END AS fuente
  FROM '{SAL}/senales.parquet'
  WHERE eleccion <> 'manual'
    AND (categoria_corregida IS NOT NULL
         OR eleccion = 'busqueda'
         OR (eleccion LIKE 'sugerencia_%'
             AND ts_publicacion <= TIMESTAMPTZ '{corte}' - INTERVAL {dias} DAY
             {excluir}))
) TO '{SAL}/labels_debiles.parquet' (FORMAT parquet)
""")
con.execute(f"""
COPY (
  SELECT request_id, img_sha256_prefijo, coalesce(categoria_corregida, categoria_final) AS label
  FROM '{SAL}/senales.parquet' WHERE eleccion = 'manual'
) TO '{SAL}/holdout.parquet' (FORMAT parquet)
""")

print(con.sql(f"SELECT fuente, count(*) AS n FROM '{SAL}/labels_debiles.parquet' GROUP BY ALL ORDER BY n DESC"))
print("holdout:", con.execute(f"SELECT count(*) FROM '{SAL}/holdout.parquet'").fetchone()[0], "labels")
