import * as assert from 'node:assert';
import { parseSpec } from '../src/services/libs/lib-spec.helpers.js';
import type { LibEcosystem } from '../src/services/libs/lib-ecosystem.js';

/**
 * Unit tests for the four bounded spec grammars — the trust boundary between
 * untrusted `.md` frontmatter and four package managers.
 *
 * Each grammar is a **subset** of what its CLI accepts, parsed into fields
 * rather than waved through by one mega-regex: every field pattern is
 * anchored, starts with an alphanumeric class (so a leading `-` or `.` cannot
 * match), and contains no nested quantifier (`S8786`).
 *
 * No form that fetches from an author-chosen location is admitted in any
 * ecosystem — a `git+`, `path =`, direct-reference or repository-override spec
 * makes the allowlist decorative, because the allowlist can bound the shape of
 * a *name* and nothing about a URL.
 */
suite('lib-spec grammars', () => {

	/** Assert a refusal and hand back its reason, so a test can pin the wording. */
	function refusalOf(ecosystem: LibEcosystem, raw: string): string {
		const parsed = parseSpec(ecosystem, raw);
		assert.strictEqual(parsed.ok, false, `expected '${raw}' to be refused`);
		return parsed.ok ? '' : parsed.reason;
	}

	/** Assert acceptance and hand back the parsed fields. */
	function specOf(ecosystem: LibEcosystem, raw: string) {
		const parsed = parseSpec(ecosystem, raw);
		assert.strictEqual(parsed.ok, true, `expected '${raw}' to parse`);
		assert.ok(parsed.ok);
		return parsed.spec;
	}

	suite('npm', () => {

		test('parses a bare name', () => {
			assert.deepStrictEqual(specOf('npm', 'react'), { ecosystem: 'npm', name: 'react' });
		});

		test('parses a name with a range', () => {
			assert.deepStrictEqual(
				specOf('npm', 'react@^19.0.0'),
				{ ecosystem: 'npm', name: 'react', range: '^19.0.0' },
			);
		});

		test('keeps the scope as part of the name', () => {
			assert.deepStrictEqual(
				specOf('npm', '@types/node@^20'),
				{ ecosystem: 'npm', name: '@types/node', range: '^20' },
			);
			assert.deepStrictEqual(
				specOf('npm', '@types/node'),
				{ ecosystem: 'npm', name: '@types/node' },
			);
		});

		/**
		 * pnpm accepts all four of these and each one fetches or links from a
		 * location the artifact chose, which is precisely what the allowlist
		 * cannot bound.
		 */
		test('refuses every fetch-from-anywhere protocol', () => {
			for (const hostile of [
				'file:../../etc', 'link:/', 'git+ssh://x/y', 'workspace:*',
				'https://evil.example/x.tgz',
			]) {
				refusalOf('npm', hostile);
			}
		});
	});

	suite('pip', () => {

		test('parses extras and a predicate', () => {
			assert.deepStrictEqual(
				specOf('pip', 'requests[socks]==2.32.3'),
				{ ecosystem: 'pip', name: 'requests', extras: ['socks'], predicates: ['==2.32.3'] },
			);
		});

		test('parses a comma-separated predicate pair', () => {
			assert.deepStrictEqual(
				specOf('pip', 'numpy>=2,<3'),
				{ ecosystem: 'pip', name: 'numpy', extras: [], predicates: ['>=2', '<3'] },
			);
		});

		test('parses a bare name', () => {
			assert.deepStrictEqual(
				specOf('pip', 'numpy'),
				{ ecosystem: 'pip', name: 'numpy', extras: [], predicates: [] },
			);
		});

		test('refuses an environment marker', () => {
			refusalOf('pip', 'requests; python_version < "3"');
		});

		test('refuses a direct reference and a VCS URL', () => {
			refusalOf('pip', 'numpy @ git+https://evil.example/x.git');
			refusalOf('pip', 'git+https://evil.example/x.git');
		});

		test('refuses a requirements-file form', () => {
			refusalOf('pip', '-r requirements.txt');
			refusalOf('pip', '--index-url=https://evil.example');
		});

		test('refuses a path-shaped spec', () => {
			refusalOf('pip', './local');
			refusalOf('pip', '/etc/passwd');
			refusalOf('pip', 'a/../../etc');
		});
	});

	suite('cargo', () => {

		test('parses a crate with a req', () => {
			assert.deepStrictEqual(
				specOf('cargo', 'serde_json@1.0'),
				{ ecosystem: 'cargo', name: 'serde_json', req: '1.0', features: [] },
			);
		});

		test('parses features off the req', () => {
			assert.deepStrictEqual(
				specOf('cargo', 'serde@^1+derive+std'),
				{ ecosystem: 'cargo', name: 'serde', req: '^1', features: ['derive', 'std'] },
			);
		});

		test('parses a bare crate', () => {
			assert.deepStrictEqual(
				specOf('cargo', 'rand'),
				{ ecosystem: 'cargo', name: 'rand', features: [] },
			);
		});

		test('refuses inline TOML in every shape it arrives', () => {
			refusalOf('cargo', 'serde = { path = "/" }');
			refusalOf('cargo', 'serde = { git = "https://evil.example" }');
			refusalOf('cargo', 'serde = { registry = "evil" }');
			refusalOf('cargo', 'serde\n[build-dependencies]\nx = "1"');
			refusalOf('cargo', 'serde@1"');
		});

		test('refuses default-features toggling', () => {
			refusalOf('cargo', 'serde@1+default-features=false');
		});
	});

	suite('maven', () => {

		test('parses a three-part coordinate', () => {
			assert.deepStrictEqual(
				specOf('maven', 'com.google.guava:guava:33.3.1-jre'),
				{
					ecosystem: 'maven', groupId: 'com.google.guava',
					artifactId: 'guava', version: '33.3.1-jre',
				},
			);
		});

		test('parses optional packaging and classifier', () => {
			assert.deepStrictEqual(
				specOf('maven', 'org.x:y:1.0:jar:sources'),
				{
					ecosystem: 'maven', groupId: 'org.x', artifactId: 'y',
					version: '1.0', packaging: 'jar', classifier: 'sources',
				},
			);
		});

		test('refuses too few and too many segments', () => {
			refusalOf('maven', 'guava');
			refusalOf('maven', 'com.google:guava');
			refusalOf('maven', 'a:b:c:d:e:f');
		});

		test('refuses the non-reproducible version keywords', () => {
			refusalOf('maven', 'com.x:y:LATEST');
			refusalOf('maven', 'com.x:y:RELEASE');
		});

		/** A segment closing an element would inject a plugin into the pom. */
		test('refuses XML metacharacters in a segment', () => {
			refusalOf('maven', 'com.x:y:</version><plugin>');
			refusalOf('maven', 'com.x:y:1.0"');
		});
	});

	suite('shared refusals — every ecosystem', () => {

		const ecosystems: LibEcosystem[] = ['npm', 'pip', 'cargo', 'maven'];

		/** The one guard a leading-character anchor cannot express. */
		test('refuses `..` anywhere', () => {
			for (const ecosystem of ecosystems) {
				refusalOf(ecosystem, '../../etc/passwd');
				refusalOf(ecosystem, 'a/../../etc');
				refusalOf(ecosystem, 'a:b:..');
			}
		});

		test('refuses flag-shaped specs', () => {
			for (const ecosystem of ecosystems) {
				refusalOf(ecosystem, '--target=/etc');
				refusalOf(ecosystem, '-rf');
			}
		});

		test('refuses shell metacharacters and whitespace', () => {
			for (const ecosystem of ecosystems) {
				refusalOf(ecosystem, 'requests; rm -rf /');
				refusalOf(ecosystem, '`whoami`');
				refusalOf(ecosystem, 'lodash\n--evil');
				refusalOf(ecosystem, 'a b');
			}
		});

		test('refuses an empty spec', () => {
			for (const ecosystem of ecosystems) {
				refusalOf(ecosystem, '');
				refusalOf(ecosystem, '   ');
			}
		});

		test('refuses a NUL-byte payload', () => {
			for (const ecosystem of ecosystems) {
				refusalOf(ecosystem, 'pkg\u0000');
				refusalOf(ecosystem, 'pkg%00');
			}
		});

		/**
		 * The `S8786` line: a pathological input must **return**, not hang. A
		 * nested quantifier anywhere in these patterns turns this into a
		 * multi-second backtrack.
		 */
		test('returns promptly on a 10 000-character spec', () => {
			const long = 'a'.repeat(10_000);
			const started = Date.now();
			for (const ecosystem of ecosystems) {
				parseSpec(ecosystem, long);
				parseSpec(ecosystem, `${long}@${long}`);
				parseSpec(ecosystem, `${long}!`);
			}
			assert.ok(Date.now() - started < 1_000, 'spec parsing must be linear');
		});

		test('the reason names the offending spec', () => {
			assert.match(refusalOf('pip', '-r requirements.txt'), /-r requirements\.txt/);
			assert.match(refusalOf('maven', 'guava'), /guava/);
		});
	});
});
