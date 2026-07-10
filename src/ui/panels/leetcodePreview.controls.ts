import { resolveLangId } from '../../services/language-map.service.js';
import { hasFinalTests, publicCount } from '../../services/leetcode-suite.helpers.js';
import { languagesForType } from '../../services/test-envs/env.registry.js';
import { PRACTICE_OPTIONS } from '../../types/constants.js';
import type { ParsedLeetCode } from '../../types/leetcode.types.js';
import { escHtml } from '../../utils/html.helpers.js';

/**
 * Render the language `<select>` for the challenge.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the labelled selector row, or `''` when no language is runnable.
 *
 * @example
 * renderLanguageRow(parsed); // → '<div class="lang-select-row">…</div>'
 */
export function renderLanguageRow(p: ParsedLeetCode): string {
	const langs = availableLanguages(p);
	if (langs.length === 0) {
		return `<div class="hint">No test environment for <code>${escHtml(p.test.type)}</code> in any language this exercise provides.</div>`;
	}

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
 * Render the test-count line: `2 public tests · 3 final tests`.
 *
 * Final cases are counted but never shown — a solver may know how many hidden
 * cases will grade them without learning what those cases are. An artifact
 * without a `## Final Tests` section reads simply `2 tests`.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the counts line.
 *
 * @example
 * renderTestCounts(parsed); // → '<div class="tests-count">2 public tests · 3 final tests</div>'
 */
export function renderTestCounts(p: ParsedLeetCode): string {
	const pub = publicCount(p);
	if (!hasFinalTests(p)) {
		return `<div class="tests-count">${pub} tests</div>`;
	}
	return `<div class="tests-count">${pub} public tests &middot; ${p.finalTests.length} final tests</div>`;
}

/**
 * Render the starter-code preview — the `# Setup` stub for each language.
 *
 * `data-language` carries the *canonical* language id so the webview's filter
 * matches the selector's values, even when the artifact's heading used an alias
 * (`## JS`).
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the setup section, or `''` when the artifact has no `# Setup`.
 *
 * @example
 * renderSetups(parsed);
 */
export function renderSetups(p: ParsedLeetCode): string {
	if (p.setups.length === 0) { return ''; }

	const blocks = p.setups.map(s => {
		const langId = resolveLangId(s.language);
		return [
			`<div class="setup-block" data-language="${escHtml(langId)}">`,
			`<div class="slabel">${escHtml(langId)}<span class="slabel-hint">starter code</span></div>`,
			`<pre class="code"><code>${escHtml(s.code)}</code></pre>`,
			'</div>',
		].join('');
	}).join('\n');

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
 * Render the action row: Run Tests, Solve It, Submit.
 *
 * Run Tests starts `disabled` — it grades the live attempt buffer, which does
 * not exist until Solve It has opened one. The webview re-enables it on the
 * `challengeState` message.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the button row.
 *
 * @example
 * renderActions(parsed); // → '<div class="actions">…</div>'
 */
export function renderActions(p: ParsedLeetCode): string {
	const runnable = availableLanguages(p).length > 0;
	const solveAttrs = runnable ? '' : ' disabled';
	return [
		'<div class="actions">',
		'<button id="runTestsBtn" class="btn btn-secondary" disabled>Run Tests</button>',
		`<button id="solveBtn"  class="btn btn-insert"${solveAttrs}>Solve It</button>`,
		`<button id="submitBtn" class="btn btn-secondary"${solveAttrs}>Submit</button>`,
		'</div>',
	].join('');
}

/**
 * Languages this exercise can actually be attempted in.
 *
 * The union of `# Setup` and `# Solutions` languages, intersected with the
 * languages that have a registered environment for the artifact's `test.type`.
 * A language with a starter stub but no env never appears — the registry *is*
 * the capability matrix, so there is no second table to keep in sync.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns Canonical language ids, in first-appearance order.
 *
 * @example
 * availableLanguages(parsed); // → ['javascript', 'python']
 */
export function availableLanguages(p: ParsedLeetCode): string[] {
	const supported = new Set(languagesForType(p.test.type));
	const seen = new Set<string>();
	const out: string[] = [];

	const declared = [...p.setups.map(s => s.language), ...p.solutions.map(s => s.language)];
	for (const raw of declared) {
		const langId = resolveLangId(raw);
		if (seen.has(langId) || !supported.has(langId)) { continue; }
		seen.add(langId);
		out.push(langId);
	}
	return out;
}
