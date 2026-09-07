import { DIFFICULTIES } from '../types/constants.js';
import type {
	LeetCodeDifficulty,
	LeetCodeStatus,
	ParamDef,
	PracticeConfig,
	TestConfig,
} from '../types/leetcode.types.js';
import type { LeetcodeTypeId } from '../types/leetcode-type.js';
import { resolveLeetcodeType } from './leetcode-type.helpers.js';
import { KV_RE } from './leetcode-config-blocks.helpers.js';
import {
	defaultPracticeConfig,
	defaultTestConfig,
	parseFunctionsBlock,
	parseParamsBlock,
	parsePracticeBlock,
	parseTagsBlock,
	parseTestBlock,
} from './leetcode-frontmatter-blocks.helpers.js';

const VALID_DIFFICULTY = new Set<LeetCodeDifficulty>(DIFFICULTIES);
const VALID_STATUS     = new Set<LeetCodeStatus>(['unsolved', 'attempted', 'solved']);

/** Internal accumulator for parsed frontmatter fields. */
export interface FM {
	title?: string;
	difficulty: LeetCodeDifficulty;
	functionName?: string;
	functions?: Record<string, string>;
	algorithm?: string;
	status: LeetCodeStatus;
	params: ParamDef[];
	returns?: string;
	practice: PracticeConfig;
	test: TestConfig;
	tags?: string[];
	/**
	 * Resolved leetcode-type axis (plan §C.6) — the declared `leetcodeType:`
	 * value when recognised, else derived from the raw `test.type` scalar.
	 * Always set: resolved once, after the whole frontmatter block has been
	 * scanned, so the resolution never runs ahead of a `test:` block that
	 * happens to appear later in the text.
	 */
	leetcodeType: LeetcodeTypeId;
	/** Set only when a declared `leetcodeType:` value was not recognised and fell back to the derived one. */
	leetcodeTypeWarning?: string;
}

/**
 * Parses the raw frontmatter block into an `FM` accumulator.
 *
 * Handles scalar keys line-by-line, plus the indented block keys `params:`,
 * `practice:`, `functions:`, `test:`, and `tags:` — each block's own grammar
 * lives in `leetcode-frontmatter-blocks.helpers.ts` (C4); this function only
 * scans the top level and dispatches. Unknown keys are silently ignored —
 * `artifactType` included, exactly as its predecessor `type` was. Invalid
 * `difficulty` and `status` values are dropped (defaults remain in place).
 * `leetcodeType` is resolved once, after the whole block has been scanned,
 * via `resolveLeetcodeType` — declared when recognised, else derived from the
 * raw `test.type` scalar (plan §C.6), read off `fm.test.rawType` (C10) rather
 * than a second value threaded through this function.
 *
 * @param raw - Body of the frontmatter block (no `---` fences).
 * @returns Populated `FM` accumulator.
 *
 * @example
 * parseFrontmatter('type: leetcode\ntitle: Two Sum\nfunction: twoSum\nparams: []\nreturns: int[]');
 */
export function parseFrontmatter(raw: string): FM {
	const fm: FM = {
		difficulty: 'easy',
		status: 'unsolved',
		params: [],
		practice: defaultPracticeConfig(),
		test: defaultTestConfig(),
		// Placeholder — resolved for real once the whole block has been
		// scanned (`leetcodeType:` and `test:` may appear in either order).
		leetcodeType: 'function',
	};
	const lines = raw.split(/\r?\n/);

	// Raw scalar feeding `resolveLeetcodeType`, kept local rather than on
	// `fm` — declared `leetcodeType:` is an intermediate input to the one
	// resolution below, not part of the accumulator's public shape. The
	// `test.type` half of that resolution reads `fm.test.rawType` directly
	// (C10) instead of a second local — `parseTestBlock` already stamps it.
	let rawLeetcodeType: string | undefined;

	let i = 0;
	while (i < lines.length) {
		const m = KV_RE.exec(lines[i]);
		if (!m) { i++; continue; }
		const key = m[1];
		const val = m[2].trim();

		if (key === 'params') {
			const { params, next } = parseParamsBlock(lines, i, val);
			fm.params = params;
			i = next;
			continue;
		}

		if (key === 'practice') {
			const { practice, next } = parsePracticeBlock(lines, i);
			fm.practice = practice;
			i = next;
			continue;
		}

		if (key === 'functions') {
			const { functions, next } = parseFunctionsBlock(lines, i);
			fm.functions = functions;
			i = next;
			continue;
		}

		if (key === 'test') {
			const { test, next } = parseTestBlock(lines, i);
			fm.test = test;
			i = next;
			continue;
		}

		if (key === 'tags') {
			const { tags, next } = parseTagsBlock(lines, i, val);
			fm.tags = tags;
			i = next;
			continue;
		}

		if (key === 'leetcodeType') {
			rawLeetcodeType = val;
			i++;
			continue;
		}

		applyScalar(fm, key, val);
		i++;
	}

	// `artifactType` (like the legacy `type` it replaces) is not read into
	// `fm` — nothing today needs the discriminator's own value, only that it
	// is a recognised, retained key (`RETAINED_FM_KEYS`).
	const resolved = resolveLeetcodeType(rawLeetcodeType, fm.test.rawType);
	fm.leetcodeType = resolved.leetcodeType;
	if (resolved.warning) { fm.leetcodeTypeWarning = resolved.warning; }

	return fm;
}

// ── scalar keys ───────────────────────────────────────────────────────────────

/**
 * Apply a scalar `key: value` frontmatter pair to the accumulator.
 *
 * Maps the YAML field `function` onto `FM.functionName` to avoid the reserved
 * JavaScript identifier. Invalid `difficulty` and `status` values are silently
 * dropped so the configured defaults remain.
 *
 * @param fm  - Frontmatter accumulator being populated.
 * @param key - Trimmed key name.
 * @param val - Trimmed raw value.
 *
 * @example
 * applyScalar(fm, 'title', 'Two Sum');
 */
function applyScalar(fm: FM, key: string, val: string): void {
	switch (key) {
		case 'title':      fm.title        = val; break;
		case 'function':   fm.functionName = val; break;
		case 'algorithm':  fm.algorithm    = val; break;
		case 'returns':    fm.returns      = val; break;
		case 'difficulty':
			if (VALID_DIFFICULTY.has(val as LeetCodeDifficulty)) { fm.difficulty = val as LeetCodeDifficulty; }
			break;
		case 'status':
			if (VALID_STATUS.has(val as LeetCodeStatus)) { fm.status = val as LeetCodeStatus; }
			break;
	}
}
