import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CssAssertCheck, DomAssertCheck, TestCase } from '../src/types/leetcode.types.js';
import {
	gradeRenderOutcomes, renderCasesFor, runRenderCheck, validateRenderCheck,
} from '../src/services/test-envs/project/checks.js';

/**
 * `dom-assert` / `css-assert` check kinds (eval-fixes TB.6).
 *
 * The pieces that decide *whether an assertion is answerable at all* are pure
 * and tested here offline. The jsdom ceiling is the point: a geometry assertion
 * must be **refused with a readable message**, never silently answered — jsdom
 * computes no layout, so a box-model read would be a confident zero.
 */
suite('project checks', () => {

	function domCheck(cases: TestCase[]): DomAssertCheck {
		return { name: 'alternates', kind: 'dom-assert', file: 'src/App.jsx', cases, publicCount: cases.length };
	}

	function domCheckWithFile(file: string, cases: TestCase[]): DomAssertCheck {
		return { name: 'alternates', kind: 'dom-assert', file, cases, publicCount: cases.length };
	}

	function cssCheck(cases: TestCase[]): CssAssertCheck {
		return { name: 'styled', kind: 'css-assert', file: 'src/App.jsx', cases, publicCount: cases.length };
	}

	const clickThenRead: TestCase = {
		input: { steps: [{ op: 'click', selector: 'button' }, { op: 'text', selector: '#out' }] },
		expected: 'X',
	};

	// ── The jsdom ceiling ─────────────────────────────────────────────────────

	suite('css-assert refuses what jsdom cannot answer', () => {

		for (const property of ['width', 'height', 'top', 'left', 'margin', 'padding']) {
			test(`a ${property} assertion is refused with a readable message`, () => {
				const reason = validateRenderCheck(cssCheck([
					{ input: { steps: [{ op: 'style', selector: '#box', property }] }, expected: '10px' },
				]));

				assert.ok(reason, `${property} should be refused`);
				assert.ok(/layout/i.test(reason ?? ''), reason ?? '');
				assert.ok((reason ?? '').includes(property), reason ?? '');
			});
		}

		test('a non-geometry declared property is answerable', () => {
			assert.strictEqual(validateRenderCheck(cssCheck([
				{ input: { steps: [{ op: 'style', selector: '#box', property: 'color' }] }, expected: 'red' },
			])), null);
		});

		test('class presence is answerable', () => {
			assert.strictEqual(validateRenderCheck(cssCheck([
				{ input: { steps: [{ op: 'attr', selector: '#box', name: 'class' }] }, expected: 'active' },
			])), null);
		});

		test('a css-assert may not fire events — that is a dom-assert', () => {
			const reason = validateRenderCheck(cssCheck([clickThenRead]));
			assert.ok(reason?.includes('click'), reason ?? '');
		});

		test('a dom-assert may fire events', () => {
			assert.strictEqual(validateRenderCheck(domCheck([clickThenRead])), null);
		});
	});

	// ── Step validation: the artifact is untrusted ────────────────────────────

	suite('step validation', () => {

		test('a case with no steps is refused', () => {
			assert.ok(validateRenderCheck(domCheck([{ input: {}, expected: 1 }])));
		});

		test('a case whose steps are not an array is refused, not coerced', () => {
			assert.ok(validateRenderCheck(domCheck([{ input: { steps: 'click' }, expected: 1 }])));
		});

		test('an unknown op is refused by name', () => {
			const reason = validateRenderCheck(domCheck([
				{ input: { steps: [{ op: 'eval', selector: 'x' }] }, expected: 1 },
			]));
			assert.ok(reason?.includes('eval'), reason ?? '');
		});

		test('a step with a non-string selector is refused', () => {
			assert.ok(validateRenderCheck(domCheck([
				{ input: { steps: [{ op: 'text', selector: 42 }] }, expected: 1 },
			])));
		});

		test('a case whose last step reads nothing is refused — there would be no value', () => {
			const reason = validateRenderCheck(domCheck([
				{ input: { steps: [{ op: 'click', selector: 'button' }] }, expected: 1 },
			]));
			assert.ok(/read/i.test(reason ?? ''), reason ?? '');
		});

		test('a check with no cases at all is refused', () => {
			assert.ok(validateRenderCheck(domCheck([])));
		});
	});

	// ── Mapping cases onto driver cases ──────────────────────────────────────

	test('renderCasesFor numbers cases by position and carries their steps', () => {
		const cases = renderCasesFor(domCheck([clickThenRead, clickThenRead]));
		assert.deepStrictEqual(cases.map(c => c.index), [0, 1]);
		assert.deepStrictEqual(cases[0].steps, clickThenRead.input.steps);
	});

	// ── Grading: canonical JSON, one path shared with every other test type ──

	suite('gradeRenderOutcomes', () => {

		test('an observed value equal to expected passes', () => {
			const outcome = gradeRenderOutcomes(domCheck([clickThenRead]),
				[{ index: 0, actual: '"X"', ms: 1 }]);
			assert.strictEqual(outcome.passed, true, outcome.detail);
		});

		test('object key order does not decide a verdict', () => {
			const check = domCheck([{ input: { steps: [{ op: 'text', selector: '#o' }] }, expected: { a: 1, b: 2 } }]);
			const outcome = gradeRenderOutcomes(check, [{ index: 0, actual: '{"b":2,"a":1}', ms: 1 }]);
			assert.strictEqual(outcome.passed, true, outcome.detail);
		});

		test('a mismatch fails and names the case', () => {
			const outcome = gradeRenderOutcomes(domCheck([clickThenRead]),
				[{ index: 0, actual: '"O"', ms: 1 }]);
			assert.strictEqual(outcome.passed, false);
			assert.ok(outcome.detail?.includes('case 0'), outcome.detail);
		});

		test('a per-case error fails that case with its message', () => {
			const outcome = gradeRenderOutcomes(domCheck([clickThenRead]),
				[{ index: 0, error: 'no element matches "#out"', ms: 1 }]);
			assert.strictEqual(outcome.passed, false);
			assert.ok(outcome.detail?.includes('#out'), outcome.detail);
		});

		test('a case with no line at all is a failure, never an implicit pass', () => {
			const outcome = gradeRenderOutcomes(domCheck([clickThenRead, clickThenRead]),
				[{ index: 0, actual: '"X"', ms: 1 }]);
			assert.strictEqual(outcome.passed, false);
			assert.ok(/no result/i.test(outcome.detail ?? ''), outcome.detail);
		});

		test('the outcome carries the check name', () => {
			assert.strictEqual(gradeRenderOutcomes(domCheck([clickThenRead]), []).name, 'alternates');
		});
	});

	// ── Containment: `file:` is a fourth artifact-declared path (Addition B) ──

	suite('runRenderCheck refuses an escaping file: before installing or bundling anything', () => {

		let runDir: string;

		setup(() => {
			runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-escape-'));
		});

		teardown(() => {
			fs.rmSync(runDir, { recursive: true, force: true });
		});

		test('a traversal path is refused, and no runner is ever written', async () => {
			const outcome = await runRenderCheck(domCheckWithFile('../../../etc/passwd', [clickThenRead]), runDir);

			assert.strictEqual(outcome.passed, false);
			assert.ok(/escapes/.test(outcome.detail ?? ''), outcome.detail);
			assert.strictEqual(fs.existsSync(path.join(runDir, 'leet-render-runner.js')), false);
		});

		test('an absolute path is refused the same way', async () => {
			const outcome = await runRenderCheck(domCheckWithFile('/etc/passwd', [clickThenRead]), runDir);

			assert.strictEqual(outcome.passed, false);
			assert.ok(outcome.detail, outcome.detail);
			assert.strictEqual(fs.existsSync(path.join(runDir, 'leet-render-runner.js')), false);
		});
	});

	// ── End-to-end through the real driver (opt-in) ──────────────────────────

	test('a dom-assert and a css-assert grade a real component [LEET_PROJECT_E2E=1]', async function () {
		if (process.env.LEET_PROJECT_E2E !== '1') { this.skip(); }
		this.timeout(600_000);

		const { runRenderCheck } = await import('../src/services/test-envs/project/checks.js');
		const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-e2e-'));
		fs.mkdirSync(path.join(runDir, 'src'));
		fs.writeFileSync(path.join(runDir, 'src/App.jsx'), [
			"import { useState } from 'react';",
			'export default function App() {',
			"  const [mark, setMark] = useState('');",
			'  return (<div>',
			"    <button onClick={() => setMark('X')}>go</button>",
			'    <span id="out" className="cell" style={{ color: \'red\' }}>{mark}</span>',
			'  </div>);',
			'}',
		].join('\n'));

		const dom = await runRenderCheck(domCheck([clickThenRead]), runDir);
		assert.strictEqual(dom.passed, true, dom.detail);

		const css = await runRenderCheck(cssCheck([
			{ input: { steps: [{ op: 'attr', selector: '#out', name: 'class' }] }, expected: 'cell' },
			{ input: { steps: [{ op: 'style', selector: '#out', property: 'color' }] }, expected: 'red' },
		]), runDir);
		assert.strictEqual(css.passed, true, css.detail);

		fs.rmSync(runDir, { recursive: true, force: true });
	});
});
