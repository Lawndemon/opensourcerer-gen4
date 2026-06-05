# Instructions for Coding Agents

This file contains instructions for developers and AI agents working on
<!-- TODO: project name + one-line description -->.

**Always keep this file up to date with any changes to the codebase or
development process.** A stale agent-instructions file is worse than none —
update it in the same change that invalidates it. If you notice it no longer
reflects reality, fix it.

---

## Ways of working

These are project-agnostic conventions carried across projects. They are
ready to use as-is.

### The backlog is the source of truth between sessions

`BACKLOG.md` is the durable task list. Transient in-session/IDE task lists
reconcile *against* it, never the reverse. Before ending a working session,
make sure anything worth keeping has landed in `BACKLOG.md` — the session
context is disposable; the backlog is not. See that file's "How to maintain
this file" section for its own discipline.

### Plan non-trivial features in a plan doc

For any feature that spans more than a session or has open design questions,
write a `docs/<feature>_plan.md` from `docs/feature_plan_template.md` *before*
building. It forces the in-scope/out-of-scope line, the locked decisions, the
open questions, and the test plan to exist on paper first. The backlog links
to it; the plan doc holds the detail.

### Date and attribute decisions

When a decision is made — especially one resolved with a stakeholder — record
it with **who + when** (e.g. "Locked 2025-06-05, per <name>"). Provenance is
the point: future-you needs to know not just what was decided but on whose
authority and when, so a later reversal is an informed one.

### Document trade-offs, not just outcomes

When you ship something with a known compromise, write down the trade-off you
accepted and *why* — and the levers available if it ever bites. "What changed"
is half the record; "what we chose not to do and why" is the half that saves
the next person.

---

## Engineering principles

Opinionated defaults. Override deliberately, not by accident.

- **Don't over-engineer for placeholder data.** Sample/fixture data is a stand-in
  for messier real input. Build for the real shape, not the tidy placeholder —
  and don't build answer-keys or schemas around fixtures you'll throw away.
- **Fail fast on architecture.** If a structural call turns out wrong, reverse it
  promptly — a same-session reversal is cheaper than building atop a bad shape.
  Record the reversal and the reasoning so the decision trail survives.
- **Never block the critical path.** Identify the one path that must always stay
  responsive for the user, and push everything non-essential (heavy generation,
  secondary work) off it — background it, don't serialize it.
- **Segregate demo-only affordances from production code.** Anything that exists
  only for demos/testing lives in a clearly-marked, removable unit — never
  interleaved with production logic where it can't be cleanly excised later.
- **Where there's a record of truth, make it immutable and audited.** Append-only,
  no edit/delete, every state change logged with who/when. Derived artifacts
  (reports, summaries) are regenerable and must trace back to the source.
- **AI is decision support, not an oracle.** Where the system proposes and a human
  is accountable, keep a human-attestation step and make AI-vs-human provenance
  visible. Don't let generated output read as authoritative on its own.

<!-- TODO: add or remove principles to fit this project. -->

---

## Overall code layout

<!-- TODO: describe the top-level structure. Example skeleton below — replace. -->

* `<dir>/` — <!-- what lives here -->
  * `<subdir>/` — <!-- ... -->
* `tests/` — test code (see "Tests" below).

---

## How to add X (recipes)

Keep a short, copy-pasteable recipe for each repeated "add a thing" operation,
listing every file that must change. This is the highest-value part of the
file for an agent.

### Adding <!-- TODO: e.g. a new config setting / env var / API endpoint -->

<!-- TODO: enumerate the files to touch, in order. Example:
1. `path/to/model` — add the field
2. `path/to/ui` — add the control
3. `path/to/handler` — wire it through
-->

---

## Tests

<!-- TODO: describe the test framework(s) and how to run them. -->

State the **test taxonomy** and, for a given change, *which* kind of test it
needs:

- **End-to-end** — <!-- tool, scope --> for user-facing flows.
- **Integration** — <!-- scope --> for API endpoints / module seams.
- **Unit** — for individual functions/methods.

When adding a feature, add the matching test. UI element → e2e; endpoint →
integration; function → unit. Prefer shared mocks/fixtures over bespoke ones.

<!-- TODO: coverage command + how to read its output, if any. -->

---

## Code style

<!-- TODO: state the rules plainly. Examples:
- Naming conventions this project does / does not follow.
- Formatter/linter and how it's run.
- Any house rules that differ from language defaults.
-->

Match the surrounding code — its comment density, naming, and idioms — over any
external style preference.

---

## Pre-commit gate

Before committing, run <!-- TODO: type-check + tests + lint commands -->. Don't
commit red. If a check is skipped, say so explicitly rather than implying it
passed.

---

## Dependency upgrades

<!-- TODO: per-ecosystem upgrade + verify workflow. -->

---

## Deploying

<!-- TODO: how this project ships. -->
