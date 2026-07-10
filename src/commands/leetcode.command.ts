import * as vscode from 'vscode';
import { parseLeetCode } from '../services/leetcode-parser.service.js';
import { endChallenge, startChallenge } from '../services/leetcode-challenge.service.js';
import { resolveLangId } from '../services/language-map.service.js';
import { renderLeetCodePreviewHtml } from '../ui/panels/leetcodePreview.panel.js';
import { validateObsidianVault } from '../services/vault.service.js';
import { getVaultPath } from '../services/vault-path.store.js';
import type {
	ParsedLeetCode,
	PracticeConfig,
	PracticeOptionId,
} from '../types/leetcode.types.js';
import {
	handleRunTests,
	handleSubmit,
	postChallengeState,
} from './leetcode-run.handlers.js';

/**
 * Per-panel session state shared with the run handlers.
 *
 * `parsed` is mutated in place when a run changes the artifact's status, so the
 * next `renderLeetCodePreviewHtml` reflects it without re-reading the file.
 */
export interface PanelCtx {
	context: vscode.ExtensionContext;
	panel: vscode.WebviewPanel;
	fileUri: vscode.Uri;
	parsed: ParsedLeetCode;
	cssUri: string;
}

/** Webview → extension message shapes the orchestrator understands. */
interface WebviewMsg {
	command: 'solveIt' | 'runTests' | 'submit' | 'selectLanguage';
	language?: string;
	options?: string[];
	timeLimitMinutes?: number;
}

/**
 * Opens the LeetCode picker rooted at the `LeetCode/` artifact directory.
 *
 * Lists `.md` files via a QuickPick. On selection the file is parsed via
 * `parseLeetCode` and a dedicated webview panel is opened to drive the
 * Solve-It / Run-Tests / Submit flow.
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
 * Disposing the panel ends any challenge it started, so editor restrictions
 * never outlive the window that imposed them.
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

	const ctx: PanelCtx = { context, panel, fileUri, parsed, cssUri };

	panel.webview.html = renderLeetCodePreviewHtml(parsed, cssUri, panel.webview.cspSource);

	panel.webview.onDidReceiveMessage((msg: WebviewMsg) => {
		void routeMessage(ctx, msg);
	});

	panel.onDidDispose(() => {
		void endChallenge();
	});
}

/** Route a webview message to the appropriate handler. */
async function routeMessage(ctx: PanelCtx, msg: WebviewMsg): Promise<void> {
	if (msg.command === 'solveIt')             { await handleSolveIt(ctx, msg); }
	else if (msg.command === 'runTests')       { await handleRunTests(ctx, msg.language); }
	else if (msg.command === 'submit')         { await handleSubmit(ctx, msg.language); }
	else if (msg.command === 'selectLanguage') { handleSelectLanguage(ctx, msg.language); }
}

/**
 * Handle a `solveIt` message — open the starter file and arm practice mode.
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
async function handleSolveIt(ctx: PanelCtx, msg: WebviewMsg): Promise<void> {
	if (!msg.language) {
		void vscode.window.showErrorMessage('Pick a language before starting the challenge.');
		return;
	}
	const langId = resolveLangId(msg.language);
	const config = effectivePracticeConfig(ctx.parsed, msg);

	await startChallenge(ctx.context, ctx.parsed, langId, config);
	postChallengeState(ctx, true);
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

/**
 * Handle a `selectLanguage` message — no state change today; the webview
 * already drives the visible blocks. Hook left in place so future iterations
 * can re-render the panel with the chosen language highlighted.
 */
function handleSelectLanguage(_ctx: PanelCtx, _language: string | undefined): void {
	// Intentionally a no-op for now — the webview script handles UI state.
}
