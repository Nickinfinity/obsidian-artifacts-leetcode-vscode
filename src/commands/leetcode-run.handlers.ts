import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { activeChallenge, type ChallengeSession, claimSubmission, endChallenge, releaseSubmission } from '../services/leetcode-challenge.service.js';
import { buildExecutable, escapeRe } from '../services/leetcode-candidate.helpers.js';
import { projectGradeRefusal } from './leetcode-run.helpers.js';
import {
	finishChallenge,
	postChallengeState,
	postResults,
	postResultsHtml,
	postViewState,
	readArtifactContent,
} from './leetcode-run.finish.js';
import { closeExerciseEditor, deleteExerciseFile } from '../services/exercise-file.service.js';
import { discardProjectAttempt, saveProjectDocuments } from '../services/project-file.service.js';
import { gradeProjectDir, runProjectChecks } from '../services/test-envs/project/project.runner.js';
import { detectRuntime, runSuite } from '../services/leetcode-runner.service.js';
import {
	publicCount,
	publicSuite,
	submitSuite,
	tagSuiteKinds,
} from '../services/leetcode-suite.helpers.js';
import { patchFrontmatterField } from '../services/frontmatter-patcher.service.js';
import { resolveLangId } from '../services/language-map.service.js';
import { functionNameFor } from '../services/leetcode-parser.service.js';
import { estimateBigO } from '../services/leetcode-bigo.service.js';
import { appendAttempt } from '../services/attempts-writer.service.js';
import { isBatchEnv, testEnvFor } from '../services/test-envs/env.registry.js';
import { entryFileFor } from '../services/test-envs/program/make-program-env.js';
import { isProgramSuite, programLanguageOf, runProgramSuite } from '../services/test-envs/program/program.runner.js';
import { resolveContained } from '../services/test-envs/project/files.writer.js';
import type { TestEnv } from '../services/test-envs/env.types.js';
import {
	renderBigOEstimateHtml,
	renderLeetCodePreviewHtml,
	renderProjectResultsHtml,
	renderTestResultsHtml,
} from '../ui/panels/leetcodePreview.panel.js';
import { FENCE, isMultiFile } from '../types/constants.js';
import { isLangId, LANGUAGES, type LanguageConfig } from '../types/languages.js';
import type { AttemptEntry, BigOEstimate, ChallengePhase, LeetCodeStatus, ProjectCheckOutcome, TestResult } from '../types/leetcode.types.js';
import type { PanelCtx } from '../ui/views/leetcodeView.provider.js';

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
 * The language is taken from the **live session**, not the webview: the panel
 * shows no language chooser mid-run, so the language is whatever Solve It
 * started, and grading must bind to the buffer that is actually open.
 *
 * @param ctx - Panel session state.
 *
 * @example
 * await handleRunTests(ctx);
 */
export async function handleRunTests(ctx: PanelCtx): Promise<void> {
	const session = activeChallenge();
	if (!session) {
		void vscode.window.showWarningMessage('Start the challenge with "Solve It" first.');
		return;
	}

	// Shape-driven, not `test.type === 'project'`: the wave-1.E migration
	// deletes the `type:` line from every check-graded artifact's `test:`
	// block (D14), so a migrated artifact's `test.type` collapses to the
	// default and that string comparison goes false on the very files the
	// migration just wrote. `isMultiFile` reads the leetcode-type axis
	// instead, which the migration never touches.
	//
	// `isMultiFile` alone would dispatch *every* multi-file artifact into
	// directory grading unconditionally — a `service` run also carries a
	// `projectDir`, and grading one whose `http` checks were dropped at parse
	// time as unimplemented would report its surviving `build` check green
	// and call an ungraded exercise solved. `projectRunAllowed` (backed by
	// `projectGradeRefusal`) is consulted before anything is written or run,
	// so that artifact is refused by name instead (S3).
	if (session.projectDir && isMultiFile(ctx.parsed.leetcodeType)) {
		await runTestsForTree(ctx, session);
		return;
	}

	const setup = resolveRunSetup(ctx, session.langId);
	if (!setup) { return; }
	const { langId, lang, env } = setup;

	const code = await liveBuffer(session.fileUri);
	if (!await runtimeReady(lang, env)) { return; }

	const cases   = publicSuite(ctx.parsed);
	const source  = buildExecutable(ctx.parsed, langId, code);
	const results = tagSuiteKinds(await runSuite(source, cases, ctx.parsed, env), cases.length);
	postResults(ctx, results);

	if (results.length > 0 && results.every(r => r.passed)) {
		void vscode.window.showInformationMessage('All public tests pass — Submit when ready.');
	}
}

/**
 * Run Tests for a **multi-file** artifact — the public half, writing nothing.
 *
 * A tree is graded one of two ways and the artifact decides which: by its
 * declared `checks:`, or — with no checks and a `program:` block — as a single
 * suite of cases run against the built program (P5). Before this split a
 * `package` + `program` artifact was graded against an **empty** check list, so
 * it produced no outcome at all and could never be solved.
 *
 * Extracted from `handleRunTests` to keep that function under the cognitive
 * complexity limit — the two branches are one decision, not a chain.
 *
 * @param ctx     - Panel session state.
 * @param session - The live challenge, whose `projectDir` holds the tree.
 *
 * @example
 * await runTestsForTree(ctx, activeChallenge()!);
 */
async function runTestsForTree(ctx: PanelCtx, session: ChallengeSession): Promise<void> {
	if (!session.projectDir) { return; }
	if (!await projectRunAllowed(ctx)) { return; }

	const suite = await gradeLiveProgramSuite(ctx, session.projectDir, { publicOnly: true });
	if (suite.kind === 'aborted') { return; }
	if (suite.kind === 'graded') {
		postResults(ctx, suite.results);
		announceIfAllPass(suite.results.length > 0 && suite.results.every(r => r.passed), 'tests');
		return;
	}

	const outcomes = await gradeLiveProject(ctx, session.projectDir, { publicOnly: true });
	postResultsHtml(ctx, renderProjectResultsHtml(outcomes));
	announceIfAllPass(outcomes.length > 0 && outcomes.every(o => o.passed), 'checks');
}

/** The one "everything green, Submit when ready" toast, so the two tree paths cannot word it differently. */
function announceIfAllPass(allPassed: boolean, noun: 'tests' | 'checks'): void {
	if (allPassed) {
		void vscode.window.showInformationMessage(`All public ${noun} pass — Submit when ready.`);
	}
}

/**
 * Grade a live `program`-suite tree, or report that this artifact is not one.
 *
 * "Is this a program suite?" is answered by the artifact, not by a label: it
 * declares a `program:` block and **no** `checks:`. The two are mutually
 * exclusive by the D14 mirror rule, so there is no artifact both branches
 * could claim.
 *
 * Saves first, exactly as `gradeLiveProject` does and for the same reason: the
 * program is built from **files on disk**, so an unsaved buffer would grade the
 * previous version of what the solver is typing.
 *
 * @param ctx     - Panel session state.
 * @param dir     - The run's project directory.
 * @param options - `publicOnly` for the mid-challenge Run Tests loop.
 * @returns `notProgram` when the artifact is check-graded, `aborted` when the
 *   run could not start (already reported), else the graded results.
 *
 * @example
 * await gradeLiveProgramSuite(ctx, session.projectDir, { publicOnly: true });
 */
async function gradeLiveProgramSuite(
	ctx: PanelCtx, dir: vscode.Uri, options: { publicOnly?: boolean },
): Promise<ProgramSuiteRun> {
	const program = ctx.parsed.program;
	if (!isProgramSuite(ctx.parsed) || !program) { return { kind: 'notProgram' }; }

	const langId = programLanguageOf(ctx.parsed);
	if (!langId) {
		const declared = ctx.parsed.files?.[0]?.language ?? '(none)';
		void vscode.window.showErrorMessage(`Unsupported language for a program exercise: ${declared}.`);
		return { kind: 'aborted' };
	}

	const env = testEnvFor('program', langId, ctx.parsed.leetcodeType);
	if (!env || isBatchEnv(env)) {
		void vscode.window.showErrorMessage(`No program test environment for ${langId}.`);
		return { kind: 'aborted' };
	}
	if (!await runtimeReady(LANGUAGES[langId], null)) { return { kind: 'aborted' }; }

	await saveProjectDocuments(dir);
	const cases = options.publicOnly ? publicSuite(ctx.parsed) : submitSuite(ctx.parsed);

	try {
		// `resolveContained` **before** the read, not after. `emit` will contain
		// this same path again on its way into an argv element, but reading it
		// first with a raw join would let artifact text choose a host file to
		// open — the parser's shape guard is the belt, and this is the braces
		// it is explicitly documented as needing.
		const entry = resolveContained(dir.fsPath, entryFileFor(program, langId));
		const code = await fs.readFile(entry, 'utf-8');

		const results = await runProgramSuite({
			code, tests: cases, parsed: ctx.parsed, env, program, runDir: dir.fsPath,
		});
		return {
			kind: 'graded',
			results: tagSuiteKinds(results, options.publicOnly ? cases.length : publicCount(ctx.parsed)),
		};
	} catch (e) {
		// A refused path or an unreadable entry is the run failing to start, not
		// a wrong answer — report it and let the caller leave the challenge
		// exactly as it was.
		void vscode.window.showErrorMessage(
			`Could not read the program entry: ${e instanceof Error ? e.message : String(e)}`,
		);
		return { kind: 'aborted' };
	}
}

/**
 * What a live program-suite grading attempt produced.
 *
 * Three outcomes, deliberately not two: an empty result array used to mean
 * both "graded nothing" and "never started", so a **missing runtime** was
 * persisted as a failed attempt — the artifact downgraded to `attempted` and
 * an empty attempt recorded because Java was not installed. The buffer path
 * has always done the opposite (release the claim, write nothing), and this
 * type is what lets the tree path agree with it.
 */
type ProgramSuiteRun =
	| { kind: 'notProgram' }
	| { kind: 'aborted' }
	| { kind: 'graded'; results: TestResult[] };

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
 * Re-entrancy: when a live challenge backs this call, the session is claimed
 * via `claimSubmission` before any `await` runs (see that function's doc) —
 * this is what stops the timer's auto-submit (P4) and a manual click landing
 * in the same instant from grading and persisting the same run twice. A claim
 * that loses the race returns silently: the winning call is already carrying
 * this exact Submit through to completion.
 *
 * @param ctx      - Panel session state.
 * @param language - Language chosen in the panel.
 *
 * @example
 * await handleSubmit(ctx, 'python');
 */
export async function handleSubmit(ctx: PanelCtx, language: string | undefined): Promise<void> {
	// Claimed synchronously, before any `await` below — see the re-entrancy
	// note above. `liveSession` (not a fresh `activeChallenge()` call) is what
	// `wasLive` and `finishChallenge` both key off for the rest of this run.
	const liveSession = activeChallenge();

	// Shape-driven, not `test.type === 'project'` — see the matching comment
	// on the Run Tests dispatch above; the same D14/S3 reasoning applies here.
	if (isMultiFile(ctx.parsed.leetcodeType)) {
		await submitProject(ctx, liveSession);
		return;
	}
	// A live run's language is authoritative — the panel offers no chooser
	// mid-run, and there is only ever one session, so it is this exercise's.
	// `language` (the webview's marker/choice) is the fallback for a dry-run
	// Submit with no live challenge.
	const setup = resolveRunSetup(ctx, liveSession?.langId ?? language);
	if (!setup) { return; }
	const { langId, lang, env } = setup;

	const wasLive = liveSession !== null;
	if (wasLive && liveSession && !claimSubmission(liveSession)) { return; }

	const code = await candidateSource(ctx, langId);
	if (code === null) {
		void vscode.window.showErrorMessage(`No ${langId} attempt found. Press "Solve It" first.`);
		return;
	}
	if (!await runtimeReady(lang, env)) {
		// This attempt never reaches `finishChallenge` — release the claim so a
		// later retry (manual, after installing the runtime) is not blocked
		// forever by a session stuck mid-claim.
		if (wasLive && liveSession) { releaseSubmission(liveSession); }
		return;
	}

	const source  = buildExecutable(ctx.parsed, langId, code);
	const results = tagSuiteKinds(
		await runSuite(source, submitSuite(ctx.parsed), ctx.parsed, env),
		publicCount(ctx.parsed),
	);
	// Heuristic, not a verdict — computed once per Submit from the same buffer
	// that was graded, never from Run Tests. See leetcode-bigo.service.ts.
	const bigO = estimateBigO(code, langId, functionNameFor(ctx.parsed, langId));
	const html = renderTestResultsHtml(results) + renderBigOEstimateHtml(bigO);

	const allPassed = results.length > 0 && results.every(r => r.passed);
	const args = { ctx, langId, html, wasLive, code, bigO };
	if (allPassed)      { await finishChallenge({ ...args, status: 'solved' }); }
	else if (wasLive)   { await finishChallenge({ ...args, status: 'attempted' }); }
	else                { postResultsHtml(ctx, html); }
}

// ── project: grade a directory, not a buffer ─────────────────────────────────

/**
 * Grade the solver's live project tree.
 *
 * Saves first: a project's checks bundle and execute **files on disk**, unlike
 * the function types, which read the live buffer straight out of the editor. A
 * missing save would silently grade the previous version of whatever is being
 * typed.
 *
 * @param ctx     - Panel session state.
 * @param dir     - The run's project directory.
 * @param options - `publicOnly` for the mid-challenge Run Tests loop.
 * @returns One outcome per declared check.
 *
 * @example
 * await gradeLiveProject(ctx, session.projectDir, { publicOnly: true });
 */
async function gradeLiveProject(
	ctx: PanelCtx, dir: vscode.Uri, options: { publicOnly?: boolean },
): Promise<ProjectCheckOutcome[]> {
	await saveProjectDocuments(dir);
	return gradeProjectDir(ctx.parsed, dir.fsPath, options);
}

/**
 * Read the artifact fresh and ask whether this directory-graded run may
 * proceed (`projectGradeRefusal`), surfacing the reason as an error toast
 * when it may not.
 *
 * Re-reads from disk rather than trusting `ctx.parsed`: the panel parses the
 * `.md` once at file-open time and never refreshes it, so `ctx.parsed.checks`
 * alone cannot answer whether the artifact declares a check kind nothing
 * implements — the whole point `projectGradeRefusal`'s R2 half exists for.
 *
 * @param ctx - Panel session state.
 * @returns True when the run may proceed; false after showing the refusal.
 *
 * @example
 * if (!await projectRunAllowed(ctx)) { return; }
 */
async function projectRunAllowed(ctx: PanelCtx): Promise<boolean> {
	const raw = await readArtifactContent(ctx.fileUri);
	const refusal = projectGradeRefusal(raw, ctx.parsed);
	if (refusal) {
		void vscode.window.showErrorMessage(refusal);
		return false;
	}
	return true;
}

/**
 * Submit a `project` exercise — every check, public **and** hidden.
 *
 * Mirrors the function-type Submit's outcomes (solved / attempted / dry run
 * writes nothing) but grades a directory. A dry-run Submit with no live
 * challenge grades the **reference** tree, which is the only tree that exists
 * when nobody has pressed Solve It — the artifact's own `# Solutions` overlays,
 * exactly what `verify-exercise.mjs` grades.
 *
 * No Big-O line: the heuristic reads one candidate function, and a project is a
 * component tree. Reporting a complexity for it would be noise dressed as
 * analysis.
 *
 * @param ctx         - Panel session state.
 * @param liveSession - The in-flight session, or `null` for a dry run.
 *
 * @example
 * await submitProject(ctx, activeChallenge());
 */
async function submitProject(ctx: PanelCtx, liveSession: ChallengeSession | null): Promise<void> {
	if (!await projectRunAllowed(ctx)) { return; }

	const wasLive = liveSession !== null && liveSession.projectDir !== null;
	if (wasLive && liveSession && !claimSubmission(liveSession)) { return; }

	// A `program`-suite tree submits as a **suite**, public + final, exactly
	// like a buffer exercise — it has cases, not checks. Run Tests already
	// takes this branch; Submit has to as well, or an artifact could pass every
	// public case and still be unsolvable.
	if (liveSession?.projectDir) {
		const suite = await gradeLiveProgramSuite(ctx, liveSession.projectDir, {});
		if (suite.kind === 'aborted') {
			// Never reaches `finishChallenge`, so release the claim or a later
			// retry — after installing the runtime — is blocked forever by a
			// session stuck mid-claim. Exactly what the buffer path does.
			if (wasLive && liveSession) { releaseSubmission(liveSession); }
			return;
		}
		if (suite.kind === 'graded') {
			await finishProgramSubmit(ctx, suite.results, wasLive);
			return;
		}
	}

	const outcomes = liveSession?.projectDir
		? await gradeLiveProject(ctx, liveSession.projectDir, {})
		: await runProjectChecks(ctx.parsed, { withSolutions: true });

	const html = renderProjectResultsHtml(outcomes);
	const allPassed = outcomes.length > 0 && outcomes.every(o => o.passed);
	const args = { ctx, langId: ctx.parsed.files?.[0]?.language ?? 'javascript', html, wasLive, code: '', bigO: null };

	if (allPassed)    { await finishChallenge({ ...args, status: 'solved' }); }
	else if (wasLive) { await finishChallenge({ ...args, status: 'attempted' }); }
	else              { postResultsHtml(ctx, html); }
}

/**
 * Finish a `program`-suite Submit: same three outcomes as every other Submit.
 *
 * No Big-O, for the reason `submitProject` gives — the heuristic reads one
 * candidate function, and a program is an entry point plus whatever tree it
 * ships.
 *
 * @param ctx     - Panel session state.
 * @param results - Public + final results for the whole suite.
 * @param wasLive - Whether a live challenge backed this Submit.
 *
 * @example
 * await finishProgramSubmit(ctx, results, true);
 */
async function finishProgramSubmit(ctx: PanelCtx, results: TestResult[], wasLive: boolean): Promise<void> {
	const html = renderTestResultsHtml(results);
	const allPassed = results.length > 0 && results.every(r => r.passed);
	// The **canonical** language, not the raw declared string: `finishChallenge`
	// writes the `## <Language>` attempt heading and matches a fence with it, so
	// an artifact declaring `js` would otherwise file its attempt under `js` and
	// miss its own solution fence.
	const langId = programLanguageOf(ctx.parsed) ?? 'javascript';
	const args = { ctx, langId, html, wasLive, code: '', bigO: null };

	if (allPassed)    { await finishChallenge({ ...args, status: 'solved' }); }
	else if (wasLive) { await finishChallenge({ ...args, status: 'attempted' }); }
	else              { postResultsHtml(ctx, html); }
}

/**
 * Discard the run tied to `tempFileUri`: end the challenge, close its editor
 * tab, and delete its temp file.
 *
 * Backs the sidebar view's Back (idle) and Close (running, after confirmation)
 * controls — both roads lead here, since Back-while-idle must also sweep up a
 * stale attempt file left by an already-finished run. `null` when the exercise
 * has no attempt yet — nothing to discard.
 *
 * @param tempFileUri - URI of the attempt temp file to discard, or `null`.
 *
 * @example
 * await discardChallenge(ctx.attemptUri);
 */
export async function discardChallenge(tempFileUri: vscode.Uri | null): Promise<void> {
	// Read before ending: `endChallenge` clears the session, and a project run's
	// directory is the only handle on the rest of its tree.
	const projectDir = activeChallenge()?.projectDir ?? null;
	await endChallenge();

	if (projectDir) {
		await discardProjectAttempt(projectDir);
		return;
	}
	if (!tempFileUri) { return; }
	await closeExerciseEditor(tempFileUri);
	await deleteExerciseFile(tempFileUri);
}

// ── Preflight ─────────────────────────────────────────────────────────────────

/** Everything a run needs, once the language has been validated. */
interface RunSetup { langId: string; lang: LanguageConfig; env: TestEnv }

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

	if (!isLangId(langId)) {
		void vscode.window.showErrorMessage(`Unsupported language: ${langId}.`);
		return null;
	}
	const lang = LANGUAGES[langId];

	const env = testEnvFor(ctx.parsed.test.type, langId, ctx.parsed.leetcodeType);
	if (!env) {
		void vscode.window.showErrorMessage(
			`No ${ctx.parsed.test.type} test environment for ${langId}.`,
		);
		return null;
	}
	// This is the **buffer** door: `runSuite` runs one process for the whole
	// suite. A per-case env (`program`) is graded through `runProgramSuite`
	// against a run directory instead, and reaching here with one would mean a
	// buffer-shaped artifact resolved a tree-shaped env — which the registry
	// already prevents (`program` declares `leetcodeTypes: ['package']`, and a
	// `package` never takes this path). Narrowed rather than cast, so a future
	// registration cannot walk into `runSuite` unnoticed.
	if (!isBatchEnv(env)) {
		void vscode.window.showErrorMessage(
			`The ${ctx.parsed.test.type} test type grades a project directory, not a single buffer.`,
		);
		return null;
	}
	return { langId, lang, env };
}

/**
 * Confirm the toolchain is installed, and the env's own dependency when it
 * declares one.
 *
 * @param lang - Language config to probe via its `detectCmd`.
 * @param env  - Env whose optional `detect()` gates in addition.
 * @returns True when the suite can actually be executed.
 *
 * @example
 * await runtimeReady(LANGUAGES.python, pythonFunctionEnv);
 */
async function runtimeReady(lang: LanguageConfig, env: TestEnv | null): Promise<boolean> {
	if (!await detectRuntime(lang.detectCmd)) {
		void vscode.window.showErrorMessage(`Runtime not found. Install ${lang.displayName} to run tests.`);
		return false;
	}
	// `null` for a `program` env: version gating is a `TestEnv` affordance
	// (`requires`/`detect`) that the per-case envs do not have, so there is
	// nothing beyond the toolchain probe above to ask.
	if (env?.detect && !await env.detect()) {
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
