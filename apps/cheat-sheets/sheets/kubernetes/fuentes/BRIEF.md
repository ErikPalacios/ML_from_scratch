# Brief: "Cheat sheet de Kubernetes" (study page + PDF) — content writers

## Goal and learner
- **Learner:** mechatronics MSc with CV/PyTorch who has never shipped to production. Until a few days ago they didn't know what Kubernetes was, or whether it is programmed or configured.
  - They already have a "Cheat sheet de Docker" and an end-to-end map, "Del dato a producción". This sheet is the next step: Docker builds the image, Kubernetes runs it, scales it and restarts it.
  - Target level is the JOB: write and read manifests with the docs open, operate with `kubectl`, and diagnose a broken pod fast.
- **Format:** the same as the Docker sheet. Each section has:
  - a "formula" (syntax templates with named `{placeholders}`), a table of pieces, a real example, a figure;
  - "Cómo recordarla", "Trampa", and an optional mini-lab;
  - at the end, web tools: a symptom **diagnosticador**, a **revisor de YAML** and an error **quiz**.
- **Language:** Spanish (neutral Latin American, tuteo), technical terms in English.
  - Direct and short, always the why. Gender-neutral phrasing.
  - Say "el curso". Course labels like C01 or M06 are fine; never invent shorthand codes.
- **Examples:** from the course's reference files, mainly C01.

## Style: plain language, same concepts
The learner asked explicitly: "lenguaje simple pero mencionando los mismos conceptos".
- **Short sentences,** one idea each, everyday words.
- **Explain each technical term in plain words the first time it appears in a section,** and keep the English term next to it, because they need the terms at work and in interviews. For example: "un **Pod** (la unidad mínima que Kubernetes corre: uno o varios contenedores que comparten red y disco)".
- **No undefined acronyms,** and no stacked jargon. If a sentence needs three new terms, split it.
- **Use analogies when they are correct and help memory,** for example a Deployment works like a thermostat: you set how many copies you want, and it keeps correcting toward that. Never use an analogy that teaches something false.
- **Do not drop concepts to make it simpler.** Explain them instead. Cover the same depth as the Docker sheet.
- **In tables** (`pieces`, `vars`), the "qué hace" column is plain Spanish; the field or command stays exact.

## Sources
App root: `~/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design`

- **C01 manifests (the running example), all in `reference/c01/k8s/`:**
  - `gateway.yaml`: Deployment, Service, Ingress (ALB), HPA, PodDisruptionBudget, NetworkPolicy;
  - `triton.yaml`: GPU Deployment with nodeSelector, tolerations, startup/readiness/liveness probes, preStop and a 60 s grace period; plus its Service;
  - `keda-triton.yaml`: KEDA ScaledObject;
  - `monitoring.yaml`: ServiceMonitors.
  - Also `reference/c01/README.md` (cluster prerequisites).
- **Other manifests:** `reference/c04/k8s/seg-worker.yaml`, `reference/c10/k8s/vllm-70b.yaml`, `reference/c13/k8s/asr-worker.yaml`.
- **Course:**
  - M06 (`js/content/m06-orquestacion.js`), sections `por-que-k8s`, `objetos-basicos`, `gpus-k8s`, `hpa`, `keda`, `nodos`, `cold-starts`, `serverless`, `alta-disponibilidad`;
  - M11 (despliegue seguro: rollouts, canary, Argo Rollouts), M12 (monitoreo), M13 (nube: EKS), M15 (seguridad);
  - `js/content/ref-comandos.js`, sections `kubectl-basicos`, `rollouts`, `depurar` (síntoma → comandos → causa típica) and `autoscaling-cmds`;
  - `js/content/c01-clasificacion.js` and `c01-archivos.js` (sections `serving`, `fallas`, `archivos`).
- **Course anchors:** `#<page>.<section-id>`. Only use ids that exist (list them with grep).
- **Verify every command, field, default and behavior against the official docs.** Load WebSearch and WebFetch with ToolSearch `select:WebSearch,WebFetch`. Sources:
  - kubernetes.io (concepts, tasks, the kubectl reference, the API reference, release notes);
  - keda.sh;
  - the AWS Load Balancer Controller docs;
  - the NVIDIA k8s-device-plugin and GPU Operator docs;
  - the Amazon EKS docs;
  - argoproj (Argo Rollouts).

  It is October 2026: check the current Kubernetes minor version, and what went GA recently (sidecar containers, in-place pod resize, trafficDistribution, crash-loop backoff changes).
- **Exact strings only.** Never invent fields, flags, defaults, error strings or statuses. If unsure, say so or leave it out. Exact error strings must be real; quote the core part users actually see.

## Settled cross-section facts
Verify each in the docs. If one is wrong, report it, and still use the verified value. The writers share these, so the sheet must not contradict itself.

- **Grace period:** `terminationGracePeriodSeconds` defaults to 30 s. preStop runs inside that window, before SIGTERM.
  - C01 gateway: grace 45 s, preStop 15 s, so the app has 30 s after SIGTERM.
  - C01 Triton: grace 60 s, preStop 10 s, Triton `--exit-timeout-secs` 30 s, plus margin.
- **Exit codes:** 137 = SIGKILL (reason `OOMKilled` when the memory limit killed it); 143 = SIGTERM. The same table as the Docker sheet: 0, 1, 125, 126, 127, 128+n.
- **Probe defaults:** `periodSeconds` 10, `timeoutSeconds` 1, `successThreshold` 1, `failureThreshold` 3, `initialDelaySeconds` 0.
  - A failing liveness probe restarts the container.
  - A failing readiness probe removes the pod from the Service endpoints, with no restart.
  - startupProbe holds the other two until it passes.
- **Deployment defaults:** RollingUpdate with `maxSurge` 25 % and `maxUnavailable` 25 % (rounding: surge rounds up, unavailable rounds down); `revisionHistoryLimit` 10; `progressDeadlineSeconds` 600.
- **HPA:**
  - formula `desiredReplicas = ceil(currentReplicas × currentMetricValue / desiredMetricValue)`;
  - 10 % tolerance;
  - default scale-down stabilization window 300 s;
  - controller sync every 15 s;
  - KEDA creates and feeds an HPA named `keda-hpa-<scaledobject>`.
- **CrashLoopBackOff:** the restart backoff grows exponentially up to a cap (classically 10 s doubling to 5 min, reset after 10 min running). Check whether recent versions changed it, and state it per version if so.
- **Requests and limits:**
  - CPU over its limit → throttling (no kill);
  - memory over its limit → OOMKilled (exit 137);
  - QoS classes are Guaranteed, Burstable and BestEffort;
  - GPUs: `nvidia.com/gpu` goes in limits (whole GPUs unless time-slicing/MIG).
- **C01 GPU nodes:** label `workload=gpu-t4`, taint `nvidia.com/gpu=present:NoSchedule`. Check against README and triton.yaml.
- **Kubernetes version:** C01's README says ≥ 1.34. Say which version you verified against.

## The sections (fixed ids and numbers)
| num | id | Section | Writer |
|---|---|---|---|
| 0 | `bolsillo` | Números y códigos de bolsillo (estados, defaults, exit codes, verbos de kubectl) | W1 |
| null | `cadena` | La cadena: del YAML al pod que recibe tráfico | W1 |
| 1 | `que-es` | Qué es Kubernetes y cómo se trabaja (estado deseado, control loop, arquitectura del cluster, EKS) | W1 |
| 2 | `manifest` | Anatomía de un manifest (apiVersion, kind, metadata, spec, status, labels y selectors, namespaces) | W1 |
| 3 | `deployments` | Pods, ReplicaSets y Deployments (+ rolling update) | W1 |
| 4 | `servicios` | Services, DNS e Ingress (ALB en C01; NetworkPolicy) | W1 |
| 5 | `probes` | Probes y apagado ordenado | W2 |
| 6 | `recursos` | Requests, limits y QoS (OOMKilled vs throttling, GPUs como recurso) | W2 |
| 7 | `config` | ConfigMaps, Secrets, volúmenes y ServiceAccounts (IRSA/Pod Identity para AWS) | W2 |
| 8 | `scheduling` | Dónde cae cada pod: nodeSelector, affinity, taints/tolerations, GPUs y nodos que se crean solos | W2 |
| 9 | `autoscaling` | Autoscaling: HPA y KEDA (+ cómo se combina con el autoscaling de nodos) | W2 |
| 10 | `rollouts` | Rollouts, rollback, PodDisruptionBudget y canary (Argo Rollouts en C01) | W3 |
| 11 | `kubectl` | kubectl: mirar, entrar, depurar (contexts, namespaces, -o yaml/jsonpath, explain, diff, port-forward, RBAC básico: can-i) | W3 |
| 12 | `diagnostico` | Diagnóstico: el método (estado → eventos → logs → exec) y la tabla de estados | W3 |
| 13 | `errores` | Errores que debes reconocer rápido | W3 |

### Extra keys
**W1 adds `revisor`:** 14–18 rules for a YAML reviewer that runs in the browser on parsed manifests.
```
{ "id": "sin-requests", "severity": "error|warn|info", "kinds": ["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Pod"],
  "check": "precise rule in English the builder can implement as a predicate over the parsed object (say exactly which fields, which containers: containers vs initContainers, which kinds)",
  "message": "aviso corto en español", "why": "por qué importa, 1–2 frases simples", "fix": "cómo arreglarlo, 1 frase",
  "example_bad": "YAML mínimo que dispara la regla", "example_good": "YAML mínimo que no la dispara" }
```
- **Rules must not fire on good practice.** Reason through each rule against all 4 C01 manifests, and against c04/c10/c13's manifests.
  - On C01's manifests they must give 0 findings, unless the manifest really has a problem; report it if so.
  - Cover:
    - missing requests or limits for memory;
    - missing readiness probe on a Deployment behind a Service;
    - image without a tag, or `:latest`;
    - a selector that doesn't match the template labels;
    - a Service selector matching no workload in the same input;
    - `targetPort` matching no `containerPort` (when named or numeric);
    - a GPU limit without a matching toleration (when taints are known? say how to decide);
    - privileged or `runAsNonRoot` missing;
    - secret values as literal env values;
    - `hostPath`;
    - `replicas: 1` for a Deployment with an HPA or PDB conflict;
    - a PDB that blocks all evictions;
    - a liveness probe identical to the readiness probe (on a heavy endpoint);
    - `terminationGracePeriodSeconds` shorter than preStop;
    - a missing namespace when the others set one;
    - and so on.

**W3 adds `diagnosticador`:** 14 symptoms.
```
{ "symptom": "lo que ves (estado o mensaje)", "causes": [ { "cause": "…", "check": "comando real", "fix": "…" } ] }
```
Give 2–4 causes per symptom. The symptoms cover:
- Pending;
- ContainerCreating stuck;
- ImagePullBackOff/ErrImagePull;
- CrashLoopBackOff;
- OOMKilled;
- Running but not Ready;
- Ready but the Service gets no traffic;
- an Ingress/ALB returning 503/504;
- a rollout stuck;
- the HPA not scaling;
- a pod stuck Terminating;
- Evicted;
- CreateContainerConfigError;
- a GPU pod that doesn't see the GPU.

**W3 also adds `errores`:** 26 real messages.
```
{ "msg": "parte central del mensaje real", "meaning": "qué significa, simple", "first": "primer comando", "topic": "<topic>" }
```
Topics map to sections:

| topic | section |
|---|---|
| scheduling, gpu | `scheduling` |
| imagen, arranque | `diagnostico` |
| probes | `probes` |
| recursos | `recursos` |
| red | `servicios` |
| config, almacenamiento | `config` |
| rbac, api, conexion | `kubectl` |
| rollout | `rollouts` |
| autoscaling | `autoscaling` |
| manifest (validation errors) | `manifest` |

## Output
Write ONE JSON file (UTF-8) per writer at `/private/tmp/claude-501/-Users-USER-Documents-ML-from-scratch-ClaudeApss--claude-worktrees-fase-7-ronda-diseno-ml-7020fd/a9dccf86-c43d-47db-95d2-7a59cbb85db1/scratchpad/k8s/content-<writer>.json`. Validate it with `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"`.

Shape: `{ "sections": [Section…], ...extra keys your assignment asks for }`. A Section uses the same schema as the Docker sheet:
```
{
  "id": "probes", "num": 5, "title": "Probes y apagado ordenado",
  "question": "¿Cómo sabe Kubernetes si tu pod está vivo, listo, o si debe esperar?",
  "templates": [ { "code": "readinessProbe:\n  httpGet: { path: {ruta}, port: {puerto} }", "note": "one short line" } ],   // 1–4, with {placeholders}
  "formulas": ["t_{\\text{gracia}} \\ge t_{\\text{preStop}} + t_{\\text{drenado}}"],   // OPTIONAL KaTeX TeX (escape backslashes); only real formulas
  "vars": [ ["{ruta}", "qué es", "ejemplo de C01"] ],                 // one row per placeholder used
  "pieces": [ ["campo, objeto o comando", "qué hace (≤ 20 palabras)", "ejemplo"] ],   // 6–14 rows
  "example": { "title": "…", "lang": "yaml|bash|text", "code": "real excerpt ≤ 30 lines", "source": "reference/c01/k8s/triton.yaml (extracto)", "notes": ["3–6 bullets"] },
  "figure": { "kind": "<one of the kinds below>", "caption": "1–2 sentences", "data": { … } },
  "memo": "Cómo recordarla: 1–2 sentences (may contain <b>, <code>)",
  "trap": "Trampa: 1–3 sentences",
  "lab": { "goal": "…", "steps": [ { "cmd": "exact commands for macOS zsh", "expect": "what you should see" } ], "fix": "…",
           "needs": "un cluster local: Kubernetes de Docker Desktop (Settings → Kubernetes) o kind", "verified": "docs" },
  "links": ["#m06.objetos-basicos", "#ref-comandos.depurar"]
}
```

### Figure kinds
The builder draws them from your data. Keep data short and to scale where there are numbers.
- `control-loop`: desired vs actual state, and the controller that reconciles. `data: { "desired": "…", "actual": "…", "actions": ["…"], "who": "Deployment controller" }`
- `cluster`: control plane (API server, etcd, scheduler, controller manager) and nodes (kubelet, container runtime, kube-proxy/CNI, pods); EKS marks what AWS manages. `data: { "control_plane": [...], "nodes": [ { "name": "…", "labels": "…", "pods": [...] } ], "managed_note": "…" }`
- `hierarchy`: owner chain. `data: { "chain": [ { "kind": "Deployment", "name": "gateway", "note": "…" }, … ], "selector": "app=gateway" }`
- `rollout`: a rolling update timeline. `data: { "replicas": 4, "max_surge": 1, "max_unavailable": 0, "steps": [ { "old": 4, "new": 1, "ready_new": 0 }, … ] }`
- `network`: client → Ingress/ALB → Service → EndpointSlice → pods, with ports and DNS names. `data: { "hops": [ { "name": "…", "port": "…", "note": "…" } ], "dns": "…" }`
- `probes`: a timeline in seconds for startup/readiness/liveness and the shutdown sequence. `data: { "events": [ { "t": 0, "lane": "startup|readiness|liveness|shutdown", "label": "…" } ], "grace_s": 60 }`
- `resources`: requests vs limits per container, the node's allocatable capacity, and what happens when you go over. `data: rows`
- `scheduling`: nodes with labels and taints, pods with selectors and tolerations, ✓/✗ where each pod lands. `data: { "nodes": [...], "pods": [...], "matrix": [[…]] }`
- `autoscale`: the HPA formula worked with C01 numbers, plus a small timeline. `data: { "current": 4, "metric": …, "target": …, "desired": …, "timeline": [...] }`
- `lifecycle`: a state machine (pod phases and container states). `data: { "states": [...], "edges": [ ["from", "to", "label"] ] }`
- `chain`: YAML → kubectl apply → API server → etcd → controllers → scheduler → kubelet → runtime → pod Ready → endpoints → traffic. `data: { "steps": [ { "label": "…", "cmd": "…", "note": "…" } ] }`
- `table`: when nothing else fits. `data: { "head": [...], "rows": [...] }`

## Quality bar
- **Correct first, then short.** Each section should fit about 1–2 printed pages.
- **Labs are optional and need a local cluster.** Docker Desktop's built-in Kubernetes is enabled by the learner in Docker Desktop → Settings; `kind` is the alternative.
  - Use tiny public images (`busybox`, `nginx:alpine`, `registry.k8s.io/e2e-test-images/agnhost` only if needed) and a dedicated namespace `lab-k8s`.
  - Clean up with `kubectl delete namespace lab-k8s`.
  - Never ask the learner to change system settings, and never use privileged pods unless that is the point.
  - Mark `"verified": "docs"`; the labs will not be executed here.
  - If a lab can't be verified well, set `"lab": null` and add `"lab_omitted": "<reason>"`.
- **HTML:** escape correctly for JSON. Only `memo`, `trap`, `note` and `notes` may contain `<b>` or `<code>`.
- **Do NOT:**
  - run kubectl, docker, aws or any cluster command;
  - install anything;
  - log in anywhere.

## Report
Briefly, in English:
- what you wrote;
- the doc URLs you checked;
- course vs docs disagreements;
- anything uncertain.
