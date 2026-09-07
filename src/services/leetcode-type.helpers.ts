/**
 * Resolves an artifact's **leetcode-type axis** (`src/types/leetcode-type.ts`)
 * from its frontmatter: the declared `leetcodeType:` value when usable,
 * otherwise derived from the legacy `test.type` scalar (plan §C.6).
 *
 * Kept apart from `leetcode-parser.helpers.ts` because the derivation table is
 * its own small concern with its own hostile-input surface (`leetcodeType` and
 * `test.type` are both untrusted frontmatter scalars) — mixing it into the
 * larger frontmatter accumulator would bury it.
 */
import { isLeetcodeType, type LeetcodeTypeId } from '../types/leetcode-type.js';

/**
 * The three legacy `test.type` scalars the derivation table still recognises,
 * mapped to the leetcode type they always meant before `leetcodeType` existed.
 *
 * A `Map`, not a plain object: the key comes straight off an untrusted
 * frontmatter scalar, which admits `__proto__`. `{}['__proto__']` resolves
 * through the prototype chain to `Object.prototype` itself — not `undefined`
 * — so `?? 'function'` would never catch it and `deriveLeetcodeType` could
 * return a bare object where a `LeetcodeTypeId` string is promised. `Map#get`
 * has no prototype chain over its entries to fall through.
 *
 * `project` / `service` are accepted here **only** as derivation input; they
 * are not, and after the `TestTypeId` merge never were, a `LeetcodeTypeId`.
 */
const LEGACY_SHAPE = new Map<string, LeetcodeTypeId>([
	['function', 'function'],
	['project', 'package'],
	['service', 'stack'],
]);

/**
 * Derives the leetcode type from the artifact's raw, undeclared `test.type`
 * scalar.
 *
 * Must be called with the value **before** `parseTestType`'s own fallback
 * collapses an unrecognised `test.type` to `DEFAULT_TEST_TYPE`
 * (`leetcode-parser.helpers.ts`) — deriving from the already-collapsed value
 * would turn every unmigrated `project` artifact into a `function`-shaped
 * exercise with no cases and no params, silently.
 *
 * @param rawTestType - The scalar exactly as written after `test:\n  type: …`;
 *   `undefined` when the artifact declares no `test:` block, or no `type:`
 *   line inside it.
 * @returns `function` for the `function` input, `package` for `project`,
 *   `stack` for `service` — and `function`, the single-buffer default, for
 *   anything else (absent, a typo, `__proto__`, a future id not yet in the
 *   table).
 *
 * @example
 * deriveLeetcodeType('project');   // → 'package'
 * deriveLeetcodeType(undefined);   // → 'function'
 * deriveLeetcodeType('__proto__'); // → 'function'
 */
export function deriveLeetcodeType(rawTestType: string | undefined): LeetcodeTypeId {
	if (rawTestType === undefined) { return 'function'; }
	return LEGACY_SHAPE.get(rawTestType) ?? 'function';
}

/** Outcome of resolving an artifact's declared/derived leetcode type. */
export interface LeetcodeTypeResolution {
	/** The leetcode type to use — always one of the three declared ids. */
	leetcodeType: LeetcodeTypeId;
	/** Set only when a declared `leetcodeType:` value existed but was not recognised. */
	warning?: string;
}

/**
 * Resolves an artifact's leetcode type (plan §C.6): the declared
 * `leetcodeType:` value when it is one of the three known ids, otherwise the
 * value derived from the raw `test.type` scalar.
 *
 * **Not this function's job:** whether a *recognised* declared value
 * contradicts the declared `test.type` (`leetcodeType: package` beside
 * `test.type: call`, say) is `verifyExercise`'s named failure, never a silent
 * parse-time fallback — this function only ever refuses an **unrecognised**
 * declared value, and even then falls back rather than throwing, because a
 * parse must degrade, not crash, on hostile or malformed frontmatter.
 *
 * @param declared    - Raw `leetcodeType:` frontmatter scalar, `undefined`
 *   when the artifact declares none.
 * @param rawTestType - Raw `test.type` scalar (pre-fallback), fed to
 *   `deriveLeetcodeType` when `declared` is absent or unusable.
 * @returns The resolved type, plus a warning when the declared value existed
 *   but was not usable.
 *
 * @example
 * resolveLeetcodeType('package', 'call');       // → { leetcodeType: 'package' }
 * resolveLeetcodeType(undefined, 'project');    // → { leetcodeType: 'package' }
 * resolveLeetcodeType('__proto__', 'project');  // → { leetcodeType: 'package', warning: '…' }
 */
export function resolveLeetcodeType(
	declared: string | undefined,
	rawTestType: string | undefined,
): LeetcodeTypeResolution {
	if (declared === undefined) { return { leetcodeType: deriveLeetcodeType(rawTestType) }; }
	if (isLeetcodeType(declared)) { return { leetcodeType: declared }; }

	const leetcodeType = deriveLeetcodeType(rawTestType);
	return {
		leetcodeType,
		warning: `leetcodeType: unknown value '${declared}' — derived '${leetcodeType}' from test.type instead`,
	};
}
