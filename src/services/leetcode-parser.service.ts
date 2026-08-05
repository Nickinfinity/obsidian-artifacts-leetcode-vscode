import type {
	LeetCodeSummary,
	LibSpec,
	ParsedLeetCode,
} from '../types/leetcode.types.js';
import { isMultiFile } from '../types/constants.js';
import {
	extractAttempts,
	extractDescription,
	extractExamples,
	extractFinalTests,
	extractSetups,
	extractSolutions,
	extractTests,
} from './leetcode-sections.helpers.js';
import {
	extractConfigBlocks,
	legacyFrontmatterKeys,
	splitFrontmatter,
	withoutBodySetKeys,
} from './leetcode-config-blocks.helpers.js';
import { parseFrontmatter } from './leetcode-parser.helpers.js';
import { parseLibDeclarations, parseProjectArtifact } from './project-parser.helpers.js';

export { defaultPracticeConfig, defaultTestConfig } from './leetcode-parser.helpers.js';

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
	const { fmRaw, body } = splitFrontmatter(content);
	const config = extractConfigBlocks(body);

	// D5: **one** concatenation, **one** `parseFrontmatter` call. Two calls would
	// need merge logic that cannot tell a default from a real value; one keeps
	// defaults applied exactly once and adds no merge code.
	//
	// D4 is a hard cut, so the frontmatter half is stripped of body-set keys
	// before it gets here — a `params:` left in frontmatter is *ignored*, not
	// read-then-warned, which would be the dual read D4 forbids.
	const legacyKeys = legacyFrontmatterKeys(fmRaw);
	const configText = withoutBodySetKeys(fmRaw) + '\n' + config.raw;

	const fm = parseFrontmatter(configText);
	// Multi-file grammar is its own concern and its own file — a `function`
	// artifact never pays for it, and gets none of its fields.
	const project = isMultiFile(fm.test.type) ? parseProjectArtifact(configText, body) : null;

	// `libs:` belongs to every test type, not just the multi-file ones: a
	// `function` exercise can want numpy. A project already parsed its own as
	// part of the multi-file grammar, so only the other types read it here —
	// and their warnings ride in the extractor slot, which keeps a clean
	// function artifact's `warnings` `undefined` rather than `[]`.
	const libWarnings: string[] = [];
	const libs = project
		? project.libs
		: emptyToUndefined(parseLibDeclarations(configText.split(/\r?\n/), m => libWarnings.push(m)));

	// `fm.leetcodeTypeWarning` rides beside the config/lib warnings — it is the
	// same kind of "declared but unusable, fell back" author-facing problem.
	const extraWarnings = [...config.warnings, ...libWarnings];
	if (fm.leetcodeTypeWarning) { extraWarnings.push(fm.leetcodeTypeWarning); }
	const warnings = collectWarnings(project?.warnings, legacyKeys, extraWarnings);

	return {
		title:        fm.title ?? '',
		leetcodeType: fm.leetcodeType,
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
		files:        project?.files,
		libs,
		checks:       project?.checks,
		solutionFiles: project?.solutionFiles,
		warnings,
	};
}

/**
 * `undefined` for an empty declaration map, the map itself otherwise.
 *
 * A `function` artifact that declares no `libs:` must have **no** `libs` key at
 * all: `ParsedLeetCode.libs` is optional, `JSON.stringify` omits an `undefined`
 * key, and `{}` would change the serialised shape of every existing artifact.
 *
 * @param libs - Parsed declarations, possibly empty.
 * @returns The map, or `undefined` when it holds nothing.
 *
 * @example
 * emptyToUndefined({});                  // → undefined
 * emptyToUndefined({ python: ['numpy'] }); // → { python: ['numpy'] }
 */
function emptyToUndefined(libs: LibSpec): LibSpec | undefined {
	return Object.keys(libs).length === 0 ? undefined : libs;
}

/**
 * Assembles the artifact's warning list, or `undefined` when there is nothing
 * to say.
 *
 * **The empty case is `undefined` for a `function` artifact and `[]` for a
 * `project`/`service` one, and that asymmetry is inherited, not chosen.** This
 * field was `project?.warnings`: `undefined` when `parseProjectArtifact` did not
 * run, and an array — empty when clean — when it did. `ParsedLeetCode.warnings`
 * is optional and `JSON.stringify` omits an `undefined` key, so collapsing the
 * two would change the serialised shape of every clean project artifact.
 * The golden net caught exactly that: `"warnings":[]` vanished from the project
 * snapshot when this returned `undefined` unconditionally.
 *
 * Order is fixed: `project` warnings first, then the D4 legacy-key warnings,
 * then the extractor's. Appending rather than prepending keeps an existing
 * project's warning order unchanged.
 *
 * @param projectWarnings - `parseProjectArtifact`'s warnings; `undefined` when
 *   it did not run, which is what distinguishes the two empty cases.
 * @param legacyKeys      - D2 body-set keys found in frontmatter (D4 hard cut).
 * @param configWarnings  - `extractConfigBlocks`' warnings.
 * @returns The combined list; `[]` for a clean project, `undefined` for a clean
 *   function artifact.
 *
 * @example
 * collectWarnings(undefined, ['params'], []);
 * // → ["frontmatter 'params:' is ignored — move it into a 'yaml leetcode' body fence"]
 * collectWarnings(undefined, [], []); // → undefined  (clean function artifact)
 * collectWarnings([], [], []);        // → []         (clean project artifact)
 */
function collectWarnings(
	projectWarnings: string[] | undefined,
	legacyKeys: string[],
	configWarnings: string[],
): string[] | undefined {
	const extra = [...legacyKeys.map(legacyKeyWarning), ...configWarnings];
	if (projectWarnings === undefined) {
		return extra.length > 0 ? extra : undefined;
	}
	return [...projectWarnings, ...extra];
}

/** D4's message: name the key, and the fence it belongs in. */
function legacyKeyWarning(key: string): string {
	return `frontmatter '${key}:' is ignored — move it into a 'yaml leetcode' body fence`;
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
	// Deliberately **frontmatter alone** — no `extractConfigBlocks` call. Every
	// field of `LeetCodeSummary` is a D2-retained frontmatter key, so reading the
	// body would buy nothing and cost the picker a full-body scan per file at
	// exactly the point this fast path exists to keep cheap.
	const fm = parseFrontmatter(splitFrontmatter(content).fmRaw);
	return {
		title:        fm.title ?? '',
		leetcodeType: fm.leetcodeType,
		difficulty:   fm.difficulty,
		status:       fm.status,
		algorithm:    fm.algorithm,
		tags:         fm.tags ?? [],
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
