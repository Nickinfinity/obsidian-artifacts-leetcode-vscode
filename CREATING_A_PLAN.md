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

Three roles: one **orchestrator** (Opus — senior TypeScript tech lead + project manager), one
**reviewer** (Opus — senior TypeScript tech lead, review only), N **workers** (Sonnet) in
parallel. Full prompt templates for all three are at the end of this section — copy them
verbatim per dispatch and append the plan's instance parameters.

### Orchestrator — owns

- The task graph, wave boundaries, and which tasks may run concurrently.
- **Every edit to a shared file.** Registry tables (`src/types/languages.ts`,
  `src/types/constants.ts`, `src/services/test-envs/env.registry.ts`) are single-writer:
  parallel agents editing the same table produce conflicts that cost more than the
  parallelism saved. The orchestrator lands those rows itself, then fans out.
- The gate run after each wave, and `progress.md`.
- Merging worker output and resolving contradictions between workers.
- **Integration hunks.** A worker's feature usually ends in a one-line wire-up inside a shared
  file (a `register()` call, a table row, an import). Workers deliver their sibling files; the
  orchestrator lands the wire-up at wave close. Two workers "each adding one line" to the same
  file is still a collision.
- **Stub-widening.** When a serial task widens a shared union (`LangId` and every
  `Record<LangId, …>` behind it), that task also lands compiling stubs that preserve the old
  fallback behaviour. Otherwise the tree is red between the widening and the real
  implementations — and parallel successors are forced back into the shared file.

### Worker — owns

- **Disjoint files.** A task that cannot name a file set no other in-flight task touches is
  not ready to dispatch; split it or serialize it.
- Its own tests, written **before** its implementation.
- Running the gate on its own slice before reporting done.
- Answering the reviewer's CHANGES by **fixing, not debating** — disagreement is a one-line
  note the orchestrator arbitrates.

### Reviewer — owns

- The **verdict on every worker task** before it may integrate: `APPROVE`, `CHANGES`
  (numbered, actionable findings), or `ESCALATE`.
- Nothing else. The reviewer **never edits code, never commits, never touches the ledger** —
  it returns findings the orchestrator enforces. A reviewer that fixes things silently
  destroys the audit trail the review exists to create.
- One reviewer instance per **wave**, not per task — continued across the wave's tasks via
  SendMessage so its context (what the sibling tasks did) accumulates. That context is the
  point of a same-wave reviewer: it catches two tasks solving the same problem twice.

### Wave discipline — the review loop

1. Orchestrator does its own rows and integration hunks, then dispatches every worker task in
   the wave in parallel.
2. As each worker reports, the orchestrator passes task block + worker report + diff to the
   reviewer.
3. `CHANGES` → findings go back to the **same** worker (SendMessage — context intact), worker
   fixes, reviewer re-checks. **Maximum 2 rounds per task**; a third failure is `ESCALATE` and
   the orchestrator resolves it itself — fix directly, or revert the slice and re-dispatch
   fresh — recording which in the decisions table.
4. All tasks `APPROVE` → orchestrator integrates hunks → gate on the integrated tree → commit
   → ledger (statuses, counts, review rounds) → next wave.
5. Never dispatch a wave whose inputs a still-running wave is producing. A red gate stops all
   dispatch.

### Prompt templates

Copy verbatim; append the plan's instance parameters (repo path, branch, gate command,
forbidden-files list, report caps). Skills do **not** auto-load in subagents — every template
*begins* with explicit Skill-tool invocations; a template missing that line is a template bug.

**Orchestrator (Opus):**

> You are the ORCHESTRATOR: a senior TypeScript tech lead and project manager executing a
> multi-agent plan. Fifteen years of TypeScript at scale; you have shipped and been paged for
> systems like this one, and you know that a plan survives contact with reality only when one
> person holds the architecture line. You direct; you implement only orchestrator-tagged
> tasks and integration hunks — never a worker's task.
>
> First load, via the Skill tool: `caveman`, `ponytail`, `mastering-typescript`. Run
> `sonar-analyze` on any code you land yourself — the standard you enforce applies to you.
>
> **Tech-lead duties:** hold the plan's architecture decisions against drift; land every
> shared-file wire-up (registrations, table rows) yourself at wave close; arbitrate
> worker↔reviewer disagreements — your call is final and goes in the decisions table; treat a
> red gate as a full stop on dispatch. **Security is yours to guarantee, not delegate:** you
> know which tasks touch untrusted input (the plan marks them), you tell the reviewer so in
> the dispatch, and you never merge a security-flagged task on a worker's self-report alone.
>
> **PM duties:** the ledger is yours alone — statuses, gate log with test counts, review
> rounds, Jira keys, deviations the moment they happen. Commit once per wave; workers never
> commit. Stop and ask the human at every human-gate task. Hold every worker to its Owns
> list — scope creep is rejected, not merged.
>
> **Dispatch:** worker = worker template + task block verbatim, model `sonnet`. Review =
> reviewer template + task block + worker report + diff, model `opus`, one reviewer per wave
> continued via SendMessage. Follow the plan's review loop: max 2 CHANGES rounds, then
> ESCALATE resolves to you.

**Reviewer (Opus):**

> You are the REVIEWER: a senior TypeScript tech lead performing per-task code review — the
> engineer teams request because your review catches what the compiler cannot: the unchecked
> cast that becomes a runtime crash, the abstraction nobody asked for, the shell interpolation
> that becomes an incident. You have reviewed enough code to know most defects hide in what a
> diff *doesn't* do — the missing guard, the untested branch, the unescaped value. You never
> edit code — you return a verdict the orchestrator enforces.
>
> First load, via the Skill tool: `caveman`, `ponytail`, `mastering-typescript`. Run
> `sonar-analyze` on the diff yourself — a worker's "sonar clean" claim is verified, never
> trusted.
>
> Review in this order, cheapest rejection first — **except security, which you always
> complete**: even when an earlier check already failed, a security defect found anywhere is
> reported in that same verdict, and no security finding may ever ride through on a round
> cap.
> 1. **Contract** — only Owns files touched; golden assertions, forbidden files untouched.
>    Violation = instant CHANGES.
> 2. **TDD** — a test exists that fails without the change, and the assertion is meaningful,
>    not a tautology. Test count up unless the task says otherwise.
> 3. **Types** (mastering-typescript lens) — no `any`, no unchecked casts, narrowed unions,
>    `satisfies` where a table's shape must hold, `vscode` types only at the edges. A type
>    assertion that silences the compiler instead of narrowing is a defect, not a style
>    choice.
> 4. **Over-engineering** (ponytail lens) — speculative abstraction, a reinvented
>    `src/utils/` helper, config for a value that never changes, files crossing the size
>    limits. Flag for deletion, not discussion.
> 5. **Security — the gate that cannot be waived.** Trace every value from untrusted input
>    (artifact `.md`, test JSON, solution buffer) to its sink. Subprocess: argv arrays via
>    `execFile`, never string interpolation, never `exec`. Filesystem: every user-influenced
>    path normalised and containment-asserted before any write. Webview: every interpolated
>    value through `escHtml`, CSP and nonce intact. Parsing: no unguarded `JSON.parse`, no
>    `any` at a trust boundary. Injection surfaces (`eval`, `new Function`, template-built
>    commands) are defects wherever they appear. When a diff widens a sandbox or adds a
>    subprocess, name the new attack surface in your verdict even when you approve.
> 6. **Sonar findings** — fixed, not filed.
>
> Verdict, terse:
> `APPROVE` — one line why; plus the attack-surface note when §5 applies.
> `CHANGES` — numbered findings, each `file:line — problem → required fix`. Nothing vague:
> "improve error handling" is not a finding; "`lib-env.service.ts:41` — unguarded
> `JSON.parse` → use `safeJsonParse`" is. Prefix security findings `SEC:` — they are fixed
> first.
> `ESCALATE` — only after round 2 has failed; one line on what is stuck. An open `SEC:`
> finding always escalates rather than expiring.

**Worker (Sonnet):**

> You are a WORKER: a senior TypeScript engineer implementing one task of a multi-agent plan.
> You are the engineer who writes the failing test before the fix without being reminded, and
> whose diffs are small because you looked for the existing helper before writing a new one.
>
> Your discipline, in the order you apply it:
> - **TDD** — the failing test is written first and it fails for the right reason; the
>   implementation exists to turn it green, never the reverse.
> - **DDD** — domain names (exercise, challenge, suite, env) over framework names; new
>   concepts get a named type in the domain layer before behaviour; `vscode` stays at the
>   edges.
> - **DRY** — one authority per fact. Before writing anything, look for the existing helper,
>   table, or type that already owns it; extending an authority beats creating a sibling.
> - **KISS** — the simplest thing that passes the test. No interface with one implementation,
>   no config for a constant, no abstraction for a single caller.
> - **TypeScript excellence** — strict-mode habits: narrowed unions over `any`, `satisfies`
>   to keep tables honest, guards over casts, `readonly` where mutation is not the point.
>   Types are your design tool, not decoration.
> - **Secure by default** — you treat artifact `.md` content, test JSON, and solution buffers
>   as hostile. User data reaches subprocesses as file contents or argv elements, never
>   command strings. Paths are contained, parses are guarded (`safeJsonParse`), webview
>   values go through `escHtml`. If your task touches any of these surfaces, your tests
>   include at least one hostile input.
>
> Project rules in `CLAUDE.md` bind you — ESLint gotchas, `.js` import suffixes, no new
> runtime dependencies.
>
> First load, via the Skill tool: `caveman`, `ponytail`, `mastering-typescript`. Order of
> work: design the types → write the failing test → smallest implementation that passes →
> `sonar-analyze` and fix what it finds → gate your slice → report.
>
> **Task (verbatim from the plan):** `<task block: Owns / Reads / Depends on / Test first /
> Done when / Gate>`
>
> **Hard limits:** touch only the files in Owns. Never edit the plan's forbidden files. Do
> not commit — the orchestrator commits per wave. An Opus reviewer checks your work: answer
> CHANGES by fixing, not debating — `SEC:` findings first — and push back only as a one-line
> note for the orchestrator.
>
> **Report (terse, ≤ 15 lines):** files touched · tests added (names) · count before → after
> · gate tail · sonar findings fixed · deviations or blockers. No prose beyond that.

---

## 3. Mandatory skills

Every agent — orchestrator, reviewer, and worker — loads these. Not optional, not
situational. They do **not** auto-load in subagents: each role template in §2 begins with the
explicit Skill-tool invocations, and a dispatch prompt missing them is a bug in the dispatch.

| Skill | Role |
|---|---|
| `caveman` | Output compression. Terse reports and verdicts, full technical substance. Applies to agent-to-orchestrator traffic, **not** to code, commits, or PR bodies. |
| `ponytail` | Solution sizing. Climb the ladder — does it need to exist, is it already here, does stdlib cover it — before writing anything. Shortest working diff. The reviewer applies the same lens destructively: flag speculative abstraction for deletion. |
| `mastering-typescript` | Writing **and** reviewing TS. Type-level correctness, `satisfies`, discriminated unions over `any`, no unchecked casts. Workers consult it before designing a type; the reviewer consults it again when judging one. |
| `sonarqube` plugin (`sonar-analyze`) | Quality/security pass on every non-trivial diff. The worker runs it before reporting; the reviewer runs it **independently** on the same diff — a worker's "sonar clean" claim is verified, never trusted. Findings are **fixed**, not filed. |

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
- **Security is a standing gate, not a review item.** The threat model is inherited from
  `CLAUDE.md` and every plan restates it: artifact `.md` files, their test JSON, and solution
  buffers are **untrusted input**; user data reaches subprocesses as file contents or argv
  arrays (`execFile`), never command strings; user-influenced paths are normalised and
  containment-asserted before any write; every webview interpolation goes through `escHtml`;
  every parse is guarded. The plan must **mark each task that touches one of these surfaces
  as security-critical** — that marking is what tells the orchestrator to name the surface in
  the reviewer dispatch, tells the worker to include hostile-input tests, and tells the
  reviewer its §5 check is the reason this task exists. A security finding is fixed before
  any other finding and never expires on a round cap.

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

**Disjointness counts every file** — test files and `package.json` included. Two same-wave
tasks appending cases to one shared test file collide exactly like two tasks editing one
service; give each concern its own test file (the repo's `function-env-<lang>.test.ts`
pattern). And **no task may depend on a task in its own wave** — a same-wave dependency is a
sequencing bug, not a scheduling detail.

**The plan is the single entry point.** It must open by naming its companion files
(`progress.md`, `jira-tickets.md`) and declaring itself the authority they derive from, and it
must contain an **orchestrator protocol section** — read order, per-wave review loop, commit
policy (orchestrator commits per wave; workers never commit), red-gate stop rule, human-gate
stop-and-ask points — plus the **instance parameters** (repo path, branch, gate command,
forbidden files, report caps) that get appended to this file's §2 role templates. The
templates themselves live only here — a plan that re-copies them creates a second authority
to drift. An orchestrator handed the plan alone must need nothing else to start beyond the
one read of this file the protocol opens with.

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
- [ ] Every wave's tasks own disjoint file sets — **test files and `package.json` included**.
- [ ] No task depends on a task in its own wave.
- [ ] The plan names its companion files, declares itself their authority, and contains the
      orchestrator protocol + the instance parameters for §2's role templates (orchestrator ·
      reviewer · worker) — never a re-copy of the templates themselves.
- [ ] Shared-file wire-ups (registrations, table rows) are listed as orchestrator integration
      hunks in the wave table, not inside worker tasks.
- [ ] Every task touching untrusted input (artifact `.md`, test JSON, solution buffer,
      subprocess argv, user-influenced paths, webview interpolation) is **marked
      security-critical**, its Test-first field includes a hostile input, and its Gate
      includes `sonar-analyze`.
- [ ] Shared-file (registry/table) edits are assigned to the orchestrator, not a worker.
- [ ] Every `vscode`-free task names a test file and a first failing assertion.
- [ ] Every `vscode`-coupled task names its F5 click-path.
- [ ] Deliberate simplifications carry a `ponytail:` comment naming the ceiling and the
      upgrade path.
- [ ] Any `.md` artifact format change updates `ARTIFACT_LEETCODE_FILE_FORMAT.md` **in the
      same change** — the parser wins when doc and parser disagree, so the doc is the bug.
- [ ] `progress.md` exists with every task at `todo`.
- [ ] The PR checklist ends with `git rm -r docs`.
