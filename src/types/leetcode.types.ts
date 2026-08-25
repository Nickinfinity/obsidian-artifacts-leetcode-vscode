import type { LeetcodeTypeId } from './leetcode-type.js';

/**
 * How a `program`-type candidate receives its case.
 *
 * Lives here rather than beside its parser because `src/types/` is where a
 * domain concept is named before it has behaviour, and because
 * `ParsedLeetCode` carries one — a type in `src/types/` may never import from
 * `services/`, which is the direction that dependency would have run.
 */
export type ProgramChannel = 'argv' | 'flags' | 'stdin';

/** Parsed `program:` config block — see `program-config.helpers.ts` for its grammar. */
export interface ProgramConfig {
	channel: ProgramChannel;
	/** Relative path to the program's entry point — shape-guarded, not yet resolved. */
	entry?: string;
	/** Named flags, in declared order — paired with `params:` positionally by the consumer. */
	flags?: string[];
}

/**
 * Solve status of a LeetCode problem in the vault.
 *
 * - `unsolved`  — no successful run recorded
 * - `attempted` — at least one run executed, none passed all tests
 * - `solved`    — all tests passed on at least one run
 */
export type LeetCodeStatus = 'unsolved' | 'attempted' | 'solved';

/**
 * Canonical difficulty tier for a LeetCode problem.
 */
export type LeetCodeDifficulty = 'easy' | 'medium' | 'hard';

/**
 * A single named parameter on the candidate function signature.
 *
 * Example: `{ name: 'nums', type: 'number[]' }`.
 */
export interface ParamDef {
	/** Parameter identifier as it appears in the candidate function signature */
	name: string;
	/** Human/TypeScript-style type annotation (not validated) */
	type: string;
}

/**
 * The **test-type axis**: how a case is delivered and compared.
 *
 * One vocabulary, two spellings — `test.type` names it for a single suite,
 * a check's `kind:` names it per check. They used to be two overlapping
 * tables (`TEST_TYPES` and `VALID_KINDS`) that both listed `function`
 * meaning different things; merging them is what lets a multi-package
 * artifact grade each check by its own kind.
 *
 * Distinct from the **leetcode-type axis** (`LeetcodeTypeId`, which names
 * what the artifact *is*). One value used to answer both questions, which is
 * why several ids below are reserved and why `service` could be opened but
 * never graded.
 *
 * The legacy spellings — `function`, `stdin-stdout`, `project`, `service` —
 * are **not members**. They survive only as *derivation inputs* read from the
 * raw frontmatter scalar (`deriveLeetcodeType`), so an unmigrated artifact
 * still resolves a shape; `parseTestType` collapses them to
 * `DEFAULT_TEST_TYPE` like any other unrecognised value.
 *
 * - `call`        — call a free function with positional args, compare the return
 * - `program`     — deliver argv/flags/stdin, compare what the program writes to `$LEET_OUT`
 * - `http`        — a real request to a booted server, compare status/headers/body
 * - `build`       — a declared argv exits `0`
 * - `dom-assert`  — declarative steps against a jsdom mount, compare the observed DOM
 * - `css-assert`  — as above, comparing a **declared** style property or class
 * - `class`       — reserved: instantiate, invoke a method sequence, compare the returns
 * - `in-place`    — reserved: compare a mutated argument rather than the return value
 */
export type TestTypeId =
	| 'call' | 'program' | 'http' | 'build' | 'dom-assert' | 'css-assert'
	| 'class' | 'in-place';

/** One entry in the `TEST_TYPES` capability table. */
export interface TestType {
	/** Stable id, as written in the `test.type` frontmatter field */
	id: TestTypeId;
	/** Whether an environment exists for this type today */
	status: 'implemented' | 'reserved';
	/** One-line description of the execution semantics */
	description: string;
}

/**
 * Execution configuration for a challenge, from the `test:` frontmatter block.
 *
 * Structurally a sibling of `PracticeConfig`. An absent block yields
 * `{ type: 'call', timeoutMs: 5000 }`.
 */
export interface TestConfig {
	/** Execution strategy — selects the test environment alongside the language */
	type: TestTypeId;
	/** Per-case budget in ms; the suite budget is `cases × this`, capped at 60 s */
	timeoutMs: number;
}

/**
 * Which suite a result came from.
 *
 * `final` cases are hidden from the solver — their inputs and expected values
 * are never rendered, only pass/fail and duration.
 */
export type TestSuiteKind = 'public' | 'final';

/**
 * A single test case for a LeetCode problem.
 *
 * Inputs are passed by argument name; the expected value is compared by deep
 * equality against the candidate function's return value.
 */
export interface TestCase {
	/** Map of parameter name → argument value */
	input: Record<string, unknown>;
	/** Expected return value from the candidate function */
	expected: unknown;
}

/**
 * Outcome of executing a single `TestCase` against a candidate solution.
 *
 * `actual` is always a string so runners can serialise non-JSON-clean values
 * (`undefined`, `BigInt`, errors) uniformly.
 */
export interface TestResult {
	/** Zero-based index in the parent test array */
	index: number;
	/** True when `actual` deep-equals `expected` and no error was raised */
	passed: boolean;
	/** The exact input map that was fed to the runner */
	input: Record<string, unknown>;
	/** The expected value (kept for display alongside the actual result) */
	expected: unknown;
	/** Stringified actual return value from the candidate function */
	actual: string;
	/** Wall-clock execution time in milliseconds */
	duration: number;
	/** Error message when the runner failed (compile error, throw, timeout, …) */
	error?: string;
	/**
	 * Which suite this case belongs to. Optional so the runner never learns
	 * about suites — it is stamped on afterwards by `tagSuiteKinds`.
	 */
	kind?: TestSuiteKind;
}

/**
 * One stored solution attempt for a LeetCode problem.
 *
 * A problem may carry many solutions in different languages or strategies; the
 * latest passing one per language is typically marked with `solvedAt`.
 */
export interface LeetCodeSolution {
	/** Canonical `languageId` (e.g. `'typescript'`, `'python'`) */
	language: string;
	/** Optional short label distinguishing approaches (e.g. `'two-pointer'`) */
	label?: string;
	/** Full source code of the candidate function */
	code: string;
	/** ISO timestamp of the last successful run, when applicable */
	solvedAt?: string;
	/** Human-readable elapsed time of the last successful run */
	duration?: string;
}

/**
 * One recorded run from the `# Attempts` section of a LeetCode artifact.
 *
 * Written by `appendAttempt` (writer) on every live Submit — pass or fail,
 * including a timeout auto-submit — and read back by `extractAttempts`
 * (parser). `bigO` / `confidence` are omitted rather than defaulted when the
 * Big-O heuristic was never run against this entry's code (they are optional
 * on both the write and read side for that reason).
 */
export interface Attempt {
	/** Raw, lower-cased `## <Language>` heading text this entry was recorded under */
	language: string;
	/** ISO-8601 timestamp of the run */
	at: string;
	/** Human-readable elapsed time, e.g. `'8m22s'` */
	duration: string;
	/** True when every case (public + final) passed on this run */
	passed: boolean;
	/** Big-O notation from `estimateBigO`, e.g. `'O(n)'`, when computed for this run */
	bigO?: string;
	/** Confidence tier of the Big-O estimate (`'high' | 'medium' | 'low'`), when computed */
	confidence?: string;
	/** The submitted buffer, verbatim */
	code: string;
}

/**
 * Identifier of a practice-mode restriction offered before a challenge starts.
 *
 * The literal union is the contract between `PRACTICE_OPTIONS` (constants.ts),
 * the panel checkboxes, and the `practice.options` frontmatter list.
 */
export type PracticeOptionId =
	| 'noCompletion'
	| 'noAiAgents'
	| 'noSnippets'
	| 'noParameterHints';

/**
 * One practice-mode restriction: its UI copy and the VS Code settings it flips.
 *
 * `settings` values are written verbatim through
 * `vscode.workspace.getConfiguration().update()` at global scope while a
 * challenge is live, then restored from a snapshot on teardown.
 */
export interface PracticeOption {
	/** Stable id used in frontmatter and webview messages */
	id: PracticeOptionId;
	/** Checkbox caption shown in the preview panel */
	label: string;
	/** Secondary line explaining what the option turns off */
	hint: string;
	/** Whether the checkbox is ticked when the artifact declares no `practice.options` */
	defaultEnabled: boolean;
	/** VS Code setting key → value applied while the challenge runs */
	settings: Record<string, unknown>;
}

/**
 * Practice-mode configuration for a single challenge run.
 *
 * Seeded from the artifact's `practice:` frontmatter block (when present) and
 * from `PRACTICE_OPTIONS` defaults otherwise. When `locked` is true the panel
 * renders the checkboxes disabled and the extension ignores any option list the
 * webview sends — the artifact author has made them mandatory.
 */
export interface PracticeConfig {
	/** Restrictions to enforce for the duration of the challenge */
	options: PracticeOptionId[];
	/** Countdown in minutes; `0` means no limit */
	timeLimitMinutes: number;
	/** True when the artifact fixes these settings and the user may not change them */
	locked: boolean;
}

/**
 * Result of one clock tick, bounded or unbounded (P7).
 *
 * `unlimited: true` means `ms` is elapsed time counting up from the start
 * (`practice.timeLimit` was `0`/empty); `unlimited: false` means `ms` is
 * remaining time counting down to zero, clamped so it never goes negative.
 * The `MM:SS` rendering (`formatRemaining`) is identical for both — only the
 * "no limit" label and the auto-submit-at-zero behaviour differ.
 */
export interface TimerTick {
	/** `true` when this run has no deadline — `ms` counts up instead of down */
	unlimited: boolean;
	/** Milliseconds elapsed (unlimited) or remaining (bounded, clamped to 0) */
	ms: number;
}

/**
 * Lifecycle phase of the challenge selected in the sidebar view.
 *
 * - `idle`      — an exercise is open but no run has started (or a prior run ended)
 * - `running`   — Solve It has opened the attempt file; the countdown is live
 * - `solved`    — Submit graded every case as passing
 * - `attempted` — Submit ended the run with at least one failing case
 */
export type ChallengePhase = 'idle' | 'running' | 'solved' | 'attempted';

/**
 * Everything the sidebar view needs to know about the selected challenge.
 *
 * Owned by the live `ChallengeSession` while a run is in flight — kept current
 * by `leetcode-challenge.service.ts` and read by `leetcode-challenge.service.ts`
 * consumers (the view provider, and eventually the button-state and timer
 * features) via `challengeState()`.
 */
export interface ChallengeState {
	/** String form of the `.md` artifact's URI */
	exerciseUri: string;
	/** Display title, shown in confirmation dialogs */
	title: string;
	/** Canonical `languageId` chosen for this run */
	langId: string;
	/** String form of the attempt temp-file URI; `null` before Solve It */
	tempFileUri: string | null;
	/** Whether the attempt editor currently has an open tab */
	editorOpen: boolean;
	/** Practice restrictions applied for this run */
	options: PracticeOptionId[];
	/** Countdown length in minutes; `0` means unlimited */
	timeLimitMinutes: number;
	/** Epoch ms the run started; `null` when idle */
	startedAt: number | null;
	/** Epoch ms the countdown expires; `null` when unlimited or idle */
	deadline: number | null;
	/** Current lifecycle phase */
	phase: ChallengePhase;
}

/**
 * Starter code for one language — the signature stub the solver begins from.
 *
 * Parsed from the `# Setup` section's `## <Language>` fences. A language with
 * no setup block falls back to `generateBoilerplate()`.
 */
export interface ExerciseSetup {
	/** Lower-cased fence language as written in the `.md` (e.g. `'javascript'`) */
	language: string;
	/** Verbatim starter source — function definition, no solution body */
	code: string;
}

// ── `test.type: project` — multi-file, check-graded exercises ────────────────

/**
 * What the solver may do with a `## Files` entry.
 *
 * `readonly` is enforced by writing the file with a read-only file mode:
 * VS Code has no per-editor config scope, so "this tab edits, that one does
 * not" cannot be expressed through settings (spike §7).
 */
export type FileRole = 'editable' | 'readonly' | 'hidden';

/**
 * One file of a `project` exercise's tree, from a `## Files` fence.
 *
 * `path` is untrusted author input — it is normalised and containment-asserted
 * against the run directory before any write, never joined blindly.
 */
export interface FileSpec {
	/** POSIX-relative location inside the run directory; never absolute, never `..` */
	path: string;
	/** Canonical `languageId` resolved from the fence info-string */
	language: string;
	/** Whether the file is opened, and whether it is writable */
	role: FileRole;
	/** Verbatim file contents */
	content: string;
}

/**
 * Per-language dependency lists from `libs:`, keyed by canonical `languageId`.
 *
 * Every entry must pass `validateLibNames` before it reaches an install
 * subprocess — the shared install cache is a performance layer, never an
 * allowlist bypass.
 */
export type LibSpec = Record<string, string[]>;

/** Fields every `checks:` entry carries, whatever its `kind`. */
interface ProjectCheckBase {
	/** Unique within the artifact — results group by it, and cases bind to it by name */
	name: string;
	/** Cases bound to this check by a `check=<name>` fence attribute in `## Tests` */
	cases: TestCase[];
	/**
	 * How many leading entries of `cases` came from `## Tests` rather than
	 * `## Final Tests`.
	 *
	 * The public/final boundary is per **check**, not per artifact, because each
	 * check binds its own fences. Run Tests grades `cases.slice(0, publicCount)`
	 * — without this the hidden suite would leak into the mid-challenge loop.
	 */
	publicCount: number;
}

/**
 * Grades one exported function through the existing `function` machinery.
 *
 * At most **one** per project: a project's `params` /
 * `returns` are the artifact-level singletons, so a second function check would
 * have nowhere to declare its own types.
 */
export interface FunctionCheck extends ProjectCheckBase {
	kind: 'call';
	/** File within the run directory holding the export */
	file: string;
	/** Name of the export to call */
	function: string;
}

/** Passes when a declared argv exits 0. */
export interface BuildCheck extends ProjectCheckBase {
	kind: 'build';
	/** Command as an argv **array** — never a command string */
	argv: string[];
	/** Optional subtree to run in, relative to the run directory; containment-asserted */
	dir?: string;
}

/** Mounts a component in jsdom, fires events, asserts the resulting DOM. */
export interface DomAssertCheck extends ProjectCheckBase {
	kind: 'dom-assert';
	/** Component entry file within the run directory */
	file: string;
}

/**
 * Asserts **declared** style: inline/style-attribute properties and class
 * presence only. jsdom computes no layout, so geometry is out of scope by
 * construction rather than silently wrong.
 */
export interface CssAssertCheck extends ProjectCheckBase {
	kind: 'css-assert';
	/** Component entry file within the run directory */
	file: string;
}

/** One `packages:` entry — a single process this exercise's `stack` boots. */
export interface PackageSpec {
	readonly name: string;
	/** Shape-guarded only (see module doc) — relative, no `..`, no `node_modules` segment. */
	readonly dir: string;
	/** Argv array, never a command string. */
	readonly install: readonly string[];
	/** Argv array, never a command string. `${PORT}` is the only admitted substitution. */
	readonly start: readonly string[];
	/** Optional stdout substring an *additional* readiness signal may look for. */
	readonly ready?: string;
	/** Variable name → value template, S9-validated names only. */
	readonly exposeAs?: Readonly<Record<string, string>>;
	/** Package names this one boots after. */
	readonly dependsOn?: readonly string[];
}

/**
 * Sends real requests to a server this run booted, and compares the responses.
 *
 * The only check kind that names a `package` rather than a `file`: what it
 * grades is a *process*, booted from the `packages:` entry of that name, not
 * a file the driver reads. Its cases carry the request/response shape
 * `parseHttpCase` validates — loopback-only, never an artifact-supplied host.
 */
export interface HttpCheck extends ProjectCheckBase {
	kind: 'http';
	/** Name of the `packages:` entry to boot and send requests to */
	package: string;
}

/**
 * How a `package` / `stack` exercise is graded. **Solved = every check green.**
 *
 * Discriminated on `kind` so a consumer narrows to exactly the fields that
 * kind owns — a `build` check has an `argv`, a `dom-assert` has a component,
 * an `http` check has a package to boot.
 */
export type ProjectCheck = FunctionCheck | BuildCheck | DomAssertCheck | CssAssertCheck | HttpCheck;

/**
 * One instruction the render driver performs against a mounted component.
 *
 * Deliberately a small declarative union rather than a snippet of JavaScript the
 * artifact supplies: a case describes *what to do and read*, and the driver — not
 * the artifact — decides how. Reading steps produce the case's observed value,
 * which is compared against `expected` through the same canonical-JSON path every
 * other test type uses.
 */
export type RenderStep =
	| { op: 'click'; selector: string }
	| { op: 'change'; selector: string; value: string }
	| { op: 'text'; selector: string }
	| { op: 'count'; selector: string }
	| { op: 'attr'; selector: string; name: string }
	/** **Declared** style only — `element.style[property]`, never a computed box. */
	| { op: 'style'; selector: string; property: string };

/**
 * Verdict for one `ProjectCheck`.
 *
 * Every kind reduces to the same three fields, so the panel renders one results
 * table whether the check compiled a project or asserted a DOM node. `detail`
 * is the child's output, a failed assertion, or the reason the check was refused
 * before it ran.
 */
export interface ProjectCheckOutcome {
	/** The check's declared name — results group by it */
	name: string;
	/** True when the check's condition held */
	passed: boolean;
	/** Output or reason, trimmed for display; omitted when there is nothing to say */
	detail?: string;
}

/**
 * The fully parsed representation of a LeetCode `.md` artifact.
 *
 * Built by the LeetCode parser from frontmatter, the problem description, the
 * `## Tests` block, and any `## Solution` blocks in the vault file.
 */
export interface ParsedLeetCode {
	/** Display title of the problem */
	title: string;
	/**
	 * The leetcode-type axis (`src/types/leetcode-type.ts`) — what the artifact
	 * *is*: one buffer, one package, or several. Declared `leetcodeType:` when
	 * recognised, else derived from the legacy `test.type` scalar (plan §C.6).
	 * **Required (C1/C6).** It was optional while nothing outside the parser
	 * read it, so a hand-built fixture need not supply one. The moment a call
	 * site does read it, the cheap fix for an absent value — `?? 'function'`
	 * — silently grades a `stack` as a single buffer, which is the exact
	 * flattening the axis split exists to remove. Fixtures declare it instead.
	 */
	leetcodeType: LeetcodeTypeId;
	/** Canonical difficulty tier */
	difficulty: LeetCodeDifficulty;
	/** Identifier of the candidate function the user is expected to implement */
	functionName: string;
	/**
	 * Per-language override of `functionName`, from the `functions:` frontmatter
	 * block. Keyed by canonical `languageId` (aliases resolved at parse time).
	 * Absent entirely, or missing a given language, falls back to `functionName`
	 * — use `functionNameFor()` rather than reading this directly.
	 */
	functions?: Record<string, string>;
	/** Optional algorithm tag (e.g. `'two-pointer'`, `'dp'`) */
	algorithm?: string;
	/** Current solve status derived from stored run history */
	status: LeetCodeStatus;
	/** Declared parameters of the candidate function */
	params: ParamDef[];
	/** Return type annotation of the candidate function */
	returns: string;
	/** Markdown body of the problem description */
	description: string;
	/** Inline `Input → Output` examples shown in the preview */
	examples: { input: string; output: string }[];
	/** Public test cases from `## Tests` — visible, run by Run Tests */
	tests: TestCase[];
	/**
	 * Grading cases from `## Final Tests` — hidden, appended by Submit. Raw:
	 * `[]` when the section is absent. The legacy fallback (Submit grades the
	 * public list) is resolved in `submitSuite`, never in the parser.
	 */
	finalTests: TestCase[];
	/** Execution configuration from the `test:` frontmatter block */
	test: TestConfig;
	/** Per-language starter stubs from the `# Setup` section */
	setups: ExerciseSetup[];
	/** Practice-mode defaults declared by the artifact (or library defaults) */
	practice: PracticeConfig;
	/** Stored solution attempts across languages */
	solutions: LeetCodeSolution[];
	/** Recorded Submit runs (pass and fail) from the `# Attempts` section, newest first per language */
	attempts: Attempt[];
	/** Organisational tags from frontmatter (e.g. `['arrays', 'hash-map']`); `[]` when absent */
	tags: string[];
	/**
	 * `## Files` tree — `test.type: project` only, absent for a `function`
	 * artifact. Optional rather than `[]`-defaulted because a single-function
	 * exercise has no file tree, and an empty array would imply it does.
	 */
	files?: FileSpec[];
	/** `libs:` dependency lists — `package` / `stack` only */
	libs?: LibSpec;
	/**
	 * Reference implementations for `## Files` entries, from `# Solutions` fences
	 * carrying a `path=` attribute — `project` / `service` only.
	 *
	 * `## Files` ships the **starter** a solver begins from, so grading the tree
	 * as authored would fail every exercise by design. The harness overlays these
	 * by path to grade the reference; a solver's run never applies them, exactly
	 * as `# Solutions` stays behind a spoiler in the panel.
	 */
	solutionFiles?: FileSpec[];
	/** `checks:` grading rules — `package` / `stack` only. **Solved = every check green.** */
	checks?: ProjectCheck[];
	/**
	 * `packages:` entries — the processes this artifact can boot, one per
	 * buildable unit. An `http` check names one by `package:`, and that name
	 * is resolved against this list at dispatch time.
	 *
	 * `undefined` rather than `[]` when the block is absent, for the reason
	 * `libs` is: `JSON.stringify` omits an undefined key, so a `function`
	 * artifact's serialised shape is unchanged by a field it can never carry.
	 */
	packages?: readonly PackageSpec[];
	/**
	 * `program:` block — how a `program` case is delivered (argv / flags /
	 * stdin) and which file is the entry point.
	 *
	 * `undefined` when the artifact declares no block, which is every artifact
	 * that is not graded by the `program` test type. Optional rather than
	 * defaulted for the reason C1 records about `leetcodeType`: a default here
	 * would let an artifact that never declared a channel be run as though it
	 * had declared `argv`, and the runner would then pass arguments a program
	 * was never written to read.
	 */
	program?: ProgramConfig;
	/**
	 * Author-facing parse problems that degraded to a default (an unknown `role`,
	 * a rejected lib, a near-miss frontmatter key). Populated for a multi-file
	 * artifact; a silent drop is indistinguishable from an absent declaration.
	 */
	warnings?: string[];
}

/**
 * The subset of `ParsedLeetCode` the exercise picker needs to render a
 * `QuickPickItem` — title, difficulty, status, algorithm, tags.
 *
 * `parseLeetCode` (full parse) and `parseFrontmatterOnly` (frontmatter-only
 * fast path) both produce a `ParsedLeetCode` / `LeetCodeSummary` respectively;
 * `buildQuickPickItems` accepts either since a full `ParsedLeetCode` is a
 * structural superset of this shape.
 */
export interface LeetCodeSummary {
	/** Display title of the problem */
	title: string;
	/**
	 * The leetcode-type axis — see `ParsedLeetCode.leetcodeType`. Optional for
	 * the same reason: existing `LeetCodeSummary` fixtures across the codebase
	 * do not supply it, and `parseFrontmatterOnly` always does.
	 */
	leetcodeType?: LeetcodeTypeId;
	/** Canonical difficulty tier */
	difficulty: LeetCodeDifficulty;
	/** Current solve status derived from stored run history */
	status: LeetCodeStatus;
	/** Optional algorithm tag (e.g. `'two-pointer'`, `'dp'`) */
	algorithm?: string;
	/** Organisational tags from frontmatter; `[]` when absent */
	tags: string[];
}

/** Confidence tier for a `BigOEstimate` — how much of the classification was inferred vs. counted. */
export type BigOConfidence = 'high' | 'medium' | 'low';

/**
 * Result of a static Big-O heuristic pass over one candidate's source.
 *
 * This is **informational, never pass/fail** — static loop-counting is easily
 * fooled (hidden library costs, early returns, amortised structures), so a
 * caller must always render `confidence` and `reason` alongside `notation`
 * rather than treating the notation as a verdict.
 */
export interface BigOEstimate {
	/** Complexity class, e.g. `'O(n)'`, `'O(n^2)'`, `'O(n log n)'`, `'O(2^n)?'` */
	notation: string;
	/** How much of `notation` was counted directly vs. inferred/guessed */
	confidence: BigOConfidence;
	/** One-line, user-facing explanation of how `notation` was reached */
	reason: string;
}

/**
 * One run to append to an artifact's `# Attempts` section — the writer-side
 * counterpart of `Attempt` (no `language`; that comes from the `langId`
 * argument to `appendAttempt`, resolved to canonical the same way).
 */
export interface AttemptEntry {
	/** ISO-8601 timestamp of the run */
	at: string;
	/** Human-readable elapsed time, e.g. `'8m22s'` */
	duration: string;
	/** True when every case (public + final) passed on this run */
	passed: boolean;
	/** Big-O notation from `estimateBigO`, when computed for this run */
	bigO?: string;
	/** Confidence tier of the Big-O estimate, when computed */
	confidence?: string;
	/** The submitted buffer, verbatim */
	code: string;
}
