import * as assert from 'node:assert';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    MAX_HTTP_BODY_BYTES,
    parseHttpCase,
    runHttpCase,
    type HttpCase,
} from '../src/services/test-envs/http/http-case.helpers.js';

/**
 * Unit + integration tests for the loopback-only `http` case shape (T3.2,
 * VSX-122 §G). `parseHttpCase` tests are pure; `runHttpCase` tests boot a real
 * `node:http` server on `127.0.0.1:0` per Orchestrator note #7 — never a
 * fixtures directory, never an external host.
 */
suite('http-case', () => {

    suite('parseHttpCase — loopback-only path (S1, SSRF)', () => {

        test('refuses an absolute-URL path, naming the loopback rule', () => {
            const result = parseHttpCase({
                request: { method: 'GET', path: 'https://evil.example/x' },
                expect: {},
            });
            assert.strictEqual(result.ok, false);
            if (result.ok) { return; }
            assert.match(result.reason, /loopback/i);
        });

        test('refuses a protocol-relative path (non-obvious authority form)', () => {
            const result = parseHttpCase({
                request: { method: 'GET', path: '//evil.example/x' },
                expect: {},
            });
            assert.strictEqual(result.ok, false);
            if (result.ok) { return; }
            assert.match(result.reason, /loopback/i);
        });

        test('refuses a backslash-smuggled authority (mixed-slash form)', () => {
            const result = parseHttpCase({
                request: { method: 'GET', path: '/\\evil.example/x' },
                expect: {},
            });
            assert.strictEqual(result.ok, false);
        });

        test('refuses an absolute URL even when it names the real loopback host', () => {
            // The host is never artifact-supplied, even when it happens to match —
            // an artifact may only ever declare a path.
            const result = parseHttpCase({
                request: { method: 'GET', path: 'http://127.0.0.1:9999/x' },
                expect: {},
            });
            assert.strictEqual(result.ok, false);
        });

        test('refuses an absolute URL naming the default HTTP port, explicit or implied', () => {
            // WHATWG drops a default `:80`, so `http://127.0.0.1/x` and
            // `http://127.0.0.1:80/x` both normalise to the bare `127.0.0.1` host —
            // the same string validation resolves against. A host-comparison check
            // alone would let these two coincide with a real path and slip through;
            // both forms must still be refused as "not a path at all".
            for (const path of ['http://127.0.0.1/x', 'http://127.0.0.1:80/x']) {
                const result = parseHttpCase({ request: { method: 'GET', path }, expect: {} });
                assert.strictEqual(result.ok, false, `expected ${path} to be refused`);
            }
        });

        test('accepts a plain path', () => {
            const result = parseHttpCase({
                request: { method: 'GET', path: '/health' },
                expect: { status: 200 },
            });
            assert.strictEqual(result.ok, true);
        });
    });

    suite('parseHttpCase — field validation', () => {

        test('refuses a non-object case', () => {
            assert.strictEqual(parseHttpCase('not an object').ok, false);
            assert.strictEqual(parseHttpCase(null).ok, false);
        });

        test('refuses an unrecognised method', () => {
            const result = parseHttpCase({ request: { method: 'TRACE', path: '/x' }, expect: {} });
            assert.strictEqual(result.ok, false);
        });

        test('refuses a body declared on a GET request', () => {
            const result = parseHttpCase({
                request: { method: 'GET', path: '/x', body: { a: 1 } },
                expect: {},
            });
            assert.strictEqual(result.ok, false);
        });

        test('refuses expect.status as a string, naming the type rule', () => {
            const result = parseHttpCase({ request: { method: 'GET', path: '/x' }, expect: { status: '200' } });
            assert.strictEqual(result.ok, false);
            if (result.ok) { return; }
            assert.match(result.reason, /number/);
        });

        test('accepts expect.status as a number', () => {
            const result = parseHttpCase({ request: { method: 'GET', path: '/x' }, expect: { status: 200 } });
            assert.strictEqual(result.ok, true);
        });

        test('a __proto__ header with a non-string value is refused, exactly like any other key', () => {
            // parseHeaders carries no dedicated __proto__/constructor/prototype
            // filter (removed — it was unreachable dead code, see the JSDoc on
            // parseHeaders). This is the behaviour that filter used to shadow: a
            // malformed value under one of those names now surfaces as a named
            // validation error instead of silently vanishing.
            const raw: unknown = JSON.parse('{"request":{"method":"GET","path":"/x","headers":{"__proto__":{"a":1}}},"expect":{}}');
            const result = parseHttpCase(raw);
            assert.strictEqual(result.ok, false);
        });

        test('a __proto__ header with a string value parses, and never reaches Object.prototype', () => {
            // The real safety property, proven against a *fresh, unrelated*
            // object rather than the parsed headers themselves — the parsed
            // headers looking clean proves nothing about global state, which is
            // exactly how the previous version of this test stayed green with no
            // guard doing any work. This one is provably true only because a
            // string assigned through `__proto__` is inert per the language's own
            // accessor semantics (Object.prototype's `__proto__` setter no-ops
            // for anything that isn't an object or null) — not because of any
            // filter in this module.
            const raw: unknown = JSON.parse(
                '{"request":{"method":"GET","path":"/x","headers":{"__proto__":"evil","x-ok":"1"}},"expect":{}}',
            );
            const result = parseHttpCase(raw);
            assert.strictEqual(result.ok, true);
            if (!result.ok) { return; }
            assert.strictEqual(result.case.request.headers?.['x-ok'], '1');
            assert.strictEqual((({}) as Record<string, unknown>).evil, undefined);
            assert.strictEqual(Object.getPrototypeOf({}), Object.prototype);
        });

        test('refuses a non-string header value', () => {
            const result = parseHttpCase({
                request: { method: 'GET', path: '/x', headers: { 'x-n': 1 } },
                expect: {},
            });
            assert.strictEqual(result.ok, false);
        });
    });

    suite('runHttpCase — bounded execution (S11) and subset comparison', () => {

        let server: http.Server | undefined;

        async function startServer(handler: http.RequestListener): Promise<number> {
            server = http.createServer(handler);
            await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
            const address = server.address() as AddressInfo;
            return address.port;
        }

        function mustParse(raw: unknown): HttpCase {
            const parsed = parseHttpCase(raw);
            if (!parsed.ok) { throw new Error(`fixture case failed to parse: ${parsed.reason}`); }
            return parsed.case;
        }

        teardown(async () => {
            if (!server) { return; }
            await new Promise<void>((resolve) => server?.close(() => resolve()));
            server = undefined;
        });

        test('passes when the declared subset matches, ignoring undeclared fields', async () => {
            const port = await startServer((_req, res) => {
                res.writeHead(200, { 'content-type': 'application/json', 'x-undeclared': 'noise' });
                res.end(JSON.stringify({ ok: true, extra: 'noise' }));
            });
            const httpCase = mustParse({
                request: { method: 'GET', path: '/x' },
                expect: { status: 200, body: { ok: true, extra: 'noise' } },
            });
            const outcome = await runHttpCase(httpCase, port, 2000);
            assert.strictEqual(outcome.passed, true, outcome.detail);
        });

        test('only asserts a declared header, never the full response header set', async () => {
            const port = await startServer((_req, res) => {
                res.writeHead(200, { 'x-declared': 'yes', 'x-undeclared': 'noise' });
                res.end('{}');
            });
            const httpCase = mustParse({
                request: { method: 'GET', path: '/x' },
                expect: { headers: { 'x-declared': 'yes' } },
            });
            const outcome = await runHttpCase(httpCase, port, 2000);
            assert.strictEqual(outcome.passed, true, outcome.detail);
        });

        test('fails naming the mismatch when the body differs', async () => {
            const port = await startServer((_req, res) => {
                res.writeHead(200);
                res.end(JSON.stringify({ ok: false }));
            });
            const httpCase = mustParse({ request: { method: 'GET', path: '/x' }, expect: { body: { ok: true } } });
            const outcome = await runHttpCase(httpCase, port, 2000);
            assert.strictEqual(outcome.passed, false);
            assert.match(outcome.detail ?? '', /body/);
        });

        test('fails with a named reason when the server never responds (timeout, S11)', async function () {
            this.timeout(2000);
            const port = await startServer(() => { /* never respond — the whole point of the test */ });
            const httpCase = mustParse({ request: { method: 'GET', path: '/x' }, expect: {} });
            const outcome = await runHttpCase(httpCase, port, 100);
            assert.strictEqual(outcome.passed, false);
            assert.match(outcome.detail ?? '', /timed out/i);
        });

        test('fails with a named reason (never a rejected promise) when the timeout fires mid-body (SEC, S11)', async function () {
            this.timeout(2000);
            // Headers arrive and one chunk is sent, then the stream stalls forever
            // — the case `AbortSignal.timeout` must still cover, distinct from
            // "never responds" above where it never even sends headers.
            // `readBoundedBody`'s `reader.read()` rejects here, not `fetch`
            // itself; if that rejection ever escapes `runHttpCase` uncaught, this
            // `await` throws and the test fails with an unhandled TimeoutError
            // instead of a graded `HttpCaseResult`.
            const port = await startServer((_req, res) => {
                res.writeHead(200, { 'content-type': 'text/plain' });
                res.write('first-chunk');
                // never res.end() — the drip stalls indefinitely
            });
            const httpCase = mustParse({ request: { method: 'GET', path: '/x' }, expect: {} });
            const outcome = await runHttpCase(httpCase, port, 300);
            assert.strictEqual(outcome.passed, false);
            assert.match(outcome.detail ?? '', /timed out/i);
        });

        test('fails with a named reason — not a truncated success — over the body cap (S11)', async () => {
            const port = await startServer((_req, res) => {
                res.writeHead(200);
                res.end('a'.repeat(MAX_HTTP_BODY_BYTES + 1));
            });
            const httpCase = mustParse({ request: { method: 'GET', path: '/x' }, expect: {} });
            const outcome = await runHttpCase(httpCase, port, 2000);
            assert.strictEqual(outcome.passed, false);
            assert.match(outcome.detail ?? '', new RegExp(String(MAX_HTTP_BODY_BYTES)));
        });

        test('a body at exactly the cap still passes', async () => {
            const port = await startServer((_req, res) => {
                res.writeHead(200);
                res.end('a'.repeat(MAX_HTTP_BODY_BYTES));
            });
            const httpCase = mustParse({ request: { method: 'GET', path: '/x' }, expect: { status: 200 } });
            const outcome = await runHttpCase(httpCase, port, 2000);
            assert.strictEqual(outcome.passed, true, outcome.detail);
        });

        test('loopback is a property of the constructed request, not the caller\'s good behaviour', async () => {
            // Bypasses parseHttpCase entirely to prove runHttpCase enforces S1 on
            // its own — a case built by hand with an absolute-URL path must still
            // be refused, with no network attempt ever made.
            const sneaky: HttpCase = { request: { method: 'GET', path: 'http://evil.example/x' }, expect: {} };
            const outcome = await runHttpCase(sneaky, 1234, 500);
            assert.strictEqual(outcome.passed, false);
            assert.match(outcome.detail ?? '', /loopback/i);
        });

        test('a redirect is observed as a response and never followed (SEC, S1 second hop)', async () => {
            // The server under test is the artifact's own code, so its 302
            // `Location` is exactly as artifact-controlled as a case's `path`.
            // Two real loopback servers stand in for "the case's own server" and
            // "somewhere off the assigned port" — if `runHttpCase` ever followed
            // the redirect, the graded response would be the target's 200/marker
            // instead of the redirector's own 302, and the assertion below on
            // `status: 302` would fail.
            const target = http.createServer((_req, res) => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ marker: 'EXFIL-REACHED' }));
            });
            await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
            const targetPort = (target.address() as AddressInfo).port;
            const targetUrl = `http://127.0.0.1:${targetPort}/stolen`;

            const redirector = http.createServer((_req, res) => {
                res.writeHead(302, { location: targetUrl });
                res.end();
            });
            await new Promise<void>((resolve) => redirector.listen(0, '127.0.0.1', resolve));
            const redirectorPort = (redirector.address() as AddressInfo).port;

            try {
                const httpCase = mustParse({
                    request: { method: 'GET', path: '/health' },
                    expect: { status: 302, headers: { location: targetUrl } },
                });
                const outcome = await runHttpCase(httpCase, redirectorPort, 2000);
                // Passes only when the redirect itself was graded — had the
                // request been followed, the real status would be 200 and this
                // assertion would fail, which is exactly what makes the test die
                // if `redirect: 'manual'` is ever dropped.
                assert.strictEqual(outcome.passed, true, outcome.detail);
            } finally {
                await new Promise<void>((resolve) => target.close(() => resolve()));
                await new Promise<void>((resolve) => redirector.close(() => resolve()));
            }
        });
    });
});
