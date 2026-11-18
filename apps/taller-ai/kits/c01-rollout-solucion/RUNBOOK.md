# Runbook de rollback · classifier

Para la persona de guardia, a las 3 de la mañana, que no hizo el cambio. Primero revertir, después investigar.
Cada terminal: `export KUBECONFIG=$PWD/.kube/config` en la carpeta del repositorio de despliegue.

## 1. Detectar

Lo hace la máquina: el análisis del canary (`canary-vs-estable`) o una alerta. Mira qué falló y en qué fase va:

```bash
kubectl argo rollouts -n classifier get rollout gateway
kubectl -n classifier get analysisrun
python3 mundo/modelos.py ver
```

## 2. Revertir sin diagnosticar (meta: ≤ 5 min)

- **En el canary (5 % o 25 %):** ya se revirtió solo (`Degraded`, `RolloutAborted`). Falta Git: revierte el commit
  que cambió el template, `git revert --no-edit <commit>` y `kubectl apply -k k8s/`. No hay prisa: el tráfico ya volvió.
- **En el bake (la anterior sigue viva):** `git revert --no-edit <commit de la release nueva>`,
  `kubectl apply -k k8s/` (con `rollbackWindow` va directo al 100 % de la anterior, en segundos) y regresa el alias a
  la que quedó de estable, con su run y su digest: `python3 ci/promover.py --esperar 0`
  (`python3 mundo/modelos.py alias champion <anterior>` movería solo el alias, sin etiquetas).
- **Pasado el bake:** lo mismo, más revertir el commit que quitó el Triton anterior (tarda en cargar el engine).
- Nunca `kubectl argo rollouts undo` ni cambios a mano en el clúster: Git manda.

## 3. Confirmar (15 a 30 min)

```bash
python3 mundo/carga.py --por-segundo 40 --segundos 60
python3 verificar.py servicio alias
```

Si las métricas no vuelven a su nivel, el problema no era la versión: apaga las sugerencias (el kill switch: la app
muestra el selector de categorías normal) y busca otra causa.

## 4. Congelar

Nadie despliega otra versión del modelo hasta entender qué pasó.

## 5. Comunicar

Un mensaje corto a los equipos que usan las sugerencias: qué se vio, qué se hizo, qué sigue.

## 6. Investigar

Con calma: el log de cada request trae su `model_version`; el AnalysisRun dice qué métrica falló y con qué valor.
Un análisis escrito de qué falló y qué se cambia.
