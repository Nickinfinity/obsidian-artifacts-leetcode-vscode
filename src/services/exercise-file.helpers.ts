import { EXERCISE_FILE_PREFIX, SOLUTION_MARKER } from '../types/constants.js';
import type { ParsedLeetCode } from '../types/leetcode.types.js';
import { generateBoilerplate } from './leetcode-codegen.service.js';
import { extForLang, resolveLangId } from './language-map.service.js';

/** Languages whose line comment is `#` rather than `//`. */
const HASH_COMMENT_LANGS = new Set(['python', 'ruby', 'shellscript', 'perl', 'r', 'yaml']);

/** Placeholder dropped where the solver is expected to write their answer. */
const SOLUTION_HINT = 'solution here';

/**
 * Resolve the starter source the solver begins from for `langId`.
 *
 * Prefers a `# Setup` stub authored on the artifact. Falls back to the built-in
 * `generateBoilerplate()` wrapper with its `<<SOLUTION>>` marker swapped for a
 * language-appropriate `// solution here` comment, so the file is never handed
 * to the editor with a literal marker in it.
 *
 * @param parsed - Parsed LeetCode artifact.
 * @param langId - Canonical `languageId` the user picked.
 * @returns Starter source text; `''` when neither a setup nor a boilerplate
 *   template exists for the language.
 *
 * @example
 * resolveStarterCode(parsed, 'javascript'); // → 'function twoSum(nums, target) {\n\t// solution here\n}'
 */
export function resolveStarterCode(parsed: ParsedLeetCode, langId: string): string {
	const setup = parsed.setups.find(s => resolveLangId(s.language) === langId);
	if (setup) { return setup.code; }

	const boilerplate = generateBoilerplate(parsed, langId);
	if (!boilerplate) { return ''; }

	const prefix = HASH_COMMENT_LANGS.has(langId) ? '#' : '//';
	return boilerplate.replace(SOLUTION_MARKER, `${prefix} ${SOLUTION_HINT}`);
}

/**
 * Turn a problem title into a filename-safe slug.
 *
 * @param title - Artifact title, e.g. `'Two Sum II'`.
 * @returns Lower-kebab slug; `'exercise'` when the title has no usable
 *   characters.
 *
 * @example
 * slugify('Longest Substring!'); // → 'longest-substring'
 */
export function slugify(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug || 'exercise';
}

/**
 * Basename of the temp exercise file for a problem + language.
 *
 * Kept separate from `exerciseFileUri()` so the naming rule can be unit-tested
 * without an `ExtensionContext` (and therefore without the `vscode` module).
 *
 * @param title  - Artifact title (slugified into the filename).
 * @param langId - Canonical `languageId` (drives the file extension).
 * @returns Filename such as `leetcode_two-sum.js`.
 *
 * @example
 * exerciseFileName('Two Sum', 'python'); // → 'leetcode_two-sum.py'
 */
export function exerciseFileName(title: string, langId: string): string {
	return `${EXERCISE_FILE_PREFIX}${slugify(title)}.${extForLang(langId)}`;
}
