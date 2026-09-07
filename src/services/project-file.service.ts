import * as vscode from 'vscode';
import { ATTEMPTS_DIR } from '../types/constants.js';
import type { FileSpec, ParsedLeetCode } from '../types/leetcode.types.js';
import { slugify } from './exercise-file.helpers.js';
import { writeProjectFiles } from './test-envs/project/files.writer.js';

/** A materialised project attempt: where it lives, and the tab to focus. */
export interface ProjectAttempt {
	/** Run directory under `globalStorageUri/attempts/` holding the whole tree */
	dir: vscode.Uri;
	/** First editable file — the tab shown in the main editor group */
	primary: vscode.Uri;
}

/**
 * Materialise a `project` exercise's starter tree and open it for editing.
 *
 * Mirrors `openExerciseFile` for the multi-file case: a **fresh** run directory
 * every time (no reopen-to-retry), under `globalStorageUri/attempts/` so nothing
 * lands in the user's workspace or their Obsidian vault.
 *
 * Roles decide what the solver sees. `editable` and `readonly` files open as
 * tabs — `readonly` was written mode `0o444` by the writer, so the editor
 * refuses to save it, which is the only mechanism VS Code offers. `hidden`
 * files are written but never opened: they are scaffolding the exercise needs
 * and the solver should not be reading.
 *
 * @param context - Extension context owning `globalStorageUri`.
 * @param parsed  - Parsed `project` artifact supplying `## Files`.
 * @returns The run directory and the tab to focus.
 * @throws When the artifact declares no editable file, or a path escapes the run
 *   directory (the writer refuses the whole tree — nothing is left behind).
 *
 * @example
 * const { dir, primary } = await openProjectFiles(ctx, parsed);
 */
export async function openProjectFiles(
	context: vscode.ExtensionContext, parsed: ParsedLeetCode,
): Promise<ProjectAttempt> {
	const files = parsed.files ?? [];
	const openable = files.filter(f => f.role !== 'hidden');
	if (openable.length === 0) {
		throw new Error('this project declares no files to edit');
	}

	const dir = projectAttemptUri(context, parsed.title);
	await vscode.workspace.fs.createDirectory(dir);
	// The same writer the harness uses — one containment authority, so a live
	// run cannot be given a tree the grader would have refused.
	await writeProjectFiles(dir.fsPath, files);

	for (const file of [...openable].reverse()) {
		await showProjectFile(dir, file);
	}

	const primary = vscode.Uri.joinPath(dir, ...(openable[0].path.split('/')));
	return { dir, primary };
}

/** Open one file as a non-preview tab in the main group. */
async function showProjectFile(dir: vscode.Uri, file: FileSpec): Promise<void> {
	const uri = vscode.Uri.joinPath(dir, ...file.path.split('/'));
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.languages.setTextDocumentLanguage(doc, file.language).then(undefined, () => doc);
	await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
}

/**
 * Run directory for one project attempt.
 *
 * Sibling of `exerciseFileUri`, and unique per call for the same reason: every
 * *Solve It* is a fresh attempt, so there is never a half-edited tree to
 * overwrite.
 *
 * @param context - Extension context owning `globalStorageUri`.
 * @param title   - Artifact title, slugified into the directory name.
 * @returns URI such as `…/attempts/project_react-counter_kx3f2q1`.
 *
 * @example
 * projectAttemptUri(ctx, 'React Counter'); // → …/attempts/project_react-counter_m8s2p0q
 */
export function projectAttemptUri(context: vscode.ExtensionContext, title: string): vscode.Uri {
	const run = Math.random().toString(36).slice(2, 9);
	return vscode.Uri.joinPath(context.globalStorageUri, ATTEMPTS_DIR, `project_${slugify(title)}_${run}`);
}

/**
 * Save every dirty editor holding a file inside `dir`.
 *
 * A project is graded from **disk** — the checks bundle and execute real files,
 * unlike the function types, which read the live buffer directly. Without this,
 * Run Tests would silently grade the last saved version of whatever the solver
 * is currently typing.
 *
 * @param dir - Run directory whose documents should be flushed.
 *
 * @example
 * await saveProjectDocuments(session.projectDir);
 */
export async function saveProjectDocuments(dir: vscode.Uri): Promise<void> {
	const prefix = `${dir.toString()}/`;
	const dirty = vscode.workspace.textDocuments.filter(d => d.isDirty && d.uri.toString().startsWith(prefix));
	await Promise.all(dirty.map(d => d.save()));
}

/**
 * Close every editor showing a file inside `dir`, then delete the directory.
 *
 * The discard path for a project attempt — the multi-file counterpart of
 * `closeExerciseEditor` + `deleteExerciseFile`. A missing directory is not an
 * error: an abandoned run may already have been swept.
 *
 * @param dir - Run directory to discard.
 *
 * @example
 * await discardProjectAttempt(session.projectDir);
 */
export async function discardProjectAttempt(dir: vscode.Uri): Promise<void> {
	const prefix = `${dir.toString()}/`;
	for (const editor of vscode.window.visibleTextEditors) {
		if (!editor.document.uri.toString().startsWith(prefix)) { continue; }
		await vscode.window.showTextDocument(editor.document, { preview: false, preserveFocus: false });
		await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
	}
	await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false }).then(undefined, () => undefined);
}
