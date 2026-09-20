const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('toast uses a geometry-driven bottom position without animating through the button', () => {
    const baseToastStart = css.indexOf('/* Toast Notification */');
    const mediaStart = css.indexOf('@media screen and (max-width: 899px)', baseToastStart);
    const mediaEnd = css.indexOf('/* Responsive */', mediaStart);
    const narrowLayout = css.slice(mediaStart, mediaEnd);

    assert.notEqual(baseToastStart, -1);
    assert.notEqual(mediaStart, -1);
    assert.match(
        css.slice(baseToastStart, mediaStart),
        /\.toast-notification\s*\{[^}]*bottom:\s*var\(--toast-bottom, 20px\)/s
    );
    assert.match(
        narrowLayout,
        /\.toast-notification\s*\{[^}]*transform:\s*translateX\(-50%\) scale\(0\.96\)/s
    );
    assert.match(
        narrowLayout,
        /\.toast-notification\.visible\s*\{[^}]*transform:\s*translateX\(-50%\) scale\(1\)/s
    );
    assert.doesNotMatch(narrowLayout, /translateY\(/);
    assert.doesNotMatch(narrowLayout, /bottom:/);
    assert.match(app, /positionElementAboveAnchor\(toast, anchor\)/);
});

test('header menu stacking context stays above the chat header', () => {
    const headerRule = css.match(/\nheader\s*\{([\s\S]*?)\n\}/);
    const chatHeaderRule = css.match(/#chat-header\s*\{([\s\S]*?)\n\}/);

    assert.ok(headerRule);
    assert.ok(chatHeaderRule);

    const headerZIndex = Number(headerRule[1].match(/z-index:\s*(\d+)/)?.[1]);
    const chatHeaderZIndex = Number(chatHeaderRule[1].match(/z-index:\s*(\d+)/)?.[1]);

    assert.ok(headerZIndex > chatHeaderZIndex);
});
