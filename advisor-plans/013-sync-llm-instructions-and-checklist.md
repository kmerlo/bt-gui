# Plan 013: Sync LLM instructions and checklist (GUIDE ↔ AGENTS)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 198124c..HEAD -- my-docs/GUIDE-CODING_PRACTICES.md AGENTS.md plans/README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S (1-2h)
- **Risk**: LOW
- **Depends on**: `advisor-plans/011-fix-stale-be-fe-structure.md` and `advisor-plans/012-port-db-inviolable-rule.md` (run after both, to sync final counts)
- **Category**: docs / dx
- **Planned at**: commit `198124c`, 2026-08-30

## Why this matters

`AGENTS.md:28-42` says 11 rules + checklist, `GUIDE:327-368` says 11 rules in LLM instructions but `GUIDE:50-246` has 10 rules (now 11 after 012). The LLM instruction block (368 lines total) is duplicated, omits Ponytail (`// ponytail:`) and the new DB rule (§11), and the checklist at `GUIDE:308-323` (10 items) diverges from `AGENTS.md:42` (11 items, different order). Per `AGENTS.md:3` “vince la guida”, an LLM that follows only `GUIDE:327-368` ignores Ponytail and DB safety, violating `AGENTS.md:99-101` (Ponytail default) and `AGENTS.md:131-157` (DB).

## Current state

Relevant files, each with one line on its role:
- `my-docs/GUIDE-CODING_PRACTICES.md:308-323` — Checklist 10 items (pre-012: 10, post-012: 11 with DB item).
- `my-docs/GUIDE-CODING_PRACTICES.md:327-368` — LLM instructions: 11 bullets (pre-012) or 12 (post-012), but still missing Ponytail and stale count.
- `AGENTS.md:28-42` — Regole d'oro estratto: 11 items (10 original + 11 Piani), plus line 42 “Checklist completa ... 10 punti” (stale count).
- `AGENTS.md:99-101` — Ponytail style note (`// ponytail:` marker).
- `plans/README.md` — plan index shows 001-005 + 006, but GUIDE still references `001-bootstrap → 005-integration-stocks-app`.

Excerpts (as at 198124c, before 011/012):

`AGENTS.md:28-42`:
```
## 2. Regole d'oro (estratto — vedi guida per dettagli)
1. Un file, una responsabilità — soglia pratica 300 righe, dura 500.
2. Estrai presto — alla seconda funzione correlata nello stesso file, estrai hooks/useXxx.ts.
3. Mai any — usa frontend/src/types/bt.ts generato
...
10. Route sempre sotto /api/bt — backend/api/routes.py: APIRouter(prefix="/api/bt")
11. Piani prima del codice — verifica ./plans/ esista
Checklist completa per nuove feature nella guida cap. "Checklist per nuove feature" — spunta tutti i 10 punti prima di aprire PR.
```

`GUIDE:327-368` LLM block header:
```
## Istruzioni per un LLM in questo progetto
...
1. **File sotto le 300 righe**...
...
11. **Piani in ./plans/**.
```
No mention of Ponytail, no DB rule.

Repo conventions that apply:
- `AGENTS.md:3` says guide is normative; `AGENTS.md` is excerpt that must stay in sync — include a “sync note” to prevent future drift.
- Ponytail marker is `// ponytail:` per `AGENTS.md:101`.
- Trunk-based on `master`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Backend lint | `uv run ruff check .` | exit 0 |
| Frontend build | `npm run build --prefix frontend` | exit 0 |
| Tests | `uv run pytest -q` | all pass |
| Verify checklist count | `grep -c "☐" my-docs/GUIDE-CODING_PRACTICES.md` | 11 (after 012) |
| Verify LLM bullets | `grep -c "^\s*[0-9]\+\." my-docs/GUIDE-CODING_PRACTICES.md` in LLM section | 13 (11 original + DB + Ponytail) — see steps |

## Scope

**In scope**:
- `my-docs/GUIDE-CODING_PRACTICES.md` — LLM instructions + checklist header.
- `AGENTS.md` — only the two stale lines (checklist count 10→11 and plan range summary); keep minimal to avoid conflict with 011/012.

**Out of scope**:
- `backend/*`, `frontend/*`, `my-docs/GUIDE_documentazione_tecnica.md` — not here.
- Full rewrite of `AGENTS.md:1-60` — only the 2 stale lines.

## Git workflow

- Trunk-based `master`. Commit `docs: sync LLM instructions and checklist`.
- One commit for both files (they are coupled).

## Steps

### Step 1: Update GUIDE checklist header count (line ~309)

Change:
```
rispondi a queste domande **prima** di scrivere codice:
```
Header currently says implied 10. Ensure it says 11 after 012:
```
rispondi a queste 11 domande **prima** di scrivere codice:
```
Or if 012 not yet merged, keep dynamic: ensure the count matches actual `☐` items (11).

**Verify**: `grep -c "☐" my-docs/GUIDE-CODING_PRACTICES.md` == number in header (11).

### Step 2: Rewrite LLM instructions block (GUIDE:327-368) to 13 bullets

Replace the 11-bullet block with 13 bullets, preserving existing 11, adding:

`12. **MAI cancellare righe utente in bt_gui.db** — vedi §11. Per test usa solo prefissi test_/tmp_/mock_ e sqlite:///:memory:.` (already added in 012, ensure present and correctly worded)

`13. **Ponytail di default: soluzione più corta che funziona** — marca scorciatoie con // ponytail: e verifica con npm run build / pytest prima di dichiarare done (AGENTS.md:99-101).`

Also update the intro line of that section from:
```
## Regole di architettura per bt-gui
1. **File sotto le 300 righe**...
```
To include the same 13, and fix the copy-paste instruction: keep `## Regole di architettura` header but ensure bullet count matches.

Preserve the closing ``` fence.

**Verify**: `sed -n '327,368p' my-docs/GUIDE-CODING_PRACTICES.md | grep -c "^\s*[0-9]\+\."` → 13; `grep -n "ponytail" my-docs/GUIDE-CODING_PRACTICES.md | grep -i "Ponytail di default"` → 1.

### Step 3: Fix AGENTS.md stale lines (2 lines only)

Edit `AGENTS.md:42`:
```
Checklist completa per nuove feature nella guida cap. "Checklist per nuove feature" — spunta tutti i 10 punti prima di aprire PR.
```
→ `... tutti gli 11 punti ...` (after DB rule added).

Edit `AGENTS.md:77`:
```
- Piani in `./plans/`: `001-bootstrap` → `005-integration-stocks-app`. Segui l'ordine, rispetta STOP conditions e Done criteria.
```
→ `... 001-bootstrap → 006-indicator-support (e advisor-plans/001-011).` (reflect actual plans at 198124c: 001-006 in plans/, 001-011 in advisor-plans/).

Add a sync note below `AGENTS.md:3`:
```
> Sync: questo estratto è generato da GUIDE-CODING_PRACTICES.md:50-246 — mantieni allineati (ponytail + DB §11).
```
Keep it one line to avoid bloat.

**Verify**: `grep -n "11 punti" AGENTS.md` → 1; `grep -n "006-indicator-support" AGENTS.md` → 1; `grep -n "Sync:.*GUIDE" AGENTS.md` → 1.

### Step 4: Full verification

**Verify**: `uv run ruff check .` → exit 0; `npm run build --prefix frontend` → exit 0; `uv run pytest -q` → all pass; `diff <(grep -E "^[0-9]+\." my-docs/GUIDE-CODING_PRACTICES.md | head -20) <(grep -E "^[0-9]+\." AGENTS.md | head -20)` — counts match (11 vs 11, LLM 13 vs extracted 11 + 2 extra noted — acceptable).

## Test plan

No code tests. Docs verification as above. Pattern: `AGENTS.md:28-42` as excerpt of `GUIDE:50-246`.

## Done criteria

Machine-checkable. ALL must hold:
- [ ] `grep -c "☐" my-docs/GUIDE-CODING_PRACTICES.md` == 11
- [ ] `grep -c "MAI cancellare righe utente" my-docs/GUIDE-CODING_PRACTICES.md` ≥1 (in LLM bullets)
- [ ] `grep -c "ponytail" my-docs/GUIDE-CODING_PRACTICES.md` ≥1 (in LLM bullets)
- [ ] `grep -n "11 punti" AGENTS.md` ≥1
- [ ] `grep -n "Sync:.*GUIDE" AGENTS.md` ≥1
- [ ] `uv run ruff check .` exits 0 and `npm run build --prefix frontend` exits 0
- [ ] Only `my-docs/GUIDE-CODING_PRACTICES.md` and `AGENTS.md` modified

## STOP conditions

Stop and report back (do not improvise) if:
- `my-docs/GUIDE-CODING_PRACTICES.md` no longer has 11 checklist items after 012 (011/012 not merged) — count would be 10, need to apply 012 first.
- `AGENTS.md:3` no longer says “vince la guida” — normative assumption broken.
- A step's verification fails twice.
- The fix appears to require touching `backend/*` or `frontend/*`.

## Maintenance notes

- Future rule additions: add to `GUIDE:50-246` first, then copy excerpt to `AGENTS.md:28-42` and LLM block `GUIDE:327-368` in the same commit; the Sync note reminds.
- Reviewers should check that `GUIDE` bullets 1-11 match `AGENTS.md` 1-11 verbatim (minus formatting).
- Deferred: automation script to generate `AGENTS.md` excerpt from `GUIDE` — L effort, not now.
