import * as assert from 'node:assert';
import { isSafeExposeName, MAX_PACKAGES, parsePackages } from '../src/services/packages-parser.helpers.js';

/**
 * Unit tests for the `packages:` config-block grammar (T3.1) — the
 * `leetcodeType: stack` boot list that replaces the unparsed `services:` key.
 *
 * The block is untrusted `.md` text: a string `install`/`start`, a `${…}`
 * other than `PORT`, an absolute or traversing `dir`, a 200-entry list, an
 * `exposeAs` naming a loader variable, and a `__proto__` field name are all
 * fixtures here on purpose — every one must degrade to a documented default
 * (or, for a `dependsOn` cycle, a hard parse error) rather than throw or
 * reach through a prototype.
 */
suite('packages parser', () => {

	const warnings: string[] = [];
	const warn = (m: string): void => { warnings.push(m); };

	setup(() => { warnings.length = 0; });

	test('absent packages: block parses to an empty list, ok, no warnings', () => {
		const result = parsePackages(['title: X'], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.deepStrictEqual(warnings, []);
	});

	test('a malformed header (packages: not a list) parses to an empty list and warns', () => {
		const result = parsePackages(['packages: nope'], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('packages')), warnings.join(' | '));
	});

	// ── the full shape together ──────────────────────────────────────────────────

	test('a fully declared two-package block parses every field, including nested exposeAs', () => {
		const lines = [
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["pip", "install", "-r", "requirements.txt"]',
			'    start: ["uvicorn", "main:app", "--host", "127.0.0.1", "--port", "${PORT}"]',
			'    ready: "Uvicorn running"',
			'    exposeAs:',
			'      VITE_API_URL: "http://127.0.0.1:${PORT}"',
			'  - name: web',
			'    dir: client',
			'    install: ["npm", "ci"]',
			'    start: ["npm", "run", "dev", "--", "--port", "${PORT}"]',
			'    ready: "ready in"',
			'    dependsOn: [api]',
		];
		const result = parsePackages(lines, warn);
		assert.deepStrictEqual(result, {
			ok: true,
			packages: [
				{
					name: 'api',
					dir: 'server',
					install: ['pip', 'install', '-r', 'requirements.txt'],
					start: ['uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '${PORT}'],
					ready: 'Uvicorn running',
					exposeAs: { VITE_API_URL: 'http://127.0.0.1:${PORT}' },
				},
				{
					name: 'web',
					dir: 'client',
					install: ['npm', 'ci'],
					start: ['npm', 'run', 'dev', '--', '--port', '${PORT}'],
					ready: 'ready in',
					dependsOn: ['api'],
				},
			],
		});
		assert.deepStrictEqual(warnings, []);
	});

	// ── required fields, dropped not thrown ──────────────────────────────────────

	test('an entry missing name is dropped with a warning, siblings survive', () => {
		const result = parsePackages([
			'packages:',
			'  - dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'  - name: web',
			'    dir: client',
			'    install: ["npm", "ci"]',
			'    start: ["npm", "run", "dev"]',
		], warn);
		assert.ok(result.ok);
		if (result.ok) {
			assert.strictEqual(result.packages.length, 1);
			assert.strictEqual(result.packages[0].name, 'web');
		}
		assert.ok(warnings.some(w => w.includes('name')), warnings.join(' | '));
	});

	// ── install / start: argv arrays, never command strings (S5) ────────────────

	test('a string form for install is refused, not spliced into a shell command', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: "pip install -r requirements.txt"',
			'    start: ["uvicorn", "main:app"]',
		], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('install') && w.includes('JSON array')), warnings.join(' | '));
	});

	test('a bare, unquoted command string for start is refused the same way', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["pip", "install"]',
			'    start: npm run dev',
		], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('start')), warnings.join(' | '));
	});

	test('${PORT} survives as a distinct argv element, never joined into one string', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["pip", "install"]',
			'    start: ["uvicorn", "--port", "${PORT}"]',
		], warn);
		assert.ok(result.ok);
		const start = result.ok ? result.packages[0].start : [];
		assert.strictEqual(start.length, 3);
		assert.strictEqual(start[2], '${PORT}');
	});

	test('a ${…} substitution other than PORT is refused in an argv element', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["pip", "install"]',
			'    start: ["uvicorn", "--port", "${SECRET}"]',
		], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('${SECRET}') || w.includes('SECRET')), warnings.join(' | '));
	});

	// ── dir: a shape guard, not containment (mirrors program-config's entry) ────

	test('an absolute dir is refused, not resolved', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: /etc',
			'    install: ["a"]',
			'    start: ["b"]',
		], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('/etc')), warnings.join(' | '));
	});

	test('dir: ../.. is refused — a `..` segment can never become a contained path', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: ../..',
			'    install: ["a"]',
			'    start: ["b"]',
		], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('..')), warnings.join(' | '));
	});

	test('a node_modules segment in dir is refused, case-insensitively', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: client/NODE_MODULES/x',
			'    install: ["a"]',
			'    start: ["b"]',
		], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('node_modules')), warnings.join(' | '));
	});

	// ── hard cap on entry count (S7) ─────────────────────────────────────────────

	test('a 200-entry list is a parse error, not a silent truncation to the cap', () => {
		// A truncate-and-warn would drop the tail of the list; if a survivor's
		// `dependsOn` names one of the dropped entries, that reads as a clean
		// parse with a dangling edge (the false-green class the cycle check
		// exists for). Over-cap must therefore refuse the whole block.
		const lines = ['packages:'];
		for (let i = 0; i < 200; i++) {
			lines.push(`  - name: pkg${i}`, '    dir: d', '    install: ["a"]', '    start: ["b"]');
		}
		const result = parsePackages(lines, warn);
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.ok(result.error.includes('200'));
			assert.ok(result.error.includes(String(MAX_PACKAGES)));
		}
	});

	test('a dropped-by-cap dependency never surfaces as a dangling edge in a clean parse', () => {
		const lines = ['packages:'];
		for (let i = 0; i < MAX_PACKAGES + 1; i++) {
			lines.push(
				`  - name: pkg${i}`, '    dir: d', '    install: ["a"]', '    start: ["b"]',
				...(i === 0 ? [`    dependsOn: [pkg${MAX_PACKAGES}]`] : []),
			);
		}
		const result = parsePackages(lines, warn);
		assert.strictEqual(result.ok, false);
	});

	// ── every name is unique — the graph is name-keyed ───────────────────────────

	test('a duplicate package name is refused, not silently collapsed in the dependsOn graph', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: one',
			'    install: ["a"]',
			'    start: ["b"]',
			'    dependsOn: [db]',
			'  - name: api',
			'    dir: two',
			'    install: ["c"]',
			'    start: ["d"]',
		], warn);
		assert.strictEqual(result.ok, false);
		if (!result.ok) { assert.ok(result.error.includes('api')); }
	});

	// ── install / start must be able to boot something ──────────────────────────

	test('an empty install argv is refused — nothing to run is not a valid step', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: []',
			'    start: ["uvicorn"]',
		], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('install') && w.includes('empty')), warnings.join(' | '));
	});

	test('an empty start argv is refused — an unbootable package is not a valid entry', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["pip", "install"]',
			'    start: []',
		], warn);
		assert.deepStrictEqual(result, { ok: true, packages: [] });
		assert.ok(warnings.some(w => w.includes('start') && w.includes('empty')), warnings.join(' | '));
	});

	// ── exposeAs: variable name is validated (S9) ────────────────────────────────

	test('exposeAs: LD_PRELOAD is refused — a loader variable can never be named', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'    exposeAs:',
			'      LD_PRELOAD: "http://127.0.0.1:${PORT}"',
		], warn);
		assert.ok(result.ok);
		assert.strictEqual(result.ok && result.packages[0].exposeAs, undefined);
		assert.ok(warnings.some(w => w.includes('LD_PRELOAD')), warnings.join(' | '));
	});

	// Every name test below must carry a **valid** value. `EXPOSE_VALUE_RE` runs in
	// the same function, so an invalid value refuses the entry on its own — with a
	// warning that still names the variable, satisfying both assertions whether or
	// not the name rule fired at all. This fixture shipped as `"x"` and was vacuous
	// for exactly that reason: neutering the `DYLD_` branch left the suite green.
	test('a DYLD_-prefixed exposeAs name is refused by the wildcard denylist entry', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'    exposeAs:',
			'      DYLD_INSERT_LIBRARIES: "http://127.0.0.1:${PORT}"',
		], warn);
		assert.ok(result.ok);
		assert.strictEqual(result.ok && result.packages[0].exposeAs, undefined);
		assert.ok(warnings.some(w => w.includes('DYLD_INSERT_LIBRARIES')), warnings.join(' | '));
	});

	/**
	 * `PORT` is not a loader variable — it is the one name `server.lifecycle.ts`
	 * sets **itself**, from its own `:0`-minted port. It passed every check here
	 * (shape ✓, not in the denylist, not a lib-seam var), so a dependency
	 * declaring it overwrote the *dependent's* minted port with the dependency's
	 * URL: measured end to end, `web` saw `PORT=http://127.0.0.1:52182` and
	 * exited before ever binding. Fails closed, never a false green — but an
	 * author writing this has a bug, and a named parse-time refusal beats a boot
	 * timeout three layers down. Carries a valid value on purpose (see above).
	 */
	test('exposeAs: PORT is refused — it is the one variable the booter sets itself', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'    exposeAs:',
			'      PORT: "http://127.0.0.1:${PORT}"',
		], warn);
		assert.ok(result.ok);
		assert.strictEqual(result.ok && result.packages[0].exposeAs, undefined);
		assert.ok(warnings.some(w => w.includes('PORT')), warnings.join(' | '));
	});

	test('isSafeExposeName refuses PORT — the predicate server.lifecycle.ts composes a child env through', () => {
		assert.strictEqual(isSafeExposeName('PORT'), false);
		assert.strictEqual(isSafeExposeName('VITE_API_URL'), true, 'an ordinary name must still pass');
	});

	test('an exposeAs name outside ^[A-Z][A-Z0-9_]*$ is refused, valid siblings survive', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'    exposeAs:',
			'      lowercase_name: "x"',
			'      VITE_API_URL: "http://127.0.0.1:${PORT}"',
		], warn);
		assert.ok(result.ok);
		assert.deepStrictEqual(
			result.ok ? result.packages[0].exposeAs : undefined,
			{ VITE_API_URL: 'http://127.0.0.1:${PORT}' },
		);
		assert.ok(warnings.some(w => w.includes('lowercase_name')), warnings.join(' | '));
	});

	// ── entry-line grouping: exposeAs as the first field (finding 7) ────────────

	test('exposeAs as an entry\'s first field does not swallow its siblings', () => {
		const result = parsePackages([
			'packages:',
			'  - exposeAs:',
			'      VITE_API_URL: "http://127.0.0.1:${PORT}"',
			'    name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
		], warn);
		assert.ok(result.ok);
		if (result.ok) {
			assert.strictEqual(result.packages.length, 1);
			const pkg = result.packages[0];
			assert.strictEqual(pkg.name, 'api');
			assert.strictEqual(pkg.dir, 'server');
			assert.deepStrictEqual(pkg.exposeAs, { VITE_API_URL: 'http://127.0.0.1:${PORT}' });
		}
	});

	// ── __proto__: an unrecognised field, never a prototype write (C7's trap) ───

	test('__proto__ under a package entry is an unrecognised field, never a prototype write', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'    __proto__: pwn',
			'    constructor: evil',
		], warn);
		assert.ok(result.ok);
		const pkg = result.ok ? result.packages[0] : undefined;
		assert.strictEqual(Object.getPrototypeOf(pkg), Object.prototype);
		assert.deepStrictEqual(Object.keys(pkg ?? {}).sort(), ['dir', 'install', 'name', 'start']);
	});

	test('__proto__ as an exposeAs name is refused by the name pattern — proven, not assumed', () => {
		// A `__proto__: pwn` fixture alone is vacuous here (finding 3): assigning
		// a *string* to an object literal's `__proto__` is a silent no-op in JS
		// regardless of whether `EXPOSE_NAME_RE` runs at all, so `exposeAs` would
		// end up `undefined` either way and the test could not tell "checked and
		// refused" from "never checked". Two things make it non-vacuous instead:
		// a valid sibling forces `exposeAs` to actually exist, and the warning
		// message is asserted directly — the one signal that only fires when the
		// name-pattern branch actually ran and actually rejected `__proto__`.
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'    exposeAs:',
			'      __proto__: "http://127.0.0.1:${PORT}"',
			'      VITE_API_URL: "http://127.0.0.1:${PORT}"',
		], warn);
		assert.ok(result.ok);
		if (result.ok) {
			const pkg = result.packages[0];
			assert.strictEqual(Object.getPrototypeOf(pkg), Object.prototype);
			assert.deepStrictEqual(pkg.exposeAs, { VITE_API_URL: 'http://127.0.0.1:${PORT}' });
			assert.deepStrictEqual(Object.keys(pkg.exposeAs ?? {}), ['VITE_API_URL']);
		}
		assert.ok(warnings.some(w => w.includes('__proto__')), warnings.join(' | '));
	});

	// ── exposeAs: the library-installer seam is denylisted too, derived not hand-copied (SEC1) ──

	test('exposeAs: NODE_PATH is refused — pnpm\'s own module-resolution seam, derived from libEnvVars', () => {
		const result = parsePackages([
			'packages:', '  - name: api', '    dir: server', '    install: ["a"]', '    start: ["b"]',
			'    exposeAs:', '      NODE_PATH: "http://127.0.0.1:${PORT}"',
		], warn);
		assert.ok(result.ok);
		if (result.ok) { assert.strictEqual(result.packages[0].exposeAs, undefined); }
		assert.ok(warnings.some(w => w.includes('NODE_PATH')), warnings.join(' | '));
	});

	test('exposeAs: CARGO_TARGET_DIR is refused — the cargo cache seam, derived from libEnvVars', () => {
		const result = parsePackages([
			'packages:', '  - name: api', '    dir: server', '    install: ["a"]', '    start: ["b"]',
			'    exposeAs:', '      CARGO_TARGET_DIR: "http://127.0.0.1:${PORT}"',
		], warn);
		assert.ok(result.ok);
		if (result.ok) { assert.strictEqual(result.packages[0].exposeAs, undefined); }
	});

	test('exposeAs: JDK_JAVA_OPTIONS is refused — a JVM agent-injection variable, on the explicit half of the denylist', () => {
		const result = parsePackages([
			'packages:', '  - name: api', '    dir: server', '    install: ["a"]', '    start: ["b"]',
			'    exposeAs:', '      JDK_JAVA_OPTIONS: "http://127.0.0.1:${PORT}"',
		], warn);
		assert.ok(result.ok);
		if (result.ok) { assert.strictEqual(result.packages[0].exposeAs, undefined); }
		assert.ok(warnings.some(w => w.includes('JDK_JAVA_OPTIONS')), warnings.join(' | '));
	});

	// ── exposeAs: the value shape is a loopback URL template, nothing else (SEC2) ──

	test('exposeAs value must be a loopback URL template — an arbitrary path is refused even with a fine name', () => {
		const result = parsePackages([
			'packages:', '  - name: api', '    dir: server', '    install: ["a"]', '    start: ["b"]',
			'    exposeAs:', '      API_URL: /tmp/whatever',
		], warn);
		assert.ok(result.ok);
		if (result.ok) { assert.strictEqual(result.packages[0].exposeAs, undefined); }
		assert.ok(warnings.some(w => w.includes('API_URL')), warnings.join(' | '));
	});

	test('exposeAs value must be a loopback URL template — a smuggled JVM agent flag is refused', () => {
		const result = parsePackages([
			'packages:', '  - name: api', '    dir: server', '    install: ["a"]', '    start: ["b"]',
			'    exposeAs:', '      API_URL: "-javaagent:/tmp/a.jar"',
		], warn);
		assert.ok(result.ok);
		if (result.ok) { assert.strictEqual(result.packages[0].exposeAs, undefined); }
	});

	test('exposeAs value must be loopback — a non-127.0.0.1 host is refused (S1 stays true here too)', () => {
		const result = parsePackages([
			'packages:', '  - name: api', '    dir: server', '    install: ["a"]', '    start: ["b"]',
			'    exposeAs:', '      API_URL: "http://evil.example:${PORT}"',
		], warn);
		assert.ok(result.ok);
		if (result.ok) { assert.strictEqual(result.packages[0].exposeAs, undefined); }
	});

	// ── dependsOn: a cycle is a parse ERROR, not a warning ───────────────────────

	test('a two-package dependsOn cycle is a parse error, not a warning — the first failing test', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'    dependsOn: [web]',
			'  - name: web',
			'    dir: client',
			'    install: ["c"]',
			'    start: ["d"]',
			'    dependsOn: [api]',
		], warn);
		assert.strictEqual(result.ok, false);
		if (!result.ok) {
			assert.ok(result.error.includes('api'));
			assert.ok(result.error.includes('web'));
		}
		// Distinct channel from `warn` — a cycle must not merely be logged as a warning.
		assert.ok(!warnings.some(w => w.includes('cycle')), warnings.join(' | '));
	});

	test('a package depending on itself is a one-node cycle, also a parse error', () => {
		const result = parsePackages([
			'packages:',
			'  - name: api',
			'    dir: server',
			'    install: ["a"]',
			'    start: ["b"]',
			'    dependsOn: [api]',
		], warn);
		assert.strictEqual(result.ok, false);
	});

	test('a non-cyclic dependsOn chain parses fine, no error', () => {
		const result = parsePackages([
			'packages:',
			'  - name: db',
			'    dir: db',
			'    install: ["a"]',
			'    start: ["b"]',
			'  - name: api',
			'    dir: server',
			'    install: ["c"]',
			'    start: ["d"]',
			'    dependsOn: [db]',
			'  - name: web',
			'    dir: client',
			'    install: ["e"]',
			'    start: ["f"]',
			'    dependsOn: [api]',
		], warn);
		assert.ok(result.ok);
		assert.strictEqual(result.ok && result.packages.length, 3);
	});

	// ── isSafeExposeName: the one authority server.lifecycle.ts reuses (T4.1, item 5) ──

	suite('isSafeExposeName — the exported allowlist server.lifecycle.ts reuses', () => {
		test('accepts a well-shaped, non-reserved name', () => {
			assert.strictEqual(isSafeExposeName('VITE_API_URL'), true);
		});

		test('refuses a loader/interpreter variable', () => {
			assert.strictEqual(isSafeExposeName('PATH'), false);
			assert.strictEqual(isSafeExposeName('LD_PRELOAD'), false);
			assert.strictEqual(isSafeExposeName('DYLD_INSERT_LIBRARIES'), false);
		});

		test('refuses this extension\'s own library-seam variables, derived from libEnvVars', () => {
			assert.strictEqual(isSafeExposeName('NODE_PATH'), false);
			assert.strictEqual(isSafeExposeName('VIRTUAL_ENV'), false);
			assert.strictEqual(isSafeExposeName('CLASSPATH'), false);
			assert.strictEqual(isSafeExposeName('CARGO_TARGET_DIR'), false);
		});

		test('refuses a name outside ^[A-Z][A-Z0-9_]*$', () => {
			assert.strictEqual(isSafeExposeName('lowercase'), false);
			assert.strictEqual(isSafeExposeName('__proto__'), false);
			assert.strictEqual(isSafeExposeName(''), false);
		});
	});
});
