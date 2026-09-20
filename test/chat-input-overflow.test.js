const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { shouldCollapseChatTools } = require('../chat-input-overflow.js');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('Werkzeuge werden mit sichtbarer Vorschau bei knappem Platz gebündelt', () => {
    assert.equal(shouldCollapseChatTools({
        availableWidth: 480,
        toolCount: 2,
        buttonSize: 48,
        gap: 8,
        horizontalPadding: 30,
        sendWidth: 48,
        minimumInputWidth: 180,
        previewWidth: 56,
        fixedControlsWidth: 48,
        fixedControlCount: 1
    }), true);
});

test('Werkzeuge bleiben ohne Vorschau bei ausreichendem Platz direkt sichtbar', () => {
    assert.equal(shouldCollapseChatTools({
        availableWidth: 480,
        toolCount: 2,
        buttonSize: 48,
        gap: 8,
        horizontalPadding: 30,
        sendWidth: 48,
        minimumInputWidth: 180,
        previewWidth: 0,
        fixedControlsWidth: 48,
        fixedControlCount: 1
    }), false);
});

test('Vier Standard-Werkzeuge bleiben ohne Vorschau bei 480 Pixeln sichtbar', () => {
    assert.equal(shouldCollapseChatTools({
        availableWidth: 480,
        toolCount: 3,
        buttonSize: 48,
        gap: 8,
        horizontalPadding: 30,
        sendWidth: 48,
        minimumInputWidth: 140,
        previewWidth: 0,
        fixedControlsWidth: 48,
        fixedControlCount: 1
    }), false);
});

test('Vier Werkzeuge werden bei echtem Platzmangel weiterhin gebündelt', () => {
    assert.equal(shouldCollapseChatTools({
        availableWidth: 430,
        toolCount: 3,
        buttonSize: 48,
        gap: 8,
        horizontalPadding: 30,
        sendWidth: 48,
        minimumInputWidth: 140,
        previewWidth: 0,
        fixedControlsWidth: 48,
        fixedControlCount: 1
    }), true);
});

test('Ein einzelnes Werkzeug braucht auf kleinen Displays kein Plus-Menü', () => {
    assert.equal(shouldCollapseChatTools({
        availableWidth: 390,
        toolCount: 1,
        buttonSize: 44,
        gap: 8,
        horizontalPadding: 30,
        sendWidth: 44,
        minimumInputWidth: 150,
        previewWidth: 0
    }), false);
});

test('Mikrofon ist an das Textfeld angeheftet und bleibt ausserhalb des Plus-Menüs', () => {
    const micStart = html.indexOf('<button id="chat-mic-btn"');
    const toolsStart = html.indexOf('<div id="chat-input-tools"');
    const previewStart = html.indexOf('<div id="chat-sketch-preview"');
    const composerStart = html.indexOf('<div id="chat-composer"');
    const inputStart = html.indexOf('<input type="text" id="chat-input"');
    const toolsMarkup = html.slice(toolsStart, previewStart);
    const composerMarkup = html.slice(composerStart, html.indexOf('<button id="chat-send-btn"'));

    assert.ok(micStart >= 0);
    assert.ok(toolsStart >= 0);
    assert.ok(previewStart > toolsStart);
    assert.ok(composerStart > previewStart);
    assert.ok(micStart > composerStart);
    assert.ok(inputStart > micStart);
    assert.match(toolsMarkup, /id="chat-tools-toggle"/);
    assert.match(toolsMarkup, /class="chat-tools-plus-icon"/);
    assert.doesNotMatch(toolsMarkup, />\s*\+\s*</);
    assert.doesNotMatch(toolsMarkup, /id="chat-mic-btn"/);
    assert.match(toolsMarkup, /id="chat-draw-btn"/);
    assert.match(toolsMarkup, /id="chat-photo-btn"/);
    assert.match(toolsMarkup, /id="chat-visualize-btn"/);
    assert.doesNotMatch(toolsMarkup, /id="chat-sketch-preview"/);
    assert.match(composerMarkup, /id="chat-mic-btn"/);
    assert.match(composerMarkup, /placeholder="Schreiben oder sprechen …"/);
});

test('Textfeld darf schrumpfen und der Senden-Button behält seinen Platz', () => {
    assert.match(css, /#chat-input\s*\{[^}]*min-width:\s*0;[^}]*width:\s*0;/s);
    assert.match(css, /#chat-send-btn\s*\{[^}]*flex:\s*0 0 auto;/s);
});

test('Mikrofon und Textfeld teilen sich eine fokussierbare Eingabekapsel', () => {
    assert.match(css, /\.chat-composer\s*\{[^}]*display:\s*flex;[^}]*border-radius:\s*24px;/s);
    assert.match(css, /\.chat-composer\s*\{[^}]*border:\s*2px solid #cbd5e1;/s);
    assert.match(css, /\.chat-composer:focus-within\s*\{/);
    assert.match(css, /\.chat-composer-mic\s*\{[^}]*flex:\s*0 0 48px;[^}]*border-radius:\s*22px 0 0 22px;/s);
    assert.match(css, /\.chat-composer-mic:active\s*\{[^}]*transform:\s*scale\(0\.96\);/s);
});

test('Aufnahmezustand aktualisiert Kapsel, Hilfetext und Screenreader-Beschriftung gemeinsam', () => {
    assert.match(app, /function setMicRecordingState\(recording\)/);
    assert.match(app, /chatComposer\.classList\.toggle\('is-recording', recording\)/);
    assert.match(app, /recording \? 'Ich höre zu …' : 'Schreiben oder sprechen …'/);
    assert.match(app, /recording \? 'Spracheingabe stoppen' : 'Text einsprechen'/);
});
