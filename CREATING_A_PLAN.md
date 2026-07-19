# CREATING_A_PLAN.md

How a multi-agent feature plan is written and executed in this repository. This file is the
**process**; a plan under `docs/plans/` is one **instance** of it.

> Filename note: requested as `crating_A_PLAN.md`; spelled `CREATING_A_PLAN.md` here to match
> the other root-level caps docs (`CLAUDE.md`, `ARTIFACT_LEETCODE_FILE_FORMAT.md`). Rename if
> the literal spelling was intended.

---

## 1. Where plan files live, and why they never merge

```
docs/plans/<feature-slug>/
├── plan.md          # the plan: phases, tasks, contracts, gates
├── progress.md      # the ledger: one row per task, updated as work lands
└── jira-tickets.md  # ready-to-create epic + story specs
```

`docs/` is a **working artifact of one feature branch**. It is not shipped documentation and
it does not belong on `develop` or `main`.

**Rules:**

1. Plan files are created on the feature branch only, never on `develop`/`main`.
2. `git rm -r docs` is the **last commit on the branch before the PR is opened** — the PR
   diff must contain no `docs/` path. Add it to the PR checklist; it is not optional.
3. Anything from the plan worth keeping permanently gets promoted into `CLAUDE.md`,
   `ARTIFACT_LEETCODE_FILE_FORMAT.md`, or a JSDoc block **before** the delete commit. If a
   fact only exists in `docs/`, it is lost by design.
4. `.gitignore` is *not* the mechanism — it does not stop already-tracked files from merging.
   The delete commit is the mechanism.

Rationale: plan documents rot faster than code and read as authority when they are actually
stale. `CLAUDE.md`'s standing rule applies — **trust the tree over any plan or ledger.**

---

## 2. Agent topology

One **orchestrator** (Opus), N **workers** (Sonnet) running in parallel.

### Orchestrator — owns

- The task graph, wave boundaries, and which tasks may run concurrently.
- **Every edit to a shared file.** Registry tables (`src/types/languages.ts`,
  `src/types/constants.ts`, `src/services/test-envs/env.registry.ts`) are single-writer:
  parallel agents editing the same table produce conflicts that cost more than the
  parallelism saved. The orchestrator lands those rows itself, then fans out.
- The gate run after each wave, and `progress.md`.
- Merging worker output and resolving contradictions between workers.

### Worker — owns

- **Disjoint files.** A task that cannot name a file set no other in-flight task touches is
  not ready to dispatch; split it or serialize it.
- Its own tests, written **before** its implementation.
- Running the gate on its own slice before reporting done.

### Wave discipline

Dispatch a wave, wait for all of it, run the gate, update the ledger, then dispatch the next.
Never dispatch a wave whose inputs a still-running wave is producing.

---

## 3. Mandatory skills

Every agent — orchestrator and worker — loads these. They are not optional and not
situational.

| Skill | Role |
|---|---|
| `caveman` | Output compression. Terse reports, full technical substance. Applies to agent-to-orchestrator reports, **not** to code, commits, or PR bodies. |
| `ponytail` | Solution sizing. Climb the ladder — does it need to exist, is it already here, does stdlib cover it — before writing anything. Shortest working diff. |
| `mastering-typescript` | Writing **and** reviewing TS. Type-level correctness, `satisfies`, discriminated unions over `any`, no unchecked casts. Consulted before designing a new type, and again when reviewing one. |
| `sonarqube` plugin (`sonar-analyze`) | Quality/security pass on every non-trivial diff. Findings are **fixed**, not filed. |

**Order of operations inside a task:** `mastering-typescript` (design the types) → TDD (write
the failing test) → `ponytail` (write the smallest thing that passes) → `sonar-analyze` (fix
what it finds) → gate → `caveman` (report).

---

## 4. Methodology the plan must encode

Inherited from `CLAUDE.md` — **TDD, CUPID, DDD, in that order** — plus:

- **DRY.** One authority per cross-cutting concern. Before a plan proposes a new table, it
  must state which existing table (`LANGUAGES`, `TEST_TYPES`, the env registry, `PRACTICE_OPTIONS`)
  it extends instead. A plan that adds a parallel list is rejected at review.
- **KISS / YAGNI.** No interface with one implementation, no factory for one product, no
  config for a value that never changes. Speculative extension points are cut from the plan,
  not deferred inside it.
- **TDD.** Every task on a `vscode`-free unit names its test file and its first failing
  assertion **in the plan**, before an agent is dispatched. `vscode`-coupled work names its
  F5 manual-pass steps instead.
- **DDD.** New concepts get a named type in `src/types/` before behaviour exists. The domain
  model stays `vscode`-free.
- **Behaviour-preserving refactors need a golden net first** — byte-exact snapshots captured
  before editing, never touched during it.

---

## 5. Task specification format

A task is dispatchable only when every field below is filled. Missing fields are the single
largest cause of a worker producing the wrong thing.

```markdown
### T<n> — <imperative title>

- **Owns:**      <exact file paths this task may write; must be disjoint from its wave>
- **Reads:**     <files it needs but must not modify>
- **Depends on:** <task ids, or `none`>
- **Test first:** <test file + the first assertion that must fail>
- **Done when:**  <observable condition — a passing assertion, not "implemented">
- **Gate:**       <the gate command, plus any extra check>
```

**Sizing:** one task ≈ one file plus its test. A task that lists four owned files is two
tasks. A task nobody can verify from `Done when` alone is under-specified.

---

## 6. The gate

Every wave ends with the repo gate. `pnpm test` does not work on this checkout (the path
pushes the VS Code IPC socket past the macOS 103-char limit), so:

```bash
rm -rf dist && pnpm compile && pnpm lint && \
  node node_modules/.pnpm/mocha@*/node_modules/mocha/bin/mocha.js --ui tdd "dist/test/**/*.test.js"
```

`rm -rf dist` is **required**, not hygiene: `tsc` does not delete orphaned `dist/*.js`, so a
renamed or deleted test keeps running from stale output and inflates the pass count.

Also run `npx tsc --noEmit` — IDE diagnostics go stale, this is the truth.

`vscode`-coupled code is verified by the **F5 manual pass** only. The plan lists the exact
click-path per phase; "F5 and check it works" is not a test.

---

## 7. Progress tracking

`progress.md` is the single ledger. One row per task, updated **by the orchestrator** as each
worker reports — a worker never edits the ledger, or two workers race on it.

```markdown
| Task | Owner | Status | Test count | Gate | Notes |
|------|-------|--------|-----------|------|-------|
| T1   | wave-1 | done   | 509 → 517 | pass | — |
| T2   | wave-1 | wip    | —         | —    | blocked on T1 registry row |
```

Statuses: `todo` · `wip` · `done` · `blocked` · `dropped` (with the reason).

**Record the test count on every gate run.** A silent drop means a test was deleted; per
`CLAUDE.md` that is allowed only loudly, with the relocated assertion named in the commit.

---

## 8. Jira

Each phase is an **epic**; each task or task cluster is a **story** under it. Ticket specs are
written into `jira-tickets.md` in creation order with: summary, description, acceptance
criteria, parent link, and estimate.

When the Atlassian connector is not authorized, the markdown file **is** the deliverable —
tickets get created in one pass afterwards. Do not block plan authoring on connector auth,
and never fabricate ticket keys; leave `<KEY>` placeholders and fill them after creation.

---

## 9. Definition of done for a plan

Before any agent is dispatched, the plan must satisfy:

- [ ] Every phase names the **existing** authority it extends, not a new parallel one.
- [ ] Every task has all six fields from §5.
- [ ] Every wave's tasks own disjoint file sets.
- [ ] Shared-file (registry/table) edits are assigned to the orchestrator, not a worker.
- [ ] Every `vscode`-free task names a test file and a first failing assertion.
- [ ] Every `vscode`-coupled task names its F5 click-path.
- [ ] Deliberate simplifications carry a `ponytail:` comment naming the ceiling and the
      upgrade path.
- [ ] Any `.md` artifact format change updates `ARTIFACT_LEETCODE_FILE_FORMAT.md` **in the
      same change** — the parser wins when doc and parser disagree, so the doc is the bug.
- [ ] `progress.md` exists with every task at `todo`.
- [ ] The PR checklist ends with `git rm -r docs`.
