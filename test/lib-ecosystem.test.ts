import * as assert from 'node:assert';
import { ecosystemFor } from '../src/services/libs/lib-ecosystem.js';
import { LANGUAGES, LANG_IDS } from '../src/types/languages.js';

/**
 * Unit tests for the one authority answering "which registry serves this
 * language's `libs:`".
 *
 * The old answer was `NPM_LANGUAGES`, a hand-kept list that could only say
 * "npm or nothing". This says which of four registries, from the same
 * `LANGUAGES` registry that already owns every other runnable-language fact —
 * so a language can never be runnable and simultaneously have no declared
 * ecosystem.
 */
suite('lib-ecosystem', () => {

	suite('ecosystemFor', () => {

		test('maps each runnable language to its registry', () => {
			assert.strictEqual(ecosystemFor('python'), 'pip');
			assert.strictEqual(ecosystemFor('rust'), 'cargo');
			assert.strictEqual(ecosystemFor('java'), 'maven');
			assert.strictEqual(ecosystemFor('javascript'), 'pnpm');
			assert.strictEqual(ecosystemFor('typescript'), 'pnpm');
		});

		test('folds the two *react display ids onto their runnable pair', () => {
			assert.strictEqual(ecosystemFor('typescriptreact'), 'pnpm');
			assert.strictEqual(ecosystemFor('javascriptreact'), 'pnpm');
		});

		test('resolves an alias the way a fence info-string would', () => {
			assert.strictEqual(ecosystemFor('py'), 'pip');
			assert.strictEqual(ecosystemFor('rs'), 'cargo');
			assert.strictEqual(ecosystemFor('TypeScript'), 'pnpm');
			assert.strictEqual(ecosystemFor('tsx'), 'pnpm');
		});

		test('returns undefined for a language no installer can serve', () => {
			assert.strictEqual(ecosystemFor('cobol'), undefined);
			assert.strictEqual(ecosystemFor('go'), undefined);
			assert.strictEqual(ecosystemFor(''), undefined);
		});

		/**
		 * `libs:` keys are untrusted `.md` text. A plain index would reach the
		 * prototype chain and hand back a truthy value for a key naming no
		 * language at all.
		 */
		test('returns undefined for prototype-chain keys', () => {
			assert.strictEqual(ecosystemFor('__proto__'), undefined);
			assert.strictEqual(ecosystemFor('constructor'), undefined);
			assert.strictEqual(ecosystemFor('toString'), undefined);
		});

		test('every runnable language declares an ecosystem', () => {
			for (const id of LANG_IDS) {
				assert.strictEqual(
					ecosystemFor(id), LANGUAGES[id].ecosystem,
					`${id} must resolve to its own registry`,
				);
			}
		});
	});
});
