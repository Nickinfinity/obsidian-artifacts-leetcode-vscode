import { canonicalJson } from '../../utils/canonical-json.js';
import { safeJsonParse } from '../../utils/safe-json.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { buildExecutable } from '../leetcode-candidate.helpers.js';
import { runSuite } from '../leetcode-runner.service.js';
import { submitSuite } from '../leetcode-suite.helpers.js';
import { isBatchEnv, languagesForType, testEnvFor } from '../test-envs/env.registry.js';

/** Structural floors a migrated exercise must clear — relaxed for a reserved (no-env) `test.type`. */
const MIN_EXAMPLES = 2;
const MIN_PUBLIC_TESTS = 6;
const MIN_FINAL_TESTS = 3;
const MIN_RESERVED_TESTS = 1;

/**
 * Verifies a `function`-shaped artifact: one candidate buffer per language,
 * measured against the structural floors and — for a runnable `test.type` —
 * its own reference solution(s) actually running green.
 *
 * The **only** home of the function floors (`params`/`returns`, the 6-public /
 * 3-final case counts, the `## Examples ⊆ ## Tests` pin) — moved here
 * byte-for-byte from `exercise-verify.helpers.ts` (VSX-154 / T1.7), so a
 * `package`/`stack` artifact routed elsewhere by the rules registry can never
 * be measured against them again.
 *
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
 *    `params`/`returns` presence floors, and the ground-truth pin (5). `ok`
 *    for a reserved type therefore means **well-formed**, never **executed**.
 * 5. Ground-truth pin — every `## Examples` pair must also appear as a public
 *    `## Tests` case (set-equal input keys, equal `expected`).
 *
 * @param parsed - The already-parsed artifact.
 * @returns The first broken rule's reason, or `null` when it verifies clean.
 *
 * @example
 * await verifyFunctionExercise(parseLeetCode(md)); // → null, or a reason string
 */
export async function verifyFunctionExercise(parsed: ParsedLeetCode): Promise<string | null> {
	// C9: `'function'`, and never `parsed.leetcodeType`. This rule set is
	// reached only through `VERIFY_RULES['function']`, so the artifact's shape
	// is already known to be a buffer — but the argument became required at
	// T3.5, and the two honest answers are not the same. Asking the registry
	// about a *tree* here would answer "reserved" for every tree, which is
	// meaningless: a tree declares no suite the registry can serve, and what
	// makes it ungradeable is a dropped check kind, not an empty language
	// list. Reserved therefore keeps its one meaning — *this buffer's
	// `test.type` has no environment* — and a tree is never asked.
	const reserved = languagesForType(parsed.test.type, 'function').length === 0;

	const parseReason = checkParses(parsed, reserved);
	if (parseReason) { return parseReason; }

	const structuralReason = checkStructure(parsed, reserved);
	if (structuralReason) { return structuralReason; }

	// Rules 3 and 5 both assume `## Examples` and `## Tests` describe one
	// function's input and output. A reserved type has no such function — its
	// examples are illustrative (an HTTP request/response sample) — so both are
	// skipped and `ok` means *well-formed*, never *executed*.
	if (reserved) { return null; }

	const runReason = await checkSolutionsGreen(parsed);
	if (runReason) { return runReason; }

	return checkExamplesPinned(parsed);
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
	// the shape it is measured by.
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

// ── Rule 3: runnable languages green (skipped for a reserved test.type) ──────

/**
 * Rule 3 — every language present in both `# Setup` and `# Solutions` must
 * pass its full (public + final) suite via `runSuite`.
 */
async function checkSolutionsGreen(parsed: ParsedLeetCode): Promise<string | null> {
	const setupLangs = new Set(parsed.setups.map(s => s.language));
	const languages = [...new Set(parsed.solutions.map(s => s.language))].filter(l => setupLangs.has(l));
	const suite = submitSuite(parsed);

	for (const lang of languages) {
		const env = testEnvFor(parsed.test.type, lang, 'function');
		const solution = parsed.solutions.find(s => s.language === lang);
		// A non-batch env (`program`) never reaches here: this rule set is
		// dispatched for `leetcodeType: function` only, and a `program` env
		// declares `leetcodeTypes: ['package']`. The narrowing is the honest
		// way to say that — `runSuite` cannot execute a per-case env, and a
		// cast would let a future registration through silently.
		if (!env || !isBatchEnv(env) || !solution) { continue; }

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
