import * as assert from 'node:assert';
import {
	allInfrastructure,
	classifyStarterFailure,
	infrastructureCount,
} from '../src/services/exercise-verify/starter-red.helpers.js';

/**
 * VSX-122 T3.8 (ledger C14) — `--starter-red`'s pass condition is "some
 * check/case failed", which a broken toolchain satisfies exactly as an
 * incomplete starter does. `classifyStarterFailure` is the fix: a pure text
 * classifier over the exact failure-detail shapes this codebase's
 * `lib-cache.service.ts`, `program.runner.ts`, `project.runner.ts` and
 * `server.lifecycle.ts` actually produce.
 */
suite('starter-red.helpers — infrastructure vs candidate classification', () => {

	test('a swept library cache reads as infrastructure', () => {
		assert.strictEqual(classifyStarterFailure("Cannot find module 'jsdom'"), 'infrastructure');
	});

	test('a genuine candidate mismatch reads as candidate', () => {
		assert.strictEqual(classifyStarterFailure('case 0: expected 3, got 0'), 'candidate');
	});

	test('an assertion-shaped detail reads as candidate', () => {
		assert.strictEqual(
			classifyStarterFailure('case 1: expected "[0,1]", got "[]"'),
			'candidate',
		);
	});

	test('a failed library install reads as infrastructure', () => {
		assert.strictEqual(
			classifyStarterFailure('install failed: npm ERR! network timeout'),
			'infrastructure',
		);
	});

	test('a missing toolchain binary reads as infrastructure', () => {
		assert.strictEqual(
			classifyStarterFailure('mvn not found — install Maven to run library-backed Java exercises'),
			'infrastructure',
		);
	});

	test('a compile timeout before any case ran reads as infrastructure', () => {
		assert.strictEqual(classifyStarterFailure('compilation timed out'), 'infrastructure');
	});

	// Round-2 fix (reviewer measurement): `compilation error: …` is NOT an
	// infrastructure pattern. A starter that genuinely does not compile is the
	// canonical ships-unsolved state for java/rust/typescript, and treating
	// every compiler diagnostic as toolchain noise certified a real red starter
	// INCONCLUSIVE with the compiler's own diagnostic printed directly beneath
	// the claim that nothing here is evidence.
	test('a real compiler diagnostic reads as candidate — the canonical ships-unsolved starter', () => {
		assert.strictEqual(
			classifyStarterFailure("compilation error: error[E0425]: cannot find function `add` in this scope"),
			'candidate',
		);
		assert.strictEqual(
			classifyStarterFailure('compilation error: Main.java:3: error: cannot find symbol'),
			'candidate',
		);
	});

	test('a genuinely missing compiler still reads as infrastructure via the spawn-ENOENT shape', () => {
		assert.strictEqual(classifyStarterFailure('compilation error: spawn rustc ENOENT'), 'infrastructure');
	});

	test('no registered environment for the triple reads as infrastructure', () => {
		assert.strictEqual(
			classifyStarterFailure("no call environment for 'cobol'"),
			'infrastructure',
		);
		assert.strictEqual(
			classifyStarterFailure("program: no program environment for 'cobol'"),
			'infrastructure',
		);
	});

	test('the one-element "never ran" program shape reads as infrastructure', () => {
		assert.strictEqual(
			classifyStarterFailure('program: no `program:` block declared'),
			'infrastructure',
		);
		assert.strictEqual(
			classifyStarterFailure('program: `## Files` names no runnable language'),
			'infrastructure',
		);
	});

	test('a boot-readiness timeout reads as infrastructure', () => {
		assert.strictEqual(
			classifyStarterFailure("server never started: packages: 'api' — server never became ready"),
			'infrastructure',
		);
	});

	test('a missing interpreter binary (spawn ENOENT) reads as infrastructure', () => {
		assert.strictEqual(classifyStarterFailure('spawn python3 ENOENT'), 'infrastructure');
	});

	test('a bare ENOENT inside candidate-shaped text stays candidate — not the spawn-failure shape', () => {
		assert.strictEqual(
			classifyStarterFailure("Error: ENOENT: no such file or directory, open 'data.json'"),
			'candidate',
		);
	});

	test('a server that starts and then crashes reads as candidate — the starter\'s own code', () => {
		assert.strictEqual(
			classifyStarterFailure(
				"server never started: packages: 'api' — the spawned process exited before the server became ready",
			),
			'candidate',
		);
	});

	test('a missing $LEET_OUT file — the program simply never wrote an answer — reads as candidate', () => {
		assert.strictEqual(
			classifyStarterFailure('the program wrote no $LEET_OUT file (it may have crashed or timed out)'),
			'candidate',
		);
	});

	// Round-2 fix (reviewer measurement): a candidate's own bad relative
	// `require` reaches a case's error as verbatim child stderr in the exact
	// same `Cannot find module '…'` shape a swept cache produces — narrowed to
	// exclude a leading `.` or `/`, which only the starter's own file paths use.
	test("a candidate's own relative-path require miss reads as candidate, not infrastructure", () => {
		assert.strictEqual(classifyStarterFailure("Cannot find module './helper.js'"), 'candidate');
	});

	test('a bare package-name require miss still reads as infrastructure — not widened back', () => {
		assert.strictEqual(classifyStarterFailure("Cannot find module 'lodash'"), 'infrastructure');
	});

	test('an undefined detail (no message at all) reads as candidate', () => {
		assert.strictEqual(classifyStarterFailure(undefined), 'candidate');
	});

	test('allInfrastructure is true only when every failure is infrastructure', () => {
		assert.strictEqual(allInfrastructure(["Cannot find module 'jsdom'"]), true);
		assert.strictEqual(
			allInfrastructure(["Cannot find module 'jsdom'", 'case 0: expected 3, got 0']),
			false,
		);
		assert.strictEqual(allInfrastructure([]), false);
	});

	test('infrastructureCount tallies only the infrastructure failures', () => {
		assert.strictEqual(
			infrastructureCount(["Cannot find module 'jsdom'", 'case 0: expected 3, got 0', 'install failed: x']),
			2,
		);
		assert.strictEqual(infrastructureCount(['case 0: expected 3, got 0']), 0);
	});
});
