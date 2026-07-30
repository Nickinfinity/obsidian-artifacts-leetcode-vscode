import type {
	Attempt,
	ExerciseSetup,
	LeetCodeSolution,
	TestCase,
} from '../types/leetcode.types.js';
import { safeJsonParse } from '../utils/safe-json.js';
import { type ConfigSpan, extractConfigBlocks } from './leetcode-config-blocks.helpers.js';
import { boundaryOutsideFence, sectionBounds } from './leetcode-section-bounds.helpers.js';

const SOLUTIONS_RE     = /^# Solutions\s*$/m;
const SETUP_RE         = /^# Setup\s*$/m;
const ATTEMPTS_RE      = /^# Attempts\s*$/m;
const EXAMPLES_RE      = /^## Examples\s*$/m;
const TESTS_RE         = /^## Tests\s*$/m;
const FINAL_TESTS_RE   = /^## Final Tests\s*$/m;
const EXAMPLE_FENCE    = /```example\r?\n([\s\S]*?)```/g;
const META_RE          = /<!-- meta:\s*(\{[\s\S]*?\})\s*-->/;
const FENCE_W_META_RE  = /(?:<!-- meta:\s*(\{[\s\S]*?\})\s*-->\s*\r?\n)?```\w+\r?\n([\s\S]*?)```/g;
const FENCE_W_ATTEMPT_RE = /(?:<!-- attempt:\s*(\{[\s\S]*?\})\s*-->\s*\r?\n)?```\w+\r?\n([\s\S]*?)```/g;
const FENCE_LANG_RE    = /```\w+\r?\n([\s\S]*?)```/;

/** Any Markdown heading — the description runs until the first one. */
const DESCRIPTION_BOUNDARY_RE = /^#+ /m;

/**
 * Returns the prose between the closing frontmatter `---` and the first
 * Markdown heading (`#` or `##`), trimmed, **minus every config-fence span**.
 *
 * Returns the entire body (minus config fences, trimmed) when no heading is
 * present.
 *
 * Two things this must not do, both load-bearing in v2:
 *
 * - **A ` ```yaml leetcode ` fence is not description prose.** §2.5's canonical
 *   placement puts the signature fence after the description and before
 *   `## Examples` — i.e. *inside* this slice. Left in, `renderMarkdownLite`
 *   (which has no fenced-code rule) would render its raw YAML body as prose on
 *   the challenge screen. The spans come from `extractConfigBlocks`, the one
 *   authority for finding those fences; this function never re-finds them.
 * - **A column-0 `#` inside a fence is a comment, not a heading.** The boundary
 *   search goes through `boundaryOutsideFence` — the same fence-aware authority
 *   `sectionBounds` uses — rather than a bare `body.search(/^#+ /m)`, which
 *   truncated the description at the first YAML comment.
 *
 * An artifact with no config fence and no fenced `#` produces a byte-identical
 * result to the pre-v2 implementation.
 *
 * @param body - Content after the frontmatter block.
 * @returns Trimmed description string.
 *
 * @example
 * extractDescription('Some prose.\n\n## Examples'); // → 'Some prose.'
 * extractDescription('Prose.\n\n```yaml leetcode\nreturns: int\n```\n\n## Examples'); // → 'Prose.'
 */
export function extractDescription(body: string): string {
	const end = boundaryOutsideFence(body, 0, DESCRIPTION_BOUNDARY_RE);
	return withoutSpans(body.slice(0, end), extractConfigBlocks(body).spans).trim();
}

/**
 * Removes each span's characters from `text`, keeping everything between them.
 *
 * Spans arrive in document order and never overlap (`extractConfigBlocks` walks
 * linearly), so one forward cursor is enough. A span starting at or past the end
 * of `text` belongs to a later part of the body and stops the walk; one that
 * merely *ends* past it is clamped, so a fence straddling the slice boundary
 * cannot leak its tail.
 *
 * @param text  - The description slice.
 * @param spans - Config-fence ranges, as offsets into the body `text` came from.
 * @returns `text` with every span's characters removed.
 *
 * @example
 * withoutSpans('a<fence>b', [{ start: 1, end: 8 }]); // → 'ab'
 */
function withoutSpans(text: string, spans: ConfigSpan[]): string {
	let out = '';
	let cursor = 0;
	for (const span of spans) {
		if (span.start >= text.length) { break; }
		out += text.slice(cursor, span.start);
		cursor = Math.min(span.end, text.length);
	}
	return out + text.slice(cursor);
}

/**
 * Parses every ` ```example ` block under `## Examples` into
 * `{ input, output }` pairs.
 *
 * @param body - Content after the frontmatter.
 * @returns Ordered list of example entries; `[]` when the section is absent.
 *
 * @example
 * extractExamples('## Examples\n```example\ninput: x = 1\noutput: 1\n```');
 */
export function extractExamples(body: string): { input: string; output: string }[] {
	const section = extractSection(body, EXAMPLES_RE);
	if (!section) { return []; }

	const out: { input: string; output: string }[] = [];
	const re = new RegExp(EXAMPLE_FENCE.source, EXAMPLE_FENCE.flags);
	for (let m = re.exec(section); m !== null; m = re.exec(section)) {
		const inputM  = /^input:\s*(.+)$/m.exec(m[1]);
		const outputM = /^output:\s*(.+)$/m.exec(m[1]);
		if (inputM && outputM) {
			out.push({ input: inputM[1].trim(), output: outputM[1].trim() });
		}
	}
	return out;
}

/**
 * Parses the ` ```json ` block under `## Tests` into an array of `TestCase`.
 *
 * Returns `[]` for a missing section, missing fence, or malformed JSON — never
 * throws.
 *
 * @param body - Content after the frontmatter.
 * @returns Parsed test cases.
 *
 * @example
 * extractTests('## Tests\n```json\n[{ "input": { "x": 1 }, "expected": 2 }]\n```');
 */
export function extractTests(body: string): TestCase[] {
	return extractJsonCases(body, TESTS_RE);
}

/**
 * Parses the ` ```json ` block under `## Final Tests` into an array of
 * `TestCase` — the hidden grading suite.
 *
 * Returns `[]` for a missing section, missing fence, or malformed JSON. The
 * *fallback* for a legacy artifact with no such section is deliberately not
 * applied here: the parser reports what the file contains, and `submitSuite()`
 * decides what Submit runs.
 *
 * `TESTS_RE` is anchored (`/^## Tests\s*$/m`), so `## Final Tests` cannot match
 * it, and `extractSection` stops each slice at the next heading — the two
 * sections cannot swallow each other in either order.
 *
 * @param body - Content after the frontmatter.
 * @returns Parsed grading cases.
 *
 * @example
 * extractFinalTests('## Final Tests\n```json\n[{ "input": { "x": 9 }, "expected": 81 }]\n```');
 */
export function extractFinalTests(body: string): TestCase[] {
	return extractJsonCases(body, FINAL_TESTS_RE);
}

/** Shared slice-then-parse for the two `TestCase[]` sections. Never throws. */
function extractJsonCases(body: string, headingRe: RegExp): TestCase[] {
	return extractCaseFences(body, headingRe).flatMap(f => f.cases);
}

/**
 * One ` ```json ` fence of a case section, with the check it names (if any).
 *
 * A `project` exercise grades several checks from one section, so each fence
 * carries `check=<name>`; a `function` exercise writes a single bare fence and
 * leaves `check` undefined.
 */
export interface CaseFence {
	/** Value of the `check=<name>` info-string attribute; `undefined` on a bare fence */
	check?: string;
	/** Cases in this fence; `[]` when its JSON is malformed */
	cases: TestCase[];
}

/**
 * Every ` ```json ` fence under a case section, in document order.
 *
 * The info-string is **attribute-bearing** (`` ```json check="app builds" ``) and
 * *all* fences in the section are taken, not just the first — that is what lets
 * a `project`'s cases bind to named checks. For a `function` artifact, whose
 * sections carry exactly one bare fence, the result is the single fence it
 * always was; a second fence, previously ignored, is now appended.
 *
 * Malformed JSON in one fence yields `cases: []` for that fence alone and never
 * throws — one broken suite must not take the others down with it.
 *
 * @param body      - Content after the frontmatter.
 * @param headingRe - Anchored heading regex (`TESTS_RE` / `FINAL_TESTS_RE`).
 * @returns One entry per json fence in the section; `[]` when the section is absent.
 *
 * @example
 * extractCaseFences('## Tests\n```json check=api\n[]\n```', /^## Tests\s*$/m);
 * // → [{ check: 'api', cases: [] }]
 */
export function extractCaseFences(body: string, headingRe: RegExp): CaseFence[] {
	const section = extractSection(body, headingRe);
	if (!section) { return []; }

	const out: CaseFence[] = [];
	// Fresh regex per call — a `g` flag at module scope carries `lastIndex`
	// between calls and would silently skip fences on the second read.
	const fences = /```json([^\n]*)\r?\n([\s\S]*?)```/g;
	let match = fences.exec(section);
	while (match !== null) {
		const parsed = safeJsonParse(match[2]);
		out.push({
			check: checkAttr(match[1]),
			cases: Array.isArray(parsed) ? parsed as TestCase[] : [],
		});
		match = fences.exec(section);
	}
	return out;
}

/** Read `check=<name>` (quoted or bare) out of a fence info-string. */
function checkAttr(infoString: string): string | undefined {
	const attr = /check=(?:"([^"]*)"|(\S+))/.exec(infoString);
	if (!attr) { return undefined; }
	return attr[1] ?? attr[2];
}

/** The two case sections, exposed for the `project` parser's check binding. */
export const CASE_SECTIONS = { tests: TESTS_RE, final: FINAL_TESTS_RE } as const;

/**
 * Parses the `# Setup` tree into per-language starter stubs.
 *
 * Shares the `## <Language>` shape of `# Solutions`, but only the **first**
 * fence under each language heading is taken — a setup is a single stub, never
 * a labelled list of alternatives.
 *
 * @param body - Content after the frontmatter.
 * @returns One `ExerciseSetup` per language heading that carries a fence.
 *
 * @example
 * extractSetups('# Setup\n\n## JavaScript\n```javascript\nfunction f() {}\n```');
 * // → [{ language: 'javascript', code: 'function f() {}' }]
 */
export function extractSetups(body: string): ExerciseSetup[] {
	const section = extractTopLevelSection(body, SETUP_RE);
	if (!section) { return []; }

	const out: ExerciseSetup[] = [];
	for (const chunk of splitLanguageSections(section)) {
		const headingM = /^## (.+)\r?\n/.exec(chunk);
		if (!headingM) { continue; }
		const fence = FENCE_LANG_RE.exec(chunk.slice(headingM[0].length));
		if (!fence) { continue; }
		out.push({ language: headingM[1].trim().toLowerCase(), code: fence[1].trimEnd() });
	}
	return out;
}

/**
 * Parses the `# Solutions` tree into a flat ordered list of solutions.
 *
 * Splits the section by `## <Language>` headings, then further by optional
 * `### <Label>` sub-headings. Direct unlabeled fences under a `##` heading are
 * collected separately; multiple direct fences are auto-numbered
 * (`Solution #1`, `Solution #2`, …) while a sole unlabeled fence keeps
 * `label: undefined`.
 *
 * @param body - Content after the frontmatter.
 * @returns Ordered list of `LeetCodeSolution` entries.
 *
 * @example
 * extractSolutions('# Solutions\n\n## Java\n```java\n…\n```');
 */
export function extractSolutions(body: string): LeetCodeSolution[] {
	const section = extractTopLevelSection(body, SOLUTIONS_RE);
	if (!section) { return []; }

	const result: LeetCodeSolution[] = [];
	for (const chunk of splitLanguageSections(section)) { result.push(...parseLanguageSection(chunk)); }
	return result;
}

/**
 * Parses the `# Attempts` tree into a flat, file-order list of recorded runs.
 *
 * Shares the `## <Language>` splitting of `extractSolutions`, but each fenced
 * code block is preceded by a mandatory `<!-- attempt: { … } -->` comment
 * (carrying `at` / `duration` / `passed`, and optionally `bigO` /
 * `confidence`) instead of an optional `### <Label>` heading — the shape
 * `appendAttempt` writes. A fence whose comment is missing, malformed, or
 * missing a required field is skipped rather than producing a partial entry;
 * `Attempt` has no optional `at` / `duration` / `passed`, so there is nothing
 * sensible to fill in. Never throws.
 *
 * @param body - Content after the frontmatter.
 * @returns Attempts in file order — `appendAttempt` always prepends, so this
 *   is newest-first per language.
 *
 * @example
 * extractAttempts('# Attempts\n\n## Java\n<!-- attempt: { "at": "2026-01-01T00:00:00Z", "duration": "1m0s", "passed": true } -->\n```java\nint x;\n```');
 * // → [{ language: 'java', at: '2026-01-01T00:00:00Z', duration: '1m0s', passed: true, code: 'int x;' }]
 */
export function extractAttempts(body: string): Attempt[] {
	const section = extractTopLevelSection(body, ATTEMPTS_RE);
	if (!section) { return []; }

	const out: Attempt[] = [];
	for (const chunk of splitLanguageSections(section)) { out.push(...parseAttemptLanguageSection(chunk)); }
	return out;
}

// ── Section slicing ───────────────────────────────────────────────────────────

/**
 * Returns the body of a `##` section, bounded by the next `#`/`##` heading.
 *
 * @param body      - Full body text (after frontmatter).
 * @param headingRe - Regex matching the section heading line.
 * @returns Section content excluding its own heading, or `null` if missing.
 *
 * @example
 * extractSection('## Tests\n```json\n[]\n```', /^## Tests\s*$/m);
 */
function extractSection(body: string, headingRe: RegExp): string | null {
	const bounds = sectionBounds(body, headingRe, /^#{1,2} /m);
	return bounds ? body.slice(bounds.headingEnd, bounds.bodyEnd) : null;
}

/**
 * Returns the body of a `#` section, bounded by the next `#` heading only.
 *
 * Unlike `extractSection`, `##` sub-headings do **not** terminate the slice —
 * they are the language headings the caller wants to keep.
 *
 * @param body      - Full body text (after frontmatter).
 * @param headingRe - Regex matching the top-level heading line.
 * @returns Section content excluding its own heading, or `null` if missing.
 *
 * @example
 * extractTopLevelSection('# Setup\n## Java\n…\n# Solutions\n…', /^# Setup\s*$/m);
 */
function extractTopLevelSection(body: string, headingRe: RegExp): string | null {
	const bounds = sectionBounds(body, headingRe, /^# /m);
	return bounds ? body.slice(bounds.headingEnd, bounds.bodyEnd) : null;
}

/** Split a top-level section body into its `## <Language>` chunks. */
function splitLanguageSections(section: string): string[] {
	return section.split(/(?=^## )/m).filter(s => s.startsWith('## '));
}

// ── Solutions tree ────────────────────────────────────────────────────────────

/** Parse a single `## <Language>` section into its solutions. */
function parseLanguageSection(section: string): LeetCodeSolution[] {
	const headingM = /^## (.+)\r?\n/.exec(section);
	if (!headingM) { return []; }
	const language = headingM[1].trim().toLowerCase();
	const body     = section.slice(headingM[0].length);

	const labelChunks = body.split(/(?=^### )/m);
	const out: LeetCodeSolution[] = [];

	// First chunk (before any ### heading) — direct/unlabeled fences for the language
	if (labelChunks.length > 0 && !labelChunks[0].startsWith('### ')) {
		const first = labelChunks.shift();
		if (first !== undefined) { out.push(...parseDirectFences(first, language)); }
	}

	for (const chunk of labelChunks) {
		const sol = parseLabeledSection(chunk, language);
		if (sol) { out.push(sol); }
	}
	return out;
}

/**
 * Parse direct (unlabeled) fenced code blocks for a language section.
 *
 * Auto-numbers labels as `Solution #N` when there are 2+ direct fences; a
 * single direct fence keeps `label: undefined`.
 *
 * @param text     - Text under the `## <Language>` heading and before any `###`.
 * @param language - Lower-cased language id (e.g. `'python'`).
 * @returns Parsed direct solutions.
 *
 * @example
 * parseDirectFences('```python\n…\n```\n```python\n…\n```', 'python');
 */
function parseDirectFences(text: string, language: string): LeetCodeSolution[] {
	const fences: LeetCodeSolution[] = [];
	const re = new RegExp(FENCE_W_META_RE.source, FENCE_W_META_RE.flags);
	for (let m = re.exec(text); m !== null; m = re.exec(text)) {
		const meta = parseMeta(m[1]);
		fences.push({
			language,
			label: undefined,
			code:  m[2].trimEnd(),
			...meta,
		});
	}
	if (fences.length > 1) {
		fences.forEach((f, idx) => { f.label = `Solution #${idx + 1}`; });
	}
	return fences;
}

/** Parse a single `### <Label>` chunk into one solution, or `null`. */
function parseLabeledSection(chunk: string, language: string): LeetCodeSolution | null {
	const headingM = /^### (.+)\r?\n/.exec(chunk);
	if (!headingM) { return null; }
	const label = headingM[1].trim();
	const rest  = chunk.slice(headingM[0].length);
	const metaM = META_RE.exec(rest);
	const fence = FENCE_LANG_RE.exec(rest);
	if (!fence) { return null; }
	const meta = parseMeta(metaM ? metaM[1] : undefined);
	return { language, label, code: fence[1].trimEnd(), ...meta };
}

/** Parse the `<!-- meta: { … } -->` JSON payload into `solvedAt` / `duration`. */
function parseMeta(raw: string | undefined): { solvedAt?: string; duration?: string } {
	const obj = parseHtmlCommentJson(raw);
	if (!obj) { return {}; }
	return {
		solvedAt: typeof obj.solved_at === 'string' ? obj.solved_at : undefined,
		duration: typeof obj.duration  === 'string' ? obj.duration  : undefined,
	};
}

/**
 * Shared `JSON.parse` step for an HTML-comment payload already isolated by a
 * caller's own regex capture (`meta:` via `META_RE` / `FENCE_W_META_RE`,
 * `attempt:` via `FENCE_W_ATTEMPT_RE`). Never throws.
 *
 * @param raw - Captured JSON text, or `undefined` when the comment was absent.
 * @returns The parsed object, or `null` when absent or malformed.
 *
 * @example
 * parseHtmlCommentJson('{ "duration": "3m12s" }'); // → { duration: '3m12s' }
 */
function parseHtmlCommentJson(raw: string | undefined): Record<string, unknown> | null {
	if (!raw) { return null; }
	return safeJsonParse<Record<string, unknown>>(raw);
}

// ── Attempts tree ─────────────────────────────────────────────────────────────

/** Parse a single `## <Language>` chunk of the Attempts tree into its entries. */
function parseAttemptLanguageSection(section: string): Attempt[] {
	const headingM = /^## (.+)\r?\n/.exec(section);
	if (!headingM) { return []; }
	const language = headingM[1].trim().toLowerCase();
	const body     = section.slice(headingM[0].length);

	const out: Attempt[] = [];
	const re = new RegExp(FENCE_W_ATTEMPT_RE.source, FENCE_W_ATTEMPT_RE.flags);
	for (let m = re.exec(body); m !== null; m = re.exec(body)) {
		const fields = parseAttemptComment(m[1]);
		if (!fields) { continue; }
		out.push({ language, code: m[2].trimEnd(), ...fields });
	}
	return out;
}

/**
 * Parse the `<!-- attempt: { … } -->` JSON payload into the required
 * `Attempt` fields (plus the optional Big-O ones); `null` when the comment is
 * absent, malformed, or missing `at` / `duration` / `passed` — those three
 * have no sensible default, unlike the solution `meta:` comment's fields.
 */
function parseAttemptComment(raw: string | undefined): Omit<Attempt, 'language' | 'code'> | null {
	const obj = parseHtmlCommentJson(raw);
	if (!obj) { return null; }
	if (typeof obj.at !== 'string' || typeof obj.duration !== 'string' || typeof obj.passed !== 'boolean') {
		return null;
	}
	return {
		at:         obj.at,
		duration:   obj.duration,
		passed:     obj.passed,
		bigO:       typeof obj.bigO       === 'string' ? obj.bigO       : undefined,
		confidence: typeof obj.confidence === 'string' ? obj.confidence : undefined,
	};
}
