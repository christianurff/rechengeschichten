const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

function functionBody(name) {
    const start = app.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, name + ' fehlt');
    const next = app.indexOf('\nfunction ', start + 10);
    return app.slice(start, next === -1 ? app.length : next);
}

test('Mission-Completion speichert und markiert dezent, ohne sofort das Modal zu zeigen', () => {
    const body = functionBody('handleMissionComplete');
    assert.match(body, /pendingCertificatePresentation\s*=/);
    assert.match(body, /appendMissionCompleteIndicator/);
    assert.match(body, /saveCertificates\(\{ updateBadge: false \}\)/);
    assert.doesNotMatch(body, /showCelebrationModal/);
    assert.doesNotMatch(body, /maybeShowMicroAssessment/);
});

test('Zurück zur Modusauswahl zeigt eine vorgemerkte Urkunde erst nach dem UI-Wechsel', () => {
    const body = functionBody('backToStrategies');
    const uiReset = body.indexOf("DOM.strategyList.style.display = 'flex'");
    const presentation = body.indexOf('presentPendingCertificateOnExit()');
    assert.ok(uiReset >= 0 && presentation > uiReset);
});

test('Chat-Abschluss ist ein dezenter Status-Pill', () => {
    assert.match(css, /\.chat-completion-indicator\s*\{[^}]*align-self:\s*center/s);
    assert.match(css, /\.chat-completion-indicator\s*\{[^}]*border-radius:\s*999px/s);
    assert.match(css, /\.chat-completion-indicator-icon\s*\{[^}]*background:\s*#16a34a/s);
});
