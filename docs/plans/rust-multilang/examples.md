# Example exercises — VSX-122

Derived view of [plan.md](plan.md) (the authority). Same wave numbers, same review loop, same
worker/reviewer templates. E-tasks are content tasks: each produces one runnable `.md` exercise
artifact in the vault format.

## Two homes, one source of truth

| Location | Role |
|---|---|
| `examples/leetcode/` (repo root, tracked) | **Source of truth.** Survives the PR (unlike `docs/`), CI-guarded by E0, linked from the format spec as living reference. |
| `/Users/nick/N0t3s/C0d3-Sn1pp3ts/LeetCode/` (the real vault) | **Deployment.** Verified: the vault root carries `.obsidian/`; `LeetCode/` exists (currently flat, one file — `leetcode-ab-check.md`). The F5 gates run against the vault copy. |

Deploy = copy the repo directory over the vault directory at each F5 gate (T9, T21, T29) — the
human's first click-path step. Never author directly in the vault: an artifact that exists only
there is invisible to CI and to the reviewer.

## Folder taxonomy — type first, then topic; language only where a file is single-language

```
LeetCode/
├── function/
│   ├── arrays/          two-sum.md · remove-duplicates-inplace.md
│   ├── strings/         is-anagram.md
│   └── libs/            deep-pick-lodash.md · matrix-diagonal-sum-numpy.md ·
│                        parse-config-serde.md · java-libs-unsupported.md
├── class/               lru-cache.md
├── stdio/               sum-lines.md
├── project/
│   └── typescript/      react-counter.md
└── service/
    ├── typescript/      node-react-fullstack.md
    └── multi/           fastapi-react.md
```

**Grouping rule (as requested):** a topic exercise (strings, arrays) is **one file for all five
languages** — that is the format's native shape: one artifact, one `# Setup` fence per language,
one shared test suite. A complex exercise (node backend + React frontend) is **one independent
single-language file** — a polyglot service artifact would multiply every scaffold file per
language for no teaching gain.

**Deviation from "folders by main language", stated:** a polyglot `function` artifact *has no
main language* — filing `two-sum.md` under `python/` would misdescribe four of its five setups.
So the language folder level exists **only** where a file genuinely is single-language
(`project/`, `service/`). The type level is exact everywhere.

**Migration:** the existing `leetcode-ab-check.md` is moved into the taxonomy
(`function/strings/`) during deployment — E1's agent includes it in the repo set so it becomes
CI-guarded like the rest.

⚠️ **This taxonomy forces a code change — T30 in [plan.md](plan.md).** The picker is flat today
([leetcode.command.ts:64-71](../../../src/commands/leetcode.command.ts#L64-L71) filters
`FileType.File` only); subfolders would be invisible. T30 (wave 2) makes discovery recursive
before the first E-task lands.

**Authoring rule:** every example must be *solvable and failable* — reference solution in
`# Solutions`, at least one public and one hidden test, a difficulty tag. An example that cannot
fail teaches nothing and proves nothing in an F5 pass.

---

## E0 — Examples fixtures test

- **Owns:** `test/examples.test.ts`
- **Reads:** `examples/leetcode/**/*.md` (recursive — the taxonomy has depth),
  `src/services/leetcode-parser.service.ts`
- **Depends on:** E1
- **Test first:** parsing every file under `examples/leetcode/` (any depth) yields zero parse
  warnings, a non-empty public suite, and a known `test.type` — fails while empty, passes when
  E1 lands.
- **Done when:** the test walks the tree (new examples guarded automatically, no registration)
  and asserts per type: `function` examples have `params`/`returns`; `class` examples have
  ops-shape cases; `libs:` examples pass the allowlist.
- **Gate:** full gate.

> `CLAUDE.md` says "fixtures inline, no `test/fixtures/`" — this is not that: `examples/` is a
> shipped deliverable the test *reads*, not a fixtures directory the test *owns*. Say so in the
> test's header comment.

## E1 — `function/arrays/two-sum.md` — five languages (wave 4, feeds T9)

- **Owns:** the artifact, `examples/leetcode/README.md` (the taxonomy above, written
  generically — no personal paths), and the migrated `function/strings/leetcode-ab-check.md`
- **Depends on:** T1–T7, T30
- **Done when:** `function` frontmatter; one `# Setup` fence per language **including `rust`
  and a `ts`-aliased heading** (proves alias resolution); 2 public + 2 hidden cases; solvable
  end-to-end in all five languages.

## E11 — `function/strings/is-anagram.md` — five languages (wave 4, feeds T9)

- **Owns:** the artifact
- **Depends on:** T1–T7, T30
- **Done when:** string-manipulation exercise (`map<string,int>` in the type mapping — exercises
  `HashMap`/`Record`/`Dict` across all five languages); same five-setup shape as E1. Same agent
  as E1 — one dispatch, one concern: the wave-4 polyglot set.

## E2 — `function/libs/deep-pick-lodash.md` (wave 8, feeds T21)

- **Depends on:** T16. `libs: { javascript: [lodash@4.17.21], typescript: [lodash@4.17.21] }`;
  the reference solution **must call** `require('lodash')` — an example whose solution never
  touches the lib proves nothing; first run installs, second hits the cache.

## E3 — `function/libs/matrix-diagonal-sum-numpy.md` (wave 8, feeds T21)

- **Depends on:** T17. `libs: { python: [numpy] }`; runs via the venv interpreter; unpinned on
  purpose — exercises the documented unpinned path.

## E4 — `function/libs/parse-config-serde.md` (wave 8, feeds T21)

- **Depends on:** T18. `libs: { rust: [serde_json@1] }`; Cargo path with shared `target/`;
  second run measurably incremental.

## E5 — `function/libs/java-libs-unsupported.md` (wave 8, feeds T21)

- **Depends on:** T14. Declares `libs.java` and its **description says it exists to demonstrate
  the refusal** — a negative example that looks like a broken exercise is a bug report waiting
  to happen.

## E6 — `class/lru-cache.md` (wave 12, feeds T29)

- **Depends on:** T24, T25. Ops-sequence cases including **one eviction** (the case that
  distinguishes an LRU from a map); setups for at least python and java (interpreted +
  compiled — T29's requirement).

## E7 — `function/arrays/remove-duplicates-inplace.md` (wave 12, feeds T29)

- **Depends on:** T26. `test: { type: function, mutates: nums }`; the reference solution's
  return is ignored — that *is* the demonstration.

## E8 — `stdio/sum-lines.md` (wave 12, feeds T29)

- **Depends on:** T27. `{"stdin": …, "stdout": …}` cases; the setup stub reads stdin and prints
  — the solver's own `print` **is** the answer.

## E9 — `project/typescript/react-counter.md` — **Phase 3 spike deliverable**

- `test.type: project`; editable `.tsx`, **ungraded** `.css` (explicitly scaffolding), hidden
  `package.json`; checks = one `build` + one `function`. Writing the concrete artifact is the
  cheapest way to force the contract to confess its gaps.

## E10 — `service/multi/fastapi-react.md` — **Phase 4 spike deliverable**

- `test.type: service`; FastAPI backend + React frontend — the **multi-language** service
  demonstration; `${PORT}` templating, `exposeAs`, an `http` check; the solver never sees the
  wiring.

## E12 — `service/typescript/node-react-fullstack.md` — **Phase 4 spike deliverable**

- The **single-language** service demonstration, per the grouping rule: node backend (plain
  `node:http` or express if declared in `libs`) + React frontend, both TypeScript, one
  independent file. Same contract as E10 minus the cross-language seam — the pair (E10, E12)
  proves the `services:` format is language-agnostic.

---

## Wave placement

| Wave | E-tasks | Runs alongside | Agent |
|---|---|---|---|
| 4 | E1 · E11, then E0 | T8 · T9 · T10 | 1 × sonnet (serial: artifacts → fixtures test) |
| 8 | E2 · E3 · E4 · E5 | T20 · T21 | 1 × sonnet |
| 12 | E6 · E7 · E8 | T28 · T29 | 1 × sonnet |
| spike | E9 · E10 · E12 | Phase 3 / Phase 4 spikes | inside the spikes |

E-tasks are reviewed like code tasks: format-spec compliance, the solvable-and-failable rule,
`libs:` values through the allowlist. The F5 gates deploy the repo set to the vault, then click
through it — an F5 pass needing an exercise no E-task produced is a planning bug for the ledger.

## Jira

One story per wave-group, parented to VSX-122: `<KEY>` E1+E11+E0 (wave 4, 3 pts) · `<KEY>`
E2–E5 (wave 8, 3 pts) · `<KEY>` E6–E8 (wave 12, 3 pts) · E9/E10/E12 ride the spike stories.
