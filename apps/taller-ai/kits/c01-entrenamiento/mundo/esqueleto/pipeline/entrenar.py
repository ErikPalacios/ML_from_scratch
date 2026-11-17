"""Pasos 3 a 5 · El job de entrenamiento: receta + snapshot + champion → checkpoint candidato con su corrida en MLflow.

Uso:    python pipeline/entrenar.py --snapshot ds-2026-09-01 --champion 1 --corrida <id> [--semilla N]
Entra:  receta.yaml                         la receta (arranque, épocas, batch, lr, semilla, ckpt_cada_pasos…)
        el snapshot, con cargar() de pipeline/datos.py
        classifier versión <N> en MLflow    los pesos y el labels.json del champion: una VERSIÓN (un número), nunca el alias
Sale:   s3://ml-ckpt/c01/<snapshot>/<corrida>/ultimo.pt   el estado completo, cada ckpt_cada_pasos pasos
        una corrida en MLflow, experimento c01-entrenamiento, con run_name = corrida y el tag corrida:
          parámetros: los de la receta (con la semilla que se usó), snapshot, champion_version y corrida
          métricas por época (step = época, desde 0): train_loss, val_loss, val_top1
          tags: corrida, snapshot, rows_sha256, commit, arbol_limpio, entorno_sha256, preprocess_sha256, pillow,
                champion_version, receta_sha256, reanudado_desde_paso y, al final, pesos_sha256
          artefactos: modelo/pesos.pt (el state_dict) y modelo/labels.json
Reglas: solo desde un commit con el árbol limpio (pipeline/, receta.yaml, pipeline.yaml).
        Antes de gastar cómputo comprueba MLflow, el champion y los datos: si algo falta, se detiene en segundos.
        El labels.json del champion tiene que ser igual a entrada/categorias.json; si no, se detiene.
        Semilla y algoritmos deterministas: mismos ingredientes = mismos pesos, bit por bit (en CPU).
        Si ya hay un checkpoint de esta corrida, reanuda desde él, en la misma corrida de MLflow, solo si es de los
        mismos ingredientes (snapshot, receta, semilla, champion y commit); si no, se detiene.
"""
from _comun import (CKPT, CLASES, EXPERIMENTO, MODELO, RAIZ, git, huella_entorno, huella_pesos, mlflow_cliente,  # noqa: F401
                    receta, s3, sha256)

# Tu código va aquí. Respeta el contrato de arriba: verificar.py revisa exactamente eso.
raise NotImplementedError("Pasos 3 a 5: todavía no está escrito")
