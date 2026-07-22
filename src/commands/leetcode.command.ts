import * as vscode from 'vscode';
import { parseFrontmatterOnly, parseLeetCode } from '../services/leetcode-parser.service.js';
import { validateObsidianVault } from '../services/vault.service.js';
import { getVaultPath } from '../services/vault-path.store.js';
import type { ParsedLeetCode } from '../types/leetcode.types.js';
import { buildQuickPickItems, parentPath, splitDirEntries } from './quickpick-item.helpers.js';
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

/** One picker row — either a folder to descend into or an exercise to open. */
interface BrowseItem extends vscode.QuickPickItem {
	/** `'enter'` navigates to `path`; `'open'` returns it as the picked file. */
	action: 'enter' | 'open';
	/** Vault-relative path of the folder (`'enter'`) or `.md` file (`'open'`). */
	path: string;
}

/**
 * Browses `rootUri` one folder at a time and lets the user pick a `.md` file.
 *
 * Each level lists its subfolders first (alphabetical), then its exercises sorted by
 * `buildQuickPickItems`; picking a folder descends, and a `..` row (below the root)
 * goes back up. Each exercise's frontmatter is parsed for its row via
 * `parseFrontmatterOnly` — only the current level is read, so a deep vault costs one
 * `readDirectory` per step, not a full-tree walk.
 *
 * Symlinked subfolders never appear as rows (`splitDirEntries` drops them) and the
 * `..` row is computed from the already-descended path, so browsing cannot leave the
 * validated vault root (path-containment, security-critical).
 *
 * @param rootUri - Folder URI to browse from.
 * @returns Selected file URI, or `null` when the picker is dismissed.
 *
 * @example
 * await pickLeetCodeFile(vscode.Uri.file('/vault/LeetCode'));
 */
async function pickLeetCodeFile(rootUri: vscode.Uri): Promise<vscode.Uri | null> {
	let cwd = '';

	for (;;) {
		const dirUri = cwd ? vscode.Uri.joinPath(rootUri, cwd) : rootUri;

		let listing: readonly (readonly [string, vscode.FileType])[];
		try {
			listing = await vscode.workspace.fs.readDirectory(dirUri);
		} catch {
			void vscode.window.showErrorMessage('LeetCode directory is missing from the vault.');
			return null;
		}

		const { dirs, files } = splitDirEntries(listing);
		if (dirs.length === 0 && files.length === 0 && !cwd) {
			void vscode.window.showInformationMessage('No LeetCode artifacts found.');
			return null;
		}

		const items = await buildBrowseItems(rootUri, cwd, dirs, files);
		const pick = await vscode.window.showQuickPick(items, {
			title: cwd ? `LeetCode artifacts · ${cwd}` : 'LeetCode artifacts',
			placeHolder: 'Pick a folder or a problem',
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!pick) { return null; }

		if (pick.action === 'open') { return vscode.Uri.joinPath(rootUri, pick.path); }
		cwd = pick.path;
	}
}

/**
 * Builds one level's picker rows: `..` (below the root), then folders, then exercises.
 *
 * @param rootUri - Browse root, used to read each exercise's frontmatter.
 * @param cwd     - Current folder, relative to the root (`''` at the top).
 * @param dirs    - Subfolder names at this level, already alphabetical.
 * @param files   - `.md` file names at this level.
 * @returns Rows in display order, folders above files.
 *
 * @example
 * await buildBrowseItems(rootUri, 'Arrays', [], ['two-sum.md']);
 */
async function buildBrowseItems(
	rootUri: vscode.Uri, cwd: string, dirs: string[], files: string[],
): Promise<BrowseItem[]> {
	const items: BrowseItem[] = [];
	if (cwd) {
		items.push({ label: '$(arrow-left) ..', description: parentPath(cwd) || 'LeetCode', action: 'enter', path: parentPath(cwd) });
	}

	for (const name of dirs) {
		items.push({ label: `$(folder) ${name}`, description: '', detail: '', action: 'enter', path: cwd ? `${cwd}/${name}` : name });
	}

	const dirUri = cwd ? vscode.Uri.joinPath(rootUri, cwd) : rootUri;
	const entries = await Promise.all(files.map(name => summarizeExercise(dirUri, name)));
	for (const item of buildQuickPickItems(entries)) {
		items.push({ ...item, action: 'open', path: cwd ? `${cwd}/${item.fileName}` : item.fileName });
	}

	return items;
}

/**
 * Reads and frontmatter-parses one candidate file for the picker.
 *
 * @param dirUri   - URI of the folder currently being browsed.
 * @param fileName - Name of the `.md` file inside it, e.g. `'two-sum.md'`. Bare, not
 *   vault-relative, so the row shows no redundant category (the title carries the folder).
 * @returns A `QuickPickEntry` ready for `buildQuickPickItems`.
 *
 * @example
 * await summarizeExercise(dirUri, 'two-sum.md');
 */
async function summarizeExercise(dirUri: vscode.Uri, fileName: string): Promise<QuickPickEntry> {
	const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dirUri, fileName));
	const content = new TextDecoder().decode(bytes);
	return { fileName, parsed: parseFrontmatterOnly(content) };
}
