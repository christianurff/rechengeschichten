const test = require('node:test');
const assert = require('node:assert');
const { resolveWordVisual, parseWordExplanationResponse } = require('../word-explanation-utils.js');

test('resolveWordVisual: nicht zeigbar -> null', () => {
    assert.strictEqual(resolveWordVisual({ depictable: false, emoji: '🍎' }, 'http://x/a.png'), null);
});

test('resolveWordVisual: zeigbar + ARASAAC-URL -> image', () => {
    assert.deepStrictEqual(
        resolveWordVisual({ depictable: true, emoji: '🪑' }, 'http://x/bank.png'),
        { type: 'image', src: 'http://x/bank.png' }
    );
});

test('resolveWordVisual: zeigbar, keine URL, mit Emoji -> emoji', () => {
    assert.deepStrictEqual(
        resolveWordVisual({ depictable: true, emoji: '🍎' }, null),
        { type: 'emoji', emoji: '🍎' }
    );
});

test('resolveWordVisual: zeigbar, keine URL, kein Emoji -> null', () => {
    assert.strictEqual(resolveWordVisual({ depictable: true, emoji: '' }, null), null);
});

test('parseWordExplanationResponse: gueltiges JSON', () => {
    const r = parseWordExplanationResponse('{"erklaerung":"Eine Bank zum Sitzen.","emoji":"🪑","bildbegriff":["Parkbank","Sitzbank"],"zeigbar":true}');
    assert.strictEqual(r.explanation, 'Eine Bank zum Sitzen.');
    assert.strictEqual(r.emoji, '🪑');
    assert.deepStrictEqual(r.imageQuery, ['parkbank', 'sitzbank']);
    assert.strictEqual(r.depictable, true);
});

test('parseWordExplanationResponse: JSON in Markdown-Block', () => {
    const r = parseWordExplanationResponse('```json\n{"erklaerung":"Apfel.","emoji":"🍎","bildbegriff":["apfel"],"zeigbar":true}\n```');
    assert.strictEqual(r.explanation, 'Apfel.');
    assert.deepStrictEqual(r.imageQuery, ['apfel']);
});

test('parseWordExplanationResponse: zeigbar=false -> imageQuery leer, emoji null', () => {
    const r = parseWordExplanationResponse('{"erklaerung":"Lena ist ein Name.","emoji":"","bildbegriff":[],"zeigbar":false}');
    assert.strictEqual(r.depictable, false);
    assert.deepStrictEqual(r.imageQuery, []);
    assert.strictEqual(r.emoji, null);
});

test('parseWordExplanationResponse: kein JSON -> Fallback (ganzer Text)', () => {
    const r = parseWordExplanationResponse('Eine Bank zum Sitzen.');
    assert.strictEqual(r.explanation, 'Eine Bank zum Sitzen.');
    assert.strictEqual(r.depictable, false);
    assert.deepStrictEqual(r.imageQuery, []);
    assert.strictEqual(r.emoji, null);
});

test('parseWordExplanationResponse: nicht-String-Eingabe -> leerer Fallback', () => {
    for (const input of [null, undefined, 42, { a: 1 }]) {
        const r = parseWordExplanationResponse(input);
        assert.deepStrictEqual(r, { explanation: '', emoji: null, imageQuery: [], depictable: false, translation: null });
    }
});

test('parseWordExplanationResponse: bildbegriff kein Array/String -> imageQuery leer', () => {
    const r = parseWordExplanationResponse('{"erklaerung":"Test.","emoji":"❓","bildbegriff":42,"zeigbar":true}');
    assert.strictEqual(r.depictable, true);
    assert.deepStrictEqual(r.imageQuery, []);
    assert.strictEqual(r.emoji, '❓');
});

test('parseWordExplanationResponse: uebersetzung wird als translation uebernommen', () => {
    const content = '{"erklaerung":"Ein Apfel ist eine Frucht.","emoji":"🍎","bildbegriff":["apfel"],"zeigbar":true,"uebersetzung":"elma"}';
    const r = parseWordExplanationResponse(content);
    assert.strictEqual(r.translation, 'elma');
});

test('parseWordExplanationResponse: fehlendes uebersetzung -> translation null', () => {
    const content = '{"erklaerung":"Ein Apfel ist eine Frucht.","emoji":"🍎","bildbegriff":["apfel"],"zeigbar":true}';
    const r = parseWordExplanationResponse(content);
    assert.strictEqual(r.translation, null);
});

test('parseWordExplanationResponse: leere uebersetzung -> translation null', () => {
    const content = '{"erklaerung":"Lena ist ein Name.","emoji":"","bildbegriff":[],"zeigbar":false,"uebersetzung":""}';
    const r = parseWordExplanationResponse(content);
    assert.strictEqual(r.translation, null);
});
