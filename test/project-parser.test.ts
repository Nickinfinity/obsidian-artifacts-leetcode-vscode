import * as assert from 'node:assert';
import { parseProjectArtifact } from '../src/services/project-parser.helpers.js';
import { parseLeetCode } from '../src/services/leetcode-parser.service.js';

/**
 * Unit tests for the `project` grammar (eval-fixes TB.2): the `## Files` tree,
 * `libs:`, `checks:`, and the `check=<name>` case binding.
 *
 * **The artifact is untrusted input.** Half of these fixtures are hostile —
 * malformed YAML, a `checks:` value that is not a list, a `__proto__` key, a
 * traversal path — and every one of them must degrade to a documented default
 * instead of throwing or reaching through a prototype.
 */
suite('project parser', () => {

	const FILES_SECTION = [
		'## Files',
		'',
		'```typescript path=src/lib/catalogue.ts role=editable',
		'export function filterInStock() { return []; }',
		'```',
		'',
		'```typescript path=src/app/api/route.ts role=readonly',
		'export const GET = () => null;',
		'```',
		'',
		'```css path=src/app/globals.css',
		'body { margin: 0; }',
		'```',
		'',
	].join('\n');

	const FM = [
		'libs:',
		'  typescript:',
		'    - react@^19.0.0',
		'    - "@types/react@^19.0.0"',
		'test:',
		'  type: project',
		'  checks:',
		'    - name: catalogue filter',
		'      kind: function',
		'      file: src/lib/catalogue.ts',
		'      function: filterInStock',
		'    - name: app builds',
		'      kind: build',
		'      dir: client',
		'      argv: ["npx", "tsc", "--noEmit"]',
	].join('\n');

	// ── ## Files ──────────────────────────────────────────────────────────────

	suite('## Files', () => {

		test('every fence with a path becomes a file spec', () => {
			const { files } = parseProjectArtifact(FM, FILES_SECTION);
			assert.deepStrictEqual(files.map(f => f.path), [
				'src/lib/catalogue.ts', 'src/app/api/route.ts', 'src/app/globals.css',
			]);
		});

		test('role defaults to editable and is read from the info-string', () => {
			const { files } = parseProjectArtifact(FM, FILES_SECTION);
			assert.deepStrictEqual(files.map(f => f.role), ['editable', 'readonly', 'editable']);
		});

		test('the fence language resolves to a canonical id', () => {
			const { files } = parseProjectArtifact(FM, FILES_SECTION);
			assert.deepStrictEqual(files.map(f => f.language), ['typescript', 'typescript', 'css']);
		});

		test('content is verbatim, without the fence lines', () => {
			const { files } = parseProjectArtifact(FM, FILES_SECTION);
			assert.strictEqual(files[2].content, 'body { margin: 0; }\n');
		});

		test('a fence with no path= is not a file', () => {
			const body = '## Files\n\n```typescript\nnot a file\n```\n';
			assert.deepStrictEqual(parseProjectArtifact('', body).files, []);
		});

		test('an unknown role degrades to editable with a warning', () => {
			const body = '## Files\n\n```typescript path=a.ts role=sudo\nx\n```\n';
			const { files, warnings } = parseProjectArtifact('', body);
			assert.strictEqual(files[0].role, 'editable');
			assert.ok(warnings.some(w => w.includes('sudo')), warnings.join(' | '));
		});

		test('a traversal path is preserved for the writer to reject, never resolved here', () => {
			const body = '## Files\n\n```typescript path=../../etc/passwd\nx\n```\n';
			const { files } = parseProjectArtifact('', body);
			assert.strictEqual(files[0].path, '../../etc/passwd');
		});
	});

	// ── libs: ─────────────────────────────────────────────────────────────────

	suite('libs:', () => {

		test('parses per-language dependency lists', () => {
			const { libs } = parseProjectArtifact(FM, FILES_SECTION);
			assert.deepStrictEqual(libs, { typescript: ['react@^19.0.0', '@types/react@^19.0.0'] });
		});

		test('a lib failing the allowlist is dropped with a warning, never admitted', () => {
			const fm = ['libs:', '  typescript:', '    - react@^19.0.0', '    - --target=/etc'].join('\n');
			const { libs, warnings } = parseProjectArtifact(fm, '');
			assert.deepStrictEqual(libs, { typescript: ['react@^19.0.0'] });
			assert.ok(warnings.some(w => w.includes('--target=/etc')), warnings.join(' | '));
		});

		test('a traversal-shaped lib is dropped', () => {
			const fm = ['libs:', '  typescript:', '    - ../../x'].join('\n');
			assert.deepStrictEqual(parseProjectArtifact(fm, '').libs, {});
		});

		test('a __proto__ language key does not reach through the prototype', () => {
			const fm = ['libs:', '  __proto__:', '    - react@^19.0.0'].join('\n');
			const { libs } = parseProjectArtifact(fm, '');
			assert.deepStrictEqual(Object.keys(libs), []);
			assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
		});
	});

	// ── checks: ───────────────────────────────────────────────────────────────

	suite('checks:', () => {

		test('parses each entry with its kind-specific fields', () => {
			const { checks } = parseProjectArtifact(FM, FILES_SECTION);
			assert.strictEqual(checks.length, 2);

			const [fn, build] = checks;
			assert.strictEqual(fn.kind, 'function');
			if (fn.kind !== 'function') { throw new Error('narrowing failed'); }
			assert.strictEqual(fn.file, 'src/lib/catalogue.ts');
			assert.strictEqual(fn.function, 'filterInStock');

			if (build.kind !== 'build') { throw new Error('narrowing failed'); }
			assert.deepStrictEqual(build.argv, ['npx', 'tsc', '--noEmit']);
			assert.strictEqual(build.dir, 'client');
		});

		test('an unknown kind is dropped with a warning, not coerced', () => {
			const fm = ['test:', '  checks:', '    - name: x', '      kind: telepathy'].join('\n');
			const { checks, warnings } = parseProjectArtifact(fm, '');
			assert.deepStrictEqual(checks, []);
			assert.ok(warnings.some(w => w.includes('telepathy')), warnings.join(' | '));
		});

		test('a build check whose argv is not a JSON array is dropped', () => {
			const fm = ['test:', '  checks:', '    - name: x', '      kind: build', '      argv: rm -rf /'].join('\n');
			assert.deepStrictEqual(parseProjectArtifact(fm, '').checks, []);
		});

		test('a checks: value that is not a list degrades to no checks, never throws', () => {
			const { checks } = parseProjectArtifact('test:\n  checks: "not a list"', '');
			assert.deepStrictEqual(checks, []);
		});

		test('a __proto__ field name inside a check is ignored', () => {
			const fm = ['test:', '  checks:', '    - name: x', '      kind: build',
				'      argv: []', '      __proto__: polluted'].join('\n');
			const { checks } = parseProjectArtifact(fm, '');
			assert.strictEqual(checks.length, 1);
			assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
		});
	});

	// ── case → check binding ──────────────────────────────────────────────────

	suite('check=<name> case binding', () => {

		const BODY = [
			'## Files',
			'',
			'```typescript path=a.ts role=editable',
			'x',
			'```',
			'',
			'## Tests',
			'',
			'```json check="catalogue filter"',
			'[{ "input": { "a": 1 }, "expected": 1 }, { "input": { "a": 2 }, "expected": 2 }]',
			'```',
			'',
			'```json check=alternates',
			'[{ "input": { "a": 3 }, "expected": 3 }]',
			'```',
			'',
		].join('\n');

		const CHECK_FM = [
			'test:',
			'  checks:',
			'    - name: catalogue filter',
			'      kind: function',
			'      file: a.ts',
			'      function: f',
			'    - name: alternates',
			'      kind: dom-assert',
			'      file: a.ts',
		].join('\n');

		test('cases bind to their named check', () => {
			const { checks } = parseProjectArtifact(CHECK_FM, BODY);
			assert.deepStrictEqual(checks.map(c => c.cases.length), [2, 1]);
		});

		test('a fence naming no check binds to the sole check', () => {
			const body = '## Tests\n\n```json\n[{ "input": {}, "expected": 1 }]\n```\n';
			const fm = 'test:\n  checks:\n    - name: only\n      kind: build\n      argv: []';
			assert.strictEqual(parseProjectArtifact(fm, body).checks[0].cases.length, 1);
		});

		test('a fence naming an unknown check warns rather than silently vanishing', () => {
			const body = '## Tests\n\n```json check=ghost\n[{ "input": {}, "expected": 1 }]\n```\n';
			const { warnings } = parseProjectArtifact(CHECK_FM, body);
			assert.ok(warnings.some(w => w.includes('ghost')), warnings.join(' | '));
		});

		test('publicCount marks where the hidden cases begin, per check', () => {
			const body = `${BODY}\n## Final Tests\n\n\`\`\`json check=alternates\n[{ "input": { "a": 9 }, "expected": 9 }]\n\`\`\`\n`;
			const { checks } = parseProjectArtifact(CHECK_FM, body);

			// 'catalogue filter': 2 public, no final. 'alternates': 1 public + 1 final.
			assert.deepStrictEqual(checks.map(c => [c.cases.length, c.publicCount]), [[2, 2], [2, 1]]);
		});

		test('a check with only hidden cases has publicCount 0', () => {
			const body = '## Final Tests\n\n```json check=alternates\n[{ "input": {}, "expected": 1 }]\n```\n';
			const { checks } = parseProjectArtifact(CHECK_FM, body);
			assert.strictEqual(checks.find(c => c.name === 'alternates')?.publicCount, 0);
		});

		test('## Final Tests fences bind by name too, appended after the public ones', () => {
			const body = `${BODY}\n## Final Tests\n\n\`\`\`json check=alternates\n[{ "input": { "a": 9 }, "expected": 9 }]\n\`\`\`\n`;
			const { checks } = parseProjectArtifact(CHECK_FM, body);
			assert.deepStrictEqual(checks.map(c => c.cases.length), [2, 2]);
		});
	});

	// ── unknown-key warning (spike §5) ────────────────────────────────────────

	suite('unknown frontmatter keys', () => {

		test('a typo of a known project key warns rather than vanishing silently', () => {
			const { warnings } = parseProjectArtifact('servcies:\n  - name: api', '');
			assert.ok(warnings.some(w => w.includes('servcies') && w.includes('services')), warnings.join(' | '));
		});

		test('an unrelated custom key is left alone', () => {
			const { warnings } = parseProjectArtifact('source: https://example.com\n', '');
			assert.deepStrictEqual(warnings, []);
		});
	});

	// ── wired into parseLeetCode ──────────────────────────────────────────────

	suite('parseLeetCode dispatch', () => {

		function artifact(testType: string): string {
			return ['---', 'type: leetcode', 'title: P', `${FM.replace('  type: project', `  type: ${testType}`)}`,
				'---', '', 'Body.', '', FILES_SECTION].join('\n');
		}

		test('a project artifact carries files, libs and checks', () => {
			const parsed = parseLeetCode(artifact('project'));
			assert.strictEqual(parsed.files?.length, 3);
			assert.strictEqual(parsed.checks?.length, 2);
			assert.deepStrictEqual(Object.keys(parsed.libs ?? {}), ['typescript']);
		});

		test('a function artifact carries none of them', () => {
			const parsed = parseLeetCode(artifact('function'));
			assert.strictEqual(parsed.files, undefined);
			assert.strictEqual(parsed.checks, undefined);
			assert.strictEqual(parsed.libs, undefined);
		});
	});
});
