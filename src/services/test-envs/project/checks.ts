import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type {
	CssAssertCheck,
	DomAssertCheck,
	ProjectCheckOutcome,
	RenderStep,
	TestCase,
} from '../../../types/leetcode.types.js';
import { canonicalJson } from '../../../utils/canonical-json.js';
import { safeJsonParse } from '../../../utils/safe-json.js';
import type { CaseOutcome } from '../env.types.js';
import { parseSentinelLines } from '../sentinel.helpers.js';
import { resolveLangId, runnableLangId } from '../../language-map.service.js';
import { resolveContained } from './files.writer.js';
import { ensureLibEnv } from '../../libs/lib-cache.service.js';
import { HARNESS_LIBS, RENDER_RUNNER, type RenderCase, renderRunnerSource } from './render.driver.js';

const execFileAsync = promisify(execFile);

/** A check graded by mounting a component. */
export type RenderCheck = DomAssertCheck | CssAssertCheck;

/** Steps that produce a value. A case's last step must be one of these. */
const READING_OPS = new Set(['text', 'count', 'attr', 'style']);

/** Steps a `css-assert` may use — reading only, and no event may be fired. */
const CSS_OPS = new Set(['text', 'count', 'attr', 'style']);

/** Every step the driver implements. */
const ALL_OPS = new Set(['click', 'change', ...READING_OPS]);

/**
 * Style properties whose real answer comes from layout.
 *
 * jsdom computes none of it, so these are **refused** rather than answered from
 * whatever happens to be declared inline — an author asking for `width` wants
 * the rendered box, and returning `''` (or a declared `10px` that the layout
 * would have overridden) is a confident wrong answer.
 *
 * ponytail: swap this refusal for a real read if grading ever moves to a
 * layout-capable headless browser; the vocabulary does not change, only the
 * engine behind it.
 */
const LAYOUT_PREFIXES = ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding', 'inset', 'border'];

/** React itself, when the artifact declares none — the driver has to mount with something. */
const DEFAULT_REACT = ['react@^19.0.0', 'react-dom@^19.0.0'];

/** One render is a bundle plus a mount per case; slower than a test case, still bounded. */
const RENDER_TIMEOUT_MS = 180_000;

/**
 * Check that every case of a render check is answerable **before** anything is
 * installed, bundled or mounted.
 *
 * Three separate refusals, all reported as one plain sentence: a malformed step
 * list (the artifact is untrusted text), a case that ends without reading
 * anything (there would be no observed value to compare), and — the one that
 * matters most — a `css-assert` asking for layout geometry, which jsdom cannot
 * answer at all.
 *
 * @param check - The `dom-assert` / `css-assert` check to validate.
 * @returns The first problem, or `null` when every case is answerable.
 *
 * @example
 * validateRenderCheck({ kind: 'css-assert', name: 'styled', file: 'a.jsx',
 *   cases: [{ input: { steps: [{ op: 'style', selector: '#b', property: 'width' }] }, expected: '1px' }] });
 * // → "css-assert 'styled' case 0: 'width' is a layout property …"
 */
export function validateRenderCheck(check: RenderCheck): string | null {
	if (check.cases.length === 0) {
		return `${check.kind} '${check.name}' declares no cases — it would pass without asserting anything`;
	}

	// jsdom mounts a **JavaScript** bundle. A python or rust file has no
	// component to render, and esbuild would fail with its own message far from
	// the cause — so the refusal is named here, at validation.
	const language = runnableLangId(resolveLangId(path.extname(check.file).replace('.', '')));
	if (!BUNDLEABLE.has(language)) {
		return `${check.kind} '${check.name}': '${check.file}' is ${language}, and jsdom can only mount a JavaScript bundle`;
	}

	for (const [index, testCase] of check.cases.entries()) {
		const reason = validateCase(check, testCase, index);
		if (reason) { return reason; }
	}
	return null;
}

/** Validate one case's step list against the check's allowed vocabulary. */
function validateCase(check: RenderCheck, testCase: TestCase, index: number): string | null {
	const where = `${check.kind} '${check.name}' case ${index}`;
	const steps = testCase.input.steps;
	if (!Array.isArray(steps) || steps.length === 0) {
		return `${where}: input.steps must be a non-empty array of render steps`;
	}

	const allowed = check.kind === 'css-assert' ? CSS_OPS : ALL_OPS;
	for (const step of steps) {
		const reason = validateStep(step, allowed, where, check.kind);
		if (reason) { return reason; }
	}

	const last = steps.at(-1) as { op?: unknown };
	if (typeof last.op !== 'string' || !READING_OPS.has(last.op)) {
		return `${where}: the last step must read something (text, count, attr or style) — otherwise the case observes no value`;
	}
	return null;
}

/** Validate a single step: known op, allowed for this kind, string selector, answerable. */
function validateStep(raw: unknown, allowed: Set<string>, where: string, kind: RenderCheck['kind']): string | null {
	if (typeof raw !== 'object' || raw === null) { return `${where}: each step must be an object`; }

	const step = raw as { op?: unknown; selector?: unknown; property?: unknown };
	if (typeof step.op !== 'string' || !ALL_OPS.has(step.op)) {
		return `${where}: unknown step op ${JSON.stringify(step.op)}`;
	}
	if (!allowed.has(step.op)) {
		return `${where}: a ${kind} may not use '${step.op}' — firing events is what a dom-assert is for`;
	}
	if (typeof step.selector !== 'string' || step.selector === '') {
		return `${where}: step '${step.op}' needs a selector string`;
	}
	if (step.op === 'style') {
		if (typeof step.property !== 'string' || step.property === '') {
			return `${where}: step 'style' needs a property name`;
		}
		if (isLayoutProperty(step.property)) {
			return `${where}: '${step.property}' is a layout property and the render environment (jsdom) computes no layout —`
				+ ' assert a class, an attribute, or a non-geometry declared style instead';
		}
	}
	return null;
}

/** Whether a style property's honest answer would require layout. */
function isLayoutProperty(property: string): boolean {
	const name = property.toLowerCase();
	return LAYOUT_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * Map a check's cases onto driver cases, numbered by position.
 *
 * The position **is** the identity: the driver echoes the index back on its
 * sentinel line, and grading pairs them up by it.
 *
 * @param check - A validated render check.
 * @returns Driver cases, in order.
 *
 * @example
 * renderCasesFor(check).map(c => c.index); // → [0, 1, 2]
 */
export function renderCasesFor(check: RenderCheck): RenderCase[] {
	return check.cases.map((testCase, index) => ({
		index,
		steps: testCase.input.steps as RenderStep[],
	}));
}

/**
 * Turn the driver's per-case outcomes into one verdict for the check.
 *
 * Comparison runs through `canonicalJson` on both sides — the same path the
 * function environments use — so object key order never decides a verdict.
 * A case with **no** sentinel line fails: a crashed or killed driver must not
 * read as an empty, therefore passing, suite.
 *
 * @param check    - The check being graded.
 * @param outcomes - Sentinel outcomes recovered from the driver's stdout.
 * @returns Pass/fail plus the first failure's detail.
 *
 * @example
 * gradeRenderOutcomes(check, [{ index: 0, actual: '"X"', ms: 2 }]); // → { name: …, passed: true }
 */
export function gradeRenderOutcomes(check: RenderCheck, outcomes: CaseOutcome[]): ProjectCheckOutcome {
	const byIndex = new Map(outcomes.map(o => [o.index, o]));

	for (const [index, testCase] of check.cases.entries()) {
		const outcome = byIndex.get(index);
		if (!outcome) {
			return fail(check, `case ${index}: no result — the render driver produced no line for it`);
		}
		if (outcome.error) {
			return fail(check, `case ${index}: ${outcome.error}`);
		}

		const observed = canonicalJson(safeJsonParse(outcome.actual ?? 'null'));
		const expected = canonicalJson(testCase.expected);
		if (observed !== expected) {
			return fail(check, `case ${index}: expected ${expected}, got ${observed}`);
		}
	}
	return { name: check.name, passed: true };
}

/** A red verdict carrying the reason. */
function fail(check: RenderCheck, detail: string): ProjectCheckOutcome {
	return { name: check.name, passed: false, detail };
}

/**
 * Libraries a render run needs: the harness toolchain, plus the artifact's own
 * declarations, plus React when the artifact names none.
 *
 * @param artifactLibs - `libs:` entries declared for the run's language.
 * @returns Specs to install into the shared cache.
 *
 * @example
 * renderLibsFor(['react@^18.0.0']); // → ['esbuild@…', 'jsdom@…', 'react@^18.0.0']
 */
/** Languages the render driver can bundle and mount. */
const BUNDLEABLE = new Set(['javascript', 'typescript']);

export function renderLibsFor(artifactLibs: readonly string[] = []): string[] {
	const declaresReact = artifactLibs.some(lib => lib.startsWith('react@') || lib === 'react');
	return [...HARNESS_LIBS, ...artifactLibs, ...(declaresReact ? [] : DEFAULT_REACT)];
}

/**
 * Run one render check end to end: validate, install, bundle, mount, grade.
 *
 * Every failure mode reduces to a red check with a reason — a refused case, an
 * escaping `file:`, an install that could not complete, a driver that died.
 * Nothing throws out of here, because a check failing is a normal result and
 * the panel has one place to render it.
 *
 * `resolveContained` runs on `check.file` before anything installs or bundles
 * — a render check is the fourth artifact-declared path into the run
 * directory (the parser does not validate it, unlike the `## Files` writer
 * and the `function` check's own `file`), so an escaping entry must be
 * refused here rather than handed to esbuild's `entryPoints`.
 *
 * @param check        - The check to run.
 * @param runDir       - Run directory holding the materialised `## Files` tree.
 * @param artifactLibs - `libs:` for the run's language — ignored when `cacheDir` is given.
 * @param cacheDir     - Already-installed cache dir (§B.1: one install per grading run,
 *                       done once in `gradeProjectDir`). Omitted only by direct/E2E callers,
 *                       which still install their own.
 * @param apiPort      - The loopback port a live backend was booted on for this run
 *                       (T4.3 round 2, VSX-180) — `gradeProjectDir`'s
 *                       `apiPortForRenderCheck` decides this; omitted means no
 *                       backend, and the mounted component's `fetch` refuses
 *                       every request by default.
 * @returns The check's verdict.
 *
 * @example
 * await runRenderCheck(domCheck, '/tmp/run', ['react@^19.0.0']);
 */
export async function runRenderCheck(
	check: RenderCheck, runDir: string, artifactLibs: readonly string[] = [], cacheDir?: string, apiPort?: number,
): Promise<ProjectCheckOutcome> {
	// Containment first, always: an escaping path is the security answer, and it
	// must not be pre-empted by a cosmetic complaint about the file's language.
	try {
		resolveContained(runDir, check.file);
	} catch (e) {
		return fail(check, e instanceof Error ? e.message : String(e));
	}

	const invalid = validateRenderCheck(check);
	if (invalid) { return fail(check, invalid); }

	let dir = cacheDir;
	if (!dir) {
		const installed = await ensureLibEnv('pnpm', renderLibsFor(artifactLibs));
		if (!installed.ok) { return fail(check, installed.reason); }
		dir = installed.dir;
	}

	try {
		await fs.writeFile(
			path.join(runDir, RENDER_RUNNER),
			renderRunnerSource({ entry: check.file, cacheDir: dir, cases: renderCasesFor(check), apiPort }),
			'utf-8',
		);
		const { stdout } = await execFileAsync(process.execPath, [RENDER_RUNNER], {
			cwd: runDir, timeout: RENDER_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024,
		});
		return gradeRenderOutcomes(check, parseSentinelLines(stdout));
	} catch (e) {
		// A kill still returns the stdout already produced, so grade what arrived:
		// the cases that reported keep their real verdict, the rest fail as missing.
		const stdout = typeof e === 'object' && e !== null ? (e as { stdout?: string }).stdout ?? '' : '';
		const outcomes = parseSentinelLines(stdout);
		if (outcomes.length > 0) { return gradeRenderOutcomes(check, outcomes); }
		return fail(check, `render failed: ${e instanceof Error ? e.message : String(e)}`);
	}
}
