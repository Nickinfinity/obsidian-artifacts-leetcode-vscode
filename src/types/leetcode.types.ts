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
}

/**
 * One stored solution attempt for a LeetCode problem.
 *
 * A problem may carry many solutions in different languages or strategies; the
 * latest passing one per language is typically marked with `solvedAt`.
 */
export interface LeetCodeSolution {
	/** Language id matching a `LangRunner.id` (e.g. `'typescript'`, `'python'`) */
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

/**
 * The fully parsed representation of a LeetCode `.md` artifact.
 *
 * Built by the LeetCode parser from frontmatter, the problem description, the
 * `## Tests` block, and any `## Solution` blocks in the vault file.
 */
export interface ParsedLeetCode {
	/** Display title of the problem */
	title: string;
	/** Canonical difficulty tier */
	difficulty: LeetCodeDifficulty;
	/** Identifier of the candidate function the user is expected to implement */
	functionName: string;
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
	/** Test cases run against the candidate function */
	tests: TestCase[];
	/** Per-language starter stubs from the `# Setup` section */
	setups: ExerciseSetup[];
	/** Practice-mode defaults declared by the artifact (or library defaults) */
	practice: PracticeConfig;
	/** Stored solution attempts across languages */
	solutions: LeetCodeSolution[];
}

/**
 * Per-language runner configuration used by the LeetCode test executor.
 *
 * Each runner knows how to write a candidate solution to disk, optionally
 * compile it, and invoke the resulting program. `detectCmd` is run once to
 * confirm the language toolchain is installed on the host.
 */
export interface LangRunner {
	/** Stable identifier (e.g. `'typescript'`, `'python'`) */
	id: string;
	/** Human-readable name shown in pickers */
	displayName: string;
	/** Source-file extension including leading dot (e.g. `'.ts'`) */
	fileExtension: string;
	/** Optional override for the source file's base name (default: problem slug) */
	fileName?: string;
	/** Optional compile step — returns the shell command to compile `filePath` */
	compile?: (filePath: string) => string;
	/** Returns the shell command to run the (possibly compiled) program */
	run: (filePath: string) => string;
	/** Probe command used to verify the toolchain is available (e.g. `'node --version'`) */
	detectCmd: string;
}
