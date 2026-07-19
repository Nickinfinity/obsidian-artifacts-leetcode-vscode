/**
 * The languages this extension can actually **run** — i.e. every language that
 * has a code-generation path, a test environment, and a local runtime probe.
 *
 * This is deliberately narrower than the cosmetic `LANG_ALIAS` / `LANG_EXT`
 * tables (which name dozens of languages purely so a fenced block resolves to a
 * sensible `languageId` and file extension). A language is a `LangId` only when
 * a solver can Solve It → Run Tests → Submit in it end to end.
 */
export type LangId = 'java' | 'python' | 'javascript';

/**
 * One executable language's configuration — the single source of truth the
 * runners, the big-O heuristic, and (via derivation) the comment-prefix and
 * supported-set checks all read from, so adding a runnable language is one
 * entry here rather than the same fact re-typed in a handful of files.
 */
export interface LanguageConfig {
	/** Canonical VS Code `languageId`. */
	readonly id: LangId;
	/** Human label shown in "Install X to run tests" and the selector. */
	readonly displayName: string;
	/** Temp-file extension (no dot). Must equal `LANG_EXT[id]`. */
	readonly fileExt: string;
	/** Single-line comment lead used when stubbing the solution placeholder. */
	readonly commentPrefix: '#' | '//';
	/** Shell probe (argv[0] + `--version`) proving the runtime is installed. */
	readonly detectCmd: string;
	/** Fence shorthands that resolve to `id` — every one lives in `LANG_ALIAS`. */
	readonly aliases: readonly string[];
}

/**
 * Registry of every runnable language, keyed by canonical `languageId`.
 *
 * @example
 * LANGUAGES.python.detectCmd; // → 'python3 --version'
 * LANGUAGES.java.displayName; // → 'Java'
 */
export const LANGUAGES: Record<LangId, LanguageConfig> = {
	java: {
		id: 'java',
		displayName: 'Java',
		fileExt: 'java',
		commentPrefix: '//',
		detectCmd: 'java --version',
		aliases: [],
	},
	python: {
		id: 'python',
		displayName: 'Python',
		fileExt: 'py',
		commentPrefix: '#',
		detectCmd: 'python3 --version',
		aliases: ['py', 'py3', 'python3'],
	},
	javascript: {
		id: 'javascript',
		displayName: 'JavaScript',
		fileExt: 'js',
		commentPrefix: '//',
		detectCmd: 'node --version',
		aliases: ['js', 'node', 'mjs', 'cjs'],
	},
};

/** Every runnable language id, in registry (display) order. */
export const LANG_IDS = Object.keys(LANGUAGES) as LangId[];

/**
 * Type guard narrowing an arbitrary `languageId` to a runnable `LangId`.
 *
 * @param langId - Any canonical `languageId`.
 * @returns `true` when the language has a registry entry.
 *
 * @example
 * isLangId('python'); // → true
 * isLangId('ruby');   // → false
 */
export function isLangId(langId: string): langId is LangId {
	return Object.hasOwn(LANGUAGES, langId);
}
