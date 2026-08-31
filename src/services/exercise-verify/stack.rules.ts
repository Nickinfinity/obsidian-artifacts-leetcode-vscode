import type { LeetcodeTypeId } from '../../types/leetcode-type.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import type { VerifyRunOptions } from './rules.registry.js';
import { verifyPackageExercise } from './package.rules.js';

/**
 * A `stack`'s defining property (VSX-181 / T4.4): *several* wired-together
 * packages, never zero or one. A `dependsOn` cycle, a duplicate `name` and
 * the 8-entry cap are already parse errors
 * (`packages-parser.helpers.ts`) and are deliberately not re-checked here.
 */
const MIN_STACK_PACKAGES = 2;

/**
 * Verifies a `stack`-shaped artifact: several packages, each with its own
 * language and ecosystem, wired together at boot — graded by declared
 * `checks:` exactly like a `package`, once the shape that makes it a `stack`
 * at all actually holds.
 *
 * Three rules are new here; everything else — the file tree, `checks:`
 * being non-empty and uniquely named, every non-`build` check having cases
 * bound, the `checks:` / `test.type` mirror, and (for a live run) every
 * check actually going green against the `# Solutions` overlay — is the
 * *same* rule set a `package` is held to (`verifyPackageExercise`), reused
 * rather than re-implemented: a `stack` that clears its own shape gate is
 * graded exactly as a `package` would be.
 *
 * 1. **Shape** — `packages:` must declare more than one entry. One package
 *    is not "several wired-together packages"; it is a `package` that
 *    forgot its own leetcode type.
 * 2. **Wiring resolves** — every `http` check's `package:` name must name a
 *    declared `packages:` entry. Left unchecked, this fails only at
 *    execution time, inside `runStackHttpCheck`, and only *after*
 *    `bootStack` has already installed and booted every **other** package
 *    the artifact declares — an expensive way to discover a typo. Checked
 *    here instead, before anything is installed or booted.
 * 3. **A `call` check needs a top-level function shape.** `runFunctionCheck`
 *    serialises a case's `input` into positional arguments using the
 *    artifact's own top-level `params:` — never anything the check itself
 *    declares. A `call` check with no top-level `params:` therefore has a
 *    genuine case-shape mismatch: its cases carry an `input` the generated
 *    driver has no declared arguments to bind it to.
 *
 * **[[C18]]:** this widens the plan's §C.4 matrix rather than narrowing the
 * code to match it. Both the shipped format spec and `buildCheck`
 * (`project-parser.helpers.ts`) already permit a `call` check inside a
 * `stack` — a `stack` is a set of packages, and a package may perfectly
 * well have a `call` check against one of its own files. Rule 3 makes that
 * combination *sound* rather than refusing it outright.
 *
 * @param parsed       - Parsed artifact, already known to be `leetcodeType: stack`.
 * @param leetcodeType - Always `'stack'` through the registry; forwarded to
 *   `verifyPackageExercise` unchanged so its own messages keep the `stack:` prefix.
 * @param options      - Forwarded verbatim to `verifyPackageExercise` — see {@link VerifyRunOptions}.
 * @returns The first broken rule's reason, or `null` when the stack grades clean.
 *
 * @example
 * await verifyStackExercise({ ...parsed, packages: [p] }, 'stack'); // → 'stack: needs more than one package'
 */
export async function verifyStackExercise(
	parsed: ParsedLeetCode, leetcodeType: LeetcodeTypeId, options?: VerifyRunOptions,
): Promise<string | null> {
	const shapeReason = checkStackShape(parsed);
	if (shapeReason) { return shapeReason; }

	const wiringReason = checkHttpPackagesResolve(parsed);
	if (wiringReason) { return wiringReason; }

	const callShapeReason = checkCallChecksHaveParams(parsed);
	if (callShapeReason) { return callShapeReason; }

	return verifyPackageExercise(parsed, leetcodeType, options);
}

/** Rule 1 — a `stack` is *several* wired-together packages, never zero or one. */
function checkStackShape(parsed: ParsedLeetCode): string | null {
	const count = parsed.packages?.length ?? 0;
	return count < MIN_STACK_PACKAGES ? 'stack: needs more than one package' : null;
}

/** Rule 2 — every `http` check's `package:` must name a declared `packages:` entry. */
function checkHttpPackagesResolve(parsed: ParsedLeetCode): string | null {
	const names = new Set((parsed.packages ?? []).map(p => p.name));
	for (const check of parsed.checks ?? []) {
		if (check.kind === 'http' && !names.has(check.package)) {
			return `stack: check '${check.name}' names unknown package '${check.package}'`;
		}
	}
	return null;
}

/** Rule 3 — a `call` check needs the artifact's own `params:` to give its cases a shape. */
function checkCallChecksHaveParams(parsed: ParsedLeetCode): string | null {
	if (parsed.params.length > 0) { return null; }
	const callCheck = (parsed.checks ?? []).find(c => c.kind === 'call');
	if (!callCheck) { return null; }
	return `stack: check '${callCheck.name}' is kind 'call' but the artifact declares no params `
		+ "— a call check runs against the artifact's own top-level function shape";
}
