import * as assert from 'node:assert';
import { parseProjectArtifact, unimplementedCheckKindsFromContent } from '../src/services/project-parser.helpers.js';
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
		'      kind: call',
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
			assert.strictEqual(fn.kind, 'call');
			if (fn.kind !== 'call') { throw new Error('narrowing failed'); }
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
			'      kind: call',
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
			// `packagse` not `servcies`: wave 3.A swapped `services` for `packages` in
			// `BODY_SET_KEYS` once T3.1's parser existed, so the old fixture's typo no
			// longer has a near-miss to suggest — and the key it used to name is now
			// itself unknown.
			const { warnings } = parseProjectArtifact('packagse:\n  - name: api', '');
			assert.ok(warnings.some(w => w.includes('packagse') && w.includes('packages')), warnings.join(' | '));
		});

		test('an unrelated custom key is left alone', () => {
			const { warnings } = parseProjectArtifact('source: https://example.com\n', '');
			assert.deepStrictEqual(warnings, []);
		});
	});

	// ── unimplementedKinds — the S3 signal ────────────────────────────────────

	/**
	 * `buildCheck` drops a check whose `kind:` no environment implements, so
	 * `checks` holds only the survivors. Grading those alone is the false-green
	 * vector (S3): a `service`-shaped artifact whose `http` checks vanished
	 * would be graded on a surviving `build` check and reported solved.
	 *
	 * The drop was reported only as a free-form warning string, which no
	 * grading path can rely on. These pin the **structured** signal that
	 * replaced it.
	 */
	suite('unimplementedKinds', () => {

		// `class`, not `http`: T3.5 implemented `http`, and a pin written
		// against whichever id happens to be unimplemented stops testing
		// anything the day that id lands — going green while asserting nothing.
		const RESERVED_CHECKS = [
			'test:',
			'  type: project',
			'  checks:',
			'    - name: app builds',
			'      kind: build',
			'      dir: client',
			'      argv: ["npx", "tsc", "--noEmit"]',
			'    - name: api contract',
			'      kind: class',
			'      file: src/api.ts',
		].join('\n');

		test('a declared kind no environment implements is recorded, not merely warned about', () => {
			const { checks, unimplementedKinds } = parseProjectArtifact(RESERVED_CHECKS, FILES_SECTION);
			assert.deepStrictEqual([...unimplementedKinds], ['class']);
			// And the reason the field has to exist: the dropped check is gone
			// from `checks`, so a caller reading `checks` alone cannot see it.
			assert.deepStrictEqual(checks.map(c => c.kind), ['build']);
		});

		test('an artifact whose kinds are all implemented records none', () => {
			const { unimplementedKinds } = parseProjectArtifact(FM, FILES_SECTION);
			assert.deepStrictEqual([...unimplementedKinds], []);
		});

		test('the same unimplemented kind declared twice is recorded once', () => {
			const twice = RESERVED_CHECKS + [
				'',
				'    - name: api errors',
				'      kind: class',
				'      file: src/api.ts',
			].join('\n');
			assert.deepStrictEqual([...parseProjectArtifact(twice, FILES_SECTION).unimplementedKinds], ['class']);
		});

		test('re-derives from raw .md text, for a caller holding only the source', () => {
			const md = ['---', 'type: leetcode', 'title: P', '---', '', 'Body.', '',
				'```yaml leetcode', RESERVED_CHECKS, '```', '', FILES_SECTION].join('\n');
			assert.deepStrictEqual([...unimplementedCheckKindsFromContent(md)], ['class']);
		});

		test('an `http` check is implemented as of T3.5, and records nothing', () => {
			const httpChecks = RESERVED_CHECKS
				.replace('      kind: class', '      kind: http')
				.replace('      file: src/api.ts', '      package: api');
			const { checks, unimplementedKinds } = parseProjectArtifact(httpChecks, FILES_SECTION);
			assert.deepStrictEqual([...unimplementedKinds], []);
			assert.deepStrictEqual(checks.map(c => c.kind), ['build', 'http']);
		});

		test('an http check declaring no package is dropped by name, not recorded as unimplemented', () => {
			// The distinction matters: a malformed check is the author's typo,
			// an unimplemented kind is this extension's gap, and only the second
			// makes the whole artifact ungradeable.
			const noPackage = RESERVED_CHECKS.replace('      kind: class', '      kind: http');
			const { checks, unimplementedKinds, warnings } = parseProjectArtifact(noPackage, FILES_SECTION);
			assert.deepStrictEqual([...unimplementedKinds], []);
			assert.deepStrictEqual(checks.map(c => c.kind), ['build']);
			assert.ok(warnings.some(w => w.includes('needs a package')), warnings.join(' · '));
		});

		test('an artifact declaring no checks at all re-derives an empty list', () => {
			const md = ['---', 'type: leetcode', 'title: P', '---', '', 'Body.'].join('\n');
			assert.deepStrictEqual([...unimplementedCheckKindsFromContent(md)], []);
		});
	});

	// ── wired into parseLeetCode ──────────────────────────────────────────────

	suite('parseLeetCode dispatch', () => {

		function artifact(testType: string): string {
			const config = FM.replace('  type: project', `  type: ${testType}`);
			return ['---', 'type: leetcode', 'title: P', '---', '', 'Body.', '',
				'```yaml leetcode', config, '```', '', FILES_SECTION].join('\n');
		}

		test('a project artifact carries files, libs and checks', () => {
			const parsed = parseLeetCode(artifact('project'));
			assert.strictEqual(parsed.files?.length, 3);
			assert.strictEqual(parsed.checks?.length, 2);
			assert.deepStrictEqual(Object.keys(parsed.libs ?? {}), ['typescript']);
		});

		/**
		 * `files` and `checks` are multi-file grammar and stay absent — but
		 * `libs:` is **not**: a `function` exercise can want numpy exactly as a
		 * project can, and parsing it only for multi-file types dropped the
		 * declaration silently, between the author writing it and the runner
		 * looking for it.
		 */
		test('a function artifact carries libs, but no files or checks', () => {
			const parsed = parseLeetCode(artifact('function'));
			assert.strictEqual(parsed.files, undefined);
			assert.strictEqual(parsed.checks, undefined);
			assert.deepStrictEqual(Object.keys(parsed.libs ?? {}), ['typescript']);
		});
	});

	/**
	 * D4's hard cut on the project side — the highest-consequence shape of it.
	 *
	 * A `function` artifact with a legacy `params:` fails `verifyExercise` loudly.
	 * A `project` with a legacy `libs:` fails *quietly and much later*: the key is
	 * stripped, `libs` comes back empty, `runLibs` installs nothing, and the solver
	 * meets `Cannot find module 'react'` from a toolchain instead of a warning
	 * naming the real problem. The warning is the only thing that connects the two.
	 */
	suite('D4 hard cut — project keys left in frontmatter', () => {

		const legacyProject = [
			'---',
			'type: leetcode',
			'title: Legacy Project',
			'libs:',
			'  javascript: [react@^19.0.0]',
			'test:',
			'  type: project',
			'  checks:',
			'    - name: counter',
			'      kind: dom-assert',
			'      file: src/App.jsx',
			'---',
			'',
			'Prose.',
			'',
			'## Files',
			'',
			'```jsx path=src/App.jsx',
			'export default function App() { return null; }',
			'```',
		].join('\n');

		test('a legacy libs:/test: in frontmatter is ignored, not read', () => {
			const parsed = parseLeetCode(legacyProject);
			// `test.type` never reaches the fence, so the multi-file grammar never
			// runs at all — which is exactly what makes the failure quiet. The
			// value is `DEFAULT_TEST_TYPE`, and `project` is not a test type any
			// more in any case (T3.5).
			assert.strictEqual(parsed.test.type, 'call');
			assert.strictEqual(parsed.libs, undefined);
			assert.strictEqual(parsed.checks, undefined);
		});

		test('and it warns, naming each offending key', () => {
			const warnings = parseLeetCode(legacyProject).warnings ?? [];
			for (const key of ['libs', 'test']) {
				assert.ok(
					warnings.some(w => w.includes(`'${key}:'`)),
					`expected a D4 warning naming '${key}:', got ${JSON.stringify(warnings)}`,
				);
			}
		});

		test('a leaked block cannot be absorbed by a preceding retained key', () => {
			// The blank line ends the strip early, leaving `- name: b` orphaned at
			// depth. The property that makes that inert is that the orphan cannot
			// be swallowed by an *earlier* retained block key — the terminator that
			// ended the strip is always itself retained, and is exactly what ends
			// `scanIndentedBlock`. Asserted through parsed output, not string shape.
			const parsed = parseLeetCode([
				'---',
				'type: leetcode',
				'tags:',
				'  - arrays',
				'params:',
				'  - name: a',
				'',
				'  - name: b',
				'title: X',
				'---',
				'',
				'Prose.',
			].join('\n'));

			assert.deepStrictEqual(parsed.tags, ['arrays'], 'tags must not absorb the orphaned params rows');
			assert.deepStrictEqual(parsed.params, [], 'D4: a frontmatter params: is ignored entirely');
			assert.strictEqual(parsed.title, 'X');
		});

		test('the same artifact in v2 form parses its libs and checks', () => {
			const migrated = legacyProject
				.replace(/libs:\n  javascript: \[react@\^19\.0\.0\]\ntest:\n  type: project\n  checks:\n    - name: counter\n      kind: dom-assert\n      file: src\/App\.jsx\n/, '')
				.replace('Prose.', [
					'Prose.',
					'',
					'```yaml leetcode',
					'libs:',
					'  javascript: [react@^19.0.0]',
					'test:',
					'  type: project',
					'  checks:',
					'    - name: counter',
					'      kind: dom-assert',
					'      file: src/App.jsx',
					'```',
				].join('\n'));

			const parsed = parseLeetCode(migrated);
			// The legacy `type: project` collapses to the default — what proves
			// the fence was read is `libs` and `checks`, not the scalar.
			assert.strictEqual(parsed.test.type, 'call');
			assert.deepStrictEqual(parsed.libs, { javascript: ['react@^19.0.0'] });
			assert.strictEqual(parsed.checks?.length, 1);
			assert.strictEqual(parsed.checks?.[0].name, 'counter');
		});

	});

	// ── reserved vs unknown check kinds ───────────────────────────────────────

	suite('a reserved kind is not a typo', () => {

		function artifactWithKind(kind: string): string {
			return ['---', 'type: leetcode', 'title: K', '---', '', 'Body.', '',
				'```yaml leetcode',
				'test:',
				'  type: project',
				'  checks:',
				'    - name: api answers',
				`      kind: ${kind}`,
				'      package: api',
				'```', ''].join('\n');
		}

		/**
		 * The format spec lists `http` as planned for `service`. Calling it
		 * unknown sent authors looking for a spelling mistake in a line that was
		 * spelled correctly.
		 */
		test('a documented-but-unimplemented kind says so', () => {
			// `class` — `http` was the example until T3.5 implemented it.
			const parsed = parseLeetCode(artifactWithKind('class'));
			const warning = (parsed.warnings ?? []).find(w => w.includes('api answers')) ?? '';

			assert.match(warning, /no environment implements yet/);
			assert.strictEqual(warning.includes('unknown'), false);
		});

		test('an actual typo is still called unknown', () => {
			const parsed = parseLeetCode(artifactWithKind('htpp'));
			const warning = (parsed.warnings ?? []).find(w => w.includes('api answers')) ?? '';

			assert.match(warning, /unknown kind 'htpp'/);
		});

		/**
		 * Both are dropped: a check nothing can run must not reach the panel's
		 * check line, and must never count as a red check for `--starter-red`,
		 * which needs a starter to fail on its merits.
		 */
		test('both are dropped, whatever they are called', () => {
			for (const kind of ['class', 'htpp']) {
				assert.deepStrictEqual(parseLeetCode(artifactWithKind(kind)).checks, []);
			}
		});

		test('`http` is neither — it parses, and binds to its package', () => {
			const checks = parseLeetCode(artifactWithKind('http')).checks ?? [];
			assert.strictEqual(checks.length, 1);
			assert.strictEqual(checks[0].kind, 'http');
			assert.deepStrictEqual((parseLeetCode(artifactWithKind('http')).warnings ?? [])
				.filter(w => w.includes('api answers')), []);
		});
	});
});
