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
import { LeetCodeTimer } from '../services/leetcode-timer.service.js';
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
import type {
	LangRunner,
	LeetCodeSolution,
	ParsedLeetCode,
	TestCase,
} from '../types/leetcode.types.js';

/** Lookup table of language id → built-in runner config. */
const RUNNERS: Record<string, LangRunner> = {
	java:       javaRunner,
	javascript: jsRunner,
	python:     pythonRunner,
};

/** Marker the codegen wrapper places where injected user code should go. */
const SOLUTION_MARKER = '<<SOLUTION>>';

/** First-cut runs only execute this many test cases for fast iteration. */
const PARTIAL_RUN_COUNT = 3;

/**
 * Opens the LeetCode picker rooted at the `LeetCode/` artifact directory.
 *
 * Lists `.md` files via a QuickPick. On selection the file is parsed via
 * `parseLeetCode` and a dedicated webview panel is opened to drive the
 * Run-Tests / Submit flow.
 *
 * @param context      - Extension context owning the per-machine vault path.
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

	openLeetCodePreviewPanel(file, parsed, extensionUri);
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
 * The panel hosts the rendered HTML from `renderLeetCodePreviewHtml` and
 * routes incoming `runTests` / `submit` / `selectLanguage` messages to the
 * runner pipeline. A fresh `LeetCodeTimer` is bound to the panel's lifetime.
 *
 * @param fileUri      - Path to the `.md` artifact (used for frontmatter patches).
 * @param parsed       - Parsed artifact returned by `parseLeetCode`.
 * @param extensionUri - Extension root URI for webview resource scoping.
 *
 * @example
 * openLeetCodePreviewPanel(uri, parsed, ctx.extensionUri);
 */
function openLeetCodePreviewPanel(
	fileUri: vscode.Uri, parsed: ParsedLeetCode, extensionUri: vscode.Uri,
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

	const ctx: SessionCtx = {
		panel,
		fileUri,
		parsed,
		timer: new LeetCodeTimer(),
		cssUri,
	};

	panel.webview.html = renderLeetCodePreviewHtml(parsed, cssUri, panel.webview.cspSource);

	panel.webview.onDidReceiveMessage((msg: WebviewMsg) => {
		void routeMessage(ctx, msg);
	});

	panel.onDidDispose(() => {
		ctx.timer.reset();
	});
}

/** Per-panel session state passed to every message handler. */
interface SessionCtx {
	panel: vscode.WebviewPanel;
	fileUri: vscode.Uri;
	parsed: ParsedLeetCode;
	timer: LeetCodeTimer;
	cssUri: string;
}

/** Webview → extension message shapes the orchestrator understands. */
interface WebviewMsg {
	command: 'runTests' | 'submit' | 'selectLanguage';
	language?: string;
}

/** Route a webview message to the appropriate handler. */
async function routeMessage(ctx: SessionCtx, msg: WebviewMsg): Promise<void> {
	if (msg.command === 'runTests')       { await handleRunTests(ctx, msg.language); }
	else if (msg.command === 'submit')    { await handleSubmit(ctx, msg.language); }
	else if (msg.command === 'selectLanguage') { handleSelectLanguage(ctx, msg.language); }
}

/** Look up a runner config by language id, surfacing an error if unknown. */
function runnerFor(language: string | undefined): LangRunner | null {
	if (!language) { return null; }
	return RUNNERS[language] ?? null;
}

/**
 * Locate the active solution for `language` on the parsed artifact.
 *
 * Always picks the first matching `LeetCodeSolution` — labels are not used to
 * disambiguate in this initial wiring; the UI can be extended later.
 */
function activeSolution(parsed: ParsedLeetCode, language: string): LeetCodeSolution | undefined {
	return parsed.solutions.find(s => s.language === language);
}

/**
 * Build the executable source for a single run.
 *
 * The artifact may carry a Layer-3 override solution whose code is treated as
 * a complete file (no boilerplate wrapping). Otherwise the codegen wrapper is
 * generated and the solution body is injected at the `<<SOLUTION>>` marker.
 *
 * @param parsed   - Parsed artifact.
 * @param language - Target language id.
 * @param solution - The solution block the user picked.
 * @returns Full source text ready to compile/run.
 *
 * @example
 * buildExecutable(parsed, 'python', solution);
 */
function buildExecutable(parsed: ParsedLeetCode, language: string, solution: LeetCodeSolution): string {
	const looksLikeFullFile = solution.code.includes(SOLUTION_MARKER) ||
		/^\s*(import |package |class |def |function |const |let |var )/m.test(solution.code);
	if (looksLikeFullFile && solution.code.includes(SOLUTION_MARKER)) {
		// Code already contains the marker — treat as override boilerplate.
		return injectSolution(solution.code, '');
	}
	const boilerplate = generateBoilerplate(parsed, language);
	return injectSolution(boilerplate, solution.code);
}

/** Common Run/Submit pipeline — returns the result set or null on a setup error. */
async function execute(
	ctx: SessionCtx, language: string | undefined, runAll: boolean,
): Promise<{ results: Awaited<ReturnType<typeof runAllTests>>; solution: LeetCodeSolution } | null> {
	const runner = runnerFor(language);
	if (!runner || !language) {
		void vscode.window.showErrorMessage(`Unsupported language: ${language ?? 'unknown'}.`);
		return null;
	}
	const solution = activeSolution(ctx.parsed, language);
	if (!solution) {
		void vscode.window.showErrorMessage(`No ${language} solution found on this artifact.`);
		return null;
	}
	const available = await detectRuntime(runner);
	if (!available) {
		void vscode.window.showErrorMessage(`Runtime not found. Install ${runner.displayName} to run tests.`);
		return null;
	}

	const source = buildExecutable(ctx.parsed, language, solution);
	const cases: TestCase[] = runAll ? ctx.parsed.tests : ctx.parsed.tests.slice(0, PARTIAL_RUN_COUNT);
	const results = await runAllTests(source, cases, runner, ctx.parsed);
	return { results, solution };
}

/** Post results back into the webview's results sink. */
function postResults(ctx: SessionCtx, results: Awaited<ReturnType<typeof runAllTests>>): void {
	void ctx.panel.webview.postMessage({
		command: 'testResults',
		html:    renderTestResultsHtml(results),
	});
}

/** Handle a "runTests" message — partial run (first N cases). */
async function handleRunTests(ctx: SessionCtx, language: string | undefined): Promise<void> {
	if (!ctx.timer.isRunning()) { ctx.timer.start(); }
	const out = await execute(ctx, language, /* runAll */ false);
	if (out) { postResults(ctx, out.results); }
}

/** Handle a "submit" message — full run + status patch on green. */
async function handleSubmit(ctx: SessionCtx, language: string | undefined): Promise<void> {
	const out = await execute(ctx, language, /* runAll */ true);
	if (!out) { return; }
	postResults(ctx, out.results);

	const allPassed = out.results.length > 0 && out.results.every(r => r.passed);
	if (!allPassed) { return; }

	let duration: string | null = null;
	if (ctx.timer.isRunning()) { duration = ctx.timer.stop(); }
	await persistSolved(ctx.fileUri, language ?? '', duration);

	ctx.parsed.status = 'solved';
	ctx.panel.webview.html = renderLeetCodePreviewHtml(
		ctx.parsed, ctx.cssUri, ctx.panel.webview.cspSource,
	);
	postResults(ctx, out.results);
}

/**
 * Persist the "solved" status and optional duration metadata into the `.md`
 * file.
 *
 * Writes `status: solved` into the frontmatter via
 * `patchFrontmatterField`. When `duration` is supplied, inserts a
 * `<!-- meta: { … } -->` comment immediately before the first fenced code
 * block for `language`.
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
		const fenceRe = new RegExp(`(^|\\n)(\`\`\`${language}\\r?\\n)`);
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
 * already drives the visible solution. Hook left in place so future iterations
 * can re-render the panel with the chosen language highlighted.
 */
function handleSelectLanguage(_ctx: SessionCtx, _language: string | undefined): void {
	// Intentionally a no-op for now — the webview script handles UI state.
}
