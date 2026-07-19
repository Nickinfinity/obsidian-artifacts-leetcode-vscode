import * as assert from 'node:assert';
import { LANG_ALIAS, LANG_EXT } from '../src/types/constants.js';
import {
    isLangId,
    LANG_IDS,
    LANGUAGES,
    type LangId,
} from '../src/types/languages.js';

/**
 * The `LANGUAGES` registry is the single source of truth for the runnable-language
 * set. These tests lock it against the cosmetic `LANG_ALIAS` / `LANG_EXT` tables so
 * the two can never drift (the drift the refactor exists to kill), and pin the id
 * set so a language can't be silently added or dropped without updating this test.
 */
suite('languages registry', () => {

    test('the runnable set is exactly the three executable languages', () => {
        assert.deepStrictEqual([...LANG_IDS].sort((a, b) => a.localeCompare(b)),
            ['java', 'javascript', 'python']);
    });

    test('every entry is keyed by its own id', () => {
        for (const id of LANG_IDS) {
            assert.strictEqual(LANGUAGES[id].id, id);
        }
    });

    test('each fileExt agrees with LANG_EXT (no extension drift)', () => {
        for (const id of LANG_IDS) {
            assert.strictEqual(LANGUAGES[id].fileExt, LANG_EXT[id],
                `fileExt for ${id} drifted from LANG_EXT`);
        }
    });

    test('every alias resolves through LANG_ALIAS back to its language', () => {
        for (const id of LANG_IDS) {
            for (const alias of LANGUAGES[id].aliases) {
                assert.strictEqual(LANG_ALIAS[alias], id,
                    `alias '${alias}' does not map to '${id}' in LANG_ALIAS`);
            }
        }
    });

    test('python is the only hash-comment language among the runnable set', () => {
        for (const id of LANG_IDS) {
            const expected = id === 'python' ? '#' : '//';
            assert.strictEqual(LANGUAGES[id].commentPrefix, expected);
        }
    });

    test('detectCmd is a version probe for every language', () => {
        for (const id of LANG_IDS) {
            assert.ok(LANGUAGES[id].detectCmd.includes('--version'),
                `detectCmd for ${id} should be a --version probe`);
        }
    });

    // Exact detect/display values — relocated from the deleted lang-runners test
    // (the runtime toolchain probe now reads these straight from the registry).
    test('java detectCmd and displayName', () => {
        assert.strictEqual(LANGUAGES.java.detectCmd, 'java --version');
        assert.strictEqual(LANGUAGES.java.displayName, 'Java');
    });

    test('python detectCmd and displayName', () => {
        assert.strictEqual(LANGUAGES.python.detectCmd, 'python3 --version');
        assert.strictEqual(LANGUAGES.python.displayName, 'Python');
    });

    test('javascript detectCmd and displayName', () => {
        assert.strictEqual(LANGUAGES.javascript.detectCmd, 'node --version');
        assert.strictEqual(LANGUAGES.javascript.displayName, 'JavaScript');
    });

    test('isLangId narrows runnable ids and rejects everything else', () => {
        assert.ok(isLangId('java'));
        assert.ok(isLangId('python'));
        assert.ok(isLangId('javascript'));
        assert.strictEqual(isLangId('rust'), false);
        assert.strictEqual(isLangId('ruby'), false);
        assert.strictEqual(isLangId(''), false);
    });

    test('isLangId narrows the type for the compiler', () => {
        const raw: string = 'python';
        if (isLangId(raw)) {
            const id: LangId = raw; // compiles only if narrowed
            assert.strictEqual(id, 'python');
        } else {
            assert.fail('python should narrow to LangId');
        }
    });
});
