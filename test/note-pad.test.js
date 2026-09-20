const { test } = require('node:test');
const assert = require('node:assert');
const {
    hasContent, popLast, sceneBounds, objectAtPoint, shouldHandlePointer, buildObjectSuggestions
} = require('../note-pad.js');

function scene(items) { return { items: items }; }

test('hasContent: leere Szene -> false', () => {
    assert.strictEqual(hasContent(scene([])), false);
    assert.strictEqual(hasContent(null), false);
    assert.strictEqual(hasContent({}), false);
});

test('hasContent: Strich mit Punkten -> true, leerer Strich -> false', () => {
    assert.strictEqual(hasContent(scene([{ type: 'stroke', points: [{ x: 1, y: 1 }] }])), true);
    assert.strictEqual(hasContent(scene([{ type: 'stroke', points: [] }])), false);
});

test('hasContent: Objekt -> true', () => {
    assert.strictEqual(hasContent(scene([{ type: 'image', x: 0, y: 0, w: 10, h: 10 }])), true);
});

test('hasContent: nur Radierer-Striche -> false, mit echtem Strich -> true', () => {
    assert.strictEqual(hasContent(scene([{ type: 'stroke', eraser: true, points: [{ x: 1, y: 1 }] }])), false);
    assert.strictEqual(hasContent(scene([
        { type: 'stroke', points: [{ x: 1, y: 1 }] },
        { type: 'stroke', eraser: true, points: [{ x: 2, y: 2 }] }
    ])), true);
});

test('popLast: entfernt letztes Element, leere Szene unverändert', () => {
    const s = scene([{ type: 'image' }, { type: 'stroke', points: [] }]);
    popLast(s);
    assert.strictEqual(s.items.length, 1);
    assert.strictEqual(s.items[0].type, 'image');
    const empty = scene([]);
    popLast(empty);
    assert.strictEqual(empty.items.length, 0);
});

test('sceneBounds: leere Szene -> null', () => {
    assert.strictEqual(sceneBounds(scene([])), null);
});

test('sceneBounds: umfasst Striche (inkl. halber Breite) und Objekte', () => {
    const s = scene([
        { type: 'stroke', width: 4, points: [{ x: 10, y: 10 }, { x: 20, y: 30 }] },
        { type: 'image', x: 100, y: 5, w: 40, h: 40 }
    ]);
    const b = sceneBounds(s);
    assert.strictEqual(b.left, 8);    // 10 - 4/2
    assert.strictEqual(b.top, 5);     // min(10-2, 5)
    assert.strictEqual(b.right, 140); // 100 + 40
    assert.strictEqual(b.bottom, 45); // 5 + 40
});

test('objectAtPoint: oberstes Objekt unter dem Punkt, sonst null', () => {
    const a = { type: 'image', x: 0, y: 0, w: 50, h: 50 };
    const b = { type: 'image', x: 20, y: 20, w: 50, h: 50 };
    const s = scene([a, b]);
    assert.strictEqual(objectAtPoint(s, 30, 30), b); // b liegt oben
    assert.strictEqual(objectAtPoint(s, 5, 5), a);
    assert.strictEqual(objectAtPoint(s, 200, 200), null);
    assert.strictEqual(objectAtPoint(scene([{ type: 'stroke', points: [{ x: 5, y: 5 }] }]), 5, 5), null);
});

test('shouldHandlePointer: Stift wird immer behandelt', () => {
    assert.strictEqual(shouldHandlePointer({ penActive: true, activePointerId: 99 },
        { pointerType: 'pen', pointerId: 1 }), true);
});

test('shouldHandlePointer: Finger/Handballen ignoriert, während Stift aktiv', () => {
    assert.strictEqual(shouldHandlePointer({ penActive: true, activePointerId: null },
        { pointerType: 'touch', pointerId: 5 }), false);
});

test('shouldHandlePointer: Finger ohne aktiven Stift wird behandelt', () => {
    assert.strictEqual(shouldHandlePointer({ penActive: false, activePointerId: null },
        { pointerType: 'touch', pointerId: 5 }), true);
});

test('shouldHandlePointer: zweiter gleichzeitiger Pointer ignoriert', () => {
    assert.strictEqual(shouldHandlePointer({ penActive: false, activePointerId: 5 },
        { pointerType: 'touch', pointerId: 9 }), false);
    assert.strictEqual(shouldHandlePointer({ penActive: false, activePointerId: 5 },
        { pointerType: 'touch', pointerId: 5 }), true);
});

test('buildObjectSuggestions: dedupliziert nach Keyword (case-insensitive)', () => {
    const out = buildObjectSuggestions([
        { keyword: 'Apfel', url: 'a' },
        { keyword: 'apfel', url: 'b' },
        { keyword: 'Korb', url: 'c' }
    ]);
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].keyword, 'Apfel');
    assert.strictEqual(out[1].keyword, 'Korb');
});

test('buildObjectSuggestions: filtert ungültige Einträge, respektiert Limit', () => {
    const raw = [
        { keyword: '', url: 'x' },
        { keyword: 'A', url: '' },
        null,
        { keyword: 'B', url: 'b' },
        { keyword: 'C', url: 'c' },
        { keyword: 'D', url: 'd' }
    ];
    const out = buildObjectSuggestions(raw, 2);
    assert.strictEqual(out.length, 2);
    assert.deepStrictEqual(out.map(e => e.keyword), ['B', 'C']);
});

test('buildObjectSuggestions: kein Array -> leer', () => {
    assert.deepStrictEqual(buildObjectSuggestions(null), []);
});
