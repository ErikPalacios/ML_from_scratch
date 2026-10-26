## Project board (single source of truth for status)

This project's status lives on the board, project `c01`. URL and token are in `.env` (git-ignored); load them with `set -a; . ./.env; set +a` before each call. Never print the token or commit it.

**At the start of every session**, read the brief and start from it: where I left off, next action, blockers, active steps with their entry gate, DoD and measurements, recent work log and decisions.

```bash
set -a; . ./.env; set +a; curl -fsS -H "Authorization: Bearer $TABLERO_TOKEN" "$TABLERO_URL/api/claude/c01"
```

Step ids are in the brief's «Map» table: `kickoff`, `datos`, `versionado`, `entrenamiento`, `gate`, `export`, `serving`, `empaquetado`, `cicd`, `kubernetes`, `rollout`, `request`, `monitoreo`. PLAN milestones live inside their step (`h0`–`h10`, `h7b`, `h9a`, `h9b`, `imagenette`, `design`).

**Entry gate (hard rule).** A step cannot move to `en_curso` or `hecho` until its sizing calcs are done. Before starting a step:
1. Show me the step's open calcs: label, the inputs with their values, and the unit.
2. Ask me for my result. Do not compute it for me, and do not give me the formula or the answer unless I ask.
3. Record my answer. The board checks it against the course formula and replies 422 «Entry gate not met» while anything is open or wrong. Tell me which calcs are off; never retry with a different number on your own.

Waivers and revealed answers are mine to decide, on the board.

**When a step or milestone closes** (at that moment, not at the end of the day), update the board. Every call is a `POST` with JSON and returns `{"ok":true,"rev":N}`, or `{"error":…}`.

- A step:
  ```bash
  curl -fsS -X POST -H "Authorization: Bearer $TABLERO_TOKEN" -H 'Content-Type: application/json' "$TABLERO_URL/api/claude/c01/step/serving" --data @- <<'JSON'
  {"milestone": {"id": "h1", "status": "hecho"},
   "result": {"name": "curl latency, warm", "value": "31", "unit": "ms", "note": "10 requests, M4, 4 threads"},
   "file": {"path": "app/main.py", "ref": "commit abc1234"},
   "pass": {"v1": "hecho"},
   "note": "POST /v1/classify returns the contract; /readyz 503 while loading."}
  JSON
  ```
  Fields (all optional):
  - `status` (pendiente, en_curso, hecho, bloqueado, no_aplica) and `reason` (required for no_aplica);
  - `pass` (`v1`/`v2`: pendiente, en_curso, hecho);
  - `note` (appended with the date; never replaces);
  - `result` (`name`, `value`, `unit`, `note`, `date`), `command` (`code`, `note`), `file` (`path`, `ref`);
  - `milestone` (`id`, `status`), `criterion` (`id` and `ok`, or `text` for a new one);
  - `calc` (`id`, `answer`): my result for an entry-gate calc.

  In one request, answers are applied before the status.
- A sizing input, when a requirement or a measurement changes: `POST $TABLERO_URL/api/claude/c01/var/<varId>` with `{"value": "…"}`. Ids are in `GET $TABLERO_URL/api/claude/c01.json` → `vars`.
- A work-log entry, when the session ends: `POST $TABLERO_URL/api/claude/c01/log` with `{"did": "…", "measured": "… with units", "next": "…", "steps": ["serving"]}`.
- Where I left off and the next action: `POST $TABLERO_URL/api/claude/c01/resume` with `{"where": "…", "next": "Milestone 2, step 2.1: …", "step": "serving"}`.
- A decision with its why: `POST $TABLERO_URL/api/claude/c01/decision` with `{"what": "…", "over": "…", "why": "…", "step": "serving"}`.

Rules:
- Measurements carry their real number and unit; if it wasn't measured, it isn't written.
- `LAB_LOG.md` remains the long lab diary; the board holds the status and the next action. If they disagree, tell me instead of picking one.
- The token cannot delete or reorder steps, reveal answers, file waivers or change calc definitions: that's done on the board.
