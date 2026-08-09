import type { PracticeOption, TestType } from './leetcode.types.js';
import type { LeetcodeTypeId } from './leetcode-type.js';
import { shapeOf } from './leetcode-type.js';

/**
 * Markdown code-fence shorthand → canonical VS Code `languageId`.
 *
 * Only entries whose fence shorthand **differs** from the VS Code id belong
 * here. Fence info-strings that already are valid ids (`javascript`, `python`,
 * `json`, `java`, `go`, …) skip this map — `resolveLangId` validates them
 * directly against `vscode.languages.getLanguages()`.
 *
 * Mirrors the map of the same name in the core *AI Snippets & Tools* extension;
 * keep the two in sync when adding a language.
 *
 * @example
 * LANG_ALIAS['js']   // → 'javascript'
 * LANG_ALIAS['c#']   // → 'csharp'
 * LANG_ALIAS['bash'] // → 'shellscript'
 */
export const LANG_ALIAS: Record<string, string> = {
	js: 'javascript',
	node: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'javascriptreact',
	ts: 'typescript',
	tsx: 'typescriptreact',
	py: 'python',
	py3: 'python',
	python3: 'python',
	rb: 'ruby',
	rs: 'rust',
	golang: 'go',
	sh: 'shellscript',
	shell: 'shellscript',
	bash: 'shellscript',
	zsh: 'shellscript',
	yml: 'yaml',
	md: 'markdown',
	'c++': 'cpp',
	'c#': 'csharp',
	cs: 'csharp',
	kt: 'kotlin',
	'objective-c': 'objc',
	ps1: 'powershell',
	htm: 'html',
};

/**
 * Canonical VS Code `languageId` → file extension for the temp exercise file.
 *
 * Unlike the core extension — where the extension is cosmetic because the block
 * editor calls `setTextDocumentLanguage` — here the extension is load-bearing:
 * the file is written to disk before the editor opens, so tooling (tsserver,
 * pylance, …) keys off the real extension.
 *
 * Unmapped ids fall back through `extForLang` (the id itself when
 * filename-safe, else `txt`).
 *
 * @example
 * LANG_EXT['javascript'] // → 'js'
 * LANG_EXT['csharp']     // → 'cs'
 * LANG_EXT['plaintext']  // → 'txt'
 */
export const LANG_EXT: Record<string, string> = {
	javascript: 'js',
	javascriptreact: 'jsx',
	typescript: 'ts',
	typescriptreact: 'tsx',
	python: 'py',
	ruby: 'rb',
	rust: 'rs',
	go: 'go',
	java: 'java',
	csharp: 'cs',
	cpp: 'cpp',
	c: 'c',
	kotlin: 'kt',
	swift: 'swift',
	php: 'php',
	shellscript: 'sh',
	powershell: 'ps1',
	yaml: 'yml',
	json: 'json',
	html: 'html',
	css: 'css',
	scss: 'scss',
	sql: 'sql',
	markdown: 'md',
	xml: 'xml',
	objc: 'm',
	dockerfile: 'dockerfile',
	plaintext: 'txt',
};

/**
 * Practice-mode restrictions offered before a challenge starts.
 *
 * Each entry maps a checkbox in the preview panel to the VS Code settings that
 * `practice-mode.service.ts` writes while the challenge is live (and restores
 * when it ends). `defaultEnabled` seeds the checkbox when the artifact's
 * frontmatter does not declare a `practice.options` list.
 *
 * Settings are applied at **global** scope — VS Code has no per-editor
 * configuration override — so they affect every open editor for the duration of
 * the challenge. Previous values are snapshotted and restored on teardown.
 *
 * @example
 * PRACTICE_OPTIONS.find(o => o.id === 'noAiAgents')?.settings;
 * // → { 'editor.inlineSuggest.enabled': false, 'github.copilot.enable': { '*': false } }
 */
export const PRACTICE_OPTIONS: readonly PracticeOption[] = [
	{
		id: 'noCompletion',
		label: 'Disable code completion',
		hint: 'No IntelliSense suggestions, trigger characters, or tab completion.',
		defaultEnabled: true,
		settings: {
			'editor.quickSuggestions': { other: 'off', comments: 'off', strings: 'off' },
			'editor.suggestOnTriggerCharacters': false,
			'editor.acceptSuggestionOnEnter': 'off',
			'editor.tabCompletion': 'off',
		},
	},
	{
		id: 'noAiAgents',
		label: 'Disable AI agents',
		hint: 'Turns off Copilot and any inline AI suggestion provider.',
		defaultEnabled: true,
		settings: {
			'editor.inlineSuggest.enabled': false,
			'github.copilot.enable': { '*': false },
		},
	},
	{
		id: 'noSnippets',
		label: 'Disable snippets & word suggestions',
		hint: 'Stops the editor completing from snippets or words already in the buffer.',
		defaultEnabled: false,
		settings: {
			'editor.snippetSuggestions': 'none',
			'editor.wordBasedSuggestions': 'off',
		},
	},
	{
		id: 'noParameterHints',
		label: 'Disable parameter hints & hover',
		hint: 'No signature help while typing, no hover documentation popups.',
		defaultEnabled: false,
		settings: {
			'editor.parameterHints.enabled': false,
			'editor.hover.enabled': false,
		},
	},
];

/**
 * The **one** test-type vocabulary — read by `test.type` and by a check's `kind:`.
 *
 * Merged from the two tables that used to overlap: this one and
 * `project-parser`'s `VALID_KINDS`, which both listed `function` meaning
 * different things. A check now names its kind from exactly this set, which
 * is what lets one multi-package artifact grade each check differently.
 *
 * **`status` means: can anything execute this id *today*?** Precisely — a
 * registered environment for a `test.type`, or a `runOneCheck` branch for a
 * check's `kind:`. It is the table's claim about the tree, so it must never
 * run ahead of the tree: an id marked `implemented` before its implementation
 * lands contradicts the registry, which is the thing callers actually ask.
 *
 * A `reserved` id parses and validates, but nothing is registered, so
 * `languagesForType()` resolves it to `[]` and the panel offers no selectable
 * language — the correct, self-explaining failure rather than a run that dies
 * inside a compiler.
 *
 * @example
 * TEST_TYPES.find(t => t.id === 'build')?.status; // → 'implemented'
 */
export const TEST_TYPES: readonly TestType[] = [
	{
		id: 'call',
		// Reserved until the function envs register under `call` rather than
		// the legacy `function`. Marking it implemented while every env still
		// answers to `function` would make this table disagree with the
		// registry — and the registry is what `languagesForType` reads.
		status: 'reserved',
		description: 'Call a free function with positional args, compare the return value.',
	},
	{
		id: 'program',
		status: 'reserved',
		description: 'Deliver a case by argv, named flags or stdin; compare the value the program writes to $LEET_OUT.',
	},
	{
		id: 'http',
		status: 'reserved',
		description: 'Send a real request to a server booted on an assigned loopback port; compare status, headers and body.',
	},
	{
		id: 'build',
		status: 'implemented',
		description: 'A declared argv exits 0.',
	},
	{
		id: 'dom-assert',
		status: 'implemented',
		description: 'Run declarative steps against a jsdom mount, compare the observed DOM value.',
	},
	{
		id: 'css-assert',
		status: 'implemented',
		description: 'As dom-assert, comparing a declared style property or class presence — never layout geometry.',
	},
	{
		id: 'class',
		status: 'reserved',
		description: 'Instantiate, invoke a method sequence, compare the sequence of returns (LRUCache, MinStack).',
	},
	{
		id: 'in-place',
		status: 'reserved',
		description: 'Compare a mutated argument rather than the return value (removeDuplicates).',
	},

	// ── Legacy, transitional — removed with the code paths that still branch on them ──
	{
		id: 'function',
		status: 'implemented',
		description: 'Legacy spelling of `call`. Retained so an unmigrated artifact still parses.',
	},
	{
		id: 'stdin-stdout',
		status: 'reserved',
		description: 'Legacy; subsumed by `program`, whose stdin channel delivers the same thing.',
	},
	{
		id: 'project',
		status: 'implemented',
		description: 'Legacy; never a test type but an artifact *shape*, now the `package` leetcode type.',
	},
	{
		id: 'service',
		status: 'reserved',
		description: 'Legacy; never a test type but an artifact *shape*, now the `stack` leetcode type.',
	},
];

/**
 * Legacy ids that describe an artifact's **shape**, never a way to deliver a case.
 *
 * Named once so a check's `kind:` can exclude them: `kind: project` was never
 * meaningful, and admitting it just because the id still parses as a
 * `test.type` would re-create the exact overlap the merge removes. `function`
 * is deliberately **not** here — it is the legacy spelling of `call` and a
 * live check kind in the vault until the migration rewrites it.
 */
export const SHAPE_TEST_TYPE_IDS: ReadonlySet<string> =
	new Set<string>(['project', 'service']);

/** Test type assumed when the artifact declares no `test:` block. */
export const DEFAULT_TEST_TYPE = 'function';

/**
 * Is this artifact a **file tree**, rather than one candidate buffer?
 *
 * The one authority for that question, and it now reads the leetcode type's
 * own `shape` column instead of a hand-kept set of *test*-type ids. That set
 * (`MULTI_FILE_TYPES`, `['project', 'service']`) was the flattening this axis
 * split exists to undo: it asked the test-type value a question about the
 * artifact's shape, which is why adding a shape meant editing a second list.
 *
 * Three unrelated concerns ask it — the parser (does `## Files` / `checks:`
 * get parsed?), the challenge (does *Solve It* materialise a directory or
 * write one buffer?), and the panel (may the selector offer a language the
 * registry has no env for?) — and each used to answer it with its own
 * `=== 'project'`, which is why `service` parsed a file tree nothing ever
 * opened.
 *
 * Distinct from *runnable*: a `stack` is a tree that opens and does **not**
 * grade, because no environment is registered for it yet. Grading capability
 * stays the registry's answer alone (`testEnvFor` / `languagesForType`).
 *
 * @param leetcodeType - The artifact's resolved leetcode type. `undefined` is
 *   accepted only because the field is still optional on `ParsedLeetCode`; it
 *   is unreachable for parser output, since `parseLeetCode` always resolves
 *   it. Answering `false` there is deliberate and pinned by a test, so the
 *   branch cannot quietly change sense. When the field becomes required,
 *   **delete the `undefined` case rather than defaulting it at a call site** —
 *   a defaulted shape opens a `stack` as a single buffer.
 * @returns True for any shape that is not `buffer`.
 *
 * @example
 * isMultiFile('package');  // → true
 * isMultiFile('function'); // → false
 */
export function isMultiFile(leetcodeType: LeetcodeTypeId | undefined): boolean {
	return leetcodeType !== undefined && shapeOf(leetcodeType) !== 'buffer';
}

/** Per-case execution budget when `test.timeoutMs` is absent or unusable. */
export const DEFAULT_TEST_TIMEOUT_MS = 5_000;

/** Floor on `test.timeoutMs` — anything smaller is a typo, not an intention. */
export const MIN_TEST_TIMEOUT_MS = 100;

/** Hard ceiling on the whole suite's wall-clock budget, regardless of case count. */
export const MAX_SUITE_TIMEOUT_MS = 60_000;

/**
 * Wall-clock budget for the **build** step, separate from the suite's.
 *
 * A compile is not per-case, so it cannot share the suite budget: `javac` on
 * two files is a second, while a Cargo link is longer, and one number cannot
 * be both. Generous rather than tight, because the cost it guards against —
 * a *cold* dependency build — is paid at install time by the cargo
 * pre-warm, and what reaches here is an incremental link.
 *
 * Matched to the `build` check's own budget: two ways to spawn a compiler
 * should not disagree about how long one may take.
 */
export const COMPILE_TIMEOUT_MS = 120_000;

/**
 * What one **process start** costs a `program` suite, per case (P5).
 *
 * A `call` suite runs one process for every case — the `__LEET__` batch
 * protocol exists precisely so a compiled language pays its startup once. A
 * `program` suite cannot: argv and stdin differ per case, so each case *is* an
 * invocation. Charging nine JVM starts to the solver's algorithm and then
 * reporting `timeout` blames code that was never slow, so the suite budget
 * adds this per case on top of `test.timeoutMs`.
 *
 * Sized against the slowest start a runnable language has (a cold JVM with a
 * classpath), not the fastest (`node`), because one number covers all five.
 * It is deliberately not `test.timeoutMs`-derived: an artifact tightening its
 * per-case budget must not also shrink the allowance for machinery it does
 * not control.
 */
export const PROGRAM_SPAWN_OVERHEAD_MS = 2_000;

/**
 * Hard ceiling on a whole `program` suite, regardless of case count.
 *
 * Higher than `MAX_SUITE_TIMEOUT_MS` for the reason the constant above
 * exists: the same nine cases pay nine startups here and one there, so
 * reusing the `call` cap would re-introduce the misattributed timeout it is
 * meant to prevent. Matched to the render check's ceiling — the other budget
 * that covers repeated out-of-process work.
 */
export const MAX_PROGRAM_SUITE_TIMEOUT_MS = 180_000;

/**
 * Line prefix every generated test program stamps on its result lines.
 *
 * Exists so an incidental `print` / `console.log` in the solver's own code
 * cannot be mistaken for a case outcome, and so stdout truncated by a
 * timeout-kill stays parseable up to the last intact line.
 */
export const LEET_SENTINEL = '__LEET__';

/**
 * Time limit (minutes) pre-filled in the panel when the artifact does not
 * declare `practice.timeLimit`. `0` means "no limit".
 */
export const DEFAULT_TIME_LIMIT_MINUTES = 0;

/** Directory (relative to `globalStorageUri`) holding temp exercise files. */
export const ATTEMPTS_DIR = 'attempts';

/** Filename prefix for every generated exercise file. */
export const EXERCISE_FILE_PREFIX = 'leetcode_';

/** Marker the codegen wrapper places where the candidate's code should go. */
export const SOLUTION_MARKER = '<<SOLUTION>>';

/**
 * Markdown fence delimiter. Kept as a constant (not a literal) so every
 * `String.raw` regex that builds a fence pattern reads the same three
 * characters from one place.
 */
export const FENCE = '```';

/** Vault directory this extension reads LeetCode problems from. */
export const LEETCODE_DIR = 'LeetCode';

/** Status-bar refresh cadence for the challenge timer, in milliseconds. */
export const TICK_MS = 1000;

/** Settings namespace retained only for one-time migration of the legacy synced value. */
export const CONFIG_NS = 'obsidianLeetcodeTrainer';

/** `globalState` key holding the vault path. Machine-local — never registered for Settings Sync. */
export const VAULT_PATH_KEY = 'vaultPath';

/**
 * `globalState` key holding the "use vault root" toggle. Machine-local — same
 * policy as `VAULT_PATH_KEY`, never registered for Settings Sync.
 */
export const USE_VAULT_ROOT_KEY = 'useVaultRoot';

/** Context key used by `package.json` `when` clauses to gate the open command. */
export const VAULT_CONFIGURED_KEY = 'obsidian-leetcode.vaultConfigured';

/** Command that tears the active challenge down and restores editor settings. */
export const END_CHALLENGE_COMMAND = 'obsidian-leetcode.endChallenge';

/** Placeholder dropped where the solver is expected to write their answer. */
export const SOLUTION_HINT = 'solution here';

/**
 * Valid `difficulty` values, in display order — the single source of truth
 * `LeetCodeDifficulty` is derived from and the parser's validation set is
 * built from, so a new difficulty is added in exactly one place.
 */
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
