# Jira tickets — CoderByte migration

Ready-to-create specs. The Atlassian connector is **not authorized in this session**, so this file is the
deliverable; create the tickets in one pass afterwards and fill the `<KEY>` placeholders. Never fabricate keys.

Parent epic context: this work sits under **VSX-122** (multilib/multilang support), itself under the
LeetCode-trainer epic **VSX-35**. Each phase below is an epic (or story-cluster) under VSX-122.

---

## Epic 1 — Readiness + verification harness `<KEY>`

**Summary:** Build the uniform exercise-verification harness and de-risk function execution.
**Description:** A single `verifyExercise` harness asserts every migrated `.md` conforms to the format (2 examples, ≥6 public, ≥3 final, params↔input keys) and **runs** — the reference solution(s) go green through the real runner. A CLI + a mocha wrapper that skips cleanly when the external vault is absent (keeps the committed gate portable). A type-diverse pilot migration drives it end to end and fixes any execution defects (TDD each).
**Acceptance criteria:**
- `node scripts/verify-exercise.mjs <file>` exits 0 on a green exercise, non-zero with a readable reason otherwise (and errors readably if `dist/` is absent — compile first).
- `verifyExercise` enforces the `## Examples ⊆ ## Tests` ground-truth pin and the ≥2 examples / ≥6 public / ≥3 final floors.
- Absent vault path → the mocha wrapper yields 0 cases, gate green.
- Four pilot exercises (a string, an array, a matrix, a tree) verify green in **all five** languages.
- Each execution fix has a failing-first regression test.
**Stories:** T0.1 pure helper · T0.2 CLI + wrapper · T0.3 pilot + fixes.
**Security:** runs solution code + walks an external path — reviewer manual trace required.
**Estimate:** M (3 stories).

## Epic 2 — Migrate 55 function exercises (all 5 green) `<KEY>`

**Summary:** Re-shape the 55 CoderByte function exercises into runnable `type: leetcode` artifacts in the vault.
**Description:** Per exercise: frontmatter (`function`/`params`/`returns`/`test.type: function`), Markdown description preserving the original objective, ≥2 `## Examples` (each pinned into the public suite), ≥6 public `## Tests`, ≥3 hidden `## Final Tests`, bare `# Setup` stubs and green `# Solutions` in java/python/javascript/typescript/rust. Discard the CoderByte `class Main`/Scanner harness (runner forbids stdin candidates). Files land in `/Users/nick/N0t3s/L33tC0d3/CoderByte/<Topic>/` only — not committed.
**Acceptance criteria:**
- Each exercise verifies green via the harness (structural floors + all 5 languages public+final).
- Examples ≥2 (each also present as a public `## Tests` case — the source I/O pins); public ≥6; final ≥3.
- Output encoding is cross-language deterministic (float/map/unordered → integer/rational/fixed-precision/sorted, or ESCALATE).
- TS reference solution is strip-only (no enum/namespace/decorators/param-properties).
- Original problem essence/objective preserved; only I/O encoding normalised.
**Stories:** one per inventory row E01–E55 (batched into waves 1–6 by topic; see `plan.md` §G). E42 (RREF Matrix) is its own story, flagged may-ESCALATE (cross-language float encoding).
**Security:** source `.md` + authored test JSON are untrusted — reviewer confirms no stdin candidate, no title-in-path.
**Estimate:** XL (55 stories; homogeneous, template-driven).

## Epic 3 — SQL exercise as reserved artifact `<KEY>`

**Summary:** Migrate `SQL Contains Letter` as a reserved, ungraded artifact.
**Description:** New-format artifact with a reserved `test.type` so `languagesForType()` is `[]` and the panel explains "no environment". Query prose + example table preserved.
**Acceptance criteria:** parses; lists in picker; panel shows the no-env explanation; nothing is graded.
**Open (human gate):** reuse an existing reserved token vs add a new `sql` row to `TEST_TYPES` (a format change → updates `ARTIFACT_LEETCODE_FILE_FORMAT.md`).
**Estimate:** S (1 story).

## Epic 4 — `project`/react runtime environment `<KEY>`

**Summary:** Implement the reserved `project` test type end to end so React (JSX+CSS) exercises run and grade.
**Description:** Closes the spike-findings gaps: case→check binding grammar, per-check params/returns, `.tsx`/`.jsx`/`.css` recognition, `role:readonly` mechanism, JSX/TSX bundling (esbuild), per-run npm install (react + react-dom + jsdom + bundler) gated by `validateLibNames`, `## Files` tree materialisation with path containment, and `dom-assert`/`css-assert`/`build`/`function` check kinds rendered in jsdom. Updates `ARTIFACT_LEETCODE_FILE_FORMAT.md` for every grammar change.
**Acceptance criteria:**
- `project` flips reserved→runnable; a react artifact renders and grades via `dom-assert`.
- `libs:` entries pass the allowlist before any install; install/start are argv arrays, never strings.
- React toolchain installs into a shared cache keyed on libs+versions, reused across runs, behind its own timeout (separate from the per-suite grading cap); offline-tolerant once warm.
- `css-assert` grades declared/inline style + class presence only — never layout geometry (jsdom has no layout engine); ponytail ceiling recorded.
- Every user path (`## Files` `path`, check `dir`) is normalised + containment-asserted.
- Format spec updated in the same change as each grammar change.
**Stories:** HG design decisions (1) · T2.1–T2.8.
**Security:** installs + executes artifact-declared packages (arbitrary code by design) — the top security-critical cluster; reviewer manual trace on every story; no merge on self-report.
**Estimate:** XL (design gate + 8 stories).

## Epic 5 — Migrate 4 React exercises `<KEY>`

**Summary:** Migrate Tic Tac Toe, Phone Book, Letter Tiles, Context API onto the `project` env (js + ts only).
**Description:** Each artifact carries `## Files` (component `.tsx`/`.jsx` + `.css`), `libs: { javascript/typescript: [react, react-dom] }`, and `dom-assert` checks encoding the exercise essence (§F.3 of the plan).
**Acceptance criteria:** each renders and grades green through the Phase-2 harness branch; essence preserved.
**Stories:** E57 Tic Tac Toe · E58 Phone Book · E59 Letter Tiles · E60 Context API.
**Depends on:** Epic 4.
**Estimate:** L (4 stories).

---

**Creation order:** Epic 1 → Epic 2 → Epic 3 → Epic 4 → Epic 5. Epics 1–3 (Phases 0–1) may ship as one PR
before Epic 4 begins.
