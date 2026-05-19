import * as vscode from 'vscode';

/**
 * Registers the `obsidian-leetcode.create` command.
 *
 * Placeholder: exercise scaffolding (prompt → write `type: leetcode` `.md`
 * into the vault `LeetCode/` directory → open) is a planned feature. The
 * command is wired into the menus now so the UI shape is stable; the handler
 * currently only informs the user the feature is not yet available.
 *
 * @param context - Extension context for subscription management.
 * @returns Nothing; the disposable is pushed onto `context.subscriptions`.
 *
 * @example
 * registerCreateExerciseCommand(context);
 */
export function registerCreateExerciseCommand(context: vscode.ExtensionContext): void {
	const disposable = vscode.commands.registerCommand('obsidian-leetcode.create', () => {
		void vscode.window.showInformationMessage(
			'Create LeetCode Exercise is coming soon — exercise scaffolding is not implemented yet.',
		);
	});
	context.subscriptions.push(disposable);
}
