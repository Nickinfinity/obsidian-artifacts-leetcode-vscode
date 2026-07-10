import { resolveLangId } from '../../services/language-map.service.js';
import type {
	ParsedLeetCode,
	TestResult,
} from '../../types/leetcode.types.js';
import { escHtml } from '../../utils/html.helpers.js';
import {
	renderActions,
	renderLanguageRow,
	renderPracticeControls,
	renderSetups,
	renderTestCounts,
} from './leetcodePreview.controls.js';

/**
 * Renders the full HTML document for the LeetCode preview panel.
 *
 * The panel is the pre-challenge briefing screen. Layout, top to bottom:
 *   - `<h1>` title
 *   - badges row: difficulty pill, status pill, algorithm tag
 *   - description paragraph
 *   - `## Examples` cards (one per parsed example)
 *   - test-count line (`2 public tests · 3 final tests`)
 *   - language `<select id="langSelector">`, filtered by the env registry
 *   - `# Setup` starter-code blocks
 *   - reference solutions (collapsed behind a `<details>` — spoilers)
 *   - practice-mode checkboxes + time-limit input
 *   - Run Tests / Solve It / Submit
 *   - `<div id="results">` results sink
 *
 * @param parsed      - Fully parsed LeetCode artifact.
 * @param cssUri      - Webview URI for the shared stylesheet.
 * @param cspSource   - Webview CSP source token (passed through into `<meta>`).
 * @param resultsHtml - Results markup to seed the sink with. Reassigning
 *   `webview.html` restarts the webview, so a result table posted immediately
 *   afterwards can land before the listener is attached and be dropped —
 *   seeding it into the document instead removes that race.
 * @returns Complete HTML document string.
 *
 * @example
 * renderLeetCodePreviewHtml(parsed, cssUri, panel.webview.cspSource);
 */
export function renderLeetCodePreviewHtml(
	parsed: ParsedLeetCode, cssUri: string, cspSource: string, resultsHtml = '',
): string {
	const body = [
		`<h1 class="leet-title">${escHtml(parsed.title)}</h1>`,
		renderBadgesRow(parsed),
		renderDescription(parsed),
		renderExamples(parsed),
		renderTestCounts(parsed),
		renderLanguageRow(parsed),
		renderSetups(parsed),
		renderSolutionsSection(parsed),
		renderPracticeControls(parsed),
		renderActions(parsed),
		`<div id="results" class="results-container">${resultsHtml}</div>`,
	].join('\n');

	return shell(body, cssUri, cspSource);
}

/**
 * Renders the per-run test-results fragment (no `<html>` wrapper).
 *
 * Includes a summary banner (`results-summary` with `all-pass` / `has-fail`
 * modifier) plus one row per result tagged `test-pass`, `test-fail`, or
 * `test-error`. Rows carrying `kind: 'final'` have their input masked.
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

/**
 * Render the reference solutions, collapsed behind a `<details>` element.
 *
 * The whole point of the exercise is not to read these first, so they stay shut
 * until the user deliberately opens them.
 */
function renderSolutionsSection(p: ParsedLeetCode): string {
	if (p.solutions.length === 0) { return ''; }

	const blocks = p.solutions.map((s, i) => {
		const labelTxt = s.label ? `${s.label} — ` : '';
		const langId = resolveLangId(s.language);
		return [
			`<div class="solution-block" data-language="${escHtml(langId)}" data-index="${i}">`,
			`<div class="slabel">${escHtml(labelTxt)}${escHtml(langId)}</div>`,
			`<pre class="code"><code>${escHtml(s.code)}</code></pre>`,
			'</div>',
		].join('');
	}).join('\n');

	return [
		'<details class="solutions-details">',
		`<summary>Reference solutions (${p.solutions.length}) — spoilers</summary>`,
		blocks,
		'</details>',
	].join('\n');
}

/**
 * Render a single result row, branching on pass / fail / error.
 *
 * A `final` case never reveals its input or its expected value — only the label
 * `Final #N`, the outcome, and the duration. Otherwise the grading suite would
 * be readable straight off the results table after one deliberate failure.
 */
function renderResultRow(r: TestResult): string {
	const isFinal = r.kind === 'final';
	const label = isFinal ? `Final #${r.index + 1}` : `#${r.index + 1}`;

	if (r.error) {
		return [
			'<div class="test-row test-error">',
			`<div><strong>${label}</strong> error: ${escHtml(r.error)}</div>`,
			'</div>',
		].join('');
	}

	const cls = r.passed ? 'test-pass' : 'test-fail';
	if (isFinal) {
		return [
			`<div class="test-row ${cls}">`,
			`<div><strong>${label}</strong> input: <span class="masked">hidden</span></div>`,
			`<div class="duration">${r.duration} ms</div>`,
			'</div>',
		].join('');
	}

	const expected = JSON.stringify(r.expected);
	const inputStr = JSON.stringify(r.input);
	const actualLine = r.passed
		? ''
		: `<div>actual: <code>${escHtml(r.actual)}</code></div>`;
	return [
		`<div class="test-row ${cls}">`,
		`<div><strong>${label}</strong> input: <code>${escHtml(inputStr)}</code></div>`,
		`<div>expected: <code>${escHtml(expected)}</code></div>`,
		actualLine,
		`<div class="duration">${r.duration} ms</div>`,
		'</div>',
	].join('');
}

/**
 * HTML shell — wraps the body, links the stylesheet, declares CSP for inline
 * scripts.
 *
 * The inline script owns four interactions: hiding every setup/solution block
 * that does not match the selected language, gathering the practice-option
 * checkboxes plus the time limit into the `solveIt` payload, gating the Run
 * Tests button on the `challengeState` message, and swapping in the results
 * HTML the extension posts back.
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
	const runTestsBtn = document.getElementById('runTestsBtn');
	const solveBtn = document.getElementById('solveBtn');
	const submitBtn = document.getElementById('submitBtn');
	const timeLimitEl = document.getElementById('timeLimit');
	const resultsEl = document.getElementById('results');

	function currentLang() { return sel ? sel.value : ''; }

	function selectedOptions() {
		const boxes = document.querySelectorAll('.practice-option:checked');
		return Array.from(boxes).map((b) => b.value);
	}

	function timeLimitMinutes() {
		const raw = timeLimitEl ? parseInt(timeLimitEl.value, 10) : 0;
		return Number.isNaN(raw) || raw < 0 ? 0 : raw;
	}

	// Only the blocks for the active language stay visible.
	function syncVisibleBlocks() {
		const lang = currentLang();
		const blocks = document.querySelectorAll('.setup-block, .solution-block');
		blocks.forEach((el) => {
			const match = !lang || el.dataset.language === lang;
			el.style.display = match ? '' : 'none';
		});
	}

	if (solveBtn) {
		solveBtn.addEventListener('click', () => vscode.postMessage({
			command: 'solveIt',
			language: currentLang(),
			options: selectedOptions(),
			timeLimitMinutes: timeLimitMinutes(),
		}));
	}
	if (runTestsBtn) {
		runTestsBtn.addEventListener('click', () => vscode.postMessage({ command: 'runTests', language: currentLang() }));
	}
	if (submitBtn) {
		submitBtn.addEventListener('click', () => vscode.postMessage({ command: 'submit', language: currentLang() }));
	}
	if (sel) {
		sel.addEventListener('change', () => {
			syncVisibleBlocks();
			vscode.postMessage({ command: 'selectLanguage', language: currentLang() });
		});
	}

	syncVisibleBlocks();

	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.command === 'testResults' && resultsEl) {
			resultsEl.innerHTML = msg.html || '';
		}
		if (msg.command === 'challengeState' && runTestsBtn) {
			runTestsBtn.disabled = !msg.active;
		}
	});
})();
</script>
</body>
</html>`;
}
