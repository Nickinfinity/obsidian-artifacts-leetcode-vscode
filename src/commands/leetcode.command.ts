import * as vscode from 'vscode';
import { parseFrontmatterOnly, parseLeetCode } from '../services/leetcode-parser.service.js';
import { validateObsidianVault } from '../services/vault.service.js';
import { getVaultPath } from '../services/vault-path.store.js';
import type { ParsedLeetCode } from '../types/leetcode.types.js';
import { buildQuickPickItems } from './quickpick-item.helpers.js';
import type { QuickPickEntry } from './quickpick-item.helpers.js';

/** Result of a successful pick — the file that was chosen plus its parsed contents. */
export interface PickedExercise {
	fileUri: vscode.Uri;
	parsed: ParsedLeetCode;
}

/**
 * Validates the vault, lets the user pick a `.md` file under `dir`, and parses it.
 *
 * The single entry point for "open an exercise" — both the `obsidian-leetcode.open`
 * command (palette / view-title button) and the sidebar view's empty-state button
 * call this so the two triggers can never drift out of sync.
 *
 * @param context - Extension context owning the vault path.
 * @param dir     - Artifact directory name (always `'LeetCode'`).
 * @returns The picked file and its parsed contents, or `null` when the vault is
 *   unconfigured, the directory is missing, or the picker was dismissed.
 *
 * @example
 * const picked = await pickLeetCodeExercise(context, 'LeetCode');
 */
export async function pickLeetCodeExercise(
	context: vscode.ExtensionContext, dir: string,
): Promise<PickedExercise | null> {
	const vaultPath = getVaultPath(context);
	if (!vaultPath || !validateObsidianVault(vaultPath)) {
		void vscode.window.showErrorMessage('Obsidian vault is not configured.');
		return null;
	}

	const rootUri = vscode.Uri.joinPath(vscode.Uri.file(vaultPath), dir);
	const file = await pickLeetCodeFile(rootUri);
	if (!file) { return null; }

	const bytes = await vscode.workspace.fs.readFile(file);
	const content = new TextDecoder().decode(bytes);
	return { fileUri: file, parsed: parseLeetCode(content) };
}

/**
 * Walks `rootUri` (one level deep) and lets the user pick a `.md` file.
 *
 * Each candidate's frontmatter is parsed (via `parseFrontmatterOnly` — the
 * body is never touched, so a large `# Solutions` tree costs nothing here)
 * to enrich the picker with difficulty, solve status, algorithm, and tags.
 *
 * @param rootUri - Folder URI to enumerate.
 * @returns Selected file URI, or `null` when the picker is dismissed.
 *
 * @example
 * await pickLeetCodeFile(vscode.Uri.file('/vault/LeetCode'));
 */
async function pickLeetCodeFile(rootUri: vscode.Uri): Promise<vscode.Uri | null> {
	let dirEntries: [string, vscode.FileType][];
	try {
		dirEntries = await vscode.workspace.fs.readDirectory(rootUri);
	} catch {
		void vscode.window.showErrorMessage('LeetCode directory is missing from the vault.');
		return null;
	}

	const fileNames = dirEntries
		.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
		.map(([name]) => name);
	if (fileNames.length === 0) {
		void vscode.window.showInformationMessage('No LeetCode artifacts found.');
		return null;
	}

	const entries = await Promise.all(fileNames.map(fileName => summarizeExercise(rootUri, fileName)));
	const items = buildQuickPickItems(entries);

	const pick = await vscode.window.showQuickPick(items, {
		title: 'LeetCode artifacts',
		placeHolder: 'Pick a problem',
		matchOnDescription: true,
		matchOnDetail: true,
	});
	if (!pick) { return null; }
	return vscode.Uri.joinPath(rootUri, pick.fileName);
}

/**
 * Reads and frontmatter-parses one candidate file for the picker.
 *
 * @param rootUri  - LeetCode directory URI.
 * @param fileName - Basename of the `.md` file within it.
 * @returns A `QuickPickEntry` ready for `buildQuickPickItems`.
 *
 * @example
 * await summarizeExercise(rootUri, 'two-sum.md');
 */
async function summarizeExercise(rootUri: vscode.Uri, fileName: string): Promise<QuickPickEntry> {
	const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(rootUri, fileName));
	const content = new TextDecoder().decode(bytes);
	return { fileName, parsed: parseFrontmatterOnly(content) };
}
