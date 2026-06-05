# <Feature Name> — Implementation Plan

**Status as of <YYYY-MM-DD>:** <one-line current state, e.g. "Sessions 0–2 complete; Session 3 in progress.">

<One-paragraph framing: what this feature is, the vertical slice it delivers,
and what is deliberately deferred. This is the build-side companion to the
relevant `BACKLOG.md` entry — link it.>

## Goal

<The demoable / shippable end state, in concrete terms. What can someone do
when this is done that they couldn't before? List the things a stakeholder
should be able to validate.>

## In scope

- <thing>
- <thing>

## Out of scope (deferred)

- <thing> — <why deferred / where it's tracked instead>
- <thing>

## Decisions

<Locked decisions, each dated + attributed. Record the rationale and the
alternative you rejected. Use a stable id (D1, D2, …) so other docs can
reference them.>

### D1. <decision> — **Locked (<date>, per <who>)**

<The decision, the why, and any contract/shape it pins down (interfaces,
schemas, endpoints). Put the actual contract here so it's unambiguous.>

### D2. <decision> — **Locked**

...

## Open questions

<Tracked questions. When one resolves, strike it through and append the
resolution + date rather than deleting — the decision trail matters.>

1. <open question>
2. ~~<resolved question>~~ — RESOLVED <date>: <resolution>.

## Files involved

<Anticipated files to add/change, grouped (backend / frontend / data / infra).
File anchors make the plan actionable and reviewable.>

### <group>

- New: `<path>` — <purpose>
- Edit: `<path>` — <what changes>

## Sessions

<Session-by-session sequencing. Each session has a crisp end-state so "done"
is unambiguous. Mark completed sessions with ✓ + date.>

### Session 0 — <resolve open decisions> ✓ (<date>)

<what was settled>

### Session 1 — <first build slice>

**End state:** <what is true when this session is done.>

- <task>
- <task>

### Session N — <demo polish / hardening>

...

## Test plan

<Per-session manual verification lives in each session's end-state. List the
cross-cutting checks to run before declaring the feature done.>

- <check>
- <check>

## Risks and rollback

- **Risk:** <the real risk — usually not the obvious wiring> — *Mitigation:* <how>.
- **Rollback:** <how to disable/revert cleanly. Prefer additive changes gated on
  a single flag/check so reverting is a one-line change.>
