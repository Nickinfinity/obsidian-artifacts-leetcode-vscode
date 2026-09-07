import { LANG_ALIAS, LANG_EXT } from '../types/constants.js';

/** Extensions must be filename-safe before we trust a raw languageId as one. */
const SAFE_EXT_RE = /^[a-z0-9]+$/;

/**
 * Resolves a Markdown fence info-string (or a `## <Language>` heading) to a
 * canonical VS Code `languageId`.
 *
 * Lower-cases the input, then consults `LANG_ALIAS`. Fence strings that are
 * already valid ids (`javascript`, `python`, `java`, …) are not in the alias
 * map and pass through unchanged.
 *
 * @param fenceLang - Fence info-string or language heading, any casing.
 * @returns Canonical `languageId`, or `'plaintext'` for an empty input.
 *
 * The lookup is **own-property only**. A fence info-string is untrusted text, so
 * a plain `LANG_ALIAS[key]` would reach through the prototype chain and hand
 * back `Object.prototype` itself for `` ```__proto__ `` — an object where every
 * caller has been promised a string.
 *
 * @param fenceLang - Fence info-string or language heading, any casing.
 * @returns Canonical `languageId`, or `'plaintext'` for an empty input.
 *
 * @example
 * resolveLangId('JavaScript'); // → 'javascript'
 * resolveLangId('py');         // → 'python'
 * resolveLangId('c#');         // → 'csharp'
 * resolveLangId('__proto__');  // → '__proto__' (never Object.prototype)
 */
export function resolveLangId(fenceLang: string): string {
	const key = fenceLang.trim().toLowerCase();
	if (key === '') { return 'plaintext'; }
	return Object.hasOwn(LANG_ALIAS, key) ? LANG_ALIAS[key] : key;
}

/**
 * Display-only `languageId`s and the runnable language each one is graded as.
 *
 * VS Code gives `.jsx` / `.tsx` their own ids, but this extension has no
 * runtime for them — a React file is bundled and executed as plain
 * JavaScript / TypeScript.
 */
const DISPLAY_TO_RUNNABLE: Readonly<Record<string, string>> = {
	javascriptreact: 'javascript',
	typescriptreact: 'typescript',
};

/**
 * Folds a display-only `languageId` onto the runnable language it is graded
 * as, leaving every other id untouched.
 *
 * One authority for a fact two callers need: `languageOf` (which file a
 * `function` check grades) and `ecosystemFor` (which registry serves a
 * `libs:` key). Both used to inline the same pair of `if`s.
 *
 * @param langId - Canonical `languageId` (already through `resolveLangId`).
 * @returns The runnable id, or `langId` unchanged when it is already one.
 *
 * @example
 * runnableLangId('typescriptreact'); // → 'typescript'
 * runnableLangId('python');          // → 'python'
 */
export function runnableLangId(langId: string): string {
	// Own-property only, for the same reason `resolveLangId` is: the id can
	// come from untrusted `.md` text, and `['__proto__']` is not a language.
	return Object.hasOwn(DISPLAY_TO_RUNNABLE, langId) ? DISPLAY_TO_RUNNABLE[langId] : langId;
}

/**
 * Maps a canonical `languageId` to the file extension used for the temp
 * exercise file (no leading dot).
 *
 * Falls back to the id itself when it is filename-safe (so a language this
 * extension has never heard of still produces a sensible name), and to `'txt'`
 * otherwise — ids like `c#` would otherwise yield an illegal filename.
 *
 * @param langId - Canonical `languageId` (already through `resolveLangId`).
 * @returns Extension without the leading dot.
 *
 * @example
 * extForLang('javascript'); // → 'js'
 * extForLang('nim');        // → 'nim'  (unknown but safe)
 * extForLang('c#');         // → 'txt'  (unsafe — should have been aliased)
 */
export function extForLang(langId: string): string {
	// Own-property only — `LANG_EXT['__proto__']` would otherwise return
	// `Object.prototype`, which is truthy and lands in a filename as
	// "[object Object]". Same hazard as `resolveLangId`.
	const known = Object.hasOwn(LANG_EXT, langId) ? LANG_EXT[langId] : undefined;
	if (known) { return known; }
	return SAFE_EXT_RE.test(langId) ? langId : 'txt';
}

/**
 * Convenience composition: fence info-string → file extension.
 *
 * @param fenceLang - Fence info-string or language heading, any casing.
 * @returns Extension without the leading dot.
 *
 * @example
 * extForFenceLang('Python'); // → 'py'
 */
export function extForFenceLang(fenceLang: string): string {
	return extForLang(resolveLangId(fenceLang));
}
