"""Paso 1 · Juntar señales.

Entra:  data/logs/fecha=*/part-0.parquet     una fila por request del gateway
        data/producto/publicaciones.parquet   la categoría que eligió quien vende
        data/producto/correcciones.parquet    las correcciones de moderación (0, 1 o más por request)
Sale:   data/pipeline/senales.parquet         una fila por request_id con: request_id, ts, cuenta_id,
        img_sha256_prefijo, foto_key, top1, top1_score, top2, margen, ts_publicacion, categoria_final,
        eleccion, titulo, categoria_corregida y ts_correccion (estas dos, nulas si nadie corrigió)
"""
from _comun import DATA, SAL, duck

con = duck()
con.execute(f"""
COPY (
  WITH logs AS (
    SELECT request_id, ts, cuenta_id, img_sha256_prefijo, foto_key,
           top_k[1].clase AS top1,
           top_k[1].score AS top1_score,
           top_k[2].clase AS top2,
           top_k[1].score - top_k[2].score AS margen
    FROM read_parquet('{DATA}/logs/*/*.parquet', hive_partitioning = true)
  ),
  ultima_correccion AS (   -- puede haber varias por request: cuenta solo la más reciente
    SELECT request_id, categoria_corregida, ts_correccion
    FROM read_parquet('{DATA}/producto/correcciones.parquet')
    QUALIFY row_number() OVER (PARTITION BY request_id ORDER BY ts_correccion DESC) = 1
  )
  SELECT l.*, p.ts_publicacion, p.categoria_final, p.eleccion, p.titulo,
         c.categoria_corregida, c.ts_correccion
  FROM logs l
  JOIN read_parquet('{DATA}/producto/publicaciones.parquet') p USING (request_id)
  LEFT JOIN ultima_correccion c USING (request_id)
) TO '{SAL}/senales.parquet' (FORMAT parquet)
""")

n_logs = con.execute(f"SELECT count(*) FROM read_parquet('{DATA}/logs/*/*.parquet')").fetchone()[0]
n_pub = con.execute(f"SELECT count(*) FROM '{DATA}/producto/publicaciones.parquet'").fetchone()[0]
n, unicos = con.execute(f"SELECT count(*), count(DISTINCT request_id) FROM '{SAL}/senales.parquet'").fetchone()
print(f"logs: {n_logs:,} · publicaciones: {n_pub:,} · señales: {n:,} ({unicos:,} request_id únicos)")
print(f"se unió el {n / n_pub:.1%} de las publicaciones")
