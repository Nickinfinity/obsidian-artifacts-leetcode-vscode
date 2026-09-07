import * as assert from 'node:assert';
import {
    extForFenceLang,
    extForLang,
    resolveLangId,
} from '../src/services/language-map.service.js';

/**
 * Unit tests for the fence-language ↔ file-extension mapping that decides what
 * the temp exercise file is called.
 */
suite('language-map', () => {

    suite('resolveLangId', () => {

        test('aliases short forms to canonical language ids', () => {
            assert.strictEqual(resolveLangId('js'), 'javascript');
            assert.strictEqual(resolveLangId('py'), 'python');
            assert.strictEqual(resolveLangId('rs'), 'rust');
            assert.strictEqual(resolveLangId('c#'), 'csharp');
        });

        test('is case-insensitive and trims', () => {
            assert.strictEqual(resolveLangId('  JavaScript '), 'javascript');
            assert.strictEqual(resolveLangId('Python'), 'python');
        });

        test('passes canonical ids through unchanged', () => {
            assert.strictEqual(resolveLangId('java'), 'java');
            assert.strictEqual(resolveLangId('go'), 'go');
        });

        test('empty input falls back to plaintext', () => {
            assert.strictEqual(resolveLangId(''), 'plaintext');
            assert.strictEqual(resolveLangId('   '), 'plaintext');
        });
    });

    suite('extForLang', () => {

        test('maps known language ids to their extension', () => {
            assert.strictEqual(extForLang('javascript'), 'js');
            assert.strictEqual(extForLang('typescript'), 'ts');
            assert.strictEqual(extForLang('python'), 'py');
            assert.strictEqual(extForLang('csharp'), 'cs');
            assert.strictEqual(extForLang('java'), 'java');
        });

        test('unknown but filename-safe ids become their own extension', () => {
            assert.strictEqual(extForLang('nim'), 'nim');
        });

        test('unsafe ids fall back to txt', () => {
            assert.strictEqual(extForLang('c#'), 'txt');
            assert.strictEqual(extForLang('objective c'), 'txt');
        });
    });

    suite('extForFenceLang', () => {

        test('composes alias resolution with extension lookup', () => {
            assert.strictEqual(extForFenceLang('JavaScript'), 'js');
            assert.strictEqual(extForFenceLang('py'), 'py');
            assert.strictEqual(extForFenceLang('c#'), 'cs');
            assert.strictEqual(extForFenceLang('bash'), 'sh');
        });
    });

    // ── Prototype reach-through ───────────────────────────────────────────────
    // A fence info-string is untrusted text. Both tables are plain object
    // literals, so an unguarded `TABLE[key]` hands back `Object.prototype` for
    // these keys — an object where a string was promised, which then stringifies
    // as "[object Object]" into a language id or a filename.

    suite('inherited keys never resolve through the prototype', () => {

        const inherited = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

        test('resolveLangId returns the key itself, never an object', () => {
            for (const key of inherited) {
                assert.strictEqual(typeof resolveLangId(key), 'string', key);
                assert.strictEqual(resolveLangId(key), key.toLowerCase());
            }
        });

        test('extForLang falls back rather than returning an object', () => {
            for (const key of inherited) {
                const ext = extForLang(key);
                assert.strictEqual(typeof ext, 'string', key);
                assert.ok(/^[a-z0-9]+$|^txt$/.test(ext), `${key} → ${ext}`);
            }
        });
    });
});
