import * as assert from 'node:assert';
import * as path from 'node:path';
import { selectRunner } from '../src/services/test-envs/program/runner-select.js';

/**
 * Unit tests for the `program` test type's runner selection — a pure
 * `(language, entry, file count, has libraries, has manifest) → { build?,
 * run }` decision (P4). No subprocess, no filesystem: every assertion is a
 * golden argv-array comparison.
 */
suite('program runner-select', () => {

	const RUN_DIR = '/tmp/leet-run-abc123';
	const javaEntry = path.join(RUN_DIR, 'Main.java');
	const rustEntry = path.join(RUN_DIR, 'main.rs');
	const pyEntry = path.join(RUN_DIR, 'main.py');
	const jsEntry = path.join(RUN_DIR, 'main.js');
	const tsEntry = path.join(RUN_DIR, 'main.ts');

	suite('java', () => {

		test('single file, no libs, no manifest selects javac/java — not maven (P4)', () => {
			const cmd = selectRunner({
				language: 'java', entryPath: javaEntry, fileCount: 1, hasLibs: false, hasManifest: false,
			});
			// `-d .` and `-cp .` rather than `dirname(entryPath)`: commands run
			// with the run dir as `cwd`, so for a flat entry these name the same
			// directory — the difference only shows on a nested entry, which is
			// the C22(b) case pinned below.
			assert.deepStrictEqual(cmd.build, ['javac', '-d', '.', javaEntry]);
			assert.deepStrictEqual(cmd.run, ['java', '-cp', '.', 'Main']);
			assert.ok(!cmd.build?.some(a => a.includes('mvn')), 'must not shell out to mvn');
			assert.ok(!cmd.run.some(a => a.includes('mvn')), 'must not shell out to mvn');
		});

		/**
		 * Regression test for the defect the coordinator caught: `libs:` for
		 * java is already resolved into the shared cache before a runner is
		 * ever selected (`maven.installer.ts` + `lib-env.helpers.ts`'s
		 * `CLASSPATH=<cache>/jars/*:.`). Escalating to Maven here would be a
		 * second, competing dependency resolve for the same coordinates, and
		 * emitting `-cp <dir>` would override that `CLASSPATH` outright and
		 * make the jars vanish at run time — exactly what `javaFunctionEnv`'s
		 * own `withLibs` comment (`java.env.ts:42-46`) warns against.
		 */
		test('declared libraries stay on javac/java — CLASSPATH governs, no -cp to shadow it', () => {
			const cmd = selectRunner({
				language: 'java', entryPath: javaEntry, fileCount: 1, hasLibs: true, hasManifest: false,
			});
			assert.deepStrictEqual(cmd.build, ['javac', '-d', '.', javaEntry]);
			assert.deepStrictEqual(cmd.run, ['java', 'Main']);
			assert.ok(!cmd.build?.some(a => a.includes('mvn')), 'must not shell out to mvn');
			assert.ok(!cmd.run.includes('-cp'), 'must not emit -cp — it would override CLASSPATH and hide the jars');
		});

		/**
		 * C22(b), found by the wave-2.C review. `javac <entry>` writes the
		 * `.class` **beside the source**, so a nested entry puts it in `src/`.
		 * The no-libs branch survives that by accident — its `-cp` is
		 * `dirname(entryPath)`, the very directory the class landed in. The
		 * libs branch drops `-cp` so `CLASSPATH=<cache>/jars/*:.` can govern,
		 * and that `.` is the **run root**, not `src/` — `ClassNotFoundException`
		 * on every nested-entry java program that declares a library.
		 *
		 * `-d .` on the build fixes both branches at once by putting the class
		 * where both classpaths already look, which is why the fix belongs on
		 * the build argv rather than in a second, nesting-aware `-cp`.
		 */
		test('a nested entry still resolves its class: the build targets the run root, not the source directory', () => {
			const nested = path.join(RUN_DIR, 'src', 'Main.java');
			const withLibs = selectRunner({
				language: 'java', entryPath: nested, fileCount: 1, hasLibs: true, hasManifest: false,
			});
			assert.deepStrictEqual(withLibs.build, ['javac', '-d', '.', nested]);
			assert.deepStrictEqual(withLibs.run, ['java', 'Main']);

			// The no-libs branch must agree — one output location, not two.
			const noLibs = selectRunner({
				language: 'java', entryPath: nested, fileCount: 1, hasLibs: false, hasManifest: false,
			});
			assert.deepStrictEqual(noLibs.build, ['javac', '-d', '.', nested]);
			assert.deepStrictEqual(noLibs.run, ['java', '-cp', '.', 'Main']);
		});

		test('an author-shipped manifest switches to the manifest-driven build even with one file and no libs', () => {
			const cmd = selectRunner({
				language: 'java', entryPath: javaEntry, fileCount: 1, hasLibs: false, hasManifest: true,
			});
			assert.deepStrictEqual(cmd.build, [
				'mvn', '-q', '-DskipTests', '-DoutputDirectory=target/deps', 'dependency:copy-dependencies', 'compile',
			]);
			assert.deepStrictEqual(cmd.run, ['java', '-cp', `target/classes${path.delimiter}target/deps/*`, 'Main']);
		});

		test('more than one file, alone, does NOT switch to the manifest-driven build — javac auto-discovers siblings from the entry', () => {
			const cmd = selectRunner({
				language: 'java', entryPath: javaEntry, fileCount: 3, hasLibs: false, hasManifest: false,
			});
			assert.deepStrictEqual(cmd.build, ['javac', '-d', '.', javaEntry]);
			assert.ok(!cmd.build?.some(a => a.includes('mvn')));
		});

		test('the build runs once; the run command never re-invokes the build tool (P1)', () => {
			const cmd = selectRunner({
				language: 'java', entryPath: javaEntry, fileCount: 1, hasLibs: false, hasManifest: true,
			});
			assert.strictEqual(cmd.run[0], 'java');
		});
	});

	suite('rust', () => {

		test('single file, no libs, no manifest selects rustc — not cargo (P4)', () => {
			const cmd = selectRunner({
				language: 'rust', entryPath: rustEntry, fileCount: 1, hasLibs: false, hasManifest: false,
			});
			assert.deepStrictEqual(cmd.build, ['rustc', '-O', rustEntry, '-o', 'leet_program']);
			assert.deepStrictEqual(cmd.run, ['./leet_program']);
			assert.ok(!cmd.build?.some(a => a.includes('cargo')), 'must not shell out to cargo');
		});

		test('declared libraries switch shape to a Cargo project, mirroring the function env', () => {
			const cmd = selectRunner({
				language: 'rust', entryPath: rustEntry, fileCount: 1, hasLibs: true, hasManifest: false,
			});
			assert.deepStrictEqual(cmd.build, ['cargo', 'build', '--offline', '--release', '--quiet']);
			assert.deepStrictEqual(cmd.run, ['cargo', 'run', '--offline', '--release', '--quiet', '--']);
		});

		/**
		 * C22(a), found by the wave-2.C review. The `program` runner appends
		 * each case's argv to `run` (P5 — one process per case), and `cargo
		 * run` consumes trailing arguments as **its own** options: `cargo run
		 * 5 7` fails with *unexpected argument*, and a `--flag` from an
		 * artifact reaches **cargo's** parser rather than the candidate's.
		 * Only `--` separates them, so it belongs in the selected argv rather
		 * than being spliced in by whoever calls this.
		 */
		test('the cargo run command ends in the -- separator, so per-case argv reaches the program', () => {
			for (const input of [
				{ hasLibs: true, hasManifest: false },
				{ hasLibs: false, hasManifest: true },
			]) {
				const cmd = selectRunner({ language: 'rust', entryPath: rustEntry, fileCount: 1, ...input });
				assert.strictEqual(cmd.run.at(-1), '--', JSON.stringify(cmd.run));
				// The separator is the *last* element: anything appended after it
				// is the program's, and nothing before it is.
				assert.deepStrictEqual(cmd.run, ['cargo', 'run', '--offline', '--release', '--quiet', '--']);
			}
		});

		test('the light rustc path needs no separator — the binary is invoked directly', () => {
			const cmd = selectRunner({
				language: 'rust', entryPath: rustEntry, fileCount: 1, hasLibs: false, hasManifest: false,
			});
			assert.ok(!cmd.run.includes('--'), 'a bare binary takes its argv directly');
		});

		test('an author-shipped manifest also switches to Cargo', () => {
			const cmd = selectRunner({
				language: 'rust', entryPath: rustEntry, fileCount: 1, hasLibs: false, hasManifest: true,
			});
			assert.ok(cmd.build?.includes('cargo'));
		});

		test('more than one file, alone, does NOT switch to Cargo — rustc follows `mod` declarations from the entry', () => {
			const cmd = selectRunner({
				language: 'rust', entryPath: rustEntry, fileCount: 2, hasLibs: false, hasManifest: false,
			});
			assert.deepStrictEqual(cmd.build, ['rustc', '-O', rustEntry, '-o', 'leet_program']);
			assert.ok(!cmd.build?.some(a => a.includes('cargo')));
		});
	});

	/**
	 * python/javascript/typescript have exactly one sensible answer regardless
	 * of the three inputs: no compiler, no manifest-driven build tool in their
	 * ecosystem's `program` shape, libraries reach the child through an
	 * environment variable set downstream — never through this module.
	 */
	suite('interpreted languages — single answer, no second branch', () => {

		test('python always runs the interpreter directly, no build step', () => {
			for (const hasLibs of [false, true]) {
				for (const hasManifest of [false, true]) {
					for (const fileCount of [1, 5]) {
						const cmd = selectRunner({ language: 'python', entryPath: pyEntry, fileCount, hasLibs, hasManifest });
						assert.deepStrictEqual(cmd, { run: ['python3', pyEntry] });
					}
				}
			}
		});

		test('javascript always runs node directly, no build step', () => {
			const cmd = selectRunner({
				language: 'javascript', entryPath: jsEntry, fileCount: 4, hasLibs: true, hasManifest: true,
			});
			assert.deepStrictEqual(cmd, { run: ['node', jsEntry] });
		});

		test('typescript runs node directly too — it never invokes tsc', () => {
			const cmd = selectRunner({
				language: 'typescript', entryPath: tsEntry, fileCount: 4, hasLibs: true, hasManifest: true,
			});
			assert.deepStrictEqual(cmd, { run: ['node', tsEntry] });
			assert.ok(!cmd.run.some(a => a.includes('tsc')));
		});
	});

	suite('purity and argv shape', () => {

		test('the same input always produces the same output', () => {
			const input = {
				language: 'java' as const, entryPath: javaEntry, fileCount: 1, hasLibs: false, hasManifest: false,
			};
			assert.deepStrictEqual(selectRunner(input), selectRunner(input));
		});

		test('the entry path is placed verbatim, never rewritten', () => {
			const oddEntry = path.join(RUN_DIR, 'sub dir', 'Weird Name.java');
			const cmd = selectRunner({
				language: 'java', entryPath: oddEntry, fileCount: 1, hasLibs: false, hasManifest: false,
			});
			assert.ok(cmd.build?.includes(oddEntry), 'entry path must appear verbatim as its own argv element');
		});

		test('every command is an argv array of strings, never a joined string', () => {
			const cmd = selectRunner({
				language: 'java', entryPath: javaEntry, fileCount: 1, hasLibs: true, hasManifest: false,
			});
			assert.ok(Array.isArray(cmd.build));
			assert.ok(Array.isArray(cmd.run));
			for (const arg of [...(cmd.build ?? []), ...cmd.run]) {
				assert.strictEqual(typeof arg, 'string');
			}
		});
	});
});
