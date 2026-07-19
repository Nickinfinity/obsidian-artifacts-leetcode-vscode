# Example exercises — VSX-122

Derived view of [plan.md](plan.md) (the authority). Same wave numbers, same review loop, same
worker/reviewer templates. E-tasks are content tasks: each produces one runnable `.md` exercise
artifact in the vault format.

**Where the artifacts live:** a new tracked `examples/leetcode/` directory at the repo root —
**not** under `docs/`, deliberately: `docs/` dies before the PR merges, but the examples are
permanent deliverables. They serve three duties at once: the F5 manual passes (T9, T21, T29)
click through them, `ARTIFACT_LEETCODE_FILE_FORMAT.md` links them as living reference, and a
fixtures test keeps them honest forever.

**Authoring rule:** every example must be *solvable and failable* — it ships with a reference
solution in `# Solutions`, at least one public and one hidden test, and a difficulty tag. An
example that cannot fail teaches nothing and proves nothing in an F5 pass.

---

## E0 — Examples fixtures test

The one guard that stops every other E-task from rotting.

- **Owns:** `test/examples.test.ts`
- **Reads:** `examples/leetcode/*.md`, `src/services/leetcode-parser.service.ts`
- **Depends on:** E1 (first artifact to point at)
- **Test first:** parsing every file under `examples/leetcode/` yields zero parse warnings, a
  non-empty public suite, and a known `test.type` — fails while the directory is empty, passes
  when E1 lands.
- **Done when:** the test globs the directory (new examples are guarded automatically, no
  per-file registration) and asserts per type: `function` examples have `params`/`returns`;
  `class` examples have ops-shape cases; `libs:` examples pass the allowlist.
- **Gate:** full gate.

> `CLAUDE.md` says "fixtures inline, no `test/fixtures/`" — this is not that: `examples/` is a
> shipped deliverable the test *reads*, not a fixtures directory the test *owns*. Note this in
> the test's header comment so the rule isn't "fixed" later.

## E1 — `two-sum` five-language function exercise (wave 4, feeds T9)

- **Owns:** `examples/leetcode/two-sum.md`
- **Depends on:** T1–T7 (needs Rust + TypeScript runnable)
- **Test first:** E0 covers it.
- **Done when:** frontmatter declares `function`, `params`, `returns`; `# Setup` carries one
  starter fence per language **including `rust` and `ts`** (the aliased heading proves alias
  resolution); 2 public + 2 hidden cases; solvable end-to-end in all five languages.
- **Gate:** full gate + it is the artifact T9's click-path runs twice.

## E2 — `deep-pick` with lodash (wave 8, feeds T21)

- **Owns:** `examples/leetcode/deep-pick-lodash.md`
- **Depends on:** T16
- **Done when:** `libs: { javascript: ["lodash@4.17.21"], typescript: ["lodash@4.17.21"] }`; the
  reference solution actually calls `require('lodash')` (an example whose solution never touches
  the lib proves nothing); first run installs, second hits the cache.

## E3 — `matrix-diagonal-sum` with numpy (wave 8, feeds T21)

- **Owns:** `examples/leetcode/matrix-diagonal-sum-numpy.md`
- **Depends on:** T17
- **Done when:** `libs: { python: ["numpy"] }`; solution imports numpy; runs via the venv
  interpreter. Unpinned on purpose — it exercises the documented unpinned-libs path.

## E4 — `parse-config` with serde_json (wave 8, feeds T21)

- **Owns:** `examples/leetcode/parse-config-serde.md`
- **Depends on:** T18
- **Done when:** `libs: { rust: ["serde_json@1"] }`; builds via the Cargo path with shared
  `target/`; second run is measurably incremental.

## E5 — `libs.java` negative example (wave 8, feeds T21)

- **Owns:** `examples/leetcode/java-libs-unsupported.md`
- **Depends on:** T14
- **Done when:** declares `libs: { java: ["com.google.guava:guava"] }` and its **description
  says it exists to demonstrate the refusal** — opening it and selecting Java shows the T14
  message. A negative example that looks like a broken exercise is a bug report waiting to
  happen; the self-description is the point.

## E6 — `lru-cache` class exercise (wave 12, feeds T29)

- **Owns:** `examples/leetcode/lru-cache.md`
- **Depends on:** T24, T25
- **Done when:** `test.type: class`; ops-sequence cases including one eviction (the case that
  actually distinguishes an LRU from a map); setups for at least python and java (one
  interpreted, one compiled — T29's requirement).

## E7 — `remove-duplicates` mutation exercise (wave 12, feeds T29)

- **Owns:** `examples/leetcode/remove-duplicates-inplace.md`
- **Depends on:** T26
- **Done when:** `test: { type: function, mutates: nums }`; the reference solution returns
  nothing useful (return is ignored — that *is* the demonstration); grading compares the
  mutated array.

## E8 — `sum-lines` stdin/stdout exercise (wave 12, feeds T29)

- **Owns:** `examples/leetcode/sum-lines-stdio.md`
- **Depends on:** T27
- **Done when:** `test.type: stdin-stdout`; `{"stdin": …, "stdout": …}` cases; the setup stub
  reads stdin and prints — demonstrating that the solver's own `print` is the answer, not a
  sentinel corruption.

## E9 — React + TS + CSS project exercise — **deferred to the Phase 3 spike**

- **Owns:** `examples/leetcode/react-counter-project.md` (draft inside the spike)
- **Done when:** `test.type: project`; `## Files` with an editable `.tsx`, an **ungraded**
  `.css` (explicitly scaffolding), a hidden `package.json`; checks = one `build` + one
  `function`. **Writing this artifact is a spike deliverable, not documentation after the
  fact** — a concrete exercise is the cheapest way to force the contract to confess its gaps.

## E10 — FastAPI + React service exercise — **deferred to the Phase 4 spike**

- **Owns:** `examples/leetcode/fastapi-react-service.md` (draft inside the spike)
- **Done when:** `test.type: service`; two `services:` with `${PORT}` templating and `exposeAs`;
  an `http` check against the API; the frontend consumes the injected URL without the solver
  ever seeing the wiring. Same spike-deliverable rule as E9.

---

## Wave placement

| Wave | E-tasks | Runs alongside | Agent |
|---|---|---|---|
| 4 | E1, then E0 | T8 · T9 · T10 | 1 × sonnet (serial: E1 → E0) |
| 8 | E2 · E3 · E4 · E5 | T20 · T21 | 1 × sonnet (four small artifacts, one concern: Phase 2 examples) |
| 12 | E6 · E7 · E8 | T28 · T29 | 1 × sonnet |
| spike | E9 · E10 | Phase 3 / Phase 4 spikes | inside the spike |

E-tasks are reviewed like code tasks: the reviewer checks format-spec compliance, the
solvable-and-failable rule, and that `libs:` values pass the allowlist. The F5 human gates
(T9/T21/T29) then consume these exact artifacts — if an F5 pass needs an exercise the E-tasks
didn't produce, that is a planning bug to record in the ledger.

## Jira

One story per wave-group, parented to VSX-122: `<KEY>` E1+E0 (wave 4, 2 pts) · `<KEY>` E2–E5
(wave 8, 3 pts) · `<KEY>` E6–E8 (wave 12, 3 pts) · E9/E10 ride inside the spike stories.
