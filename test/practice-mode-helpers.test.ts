import * as assert from 'node:assert';
import { collectSettings } from '../src/services/practice-mode.helpers.js';

/**
 * Unit tests for the pure practice-option → settings flattening, extracted from
 * the `vscode`-coupled `PracticeMode` so it can be tested without the editor.
 */
suite('collectSettings', () => {

    test('an empty selection yields no settings', () => {
        assert.strictEqual(collectSettings([]).size, 0);
    });

    test('a selected option contributes its settings', () => {
        const s = collectSettings(['noSnippets']);
        assert.strictEqual(s.get('editor.snippetSuggestions'), 'none');
        assert.strictEqual(s.get('editor.wordBasedSuggestions'), 'off');
    });

    test('unselected options are excluded', () => {
        const s = collectSettings(['noSnippets']);
        assert.strictEqual(s.has('editor.inlineSuggest.enabled'), false); // that is noAiAgents
    });

    test('multiple options merge their settings into one map', () => {
        const s = collectSettings(['noAiAgents', 'noParameterHints']);
        assert.strictEqual(s.get('editor.inlineSuggest.enabled'), false);
        assert.strictEqual(s.get('editor.parameterHints.enabled'), false);
        assert.strictEqual(s.get('editor.hover.enabled'), false);
    });
});
