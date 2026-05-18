import type {
	LeetCodeSolution,
	ParsedLeetCode,
	TestResult,
} from '../../types/leetcode.types.js';
import { escHtml } from '../../utils/html.helpers.js';

/**
 * Renders the full HTML document for the LeetCode preview panel.
 *
 * Layout sections (top to bottom):
 *   - `<h1>` title
 *   - badges row: difficulty pill, status pill, algorithm tag
 *   - description paragraph
 *   - `## Examples` cards (one per parsed example)
 *   - test-case count line
 *   - language `<select id="langSelector">` + per-solution code blocks
 *   - `<button id="runTestsBtn">` / `<button id="submitBtn">`
 *   - `<div id="results">` results sink (populated by the webview script)
 *
 * @param parsed    - Fully parsed LeetCode artifact.
 * @param cssUri    - Webview URI for the shared stylesheet.
 * @param cspSource - Webview CSP source token (passed through into `<meta>`).
 * @returns Complete HTML document string.
 *
 * @example
 * renderLeetCodePreviewHtml(parsed, cssUri, panel.webview.cspSource);
 */
export function renderLeetCodePreviewHtml(
	parsed: ParsedLeetCode, cssUri: string, cspSource: string,
): string {
	const body = [
		`<h1 class="leet-title">${escHtml(parsed.title)}</h1>`,
		renderBadgesRow(parsed),
		renderDescription(parsed),
		renderExamples(parsed),
		renderTestsCount(parsed),
		renderSolutionsSection(parsed),
		renderActions(),
		'<div id="results" class="results-container"></div>',
	].join('\n');

	return shell(body, cssUri, cspSource);
}

/**
 * Renders the per-run test-results fragment (no `<html>` wrapper).
 *
 * Includes a summary banner (`results-summary` with `all-pass` / `has-fail`
 * modifier) plus one row per result tagged `test-pass`, `test-fail`, or
 * `test-error`.
 *
 * @param results - Ordered list of `TestResult` objects from the runner.
 * @returns HTML fragment ready to inject into the results sink.
 *
 * @example
 * panel.webview.postMessage({ command: 'testResults', html: renderTestResultsHtml(results) });
 */
export function renderTestResultsHtml(results: TestResult[]): string {
	const total  = results.length;
	const passed = results.filter(r => r.passed).length;
	const summaryCls = computeSummaryClass(passed, total);
	const summary = `<div class="results-summary ${summaryCls}">${passed} / ${total} passed</div>`;

	const rows = results.map(renderResultRow).join('\n');
	return `${summary}\n${rows}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Pick the modifier class for the summary banner. */
function computeSummaryClass(passed: number, total: number): string {
	if (total === 0)        { return ''; }
	if (passed === total)   { return 'all-pass'; }
	return 'has-fail';
}

/** Build the difficulty / status / algorithm badges row. */
function renderBadgesRow(p: ParsedLeetCode): string {
	const parts: string[] = [
		`<span class="badge difficulty-${p.difficulty}">${escHtml(p.difficulty)}</span>`,
		`<span class="badge status-${p.status}">${escHtml(p.status)}</span>`,
	];
	if (p.algorithm) {
		parts.push(`<span class="tag">${escHtml(p.algorithm)}</span>`);
	}
	return `<div class="badges">${parts.join('')}</div>`;
}

/** Render the description block (omitted when empty). */
function renderDescription(p: ParsedLeetCode): string {
	if (!p.description.trim()) { return ''; }
	return `<div class="desc">${escHtml(p.description)}</div>`;
}

/** Render the `## Examples` cards section. */
function renderExamples(p: ParsedLeetCode): string {
	if (p.examples.length === 0) { return ''; }
	const cards = p.examples.map(ex => [
		'<div class="example-card">',
		`<div><span class="label">Input:</span> <code>${escHtml(ex.input)}</code></div>`,
		`<div><span class="label">Output:</span> <code>${escHtml(ex.output)}</code></div>`,
		'</div>',
	].join('')).join('\n');
	return `<div class="slabel">Examples</div>${cards}`;
}

/** Render the inline test-case count line. */
function renderTestsCount(p: ParsedLeetCode): string {
	return `<div class="tests-count">${p.tests.length} test cases</div>`;
}

/** Render the language selector and the solution code blocks. */
function renderSolutionsSection(p: ParsedLeetCode): string {
	if (p.solutions.length === 0) { return ''; }
	const langs = uniqueLanguages(p.solutions);
	const options = langs.map(l => `<option value="${escHtml(l)}">${escHtml(l)}</option>`).join('');

	const blocks = p.solutions.map((s, i) => {
		const labelTxt = s.label ? `${s.label} — ` : '';
		return [
			`<div class="solution-block" data-language="${escHtml(s.language)}" data-index="${i}">`,
			`<div class="slabel">${escHtml(labelTxt)}${escHtml(s.language)}</div>`,
			`<pre class="code"><code>${escHtml(s.code)}</code></pre>`,
			'</div>',
		].join('');
	}).join('\n');

	return [
		'<div class="lang-select-row">',
		'<label for="langSelector">Language:</label>',
		`<select id="langSelector" class="lang-selector">${options}</select>`,
		'</div>',
		blocks,
	].join('\n');
}

/** Render the Run Tests / Submit button row. */
function renderActions(): string {
	return [
		'<div class="actions">',
		'<button id="runTestsBtn" class="btn primary">Run Tests</button>',
		'<button id="submitBtn"   class="btn primary">Submit</button>',
		'</div>',
	].join('');
}

/** Render a single result row, branching on pass / fail / error. */
function renderResultRow(r: TestResult): string {
	if (r.error) {
		return [
			`<div class="test-row test-error">`,
			`<div><strong>#${r.index + 1}</strong> error: ${escHtml(r.error)}</div>`,
			`</div>`,
		].join('');
	}
	const cls = r.passed ? 'test-pass' : 'test-fail';
	const expected = JSON.stringify(r.expected);
	const inputStr = JSON.stringify(r.input);
	const actualLine = r.passed
		? ''
		: `<div>actual: <code>${escHtml(r.actual)}</code></div>`;
	return [
		`<div class="test-row ${cls}">`,
		`<div><strong>#${r.index + 1}</strong> input: <code>${escHtml(inputStr)}</code></div>`,
		`<div>expected: <code>${escHtml(expected)}</code></div>`,
		actualLine,
		`<div class="duration">${r.duration} ms</div>`,
		`</div>`,
	].join('');
}

/** First-appearance-ordered unique language list. */
function uniqueLanguages(solutions: LeetCodeSolution[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const s of solutions) {
		if (!seen.has(s.language)) {
			seen.add(s.language);
			out.push(s.language);
		}
	}
	return out;
}

/**
 * HTML shell — wraps the body, links the stylesheet, declares CSP for inline
 * scripts via a generated nonce. The orchestrator (VSX-60) is responsible for
 * supplying a real `cspSource` from `panel.webview.cspSource`.
 *
 * @param body      - Inner HTML to place inside `<body>`.
 * @param cssUri    - Webview URI for the shared stylesheet.
 * @param cspSource - Webview CSP source token.
 * @returns Complete HTML document string.
 *
 * @example
 * shell('<h1>hi</h1>', uri, panel.webview.cspSource);
 */
function shell(body: string, cssUri: string, cspSource: string): string {
	const linkTag = cssUri ? `<link rel="stylesheet" href="${cssUri}">` : '';
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
${linkTag}
</head>
<body class="popup-body leetcode-preview">
${body}
<script>
(function () {
	const vscode = acquireVsCodeApi();
	const sel = document.getElementById('langSelector');
	const runBtn = document.getElementById('runTestsBtn');
	const submitBtn = document.getElementById('submitBtn');
	const resultsEl = document.getElementById('results');

	function currentLang() { return sel ? sel.value : ''; }

	if (runBtn)    { runBtn.addEventListener('click', () => vscode.postMessage({ command: 'runTests', language: currentLang() })); }
	if (submitBtn) { submitBtn.addEventListener('click', () => vscode.postMessage({ command: 'submit',  language: currentLang() })); }
	if (sel)       { sel.addEventListener('change', () => vscode.postMessage({ command: 'selectLanguage', language: currentLang() })); }

	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.command === 'testResults' && resultsEl) {
			resultsEl.innerHTML = msg.html || '';
		}
	});
})();
</script>
</body>
</html>`;
}
