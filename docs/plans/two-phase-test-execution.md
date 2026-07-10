# Two-Phase Test Execution + Pluggable Test Environments

## Context

Today the preview panel has one run path: **Submit**, which executes every case
in the artifact's single `## Tests` block and, on a full pass, patches
`status: solved`. There is no way for a solver to check their work mid-challenge.

That collapses two distinct needs into one button:

- **Iterating** — while the clock runs, fast feedback on a small visible set. Must not grade or end the challenge.
- **Grading** — at the end, a larger set including unseen cases decides completion.

Underneath sits a second problem. How a test actually *executes* is hardcoded in
one function: [leetcode-runner.service.ts:99](../../src/services/leetcode-runner.service.ts#L99)
`buildSingleTestSource` branches on `runner.id === 'python'` and otherwise falls
through to a JavaScript template. So **Java Submit has never worked** — a Java
attempt gets JS source written into `Main.java` and dies at `javac`. Adding a
second button on top of that if/else would repeat the mistake.

So the execution strategy becomes data: a **test environment** is a
`(test type × language)` pair that knows how to emit a runnable program from a
function name, inputs, and expected values, and how to parse its output back
into per-case outcomes. Absence of a pair *is* the capability matrix.

Finally, some challenges will need several languages cooperating. That schema is
**designed here and built later** — it constrains the frontmatter and the
`# Setup` heading rules, so it must be settled now to avoid a breaking rewrite.

## Decisions (confirmed with the user)

| Question | Decision |
|---|---|
| `.md` test-list schema | Two sections: `## Tests` (public) + `## Final Tests` (grading) |
| What Submit runs | Public **and** final, concatenated. Completion = all of both pass |
| Legacy file, no `## Final Tests` | Both buttons fall back to `## Tests`. No migration |
| Submit with failures | Challenge **ends**. `status: attempted`. Timer stops, restrictions lift |
| Run Tests, no live challenge | Button renders disabled; handler also guards with a toast |
| Final-test visibility | Counts shown (`2 public · 5 final`). Result rows mask the input JSON |
| After a failed Submit | Solve It reopens the same temp file, timer restarts, Submit re-arms. `attempted → solved` allowed |
| Harness | Own zero-dep env by default, behind an interface that permits lib-backed envs |
| Test types | `function` implemented. `class`, `stdin-stdout`, `in-place` reserved as ids |
| Execution | One process per click: all cases in one file, compiled once, run once |
| Comparison | Canonical JSON (sorted keys, no spaces) on both sides |
| Frontmatter | New `test:` block, mirroring the existing `practice:` block |
| Unsupported `(type × language)` | Language omitted from the selector entirely |
| Polyglot | Schema + interaction model designed now, implemented under a separate epic |

---

## Architecture: the test-environment registry

### Why an interface rather than "own env"

The extension ships zero runtime dependencies and has no install path — a JUnit
env would need a jar the user must supply. So the *default* implementations are
self-contained. But the lookup must not care: a future `function × java` env
backed by JUnit, or `class × kotlin` backed by kotest, has to drop in without
touching the runner.

### New folder — `src/services/test-envs/`

```
test-envs/
├── env.types.ts            # TestTypeId, TestEnv, EnvContext, CaseOutcome
├── env.registry.ts         # register(), testEnvFor(), languagesForType()
└── function/
    ├── java.env.ts         # own-env, batch, __json() serializer
    ├── python.env.ts       # own-env, json.dumps(sort_keys, separators)
    └── javascript.env.ts   # own-env, canonical stringify
```

```ts
/** One case's outcome as reported by the generated program. */
interface CaseOutcome {
  index: number;
  actual?: string;   // canonical JSON of the return value
  error?: string;    // thrown / raised message
  ms: number;
}

/** Everything an env needs to emit a runnable program. */
interface EnvContext {
  parsed: ParsedLeetCode;
  langId: string;
  code: string;        // candidate source, already resolved by buildExecutable
  cases: TestCase[];   // the whole suite — one file, one process
}

interface TestEnv {
  type: TestTypeId;                    // 'function'
  language: string;                    // 'java'
  requires?: string[];                 // e.g. ['junit5'] — omitted for own-env
  detect?(): Promise<boolean>;         // preflight, only when `requires` is set
  emit(ctx: EnvContext): string;       // full source, all cases
  parse(stdout: string): CaseOutcome[];
}
```

`testEnvFor(type, langId)` returns `TestEnv | undefined`. `languagesForType(type)`
drives the language selector — no separate capability table to keep in sync.

### The batch protocol

The generated program prints **one line per case** to stdout, each prefixed with
a sentinel so incidental `print`/`console.log` from the solver's code cannot
corrupt parsing:

```
__LEET__{"index":0,"actual":"[0,1]","ms":3}
__LEET__{"index":1,"error":"IndexError: list index out of range","ms":1}
```

Each case is wrapped in the target language's try/catch so one throw does not
abort the suite. `parse()` collects the sentinel lines and ignores everything else.

**Timeout attribution.** The suite gets one wall-clock timeout
(`cases.length × test.timeoutMs`, capped at 60 s). An infinite loop kills the
process, but `execAsync`'s `ExecErr` already carries the partial `stdout`
([leetcode-runner.service.ts:50](../../src/services/leetcode-runner.service.ts#L50)) —
so the cases that already printed are recovered, and every index from the first
missing one onward is marked `error: 'timeout'`. This is why the sentinel matters:
partial stdout must still be parseable.

### Comparison

New `src/utils/canonical-json.ts` → `canonicalJson(value: unknown): string` —
recursive, object keys sorted, no whitespace. The extension normalizes
`testCase.expected` through it; each env emits the same shape from its own
language. `passed = outcome.actual === canonicalJson(expected)`.

This replaces `stdout.trim() === JSON.stringify(testCase.expected)`
([leetcode-runner.service.ts:206](../../src/services/leetcode-runner.service.ts#L206)),
under which Java's `Arrays.toString` → `[0, 1]` can never match `[0,1]`, and
object key order is a coin flip.

### The three `function` envs

All three inject the candidate code at a `<<SOLUTION>>` marker and emit a driver
loop over the cases. Argument literals come from `jsonToLiteral(value, lang)`
([leetcode-codegen.service.ts:256](../../src/services/leetcode-codegen.service.ts#L256));
signature types from `mapType`
([leetcode-codegen.service.ts:44](../../src/services/leetcode-codegen.service.ts#L44)).

- **java** — `Main.java` (fixed by `javaRunner.fileName`), `class Main`. Needs a
  generated `static String __json(Object)` covering `int[]`, `int[][]`,
  `String[]`, `Object[]`, `List`, `Map` (keys sorted), `String` (quoted),
  `Number`, `Boolean`, `null`. Java has no stdlib JSON. Cases dispatch through
  `java.util.function.Supplier<String>` so each can be try/caught independently.
  **Compiles once for the whole suite** instead of once per case.
- **python** — `json.dumps(v, sort_keys=True, separators=(',', ':'))` is already
  canonical. Per-case `try/except Exception as e`.
- **javascript** — small recursive canonical stringifier; per-case `try/catch`.

### Runner rewrite — [src/services/leetcode-runner.service.ts](../../src/services/leetcode-runner.service.ts)

`runSingleTest` and `runAllTests` are replaced by:

```ts
export async function runSuite(
  code: string, tests: TestCase[], runner: LangRunner,
  parsed: ParsedLeetCode, env: TestEnv,
): Promise<TestResult[]>
```

One `mkdtemp`, one `env.emit()`, one write, one optional `runner.compile`, one
`runner.run`, then `env.parse(stdout)` → map to `TestResult[]` via
`canonicalJson` comparison. A compile failure fills every case with the same
`compilation error: …` — the same user-facing outcome the current
short-circuit at [leetcode-runner.service.ts:253](../../src/services/leetcode-runner.service.ts#L253)
produces, now for free.

`detectRuntime(runner)` is unchanged. `env.detect()`, when present, gates in
addition to it.

`buildSingleTestSource` is deleted. `test/leetcode-runner.test.ts` is rewritten
against `runSuite`.

---

## Frontmatter: the `test:` block

Parsed by a new `parseTestBlock`, structurally a sibling of the existing
`parsePracticeBlock` ([leetcode-parser.service.ts:167](../../src/services/leetcode-parser.service.ts#L167)).
An absent block defaults to `{ type: 'function', timeoutMs: 5000 }`.

```yaml
test:
  type: function      # TestTypeId — unknown value falls back to 'function' + a parse warning
  timeoutMs: 5000     # per case; suite budget is cases × this, capped at 60000
```

`TEST_TYPES` lands in [src/types/constants.ts](../../src/types/constants.ts) as a
`readonly TestType[]`, alongside `PRACTICE_OPTIONS`:

| id | Status | Semantics |
|---|---|---|
| `function` | **implemented** | Call a free function with positional args, compare the return |
| `class` | reserved | Instantiate, invoke a method sequence, compare the sequence of returns (LRUCache, MinStack) |
| `stdin-stdout` | reserved | Feed raw stdin, compare trimmed stdout |
| `in-place` | reserved | Compare a mutated argument rather than the return (removeDuplicates) |

Reserved ids parse and validate but have no env registered, so
`languagesForType` returns `[]` and the panel shows no selectable language —
the correct, self-explaining failure.

---

## Polyglot: schema now, implementation later

A separate Jira epic. Nothing below is built in this feature; it is fixed here
so the parser and heading rules do not need a breaking change.

### Model: driver + implementations over JSON stdio

One component is the **driver** — it owns the case loop. The others are
**implementations**, invoked as subprocesses. The driver writes one JSON line per
invocation to the impl's stdin and reads one JSON line from its stdout:

```
→ {"fn":"twoSum","args":[[2,7,11,15],9]}
← {"ok":true,"value":[0,1]}
← {"ok":false,"error":"IndexError"}
```

No ports, no shared files, no ordering constraints beyond spawn-before-invoke.
Today's single-language `function` test is the degenerate case where driver and
impl are the same process — which is why this generalizes cleanly.

### Frontmatter

```yaml
test:
  type: function

components:
  - id: solver
    language: python
    role: impl
  - id: driver
    language: javascript
    role: driver
    invokes: [solver]
```

### Heading binding rule

- **No `components:` block** → `# Setup` / `# Solutions` sub-headings are
  languages: `## Python`. Today's behaviour, unchanged.
- **`components:` present** → sub-headings are component ids: `## solver`. The
  language comes from the component declaration, not the heading.

This is the only parser change polyglot forces, and it is backward compatible.

### Reserved extension points

`TestEnv` gains an optional `emitImplShim(ctx): string` — the impl side of the
contract. An env that only implements `emit` is single-language-only. `runSuite`
grows a sibling `runPolyglotSuite`. Neither is written now.

---

## Behaviour matrix

| Scenario | Run Tests | Submit |
|---|---|---|
| No challenge active | Disabled + toast "Press Solve It first" | Falls back to stored `# Solutions` code (existing); results only, no frontmatter write |
| Challenge active, cases fail | Results shown. Timer runs, restrictions stay, no write | Challenge ends, `status: attempted`, restrictions lift |
| Challenge active, all pass | Results + toast "All public tests pass" | `status: solved`, meta comment, timer stops, restrictions lift |
| Compile error | Every case reports the same `compilation error: …` | Same, and counts as a failed Submit → `attempted` |
| Solver throws in one case | That case gets `error`, the rest still run | Same |
| Infinite loop | Suite timeout; printed cases recovered from partial stdout, rest marked `timeout` | Same, counts as failure |
| Empty final suite after fallback | n/a | `results.length > 0` guard prevents a vacuous pass |
| No env for `(type × language)` | Language absent from selector — unreachable | Unreachable |
| Runtime missing (`python3` absent) | `detectRuntime` gate → toast | Same |

---

## Tickets — Jira project **VSX** (`dexsys.atlassian.net`, cloudId `fe305cae-3ffb-44ba-b746-64405f8f0c4b`), epic **VSX-35**

Strict order; each is one TDD cycle (red → green → refactor).

| # | Type | Title |
|---|---|---|
| 1 | Story | Test-environment registry: `env.types.ts`, `env.registry.ts`, `canonicalJson` util |
| 2 | Story | `test:` frontmatter block + `TEST_TYPES` constants (`function` live, 3 reserved) |
| 3 | Story | `function` envs for javascript and python — own-env, batch, sentinel protocol |
| 4 | **Bug** | Java Submit executes a JavaScript template through `javac` — fixed by the `function × java` env |
| 5 | Story | Runner: replace `runSingleTest`/`runAllTests` with batch `runSuite` + timeout attribution |
| 6 | Story | `## Final Tests` section — parser, `ParsedLeetCode.finalTests`, legacy fallback |
| 7 | Story | Suite-selection helpers: `publicSuite` / `submitSuite` / `tagSuiteKinds` |
| 8 | Story | Run Tests button, `runTests` message, `challengeState` message, session guard |
| 9 | Story | Submit grades public + final; one-shot — `status: attempted` on failure |
| 10 | Story | Preview: test counts, masked final rows, env-filtered selector, seeded results |
| 11 | Task | Docs — `CLAUDE.md` (file format, protocol table, section semantics), `README.md` |
| 12 | **Epic** | Polyglot challenges: `components:` schema + driver/impl JSON stdio *(reserved, not scheduled)* |

Ticket 4 is filed as a Bug and closed by the java env — the user asked for it to
be tracked separately, and it is a real defect, not a missing feature.

---

## Implementation notes for the two buttons

### Types — [src/types/leetcode.types.ts](../../src/types/leetcode.types.ts)

- `TestSuiteKind = 'public' | 'final'`; `TestResult` gains `kind?: TestSuiteKind`
  (optional, so the runner never learns about suites).
- `ParsedLeetCode` gains `finalTests: TestCase[]` (raw, `[]` when absent — the
  *fallback* is resolved in `submitSuite`, not the parser) and `test: TestConfig`.

### Parser — [leetcode-sections.helpers.ts](../../src/services/leetcode-sections.helpers.ts)

`extractFinalTests(body)`, structurally identical to `extractTests`
([:73](../../src/services/leetcode-sections.helpers.ts#L73)):
`extractSection(body, /^## Final Tests\s*$/m)` → first ` ```json ` fence →
`JSON.parse` → `[]` on any failure, never throws. The existing `TESTS_RE` is
anchored (`/^## Tests\s*$/m`), so `## Final Tests` cannot match it, and
`extractSection` already stops a slice at the next `#{1,2} ` heading.

### New file — `src/services/leetcode-suite.helpers.ts`

Pure, `vscode`-free, unit-testable. Owns every suite decision:

```ts
publicSuite(parsed): TestCase[]                    // parsed.tests
submitSuite(parsed): TestCase[]                    // finalTests.length ? [...tests, ...finalTests] : [...tests]
publicCount(parsed): number
hasFinalTests(parsed): boolean
tagSuiteKinds(results, publicCount): TestResult[]  // index < publicCount ? 'public' : 'final'
```

The legacy fallback lives entirely in `submitSuite` — with no `## Final Tests`,
Submit runs the public list once, never doubled.

### Command — [src/commands/leetcode.command.ts](../../src/commands/leetcode.command.ts)

**`handleRunTests(ctx, language)`** — new, deliberately not a variant of `handleSubmit`:

1. `resolveLangId`; `testEnvFor(parsed.test.type, langId)` and `RUNNERS[langId]`, error toast if either is absent.
2. `const session = activeChallenge(); if (session?.langId !== langId)` → toast "Start the challenge with Solve It first", return. **No** stored-solution fallback — Run Tests tests the live buffer or nothing.
3. Live buffer via the existing `candidateSource(ctx, langId)` ([:296](../../src/commands/leetcode.command.ts#L296)).
4. `detectRuntime(runner)` and, if present, `env.detect()`.
5. `buildExecutable` → `runSuite(source, publicSuite(parsed), runner, parsed, env)` → `tagSuiteKinds(results, results.length)` → `postResults`.
6. All green → `showInformationMessage('All public tests pass — Submit when ready.')`. No frontmatter write, no `endChallenge`, timer untouched.

**`handleSubmit`** changes:

- `submitSuite(ctx.parsed)` replaces `ctx.parsed.tests` at [:276](../../src/commands/leetcode.command.ts#L276).
- `tagSuiteKinds(results, publicCount(ctx.parsed))` before `postResults`.
- Capture `const wasLive = activeChallenge()?.langId === langId` **before** running — `finishSolved`/`finishAttempted` null the session.
- `allPassed` → `finishSolved` (unchanged). `!allPassed && wasLive` → new `finishAttempted`. `!allPassed && !wasLive` → results only; a dry run against a stored solution must never downgrade `status`.

**`finishAttempted(ctx, langId, resultsHtml)`** mirrors `finishSolved`
([:358](../../src/commands/leetcode.command.ts#L358)) minus the meta comment. The
duplicated read-patch-write is factored into `persistStatus(fileUri, status)`;
`persistSolved` keeps the meta-comment insertion on top of it. `LeetCodeStatus`
already includes `'attempted'` — no type change.

**File size.** `leetcode.command.ts` is 414 lines and `CLAUDE.md` sets a ~400-line
soft limit. Ticket 9 moves the Submit / Run-Tests handlers into
`src/commands/leetcode-run.handlers.ts`, leaving the command file owning the
picker and panel wiring only.

### Panel — [leetcodePreview.panel.ts](../../src/ui/panels/leetcodePreview.panel.ts) + [leetcodePreview.controls.ts](../../src/ui/panels/leetcodePreview.controls.ts)

`renderActions()` → `renderActions(p)`, three buttons; Run Tests renders `disabled`:

```html
<button id="runTestsBtn" class="btn btn-secondary" disabled>Run Tests</button>
<button id="solveBtn"    class="btn btn-insert">Solve It</button>
<button id="submitBtn"   class="btn btn-secondary">Submit</button>
```

`availableLanguages(p)` ([:133](../../src/ui/panels/leetcodePreview.controls.ts#L133))
gains an intersection with `languagesForType(p.test.type)` — a language with a
`# Setup` block but no env never appears.

New `renderTestCounts(p)`: `5 public tests · 3 final tests`, or `5 tests` when
`!hasFinalTests(p)`. Final inputs and expected values are never rendered.

`renderResultRow` masks final cases: label `Final #N` instead of `Test #N`, input
JSON replaced with `<span class="masked">hidden</span>`. Pass/fail and duration
always render. Public rows unchanged. Add `.masked` to [styles.css](../../src/ui/styles.css).

`renderLeetCodePreviewHtml(parsed, cssUri, cspSource, resultsHtml = '')` — the
fourth parameter seeds `<div id="results">`. This removes a real race:
`finishSolved` reassigns `webview.html` and then `postMessage`s into a webview
that is still booting, which today's code papers over by posting twice
([:282-283](../../src/commands/leetcode.command.ts#L282-L283)). `finishAttempted`
would have duplicated it.

Webview script: `runTestsBtn` → `postMessage({ command: 'runTests', language })`.
New inbound `challengeState { active }` toggles `runTestsBtn.disabled`; posted
after a successful `startChallenge` and after `endChallenge`. The handler-side
guard stays — webview state drifts on panel disposal and on
`Obsidian Artifacts: End LeetCode Challenge` from the palette.

### Message protocol after this change

| Direction | Command | Payload |
|---|---|---|
| webview → ext | `solveIt` | `{ language, options, timeLimitMinutes }` |
| webview → ext | `runTests` | `{ language }` — public suite, live buffer only |
| webview → ext | `submit` | `{ language }` — public + final suite |
| webview → ext | `selectLanguage` | `{ language }` |
| ext → webview | `testResults` | `{ html }` |
| ext → webview | `challengeState` | `{ active: boolean }` |

---

## Tests (written first — TDD)

Style is fixed by the existing suite: `node:assert`, Mocha **TDD** (`suite`/`test`),
imports from `../src/**.js`, fixtures inline. No `test/fixtures/` files. Every
existing test module is `vscode`-free and must stay that way.

| File | Covers |
|---|---|
| `test/canonical-json.test.ts` *(new)* | Key sorting, no whitespace, nested arrays/objects, `null`, numbers, string escaping |
| `test/test-env-registry.test.ts` *(new)* | `testEnvFor` hit/miss, `languagesForType` for `function` and for a reserved type (→ `[]`) |
| `test/function-env-javascript.test.ts` *(new)* | `emit` produces per-case try/catch + sentinel lines; `parse` round-trips, ignores stray `console.log`, tolerates truncated stdout |
| `test/function-env-python.test.ts` *(new)* | Same, plus `sort_keys=True, separators=(',',':')` present |
| `test/function-env-java.test.ts` *(new)* | `class Main`, `__json` emits `[0,1]` not `[0, 1]`, strings quoted, Map keys sorted, `Supplier` dispatch, per-case try/catch. Assert on generated source; do **not** spawn `javac` |
| `test/leetcode-runner.test.ts` *(rewrite)* | `runSuite`: happy path, compile error → all cases carry it, partial stdout after timeout → printed cases recovered + rest `timeout` |
| `test/leetcode-test-config.test.ts` *(new)* | `parseTestBlock`: absent → defaults, unknown type → `function`, `timeoutMs` clamped |
| `test/leetcode-final-tests.test.ts` *(new)* | `extractFinalTests` present / absent / malformed; `## Tests` and `## Final Tests` do not swallow each other; `parseLeetCode` populates `finalTests` |
| `test/leetcode-suite.test.ts` *(new)* | `submitSuite` with and without a final section (assert no doubling on fallback); `tagSuiteKinds` boundary at `index === publicCount` |
| `test/leetcode-preview.test.ts` *(extend)* | `#runTestsBtn` present and `disabled`; counts row both shapes; `renderTestResultsHtml` masks input for `kind: 'final'` only; `resultsHtml` lands inside `<div id="results">` |
| `test/leetcode-preview-controls.test.ts` *(extend)* | Three buttons; `renderTestCounts`; `availableLanguages` filtered by env registry |
| `test/leetcode-parser.test.ts` *(extend)* | Legacy `## Tests`-only artifact still parses; `finalTests` is `[]`; `test` defaults applied |

`handleRunTests` / `handleSubmit` / `finishAttempted` import `vscode` and are not
unit-tested. Their logic lives in `leetcode-suite.helpers.ts` and the env
registry, which are. Command wiring is covered by the manual pass.

---

## Verification

```bash
npm run compile
npx tsc --noEmit
npm run lint
node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
```

`npm run test` is not usable on this checkout — it launches a real VS Code and
dies on `listen EINVAL … 1.12-main.sock … longer than 103 chars` (see `CLAUDE.md`).

**Manual pass (F5 → Extension Development Host).** Author `<vault>/LeetCode/two-sum.md`
with a `test:` block, a `## Tests` block of 2 cases, a `## Final Tests` block of 3
(one that a naive solution fails), and `# Setup` stubs for `javascript`, `python`,
`java`. Then:

1. `Obsidian Artifacts: Open LeetCode Exercise` → panel reads `2 public tests · 3 final tests`. Run Tests greyed.
2. **Solve It** → temp file opens, Run Tests enables, countdown starts.
3. Write a solution passing the public cases but failing a final one. **Run Tests** → 2/2 green, info toast, clock still running, editor still restricted.
4. **Submit** → public rows show input, final rows read `Final #N` with masked input, one red. Clock stops, suggestions return, frontmatter reads `status: attempted`.
5. **Solve It** again → same file reopens with code intact, clock restarts, Submit re-arms.
6. Fix the solution. **Submit** → all green, `status: solved`, `<!-- meta: … -->` appears above the language fence.
7. Repeat 2-6 in **java** — this is the end-to-end proof of ticket 4 (`javac` on `PATH`).
8. Add `raise Exception("boom")` to one python case → that row shows the error, the others still run.
9. Add `while True: pass` → suite times out, earlier cases still report, later ones read `timeout`.
10. Set `test.type: class` → no language is selectable. Set it back.
11. Open a legacy artifact with only `## Tests` and no `test:` block → counts read `2 tests`, Submit grades that list, no doubling.

## Files touched

**New:** `src/services/test-envs/{env.types.ts, env.registry.ts}`,
`src/services/test-envs/function/{java,python,javascript}.env.ts`,
`src/services/leetcode-suite.helpers.ts`, `src/utils/canonical-json.ts`,
`src/commands/leetcode-run.handlers.ts`, and the eight new test files above.

**Modified:** [leetcode.types.ts](../../src/types/leetcode.types.ts),
[constants.ts](../../src/types/constants.ts),
[leetcode-sections.helpers.ts](../../src/services/leetcode-sections.helpers.ts),
[leetcode-parser.service.ts](../../src/services/leetcode-parser.service.ts),
[leetcode-runner.service.ts](../../src/services/leetcode-runner.service.ts),
[leetcode.command.ts](../../src/commands/leetcode.command.ts),
[leetcodePreview.panel.ts](../../src/ui/panels/leetcodePreview.panel.ts),
[leetcodePreview.controls.ts](../../src/ui/panels/leetcodePreview.controls.ts),
[styles.css](../../src/ui/styles.css),
[leetcode-runner.test.ts](../../test/leetcode-runner.test.ts) *(rewrite)*,
[leetcode-preview.test.ts](../../test/leetcode-preview.test.ts),
[leetcode-preview-controls.test.ts](../../test/leetcode-preview-controls.test.ts),
[leetcode-parser.test.ts](../../test/leetcode-parser.test.ts),
[CLAUDE.md](../../CLAUDE.md), [README.md](../../README.md)
