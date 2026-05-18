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
