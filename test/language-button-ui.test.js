const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'multilingual.css'), 'utf8');

test('Mehrsprachigkeits-Button ist fuer neue Installationen standardmaessig aktiv', () => {
    assert.match(app, /localStorage\.getItem\('rechengeschichten_language_button'\) !== 'false'/);
});

test('Mehrsprachigkeits-Button hat auch im deutschen Grundzustand eine Beschriftung', () => {
    assert.match(html, /id="btn-language"[\s\S]*?<span class="toolbar-btn-label">Mehrsprachigkeit<\/span>/);
    assert.match(app, /labelEl\.textContent = 'Mehrsprachigkeit'/);
    assert.match(app, /labelEl\.style\.display = ''/);
});

test('Eine ausgewaehlte Sprache hebt den Button im neuen Optionen-Menue hervor', () => {
    assert.match(css, /\.task-options-item\.language-active/);
});

test('Sprachwahl wird positiv und ohne Deutsch-Hierarchie gerahmt', () => {
    assert.match(html, /Alle Sprachen sind willkommen und wertvoll/);
    assert.match(app, /Welche weitere Sprache hilft dir gerade\?/);
    assert.match(app, /Sprachauswahl: Deutsch/);
    assert.doesNotMatch(html, /Deutsch bleibt die Arbeitssprache/);
    assert.doesNotMatch(app, /Deutsch bleibt die Hauptsprache/);
});

test('Sprach-Popover trennt Denken und gemeinsames Teilen', () => {
    assert.match(app, /Meine Sprachen/);
    assert.match(app, /Zum Denken und Verstehen/);
    assert.match(app, /Mischen ist auch okay/);
    assert.match(app, /Zum gemeinsamen Teilen/);
    assert.match(app, /Weitere Sprache oder Dialekt/);
    assert.match(app, /role="group" aria-label="Deutsch und weitere Sprache"/);
});

test('Sprach-Popover und Einstellungen zeigen wieder Sprachflaggen', () => {
    assert.match(app, /class="language-flag"[^>]*>🇩🇪/);
    assert.match(app, /class="language-flag" aria-hidden="true">' \+ escapeLangText\(it\.flag \|\| '🌐'\)/);
    assert.match(css, /\.language-flag/);
});

test('Deutsch bleibt aktiv und eine weitere Sprache kann hinzu- oder abgewählt werden', () => {
    assert.match(app, /language-always-active" role="checkbox" aria-checked="true" aria-disabled="true"/);
    assert.match(app, /language-always-label">Immer dabei/);
    assert.match(app, /aria-pressed="' \+ selected/);
    assert.match(app, /selectedCode === activeLanguageCode/);
    assert.match(app, /deselectsAdditionalLanguage \? 'de' : selectedCode/);
    assert.match(app, /labelEl\.textContent = 'Deutsch \+ ' \+ entry\.name/);
});

test('Freie Sprachen werden richtungsbewusst und viewport-sicher dargestellt', () => {
    assert.match(html, /id="language-add-input" dir="auto"/);
    assert.match(app, /class="language-name" dir="auto"/);
    assert.match(app, /const opensDown = spaceAbove < 360 && spaceBelow > spaceAbove/);
    assert.match(css, /\.language-dropdown\.opens-down/);
});
