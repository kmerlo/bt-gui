# Plan 012: Port DB inviolable rule (AGENTS §9) into GUIDE-CODING_PRACTICES.md

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 198124c..HEAD -- my-docs/GUIDE-CODING_PRACTICES.md AGENTS.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (1-2h)
- **Risk**: LOW
- **Depends on**: none (parallelizable with 011)
- **Category**: docs / correctness
- **Planned at**: commit `198124c`, 2026-08-30

## Why this matters

`AGENTS.md:131-157` §9 “Dati & DB — MAI cancellare contenuti utente (REGOLA INVIOLABILE)” is the highest-severity rule in the repo (after `sma50` was destroyed in `2026-08-29 12:15` per `my-docs/appunti_sviluppi.md:22`). `my-docs/GUIDE-CODING_PRACTICES.md` at `198124c` has zero mentions of `bt_gui.db`, `test_%`, `DROP TABLE`, or `bt_gui_test.db`. Per `AGENTS.md:3` “fonte normativa è la guida. In caso di conflitto, vince la guida.” an LLM that reads only `GUIDE` (as instructed in `GUIDE:327-368` “Istruzioni per un LLM”) will not enforce the rule and can recreate the data-loss bug in any new test.

## Current state

Relevant files, each with one line on its role:
- `AGENTS.md:131-157` — §9 inviolable DB rule: explicit forbid `rm *.db`, `DELETE FROM data_sources WHERE type='indicator'`, `db.query(...).filter(type=="indicator").delete()`, require `name LIKE 'test_%'` prefix, prefer `sqlite:///:memory:` with `StaticPool`, handle `bt_gui_test.db` isolation.
- `my-docs/GUIDE-CODING_PRACTICES.md` — 368 lines, 10 rules (Un file, Estrai presto, Mai any, Lint, Separa stato/logica/UI, Zustand, catch, const, Ref, Route). No DB rule. Ends at `## Istruzioni per un LLM` line 327 with 11 bullet rules, none about DB.
- `backend/database.py` — dual-DB proxy `main`/`test` with `active_db.txt`, `SessionLocal` proxy, `init_db` creates both.
- `tests/backend/test_persistence.py:11` — exemplar `sqlite:///:memory:` with `StaticPool` pattern to copy.
- `tests/conftest.py` — forces `test` DB for whole pytest session.

Excerpts (as at 198124c):

`AGENTS.md:131-143` header:
```
## 9. Dati & DB — MAI cancellare contenuti utente (REGOLA INVIOLABILE)

> ⚠️ **VIETATO ASSOLUTO — pena blocco PR:** cancellare o modificare righe utente in `bt_gui.db` (`strategies`, `data_sources`, `backtest_runs`, `tutorial1` / indicatori `sma50` etc.). Ogni violazione è un bug critico, anche se fatta da `pytest` o da un test.

**Divieti espliciti (MAI fare, nemmeno nei test):**

- `rm *.db`, `DROP TABLE`, `DELETE FROM <tabella>` senza `WHERE` su dati utente.
- `DELETE FROM data_sources WHERE type='indicator'` o qualsiasi `WHERE type=...` che colpisce righe utente (es. `sma50`).
- `db.query(DBSource).filter(DBSource.type == "indicator").delete()` — CANCELLATO: cancella anche indicatori utente. **MAI.**
```

`my-docs/GUIDE-CODING_PRACTICES.md:229-246` (current rule 10):
```
### 10. Route sempre sotto `/api/bt`
...
```
No section 11.

Repo conventions that apply:
- Guide is normative source; excerpt must be verbatim-compatible with `AGENTS.md:131-157` to avoid drift.
- Use same “VIETATO ASSOLUTO” callout and ✅/❌ code blocks as in AGENTS.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend lint | `uv run ruff check .` | exit 0 |
| Tests | `uv run pytest -q` | all pass |
| Frontend build | `npm run build --prefix frontend` | exit 0 |
| Verify rule present | `grep -c "MAI cancellare contenuti utente" my-docs/GUIDE-CODING_PRACTICES.md` | ≥1 |
| Verify no forbidden pattern in guide | `grep -n "DELETE.*type.*indicator" my-docs/GUIDE-CODING_PRACTICES.md` | shows the forbidden example only in the ❌ block (expected) |

## Scope

**In scope**:
- `my-docs/GUIDE-CODING_PRACTICES.md` — add new §11, update checklist, update LLM instructions.

**Out of scope** (do NOT touch):
- `AGENTS.md` — source of truth for this copy; keep as is (fix typos there only if guide copy diverges, report).
- `backend/database.py`, `tests/*` — code is correct; only docs.
- `my-docs/GUIDE_documentazione_tecnica.md` — separate tech doc, not here.

## Git workflow

- Trunk-based on `master` per `AGENTS.md:80-94`. Commit on `master`.
- Message style: `docs: ...` (see `git log --oneline -5`).

## Steps

### Step 1: Add new §11 “Dati & DB — MAI cancellare contenuti utente” after current §10

Insert after `GUIDE:246` (after Route section, before `---` that starts `## Struttura dei file`).

Copy verbatim from `AGENTS.md:131-157` but adapt paths to guide style: keep the ⚠️ callout, the 5 explicit bans, the ✅ correct example with `name LIKE 'test_%'`, the `sqlite:///:memory:` with `StaticPool` reference (`tests/backend/test_persistence.py:11`), the “prima di qualsiasi operazione distruttiva chiedi conferma” and “Se hai già cancellato” paragraphs.

Title: `### 11. Dati & DB — MAI cancellare contenuti utente (REGOLA INVIOLABILE)`

Add a one-line intro: `> Questa è la regola più critica del repo — violazione = bug critico. Vedi AGENTS.md:131 per il dettaglio normativo.`

**Verify**: `grep -n "MAI cancellare contenuti utente" my-docs/GUIDE-CODING_PRACTICES.md` → 1; `grep -n "sma50" my-docs/GUIDE-CODING_PRACTICES.md` → 1; `grep -n "test.*tmp.*mock" my-docs/GUIDE-CODING_PRACTICES.md` → ≥1.

### Step 2: Update “Checklist per nuove feature” (lines 308-323)

Add new item 11: `11. ☐ Ho toccato il DB? → Mai DELETE senza WHERE su name LIKE 'test_%' / 'tmp_%' / 'mock_%'; mai DROP/rm *.db; usa sqlite:///:memory: per liste vuote.`

Renumber? Keep 11 items (10 → 11). Update the header `rispondi a queste domande` from 10 to 11.

**Verify**: `grep -n "Ho toccato il DB" my-docs/GUIDE-CODING_PRACTICES.md` → 1; `grep -c "☐" my-docs/GUIDE-CODING_PRACTICES.md` → 11.

### Step 3: Update “Istruzioni per un LLM” (lines 327-368)

Add rule 12 at end of the bullet list (before closing ```):

`12. **MAI cancellare righe utente in bt_gui.db** — vedi §11. Per test usa solo prefissi test_/tmp_/mock_ e sqlite:///:memory:.`

Also update the summary line `## Regole di architettura per bt-gui` header to mention 12 rules (currently 11 bullets but intro says 11 rules — make consistent).

**Verify**: `grep -n "MAI cancellare righe utente" my-docs/GUIDE-CODING_PRACTICES.md` → 1; `grep -A2 "Piani in" my-docs/GUIDE-CODING_PRACTICES.md` still present.

### Step 4: Full verification

**Verify**: `uv run ruff check .` → exit 0; `uv run pytest -q` → all pass; `npm run build --prefix frontend` → exit 0; `grep -rn "DELETE.*WHERE type" backend/ tests/ --include="*.py" | grep -v "test_%"` → 0 (no new violation introduced).

## Test plan

No code tests. Docs verification:
- `grep -c "VIETATO ASSOLUTO" my-docs/GUIDE-CODING_PRACTICES.md` ≥1
- `grep -c "bt_gui_test.db" my-docs/GUIDE-CODING_PRACTICES.md` ≥1
- Build/lint/tests pass.

Pattern to follow: `AGENTS.md:131-157` verbatim.

## Done criteria

Machine-checkable. ALL must hold:
- [ ] `grep -c "MAI cancellare contenuti utente" my-docs/GUIDE-CODING_PRACTICES.md` ≥1
- [ ] `grep -c "Ho toccato il DB" my-docs/GUIDE-CODING_PRACTICES.md` ≥1
- [ ] `grep -c "MAI cancellare righe utente" my-docs/GUIDE-CODING_PRACTICES.md` ≥1 (LLM instructions)
- [ ] `uv run ruff check .` exits 0
- [ ] `uv run pytest -q` exits 0
- [ ] Only `my-docs/GUIDE-CODING_PRACTICES.md` modified (`git diff --stat` shows 1 file)

## STOP conditions

Stop and report back (do not improvise) if:
- `AGENTS.md:131-157` no longer contains the §9 text (it was moved/edited) — source changed, need reconciled copy.
- A step's verification fails twice.
- The fix appears to require touching `backend/database.py` or `tests/*`.

## Maintenance notes

- This section is the single most important to keep in sync with `AGENTS.md:131-157`. When either file changes, copy to the other in the same commit; consider adding a CI check `diff <(grep -A30 "MAI cancellare" AGENTS.md) <(grep -A30 "MAI cancellare" my-docs/GUIDE-CODING_PRACTICES.md)` to prevent drift (deferred).
- Reviewers should verify the ❌ example still shows the forbidden `filter(type=="indicator").delete()` and the ✅ example shows `name LIKE 'test_%'`.

