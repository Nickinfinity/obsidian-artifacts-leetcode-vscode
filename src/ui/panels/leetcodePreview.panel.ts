import { formatRemaining } from '../../services/leetcode-challenge.helpers.js';
import { resolveLangId } from '../../services/language-map.service.js';
import type {
	BigOEstimate,
	ChallengePhase,
	ParsedLeetCode,
	TestResult,
	TimerTick,
} from '../../types/leetcode.types.js';
import { escHtml } from '../../utils/html.helpers.js';
import {
	renderControls,
	renderNavHeader,
	renderSetups,
	renderTestCounts,
} from './leetcodePreview.controls.js';

/**
 * Renders the full HTML document for the LeetCode preview panel.
 *
 * The panel is the challenge screen — its controls mirror `state`
 * (`ChallengeState['phase']`) rather than staying always-on with `disabled`
 * gating. Layout, top to bottom:
 *   - nav header: back-arrow (idle/solved/attempted) or close-✕ (running),
 *     via `renderNavHeader(state)`
 *   - `<h1>` title
 *   - badges row: difficulty pill, status pill, algorithm tag
 *   - description paragraph
 *   - `## Examples` cards (one per parsed example)
 *   - test-count line (`2 public tests · 3 final tests`)
 *   - `# Setup` starter-code blocks
 *   - reference solutions (collapsed behind a `<details>` — spoilers)
 *   - state-gated controls via `renderControls(state, parsed)` — language
 *     select plus whichever of {practice settings, Solve It, Run Tests,
 *     Submit, `.solved-summary`} belong to `state`
 *   - `<div id="results">` results sink
 *
 * @param parsed      - Fully parsed LeetCode artifact.
 * @param cssUris     - Webview URIs for the stylesheets to link (shared + LeetCode).
 * @param cspSource   - Webview CSP source token (passed through into `<meta>`).
 * @param resultsHtml - Results markup to seed the sink with. Reassigning
 *   `webview.html` restarts the webview, so a result table posted immediately
 *   afterwards can land before the listener is attached and be dropped —
 *   seeding it into the document instead removes that race.
 * @param state       - Current `ChallengeState['phase']`; defaults to `'idle'`
 *   for call sites that have not yet been threaded onto the state machine.
 * @param timer       - Timer state at render time (P4/P7): `{unlimited, ms}`,
 *   or `null` for a non-`running` phase. Seeds the `running` header's
 *   `#challengeTimer` (and, when unlimited, the `#challengeNoLimit` "no
 *   limit" span) so it never renders blank for the ~1s before the first
 *   `tick` message arrives; every tick after that keeps it current via
 *   `postMessage`, never a fresh `webview.html`.
 * @returns Complete HTML document string.
 *
 * @example
 * renderLeetCodePreviewHtml(parsed, cssUris, panel.webview.cspSource, '', 'running', { unlimited: false, ms: 179_000 });
 */
export function renderLeetCodePreviewHtml(
	parsed: ParsedLeetCode, cssUris: string[], cspSource: string, resultsHtml = '',
	state: ChallengePhase = 'idle', timer: TimerTick | null = null,
): string {
	const timerLabel = timer === null ? '' : formatRemaining(timer.ms);
	const unlimited = timer?.unlimited ?? false;
	const body = [
		renderNavHeader(state, timerLabel, unlimited),
		`<h1 class="leet-title">${escHtml(parsed.title)}</h1>`,
		renderBadgesRow(parsed),
		renderDescription(parsed),
		renderExamples(parsed),
		renderTestCounts(parsed),
		renderSetups(parsed),
		renderSolutionsSection(parsed),
		renderControls(state, parsed),
		`<div id="results" class="results-container">${resultsHtml}</div>`,
	].join('\n');

	return shell(body, cssUris, cspSource, state);
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

/**
 * Renders the Big-O heuristic line shown under the results table after
 * Submit — notation, confidence tier, and the one-line `reason` from
 * `estimateBigO`.
 *
 * Always framed as a caveat, never a verdict — `heuristic` and the
 * confidence tier sit right next to the notation so a solver never mistakes
 * a static loop count for a real complexity proof. Reuses the existing
 * `.hint` style rather than adding new CSS — this line is meant to read as
 * exactly that, a hint, not another result row.
 *
 * @param estimate - Result from `estimateBigO`, computed on the submitted buffer.
 * @returns HTML fragment, appended after `renderTestResultsHtml`'s output.
 *
 * @example
 * renderBigOEstimateHtml({ notation: 'O(n^2)', confidence: 'medium', reason: '2 nested loops' });
 */
export function renderBigOEstimateHtml(estimate: BigOEstimate): string {
	return [
		'<div class="bigo-line">',
		`<div><strong>Big-O: ${escHtml(estimate.notation)}</strong> `,
		`<span class="hint">(heuristic &middot; ${escHtml(estimate.confidence)} confidence)</span></div>`,
		`<div class="hint">reason: ${escHtml(estimate.reason)}</div>`,
		'</div>',
	].join('');
}

/**
 * Renders the sidebar view's empty state — shown before any exercise is open.
 *
 * A single "Open exercise" button posts `{ command: 'open' }`, which
 * `LeetCodeViewProvider` handles by running the same picker the view-title
 * button and the `obsidian-leetcode.open` command use.
 *
 * @param cssUris   - Webview URIs for the stylesheets to link.
 * @param cspSource - Webview CSP source token.
 * @returns Complete HTML document string.
 *
 * @example
 * renderLeetCodeEmptyStateHtml(cssUris, view.webview.cspSource);
 */
export function renderLeetCodeEmptyStateHtml(cssUris: string[], cspSource: string): string {
	const linkTag = cssLinks(cssUris);
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
${linkTag}
</head>
<body class="popup-body leetcode-preview">
<div class="empty-state">
<p>No exercise open.</p>
<button id="openBtn" class="btn btn-insert">Open exercise</button>
</div>
<script>
(function () {
	const vscode = acquireVsCodeApi();
	const openBtn = document.getElementById('openBtn');
	if (openBtn) {
		openBtn.addEventListener('click', () => vscode.postMessage({ command: 'open' }));
	}
})();
</script>
</body>
</html>`;
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
 * Render one `<link rel="stylesheet">` per stylesheet URI.
 *
 * URIs come from `webview.asWebviewUri` (trusted), so they are not escaped —
 * consistent with how the rest of the shell treats them. An empty list yields
 * an empty string.
 *
 * @param cssUris - Webview stylesheet URIs, in link order.
 * @returns Newline-joined `<link>` tags, or `''` for an empty list.
 *
 * @example
 * cssLinks([stylesUri, leetcodeUri]); // → '<link …styles.css>\n<link …leetcode-preview.css>'
 */
function cssLinks(cssUris: string[]): string {
	return cssUris.map(uri => `<link rel="stylesheet" href="${uri}">`).join('\n');
}

/**
 * HTML shell — wraps the body, links the stylesheet, declares CSP for inline
 * scripts.
 *
 * The inline script owns seven interactions: hiding every setup/solution
 * block that does not match the selected language, gathering the
 * practice-option checkboxes plus the time limit into the `solveIt` payload,
 * gating the Run Tests button on the `challengeState` message, swapping in
 * the results HTML the extension posts back, stamping `body[data-phase]`
 * from the `viewState` message, writing the `tick { unlimited, ms }` message
 * into `#challengeTimer` and toggling `#challengeNoLimit` (P4/P7) — always
 * via `textContent`/`style.display`, never a `webview.html` reassignment,
 * which would restart the webview and kill the running timer — and
 * scrolling to the top of the pane on initial load when the seeded phase is
 * `running` (P7: Solve It re-renders into `running`, and the solver was
 * likely scrolled down reading the problem). `data-phase` is seeded on the
 * `<body>` tag at render time so that last check needs no message round
 * trip; the `viewState` message keeps it current afterwards for a future
 * in-place transition rather than anything read by a selector today.
 *
 * @param body      - Inner HTML to place inside `<body>`.
 * @param cssUris   - Webview URIs for the stylesheets to link.
 * @param cspSource - Webview CSP source token.
 * @param phase     - `ChallengeState['phase']` this render seeds `data-phase`
 *   with — drives the running-only scroll-to-top on load.
 * @returns Complete HTML document string.
 *
 * @example
 * shell('<h1>hi</h1>', cssUris, panel.webview.cspSource, 'running');
 */
function shell(body: string, cssUris: string[], cspSource: string, phase: ChallengePhase = 'idle'): string {
	const linkTag = cssLinks(cssUris);
	return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline';">
${linkTag}
</head>
<body class="popup-body leetcode-preview" data-phase="${escHtml(phase)}">
${body}
<script>
(function () {
	const vscode = acquireVsCodeApi();
	const sel = document.getElementById('langSelector');
	const runTestsBtn = document.getElementById('runTestsBtn');
	const solveBtn = document.getElementById('solveBtn');
	const submitBtn = document.getElementById('submitBtn');
	const backBtn = document.getElementById('backBtn');
	const closeBtn = document.getElementById('closeBtn');
	const timeLimitEl = document.getElementById('timeLimit');
	const resultsEl = document.getElementById('results');

	function currentLang() { return sel ? sel.value : ''; }

	// Mirrors leetcode-challenge.helpers.ts#formatRemaining — the webview
	// script runs in a separate sandbox from the extension host, so this pure
	// formatter is duplicated rather than imported.
	function formatRemainingLabel(ms) {
		const totalSeconds = Math.ceil(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
	}

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
	if (backBtn) {
		backBtn.addEventListener('click', () => vscode.postMessage({ command: 'back' }));
	}
	if (closeBtn) {
		closeBtn.addEventListener('click', () => vscode.postMessage({ command: 'close' }));
	}
	if (sel) {
		sel.addEventListener('change', () => {
			syncVisibleBlocks();
			vscode.postMessage({ command: 'selectLanguage', language: currentLang() });
		});
	}

	syncVisibleBlocks();

	// P7: Solve It re-renders this pane into 'running'; land at the top since
	// the solver was likely scrolled down reading the problem. Seeded via
	// body[data-phase] at render time. VS Code restores the webview's previous
	// scroll offset *asynchronously* after the html is reassigned, so a single
	// synchronous scroll here is immediately overwritten — force it to the top
	// again after that restore (next frame + on load), not just at parse time.
	if (document.body.dataset.phase === 'running') {
		var forceTop = function () {
			window.scrollTo(0, 0);
			if (document.scrollingElement) { document.scrollingElement.scrollTop = 0; }
		};
		forceTop();
		requestAnimationFrame(function () { forceTop(); requestAnimationFrame(forceTop); });
		window.addEventListener('load', forceTop);
	}

	window.addEventListener('message', (event) => {
		const msg = event.data || {};
		if (msg.command === 'testResults' && resultsEl) {
			resultsEl.innerHTML = msg.html || '';
		}
		if (msg.command === 'challengeState' && runTestsBtn) {
			runTestsBtn.disabled = !msg.active;
		}
		if (msg.command === 'viewState') {
			document.body.dataset.phase = msg.phase || '';
		}
		if (msg.command === 'tick') {
			const timerEl = document.getElementById('challengeTimer');
			if (timerEl) { timerEl.textContent = formatRemainingLabel(msg.ms); }
			const noLimitEl = document.getElementById('challengeNoLimit');
			if (noLimitEl) { noLimitEl.style.display = msg.unlimited ? '' : 'none'; }
		}
	});
})();
</script>
</body>
</html>`;
}
