import type { PracticeOption, TestType } from './leetcode.types.js';

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
 * Execution strategies a challenge may declare via `test.type`.
 *
 * Only `function` has environments registered (see `test-envs/`). A reserved id
 * parses and validates, but `languagesForType()` resolves it to `[]`, so the
 * panel offers no selectable language — the correct, self-explaining failure
 * rather than a run that dies inside a compiler.
 *
 * @example
 * TEST_TYPES.find(t => t.id === 'function')?.status; // → 'implemented'
 */
export const TEST_TYPES: readonly TestType[] = [
	{
		id: 'function',
		status: 'implemented',
		description: 'Call a free function with positional args, compare the return value.',
	},
	{
		id: 'class',
		status: 'reserved',
		description: 'Instantiate, invoke a method sequence, compare the sequence of returns (LRUCache, MinStack).',
	},
	{
		id: 'stdin-stdout',
		status: 'reserved',
		description: 'Feed raw stdin, compare trimmed stdout.',
	},
	{
		id: 'in-place',
		status: 'reserved',
		description: 'Compare a mutated argument rather than the return value (removeDuplicates).',
	},
];

/** Test type assumed when the artifact declares no `test:` block. */
export const DEFAULT_TEST_TYPE = 'function';

/** Per-case execution budget when `test.timeoutMs` is absent or unusable. */
export const DEFAULT_TEST_TIMEOUT_MS = 5_000;

/** Floor on `test.timeoutMs` — anything smaller is a typo, not an intention. */
export const MIN_TEST_TIMEOUT_MS = 100;

/** Hard ceiling on the whole suite's wall-clock budget, regardless of case count. */
export const MAX_SUITE_TIMEOUT_MS = 60_000;

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
