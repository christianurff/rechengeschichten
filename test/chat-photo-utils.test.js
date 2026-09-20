const { test } = require('node:test');
const assert = require('node:assert');
const { isPhotoChatStrategy, getEnactiveNudge } = require('../chat-photo-utils.js');

test('isPhotoChatStrategy: true für die passenden Module', () => {
    ['solve', 'check', 'assumptions', 'detective', 'understand'].forEach(s => {
        assert.strictEqual(isPhotoChatStrategy(s), true, s);
    });
});

test('isPhotoChatStrategy: false für andere Module/Eingaben', () => {
    ['read', 'ask', 'write', 'dialog', 'captain', '', null, undefined].forEach(s => {
        assert.strictEqual(isPhotoChatStrategy(s), false, String(s));
    });
});

test('getEnactiveNudge: solve mit Foto -> Material-Anregung + Foto-Satz', () => {
    const n = getEnactiveNudge('solve', { photoEnabled: true });
    assert.ok(n.includes('Anregung'));
    assert.ok(n.includes('Lösungsstrategie'));
    assert.ok(n.includes('fotografieren'));
});

test('getEnactiveNudge: solve ohne Foto -> Material-Anregung, KEIN Foto-Satz', () => {
    const n = getEnactiveNudge('solve', { photoEnabled: false });
    assert.ok(n.includes('Anregung'));
    assert.ok(!n.includes('fotografieren'));
});

test('getEnactiveNudge: understand -> Skizzen-Anregung ohne Material-Pflicht', () => {
    const n = getEnactiveNudge('understand', { photoEnabled: true });
    assert.ok(n.includes('Skizze'));
    assert.ok(!n.includes('Plättchen'));
    assert.ok(n.includes('fotografieren'));
});

test('getEnactiveNudge: nicht passender Modus -> leer', () => {
    assert.strictEqual(getEnactiveNudge('read', { photoEnabled: true }), '');
    assert.strictEqual(getEnactiveNudge('', { photoEnabled: true }), '');
});

test('getEnactiveNudge: ohne opts -> Material-Anregung ohne Foto-Satz', () => {
    const n = getEnactiveNudge('solve');
    assert.ok(n.includes('Anregung'));
    assert.ok(!n.includes('fotografieren'));
});

test('getEnactiveNudge: check/assumptions/detective liefern die Material-Anregung', () => {
    ['check', 'assumptions', 'detective'].forEach(s => {
        const n = getEnactiveNudge(s, { photoEnabled: false });
        assert.ok(n.includes('Anregung'), s);
        assert.ok(!n.includes('fotografieren'), s);
    });
});

test('getEnactiveNudge: nicht-String-Strategie -> leer', () => {
    assert.strictEqual(getEnactiveNudge(42, { photoEnabled: true }), '');
    assert.strictEqual(getEnactiveNudge(null, { photoEnabled: true }), '');
});

test('getEnactiveNudge: understand ohne opts -> Skizze, kein Foto-Satz', () => {
    const n = getEnactiveNudge('understand');
    assert.ok(n.includes('Skizze'));
    assert.ok(!n.includes('fotografieren'));
});
