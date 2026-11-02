# Brief: "Cheat sheet de Git y GitHub Actions" (study page + PDF) — content writers

## Goal and learner
- **Learner:** mechatronics MSc with CV/PyTorch who has never shipped to production.
  - They already have sheets on Docker, on Kubernetes, and an end-to-end map, "Del dato a producción".
  - This sheet covers the everyday flow of any team: Git (commits, branches, pull requests, undoing mistakes) and GitHub Actions (CI/CD: tests, image build, push to ECR and deploy, all automatic).
  - Target level is the JOB: work in a team repo without fear, write a workflow with the docs open, and diagnose a red CI run fast.
- **Format:** the same as the Docker and Kubernetes sheets.
  - Each section has a "fórmula" (syntax templates with `{placeholders}`), a pieces table, a real example and a figure.
  - It also has "Cómo recordarla", "Trampa" and an optional mini-lab.
  - At the end come web tools: a symptom **diagnosticador**, a **revisor de workflows** (GitHub Actions YAML) and an error **quiz**.
- **Language:** Spanish (neutral Latin American, tuteo), technical terms in English.
  - Gender-neutral phrasing.
  - Say "el curso". Course labels like C01 or M10 are fine; never invent shorthand codes.

## Style: plain language, same concepts
The learner asked for "lenguaje simple pero mencionando los mismos conceptos".
- **Sentences:** short ones, one idea each, everyday words.
- **New terms:** explain each technical term in plain words the first time it appears in a section, and keep the English term beside it. Example: "un **commit** (una foto de todo tu proyecto en un momento, con un mensaje que dice qué cambió)".
- **No jargon walls:** no undefined acronyms, and no stacked jargon.
- **Analogies:** use them when they are correct and help memory, for example "una rama es una etiqueta que avanza con cada commit, no una copia del proyecto". Never use one that teaches something false.
- **Depth:** don't drop concepts to make it simpler. Explain them instead.
- **Tables:** in `pieces` and `vars`, the "qué hace" column is plain Spanish; the command or field stays exact.

## Sources
App root: `~/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design`. Cheat sheets: `…/apps/cheat-sheets`.

- **Course modules:**
  - M10 (`js/content/m10-mlops.js`): sections `ci-cd`, `gate`, `pipelines-entrenamiento`, `reproducibilidad`;
  - M05 (`m05-contenedores.js`): registries, immutable tags, and a release.sh example for building and pushing with the commit SHA;
  - M11 (despliegue seguro), M15 (seguridad: secrets, supply chain), M01;
  - `ref-herramientas.js` (CI/CD row), `ref-comandos.js`.
- **C01:**
  - `c01-clasificacion.js` and `c01-archivos.js`;
  - `reference/c01/**`: gateway tests in `gateway/tests/test_api.py` with `pytest.ini`, the Dockerfiles, the k8s manifests, and `README.md`, which describes the Triton image built on a T4.
  - C01 has NO GitHub Actions workflow file. Any workflow you show is **illustrative** and must say so ("ilustrativo, armado con los pasos del curso"), but it must be real, valid syntax using real actions at their current major versions.
- **Consistency with the existing sheets.** Read them; don't contradict them.
  - `apps/cheat-sheets/sheets/recorrido/fuentes/content-w2.json`: station `cicd` and the `github-actions`, `git` and `ecr` cards, already fact-checked. C01's real order: the gateway image comes from code CI on every commit; the Triton image comes from the model pipeline on a T4 runner before the registry; both go to ECR with immutable tags; the rollout changes image tags in the manifests.
  - `apps/cheat-sheets/sheets/docker/fuentes/content-w1.json`: the `registries` section (tags, digests, ECR).
  - `apps/cheat-sheets/sheets/kubernetes/fuentes/content-w3.json`: the `rollouts` section.
- **Anchors:** course anchors are `#<page>.<section-id>`. Only use ids that exist.
- **Verification:** check every command, flag, field, default and message against official docs. Load WebSearch and WebFetch with ToolSearch `select:WebSearch,WebFetch`. Sources:
  - git-scm.com (reference and Pro Git);
  - docs.github.com (Actions workflow syntax, contexts, security hardening, OIDC with AWS, caching, artifacts, limits, branch protection and rulesets, authentication);
  - the READMEs of the actions you cite (actions/checkout, actions/setup-python, actions/cache, actions/upload-artifact, aws-actions/configure-aws-credentials, aws-actions/amazon-ecr-login, docker/setup-buildx-action, docker/build-push-action, docker/metadata-action);
  - AWS docs (ECR, IAM OIDC).

  It is October 2026: check current Git and action major versions. Never invent flags, defaults, limits or messages; if unsure, say so or leave it out.

## Settled facts
Verify each in the docs; if one is wrong, report it and use the verified value. The writers share them.
- **`git switch` and `git restore`:** available since Git 2.23. They split `checkout`'s two jobs. Prefer them in templates and mention `checkout` as the old form.
- **Divergent `git pull`:** when the branches have diverged and no `pull.rebase` or `pull.ff` is configured, recent Git refuses ("fatal: Need to specify how to reconcile divergent branches"). Check the exact version and wording.
- **Reflog:** entries expire after 90 days by default, and after 30 days if unreachable. It's the safety net after a bad `reset`.
- **GitHub authentication:** password authentication for Git operations was removed in 2021. Use SSH keys, a personal access token through a credential helper, or `gh auth login`.
- **GitHub Actions:**
  - the `GITHUB_TOKEN` default permissions (check the read-only default for new repositories and organizations, and the `permissions:` key);
  - OIDC to AWS needs `permissions: id-token: write` and an IAM role whose trust policy limits `sub`, so no long-lived keys;
  - the default job timeout is 360 min;
  - artifact retention defaults to 90 days;
  - the cache size limit per repository;
  - secrets are not passed to workflows triggered by pull requests from forks;
  - `pull_request_target` risks;
  - `set-output` is deprecated, so use `$GITHUB_OUTPUT`.
- **Supply-chain hardening:** pin third-party actions to a full commit SHA (GitHub's security-hardening guide). Explain the tradeoff with major tags in plain words.
- **C01 conventions:** image tag = commit SHA (immutable in ECR); the CPU gateway is built for `linux/amd64` (the Mac is arm64; see the Docker sheet); the Triton image comes from a self-hosted or GPU runner with a T4.

## The sections (fixed ids and numbers)
| num | id | Section | Writer |
|---|---|---|---|
| 0 | `bolsillo` | Nombres y números de bolsillo (estados de un archivo, HEAD y refs, SHA, defaults y límites de Actions) | W1 |
| null | `cadena` | La cadena: de tu cambio al deploy (edit → add → commit → push → PR → CI → review → merge → CD → rollout) | W1 |
| 1 | `modelo` | Qué es Git: commits como fotos, ramas como etiquetas, HEAD, las 3 zonas (working tree, staging, repo) | W1 |
| 2 | `dia-a-dia` | El día a día: clone, status, add, commit, diff, log, push, pull, fetch, .gitignore | W1 |
| 3 | `ramas` | Ramas, merge y rebase; conflictos y cómo resolverlos | W1 |
| 4 | `deshacer` | Deshacer: restore, reset (soft/mixed/hard), revert, commit --amend, stash, reflog | W1 |
| 5 | `github` | GitHub: remotos, autenticación (SSH, token, gh), pull requests, reviews, protección de ramas y rulesets, tipos de merge, tags y releases | W2 |
| 6 | `workflow` | Anatomía de un workflow de Actions: on, jobs, runs-on, steps, uses/run, with, env, needs, if, contextos y expresiones | W2 |
| 7 | `tests-ci` | Tests en CI: setup-python, caché, pytest, matrix, artifacts, checks obligatorios | W2 |
| 8 | `secretos` | Secretos, permisos y OIDC: GITHUB_TOKEN, secrets y vars, environments, OIDC a AWS sin llaves | W2 |
| 9 | `imagenes` | Build y push de imágenes: buildx, caché, tag = SHA, amd64 desde un Mac arm64, login a ECR | W2 |
| 10 | `cd` | CD: deploy, environments con aprobación, concurrency, kubectl vs GitOps, rollback = revert | W3 |
| 11 | `runners` | Runners: GitHub-hosted vs self-hosted (la T4 del C01), labels, minutos, timeouts, costos | W3 |
| 12 | `diagnostico` | Diagnóstico: leer el log, re-run con debug, reproducir en local, tipos de falla | W3 |
| 13 | `errores` | Errores que debes reconocer rápido (git y Actions) | W3 |

## Extra keys
### W2 adds `workflows_ref` and `revisor`
**`workflows_ref`** holds 2 illustrative, complete and valid workflows for C01. W2's sections use them as examples, and the revisor must give **0 findings** on both.
```
{ "id": "gateway-ci-cd", "path": ".github/workflows/gateway.yml",
  "title": "…",
  "yaml": "… ≤ 80 lines …",
  "notes": ["…"] }
```
- `gateway-ci-cd`: pytest on every PR. On merge to main it assumes the AWS role via OIDC, builds `linux/amd64` with buildx, pushes to ECR tagged with the SHA, and opens or updates the manifest change (or deploys with approval through an environment).
- `triton-modelo`: the model pipeline on a self-hosted T4 runner (workflow_dispatch). It builds the engine and the Triton image, runs parity, pushes, and registers.

**`revisor`** holds 14–18 rules for a workflow reviewer that runs in the browser on parsed YAML.
```
{ "id": "sin-permissions", "severity": "error|warn|info",
  "check": "precise rule the builder can implement as a JS predicate over the parsed workflow object (top-level and per-job keys)",
  "message": "aviso corto", "why": "por qué importa, simple", "fix": "1 frase",
  "example_bad": "YAML mínimo que la dispara", "example_good": "YAML mínimo que no" }
```
Cover:
- no `permissions` (or `write-all`);
- third-party actions not pinned to a SHA (info or warn; first-party `actions/*` pinned to a major is acceptable: decide and explain);
- `pull_request_target` together with a checkout of the PR head;
- untrusted `${{ github.event.* }}` interpolated inside `run` (script injection);
- long-lived AWS keys from secrets where OIDC would work;
- missing `timeout-minutes`;
- a deploy job without `concurrency` or an environment;
- `:latest` tags pushed;
- `set-output` or `save-state`;
- `secrets.*` echoed;
- `runs-on` self-hosted on public-repo PR triggers;
- `actions/checkout` with `persist-credentials` left on in jobs that run untrusted code;
- no cache for pip;
- and so on.

Reason every rule against both `workflows_ref` and report the result.

### W3 adds `diagnosticador` and `errores`
**`diagnosticador`** holds 14 symptoms: `{ "symptom": "…", "causes": [ { "cause": "…", "check": "comando o dónde mirar", "fix": "…" } ] }`. Cover:
- push rejected;
- a merge conflict;
- "perdí commits";
- a commit on the wrong branch;
- "subí un secreto";
- the workflow doesn't start;
- tests pass locally but fail in CI;
- ECR login or OIDC fails;
- the image isn't pushed, or has the wrong architecture;
- a slow workflow / cache misses;
- the deploy shipped the wrong version;
- a self-hosted runner offline;
- PR checks stuck "Expected — Waiting";
- detached HEAD.

**`errores`** holds 26 real messages: `{ "msg": "parte central del mensaje real", "meaning": "simple", "first": "primer comando", "topic": "<topic>" }`. Topics map to sections:

| topic | section |
|---|---|
| basico | `dia-a-dia` |
| ramas | `ramas` |
| deshacer | `deshacer` |
| remoto, auth | `github` |
| sintaxis | `workflow` |
| tests | `tests-ci` |
| permisos, oidc | `secretos` |
| imagen | `imagenes` |
| deploy | `cd` |
| runner | `runners` |
| otro | `diagnostico` |

## Section schema
The schema is the same as the Docker and Kubernetes sheets: `{ id, num, title, question, templates[{code,note}], formulas[] (optional, KaTeX; only real formulas), vars[], pieces[], example{title,lang,code,source,notes}, figure{kind,caption,data}, memo, trap, lab{goal,steps[{cmd,expect}],fix,needs,verified}, links[] }`. Read `apps/cheat-sheets/sheets/kubernetes/fuentes/content-w1.json` for the exact shape and depth.

### Figure kinds
- `areas`: working tree → staging → repo → remote, with the commands that move changes between them.
- `graph`: a commit graph, with branches as labels, HEAD, and before/after for merge, rebase, reset or revert. `data: { "before": {commits, branches, head}, "after": {…}, "op": "…" }`
- `undo`: a table/figure of which command moves what (HEAD, branch, staging, working tree) and whether it is safe after a push.
- `pr`: the life of a pull request, from branch to merge with checks and review.
- `workflow`: workflow → jobs (with `needs` arrows) → steps; plus the triggers.
- `oidc`: GitHub (OIDC token) → AWS STS (trust policy checks `sub`) → temporary credentials → ECR push.
- `pipeline`: the C01 CI/CD timeline (PR → tests → merge → build → push → manifest → rollout) with durations.
- `runners`: GitHub-hosted vs self-hosted, side by side.
- `chain` and `table`: as in the other sheets.

## Labs
- **Git labs** must run fully locally and safely: `mkdir ~/lab-git && cd ~/lab-git && git init`. Use a local bare repo as the "remote" (`git init --bare ~/lab-git-remote.git`) for push and pull conflicts. Clean up with `rm -r ~/lab-git ~/lab-git-remote.git`. No GitHub account is needed.
- **Actions labs** are optional and need the learner's GitHub account and a new empty test repo. Never ask for tokens or secrets to be pasted anywhere; push with their normal Git auth.
  - Set `"lab": null` with `lab_omitted` when a lab can't be made reliable.
  - Mark `"verified": "docs"`.

## Quality bar
- **Correct first, then short.** Escape JSON correctly. Only `memo`, `trap`, `note` and `notes` may contain `<b>` or `<code>`.
- **Do NOT:**
  - run git against any real remote, or gh, docker, kubectl or aws;
  - install anything or log in anywhere.
  - Local git commands in a temp folder under your own scratch subfolder are fine, to check outputs and messages.

## Output and report
- **Output:** one JSON file per writer at `/private/tmp/claude-501/-Users-USER-Documents-ML-from-scratch-ClaudeApss--claude-worktrees-fase-7-ronda-diseno-ml-7020fd/a9dccf86-c43d-47db-95d2-7a59cbb85db1/scratchpad/git/content-<writer>.json`, validated with `node -e "JSON.parse(...)"`.
- **Report** briefly, in English:
  - what you wrote;
  - the URLs you checked;
  - disagreements between the course and the docs;
  - anything uncertain.
