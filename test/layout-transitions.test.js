const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    calculateAnchoredBottom,
    createFlipKeyframes,
    createEnterKeyframes,
    shouldAnimateLayout
} = require('../layout-transitions.js');

test('toast bottom follows the real top edge of its anchor', () => {
    assert.equal(calculateAnchoredBottom(
        900,
        { top: 720, width: 500, height: 80 },
        { gap: 16, defaultBottom: 20 }
    ), 196);

    assert.equal(calculateAnchoredBottom(
        900,
        { top: 870, width: 500, height: 30 },
        { gap: 16, defaultBottom: 20 }
    ), 46);
});

test('toast bottom falls back when the anchor is hidden or outside the viewport', () => {
    assert.equal(calculateAnchoredBottom(900, { top: 720, width: 0, height: 80 }), 20);
    assert.equal(calculateAnchoredBottom(900, { top: 920, width: 500, height: 80 }), 20);
    assert.equal(calculateAnchoredBottom(900, null), 20);
});

test('FLIP keyframes invert position and size before settling', () => {
    const from = { left: 10, top: 20, width: 200, height: 100 };
    const to = { left: 30, top: 50, width: 100, height: 200 };

    const frames = createFlipKeyframes(from, to);

    assert.equal(frames[0].transform, 'translate(-20px, -30px) scale(2, 0.5)');
    assert.equal(frames[1].transform, 'none');
});

test('enter keyframes materialize without bounce', () => {
    const frames = createEnterKeyframes();

    assert.deepEqual(frames[0], { opacity: 0, transform: 'translateY(12px) scale(0.985)' });
    assert.deepEqual(frames[1], { opacity: 1, transform: 'none' });
});

test('layout animation skips unchanged and invalid rectangles', () => {
    assert.equal(shouldAnimateLayout(
        { left: 0, top: 0, width: 100, height: 100 },
        { left: 0, top: 0, width: 100, height: 100 }
    ), false);
    assert.equal(shouldAnimateLayout(
        { left: 0, top: 0, width: 0, height: 100 },
        { left: 0, top: 0, width: 100, height: 100 }
    ), false);
    assert.equal(shouldAnimateLayout(
        { left: 0, top: 0, width: 100, height: 100 },
        { left: 8, top: 0, width: 100, height: 100 }
    ), true);
});

test('transition helper loads before app', () => {
    const root = path.join(__dirname, '..');
    const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    assert.ok(index.indexOf('layout-transitions.js?v=') < index.indexOf('app.js?v='));
});
