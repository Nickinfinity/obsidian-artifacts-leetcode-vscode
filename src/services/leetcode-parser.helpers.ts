import {
	DEFAULT_TEST_TIMEOUT_MS,
	DEFAULT_TEST_TYPE,
	DEFAULT_TIME_LIMIT_MINUTES,
	DIFFICULTIES,
	MAX_SUITE_TIMEOUT_MS,
	MIN_TEST_TIMEOUT_MS,
	PRACTICE_OPTIONS,
	TEST_TYPES,
} from '../types/constants.js';
import type {
	LeetCodeDifficulty,
	LeetCodeStatus,
	ParamDef,
	PracticeConfig,
	PracticeOptionId,
	TestConfig,
	TestTypeId,
} from '../types/leetcode.types.js';
import type { LeetcodeTypeId } from '../types/leetcode-type.js';
import { resolveLeetcodeType } from './leetcode-type.helpers.js';
import { resolveLangId } from './language-map.service.js';

const KV_RE = /^(\w+):\s*(.*)$/;

const VALID_DIFFICULTY = new Set<LeetCodeDifficulty>(DIFFICULTIES);
const VALID_STATUS     = new Set<LeetCodeStatus>(['unsolved', 'attempted', 'solved']);
const VALID_OPTION_IDS = new Set<string>(PRACTICE_OPTIONS.map(o => o.id));
const VALID_TEST_TYPES = new Set<string>(TEST_TYPES.map(t => t.id));

/**
 * Execution defaults used when an artifact declares no `test:` block.
 *
 * @returns Fresh `TestConfig` — never a shared reference.
 *
 * @example
 * defaultTestConfig(); // → { type: 'function', timeoutMs: 5000 }
 */
export function defaultTestConfig(): TestConfig {
	return { type: DEFAULT_TEST_TYPE, timeoutMs: DEFAULT_TEST_TIMEOUT_MS };
}

/**
 * Practice defaults used when an artifact declares no `practice:` block.
 *
 * @returns Fresh `PracticeConfig` — never a shared reference, since callers
 *   mutate `options` when the user toggles checkboxes.
 *
 * @example
 * defaultPracticeConfig(); // → { options: ['noCompletion', 'noAiAgents'], timeLimitMinutes: 0, locked: false }
 */
export function defaultPracticeConfig(): PracticeConfig {
	return {
		options: PRACTICE_OPTIONS.filter(o => o.defaultEnabled).map(o => o.id),
		timeLimitMinutes: DEFAULT_TIME_LIMIT_MINUTES,
		locked: false,
	};
}

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
 * Iterate the consecutive indented lines of a YAML block, calling `onLine` with
 * each non-blank, trimmed line. The single definition of "an indented block" the
 * five block parsers share, so their loop/blank-skip/index bookkeeping lives in
 * one place.
 *
 * A line that does not start with whitespace (including a truly empty line) ends
 * the block, exactly as the hand-rolled loops did.
 *
 * @param lines  - All frontmatter lines.
 * @param start  - Index of the block's `key:` header line.
 * @param onLine - Handler for each non-blank indented line (already trimmed).
 * @returns The index of the first line after the block.
 *
 * @example
 * scanIndentedBlock(['test:', '  type: function', 'next:'], 0, l => {});
 * // → 2
 */
function scanIndentedBlock(lines: string[], start: number, onLine: (trimmed: string) => void): number {
	let i = start + 1;
	while (i < lines.length && /^\s/.test(lines[i])) {
		const trimmed = lines[i].trim();
		if (trimmed !== '') { onLine(trimmed); }
		i++;
	}
	return i;
}

/**
 * Parses the raw frontmatter block into an `FM` accumulator.
 *
 * Handles scalar keys line-by-line, plus the indented block keys `params:`,
 * `practice:`, `functions:`, `test:`, and `tags:`. Unknown keys are silently
 * ignored — `artifactType` included, exactly as its predecessor `type` was.
 * Invalid `difficulty` and `status` values are dropped (defaults remain in
 * place). `leetcodeType` is resolved once, after the whole block has been
 * scanned, via `resolveLeetcodeType` — declared when recognised, else derived
 * from the raw `test.type` scalar (plan §C.6).
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

	// Raw scalars feeding `resolveLeetcodeType`, kept local rather than on
	// `fm` — they are intermediate inputs to the one resolution below, not
	// part of the accumulator's public shape.
	let rawLeetcodeType: string | undefined;
	let rawTestType: string | undefined;

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
			const { test, rawType, next } = parseTestBlock(lines, i);
			fm.test = test;
			rawTestType = rawType;
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
	const resolved = resolveLeetcodeType(rawLeetcodeType, rawTestType);
	fm.leetcodeType = resolved.leetcodeType;
	if (resolved.warning) { fm.leetcodeTypeWarning = resolved.warning; }

	return fm;
}

// ── test: block ───────────────────────────────────────────────────────────────

/**
 * Parses the indented `test:` frontmatter block.
 *
 * Recognised sub-keys — both optional:
 *   - `type: function` — a `TestTypeId`. An unknown value silently falls back to
 *     `function`, since a typo should not make the exercise unrunnable.
 *   - `timeoutMs: 5000` — per-case budget, clamped to `[100, 60000]`. The suite
 *     budget is `cases × this`, capped separately by `MAX_SUITE_TIMEOUT_MS`.
 *
 * @param lines - All frontmatter lines.
 * @param start - Index of the `test:` line.
 * @returns `{ test, rawType, next }` — parsed config, the `type:` scalar
 *   exactly as written (before `parseTestType`'s unknown-value fallback —
 *   `resolveLeetcodeType` needs the raw form, not the collapsed one), and the
 *   index of the first non-consumed line.
 *
 * @example
 * parseTestBlock(['test:', '  type: function', '  timeoutMs: 2000'], 0);
 */
function parseTestBlock(lines: string[], start: number): { test: TestConfig; rawType?: string; next: number } {
	const test = defaultTestConfig();
	let rawType: string | undefined;
	const next = scanIndentedBlock(lines, start, trimmed => {
		const kv = KV_RE.exec(trimmed);
		if (!kv) { return; }
		const key = kv[1];
		const val = kv[2].trim();
		if (key === 'type')           { rawType = val; test.type = parseTestType(val); }
		else if (key === 'timeoutMs') { test.timeoutMs = parseTimeoutMs(val); }
	});
	return { test, rawType, next };
}

/** Validate a `type:` value, falling back to `function` for anything unknown. */
function parseTestType(val: string): TestTypeId {
	return VALID_TEST_TYPES.has(val) ? val as TestTypeId : DEFAULT_TEST_TYPE;
}

/** Clamp a `timeoutMs:` value into a range that can actually run a test. */
function parseTimeoutMs(val: string): number {
	const n = Number.parseInt(val, 10);
	if (Number.isNaN(n)) { return DEFAULT_TEST_TIMEOUT_MS; }
	return Math.min(Math.max(n, MIN_TEST_TIMEOUT_MS), MAX_SUITE_TIMEOUT_MS);
}

// ── practice: block ───────────────────────────────────────────────────────────

/**
 * Parses the indented `practice:` frontmatter block.
 *
 * Recognised sub-keys — all optional:
 *   - `timeLimit: <minutes>` — `0` (or absent) means no countdown.
 *   - `locked: true` — the panel disables the checkboxes and the extension
 *     ignores whatever option list the webview posts back.
 *   - `options: [a, b]` (inline) or a `- a` YAML list — unknown ids are dropped.
 *
 * An empty/absent `options` key keeps the `PRACTICE_OPTIONS` defaults; an
 * explicitly empty list (`options: []`) means "no restrictions".
 *
 * @param lines - All frontmatter lines.
 * @param start - Index of the `practice:` line.
 * @returns `{ practice, next }` — parsed config and the index of the first
 *   non-consumed line.
 *
 * @example
 * parsePracticeBlock(['practice:', '  timeLimit: 30', '  options: [noAiAgents]'], 0);
 */
function parsePracticeBlock(lines: string[], start: number): { practice: PracticeConfig; next: number } {
	const practice = defaultPracticeConfig();
	let sawOptions = false;
	const collected: PracticeOptionId[] = [];

	const next = scanIndentedBlock(lines, start, trimmed => {
		// YAML list continuation of a bare `options:` key.
		if (trimmed.startsWith('- ')) {
			pushOptionId(collected, trimmed.slice(2).trim());
			return;
		}

		const kv = KV_RE.exec(trimmed);
		if (!kv) { return; }
		const key = kv[1];
		const val = kv[2].trim();
		if (key === 'timeLimit')   { practice.timeLimitMinutes = parseTimeLimit(val); }
		else if (key === 'locked') { practice.locked = val === 'true'; }
		else if (key === 'options') {
			sawOptions = true;
			collected.push(...parseInlineOptions(val));
		}
	});

	if (sawOptions) { practice.options = collected; }
	return { practice, next };
}

/** Parse `options: [a, b]` — returns `[]` for a bare `options:` list header. */
function parseInlineOptions(val: string): PracticeOptionId[] {
	if (!val.startsWith('[')) { return []; }
	const inner = val.replace(/^\[|\]$/g, '');
	const out: PracticeOptionId[] = [];
	for (const raw of inner.split(',')) { pushOptionId(out, raw.trim()); }
	return out;
}

/** Append `id` when it is a known, not-yet-collected `PracticeOptionId`. */
function pushOptionId(out: PracticeOptionId[], id: string): void {
	const clean = id.replace(/^['"]|['"]$/g, '');
	if (!VALID_OPTION_IDS.has(clean)) { return; }
	if (out.includes(clean as PracticeOptionId)) { return; }
	out.push(clean as PracticeOptionId);
}

/** Clamp a `timeLimit:` value to a non-negative integer minute count. */
function parseTimeLimit(val: string): number {
	const n = Number.parseInt(val, 10);
	if (Number.isNaN(n) || n < 0) { return DEFAULT_TIME_LIMIT_MINUTES; }
	return n;
}

// ── functions: block ──────────────────────────────────────────────────────────

/**
 * Parses the indented `functions:` frontmatter block — a per-language override
 * of the top-level `function:` name.
 *
 * Each line is `<language>: <name>`; the language key goes through
 * `resolveLangId` so an alias (`py:`) lands under its canonical id
 * (`python`), matching the setup/solution heading resolution rule. `function:`
 * remains the default and the fallback for any language not listed here — see
 * `functionNameFor`.
 *
 * @param lines - All frontmatter lines.
 * @param start - Index of the `functions:` line.
 * @returns `{ functions, next }` — canonical-langId → name map (possibly
 *   empty) and the index of the first non-consumed line.
 *
 * @example
 * parseFunctionsBlock(['functions:', '  python: ab_check', '  rust: ab_check'], 0);
 */
function parseFunctionsBlock(lines: string[], start: number): { functions: Record<string, string>; next: number } {
	const functions: Record<string, string> = {};
	const next = scanIndentedBlock(lines, start, trimmed => {
		const kv = KV_RE.exec(trimmed);
		if (!kv) { return; }
		const langId = resolveLangId(kv[1]);
		const val    = kv[2].trim();
		if (val !== '') { functions[langId] = val; }
	});
	return { functions, next };
}

// ── tags: block ───────────────────────────────────────────────────────────────

/**
 * Parses the `tags:` frontmatter field — inline `[a, b]` or an indented YAML
 * `- a` list. Unlike `options:`, any string is accepted (no fixed id set).
 *
 * @param lines - All frontmatter lines.
 * @param start - Index of the `tags:` line.
 * @param val   - Trimmed value after `tags:` (`''`, `'[]'`, or `'[a, b]'`).
 * @returns `{ tags, next }` — parsed tag list and the index of the first
 *   non-consumed line.
 *
 * @example
 * parseTagsBlock(['tags: [leetcode, arrays, hash-map]'], 0, '[leetcode, arrays, hash-map]');
 */
function parseTagsBlock(lines: string[], start: number, val: string): { tags: string[]; next: number } {
	if (val.startsWith('[')) {
		const inner = val.replace(/^\[|\]$/g, '').trim();
		const tags = inner === '' ? [] : inner.split(',').map(t => t.trim().replace(/^['"]|['"]$/g, '')).filter(t => t !== '');
		return { tags, next: start + 1 };
	}

	const tags: string[] = [];
	const next = scanIndentedBlock(lines, start, trimmed => {
		if (trimmed.startsWith('- ')) { tags.push(trimmed.slice(2).trim().replace(/^['"]|['"]$/g, '')); }
	});
	return { tags, next };
}

// ── params: block ─────────────────────────────────────────────────────────────

/**
 * Parses the `params:` array out of a frontmatter block.
 *
 * Supports two forms: inline `params: []` (empty), and the standard YAML form
 * with indented `- name: …` / `type: …` pairs on the following lines.
 *
 * @param lines - All frontmatter lines.
 * @param start - Index of the `params:` line.
 * @param val   - Trimmed value after `params:` (`''` or `'[]'`).
 * @returns `{ params, next }` — parsed entries and the index of the first
 *   non-consumed line.
 *
 * @example
 * parseParamsBlock(['params:', '  - name: nums', '    type: int[]'], 0, '');
 */
function parseParamsBlock(lines: string[], start: number, val: string): { params: ParamDef[]; next: number } {
	const params: ParamDef[] = [];
	if (val !== '') { return { params, next: start + 1 }; }

	let current: Partial<ParamDef> = {};
	const next = scanIndentedBlock(lines, start, trimmed => {
		if (trimmed.startsWith('- ')) {
			pushParam(params, current);
			current = {};
			assignParamField(current, trimmed.slice(2).trim());
		} else {
			assignParamField(current, trimmed);
		}
	});
	pushParam(params, current);
	return { params, next };
}

/** Push the in-progress `ParamDef` if both `name` and `type` are set. */
function pushParam(params: ParamDef[], current: Partial<ParamDef>): void {
	if (current.name && current.type) { params.push(current as ParamDef); }
}

/** Parse a `key: value` pair onto the in-progress `ParamDef`. */
function assignParamField(current: Partial<ParamDef>, raw: string): void {
	const m = KV_RE.exec(raw);
	if (!m) { return; }
	const key = m[1];
	const val = m[2].trim();
	if (key === 'name') { current.name = val; }
	else if (key === 'type') { current.type = val; }
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
