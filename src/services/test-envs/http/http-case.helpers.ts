import { canonicalJson } from '../../../utils/canonical-json.js';
import { safeJsonParse } from '../../../utils/safe-json.js';

/**
 * The loopback-only `http` case shape (T3.2, VSX-122 §G): parse/validate an
 * artifact-declared case, build its request against a caller-assigned
 * loopback port, run it under a bounded time and size budget, and compare the
 * declared subset of the response through `canonicalJson`.
 *
 * **S1 — SSRF.** An artifact may only ever name a request *path*. The host is
 * always `127.0.0.1:<port>` — assigned by the caller (T3.3 owns the server
 * that port belongs to) — and is never read from artifact text.
 * {@link buildLoopbackUrl} is the single authority for that rule and is
 * called both at validation time (when no port is assigned yet, so any
 * encoded authority differs from the bare loopback host) and at request time
 * (when the real port is known), so loopback-only is a property of the URL
 * this module constructs, not of the artifact's good behaviour — a case that
 * somehow reached {@link runHttpCase} without going through
 * {@link parseHttpCase} first is refused there too.
 *
 * **S1 does not end at the first hop.** The server answering a request is
 * itself the artifact's own `# Solutions` overlay — untrusted — so a `3xx`
 * response with `Location: https://evil.example/x` is exactly as artifact-
 * controlled as a case's `path`. Node's `fetch` defaults to `redirect:
 * 'follow'`, which would silently reissue the request at that location,
 * carrying the case's headers and body off the loopback host one layer below
 * `buildLoopbackUrl` — the guard would still be "correct" and simply never
 * consulted again. `runHttpCase` therefore passes `redirect: 'manual'`: a
 * `3xx` becomes an ordinary, fully-observable response (`status`, `headers`
 * including `location`, body) instead of a followed request, so every case
 * this module ever issues stays on the port the caller assigned. Do not
 * "simplify" this back to the default — it is the SSRF guard's second half,
 * not a redirect-handling nicety, and `test/http-case.test.ts` pins it.
 *
 * **S11 — bounded execution.** `AbortSignal.timeout` bounds every request;
 * the response body is read in capped chunks and a case that would exceed
 * {@link MAX_HTTP_BODY_BYTES} fails by name rather than being silently
 * truncated into a comparison that could read green.
 */

/** The one host a constructed request may ever target. Never artifact-supplied. */
const LOOPBACK_HOST = '127.0.0.1';

/**
 * Hard cap on a response body read from an `http` case, enforced while
 * streaming — never after the fact. A runaway or endlessly-writing server
 * must fail the case, not grow this process's heap.
 *
 * Exported per the plan's note: `MAX_HTTP_BODY_BYTES` is a shared-table value
 * and `src/types/constants.ts` is not this task's `Owns` — left here for the
 * orchestrator to relocate at wave close, matching the precedent
 * `MAX_LEET_OUT_BYTES` set in `test-envs/program/out-channel.ts`.
 */
export const MAX_HTTP_BODY_BYTES = 64 * 1024;

/** The HTTP methods a case may declare. */
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
/** Methods the Fetch API itself refuses a body on — refused here with a named reason instead. */
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

/** A declared request: what to send, and where within the loopback server. */
export interface HttpRequestSpec {
	readonly method: string;
	readonly path: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: unknown;
}

/** A declared expectation. Only the fields present here are asserted — an undeclared field is never checked. */
export interface HttpExpectSpec {
	readonly status?: number;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: unknown;
}

/** One `http` test case, already validated by {@link parseHttpCase}. */
export interface HttpCase {
	readonly request: HttpRequestSpec;
	readonly expect: HttpExpectSpec;
}

/** Verdict of running one {@link HttpCase}. */
export interface HttpCaseResult {
	/** True when every field `expect` declared matched. */
	readonly passed: boolean;
	/** The refused rule, the bound that was hit, or the mismatch. Absent when `passed`. */
	readonly detail?: string;
}

/** {@link parseHttpCase}'s result: the validated case, or the first refusal reason. */
export type HttpCaseParse =
	| { readonly ok: true; readonly case: HttpCase }
	| { readonly ok: false; readonly reason: string };

/** Internal result shape shared by every field-level parser below. */
type FieldParse<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly reason: string };

function okField<T>(value: T): FieldParse<T> {
	return { ok: true, value };
}
function errField<T>(reason: string): FieldParse<T> {
	return { ok: false, reason };
}

// ── loopback authority (S1) ──────────────────────────────────────────────────

/**
 * Resolve an artifact-declared path against a fixed loopback host, refusing
 * anything that resolves to a different host — the one place this module
 * decides "is this request going to the loopback address".
 *
 * Delegates entirely to the platform's own WHATWG URL parser rather than a
 * hand-written scheme/authority check: an absolute URL, a protocol-relative
 * `//host/path`, and even a mixed-slash `/\host/path` all resolve to a `host`
 * that differs from `expectedHost` under this parser — the same parser any
 * real HTTP client uses to route the request, so there is no gap between
 * "what was validated" and "what would actually be requested". An absolute
 * URL that happens to *name* the loopback host is refused too — the host must
 * never be artifact-supplied, coincidence included.
 *
 * **Two checks, not one, because of a WHATWG default-port normalisation.**
 * `new URL('http://127.0.0.1/x').host` and `new URL('http://127.0.0.1:80/x').host`
 * both drop the default `:80` and read back as the bare `127.0.0.1` — the
 * *same* string this function's own base host resolves to — so the
 * host-comparison check alone would let a coincidentally-matching absolute
 * URL slip through as if it were a plain path (measured). `isStandaloneUrl`
 * closes that: a `rawPath` that parses as a complete URL on its own,
 * independent of any base, is refused outright regardless of what host it
 * names, because a legitimate path never does.
 *
 * @param rawPath - The artifact-declared `request.path`.
 * @param expectedHost - `'127.0.0.1'` at validation time (no port assigned
 *   yet), `'127.0.0.1:<port>'` at request time — the only two callers.
 * @returns The resolved URL.
 * @throws When `rawPath` is itself a complete URL, cannot be parsed, or
 *   resolves off `expectedHost`.
 *
 * @example
 * buildLoopbackUrl('/health', '127.0.0.1'); // → URL('http://127.0.0.1/health')
 * buildLoopbackUrl('https://evil.example/x', '127.0.0.1'); // → throws
 * buildLoopbackUrl('http://127.0.0.1/x', '127.0.0.1'); // → throws (standalone URL, even same host)
 */
function buildLoopbackUrl(rawPath: string, expectedHost: string): URL {
	if (isStandaloneUrl(rawPath)) {
		throw new Error(
			`request.path ${JSON.stringify(rawPath)} is a complete URL, not a path — `
			+ 'a case may only ever declare a path; the host is always the assigned loopback '
			+ 'address and is never artifact-supplied, even when it happens to match (S1)',
		);
	}
	let url: URL;
	try {
		url = new URL(rawPath, `http://${expectedHost}`);
	} catch {
		throw new Error(`request.path ${JSON.stringify(rawPath)} is not a valid URL path`);
	}
	if (url.host !== expectedHost) {
		throw new Error(
			`request.path ${JSON.stringify(rawPath)} would resolve off the loopback host — `
			+ 'a case may only ever declare a path; the host is always the assigned 127.0.0.1 '
			+ 'loopback address and is never artifact-supplied (S1)',
		);
	}
	return url;
}

/** Whether `rawPath` parses as a complete URL entirely on its own, with no base to resolve against. */
function isStandaloneUrl(rawPath: string): boolean {
	try {
		new URL(rawPath);
		return true;
	} catch {
		return false;
	}
}

// ── field parsers ─────────────────────────────────────────────────────────────

function parseMethod(raw: unknown, hasBody: boolean): FieldParse<string> {
	if (typeof raw !== 'string' || raw === '') { return errField('request.method must be a non-empty string'); }
	const method = raw.toUpperCase();
	if (!HTTP_METHODS.has(method)) {
		return errField(`request.method ${JSON.stringify(raw)} is not a recognised HTTP method`);
	}
	if (hasBody && BODYLESS_METHODS.has(method)) {
		return errField(`request.body is not allowed with method ${method}`);
	}
	return okField(method);
}

function parsePath(raw: unknown): FieldParse<string> {
	if (typeof raw !== 'string' || raw === '') { return errField('request.path must be a non-empty string'); }
	try {
		buildLoopbackUrl(raw, LOOPBACK_HOST);
	} catch (e) {
		return errField(e instanceof Error ? e.message : String(e));
	}
	return okField(raw);
}

/**
 * Parse a `headers` map, refusing any non-string value by name.
 *
 * No `__proto__`/`constructor`/`prototype` key filter here, deliberately: the
 * `typeof value !== 'string'` check below is what actually holds this safe,
 * not an extra guard alongside it. Header values are constrained to strings
 * by this function itself, and a *string* assigned to `out['__proto__']` is
 * inert — `Object.prototype`'s own `__proto__` setter is a no-op for
 * anything that is not an object or `null` — so there is no reachable
 * pollution primitive to guard against once that constraint holds. (Contrast
 * `yaml-cases.helpers.ts`, whose parsed values can be arbitrary nested
 * objects, where the equivalent filter is load-bearing.) A comment claiming a
 * guard holds a property it does not is the exact defect this plan keeps
 * shipping — this one states plainly which check does the work.
 */
function parseHeaders(raw: unknown, where: string): FieldParse<Record<string, string> | undefined> {
	if (raw === undefined) { return okField(undefined); }
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return errField(`${where} must be an object of string values`);
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value !== 'string') { return errField(`${where}.${key} must be a string`); }
		out[key] = value;
	}
	return okField(out);
}

function parseStatus(raw: unknown): FieldParse<number | undefined> {
	if (raw === undefined) { return okField(undefined); }
	if (typeof raw !== 'number' || !Number.isInteger(raw)) {
		return errField(
			`expect.status must be a number, not ${JSON.stringify(raw)} — a quoted status in the `
			+ 'case fence is a string, and the status-code type rule refuses it',
		);
	}
	return okField(raw);
}

function parseRequestSpec(raw: unknown): FieldParse<HttpRequestSpec> {
	if (typeof raw !== 'object' || raw === null) { return errField('request must be an object'); }
	const r = raw as Record<string, unknown>;

	const method = parseMethod(r.method, r.body !== undefined);
	if (!method.ok) { return method; }
	const path = parsePath(r.path);
	if (!path.ok) { return path; }
	const headers = parseHeaders(r.headers, 'request.headers');
	if (!headers.ok) { return headers; }

	return okField({ method: method.value, path: path.value, headers: headers.value, body: r.body });
}

function parseExpectSpec(raw: unknown): FieldParse<HttpExpectSpec> {
	if (raw === undefined) { return okField({}); }
	if (typeof raw !== 'object' || raw === null) { return errField('expect must be an object'); }
	const r = raw as Record<string, unknown>;

	const status = parseStatus(r.status);
	if (!status.ok) { return status; }
	const headers = parseHeaders(r.headers, 'expect.headers');
	if (!headers.ok) { return headers; }

	return okField({ status: status.value, headers: headers.value, body: r.body });
}

/**
 * Parse and validate one `http` case declared by an artifact.
 *
 * This is where S1 is enforced: a `request.path` that carries a scheme,
 * authority, or anything else that resolves off the assigned loopback host is
 * refused here, by name, before any request is ever built.
 *
 * @param raw - The case as parsed from its YAML/JSON fence — untrusted.
 * @returns The validated case, or the first refusal reason.
 *
 * @example
 * parseHttpCase({ request: { method: 'GET', path: '/health' }, expect: { status: 200 } });
 * // → { ok: true, case: { request: {...}, expect: { status: 200 } } }
 *
 * @example
 * parseHttpCase({ request: { method: 'GET', path: 'https://evil.example/x' }, expect: {} });
 * // → { ok: false, reason: 'request.path "https://evil.example/x" would resolve off the loopback host …' }
 */
export function parseHttpCase(raw: unknown): HttpCaseParse {
	if (typeof raw !== 'object' || raw === null) { return { ok: false, reason: 'an http case must be an object' }; }
	const r = raw as Record<string, unknown>;

	const request = parseRequestSpec(r.request);
	if (!request.ok) { return { ok: false, reason: request.reason }; }
	const expect = parseExpectSpec(r.expect);
	if (!expect.ok) { return { ok: false, reason: expect.reason }; }

	return { ok: true, case: { request: request.value, expect: expect.value } };
}

// ── bounded execution (S11) ──────────────────────────────────────────────────

/** Build the Fetch `RequestInit` fields that come from the declared request — everything but `signal`. */
function fetchInit(spec: HttpRequestSpec): { method: string; headers?: Record<string, string>; body?: string } {
	const headers: Record<string, string> = { ...spec.headers };
	if (spec.body !== undefined && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
		headers['content-type'] = 'application/json';
	}
	return {
		method: spec.method,
		headers: Object.keys(headers).length > 0 ? headers : undefined,
		body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
	};
}

/**
 * Read a response body under {@link MAX_HTTP_BODY_BYTES}, failing loudly the
 * instant the cap is crossed rather than truncating and comparing whatever
 * arrived — the false-green class this plan has already shipped three times
 * (stale `$LEET_OUT`, inert guards, a vacuous probe).
 */
async function readBoundedBody(response: Response): Promise<FieldParse<string>> {
	const reader = response.body?.getReader();
	if (!reader) { return okField(''); }

	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const step = await reader.read();
		if (step.done) { break; }
		total += step.value.byteLength;
		if (total > MAX_HTTP_BODY_BYTES) {
			await reader.cancel().catch(() => undefined);
			return errField(
				`response body exceeded the ${MAX_HTTP_BODY_BYTES}-byte limit — a runaway response, not a graded value`,
			);
		}
		chunks.push(step.value);
	}
	return okField(Buffer.concat(chunks).toString('utf8'));
}

/** `expected` vs `actual`, through the one canonical-JSON comparison every test environment uses. */
function mismatch(where: string, actual: unknown, expected: unknown): string | undefined {
	const a = canonicalJson(actual);
	const e = canonicalJson(expected);
	return a === e ? undefined : `${where}: expected ${e}, got ${a}`;
}

/** Compare only the fields `expect` declared — an undeclared field is never asserted. */
function compareExpectation(expect: HttpExpectSpec, response: Response, bodyText: string): HttpCaseResult {
	if (expect.status !== undefined) {
		const reason = mismatch('status', response.status, expect.status);
		if (reason) { return { passed: false, detail: reason }; }
	}
	if (expect.headers) {
		for (const [name, expected] of Object.entries(expect.headers)) {
			const reason = mismatch(`header '${name}'`, response.headers.get(name), expected);
			if (reason) { return { passed: false, detail: reason }; }
		}
	}
	if (expect.body !== undefined) {
		const parsedBody = safeJsonParse<unknown>(bodyText);
		// Disambiguates literal `null` from a parse failure — the same trap
		// `readOutChannel` guards against for `$LEET_OUT`.
		if (parsedBody === null && bodyText.trim() !== 'null') {
			return { passed: false, detail: `body: response is not valid JSON — ${bodyText.slice(0, 200)}` };
		}
		const reason = mismatch('body', parsedBody, expect.body);
		if (reason) { return { passed: false, detail: reason }; }
	}
	return { passed: true };
}

/**
 * Run one validated {@link HttpCase} against the server booted on `port`, and
 * compare the declared subset of its response.
 *
 * Enforces S1 a second time, independent of {@link parseHttpCase}: the
 * request URL is built through {@link buildLoopbackUrl} with the real
 * `127.0.0.1:<port>` host, so loopback-only is a property of the request this
 * function issues, not of having called the validator first.
 *
 * Enforces S11: the whole call is bounded by `AbortSignal.timeout(timeoutMs)`
 * and the response body is read under {@link MAX_HTTP_BODY_BYTES}. Either
 * bound produces a failed case with a named reason — never a truncated,
 * silently-green comparison. Node's `fetch` has no default timeout, so
 * without this a server that accepts a connection and never answers would
 * hang past every other budget in the plan.
 *
 * **`redirect: 'manual'` is load-bearing, not a default left alone.** The
 * server on the other end of this request is the artifact's own code, so a
 * `3xx` `Location` is exactly as artifact-controlled as `request.path` — the
 * default `redirect: 'follow'` would reissue the request there, off the
 * loopback host, carrying this case's headers and body with it. `manual`
 * turns a redirect into an ordinary observable response instead (a case may
 * legitimately assert `status: 302` and the `location` header), so nothing
 * this function issues ever leaves `127.0.0.1:<port>`. See the module doc for
 * the full S1 argument; `test/http-case.test.ts` pins this with a real
 * redirect chain.
 *
 * @param httpCase - A case, normally from {@link parseHttpCase}.
 * @param port - The port T3.3's server lifecycle assigned this run — never
 *   discovered, guessed or defaulted here.
 * @param timeoutMs - Per-case budget, from `test.timeoutMs`.
 * @returns Pass/fail plus, on failure, the reason.
 *
 * @example
 * await runHttpCase(parsed.case, 54321, 5000);
 * // → { passed: true }
 */
export async function runHttpCase(httpCase: HttpCase, port: number, timeoutMs: number): Promise<HttpCaseResult> {
	let url: URL;
	try {
		url = buildLoopbackUrl(httpCase.request.path, `${LOOPBACK_HOST}:${port}`);
	} catch (e) {
		return { passed: false, detail: e instanceof Error ? e.message : String(e) };
	}

	// One try around *both* the request and the body read: `AbortSignal.timeout`
	// aborts the response stream, not just the connect — a server that sends
	// headers and then dribbles forever rejects `reader.read()` inside
	// `readBoundedBody`, just as it would reject `fetch` itself for a server
	// that never sends headers at all. Splitting these into two try blocks (the
	// bug this fixed) let that second rejection escape uncaught past this
	// function's `Promise<HttpCaseResult>` contract — a killed request must
	// resolve to a failed case, never a rejected promise.
	let response: Response;
	let bodyResult: FieldParse<string>;
	try {
		response = await fetch(url, {
			...fetchInit(httpCase.request),
			// S1: never follow a redirect off the loopback host — see the module doc.
			redirect: 'manual',
			signal: AbortSignal.timeout(timeoutMs),
		});
		bodyResult = await readBoundedBody(response);
	} catch (e) {
		if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
			return { passed: false, detail: `request timed out after ${timeoutMs}ms` };
		}
		return { passed: false, detail: `request failed: ${e instanceof Error ? e.message : String(e)}` };
	}
	if (!bodyResult.ok) { return { passed: false, detail: bodyResult.reason }; }

	return compareExpectation(httpCase.expect, response, bodyResult.value);
}
