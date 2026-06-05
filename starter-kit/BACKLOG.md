# Backlog

Durable task list for <!-- TODO: project name -->. This file is the source of
truth between sessions; transient in-session/IDE task lists are disposable and
should be reconciled against this document.

**Last updated:** <!-- TODO: YYYY-MM-DD + one-line note on what changed -->

---

## In flight

_Nothing in flight — pick up from "Next up"._

---

## Next up

<!--
One ### entry per work item, roughly in priority order. For anything non-trivial,
capture:
- What it is and why it matters.
- Key design decisions, each dated + attributed.
- The reasonable alternative you rejected, and why (the part future-you needs).
- Dependencies / sequencing / what blocks it.
- The real engineering risk to verify (not the obvious wiring).
Link out to a docs/<feature>_plan.md for anything that warrants a full plan.
-->

---

## Design & build

<!--
Longer-lived design context and architecture-of-record that outlives a single
work item. Refined entries note when and with whom they were refined.
-->

---

## Notes on infra / deploy / external constraints

<!-- Gotchas, costs, things that conflict on upgrade/rebase, environment quirks. -->

---

## How to maintain this file

- Checkboxes for concrete work items, prose for design rationale.
- When something non-obvious is decided — *especially* trade-offs where you
  rejected a reasonable-sounding alternative — capture the *why*, not just the
  *what*. Future-you will thank present-you.
- Date and attribute decisions (who + when), so a later reversal is informed.
- When a task is done, move its contents into a dated entry under "Done" —
  don't delete it. This file is a record of decisions, not just open work.
- Done-entry shape: **Outcome / What changed / Decisions locked / Trade-offs
  accepted / Verified**. Keep it consistent so the history is scannable.
- If this file gets unwieldy (> ~400 lines), that's the signal to migrate to a
  proper issue tracker.

---

## Done

<!--
Dated entries, newest first. Each one is a permanent record of a decision and
its rationale — never pruned. Template:

### YYYY-MM-DD — <short title>

**Outcome:** <what is now true that wasn't before>

**What changed:** <files / modules touched, briefly>

**Decisions locked:** <any decisions made, dated + attributed>

**Trade-offs accepted:** <known compromises + the levers if they bite>

**Verified:** <how you confirmed it works>
-->
