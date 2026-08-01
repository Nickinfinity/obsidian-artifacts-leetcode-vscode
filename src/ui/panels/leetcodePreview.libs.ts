import { escHtml } from '../../utils/html.helpers.js';
import { ecosystemFor } from '../../services/libs/lib-ecosystem.js';
import { resolveLangId } from '../../services/language-map.service.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';

/**
 * Render an artifact's declared libraries as one chip per spec, grouped by
 * language the same way the setup and solution blocks are.
 *
 * A solver needs to know what is already installed before deciding how to
 * solve — an exercise that ships numpy is a different exercise from one that
 * does not. The blocks carry the **canonical** language id in
 * `data-language`, so the webview's existing selector filter shows only the
 * chips for the language being solved, exactly as it does for starter code.
 *
 * Every value goes through `escHtml`: a spec is artifact-authored text.
 *
 * @param parsed - Parsed LeetCode artifact.
 * @returns HTML for the chips, or `''` when nothing is declared — never an
 *   empty row, which would leave a stray label in the panel.
 *
 * @example
 * renderLibChips({ libs: { python: ['numpy>=2'] }, … });
 * // → '<div class="lib-block" data-language="python">…numpy&gt;=2…'
 */
export function renderLibChips(parsed: ParsedLeetCode): string {
	const entries = Object.entries(parsed.libs ?? {}).filter(([, specs]) => specs.length > 0);
	if (entries.length === 0) { return ''; }

	const blocks = entries.map(([language, specs]) => {
		const langId = resolveLangId(language);
		const registry = ecosystemFor(langId);
		const chips = specs.map(spec => `<span class="lib-chip">${escHtml(spec)}</span>`).join('');
		const label = registry === undefined ? 'libraries' : `${escHtml(registry)} libraries`;
		return [
			`<div class="lib-block" data-language="${escHtml(langId)}">`,
			`<div class="slabel">${label}</div>`,
			`<div class="lib-chips">${chips}</div>`,
			'</div>',
		].join('');
	}).join('\n');

	return blocks;
}
