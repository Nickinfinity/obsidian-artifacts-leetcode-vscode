/**
 * Generates a 32-character random alphanumeric nonce for webview CSP headers.
 *
 * @returns A fresh 32-char nonce string.
 *
 * @example
 * const nonce = getNonce(); // → 'a1B2c3...'
 */
export function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
