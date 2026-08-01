import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CargoLibSpec, MavenLibSpec, PipLibSpec } from '../src/services/libs/lib-ecosystem.js';
import { cargoInstaller, renderCargoToml } from '../src/services/libs/cargo.installer.js';
import { mavenInstaller, renderPomXml } from '../src/services/libs/maven.installer.js';
import { pipInstaller } from '../src/services/libs/pip.installer.js';
import { parseSpec } from '../src/services/libs/lib-spec.helpers.js';

/**
 * Unit tests for the pip, cargo and maven installers.
 *
 * **No test here installs anything.** Each injects the `RunArgv` seam and
 * asserts on the argv that would have been spawned, plus the manifest that
 * would have been written — the two places artifact-derived text could reach
 * something that executes it.
 */
suite('lib installers', () => {

	let dir: string;

	setup(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-')); });
	teardown(() => { fs.rmSync(dir, { recursive: true, force: true }); });

	/** Records argv instead of spawning it. */
	function spy() {
		const calls: { file: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
		return {
			calls,
			run: async (file: string, args: string[], _cwd: string, env?: NodeJS.ProcessEnv) => {
				calls.push({ file, args, env });
			},
		};
	}

	/** Parse through the real grammar, so no test can smuggle an unparsed spec. */
	function specsOf<T>(ecosystem: 'pip' | 'cargo' | 'maven', raws: string[]): T[] {
		return raws.map(raw => {
			const parsed = parseSpec(ecosystem, raw);
			assert.ok(parsed.ok, `fixture '${raw}' must parse`);
			return parsed.spec as T;
		});
	}

	suite('pip', () => {

		test('creates a venv, then installs through its own interpreter', async () => {
			const runner = spy();
			await pipInstaller.install(dir, specsOf<PipLibSpec>('pip', ['numpy>=2,<3']), runner.run);

			assert.deepStrictEqual(runner.calls[0], {
				file: 'python3', args: ['-m', 'venv', dir], env: undefined,
			});
			assert.deepStrictEqual(runner.calls[1], {
				file: path.join(dir, 'bin', 'python3'),
				args: ['-m', 'pip', 'install', '--no-input', 'numpy>=2,<3'],
				env: undefined,
			});
		});

		/**
		 * `bin/pip` is a script whose shebang hard-codes an absolute path;
		 * `-m pip` needs only the interpreter symlink.
		 */
		test('never invokes the pip shim, and never sources activate', async () => {
			const runner = spy();
			await pipInstaller.install(dir, specsOf<PipLibSpec>('pip', ['numpy']), runner.run);

			const flat = runner.calls.map(c => [c.file, ...c.args].join(' ')).join('\n');
			assert.ok(!flat.includes(path.join('bin', 'pip')), flat);
			assert.ok(!flat.includes('activate'), flat);
			assert.ok(!flat.includes('--target'), flat);
		});

		test('renders extras and predicates into one argv element', async () => {
			const runner = spy();
			await pipInstaller.install(
				dir, specsOf<PipLibSpec>('pip', ['requests[socks]==2.32.3']), runner.run,
			);
			assert.ok(runner.calls[1].args.includes('requests[socks]==2.32.3'));
		});

		test('no argv element is flag-shaped beyond the literal flags', async () => {
			const runner = spy();
			await pipInstaller.install(
				dir, specsOf<PipLibSpec>('pip', ['numpy', 'requests[socks]==2.32.3']), runner.run,
			);

			const literals = new Set(['-m', '--no-input']);
			for (const call of runner.calls) {
				for (const arg of call.args) {
					assert.ok(!arg.startsWith('-') || literals.has(arg), `unexpected flag '${arg}'`);
				}
			}
		});

		test('an empty set still builds the venv, and installs nothing', async () => {
			const runner = spy();
			await pipInstaller.install(dir, [], runner.run);
			assert.strictEqual(runner.calls.length, 1);
		});

		test('is not relocatable — its console scripts carry absolute shebangs', () => {
			assert.strictEqual(pipInstaller.relocatable, false);
			assert.deepStrictEqual(pipInstaller.warmPaths([]), [path.join('bin', 'python3')]);
		});
	});

	suite('cargo', () => {

		test('renders a features table exactly', () => {
			const specs = specsOf<CargoLibSpec>('cargo', ['serde@^1+derive+std']);
			assert.match(
				renderCargoToml('leet_warm', specs),
				/^serde = \{ version = "\^1", features = \["derive", "std"\] \}$/m,
			);
		});

		test('renders a plain version when no feature is declared', () => {
			const specs = specsOf<CargoLibSpec>('cargo', ['serde_json@1.0']);
			assert.match(renderCargoToml('leet_warm', specs), /^serde_json = "1\.0"$/m);
		});

		test('renders a wildcard when no requirement is declared', () => {
			const specs = specsOf<CargoLibSpec>('cargo', ['rand']);
			assert.match(renderCargoToml('leet_warm', specs), /^rand = "\*"$/m);
		});

		test('the package name is a parameter — concurrent runs need distinct ones', () => {
			const specs = specsOf<CargoLibSpec>('cargo', ['rand']);
			assert.match(renderCargoToml('leet_ab12cd34', specs), /^name = "leet_ab12cd34"$/m);
		});

		/**
		 * Nothing author-derived can open a table or close a string, because
		 * every field matched an anchored pattern first. This asserts the
		 * *output* holds no such thing, whatever arrives.
		 */
		test('no rendered manifest carries a quote, newline or bracket from a field', () => {
			const specs = specsOf<CargoLibSpec>('cargo', ['serde@^1+derive', 'rand@0.8']);
			const toml = renderCargoToml('leet_warm', specs);
			const dependencies = toml.slice(toml.indexOf('[dependencies]'));

			assert.strictEqual(dependencies.includes('[build-dependencies]'), false);
			assert.strictEqual(dependencies.includes('path ='), false);
			assert.strictEqual(dependencies.includes('git ='), false);
		});

		test('writes the crate, then fetches and pre-warms with a redirected target', async () => {
			const runner = spy();
			await cargoInstaller.install(dir, specsOf<CargoLibSpec>('cargo', ['serde@^1']), runner.run);

			assert.ok(fs.existsSync(path.join(dir, 'Cargo.toml')));
			assert.ok(fs.existsSync(path.join(dir, 'src', 'main.rs')));
			assert.deepStrictEqual(runner.calls.map(c => [c.file, ...c.args]), [
				['cargo', 'fetch'],
				['cargo', 'build', '--offline', '--release'],
			]);
			for (const call of runner.calls) {
				assert.strictEqual(call.env?.CARGO_TARGET_DIR, path.join(dir, 'target'));
			}
		});

		test('warm means resolved *and* built — a swept target is cold', () => {
			assert.deepStrictEqual(cargoInstaller.warmPaths([]), ['Cargo.lock', 'target']);
		});
	});

	suite('maven', () => {

		test('renders exactly one dependency element per coordinate', () => {
			const specs = specsOf<MavenLibSpec>('maven', ['com.google.guava:guava:33.3.1']);
			const pom = renderPomXml(specs);

			assert.strictEqual(pom.match(/<dependency>/g)?.length, 1);
			assert.match(pom, /<groupId>com\.google\.guava<\/groupId>/);
			assert.match(pom, /<artifactId>guava<\/artifactId>/);
			assert.match(pom, /<version>33\.3\.1<\/version>/);
		});

		test('renders optional packaging and classifier', () => {
			const specs = specsOf<MavenLibSpec>('maven', ['org.x:y:1.0:jar:sources']);
			const pom = renderPomXml(specs);

			assert.match(pom, /<type>jar<\/type>/);
			assert.match(pom, /<classifier>sources<\/classifier>/);
		});

		/** An artifact must never be able to add a registry to resolve from. */
		test('never emits a repositories element', () => {
			const specs = specsOf<MavenLibSpec>('maven', ['com.google.guava:guava:33.3.1']);
			assert.strictEqual(renderPomXml(specs).includes('<repositor'), false);
		});

		test('copies dependencies into a flat jars directory', async () => {
			const runner = spy();
			await mavenInstaller.install(
				dir, specsOf<MavenLibSpec>('maven', ['com.google.guava:guava:33.3.1']), runner.run,
			);

			assert.deepStrictEqual(runner.calls[0].args, [
				'-q', '-f', path.join(dir, 'pom.xml'), 'dependency:copy-dependencies',
				`-DoutputDirectory=${path.join(dir, 'jars')}`,
			]);
			assert.strictEqual(runner.calls[0].file, 'mvn');
		});

		test('names Maven when the toolchain is missing', () => {
			assert.strictEqual(
				mavenInstaller.missingTool,
				'mvn not found — install Maven to run library-backed Java exercises',
			);
		});
	});
});
