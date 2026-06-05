# Project Starter Kit — Ways of Working

A portable, domain-agnostic set of working conventions distilled from a prior
project. Drop these into a new repo to carry over *how we work together*
without dragging along any of the previous project's domain specifics.

## What's in here

| File | Purpose | What to do with it |
|---|---|---|
| `AGENTS.md` | Instructions for coding agents: code layout, "how to add X" recipes, test discipline, code style, and the engineering principles we hold to. | Copy to repo root. Fill the `<!-- TODO -->` placeholders with this project's specifics. The "Ways of working" and "Engineering principles" sections are ready to use as-is. |
| `BACKLOG.md` | Durable, between-sessions source-of-truth task list, with the maintenance discipline baked in. | Copy to repo root. Start empty under each heading; the "How to maintain this file" section is the part that carries over. |
| `docs/feature_plan_template.md` | Per-feature implementation-plan template: scope, locked decisions, sessions, test plan, risks/rollback. | Copy to `docs/`. Duplicate per feature (e.g. `docs/<feature>_plan.md`). |

## How to use

1. Copy the three files into the new repo (`AGENTS.md` and `BACKLOG.md` at
   root, the template into `docs/`).
2. Work through the `<!-- TODO -->` markers in `AGENTS.md` to describe the new
   codebase. Delete recipes that don't apply; add ones that do.
3. Keep `AGENTS.md` and `BACKLOG.md` current as the project evolves — that
   upkeep *is* the discipline, not overhead on top of it.

## The two things that matter most

If you internalize nothing else from this kit:

- **`BACKLOG.md` is the source of truth between sessions.** Transient
  in-session task lists reconcile against it, never the reverse. Capture the
  *why* of non-obvious decisions — especially the reasonable alternative you
  rejected.
- **`AGENTS.md` stays in lockstep with the codebase.** A stale agent-instructions
  file is worse than none; update it in the same change that invalidates it.
