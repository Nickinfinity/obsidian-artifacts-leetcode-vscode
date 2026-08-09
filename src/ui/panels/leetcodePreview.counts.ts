import { hasFinalTests, publicCount } from '../../services/leetcode-suite.helpers.js';
import type { ParsedLeetCode, ProjectCheck } from '../../types/leetcode.types.js';
import { escHtml } from '../../utils/html.helpers.js';

/**
 * The preview panel's test-count line — how many cases, or which checks, gate
 * this artifact's Submit.
 *
 * Split out of `leetcodePreview.controls.ts` at wave 2.C, which took that file
 * to 543 lines (`CLAUDE.md`: "at ~500 plan a split"). This is the cohesive
 * seam: counting what grades an exercise is a different concern from rendering
 * the controls that start one, and nothing here reads a challenge phase.
 */

/**
 * Render the test-count line: `2 public tests · 3 final tests`.
 *
 * Two independent questions, two branches — not one conditional chain:
 *
 * - **Shape**: is this artifact a tree graded by declared `checks:`? A
 *   **project** is graded that way, not by `## Tests`, so it gets one line
 *   per check instead. Reading the function suite told a build-only exercise
 *   it had `0 tests`, and hid a second check that gated the solver's Submit.
 * - **Test type**: for a suite-graded artifact, every `TestTypeId` —
 *   `call`/`function`, `program`, and every other id — reads the same
 *   public/final split today, so there is exactly one renderer
 *   ({@link renderSuiteCounts}) and no table in front of it. A test type
 *   whose count line must read differently (the render/build check kinds
 *   already prove this happens) is what earns the first
 *   `Partial<Record<TestTypeId, …>>` entry — a one-entry table with no
 *   alternative is decoration, not dispatch, and untestable with it: nothing
 *   can tell "the table routed here" from "the default ran" when the table is
 *   empty.
 *
 * Final cases are counted but never shown — a solver may know how many hidden
 * cases will grade them without learning what those cases are. An artifact
 * without a `## Final Tests` section reads simply `2 tests`.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the counts line(s).
 *
 * @example
 * renderTestCounts(parsed); // → '<div class="tests-count">2 public tests · 3 final tests</div>'
 * @example
 * renderTestCounts(project); // → '…>app builds (build) · pass/fail on exit status</div>'
 */
export function renderTestCounts(p: ParsedLeetCode): string {
	const checks = p.checks ?? [];
	if (checks.length > 0) {
		return checks.map(renderCheckCount).join('');
	}
	return renderSuiteCounts(p);
}

/**
 * Suite-graded counts line: `N public tests · M final tests`, or plain
 * `N tests` when the artifact has no `## Final Tests` section.
 *
 * Reads only the parsed suite (`p.tests` / `p.finalTests`) — **never** the
 * test-environment registry. A `package` + `program` artifact has no
 * registered env this wave (`program` is not wired into the registry until a
 * later task), and this line must still report its real case counts rather
 * than a registry-gated `0 tests` — the counts answer "how many cases does
 * this artifact declare", not "can anything run them yet".
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the counts line.
 *
 * @example
 * renderSuiteCounts(parsed); // → '<div class="tests-count">2 tests</div>'
 */
function renderSuiteCounts(p: ParsedLeetCode): string {
	const pub = publicCount(p);
	if (!hasFinalTests(p)) {
		return `<div class="tests-count">${pub} tests</div>`;
	}
	return `<div class="tests-count">${pub} public tests &middot; ${p.finalTests.length} final tests</div>`;
}

/**
 * One count line for a single declared check: its name, kind, and how it grades.
 *
 * The name is artifact-authored free text, so it goes through `escHtml`; `kind`
 * is a narrowed literal union and needs none.
 *
 * @param check - The declared check.
 * @returns HTML for that check's line.
 *
 * @example
 * renderCheckCount({ name: 'counter', kind: 'dom-assert', cases: c, publicCount: 3, file: 'a.jsx' });
 * // → '<div class="tests-count">counter (dom-assert) · 3 public · 1 hidden</div>'
 */
function renderCheckCount(check: ProjectCheck): string {
	const label = `${escHtml(check.name)} (${check.kind})`;
	return `<div class="tests-count">${label} &middot; ${gradedBy(check)}</div>`;
}

/**
 * How a check decides pass or fail: a public/hidden case split, or an exit
 * status for `build`, which binds no cases at all.
 *
 * @param check - The declared check.
 * @returns Human-readable grading summary; never a case value.
 *
 * @example
 * gradedBy({ kind: 'build', … }); // → 'pass/fail on exit status'
 */
function gradedBy(check: ProjectCheck): string {
	if (check.kind === 'build') { return 'pass/fail on exit status'; }

	const hidden = check.cases.length - check.publicCount;
	const shown = `${check.publicCount} public`;
	return hidden > 0 ? `${shown} &middot; ${hidden} hidden` : shown;
}
