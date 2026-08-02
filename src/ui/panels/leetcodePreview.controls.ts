import { resolveLangId } from '../../services/language-map.service.js';
import { hasFinalTests, publicCount } from '../../services/leetcode-suite.helpers.js';
import { languagesForType } from '../../services/test-envs/env.registry.js';
import { isMultiFile, PRACTICE_OPTIONS } from '../../types/constants.js';
import type { ChallengePhase, ParsedLeetCode, ProjectCheck } from '../../types/leetcode.types.js';
import { escHtml } from '../../utils/html.helpers.js';

/**
 * Render the sidebar view's return/close control, plus the running-state countdown.
 *
 * `running` gets a right-aligned close `✕` (native `title="close"` tooltip) —
 * clicking it should be gated behind a confirmation, since it discards the run
 * — preceded by a `#challengeTimer` span that seeds `remainingLabel` (already
 * formatted `MM:SS`, or `''` before the first `tick` message arrives) and is
 * then kept live by the webview script's `tick` message listener. When
 * `unlimited` is true (no `practice.timeLimit` set — the clock counts up and
 * never auto-submits) an additional `#challengeNoLimit` "no limit" span is
 * emitted beside the clock; a bounded run omits it entirely. Every other
 * phase gets a left-aligned back arrow and no timer — returning to the picker
 * from an unstarted, solved, or attempted exercise loses nothing, so it needs
 * no confirmation and there is no clock running to show.
 *
 * @param phase          - Current `ChallengeState['phase']` for the open exercise.
 * @param remainingLabel - Pre-formatted `MM:SS` countdown/elapsed text to seed the
 *   `running` header with (from `ChallengeState.deadline`/`startedAt` at render
 *   time), or `''`/omitted before the first `tick` message arrives.
 * @param unlimited      - `true` when this run has no deadline — renders the
 *   `#challengeNoLimit` "no limit" span; ignored outside `running`.
 * @returns HTML for the nav header appropriate to `phase`.
 *
 * @example
 * renderNavHeader('running', '29:58', false); // → bounded: timer only
 * renderNavHeader('running', '00:07', true);  // → unlimited: timer + '#challengeNoLimit'
 */
export function renderNavHeader(phase: ChallengePhase, remainingLabel = '', unlimited = false): string {
	if (phase === 'running') {
		const noLimitSpan = unlimited
			? '<span id="challengeNoLimit" class="nav-nolimit">no limit</span>'
			: '';
		return [
			'<div class="nav-header nav-header-right">',
			`<span id="challengeTimer" class="nav-timer">${escHtml(remainingLabel)}</span>`,
			noLimitSpan,
			'<button id="closeBtn" class="nav-close" title="close">&#10005;</button>',
			'</div>',
		].join('');
	}
	return [
		'<div class="nav-header nav-header-left">',
		'<button id="backBtn" class="nav-back" title="Back to exercises">&#8249;</button>',
		'</div>',
	].join('');
}

/**
 * Render the pre-start language chooser.
 *
 * The dropdown is a *choice*, so it appears only when the exercise offers more
 * than one runnable language. With exactly one, there is nothing to choose —
 * the run defaults to it, and a {@link renderLanguageMarker hidden marker}
 * carries the id so the webview still knows the language without showing an
 * empty-looking selector. With none, an explanatory hint replaces it.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the chooser, a hidden marker, or a hint.
 *
 * @example
 * renderLanguageRow(parsed); // 2+ langs → '<div class="lang-select-row">…</div>'
 */
export function renderLanguageRow(p: ParsedLeetCode): string {
	const langs = availableLanguages(p);
	if (langs.length === 0) {
		return `<div class="hint">No test environment for <code>${escHtml(p.test.type)}</code> in any language this exercise provides.</div>`;
	}
	if (langs.length === 1) {
		return renderLanguageMarker(langs[0]);
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
 * Render the hidden `#langSelector` marker — the language, with no visible
 * chooser. Used once the language is fixed rather than chosen: a running
 * challenge (locked to the language Solve It started), or a single-language
 * exercise (no choice to offer). The webview reads `#langSelector.value` for
 * both block-filtering and its Solve It payload, so this keeps that wiring
 * working without presenting options.
 *
 * @param langId - The canonical language to lock in, or `''` when unknown.
 * @returns A hidden `<input>` carrying the language, or `''` when there is none.
 *
 * @example
 * renderLanguageMarker('rust'); // → '<input type="hidden" id="langSelector" value="rust">'
 */
export function renderLanguageMarker(langId: string): string {
	if (langId === '') { return ''; }
	return `<input type="hidden" id="langSelector" value="${escHtml(langId)}">`;
}

/**
 * Render the test-count line: `2 public tests · 3 final tests`.
 *
 * Final cases are counted but never shown — a solver may know how many hidden
 * cases will grade them without learning what those cases are. An artifact
 * without a `## Final Tests` section reads simply `2 tests`.
 *
 * A **project** is graded by `checks:`, not by `## Tests`, so it gets one line
 * per check instead. Reading the function suite told a build-only exercise it
 * had `0 tests`, and hid a second check that gated the solver's Submit.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the counts line(s).
 *
 * @example
 * renderTestCounts(parsed); // → '<div class="tests-count">2 public tests · 3 final tests</div>'
 * @example
 * renderTestCounts(project); // → '…>app builds (build) · pass/fail on exit status</div>'
 */
export function renderTestCounts(p: ParsedLeetCode): string {
	const checks = p.checks ?? [];
	if (checks.length > 0) {
		return checks.map(renderCheckCount).join('');
	}

	const pub = publicCount(p);
	if (!hasFinalTests(p)) {
		return `<div class="tests-count">${pub} tests</div>`;
	}
	return `<div class="tests-count">${pub} public tests &middot; ${p.finalTests.length} final tests</div>`;
}

/**
 * One count line for a single declared check: its name, kind, and how it grades.
 *
 * The name is artifact-authored free text, so it goes through `escHtml`; `kind`
 * is a narrowed literal union and needs none.
 *
 * @param check - The declared check.
 * @returns HTML for that check's line.
 *
 * @example
 * renderCheckCount({ name: 'counter', kind: 'dom-assert', cases: c, publicCount: 3, file: 'a.jsx' });
 * // → '<div class="tests-count">counter (dom-assert) · 3 public · 1 hidden</div>'
 */
function renderCheckCount(check: ProjectCheck): string {
	const label = `${escHtml(check.name)} (${check.kind})`;
	return `<div class="tests-count">${label} &middot; ${gradedBy(check)}</div>`;
}

/**
 * How a check decides pass or fail: a public/hidden case split, or an exit
 * status for `build`, which binds no cases at all.
 *
 * @param check - The declared check.
 * @returns Human-readable grading summary; never a case value.
 *
 * @example
 * gradedBy({ kind: 'build', … }); // → 'pass/fail on exit status'
 */
function gradedBy(check: ProjectCheck): string {
	if (check.kind === 'build') { return 'pass/fail on exit status'; }

	const hidden = check.cases.length - check.publicCount;
	const shown = `${check.publicCount} public`;
	return hidden > 0 ? `${shown} &middot; ${hidden} hidden` : shown;
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
 * Render the state-gated challenge controls: language selector, practice
 * settings, and the action buttons appropriate to `state`.
 *
 * Supersedes always rendering `renderActions` + `renderPracticeControls`
 * together — the panel now shows exactly the controls that make sense for the
 * current lifecycle phase, so a solver never sees a Submit button before
 * Solve It has opened an attempt, nor practice-mode checkboxes once the clock
 * is already running.
 *
 * | Phase | Visible | Hidden |
 * |---|---|---|
 * | `idle` / `attempted` | language **chooser** (2+ langs), practice settings, Solve It | Run Tests, Submit |
 * | `running` | Run Tests, Submit (language is **fixed**, marker only) | language chooser, practice settings, Solve It |
 * | `solved` | language **chooser** (retry), `.solved-summary`, Solve It (retry) | Run Tests, Submit, practice settings |
 *
 * The language chooser is a *pre-start* control: it appears only where the
 * next action is Solve It (`idle`/`attempted`/`solved`), and only when there
 * is more than one runnable language to choose between. Once `running`, the
 * language is locked to what Solve It started — the chooser is gone and a
 * hidden marker carries `activeLangId` so Run Tests / Submit and block-filtering
 * stay bound to that one language, never a value the user could change mid-run.
 *
 * `attempted` renders identically to `idle` — a failed Submit already ended
 * the challenge and lifted every restriction, so the solver lands back on the
 * same pre-challenge screen (see `docs/plans/3-button-state.md`).
 *
 * @param state       - Current `ChallengeState['phase']`.
 * @param p           - Parsed LeetCode artifact.
 * @param activeLangId - The language the live run is locked to; used only by
 *   `running` to seed the hidden marker. Ignored in other phases.
 * @returns HTML for the controls block appropriate to `state`.
 *
 * @example
 * renderControls('running', parsed, 'rust'); // → Run Tests + Submit, hidden 'rust' marker
 */
export function renderControls(state: ChallengePhase, p: ParsedLeetCode, activeLangId = ''): string {
	if (state === 'running') { return renderRunningControls(p, activeLangId); }
	if (state === 'solved')  { return renderSolvedControls(p); }
	return renderIdleControls(p);
}

/**
 * Render the pre-challenge controls: language select, practice settings, and
 * a solo Solve It button. Shared by the `idle` and `attempted` phases — a
 * finished-but-failed run has nothing left to gate, so it is indistinguishable
 * from never having started one.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the idle/attempted controls block.
 *
 * @example
 * renderIdleControls(parsed);
 */
function renderIdleControls(p: ParsedLeetCode): string {
	const runnable = availableLanguages(p).length > 0;
	const disabledAttr = runnable ? '' : ' disabled';
	return [
		renderLanguageRow(p),
		renderPracticeControls(p),
		'<div class="actions">',
		`<button id="solveBtn" class="btn btn-insert"${disabledAttr}>Solve It</button>`,
		'</div>',
	].join('\n');
}

/**
 * Render the in-challenge controls: Run Tests and Submit, with the language
 * fixed. The chooser, practice settings, and Solve It are all gone — the run
 * is live, so there is nothing to configure, nothing to start again, and no
 * language to re-pick. A hidden marker carries the locked language so the
 * webview's block-filter and payloads stay bound to it; Run Tests / Submit
 * themselves read the language authoritatively from the live session, so the
 * marker is a UI convenience, never the source of truth.
 *
 * @param p           - Parsed LeetCode artifact.
 * @param activeLangId - The language this run is locked to (`''` falls back to
 *   the exercise's sole runnable language, if any).
 * @returns HTML for the running controls block.
 *
 * @example
 * renderRunningControls(parsed, 'rust');
 */
function renderRunningControls(p: ParsedLeetCode, activeLangId: string): string {
	const locked = activeLangId || (availableLanguages(p)[0] ?? '');
	return [
		renderLanguageMarker(locked),
		'<div class="actions">',
		'<button id="runTestsBtn" class="btn btn-secondary">Run Tests</button>',
		'<button id="submitBtn" class="btn btn-secondary">Submit</button>',
		'</div>',
	].join('\n');
}

/**
 * Render the post-Submit success screen: a `.solved-summary` recap plus a
 * Solve It button that starts a fresh retry attempt.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the solved controls block.
 *
 * @example
 * renderSolvedControls(parsed);
 */
function renderSolvedControls(p: ParsedLeetCode): string {
	return [
		renderLanguageRow(p),
		renderSolvedSummary(p),
		'<div class="actions">',
		'<button id="solveBtn" class="btn btn-insert">Solve It</button>',
		'</div>',
	].join('\n');
}

/**
 * Render the `.solved-summary` recap shown after an all-green Submit: a
 * solved badge plus the best known elapsed time for this problem, when the
 * artifact recorded one.
 *
 * The Big-O estimate called for in the plan's summary sketch has no backing
 * field on `ParsedLeetCode` yet (that lands with the Big-O heuristic plan) —
 * DDD says a concept earns markup only once it has a named type, so this
 * renders exactly the two facts the domain model can currently support.
 *
 * @param p - Parsed LeetCode artifact.
 * @returns HTML for the summary block.
 *
 * @example
 * renderSolvedSummary(parsed); // → '<div class="solved-summary">…</div>'
 */
function renderSolvedSummary(p: ParsedLeetCode): string {
	const timed = p.solutions.find(s => s.duration);
	const timeLine = timed
		? `<span class="summary-time">Time: ${escHtml(timed.duration ?? '')}</span>`
		: '';
	return [
		'<div class="solved-summary">',
		'<span class="badge status-solved">Solved</span>',
		timeLine,
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
	// A multi-file type the registry has no env for (`service`) is still
	// *attemptable*: Solve It writes its `## Files` tree and opens the tabs, and
	// the language only labels them. Gating it on the registry left the solver
	// staring at an exercise they could not open. Grading is a separate
	// question and stays the registry's — a `service` Run Tests / Submit is
	// refused by `resolveRunSetup`, so nothing can report green.
	const gateOnRegistry = supported.size > 0 || !isMultiFile(p.test.type);
	const seen = new Set<string>();
	const out: string[] = [];

	const declared = [...p.setups.map(s => s.language), ...p.solutions.map(s => s.language)];
	for (const raw of declared) {
		const langId = resolveLangId(raw);
		if (seen.has(langId) || (gateOnRegistry && !supported.has(langId))) { continue; }
		seen.add(langId);
		out.push(langId);
	}
	return out;
}
