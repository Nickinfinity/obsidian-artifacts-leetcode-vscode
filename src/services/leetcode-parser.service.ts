import type {
	LeetCodeSummary,
	ParsedLeetCode,
} from '../types/leetcode.types.js';
import {
	extractAttempts,
	extractDescription,
	extractExamples,
	extractFinalTests,
	extractSetups,
	extractSolutions,
	extractTests,
} from './leetcode-sections.helpers.js';
import { parseFrontmatter } from './leetcode-parser.helpers.js';

export { defaultPracticeConfig, defaultTestConfig } from './leetcode-parser.helpers.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parses a LeetCode-flavoured vault `.md` file into a `ParsedLeetCode` structure.
 *
 * Extracts frontmatter (including the YAML `params:` array and the `practice:`
 * block), the problem description, `## Examples`, the `## Tests` JSON block, the
 * `# Setup` starter stubs, and the `# Solutions` tree.
 *
 * Defaults: missing `status` → `'unsolved'`; missing or invalid `difficulty`
 * → `'easy'`; missing `practice` → `PRACTICE_OPTIONS` defaults, no time limit,
 * unlocked. Malformed JSON in the tests block returns an empty test array
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
		functions:    fm.functions,
		algorithm:    fm.algorithm,
		status:       fm.status,
		params:       fm.params,
		returns:      fm.returns ?? '',
		description:  extractDescription(body),
		examples:     extractExamples(body),
		tests:        extractTests(body),
		finalTests:   extractFinalTests(body),
		test:         fm.test,
		setups:       extractSetups(body),
		practice:     fm.practice,
		solutions:    extractSolutions(body),
		attempts:     extractAttempts(body),
		tags:         fm.tags ?? [],
	};
}

/**
 * Parses only the frontmatter block, skipping the description/examples/tests/
 * setup/solution body entirely.
 *
 * Fast path for the exercise picker (`buildQuickPickItems`), which only needs
 * title/difficulty/status/algorithm/tags to render a `QuickPickItem` — running
 * the full `parseLeetCode` per file would parse every test case and solution
 * block just to throw them away.
 *
 * @param content - Full UTF-8 string content of the `.md` file.
 * @returns A `LeetCodeSummary` — same frontmatter defaults as `parseLeetCode`.
 *
 * @example
 * parseFrontmatterOnly('---\ntitle: Two Sum\n---\n\nBody...');
 */
export function parseFrontmatterOnly(content: string): LeetCodeSummary {
	const fmMatch = FRONTMATTER_RE.exec(content);
	const fm = parseFrontmatter(fmMatch ? fmMatch[1] : '');
	return {
		title:      fm.title ?? '',
		difficulty: fm.difficulty,
		status:     fm.status,
		algorithm:  fm.algorithm,
		tags:       fm.tags ?? [],
	};
}

/**
 * Resolves the function name a candidate must declare in `langId`.
 *
 * Looks up `parsed.functions[langId]` (the `functions:` frontmatter override);
 * falls back to `parsed.functionName` when the map is absent or has no entry
 * for that language. Every call site that used to read `parsed.functionName`
 * directly for a specific language should call this instead.
 *
 * @param parsed - Parsed artifact carrying `functionName` and the optional map.
 * @param langId - Canonical `languageId` (already through `resolveLangId`).
 * @returns The name to declare/call for this language.
 *
 * @example
 * functionNameFor({ functionName: 'ABCheck', functions: { python: 'ab_check' }, … }, 'python');
 * // → 'ab_check'
 * functionNameFor({ functionName: 'ABCheck', functions: { python: 'ab_check' }, … }, 'java');
 * // → 'ABCheck'
 */
export function functionNameFor(parsed: ParsedLeetCode, langId: string): string {
	return parsed.functions?.[langId] ?? parsed.functionName;
}
