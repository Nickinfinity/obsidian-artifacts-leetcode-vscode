import { DEFAULT_TEST_TYPE, SHAPE_TEST_TYPE_IDS } from '../../types/constants.js';
import type { LeetcodeTypeId } from '../../types/leetcode-type.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { runProjectChecks } from '../test-envs/project/project.runner.js';

/**
 * Verifies a `package`/`stack`-shaped artifact: a file tree graded by
 * declared `checks:` — **solved = every check green**, never one function's
 * return value.
 *
 * Structure is checked first and cheaply — a malformed artifact is reported
 * without materialising a tree or installing a toolchain — then every check
 * is actually run against the `# Solutions` overlay.
 *
 * @param parsed       - Parsed artifact whose `leetcodeType` is `package` (or
 *   `stack`, once a dedicated rule set exists — see `rules.registry.ts`).
 * @param leetcodeType - The resolved type, for the message prefix only
 *   (`package:` / `stack:`) — never used to branch, so this file stays a
 *   single rule set regardless of which id dispatched here.
 * @returns The first broken rule or failing check's reason, or `null` when it
 *   grades green.
 *
 * @example
 * await verifyPackageExercise({ ...parsed, files: [f], checks: [c] }, 'package'); // → null
 */
export async function verifyPackageExercise(
	parsed: ParsedLeetCode, leetcodeType: LeetcodeTypeId,
): Promise<string | null> {
	const structural = checkPackageStructure(parsed, leetcodeType);
	if (structural) { return structural; }

	// The harness grades the reference tree: `## Files` is the solver's starter,
	// so grading it as authored would fail every exercise by design.
	const outcomes = await runProjectChecks(parsed, { withSolutions: true });
	const failed = outcomes.find(o => !o.passed);
	if (failed) {
		const detail = failed.detail ? `: ${failed.detail}` : '';
		return `${leetcodeType}: check '${failed.name}' failed${detail}`;
	}

	// Green with no overlay means `withSolutions` had nothing to apply, so what
	// just passed *is* the starter — the solver presses Solve It, Submit, and is
	// marked solved having written nothing. No second grading run is needed to
	// know this: green ∧ no overlay ⟺ the starter passes.
	if (!parsed.solutionFiles?.length) {
		return `${leetcodeType}: ships pre-solved — every check passes against \`## Files\` itself; `
			+ 'add `# Solutions` fences carrying `path=` so the starter is graded unsolved';
	}
	return null;
}

/** Shape rules that need no execution — checked before anything is written or installed. */
function checkPackageStructure(parsed: ParsedLeetCode, leetcodeType: LeetcodeTypeId): string | null {
	if (!parsed.title) { return 'parse: missing title'; }
	if (!parsed.files?.length) { return `${leetcodeType}: no ## Files declared`; }
	if (!parsed.checks?.length) { return `${leetcodeType}: no checks declared — solved means every check green`; }

	const names = parsed.checks.map(c => c.name);
	if (new Set(names).size !== names.length) { return `${leetcodeType}: check names are not unique`; }

	const unbound = parsed.checks.filter(c => c.kind !== 'build' && c.cases.length === 0);
	if (unbound.length > 0) {
		return `${leetcodeType}: check '${unbound[0].name}' has no cases — bind them with a \`check=\` fence attribute`;
	}

	return checkTestTypeMirror(parsed, leetcodeType);
}

/**
 * The `checks:` / `test.type` mirror rule (VSX-154 / T1.7): `checks:` present
 * ⟺ `test.type` absent — a checks-graded artifact must not *also* name a
 * top-level execution strategy. The legacy shape markers (`project` /
 * `service`, `SHAPE_TEST_TYPE_IDS`) are tolerated because an unmigrated
 * artifact still carries one; they are shapes, not strategies.
 *
 * `checks:` is only reachable here once `checkPackageStructure`'s earlier
 * rules have confirmed it is non-empty, so this function only needs to guard
 * the one direction that is not already a build-time guarantee: an artifact
 * that declares checks but *also* a genuine `test.type`.
 *
 * Without this, a checks-graded artifact that simply omits `type:` inherits
 * `DEFAULT_TEST_TYPE` ('function') — a value the compatibility matrix permits
 * for `package` — and would be gradeable as a single call suite with no
 * params, no returns and no cases, while the checks that actually grade it
 * are never consulted. It also resolves through `testEnvFor(...)`, so the
 * mis-parse would survive all the way to a run.
 *
 * **An absent `test.type` is the target state, not a violation.** The
 * migration deletes the `type:` line from every `test:` block that declares
 * `checks:`, so a migrated artifact declares no strategy at all — and an
 * absent value is indistinguishable here from the default, because
 * `parseTestType` collapses the two before the verifier ever sees them. This
 * rule therefore accepts the default alongside the legacy shape markers, and
 * refuses only a *deliberately named* single-suite strategy. Requiring the
 * shape marker to be **present** — as an earlier cut did — would have failed
 * every artifact the migration produces.
 *
 * The residual hole is an explicit `type:` naming exactly the default, which
 * reads as absent. Closing it needs the parser to record declared-vs-defaulted;
 * it is not worth a second parse here, and the artifact still grades by its
 * checks either way.
 *
 * @param parsed       - Parsed artifact, already known to declare `checks:`.
 * @param leetcodeType - The resolved type, for the message prefix only.
 * @returns A reason naming both facts, or `null` when no competing strategy
 *   is declared.
 *
 * @example
 * checkTestTypeMirror({ ...parsed, test: { type: 'project', timeoutMs: 5000 } }, 'package'); // → null
 * @example
 * checkTestTypeMirror({ ...parsed, test: { type: 'in-place', timeoutMs: 5000 } }, 'package'); // → a reason
 */
function checkTestTypeMirror(parsed: ParsedLeetCode, leetcodeType: LeetcodeTypeId): string | null {
	const declared = parsed.test.type;
	if (SHAPE_TEST_TYPE_IDS.has(declared) || declared === DEFAULT_TEST_TYPE) { return null; }
	return `${leetcodeType}: checks declared but test.type is '${declared}' — `
		+ 'a checks-graded exercise must not also declare a top-level execution strategy';
}
