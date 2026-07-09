import { PRACTICE_OPTIONS } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { escHtml } from '../../utils/html.helpers.js';

/**
 * Render the language `<select>` for the challenge.
 *
 * Options are the union of the languages the artifact provides a `# Setup` stub
 * for and the languages it stores solutions for, in that order — a language
 * with only a solution is still selectable, since `resolveStarterCode()` falls
 * back to generated boilerplate.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the labelled selector row, or `''` when no language is known.
 *
 * @example
 * renderLanguageRow(parsed); // → '<div class="lang-select-row">…</div>'
 */
export function renderLanguageRow(p: ParsedLeetCode): string {
	const langs = availableLanguages(p);
	if (langs.length === 0) { return ''; }

	const options = langs
		.map(l => `<option value="${escHtml(l)}">${escHtml(l)}</option>`)
		.join('');

	return [
		'<div class="lang-select-row">',
		'<label for="langSelector">Language:</label>',
		`<select id="langSelector" class="lang-selector">${options}</select>`,
		'</div>',
	].join('\n');
}

/**
 * Render the starter-code preview — the `# Setup` stub for each language.
 *
 * These blocks are what lands in the temp file when *Solve It* is pressed, so
 * showing them here is the user's only chance to see the signature before the
 * clock starts.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the setup section, or `''` when the artifact has no `# Setup`.
 *
 * @example
 * renderSetups(parsed);
 */
export function renderSetups(p: ParsedLeetCode): string {
	if (p.setups.length === 0) { return ''; }

	const blocks = p.setups.map(s => [
		`<div class="setup-block" data-language="${escHtml(s.language)}">`,
		`<div class="slabel">${escHtml(s.language)}<span class="slabel-hint">starter code</span></div>`,
		`<pre class="code"><code>${escHtml(s.code)}</code></pre>`,
		'</div>',
	].join('')).join('\n');

	return `<div class="slabel">Setup</div>${blocks}`;
}

/**
 * Render the practice-mode checkbox list and the time-limit input.
 *
 * When `p.practice.locked` is true the artifact author has made the settings
 * mandatory: every control renders `disabled`, and the extension re-reads the
 * config from the artifact rather than trusting the webview payload.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the practice-settings fieldset.
 *
 * @example
 * renderPracticeControls(parsed);
 */
export function renderPracticeControls(p: ParsedLeetCode): string {
	const { options, timeLimitMinutes, locked } = p.practice;
	const disabled = locked ? ' disabled' : '';

	const rows = PRACTICE_OPTIONS.map(opt => {
		const checked = options.includes(opt.id) ? ' checked' : '';
		const id = `opt_${opt.id}`;
		return [
			'<div class="practice-item">',
			`<input type="checkbox" id="${id}" class="practice-option" value="${escHtml(opt.id)}"${checked}${disabled}>`,
			`<label class="practice-label" for="${id}">`,
			`<span class="practice-label-text">${escHtml(opt.label)}</span>`,
			`<span class="practice-hint">${escHtml(opt.hint)}</span>`,
			'</label>',
			'</div>',
		].join('');
	}).join('\n');

	return [
		'<div class="slabel">Practice settings</div>',
		locked ? '<div class="hint">This exercise fixes its practice settings.</div>' : '',
		`<div class="practice-list">${rows}</div>`,
		'<div class="input-row time-limit-row">',
		'<label for="timeLimit">Time limit</label>',
		`<input type="number" id="timeLimit" min="0" step="5" value="${timeLimitMinutes}"${disabled}>`,
		'<span class="hint">minutes — 0 for no limit</span>',
		'</div>',
	].join('\n');
}

/**
 * Render the action row: start the challenge, or submit a finished attempt.
 *
 * *Run Tests* lives elsewhere now — the panel is a briefing screen, not a test
 * runner.
 *
 * @returns HTML for the button row.
 *
 * @example
 * renderActions(); // → '<div class="actions">…</div>'
 */
export function renderActions(): string {
	return [
		'<div class="actions">',
		'<button id="solveBtn"  class="btn btn-insert">Solve It</button>',
		'<button id="submitBtn" class="btn btn-secondary">Submit</button>',
		'</div>',
	].join('');
}

/**
 * First-appearance-ordered union of setup languages and solution languages.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns Deduplicated lower-cased language list.
 *
 * @example
 * availableLanguages(parsed); // → ['javascript', 'python', 'java']
 */
export function availableLanguages(p: ParsedLeetCode): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const lang of [...p.setups.map(s => s.language), ...p.solutions.map(s => s.language)]) {
		if (seen.has(lang)) { continue; }
		seen.add(lang);
		out.push(lang);
	}
	return out;
}
