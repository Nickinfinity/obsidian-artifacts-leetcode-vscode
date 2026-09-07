import { unimplementedCheckKindsFromContent } from '../services/project-parser.helpers.js';
import type { ParsedLeetCode } from '../types/leetcode.types.js';

/**
 * The `vscode`-free half of the run handlers' directory-grading dispatch
 * (VSX-153 / T1.16) — `leetcode-run.handlers.ts` imports `vscode` and cannot
 * be unit-tested directly, so the decision *may this run actually be graded
 * as a directory* lives here instead, where it is.
 *
 * `isMultiFile(parsed.leetcodeType)` (`src/types/constants.ts`) is the
 * dispatch itself and needs no wrapper here — this file owns only the second
 * question, asked once a caller has already dispatched: **may** the run
 * proceed?
 *
 * The refusal is **S3**: did the artifact declare a check `kind:` that no
 * environment implements? `buildCheck` (`project-parser.helpers.ts`) already
 * drops a reserved-kind check at parse time, silently, so
 * `ParsedLeetCode.checks` by the time a run handler sees it holds only the
 * *survivors*. Grading those alone reports "solved" on the strength of a
 * `build` check that happened to pass while an `http` check — the actual
 * point of the exercise — was dropped without a trace the grading path ever
 * looks at.
 *
 * **Two earlier shapes of this guard were wrong, and neither is to be
 * reintroduced.** The first consulted `refusalFor(leetcodeType, 'project',
 * language)` alone and shipped **inert**: past the `isMultiFile` gate,
 * `projectEnvFor` serves both `package` and `stack`, so it resolved an env
 * for everything a caller could actually reach and refused nothing. The
 * second kept that call as a "cheap sanity check" on a language — which was
 * worse than useless, because the only language a caller can supply without
 * a live session is `files[0].language`, the fence language of the **first
 * file in the tree**. `## Files` is heterogeneous by design, so that is
 * routinely `json`, `css` or `html`, and the check hard-refused real
 * artifacts: `build-check-smoke.md`, whose first file is `tsconfig.json`,
 * failed with *"package artifacts cannot run 'project' in json"*. The
 * registry question is not this function's to ask — a directory is graded by
 * its checks' own kinds, each dispatched by `runOneCheck`, never by a
 * single language.
 *
 * `ParsedLeetCode` carries no `unimplementedKinds` field — the only place
 * that assembles it, `leetcode-parser.service.ts`, is out of this task's
 * scope — so R2 re-derives it from the artifact's raw text, which every
 * caller already has on hand: a run handler re-reads the `.md` it is
 * grading, and `verify-exercise.mjs` already holds it as `md`.
 */

/**
 * Whether a directory-graded run (`isMultiFile(parsed.leetcodeType)` already
 * true) may proceed — checked before `gradeLiveProject` / `runProjectChecks`
 * writes or runs anything.
 *
 * @param rawContent - Full `.md` artifact text, freshly read. Never trust a
 *   stale in-memory copy for a security decision — `ctx.parsed` in the run
 *   handlers is parsed once at file-open time and never refreshed. "Fresh"
 *   means fresh **from disk**, so an artifact edited but unsaved is judged on
 *   its saved bytes — deliberate, and the same bytes `persistOutcome` writes
 *   back to.
 * @param parsed     - The same artifact, already parsed.
 * @returns The refusal sentence, naming the reason, or `null` when the run
 *   may proceed.
 *
 * @example
 * projectGradeRefusal(md, { ...parsed, leetcodeType: 'package' }); // → null
 * @example
 * projectGradeRefusal(md, { ...parsed, leetcodeType: 'stack' });
 * // → "checks declare kind(s) no environment implements yet: http — the whole
 * //    artifact is ungradeable, not just the checks that parsed."
 */
export function projectGradeRefusal(
	rawContent: string, parsed: ParsedLeetCode,
): string | null {
	if (parsed.leetcodeType === undefined) {
		return 'parse: missing leetcode type — cannot grade a directory';
	}

	const kinds = unimplementedCheckKindsFromContent(rawContent);
	if (kinds.length === 0) { return null; }
	return `checks declare kind(s) no environment implements yet: ${kinds.join(', ')} — `
		+ 'the whole artifact is ungradeable, not just the checks that parsed.';
}
