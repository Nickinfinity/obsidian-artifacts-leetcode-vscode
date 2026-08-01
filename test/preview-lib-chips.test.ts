import * as assert from 'node:assert';
import { renderLibChips } from '../src/ui/panels/leetcodePreview.libs.js';
import { defaultPracticeConfig, defaultTestConfig } from '../src/services/leetcode-parser.service.js';
import type { LibSpec, ParsedLeetCode } from '../src/types/leetcode.types.js';

/**
 * The declared-library chips.
 *
 * A solver needs to know what is already installed before choosing how to
 * solve, and a spec is artifact-authored text — so the only two things worth
 * pinning are that the chips follow the language selector, and that nothing in
 * them can be markup.
 */
suite('preview library chips', () => {

	function artifact(libs?: LibSpec): ParsedLeetCode {
		return {
			title: 'T', difficulty: 'easy', functionName: 'f', status: 'unsolved',
			params: [], returns: 'int', description: '', examples: [], tests: [], finalTests: [],
			test: defaultTestConfig(), setups: [], practice: defaultPracticeConfig(),
			solutions: [], attempts: [], tags: [],
			...(libs ? { libs } : {}),
		};
	}

	test('renders one chip per declared spec', () => {
		const html = renderLibChips(artifact({ python: ['numpy>=2', 'requests'] }));

		assert.strictEqual((html.match(/class="lib-chip"/g) ?? []).length, 2);
		assert.ok(html.includes('numpy&gt;=2'));
		assert.ok(html.includes('requests'));
	});

	test('tags each block with its canonical language, so the selector filters it', () => {
		const html = renderLibChips(artifact({ python: ['numpy'], typescript: ['react@^19.0.0'] }));

		assert.ok(html.includes('data-language="python"'));
		assert.ok(html.includes('data-language="typescript"'));
	});

	test('names the registry the specs come from', () => {
		assert.ok(renderLibChips(artifact({ python: ['numpy'] })).includes('pip libraries'));
		assert.ok(renderLibChips(artifact({ java: ['com.x:y:1.0'] })).includes('maven libraries'));
	});

	test('an artifact with no libs renders nothing at all — no empty row', () => {
		assert.strictEqual(renderLibChips(artifact()), '');
		assert.strictEqual(renderLibChips(artifact({ python: [] })), '');
	});

	/** A spec is untrusted text; the panel interpolates it into HTML. */
	test('a hostile spec cannot inject markup', () => {
		const html = renderLibChips(artifact({ python: ['<img src=x onerror=alert(1)>'] }));

		assert.strictEqual(html.includes('<img'), false);
		assert.ok(html.includes('&lt;img'));
	});
});
