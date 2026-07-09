import * as vscode from 'vscode';
import { ATTEMPTS_DIR } from '../types/constants.js';
import type { ParsedLeetCode } from '../types/leetcode.types.js';
import { exerciseFileName, resolveStarterCode } from './exercise-file.helpers.js';

export { exerciseFileName, resolveStarterCode, slugify } from './exercise-file.helpers.js';

/**
 * Absolute URI of the temp exercise file for a given problem + language.
 *
 * Lives under `globalStorageUri/attempts/` — machine-local, outside the user's
 * workspace and outside the Obsidian vault, so nothing the extension writes is
 * ever indexed by Obsidian or committed by the user.
 *
 * @param context - Extension context owning `globalStorageUri`.
 * @param title   - Artifact title (slugified into the filename).
 * @param langId  - Canonical `languageId` (drives the file extension).
 * @returns URI such as `…/globalStorage/<ext-id>/attempts/leetcode_two-sum.js`.
 *
 * @example
 * exerciseFileUri(ctx, 'Two Sum', 'python'); // → …/attempts/leetcode_two-sum.py
 */
export function exerciseFileUri(
	context: vscode.ExtensionContext, title: string, langId: string,
): vscode.Uri {
	return vscode.Uri.joinPath(context.globalStorageUri, ATTEMPTS_DIR, exerciseFileName(title, langId));
}

/**
 * Create (or reuse) the temp exercise file and open it in the main editor group.
 *
 * An existing file is **never overwritten** — a previous attempt is reopened as
 * it was left, so a mis-click on *Solve It* cannot discard work in progress.
 * The document's language is set explicitly as well as via the extension, since
 * `globalStorageUri` is outside any workspace and file-association rules there
 * are not guaranteed.
 *
 * @param context - Extension context owning `globalStorageUri`.
 * @param parsed  - Parsed artifact supplying the title and starter code.
 * @param langId  - Canonical `languageId` the user picked.
 * @returns The opened document's URI.
 *
 * @example
 * const uri = await openExerciseFile(ctx, parsed, 'javascript');
 */
export async function openExerciseFile(
	context: vscode.ExtensionContext, parsed: ParsedLeetCode, langId: string,
): Promise<vscode.Uri> {
	const fileUri = exerciseFileUri(context, parsed.title, langId);
	await vscode.workspace.fs.createDirectory(
		vscode.Uri.joinPath(context.globalStorageUri, ATTEMPTS_DIR),
	);

	if (!await fileExists(fileUri)) {
		const starter = resolveStarterCode(parsed, langId);
		await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(`${starter}\n`));
	}

	const doc = await vscode.workspace.openTextDocument(fileUri);
	await vscode.languages.setTextDocumentLanguage(doc, langId).then(undefined, () => doc);
	await vscode.window.showTextDocument(doc, {
		viewColumn: vscode.ViewColumn.One,
		preview: false,
	});
	return fileUri;
}

/**
 * Stat-probe for a URI.
 *
 * @param uri - File to test.
 * @returns True when the file exists.
 *
 * @example
 * await fileExists(vscode.Uri.file('/tmp/x.js'));
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}
