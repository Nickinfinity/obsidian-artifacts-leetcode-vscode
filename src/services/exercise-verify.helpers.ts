import { canonicalJson } from '../utils/canonical-json.js';
import { safeJsonParse } from '../utils/safe-json.js';
import type { ParsedLeetCode, TestCase } from '../types/leetcode.types.js';
import { buildExecutable } from './leetcode-candidate.helpers.js';
import { parseLeetCode } from './leetcode-parser.service.js';
import { runSuite } from './leetcode-runner.service.js';
import { submitSuite } from './leetcode-suite.helpers.js';
import { languagesForType, testEnvFor } from './test-envs/env.registry.js';
import { runProjectChecks } from './test-envs/project/project.runner.js';

/** Structural floors a migrated exercise must clear — relaxed for a reserved (no-env) `test.type`. */
const MIN_EXAMPLES = 2;
const MIN_PUBLIC_TESTS = 6;
const MIN_FINAL_TESTS = 3;
const MIN_RESERVED_TESTS = 1;

/** `verifyExercise` succeeded — the exercise conforms and (if runnable) every declared language is green. */
export interface VerifyOk { ok: true }

/** `verifyExercise` failed — `reason` names the first rule that broke. */
export interface VerifyFail { ok: false; reason: string }

export type VerifyResult = VerifyOk | VerifyFail;

/** One case where the artifact's `expected` disagrees with an independently recomputed value. */
export interface ExpectedMismatch {
	/** Zero-based index into the compared case list */
	index: number;
	/** The case's input map, carried through for the reviewer's diff */
	input: Record<string, unknown>;
	/** `expected` as stored in the artifact */
	artifact: unknown;
	/** `expected` as recomputed independently, to cross-check the stored value */
	recomputed: unknown;
}

/**
 * Verifies a `type: leetcode` artifact conforms to the on-disk format and, for a
 * runnable `test.type`, that every language carrying both a `# Setup` and a
 * `# Solutions` entry passes its full (public + final) suite.
 *
 * This is the uniform harness: it does not judge whether the exercise's
 * algorithm is *interesting* — only that the file is well-formed and its own
 * reference solution(s) actually run green.
 * Checks run in order and the first failure is reported, never accumulated:
 *
 * 1. Parses — non-empty `title`, and (for a runnable `test.type`) non-empty
 *    `functionName`.
 * 2. Structural shape — example/test/final-test count floors, `params`/
 *    `returns` present, and every test/final-test input's keys set-equal the
 *    declared `params` names.
 * 3. Runnable languages green — every language present in both `# Setup` and
 *    `# Solutions` passes `runSuite` against public + final.
 * 4. Reserved `test.type` (`languagesForType` empty) — it has no candidate
 *    function, so the public-test floor relaxes to `MIN_RESERVED_TESTS` and
 *    everything that measures a function is skipped: the run step (3), the
 *    `params`/`returns` presence floors, and the ground-truth pin (5). `ok` for
 *    a reserved type therefore means **well-formed**, never **executed** —
 *    `service` is check-graded and has no env, so nothing about it is run.
 * 5. Ground-truth pin — every `## Examples` pair must also appear as a public
 *    `## Tests` case (set-equal input keys, equal `expected`).
 *
 * @param md   - Full `.md` artifact content.
 * @param path - Optional file path, prefixed onto a failure's `reason` for a
 *   caller walking many files.
 * @returns `{ ok: true }`, or `{ ok: false, reason }` naming the first broken rule.
 *
 * @example
 * await verifyExercise(fs.readFileSync(vaultPath, 'utf-8'));
 * // → { ok: true }
 */
export async function verifyExercise(md: string, path?: string): Promise<VerifyResult> {
	const parsed = parseLeetCode(md);
	const fail = (reason: string): VerifyFail => ({ ok: false, reason: path ? `${path}: ${reason}` : reason });

	// A `project` is graded by declared checks, not by one function's return
	// value: it has no `params` / `returns` and no public/final case floors, so
	// it must never reach the function rules below. This branch exists because
	// `project` is now `implemented` — without it, `reserved` computes false and
	// every project artifact is mis-graded against the function floor.
	if (parsed.test.type === 'project') {
		const projectReason = await verifyProjectExercise(parsed);
		return projectReason ? fail(projectReason) : { ok: true };
	}

	const reserved = languagesForType(parsed.test.type).length === 0;

	const parseReason = checkParses(parsed, reserved);
	if (parseReason) { return fail(parseReason); }

	const structuralReason = checkStructure(parsed, reserved);
	if (structuralReason) { return fail(structuralReason); }

	// Rules 3 and 5 both assume `## Examples` and `## Tests` describe one
	// function's input and output. A reserved type has no such function — its
	// examples are illustrative (an HTTP request/response sample) — so both are
	// skipped and `ok` means *well-formed*, never *executed*.
	if (!reserved) {
		const runReason = await checkSolutionsGreen(parsed);
		if (runReason) { return fail(runReason); }

		const pinReason = checkExamplesPinned(parsed);
		if (pinReason) { return fail(pinReason); }
	}

	return { ok: true };
}

/**
 * Compares an artifact's stored `expected` values against an independently
 * recomputed list, by shared index.
 *
 * @param artifactCases - The artifact's own cases (`## Tests` + `## Final Tests`, in order).
 * @param recomputed    - Independently recomputed `expected` values, same order.
 * @returns Rows where the two disagree; `[]` when every index agrees.
 *
 * @example
 * compareExpecteds([{ input: { a: 1 }, expected: 2 }], [2]); // → []
 * compareExpecteds([{ input: { a: 1 }, expected: 2 }], [3]);
 * // → [{ index: 0, input: { a: 1 }, artifact: 2, recomputed: 3 }]
 */
export function compareExpecteds(artifactCases: TestCase[], recomputed: unknown[]): ExpectedMismatch[] {
	const mismatches: ExpectedMismatch[] = [];
	artifactCases.forEach((c, index) => {
		const theirs = recomputed[index];
		if (canonicalJson(c.expected) !== canonicalJson(theirs)) {
			mismatches.push({ index, input: c.input, artifact: c.expected, recomputed: theirs });
		}
	});
	return mismatches;
}

// ── project: structural rules only (no function floor, nothing executed) ─────

/**
 * Structural rules for a `test.type: project` artifact — the branch that keeps
 * a check-graded exercise away from the function floor.
 *
 * A project declares a file tree and a list of checks; it has no `params` /
 * `returns` and no 6-public / 3-final case counts, because "solved" means
 * *every check green*, not "one function returned the expected value".
 *
 * Structure is checked first and cheaply — a malformed artifact is reported
 * without materialising a tree or installing a toolchain — then every check is
 * actually run.
 *
 * @param parsed - Parsed artifact whose `test.type` is `project`.
 * @returns The first broken rule or failing check, or `null` when it grades green.
 *
 * @example
 * await verifyProjectExercise({ ...parsed, files: [f], checks: [c] }); // → null
 */
async function verifyProjectExercise(parsed: ParsedLeetCode): Promise<string | null> {
	const structural = checkProjectStructure(parsed);
	if (structural) { return structural; }

	// The harness grades the reference tree: `## Files` is the solver's starter,
	// so grading it as authored would fail every exercise by design.
	const outcomes = await runProjectChecks(parsed, { withSolutions: true });
	const failed = outcomes.find(o => !o.passed);
	if (failed) {
		const detail = failed.detail ? `: ${failed.detail}` : '';
		return `project: check '${failed.name}' failed${detail}`;
	}

	// Green with no overlay means `withSolutions` had nothing to apply, so what
	// just passed *is* the starter — the solver presses Solve It, Submit, and is
	// marked solved having written nothing. No second grading run is needed to
	// know this: green ∧ no overlay ⟺ the starter passes.
	if (!parsed.solutionFiles?.length) {
		return 'project: ships pre-solved — every check passes against `## Files` itself; '
			+ 'add `# Solutions` fences carrying `path=` so the starter is graded unsolved';
	}
	return null;
}

/** Shape rules that need no execution — checked before anything is written or installed. */
function checkProjectStructure(parsed: ParsedLeetCode): string | null {
	if (!parsed.title) { return 'parse: missing title'; }
	if (!parsed.files?.length) { return 'project: no ## Files declared'; }
	if (!parsed.checks?.length) { return 'project: no checks declared — solved means every check green'; }

	const names = parsed.checks.map(c => c.name);
	if (new Set(names).size !== names.length) { return 'project: check names are not unique'; }

	const unbound = parsed.checks.filter(c => c.kind !== 'build' && c.cases.length === 0);
	if (unbound.length > 0) {
		return `project: check '${unbound[0].name}' has no cases — bind them with a \`check=\` fence attribute`;
	}
	return null;
}

// ── Rule 1: parses ────────────────────────────────────────────────────────────

/** Rule 1 — non-empty title, and (when runnable) a non-empty function name. */
function checkParses(parsed: ParsedLeetCode, reserved: boolean): string | null {
	if (!parsed.title) { return 'parse: missing title'; }
	if (!reserved && !parsed.functionName) { return 'parse: missing function name'; }
	return null;
}

// ── Rule 2: structural shape ──────────────────────────────────────────────────

/** Rule 2 — example/test/final-test floors, params/returns presence, input-key match. */
function checkStructure(parsed: ParsedLeetCode, reserved: boolean): string | null {
	if (parsed.examples.length < MIN_EXAMPLES) {
		return `structural: need >= ${MIN_EXAMPLES} examples, got ${parsed.examples.length}`;
	}

	const testsFloor = reserved ? MIN_RESERVED_TESTS : MIN_PUBLIC_TESTS;
	if (parsed.tests.length < testsFloor) {
		return `structural: need >= ${testsFloor} public tests, got ${parsed.tests.length}`;
	}
	if (!reserved && parsed.finalTests.length < MIN_FINAL_TESTS) {
		return `structural: need >= ${MIN_FINAL_TESTS} final tests, got ${parsed.finalTests.length}`;
	}
	// A reserved type has no candidate function, so `params` / `returns` are not
	// the shape it is measured by — `service` is check-graded like `project` and
	// used to fail with the misleading `structural: missing params`.
	if (!reserved && parsed.params.length === 0) { return 'structural: missing params'; }
	if (!reserved && !parsed.returns) { return 'structural: missing returns'; }

	// Matching input keys against an empty param set is not a check, it is a
	// guaranteed failure; a runnable type always has params by the rule above,
	// so this guard changes nothing there.
	if (parsed.params.length === 0) { return null; }
	return checkInputKeysMatchParams(parsed);
}

/** Every `## Tests` / `## Final Tests` case's input keys must set-equal the declared `params` names. */
function checkInputKeysMatchParams(parsed: ParsedLeetCode): string | null {
	const paramNames = new Set(parsed.params.map(p => p.name));
	const allCases = [...parsed.tests, ...parsed.finalTests];
	for (const [index, c] of allCases.entries()) {
		if (!sameKeys(new Set(Object.keys(c.input)), paramNames)) {
			return `structural: test[${index}] input keys do not match params`;
		}
	}
	return null;
}

// ── Rule 3/4: runnable languages green (skipped for a reserved test.type) ────

/**
 * Rule 3 — every language present in both `# Setup` and `# Solutions` must
 * pass its full (public + final) suite via `runSuite`.
 */
async function checkSolutionsGreen(parsed: ParsedLeetCode): Promise<string | null> {
	const setupLangs = new Set(parsed.setups.map(s => s.language));
	const languages = [...new Set(parsed.solutions.map(s => s.language))].filter(l => setupLangs.has(l));
	const suite = submitSuite(parsed);

	for (const lang of languages) {
		const env = testEnvFor(parsed.test.type, lang);
		const solution = parsed.solutions.find(s => s.language === lang);
		if (!env || !solution) { continue; }

		const candidate = buildExecutable(parsed, lang, solution.code);
		const results = await runSuite(candidate, suite, parsed, env);
		const bad = results.find(r => !r.passed);
		if (bad) {
			const mismatch = `expected ${canonicalJson(bad.expected)}, got ${bad.actual}`;
			return `run: ${lang} failed case ${bad.index}: ${bad.error ?? mismatch}`;
		}
	}
	return null;
}

// ── Rule 5: ## Examples ⊆ ## Tests pin ────────────────────────────────────────

/** Rule 5 — every example's input/output pair must reappear as a public test case. */
function checkExamplesPinned(parsed: ParsedLeetCode): string | null {
	for (const [index, example] of parsed.examples.entries()) {
		const input = parseExampleInput(example.input);
		if (input === null) { return `pin: example[${index}] input is not parseable`; }

		const output = safeJsonParse(example.output);
		const reproduced = parsed.tests.some(t =>
			canonicalJson(t.input) === canonicalJson(input) && canonicalJson(t.expected) === canonicalJson(output));
		if (!reproduced) { return `pin: example[${index}] not mirrored in ## Tests`; }
	}
	return null;
}

/**
 * Parses an example's free-form `input:` line (`"a = 1, b = [2,7]"`) into a
 * key → value map, splitting on top-level commas only (a comma inside
 * `[...]` / `{...}` does not separate pairs).
 *
 * @param raw - The example's raw input string, as returned by `extractExamples`.
 * @returns The parsed map, or `null` when any pair is not `key=value` or its
 *   value is not valid JSON.
 *
 * @example
 * parseExampleInput('nums = [2,7,11,15], target = 9');
 * // → { nums: [2, 7, 11, 15], target: 9 }
 */
function parseExampleInput(raw: string): Record<string, unknown> | null {
	const out: Record<string, unknown> = {};
	for (const pair of splitTopLevel(raw, ',')) {
		const eq = pair.indexOf('=');
		if (eq === -1) { return null; }
		const key = pair.slice(0, eq).trim();
		const rawVal = pair.slice(eq + 1).trim();
		const val = safeJsonParse(rawVal);
		if (val === null && rawVal !== 'null') { return null; }
		out[key] = val;
	}
	return out;
}

/** Split `s` on `sep` at bracket-depth 0 only — a `[` / `{` suspends splitting until its match closes. */
function splitTopLevel(s: string, sep: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const ch of s) {
		if (ch === '[' || ch === '{') { depth++; }
		else if (ch === ']' || ch === '}') { depth--; }

		if (ch === sep && depth === 0) {
			parts.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	parts.push(current);
	return parts;
}

/** Set equality — same size, every member of `a` present in `b`. */
function sameKeys(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) { return false; }
	for (const k of a) { if (!b.has(k)) { return false; } }
	return true;
}
