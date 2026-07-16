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
 * Calling this twice for the same problem + language returns two **different**
 * URIs — `exerciseFileName` mints a fresh run suffix on every call.
 *
 * @param context - Extension context owning `globalStorageUri`.
 * @param title   - Artifact title (slugified into the filename).
 * @param langId  - Canonical `languageId` (drives the file extension).
 * @returns URI such as `…/globalStorage/<ext-id>/attempts/leetcode_two-sum_kx3f2q1.js`.
 *
 * @example
 * exerciseFileUri(ctx, 'Two Sum', 'python'); // → …/attempts/leetcode_two-sum_kx3f2q1.py
 */
export function exerciseFileUri(
	context: vscode.ExtensionContext, title: string, langId: string,
): vscode.Uri {
	return vscode.Uri.joinPath(context.globalStorageUri, ATTEMPTS_DIR, exerciseFileName(title, langId));
}

/**
 * Create a fresh temp exercise file and open it in the main editor group.
 *
 * Every call writes a **new** file — `exerciseFileUri` mints a unique run
 * suffix each time, so there is nothing to overwrite. *Solve It* is therefore
 * always a fresh attempt, never a resumed buffer; the previous run's file is
 * left on disk until `discardChallenge` deletes it (or forever, if the run is
 * abandoned — see the P1.5 "no reopen-to-retry" decision). The document's
 * language is set explicitly as well as via the extension, since
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

	const starter = resolveStarterCode(parsed, langId);
	await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(`${starter}\n`));

	const doc = await vscode.workspace.openTextDocument(fileUri);
	await vscode.languages.setTextDocumentLanguage(doc, langId).then(undefined, () => doc);
	await vscode.window.showTextDocument(doc, {
		viewColumn: vscode.ViewColumn.One,
		preview: false,
	});
	return fileUri;
}

/**
 * Delete a temp exercise file, ignoring a missing file.
 *
 * Called by `discardChallenge` on Back/Close. Abandoned runs (window closed,
 * no explicit discard) intentionally leave their file behind — this is the
 * only path that deletes one.
 *
 * @param fileUri - Temp exercise file to remove.
 *
 * @example
 * await deleteExerciseFile(session.fileUri);
 */
export async function deleteExerciseFile(fileUri: vscode.Uri): Promise<void> {
	try {
		await vscode.workspace.fs.delete(fileUri);
	} catch {
		// already gone — nothing to do
	}
}

/**
 * Close the editor tab showing `fileUri`, if one is open.
 *
 * VS Code exposes no stable id for a temp-file tab, so the match is by URI —
 * unique per run since P1.5-3. A no-op when the tab is already gone.
 *
 * @param fileUri - Temp exercise file whose tab should close.
 *
 * @example
 * await closeExerciseEditor(session.fileUri);
 */
export async function closeExerciseEditor(fileUri: vscode.Uri): Promise<void> {
	const tab = findExerciseTab(fileUri);
	if (tab) { await vscode.window.tabGroups.close(tab); }
}

/**
 * Whether `fileUri` currently has an open editor tab.
 *
 * @param fileUri - Temp exercise file to probe.
 * @returns True when a tab for this exact URI is open in any tab group.
 *
 * @example
 * isExerciseEditorOpen(session.fileUri); // → true while Solve It's tab is open
 */
export function isExerciseEditorOpen(fileUri: vscode.Uri): boolean {
	return findExerciseTab(fileUri) !== undefined;
}

/** Locate the open tab (if any) whose text input matches `fileUri`. */
function findExerciseTab(fileUri: vscode.Uri): vscode.Tab | undefined {
	const target = fileUri.toString();
	for (const group of vscode.window.tabGroups.all) {
		const tab = group.tabs.find(t =>
			t.input instanceof vscode.TabInputText && t.input.uri.toString() === target,
		);
		if (tab) { return tab; }
	}
	return undefined;
}
