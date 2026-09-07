import {
	DEFAULT_TEST_TIMEOUT_MS,
	DEFAULT_TEST_TYPE,
	DEFAULT_TIME_LIMIT_MINUTES,
	MAX_SUITE_TIMEOUT_MS,
	MIN_TEST_TIMEOUT_MS,
	PRACTICE_OPTIONS,
	TEST_TYPES,
} from '../types/constants.js';
import type {
	ParamDef,
	PracticeConfig,
	PracticeOptionId,
	TestConfig,
	TestTypeId,
} from '../types/leetcode.types.js';
import { resolveLangId } from './language-map.service.js';
import { KV_RE } from './leetcode-config-blocks.helpers.js';

/**
 * Grammar for the five **indented YAML sub-blocks** a LeetCode frontmatter
 * block may carry — `test:`, `practice:`, `functions:`, `tags:`, `params:` —
 * plus the default-config factories those blocks overlay onto.
 *
 * Split out of `leetcode-parser.helpers.ts` (C4): the file held two cohesive
 * but distinct concerns — scanning the top-level frontmatter and dispatching
 * on its scalar keys, versus the grammar of each indented sub-block once
 * dispatched to. This file is the second concern; `leetcode-parser.helpers.ts`
 * keeps the first (`parseFrontmatter`, `FM`, `applyScalar`) and calls into
 * this one, never the reverse — a one-directional import, not a circular one.
 */


const VALID_OPTION_IDS = new Set<string>(PRACTICE_OPTIONS.map(o => o.id));
const VALID_TEST_TYPES = new Set<string>(TEST_TYPES.map(t => t.id));

/**
 * Execution defaults used when an artifact declares no `test:` block.
 *
 * @returns Fresh `TestConfig` — never a shared reference.
 *
 * @example
 * defaultTestConfig(); // → { type: 'call', timeoutMs: 5000 }
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
 * `test.rawType` is stamped with the `type:` scalar exactly as written, before
 * `parseTestType`'s unknown-value fallback collapses it onto `test.type` —
 * `resolveLeetcodeType`'s legacy-shape derivation and `package.rules.ts`'s
 * `checks:` / `test.type` mirror rule both need the raw form to tell "declared"
 * apart from "defaulted" (C10), never the collapsed one.
 *
 * @param lines - All frontmatter lines.
 * @param start - Index of the `test:` line.
 * @returns `{ test, next }` — parsed config (`rawType` set only when a `type:`
 *   line was present) and the index of the first non-consumed line.
 *
 * @example
 * parseTestBlock(['test:', '  type: function', '  timeoutMs: 2000'], 0);
 */
export function parseTestBlock(lines: string[], start: number): { test: TestConfig; next: number } {
	const test = defaultTestConfig();
	const next = scanIndentedBlock(lines, start, trimmed => {
		const kv = KV_RE.exec(trimmed);
		if (!kv) { return; }
		const key = kv[1];
		const val = kv[2].trim();
		if (key === 'type')           { test.rawType = val; test.type = parseTestType(val); }
		else if (key === 'timeoutMs') { test.timeoutMs = parseTimeoutMs(val); }
	});
	return { test, next };
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
export function parsePracticeBlock(lines: string[], start: number): { practice: PracticeConfig; next: number } {
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
export function parseFunctionsBlock(lines: string[], start: number): { functions: Record<string, string>; next: number } {
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
export function parseTagsBlock(lines: string[], start: number, val: string): { tags: string[]; next: number } {
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
export function parseParamsBlock(lines: string[], start: number, val: string): { params: ParamDef[]; next: number } {
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
