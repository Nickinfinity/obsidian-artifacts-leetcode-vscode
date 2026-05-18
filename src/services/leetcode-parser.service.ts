import type {
	LeetCodeDifficulty,
	LeetCodeSolution,
	LeetCodeStatus,
	ParamDef,
	ParsedLeetCode,
	TestCase,
} from '../types/leetcode.types.js';

const FRONTMATTER_RE  = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const SOLUTIONS_RE    = /^# Solutions\s*$/m;
const EXAMPLES_RE     = /^## Examples\s*$/m;
const TESTS_RE        = /^## Tests\s*$/m;
const EXAMPLE_FENCE   = /```example\r?\n([\s\S]*?)```/g;
const JSON_FENCE      = /```json\r?\n([\s\S]*?)```/;
const META_RE         = /<!-- meta:\s*(\{[\s\S]*?\})\s*-->/;
const FENCE_W_META_RE = /(?:<!-- meta:\s*(\{[\s\S]*?\})\s*-->\s*\r?\n)?```\w+\r?\n([\s\S]*?)```/g;
const FENCE_LANG_RE   = /```\w+\r?\n([\s\S]*?)```/;
const KV_RE           = /^(\w+):\s*(.*)$/;

const VALID_DIFFICULTY = new Set<LeetCodeDifficulty>(['easy', 'medium', 'hard']);
const VALID_STATUS     = new Set<LeetCodeStatus>(['unsolved', 'attempted', 'solved']);

/**
 * Parses a LeetCode-flavoured vault `.md` file into a `ParsedLeetCode` structure.
 *
 * Extracts frontmatter (including the YAML `params:` array), the problem
 * description, `## Examples`, the `## Tests` JSON block, and the `# Solutions`
 * tree (`## <Language>` → optional `### <Label>` + fenced code + meta comment).
 *
 * Defaults: missing `status` → `'unsolved'`; missing or invalid `difficulty`
 * → `'easy'`. Malformed JSON in the tests block returns an empty test array
 * rather than throwing.
 *
 * @param content - Full UTF-8 string content of the `.md` file.
 * @returns Fully populated `ParsedLeetCode`.
 *
 * @example
 * parseLeetCode(fs.readFileSync('/vault/LeetCode/two-sum.md', 'utf-8'));
 */
export function parseLeetCode(content: string): ParsedLeetCode {
	const fmMatch = FRONTMATTER_RE.exec(content);
	const fmRaw   = fmMatch ? fmMatch[1] : '';
	const body    = fmMatch ? content.slice(fmMatch[0].length) : content;

	const fm = parseFrontmatter(fmRaw);

	return {
		title:        fm.title ?? '',
		difficulty:   fm.difficulty,
		functionName: fm.functionName ?? '',
		algorithm:    fm.algorithm,
		status:       fm.status,
		params:       fm.params,
		returns:      fm.returns ?? '',
		description:  extractDescription(body),
		examples:     extractExamples(body),
		tests:        extractTests(body),
		solutions:    extractSolutions(body),
	};
}

/** Internal accumulator for parsed frontmatter fields. */
interface FM {
	title?: string;
	difficulty: LeetCodeDifficulty;
	functionName?: string;
	algorithm?: string;
	status: LeetCodeStatus;
	params: ParamDef[];
	returns?: string;
}

/**
 * Parses the raw frontmatter block into an `FM` accumulator.
 *
 * Handles scalar keys line-by-line and the indented `params:` YAML array as a
 * special case. Unknown keys are silently ignored. Invalid `difficulty` and
 * `status` values are dropped (defaults remain in place).
 *
 * @param raw - Body of the frontmatter block (no `---` fences).
 * @returns Populated `FM` accumulator.
 *
 * @example
 * parseFrontmatter('type: leetcode\ntitle: Two Sum\nfunction: twoSum\nparams: []\nreturns: int[]');
 */
function parseFrontmatter(raw: string): FM {
	const fm: FM = { difficulty: 'easy', status: 'unsolved', params: [] };
	const lines = raw.split(/\r?\n/);

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

		applyScalar(fm, key, val);
		i++;
	}
	return fm;
}

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
	if (val === '[]') { return { params, next: start + 1 }; }
	if (val !== '')   { return { params, next: start + 1 }; }

	let i = start + 1;
	let current: Partial<ParamDef> = {};

	while (i < lines.length && /^\s/.test(lines[i])) {
		const trimmed = lines[i].trim();
		if (trimmed === '') { i++; continue; }

		if (trimmed.startsWith('- ')) {
			pushParam(params, current);
			current = {};
			assignParamField(current, trimmed.slice(2).trim());
		} else {
			assignParamField(current, trimmed);
		}
		i++;
	}
	pushParam(params, current);
	return { params, next: i };
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
 * applyScalar({ difficulty: 'easy', status: 'unsolved', params: [] }, 'title', 'Two Sum');
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
 * extractDescription('Some prose.\n\n## Examples');
 */
function extractDescription(body: string): string {
	const idx = body.search(/^#+ /m);
	if (idx === -1) { return body.trim(); }
	return body.slice(0, idx).trim();
}

/**
 * Returns the body of a `##` section, bounded by the next `#`/`##` heading.
 *
 * @param body       - Full body text (after frontmatter).
 * @param headingRe  - Regex matching the section heading line.
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
 * Parses every ` ```example ` block under `## Examples` into
 * `{ input, output }` pairs.
 *
 * @param body - Content after the frontmatter.
 * @returns Ordered list of example entries; `[]` when the section is absent.
 *
 * @example
 * extractExamples('## Examples\n```example\ninput: x = 1\noutput: 1\n```');
 */
function extractExamples(body: string): { input: string; output: string }[] {
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
function extractTests(body: string): TestCase[] {
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
function extractSolutions(body: string): LeetCodeSolution[] {
	const startM = SOLUTIONS_RE.exec(body);
	if (!startM) { return []; }
	const after = body.slice(startM.index + startM[0].length);

	const langSections = after.split(/(?=^## )/m).filter(s => s.startsWith('## '));
	const result: LeetCodeSolution[] = [];
	for (const section of langSections) { result.push(...parseLanguageSection(section)); }
	return result;
}

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
