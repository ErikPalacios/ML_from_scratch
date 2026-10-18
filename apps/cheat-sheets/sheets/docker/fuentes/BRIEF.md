# Brief: "Cheat sheet de Docker" (study page + PDF) — content writers

## Goal and learner
- **Learner:** mechatronics MSc with computer vision and PyTorch background who has never shipped to production. They are learning Docker to a JOB level: write a Dockerfile from scratch with the docs open, and diagnose failures fast.
  - Mac with Apple Silicon (arm64); Docker Desktop 29.x installed. The servers they will deploy to are usually amd64 Linux.
- **Format:** the same as an existing "Formulario de estimaciones" page (sections with a "formula", a table of pieces, a real example, a figure, "Cómo recordarla", "Trampa"), plus one mini-lab per section.
  - Everything is in Spanish (neutral Latin American, tuteo), with technical terms in English.
  - Direct, no filler, always the why.
  - Gender-neutral phrasing. No invented shorthand codes.
- **Examples:** come from the course's reference files, not from the learner's own project (they write their own Dockerfiles). The learner wants variables they can see, so syntax is written as templates with named placeholders.

## Sources
App root: `/Users/erikpalacios/Documents/ML_from_scratch/ClaudeApss/.claude/worktrees/fase-7-ronda-diseno-ml-7020fd/apps/ml-system-design`

Read these first:
- Module 5 (`js/content/m05-contenedores.js`). Its sections are why containers, image/container/layers, an ML Dockerfile decision by decision, CUDA runtime vs devel images, the NVIDIA Container Toolkit, reducing size, model weights, registries and immutable tags, and docker compose for development.
- The "Docker y kubectl" cheat sheet (`js/content/ref-comandos.js`, Docker sections).
- The reference files:
  - `reference/c01/gateway/Dockerfile`
  - `reference/c01/triton/Dockerfile`
  - `reference/c01/docker-compose.yml`
  - others as needed: `reference/c04/worker/Dockerfile`, `reference/c05/api/Dockerfile`, `reference/c06/gateway/Dockerfile`, `reference/c07/search/Dockerfile`.
- Use C01 as the main running example. Quote real lines from those files (short excerpts) and link course sections as `#m05.<section-id>`. List the ids with `grep -n "id: '" js/content/m05-contenedores.js`.

**Verify every command, flag, default and behavior against the official docs** (WebSearch/WebFetch via ToolSearch): docs.docker.com, the Compose specification, the NVIDIA Container Toolkit docs. It is October 2026 and Docker Engine is 29.x, so check what changed. Things to verify include:
- BuildKit as the default builder;
- `docker compose` v2 syntax, `depends_on` conditions and `stop_grace_period`;
- the CDI vs `--gpus` device syntax;
- Docker Desktop on Mac: the Linux VM, Rosetta/QEMU emulation, `host.docker.internal`.

Never invent flags, defaults, error strings or exit codes; if unsure, say so in the text. Exact error strings must be real; quote the core part that users actually see.

## Output
Write ONE JSON file (UTF-8) per writer at `/private/tmp/claude-501/-Users-erikpalacios-Documents-ML-from-scratch-ClaudeApss--claude-worktrees-fase-7-ronda-diseno-ml-7020fd/a9dccf86-c43d-47db-95d2-7a59cbb85db1/scratchpad/docker/content-<writer>.json`. Validate it with `node -e "JSON.parse(require('fs').readFileSync(...))"`.

Shape: `{ "sections": [Section…], ...extra keys your assignment asks for }`, where a Section is:

```
{
  "id": "anatomia",                       // kebab-case, unique
  "num": 1,                               // the number in the plan below
  "title": "Anatomía de un Dockerfile",
  "question": "¿Qué escribes, en qué orden y por qué?",   // one line
  "templates": [                          // 1–4 syntax "formulas" with {placeholders}
    { "code": "FROM {imagen}:{tag} AS {etapa}", "note": "one short line" }
  ],
  "formulas": ["exit\\_code = 128 + n_{señal}"],   // OPTIONAL: real math in KaTeX TeX (escape backslashes for JSON); only where a true formula exists
  "vars": [ ["{imagen}", "qué es", "ejemplo de C01"] ],           // one row per placeholder used in templates/formulas
  "pieces": [ ["instrucción o flag", "qué hace (≤ 20 words)", "ejemplo"] ],   // 6–14 rows: the vocabulary of this section
  "example": { "title": "El Dockerfile del gateway de C01", "lang": "dockerfile|yaml|bash|text", "code": "…", "source": "reference/c01/gateway/Dockerfile (extracto)", "notes": ["what to look at, line by line (3–6 bullets)"] },
  "figure": { "kind": "one of the kinds listed below", "caption": "one or two sentences", "data": { … kind-specific … } },
  "memo": "Cómo recordarla: 1–2 sentences; may contain <b> and <code>",
  "trap": "Trampa: 1–3 sentences",
  "lab": { "goal": "qué vas a provocar", "steps": [ { "cmd": "exact command(s) for macOS zsh", "expect": "what you should see" } ], "fix": "how to fix it and confirm", "needs": "Docker Desktop corriendo" },
  "links": ["#m05.capas", "#ref-comandos.docker"]   // course anchors that exist
}
```

## Figure kinds
The builder draws them; give it the data.
- `layers` — a layer stack with a cache-invalidation cascade. `data`: `{ "layers": [ { "instr": "COPY requirements.txt .", "size_mb": 0.001, "cached": true } … ], "changed_at": index }`.
- `multistage` — build stages and what gets copied. `data`: `{ "stages": [ { "name": "builder", "base": "…", "steps": ["…"], "size_mb": 900 }, { "name": "runtime", … } ], "copies": [ { "from": "builder", "what": "/opt/venv" } ] }`.
- `lifecycle` — a state machine. `data`: `{ "states": ["created", "running", …], "edges": [ ["created", "running", "docker start"] … ] }`.
- `signals` — a stop timeline. `data`: `{ "grace_s": 10, "events": [ { "t": 0, "label": "SIGTERM" }, … ] }`.
- `network` — host, VM and containers with ports and DNS names. `data`: `{ "host": "tu Mac", "containers": [ { "name": "api", "port": 8000, "published": "8000:8000" } … ], "network": "default", "notes": ["…"] }`.
- `volumes` — bind mount vs named volume vs tmpfs. `data`: free-form rows.
- `compose` — services, depends_on and healthchecks. `data`: `{ "services": [ { "name": "…", "depends_on": [ ["db", "service_healthy"] ], "ports": "…" } ] }`.
- `gpu-stack` — host driver, toolkit, container CUDA, framework. `data`: rows.
- `arch` — build platform vs run platform with a ✓/✗ matrix. `data`: rows.
- `chain` — Dockerfile → build → image → tag → push → registry → pull → run → container. `data`: steps with commands.
- `table` — when nothing else fits.

## Quality bar
- Correct first, then short. Each section should fit about 1–2 printed pages.
- Labs must be runnable on macOS with Docker Desktop, safe, and self-contained. Use tiny images (`alpine`, `busybox`, `python:3.12-slim`) and temporary names. Clean up at the end with `docker rm -f …` / `docker rmi …`.
- Never ask the learner to change system settings. Never use `--privileged` unless it is the point (and then explain).
- The labs were not executed by you unless you had a running daemon; say "no ejecutado aquí" in a `"verified"` field per lab (`"verified": "docs" | "executed"`).
- Escape correctly for JSON. Plain text is fine in tables; only `memo`, `trap`, `note` and `notes` may contain `<b>`/`<code>`.

## Report
Briefly, in English:
- what you wrote;
- the doc URLs you checked;
- anything uncertain.
