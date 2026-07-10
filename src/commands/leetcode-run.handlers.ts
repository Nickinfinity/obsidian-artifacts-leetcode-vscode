import * as vscode from 'vscode';
import { activeChallenge, endChallenge } from '../services/leetcode-challenge.service.js';
import { buildExecutable, escapeRe } from '../services/leetcode-candidate.helpers.js';
import { detectRuntime, runSuite } from '../services/leetcode-runner.service.js';
import {
	publicCount,
	publicSuite,
	submitSuite,
	tagSuiteKinds,
} from '../services/leetcode-suite.helpers.js';
import { patchFrontmatterField } from '../services/frontmatter-patcher.service.js';
import { resolveLangId } from '../services/language-map.service.js';
import { testEnvFor } from '../services/test-envs/env.registry.js';
import type { TestEnv } from '../services/test-envs/env.types.js';
import { javaRunner }   from '../services/lang-runners/java.runner.js';
import { jsRunner }     from '../services/lang-runners/javascript.runner.js';
import { pythonRunner } from '../services/lang-runners/python.runner.js';
import { renderLeetCodePreviewHtml, renderTestResultsHtml } from '../ui/panels/leetcodePreview.panel.js';
import type { LangRunner, LeetCodeStatus, TestResult } from '../types/leetcode.types.js';
import type { PanelCtx } from './leetcode.command.js';

/** Markdown fence delimiter — kept as a constant so regexes can stay `String.raw`. */
const FENCE = '```';

/** Lookup table of language id → built-in runner config. */
const RUNNERS: Record<string, LangRunner> = {
	java:       javaRunner,
	javascript: jsRunner,
	python:     pythonRunner,
};

/**
 * Handle a `runTests` message — grade the **public** suite, change nothing.
 *
 * Deliberately not a variant of `handleSubmit`. Run Tests is the mid-challenge
 * feedback loop: it never writes frontmatter, never stops the clock, never
 * lifts the editor restrictions, and never touches the hidden final suite.
 *
 * There is no stored-solution fallback either — Run Tests grades the live
 * buffer or nothing. Without a live challenge the button renders `disabled`;
 * this guard exists because webview state drifts when the panel is disposed or
 * the challenge is ended from the command palette.
 *
 * @param ctx      - Panel session state.
 * @param language - Language chosen in the panel.
 *
 * @example
 * await handleRunTests(ctx, 'javascript');
 */
export async function handleRunTests(ctx: PanelCtx, language: string | undefined): Promise<void> {
	const setup = resolveRunSetup(ctx, language);
	if (!setup) { return; }
	const { langId, runner, env } = setup;

	const session = activeChallenge();
	if (session?.langId !== langId) {
		void vscode.window.showWarningMessage('Start the challenge with "Solve It" first.');
		return;
	}

	const code = await liveBuffer(session.fileUri);
	if (!await runtimeReady(runner, env)) { return; }

	const cases   = publicSuite(ctx.parsed);
	const source  = buildExecutable(ctx.parsed, langId, code);
	const results = tagSuiteKinds(await runSuite(source, cases, ctx.parsed, env), cases.length);
	postResults(ctx, results);

	if (results.length > 0 && results.every(r => r.passed)) {
		void vscode.window.showInformationMessage('All public tests pass — Submit when ready.');
	}
}

/**
 * Handle a `submit` message — grade public **and** final cases; one shot.
 *
 * The candidate source is the live text of the temp exercise file when a
 * challenge is running in this language, falling back to the artifact's stored
 * solution otherwise, so Submit still works when the panel is opened purely to
 * check in a solution already written into the `.md`.
 *
 * Outcomes:
 * - all pass → `status: solved`, meta comment, challenge ends
 * - any fail **during a live challenge** → `status: attempted`, challenge ends
 * - any fail with **no live challenge** → results only; a dry run against a
 *   stored solution must never downgrade a solved artifact
 *
 * @param ctx      - Panel session state.
 * @param language - Language chosen in the panel.
 *
 * @example
 * await handleSubmit(ctx, 'python');
 */
export async function handleSubmit(ctx: PanelCtx, language: string | undefined): Promise<void> {
	const setup = resolveRunSetup(ctx, language);
	if (!setup) { return; }
	const { langId, runner, env } = setup;

	const code = await candidateSource(ctx, langId);
	if (code === null) {
		void vscode.window.showErrorMessage(`No ${langId} attempt found. Press "Solve It" first.`);
		return;
	}
	if (!await runtimeReady(runner, env)) { return; }

	// Captured before the run: finishSolved / finishAttempted null the session.
	const wasLive = activeChallenge()?.langId === langId;

	const source  = buildExecutable(ctx.parsed, langId, code);
	const results = tagSuiteKinds(
		await runSuite(source, submitSuite(ctx.parsed), ctx.parsed, env),
		publicCount(ctx.parsed),
	);
	const html = renderTestResultsHtml(results);

	const allPassed = results.length > 0 && results.every(r => r.passed);
	if (allPassed)      { await finishChallenge(ctx, langId, html, 'solved'); }
	else if (wasLive)   { await finishChallenge(ctx, langId, html, 'attempted'); }
	else                { postResults(ctx, results); }
}

// ── Preflight ─────────────────────────────────────────────────────────────────

/** Everything a run needs, once the language has been validated. */
interface RunSetup { langId: string; runner: LangRunner; env: TestEnv }

/**
 * Resolve the language to a `(runner, env)` pair, reporting why if impossible.
 *
 * A missing env means the artifact's `test.type` has no implementation for this
 * language — which the panel already prevents by filtering the selector, so
 * reaching the toast means the webview state drifted.
 *
 * @param ctx      - Panel session state.
 * @param language - Language chosen in the panel.
 * @returns The resolved setup, or `null` after showing an error.
 *
 * @example
 * resolveRunSetup(ctx, 'java');
 */
function resolveRunSetup(ctx: PanelCtx, language: string | undefined): RunSetup | null {
	if (!language) { return null; }
	const langId = resolveLangId(language);

	const runner = RUNNERS[langId];
	if (!runner) {
		void vscode.window.showErrorMessage(`Unsupported language: ${langId}.`);
		return null;
	}

	const env = testEnvFor(ctx.parsed.test.type, langId);
	if (!env) {
		void vscode.window.showErrorMessage(
			`No ${ctx.parsed.test.type} test environment for ${langId}.`,
		);
		return null;
	}
	return { langId, runner, env };
}

/**
 * Confirm the toolchain is installed, and the env's own dependency when it
 * declares one.
 *
 * @param runner - Language runner to probe via `detectCmd`.
 * @param env    - Env whose optional `detect()` gates in addition.
 * @returns True when the suite can actually be executed.
 *
 * @example
 * await runtimeReady(pythonRunner, pythonFunctionEnv);
 */
async function runtimeReady(runner: LangRunner, env: TestEnv): Promise<boolean> {
	if (!await detectRuntime(runner)) {
		void vscode.window.showErrorMessage(`Runtime not found. Install ${runner.displayName} to run tests.`);
		return false;
	}
	if (env.detect && !await env.detect()) {
		void vscode.window.showErrorMessage(
			`Missing test dependency for ${env.language}: ${(env.requires ?? []).join(', ')}.`,
		);
		return false;
	}
	return true;
}

// ── Candidate source ──────────────────────────────────────────────────────────

/** Read a document's live text — unsaved edits included — else its bytes on disk. */
async function liveBuffer(fileUri: vscode.Uri): Promise<string> {
	const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === fileUri.toString());
	if (open) { return open.getText(); }
	const bytes = await vscode.workspace.fs.readFile(fileUri);
	return new TextDecoder().decode(bytes);
}

/**
 * The source to test: the live attempt buffer, else a stored solution.
 *
 * @param ctx    - Panel session state.
 * @param langId - Canonical language id.
 * @returns Candidate source, or `null` when nothing is available.
 *
 * @example
 * await candidateSource(ctx, 'javascript');
 */
async function candidateSource(ctx: PanelCtx, langId: string): Promise<string | null> {
	const session = activeChallenge();
	if (session?.langId === langId) { return liveBuffer(session.fileUri); }

	const stored = ctx.parsed.solutions.find(s => resolveLangId(s.language) === langId);
	return stored ? stored.code : null;
}

// ── Finishing a challenge ─────────────────────────────────────────────────────

/**
 * End the run, persist the outcome, and re-render the panel with its results.
 *
 * The results HTML is seeded into the fresh document rather than posted after
 * it: reassigning `webview.html` restarts the webview, and a `postMessage` into
 * one that is still booting can be dropped.
 *
 * @param ctx      - Panel session state.
 * @param langId   - Canonical language id — locates the fence for the meta comment.
 * @param html     - Rendered results table.
 * @param status   - Terminal status to write into the artifact's frontmatter.
 *
 * @example
 * await finishChallenge(ctx, 'python', html, 'solved');
 */
async function finishChallenge(
	ctx: PanelCtx, langId: string, html: string, status: LeetCodeStatus,
): Promise<void> {
	const session = activeChallenge();
	const duration = session?.timer.isRunning() ? session.timer.stop() : null;

	await endChallenge();
	postChallengeState(ctx, false);

	if (status === 'solved') { await persistSolved(ctx.fileUri, langId, duration); }
	else                     { await persistStatus(ctx.fileUri, status); }

	ctx.parsed.status = status;
	ctx.panel.webview.html = renderLeetCodePreviewHtml(
		ctx.parsed, ctx.cssUri, ctx.panel.webview.cspSource, html,
	);
}

/**
 * Write a `status:` value into the artifact's frontmatter.
 *
 * @param fileUri - Path to the `.md` artifact.
 * @param status  - New status.
 *
 * @example
 * await persistStatus(fileUri, 'attempted');
 */
async function persistStatus(fileUri: vscode.Uri, status: LeetCodeStatus): Promise<void> {
	const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));
	const next = patchFrontmatterField(raw, 'status', status);
	await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(next));
}

/**
 * Persist `status: solved` plus the `<!-- meta: … -->` duration comment.
 *
 * The comment is inserted immediately before the first fenced code block for
 * `language`; an artifact with no such fence simply gets the status update.
 *
 * @param fileUri  - Path to the `.md` artifact.
 * @param language - Language id whose solution receives the meta comment.
 * @param duration - `XmYs` timer result, or `null` when no challenge was timed.
 *
 * @example
 * await persistSolved(fileUri, 'python', '3m12s');
 */
async function persistSolved(
	fileUri: vscode.Uri, language: string, duration: string | null,
): Promise<void> {
	const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri));
	let next = patchFrontmatterField(raw, 'status', 'solved');

	if (duration) {
		const meta = `<!-- meta: { "solved_at": "${new Date().toISOString()}", "duration": "${duration}" } -->`;
		const fenceRe = new RegExp(String.raw`(^|\n)(${FENCE}${escapeRe(language)}\r?\n)`);
		const m = fenceRe.exec(next);
		if (m) {
			const insertAt = m.index + m[1].length;
			next = `${next.slice(0, insertAt)}${meta}\n${next.slice(insertAt)}`;
		}
	}

	await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(next));
}

// ── Webview messaging ─────────────────────────────────────────────────────────

/** Post a rendered results table into the panel's results sink. */
export function postResults(ctx: PanelCtx, results: TestResult[]): void {
	void ctx.panel.webview.postMessage({
		command: 'testResults',
		html:    renderTestResultsHtml(results),
	});
}

/** Tell the webview whether a challenge is live, so it can gate the Run Tests button. */
export function postChallengeState(ctx: PanelCtx, active: boolean): void {
	void ctx.panel.webview.postMessage({ command: 'challengeState', active });
}
