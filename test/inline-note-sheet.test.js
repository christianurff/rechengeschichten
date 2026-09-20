/**
 * Tests für die reinen Helfer der integrierten Notizfläche (inline-note-sheet.js).
 * Ausführen: node --test test/inline-note-sheet.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const {
    resolveTouchIntent,
    inkBounds,
    exportRegion,
    growHeight,
    shouldAutoGrow
} = require('../inline-note-sheet.js');

// ---------- resolveTouchIntent ----------

test('Stift zeichnet immer', () => {
    assert.strictEqual(resolveTouchIntent({}, { pointerType: 'pen' }), 'draw');
    assert.strictEqual(
        resolveTouchIntent({ penDetected: true, penActive: true }, { pointerType: 'pen' }),
        'draw'
    );
});

test('Maus zeichnet', () => {
    assert.strictEqual(resolveTouchIntent({}, { pointerType: 'mouse' }), 'draw');
});

test('Touch wird während Stiftkontakt ignoriert (Handballen)', () => {
    assert.strictEqual(
        resolveTouchIntent({ penActive: true }, { pointerType: 'touch' }),
        'ignore'
    );
});

test('Erster Finger zeichnet, solange kein Stift erkannt wurde', () => {
    assert.strictEqual(
        resolveTouchIntent({ penDetected: false }, { pointerType: 'touch' }),
        'draw'
    );
});

test('Finger scrollt, sobald ein Stift erkannt wurde', () => {
    assert.strictEqual(
        resolveTouchIntent({ penDetected: true }, { pointerType: 'touch' }),
        'pan'
    );
});

test('Zweiter Finger während Finger-Zeichnung scrollt (Strich wird verworfen)', () => {
    assert.strictEqual(
        resolveTouchIntent(
            { penDetected: false, drawPointerType: 'touch', drawPointerId: 1 },
            { pointerType: 'touch', pointerId: 2 }
        ),
        'pan'
    );
});

test('Weitere Finger während Pan scrollen ebenfalls', () => {
    assert.strictEqual(
        resolveTouchIntent({ panPointerCount: 1 }, { pointerType: 'touch' }),
        'pan'
    );
});

// ---------- inkBounds ----------

test('inkBounds: leere Szene -> null', () => {
    assert.strictEqual(inkBounds({ items: [] }), null);
    assert.strictEqual(inkBounds(null), null);
});

test('inkBounds: berücksichtigt Strichbreite', () => {
    const scene = {
        items: [
            { type: 'stroke', width: 10, eraser: false, points: [{ x: 50, y: 60 }, { x: 70, y: 80 }] }
        ]
    };
    const b = inkBounds(scene);
    assert.strictEqual(b.left, 45);
    assert.strictEqual(b.top, 55);
    assert.strictEqual(b.right, 75);
    assert.strictEqual(b.bottom, 85);
});

test('inkBounds: reine Radierer-Striche zählen nicht', () => {
    const scene = {
        items: [
            { type: 'stroke', width: 28, eraser: true, points: [{ x: 5, y: 5 }, { x: 500, y: 500 }] },
            { type: 'stroke', width: 4, eraser: false, points: [{ x: 100, y: 100 }] }
        ]
    };
    const b = inkBounds(scene);
    assert.ok(b.right <= 102 && b.left >= 98, 'Radierer darf Bounds nicht aufblähen');
});

// ---------- exportRegion ----------

test('exportRegion: Rand wird addiert und an Canvas-Grenzen geklemmt', () => {
    const r = exportRegion({ left: 5, top: 5, right: 100, bottom: 50 }, 800, 600, 14);
    assert.strictEqual(r.left, 0);           // 5-14 -> an 0 geklemmt
    assert.strictEqual(r.top, 0);
    assert.strictEqual(r.w, 114);            // bis 100+14
    assert.strictEqual(r.h, 64);
});

test('exportRegion: null bei fehlenden Bounds', () => {
    assert.strictEqual(exportRegion(null, 800, 600, 14), null);
});

test('exportRegion: Mindestgröße wird eingehalten', () => {
    const r = exportRegion({ left: 400, top: 300, right: 402, bottom: 302 }, 800, 600, 4);
    assert.ok(r.w >= 40, 'Breite mind. 40, war ' + r.w);
    assert.ok(r.h >= 40, 'Höhe mind. 40, war ' + r.h);
    assert.ok(r.left >= 0 && r.left + r.w <= 800);
    assert.ok(r.top >= 0 && r.top + r.h <= 600);
});

// ---------- growHeight / shouldAutoGrow ----------

test('growHeight: wächst um Schrittweite bis zur Obergrenze', () => {
    assert.strictEqual(growHeight(400, 400, 2800), 800);
    assert.strictEqual(growHeight(2600, 400, 2800), 2800);
    assert.strictEqual(growHeight(2800, 400, 2800), 2800);
});

test('shouldAutoGrow: nur nahe der Unterkante', () => {
    assert.strictEqual(shouldAutoGrow(700, 800, 120), true);   // 100px vor Unterkante
    assert.strictEqual(shouldAutoGrow(500, 800, 120), false);
    assert.strictEqual(shouldAutoGrow(800, 800, 120), true);
});
