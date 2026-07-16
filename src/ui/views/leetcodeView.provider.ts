import * as vscode from 'vscode';
import { pickLeetCodeExercise } from '../../commands/leetcode.command.js';
import {
	discardChallenge,
	handleRunTests,
	handleSubmit,
	postChallengeState,
} from '../../commands/leetcode-run.handlers.js';
import { isExerciseEditorOpen } from '../../services/exercise-file.service.js';
import { challengeState, startChallenge } from '../../services/leetcode-challenge.service.js';
import { timerTick } from '../../services/leetcode-challenge.helpers.js';
import { resolveLangId } from '../../services/language-map.service.js';
import type {
	ChallengePhase,
	ParsedLeetCode,
	PracticeConfig,
	PracticeOptionId,
	TimerTick,
} from '../../types/leetcode.types.js';
import {
	renderLeetCodeEmptyStateHtml,
	renderLeetCodePreviewHtml,
} from '../panels/leetcodePreview.panel.js';

/**
 * Per-session state for the exercise currently rendered in the sidebar view.
 *
 * `parsed` is mutated in place when a run changes the artifact's status, so the
 * next `renderLeetCodePreviewHtml` reflects it without re-reading the file.
 * Shared with the run handlers in `leetcode-run.handlers.ts`, which only ever
 * touch `panel.webview` — so `panel` being a `WebviewView` rather than a
 * `WebviewPanel` is transparent to them.
 */
export interface PanelCtx {
	context: vscode.ExtensionContext;
	panel: vscode.WebviewView;
	fileUri: vscode.Uri;
	parsed: ParsedLeetCode;
	cssUri: string;
	/**
	 * URI of the most recent attempt's temp file, or `null` before Solve It.
	 *
	 * Outlives the `ChallengeSession` — a run that has ended (solved/attempted)
	 * or was never started leaves this set so `discardChallenge` can still sweep
	 * up a stale attempt file when Back is pressed while idle.
	 */
	attemptUri: vscode.Uri | null;
}

/** Webview → extension message shapes the provider understands. */
interface WebviewMsg {
	command: 'open' | 'solveIt' | 'runTests' | 'submit' | 'selectLanguage' | 'back' | 'close';
	language?: string;
	options?: string[];
	timeLimitMinutes?: number;
}

/**
 * Drives the `obsidian-leetcode.view` Activity-Bar sidebar view.
 *
 * Owns the single live `WebviewView` plus the current exercise session
 * (`PanelCtx`), and renders one of two screens into it: an empty state with an
 * "Open exercise" button, or the full `renderLeetCodePreviewHtml` detail once a
 * file has been picked. Collapsing the sidebar can dispose and later
 * re-resolve the underlying `WebviewView` — `ctx` outlives that, so
 * `resolveWebviewView` re-renders the same session into the fresh view instead
 * of losing it.
 *
 * A running challenge (temp file, timer, practice-mode restrictions) is owned
 * by `leetcode-challenge.service.ts`, not by this view — collapsing the
 * sidebar must not abandon an in-progress run, so this class never ends a
 * challenge on its own dispose. Only `deactivate()`, the explicit "End
 * LeetCode Challenge" command, or `startChallenge()` superseding a prior run
 * do that.
 *
 * @example
 * const provider = new LeetCodeViewProvider(context, 'LeetCode');
 * context.subscriptions.push(
 *   vscode.window.registerWebviewViewProvider('obsidian-leetcode.view', provider),
 * );
 */
export class LeetCodeViewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;
	private ctx: PanelCtx | undefined;

	/**
	 * @param context - Extension context owning the vault path and temp storage.
	 * @param dir     - Artifact directory name (always `'LeetCode'`).
	 */
	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly dir: string,
	) {
		context.subscriptions.push(
			vscode.window.tabGroups.onDidChangeTabs(() => this.onTabsChanged()),
		);
	}

	/**
	 * VS Code lifecycle hook — called whenever the view needs a webview, which
	 * may be more than once per window (see the class doc on collapse).
	 *
	 * @param webviewView - The view instance to wire up and render into.
	 *
	 * @example
	 * // invoked by VS Code; not called directly
	 * provider.resolveWebviewView(webviewView);
	 */
	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui')],
		};

		webviewView.webview.onDidReceiveMessage((msg: WebviewMsg) => {
			void this.routeMessage(msg);
		});
		webviewView.onDidDispose(() => {
			this.view = undefined;
		});

		if (this.ctx) {
			this.ctx.panel  = webviewView;
			this.ctx.cssUri = this.cssUri();
		}
		this.render();
	}

	/**
	 * Runs the exercise picker and, on a selection, renders the result into the
	 * view.
	 *
	 * The single entry point for "open an exercise" — the `obsidian-leetcode.open`
	 * command (palette and view-title button share it) and the empty state's own
	 * button both call this, so the two triggers can never drift out of sync.
	 *
	 * @returns Resolves once the picker is dismissed or the view has re-rendered.
	 *
	 * @example
	 * await provider.openPicker();
	 */
	async openPicker(): Promise<void> {
		const picked = await pickLeetCodeExercise(this.context, this.dir);
		if (!picked) { return; }
		this.showExercise(picked.fileUri, picked.parsed);
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	/** Build a fresh session for the picked file and render its detail screen. */
	private showExercise(fileUri: vscode.Uri, parsed: ParsedLeetCode): void {
		if (!this.view) { return; }
		this.ctx = {
			context: this.context, panel: this.view, fileUri, parsed,
			cssUri: this.cssUri(), attemptUri: null,
		};
		this.render();
	}

	/** Render the empty state or the current session's detail screen. */
	private render(): void {
		if (!this.view) { return; }
		const cspSource = this.view.webview.cspSource;
		this.view.webview.html = this.ctx
			? renderLeetCodePreviewHtml(
				this.ctx.parsed, this.ctx.cssUri, cspSource, '', this.currentPhase(), this.timerSeed(),
			)
			: renderLeetCodeEmptyStateHtml(this.cssUri(), cspSource);
	}

	/**
	 * Timer state for the live run on the open exercise, or `null` (P7).
	 *
	 * Seeds `renderLeetCodePreviewHtml`'s `timer` param so a running header
	 * re-render (e.g. after a sidebar collapse/reopen) shows the correct clock
	 * immediately rather than blank until the next `tick` message. Delegates to
	 * the same pure `timerTick()` the service's status-bar timer ticks through
	 * — bounded (`ChallengeState.deadline` set) seeds remaining time, unlimited
	 * (`deadline: null`) seeds elapsed time since `startedAt`.
	 *
	 * @returns The current `TimerTick`, or `null` when idle or the live
	 *   session belongs to a different exercise.
	 *
	 * @example
	 * this.timerSeed(); // → { unlimited: false, ms: 179_000 } while a 3-minute run is live
	 */
	private timerSeed(): TimerTick | null {
		if (this.currentPhase() !== 'running') { return null; }
		const state = challengeState();
		if (!state) { return null; }
		if (state.startedAt === null) { return null; }
		return timerTick(state.startedAt, state.deadline, Date.now());
	}

	/**
	 * Lifecycle phase to render the open exercise in.
	 *
	 * The live `ChallengeSession` is authoritative, but only for the exercise it
	 * belongs to — a run in flight for a *different* `.md` must not colour this
	 * view. With no matching live session the view is `idle`: an unstarted
	 * exercise, or one whose run already ended and cleared the session. Reading
	 * the phase here (rather than caching it on `ctx`) is what lets a re-resolve
	 * after a sidebar collapse rebuild the correct screen mid-run.
	 *
	 * @returns The `ChallengePhase` the current `ctx` should render under.
	 *
	 * @example
	 * this.currentPhase(); // → 'running' while this exercise's challenge is live
	 */
	private currentPhase(): ChallengePhase {
		const state = challengeState();
		const openUri = this.ctx?.fileUri.toString();
		if (state && openUri && state.exerciseUri === openUri) {
			return state.phase;
		}
		return 'idle';
	}

	/** Webview URI for the shared stylesheet, scoped to the live view. */
	private cssUri(): string {
		if (!this.view) { return ''; }
		return this.view.webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'src', 'ui', 'styles.css'),
		).toString();
	}

	// ── Message routing ──────────────────────────────────────────────────────

	/** Route a webview message to the appropriate handler. */
	private async routeMessage(msg: WebviewMsg): Promise<void> {
		if (msg.command === 'open') { await this.openPicker(); return; }
		if (!this.ctx) { return; }

		if (msg.command === 'solveIt')             { await this.handleSolveIt(msg); }
		else if (msg.command === 'runTests')       { await handleRunTests(this.ctx, msg.language); }
		else if (msg.command === 'submit')         { await handleSubmit(this.ctx, msg.language); }
		else if (msg.command === 'selectLanguage') { this.handleSelectLanguage(); }
		else if (msg.command === 'back')           { await this.handleBack(); }
		else if (msg.command === 'close')          { await this.handleClose(); }
	}

	/**
	 * Handle a `solveIt` message — open the starter file and arm practice mode.
	 *
	 * The artifact wins over the webview when `practice.locked` is set: a locked
	 * exercise cannot have its restrictions or its clock relaxed by editing the
	 * checkboxes in the panel.
	 *
	 * @param msg - Webview payload carrying the language, options, and time limit.
	 *
	 * @example
	 * await provider.handleSolveIt({ command: 'solveIt', language: 'javascript', options: [], timeLimitMinutes: 30 });
	 */
	private async handleSolveIt(msg: WebviewMsg): Promise<void> {
		if (!this.ctx) { return; }
		if (!msg.language) {
			void vscode.window.showErrorMessage('Pick a language before starting the challenge.');
			return;
		}
		const langId = resolveLangId(msg.language);
		const config = effectivePracticeConfig(this.ctx.parsed, msg);

		// P4: `onTick` mirrors the status-bar countdown into the in-view header
		// via `postMessage`; `onExpire` runs the same Submit path a manual click
		// uses. Both are plain callbacks closing over this provider's own `ctx`
		// and `view` — `leetcode-challenge.service.ts` never imports the run
		// handlers itself, which would cycle back against its own importer.
		const session = await startChallenge(this.context, this.ctx.fileUri, this.ctx.parsed, langId, config, {
			onTick: (tick) => this.postTick(tick),
			onExpire: () => { void this.autoSubmit(langId); },
		});
		this.ctx.attemptUri = session.fileUri;
		postChallengeState(this.ctx, true);
		// Re-render so the controls swap idle → running (Solve It + practice
		// settings out, Run Tests + Submit in). The live session now reports
		// `phase: 'running'` for this exercise, so `currentPhase()` picks it up.
		this.render();
	}

	/**
	 * Post the current tick — bounded remaining or unlimited elapsed (P7) — to
	 * the live webview header timer.
	 *
	 * A `postMessage`, never a `webview.html` reassignment — the latter would
	 * restart the webview and kill the timer mid-run (see P3's notes).
	 *
	 * @param tick - The `TimerTick` from `startChallenge`'s `onTick` hook.
	 *
	 * @example
	 * this.postTick({ unlimited: false, ms: 179_000 });
	 */
	private postTick(tick: TimerTick): void {
		if (!this.view) { return; }
		void this.view.webview.postMessage({ command: 'tick', unlimited: tick.unlimited, ms: tick.ms });
	}

	/**
	 * Timer-expiry action (P4) — grades the live buffer through the exact same
	 * `handleSubmit` a manual Submit click uses, so the P6 attempt history and
	 * the terminal `status` write exactly once regardless of which path fired.
	 *
	 * Re-entrancy against a manual Submit landing at the same instant is
	 * guarded inside `handleSubmit`/`claimSubmission`, not here — this method
	 * is a thin wire from the timer's `onExpire` hook to the existing Submit
	 * path, nothing more.
	 *
	 * @param langId - Canonical language id the expiring session was running in.
	 *
	 * @example
	 * await this.autoSubmit('python');
	 */
	private async autoSubmit(langId: string): Promise<void> {
		if (!this.ctx) { return; }
		await handleSubmit(this.ctx, langId);
	}

	/**
	 * Handle a `selectLanguage` message — no state change today; the webview
	 * already drives the visible blocks. Hook left in place so future iterations
	 * can re-render the view with the chosen language highlighted.
	 */
	private handleSelectLanguage(): void {
		// Intentionally a no-op for now — the webview script handles UI state.
	}

	/**
	 * Handle a `back` message — no confirmation. Discards any stale attempt
	 * (temp file + its editor tab, if either survived a prior run) and returns
	 * to the empty state.
	 *
	 * @example
	 * await provider.routeMessage({ command: 'back' });
	 */
	private async handleBack(): Promise<void> {
		await this.discardCurrentAttempt();
		this.ctx = undefined;
		this.render();
	}

	/**
	 * Handle a `close` message — modal confirmation, then the same discard path
	 * as `back`. Only reachable while a challenge is running (the webview only
	 * renders the close control in that phase).
	 *
	 * @example
	 * await provider.routeMessage({ command: 'close' });
	 */
	private async handleClose(): Promise<void> {
		const choice = await vscode.window.showWarningMessage(
			'End this challenge? Your progress will be discarded.',
			{ modal: true },
			'Close',
		);
		if (choice !== 'Close') { return; }
		await this.discardCurrentAttempt();
		this.ctx = undefined;
		this.render();
	}

	/** Shared discard path for `back` and `close`. */
	private async discardCurrentAttempt(): Promise<void> {
		await discardChallenge(this.ctx?.attemptUri ?? null);
	}

	/**
	 * `vscode.window.tabGroups.onDidChangeTabs` listener — keeps the live
	 * `ChallengeState.editorOpen` flag honest when the attempt tab is closed (or
	 * reopened) behind the challenge's back, and tells the webview.
	 *
	 * A no-op whenever no challenge is running, so this single long-lived
	 * subscription never needs to be torn down and re-created per run.
	 */
	private onTabsChanged(): void {
		const state = challengeState();
		if (!state?.tempFileUri || !this.view) { return; }

		const open = isExerciseEditorOpen(vscode.Uri.parse(state.tempFileUri));
		if (state.editorOpen === open) { return; }
		state.editorOpen = open;
		void this.view.webview.postMessage({ command: 'challengeState', active: true, editorOpen: open });
	}
}

/**
 * Merge the artifact's declared practice config with the webview's selections.
 *
 * `timeLimitMinutes` is guarded with `Number.isFinite` (P7) so an empty
 * input or a stray `NaN` from the webview can never become a bogus deadline
 * — it coerces to `0`, which the timer treats as "unlimited, count up"
 * rather than crashing the countdown math with `NaN` arithmetic.
 *
 * @param parsed - Parsed artifact (source of truth when `practice.locked`).
 * @param msg    - Webview payload.
 * @returns The config the challenge should run under.
 *
 * @example
 * effectivePracticeConfig(parsed, { command: 'solveIt', options: ['noAiAgents'], timeLimitMinutes: 15 });
 */
function effectivePracticeConfig(parsed: ParsedLeetCode, msg: WebviewMsg): PracticeConfig {
	if (parsed.practice.locked) { return parsed.practice; }
	const rawMinutes = msg.timeLimitMinutes;
	const minutes = typeof rawMinutes === 'number' && Number.isFinite(rawMinutes) ? rawMinutes : 0;
	return {
		options: (msg.options ?? []) as PracticeOptionId[],
		timeLimitMinutes: Math.max(0, minutes),
		locked: false,
	};
}
