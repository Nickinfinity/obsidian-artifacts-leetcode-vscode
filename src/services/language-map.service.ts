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
 * @example
 * resolveLangId('JavaScript'); // → 'javascript'
 * resolveLangId('py');         // → 'python'
 * resolveLangId('c#');         // → 'csharp'
 */
export function resolveLangId(fenceLang: string): string {
	const key = fenceLang.trim().toLowerCase();
	if (key === '') { return 'plaintext'; }
	return LANG_ALIAS[key] ?? key;
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
	const known = LANG_EXT[langId];
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
