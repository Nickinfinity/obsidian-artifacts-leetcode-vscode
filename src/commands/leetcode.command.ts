import * as vscode from 'vscode';
import { parseLeetCode } from '../services/leetcode-parser.service.js';
import {
	generateBoilerplate,
	injectSolution,
} from '../services/leetcode-codegen.service.js';
import {
	detectRuntime,
	runAllTests,
} from '../services/leetcode-runner.service.js';
import {
	activeChallenge,
	endChallenge,
	startChallenge,
} from '../services/leetcode-challenge.service.js';
import { resolveLangId } from '../services/language-map.service.js';
import {
	renderLeetCodePreviewHtml,
	renderTestResultsHtml,
} from '../ui/panels/leetcodePreview.panel.js';
import { patchFrontmatterField } from '../services/frontmatter-patcher.service.js';
import { javaRunner }   from '../services/lang-runners/java.runner.js';
import { jsRunner }     from '../services/lang-runners/javascript.runner.js';
import { pythonRunner } from '../services/lang-runners/python.runner.js';
import { validateObsidianVault } from '../services/vault.service.js';
import { getVaultPath } from '../services/vault-path.store.js';
import { SOLUTION_MARKER } from '../types/constants.js';
import type {
	LangRunner,
	ParsedLeetCode,
	PracticeConfig,
	PracticeOptionId,
} from '../types/leetcode.types.js';

/** Markdown fence delimiter — kept as a constant so regexes can stay `String.raw`. */
const FENCE = '```';

/** Lookup table of language id → built-in runner config. */
const RUNNERS: Record<string, LangRunner> = {
	java:       javaRunner,
	javascript: jsRunner,
	python:     pythonRunner,
};

/**
 * Opens the LeetCode picker rooted at the `LeetCode/` artifact directory.
 *
 * Lists `.md` files via a QuickPick. On selection the file is parsed via
 * `parseLeetCode` and a dedicated webview panel is opened to drive the
 * Solve-It / Submit flow.
 *
 * @param context      - Extension context owning the vault path and temp storage.
 * @param dir          - Artifact directory name (always `'LeetCode'`).
 * @param _name        - Display name (unused; kept for signature parity with `openArtifactPicker`).
 * @param extensionUri - Extension root URI — used to scope webview resource access.
 * @returns Resolves once the picker is dismissed or a panel is opened.
 *
 * @example
 * openLeetCodePicker(context, 'LeetCode', 'LeetCode', context.extensionUri);
 */
export async function openLeetCodePicker(
	context: vscode.ExtensionContext, dir: string, _name: string, extensionUri: vscode.Uri,
): Promise<void> {
	const vaultPath = getVaultPath(context);
	if (!vaultPath || !validateObsidianVault(vaultPath)) {
		void vscode.window.showErrorMessage('Obsidian vault is not configured.');
		return;
	}

	const rootUri = vscode.Uri.joinPath(vscode.Uri.file(vaultPath), dir);
	const file = await pickLeetCodeFile(rootUri);
	if (!file) { return; }

	const bytes = await vscode.workspace.fs.readFile(file);
	const content = new TextDecoder().decode(bytes);
	const parsed = parseLeetCode(content);

	openLeetCodePreviewPanel(context, file, parsed, extensionUri);
}

/**
 * Walks `rootUri` (one level deep) and lets the user pick a `.md` file.
 *
 * @param rootUri - Folder URI to enumerate.
 * @returns Selected file URI, or `null` when the picker is dismissed.
 *
 * @example
 * await pickLeetCodeFile(vscode.Uri.file('/vault/LeetCode'));
 */
async function pickLeetCodeFile(rootUri: vscode.Uri): Promise<vscode.Uri | null> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(rootUri);
	} catch {
		void vscode.window.showErrorMessage('LeetCode directory is missing from the vault.');
		return null;
	}

	const items = entries
		.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
		.map(([name]) => ({
			label:  `$(beaker) ${name.replace(/\.md$/, '')}`,
			fileName: name,
		}));
	if (items.length === 0) {
		void vscode.window.showInformationMessage('No LeetCode artifacts found.');
		return null;
	}

	const pick = await vscode.window.showQuickPick(items, {
		title: 'LeetCode artifacts',
		placeHolder: 'Pick a problem',
	});
	if (!pick) { return null; }
	return vscode.Uri.joinPath(rootUri, pick.fileName);
}

/**
 * Creates and wires up a LeetCode-specific webview panel for an artifact.
 *
 * The panel hosts the rendered HTML from `renderLeetCodePreviewHtml` and routes
 * incoming `solveIt` / `submit` / `selectLanguage` messages. Disposing the
 * panel ends any challenge it started, so editor restrictions never outlive the
 * window that imposed them.
 *
 * @param context      - Extension context owning `globalStorageUri`.
 * @param fileUri      - Path to the `.md` artifact (used for frontmatter patches).
 * @param parsed       - Parsed artifact returned by `parseLeetCode`.
 * @param extensionUri - Extension root URI for webview resource scoping.
 *
 * @example
 * openLeetCodePreviewPanel(ctx, uri, parsed, ctx.extensionUri);
 */
function openLeetCodePreviewPanel(
	context: vscode.ExtensionContext,
	fileUri: vscode.Uri,
	parsed: ParsedLeetCode,
	extensionUri: vscode.Uri,
): void {
	const panel = vscode.window.createWebviewPanel(
		'obsidianArtifactLeetCodePreview',
		`LeetCode: ${parsed.title}`,
		vscode.ViewColumn.Beside,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'ui')],
		},
	);

	const cssUri = panel.webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, 'src', 'ui', 'styles.css'),
	).toString();

	const ctx: SessionCtx = { context, panel, fileUri, parsed, cssUri };

	panel.webview.html = renderLeetCodePreviewHtml(parsed, cssUri, panel.webview.cspSource);

	panel.webview.onDidReceiveMessage((msg: WebviewMsg) => {
		void routeMessage(ctx, msg);
	});

	panel.onDidDispose(() => {
		void endChallenge();
	});
}

/** Per-panel session state passed to every message handler. */
interface SessionCtx {
	context: vscode.ExtensionContext;
	panel: vscode.WebviewPanel;
	fileUri: vscode.Uri;
	parsed: ParsedLeetCode;
	cssUri: string;
}

/** Webview → extension message shapes the orchestrator understands. */
interface WebviewMsg {
	command: 'solveIt' | 'submit' | 'selectLanguage';
	language?: string;
	options?: string[];
	timeLimitMinutes?: number;
}

/** Route a webview message to the appropriate handler. */
async function routeMessage(ctx: SessionCtx, msg: WebviewMsg): Promise<void> {
	if (msg.command === 'solveIt')             { await handleSolveIt(ctx, msg); }
	else if (msg.command === 'submit')         { await handleSubmit(ctx, msg.language); }
	else if (msg.command === 'selectLanguage') { handleSelectLanguage(ctx, msg.language); }
}

// ── Solve It ──────────────────────────────────────────────────────────────────

/**
 * Handle a "solveIt" message — open the starter file and arm practice mode.
 *
 * The artifact wins over the webview when `practice.locked` is set: a locked
 * exercise cannot have its restrictions or its clock relaxed by editing the
 * checkboxes in the panel.
 *
 * @param ctx - Panel session state.
 * @param msg - Webview payload carrying the language, options, and time limit.
 *
 * @example
 * await handleSolveIt(ctx, { command: 'solveIt', language: 'javascript', options: [], timeLimitMinutes: 30 });
 */
async function handleSolveIt(ctx: SessionCtx, msg: WebviewMsg): Promise<void> {
	if (!msg.language) {
		void vscode.window.showErrorMessage('Pick a language before starting the challenge.');
		return;
	}
	const langId = resolveLangId(msg.language);
	const config = effectivePracticeConfig(ctx.parsed, msg);

	await startChallenge(ctx.context, ctx.parsed, langId, config);
}

/**
 * Merge the artifact's declared practice config with the webview's selections.
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
	return {
		options: (msg.options ?? []) as PracticeOptionId[],
		timeLimitMinutes: Math.max(0, msg.timeLimitMinutes ?? 0),
		locked: false,
	};
}

// ── Submit ────────────────────────────────────────────────────────────────────

/**
 * Handle a "submit" message — run every test case against the user's attempt.
 *
 * The candidate source is the live text of the temp exercise file when a
 * challenge is running in this language (unsaved edits included), falling back
 * to the artifact's stored solution otherwise — so Submit still works when the
 * panel is opened purely to check in a solution already written into the `.md`.
 *
 * @param ctx      - Panel session state.
 * @param language - Language id chosen in the panel.
 *
 * @example
 * await handleSubmit(ctx, 'python');
 */
async function handleSubmit(ctx: SessionCtx, language: string | undefined): Promise<void> {
	if (!language) { return; }
	const langId = resolveLangId(language);

	const runner = RUNNERS[langId];
	if (!runner) {
		void vscode.window.showErrorMessage(`Unsupported language: ${langId}.`);
		return;
	}

	const code = await candidateSource(ctx, langId);
	if (code === null) {
		void vscode.window.showErrorMessage(`No ${langId} attempt found. Press "Solve It" first.`);
		return;
	}

	const available = await detectRuntime(runner);
	if (!available) {
		void vscode.window.showErrorMessage(`Runtime not found. Install ${runner.displayName} to run tests.`);
		return;
	}

	const source  = buildExecutable(ctx.parsed, langId, code);
	const results = await runAllTests(source, ctx.parsed.tests, runner, ctx.parsed);
	postResults(ctx, results);

	const allPassed = results.length > 0 && results.every(r => r.passed);
	if (!allPassed) { return; }

	await finishSolved(ctx, langId);
	postResults(ctx, results);
}

/**
 * The source text to test: the live attempt buffer, else a stored solution.
 *
 * @param ctx    - Panel session state.
 * @param langId - Canonical language id.
 * @returns Candidate source, or `null` when nothing is available.
 *
 * @example
 * await candidateSource(ctx, 'javascript');
 */
async function candidateSource(ctx: SessionCtx, langId: string): Promise<string | null> {
	const session = activeChallenge();
	if (session?.langId === langId) {
		const open = vscode.workspace.textDocuments
			.find(d => d.uri.toString() === session.fileUri.toString());
		if (open) { return open.getText(); }
		const bytes = await vscode.workspace.fs.readFile(session.fileUri);
		return new TextDecoder().decode(bytes);
	}

	const stored = ctx.parsed.solutions.find(s => resolveLangId(s.language) === langId);
	return stored ? stored.code : null;
}

/**
 * Build the executable source for a run.
 *
 * Source that already carries the `<<SOLUTION>>` marker is treated as a
 * complete Layer-3 override file. Source that is a whole file in its own right
 * (a `# Setup` stub the user filled in — it declares its own function) is used
 * verbatim and the harness is appended around it by the runner. Anything else
 * is a bare function body and gets wrapped in generated boilerplate.
 *
 * @param parsed - Parsed artifact.
 * @param langId - Canonical language id.
 * @param code   - Candidate source.
 * @returns Full source text ready to compile/run.
 *
 * @example
 * buildExecutable(parsed, 'python', 'def two_sum(nums, target): return [0, 1]');
 */
function buildExecutable(parsed: ParsedLeetCode, langId: string, code: string): string {
	if (code.includes(SOLUTION_MARKER)) { return injectSolution(code, ''); }

	const declaresFunction = new RegExp(String.raw`\b${escapeRe(parsed.functionName)}\s*\(`).test(code);
	if (declaresFunction) { return code; }

	return injectSolution(generateBoilerplate(parsed, langId), code);
}

/** Escape a string for literal use inside a RegExp. */
function escapeRe(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Post results back into the webview's results sink. */
function postResults(ctx: SessionCtx, results: Awaited<ReturnType<typeof runAllTests>>): void {
	void ctx.panel.webview.postMessage({
		command: 'testResults',
		html:    renderTestResultsHtml(results),
	});
}

/**
 * Stop the clock, persist `status: solved`, restore the editor, re-render.
 *
 * @param ctx    - Panel session state.
 * @param langId - Canonical language id whose solution receives the meta comment.
 *
 * @example
 * await finishSolved(ctx, 'python');
 */
async function finishSolved(ctx: SessionCtx, langId: string): Promise<void> {
	const session = activeChallenge();
	let duration: string | null = null;
	if (session?.timer.isRunning()) { duration = session.timer.stop(); }

	await endChallenge();
	await persistSolved(ctx.fileUri, langId, duration);

	ctx.parsed.status = 'solved';
	ctx.panel.webview.html = renderLeetCodePreviewHtml(
		ctx.parsed, ctx.cssUri, ctx.panel.webview.cspSource,
	);
}

/**
 * Persist the "solved" status and optional duration metadata into the `.md`
 * file.
 *
 * Writes `status: solved` into the frontmatter via `patchFrontmatterField`.
 * When `duration` is supplied, inserts a `<!-- meta: { … } -->` comment
 * immediately before the first fenced code block for `language`.
 *
 * @param fileUri  - Path to the `.md` artifact.
 * @param language - Language id whose solution should receive the meta comment.
 * @param duration - Optional `XmYs` formatted timer result.
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

/**
 * Handle a "selectLanguage" message — no state change today; the webview
 * already drives the visible blocks. Hook left in place so future iterations
 * can re-render the panel with the chosen language highlighted.
 */
function handleSelectLanguage(_ctx: SessionCtx, _language: string | undefined): void {
	// Intentionally a no-op for now — the webview script handles UI state.
}
