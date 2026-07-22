# Spike findings — writing the Phase 3 / Phase 4 artifacts

Authoring the three contract-only examples (E9-variant, E10, E12) against the real parser,
exactly as [plan.md](plan.md) §6–§7 specify them. "The cheapest way to force the contract to
confess its gaps" — this is what it confessed. Each finding is a **task input**, not a bug
report against shipped code.

Artifacts:

| File | Type | Proves |
|---|---|---|
| [`project/typescript/nextjs-object-list.md`](../../../examples/leetcode/project/typescript/nextjs-object-list.md) | `project` | multi-file, one runtime; `function` + `build` checks |
| [`service/multi/fastapi-react.md`](../../../examples/leetcode/service/multi/fastapi-react.md) | `service` | multi-**language** (python + typescript), two booted services, `${PORT}` + `exposeAs` |
| [`service/typescript/node-react-fullstack.md`](../../../examples/leetcode/service/typescript/node-react-fullstack.md) | `service` | the same contract single-language — proves `services:` is language-agnostic |

All three parse clean today (`test/examples.test.ts`, 645 passing) and are **not runnable**:
`project` and `service` are now `reserved` rows in `TEST_TYPES`, so `languagesForType()` is `[]`
and the panel explains itself instead of dying in a toolchain.

---

## 1. Cases cannot bind to a named check — the fence regex forbids it (blocker for T22-equivalent)

Plan §6: *"Test cases bind to checks with a fence attribute (`check=<name>`) in `## Tests`"*.
The parser's `JSON_FENCE = /```json\r?\n([\s\S]*?)```/`
([leetcode-sections.helpers.ts:17](../../../src/services/leetcode-sections.helpers.ts#L17))
requires a newline **immediately** after `json`, so ` ```json check=api ` never matches and the
whole suite silently parses as `[]`.

Consequence: each of the three artifacts carries cases for exactly **one** check, stated in
prose. Either widen the fence regex to accept attributes (and take *all* json fences, not the
first), or move the binding into `checks[].cases` in frontmatter. **Decide before Phase 3
breakdown** — it changes the section grammar, not just a parser detail.

## 2. A `function` check has nowhere to declare its own `params` / `returns`

`params:` and `returns:` are artifact-level singletons. One `kind: function` check can borrow
them (the Next.js artifact does); **two** function checks in one project have no way to type
their arguments. Options: `checks[].params` / `checks[].returns` (nesting the §2.4 grammar), or
one check per artifact by rule. Nesting looks right; it is not free — the type-mapping table is
reached from `params` in four places.

## 3. The generic type table cannot express a list of objects

§5 maps `int`, `string`, `int[]`, `map<string,int>`… — there is no record/struct type, so the
obvious "list of products" signature is unrepresentable. The Next.js artifact models the
catalogue as `map<string,int>` (name → stock) to stay inside the table. `http` checks dodge this
entirely (raw JSON in, raw JSON out), which is a real argument for grading service exercises at
the protocol boundary rather than the function boundary. Rust already refuses structs for the
same reason (no serde).

## 4. `build` check fields are unspecified

Plan §6 says a `build` check runs *"a declared build argv"* but names no field. The spikes use
`argv: [...]` plus an optional `dir:` (relative to the run dir — the client subtree, not the
repo root). `dir` is a user path → the §6 traversal rule applies to it, same as `services[].dir`.

## 5. Unknown frontmatter keys vanish silently

`libs:`, `services:`, and `checks:` are all dropped by today's parser without a warning — good
for forward compatibility (these artifacts parse clean on a build that predates the feature),
bad for authoring: a typo'd `servcies:` is indistinguishable from an artifact with no services.
T11 should warn on *known-shape-but-unparsed* keys once the fields land.

## 6. `.tsx` has no `LangId`, and JSX cannot be type-stripped

Every React file in these artifacts declares `typescript` in its fence info-string (the
`LANG_EXT`/`LANG_ALIAS` tables have no `tsx` entry) while its `path=` ends in `.tsx`. That is
survivable for a `build` check — `tsc` reads the path, not the fence — but it confirms plan §6
open question 4: `stripTypeScriptTypes` cannot turn `.tsx` into a working component, so
`project` exercises need a real `tsc`/bundler step. The `function × typescript` env stays
strip-only; it grades `.ts` helpers, never components.

## 7. `role: readonly` has no VS Code mechanism today

`PracticeMode` writes editor settings at **global** scope (no per-editor config scope exists),
so "this tab is editable, that one is read-only" cannot be expressed the way `editable` /
`readonly` imply. Candidates: write `readonly` files with a read-only file mode, or keep them
`hidden` and render their content in the panel instead. Not a naming detail — it decides whether
the role is worth having.

## 8. `function:` is `function`-type-only (fixed here)

`test/examples.test.ts` warned on an empty `functionName` for **every** example; a `service`
artifact has no free function to name. The rule is now gated on `test.type === 'function'`.
The format spec's §2.1 "required" column carries the same qualification.
