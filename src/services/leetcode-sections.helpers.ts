import type {
	ExerciseSetup,
	LeetCodeSolution,
	TestCase,
} from '../types/leetcode.types.js';

const SOLUTIONS_RE    = /^# Solutions\s*$/m;
const SETUP_RE        = /^# Setup\s*$/m;
const EXAMPLES_RE     = /^## Examples\s*$/m;
const TESTS_RE        = /^## Tests\s*$/m;
const EXAMPLE_FENCE   = /```example\r?\n([\s\S]*?)```/g;
const JSON_FENCE      = /```json\r?\n([\s\S]*?)```/;
const META_RE         = /<!-- meta:\s*(\{[\s\S]*?\})\s*-->/;
const FENCE_W_META_RE = /(?:<!-- meta:\s*(\{[\s\S]*?\})\s*-->\s*\r?\n)?```\w+\r?\n([\s\S]*?)```/g;
const FENCE_LANG_RE   = /```\w+\r?\n([\s\S]*?)```/;

/**
 * Returns the prose between the closing frontmatter `---` and the first
 * Markdown heading (`#` or `##`), trimmed.
 *
 * Returns the entire body trimmed when no heading is present.
 *
 * @param body - Content after the frontmatter block.
 * @returns Trimmed description string.
 *
 * @example
 * extractDescription('Some prose.\n\n## Examples'); // → 'Some prose.'
 */
export function extractDescription(body: string): string {
	const idx = body.search(/^#+ /m);
	if (idx === -1) { return body.trim(); }
	return body.slice(0, idx).trim();
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
	const section = extractSection(body, TESTS_RE);
	if (!section) { return []; }
	const fence = JSON_FENCE.exec(section);
	if (!fence) { return []; }
	try {
		const parsed: unknown = JSON.parse(fence[1]);
		return Array.isArray(parsed) ? parsed as TestCase[] : [];
	} catch {
		return [];
	}
}

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
	const match = headingRe.exec(body);
	if (!match) { return null; }
	const rest = body.slice(match.index + match[0].length);
	const next = /^#{1,2} /m.exec(rest);
	return next ? rest.slice(0, next.index) : rest;
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
	const match = headingRe.exec(body);
	if (!match) { return null; }
	const rest = body.slice(match.index + match[0].length);
	const next = /^# /m.exec(rest);
	return next ? rest.slice(0, next.index) : rest;
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
	if (!raw) { return {}; }
	try {
		const obj = JSON.parse(raw) as Record<string, unknown>;
		return {
			solvedAt: typeof obj.solved_at === 'string' ? obj.solved_at : undefined,
			duration: typeof obj.duration  === 'string' ? obj.duration  : undefined,
		};
	} catch {
		return {};
	}
}
