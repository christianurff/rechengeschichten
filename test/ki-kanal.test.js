/**
 * KI-Kanal der App-Sammlung (Matheforscher-Protokoll v3.2).
 *
 * Geprueft wird der zentrale Trichter kiChatCompletion() in api.js zusammen mit
 * der Protokoll-Bridge: hello -> Status, ki-request/ki-response-Roundtrip,
 * JSON-Faehigkeit, Bilder nur mit 'vision', Absender-Check und die Regel
 * „bei 'deaktiviert' KEIN Rueckfall auf den eigenen Zugang".
 *
 * Laeuft ohne Netz und ohne Schluessel: fetch wirft in der Attrappe.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(root, 'matheforscher-bridge.js'), 'utf8');
const stylesSource = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/**
 * Minimale Browser-Attrappe: window sitzt in einem iframe (self !== top), der
 * Parent sammelt alle postMessage-Aufrufe. vomHost() spielt Host-Nachrichten ein.
 */
function bauWelt(storage = {}) {
    const gesendet = [];
    const listener = [];
    const store = { ...storage };
    const klassen = new Set();

    const parent = { postMessage(msg) { gesendet.push(msg); } };
    const body = {
        classList: {
            add: (c) => klassen.add(c),
            remove: (c) => klassen.delete(c),
            contains: (c) => klassen.has(c),
            toggle: (c, an) => (an ? klassen.add(c) : klassen.delete(c)),
        }
    };
    const doc = { body, addEventListener() {}, getElementById() { return null; } };
    const win = {
        parent,
        self: {},
        top: {},
        location: { search: '', hash: '', protocol: 'https:' },
        document: doc,
        addEventListener(type, fn) { if (type === 'message') listener.push(fn); },
        localStorage: {
            getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
        },
    };

    async function vomHost(data, source) {
        const src = source === undefined ? parent : source;
        for (const fn of listener) await fn({ data, source: src, origin: 'https://urff.app' });
    }

    const bridgeFactory = new Function(
        'window', 'document', 'location', 'console', 'URLSearchParams', 'setTimeout', 'clearTimeout',
        bridgeSource
    );
    bridgeFactory(win, doc, win.location, console, URLSearchParams, setTimeout, clearTimeout);

    const apiFactory = new Function(
        'window', 'localStorage', 'performance', 'console', 'fetch', 'document',
        `${apiSource}\nreturn window.RechengeschichtenAPI;`
    );
    const api = apiFactory(
        win, win.localStorage, { now: () => 0 }, console,
        async () => { throw new Error('Netzwerkzugriff im Test nicht erlaubt'); },
        doc
    );

    return { win, api, gesendet, vomHost, bridge: win.Matheforscher };
}

/** hello mit KI-Kanal schicken. */
function hello(faehigkeiten = ['text', 'json'], status = 'bereit') {
    return {
        type: 'matheforscher:hello', host: 'urffapp', version: 3,
        capabilities: ['context', 'ergebnis', 'report', 'ki'],
        ki: status === 'bereit' ? { status, faehigkeiten, anbieter: 'byok' } : { status }
    };
}

/** Wartet einen Microtask-Durchlauf ab, damit der ki-request abgeschickt ist. */
const tick = () => new Promise((r) => setImmediate(r));

// ===== Status =====

test('standalone: kein Kanal -> eigener-zugang, App arbeitet wie bisher', () => {
    const { api } = bauWelt();
    assert.equal(api.getKiKanalStatus(), 'eigener-zugang');
    assert.equal(api.kiKanalBereit(), false);
    // Ohne hinterlegten Zugang gibt es keinen Anbieter - die KI-Funktionen bleiben aus.
    assert.equal(api.getActiveProvider(), null);
    assert.equal(api.hasValidApiKey(), false);
});

test('standalone mit eigenem Key: Anbieter steht bereit', () => {
    const { api } = bauWelt({ rechengeschichten_google_api_key: 'AIzaTestKeyTestKeyTestKey' });
    assert.equal(api.getActiveProvider(), 'google');
    assert.equal(api.hasValidApiKey(), true);
});

test('Host ohne "ki" in capabilities: ein mitgeschicktes ki-Feld wird ignoriert', async () => {
    const w = bauWelt();
    await w.vomHost({
        type: 'matheforscher:hello', host: 'mathe.digital', version: 3,
        capabilities: ['context', 'ergebnis', 'report'],
        ki: { status: 'bereit', faehigkeiten: ['text'] }
    });
    assert.equal(w.api.getKiKanalStatus(), 'eigener-zugang');
});

test('Status "eigener-zugang" vom Host: eigener Anbieter bleibt aktiv', async () => {
    const w = bauWelt({ rechengeschichten_google_api_key: 'AIzaTestKeyTestKeyTestKey' });
    await w.vomHost(hello([], 'eigener-zugang'));
    assert.equal(w.api.getKiKanalStatus(), 'eigener-zugang');
    assert.equal(w.api.getActiveProvider(), 'google');
    assert.equal(w.api.providerSupportsVision(), true);
});

test('hello mit ki bereit: Status, Faehigkeiten und onKiStatus-Meldungen', async () => {
    const w = bauWelt();
    const meldungen = [];
    w.bridge.onKiStatus((s) => meldungen.push(s));
    await w.vomHost(hello(['text', 'json']));
    assert.equal(w.api.getKiKanalStatus(), 'bereit');
    assert.deepEqual(w.bridge.kiFaehigkeiten(), ['text', 'json']);
    assert.equal(w.api.kiKanalKann('json'), true);
    assert.equal(w.api.kiKanalKann('vision'), false);
    assert.deepEqual(meldungen, ['eigener-zugang', 'bereit']);
});

test('ready traegt das Manifest-Feld ki (Beschreibung + Faehigkeiten)', async () => {
    const w = bauWelt();
    await w.vomHost(hello());
    const ready = w.gesendet.find((m) => m.type === 'matheforscher:ready');
    assert.ok(ready, 'kein ready gesendet');
    assert.equal(typeof ready.payload.manifest.ki.beschreibung, 'string');
    assert.deepEqual(ready.payload.manifest.ki.faehigkeiten, ['text', 'json', 'vision']);
});

// ===== Roundtrip =====

test('bereit: Trichter schickt ki-request nach Spec und liefert payload.text', async () => {
    const w = bauWelt();
    await w.vomHost(hello());
    w.gesendet.length = 0;

    const p = w.api.kiChatCompletion([{ role: 'user', content: 'Erklaere 7 + 5.' }], {
        zweck: 'strategie-chat', max_tokens: 600, temperature: 0.7
    });
    await tick();

    const anfrage = w.gesendet.find((m) => m.type === 'matheforscher:ki-request');
    assert.ok(anfrage, 'kein ki-request gesendet');
    assert.equal(typeof anfrage.id, 'string');
    assert.deepEqual(anfrage.payload.messages, [{ role: 'user', content: 'Erklaere 7 + 5.' }]);
    assert.equal(anfrage.payload.zweck, 'strategie-chat');
    assert.equal(anfrage.payload.modell, 'schnell');
    assert.equal(anfrage.payload.maxTokens, 600);
    assert.equal(anfrage.payload.temperature, 0.7);
    assert.equal(anfrage.payload.antwortFormat, undefined);

    await w.vomHost({
        type: 'matheforscher:ki-response', id: anfrage.id,
        payload: { text: '  Zaehle weiter.  ', anbieter: 'byok' }
    });
    assert.equal(await p, 'Zaehle weiter.');
});

test('json-Faehigkeit: antwortFormat wird gesetzt, payload.json kommt parsebar zurueck', async () => {
    const w = bauWelt();
    await w.vomHost(hello(['text', 'json']));
    w.gesendet.length = 0;

    const p = w.api.kiChatCompletion([{ role: 'user', content: 'Klassifiziere.' }], {
        zweck: 'aufgabe-klassifizieren', json: true, max_tokens: 700, temperature: 0.2
    });
    await tick();
    const anfrage = w.gesendet.find((m) => m.type === 'matheforscher:ki-request');
    assert.equal(anfrage.payload.antwortFormat, 'json');

    await w.vomHost({
        type: 'matheforscher:ki-response', id: anfrage.id,
        payload: { text: 'egal', json: { type: 'standard', confidence: 0.9 } }
    });
    assert.deepEqual(JSON.parse(await p), { type: 'standard', confidence: 0.9 });
});

test('ohne json-Faehigkeit: kein antwortFormat, Text wird robust geparst', async () => {
    const w = bauWelt();
    await w.vomHost(hello(['text']));
    w.gesendet.length = 0;

    const p = w.api.kiChatCompletion([{ role: 'user', content: 'x' }], { zweck: 'test', json: true });
    await tick();
    const anfrage = w.gesendet.find((m) => m.type === 'matheforscher:ki-request');
    assert.equal(anfrage.payload.antwortFormat, undefined);

    await w.vomHost({
        type: 'matheforscher:ki-response', id: anfrage.id,
        payload: { text: 'Text drumherum {"a":1} und noch mehr' }
    });
    const text = await p;
    assert.deepEqual(JSON.parse(text.match(/\{[\s\S]*\}/)[0]), { a: 1 });
});

// ===== Bilder =====

test('Bild-Mapping: image_url wird zu { type: "image", dataUrl }', () => {
    const { api } = bauWelt();
    assert.deepEqual(
        api.toKiKanalMessages([{ role: 'user', content: [
            { type: 'text', text: 'Was steht da?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
        ] }]),
        [{ role: 'user', content: [
            { type: 'text', text: 'Was steht da?' },
            { type: 'image', dataUrl: 'data:image/png;base64,AAA' }
        ] }]
    );
});

test('bereit ohne vision: Bildanfrage wird abgelehnt, kein ki-request', async () => {
    const w = bauWelt();
    await w.vomHost(hello(['text', 'json']));
    assert.equal(w.api.providerSupportsVision(), false);
    w.gesendet.length = 0;

    await assert.rejects(
        w.api.kiChatCompletion([{ role: 'user', content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }
        ] }], { zweck: 'aufgabe-erkennen', vision: true }),
        /keine Bilder ansehen/
    );
    assert.equal(w.gesendet.filter((m) => m.type === 'matheforscher:ki-request').length, 0);
});

test('bereit mit vision: Foto-Funktionen bleiben an', async () => {
    const w = bauWelt();
    await w.vomHost(hello(['text', 'vision']));
    assert.equal(w.api.providerSupportsVision(), true);
});

// ===== Fehler, Absender, Abbruch =====

test('ki-error: Promise rejected mit Fehlercode aus der Payload', async () => {
    const w = bauWelt();
    await w.vomHost(hello());
    w.gesendet.length = 0;

    const p = w.api.kiChatCompletion([{ role: 'user', content: 'x' }], { zweck: 'test' });
    await tick();
    const anfrage = w.gesendet.find((m) => m.type === 'matheforscher:ki-request');
    await w.vomHost({
        type: 'matheforscher:ki-error', id: anfrage.id,
        payload: { code: 'limit', message: 'Warteschlange voll' }
    });
    await assert.rejects(p, (err) => err.code === 'limit' && /Warteschlange voll/.test(err.message));
});

test('Absender-Check: Antwort eines fremden Fensters wird ignoriert', async () => {
    const w = bauWelt();
    await w.vomHost(hello());
    w.gesendet.length = 0;

    const p = w.api.kiChatCompletion([{ role: 'user', content: 'x' }], { zweck: 'test' });
    await tick();
    const anfrage = w.gesendet.find((m) => m.type === 'matheforscher:ki-request');

    let erledigt = false;
    p.then(() => { erledigt = true; }, () => { erledigt = true; });
    await w.vomHost({ type: 'matheforscher:ki-response', id: anfrage.id, payload: { text: 'eingeschleust' } }, { fremd: true });
    await tick();
    assert.equal(erledigt, false, 'fremde Antwort haette ignoriert werden muessen');

    await w.vomHost({ type: 'matheforscher:ki-response', id: anfrage.id, payload: { text: 'echt' } });
    assert.equal(await p, 'echt');
});

// ===== deaktiviert =====

test('ki-status "deaktiviert": kein Rueckfall auf eigene Zugaenge', async () => {
    const w = bauWelt({
        rechengeschichten_google_api_key: 'AIzaTestKeyTestKeyTestKey',
        rechengeschichten_api_key: 'gsk_TestKeyTestKeyTestKey',
    });
    await w.vomHost(hello());
    assert.equal(w.api.hasValidApiKey(), true);

    await w.vomHost({ type: 'matheforscher:ki-status', payload: { status: 'deaktiviert' } });
    assert.equal(w.api.getKiKanalStatus(), 'deaktiviert');
    assert.equal(w.api.hasValidApiKey(), false);
    assert.equal(w.api.providerSupportsVision(), false);
    assert.equal(w.api.canTranscribeWithCloud(), false);

    w.gesendet.length = 0;
    await assert.rejects(
        w.api.kiChatCompletion([{ role: 'user', content: 'x' }], { zweck: 'test' }),
        (err) => err.code === 'deaktiviert'
    );
    assert.equal(w.gesendet.filter((m) => m.type === 'matheforscher:ki-request').length, 0);
});

// ===== Struktur: ein einziger Trichter =====

test('api.js hat genau einen Chat-Aufruf pro Weg - alles laeuft ueber kiChatCompletion', () => {
    const treffer = apiSource.match(/getGroqApiUrl\('\/chat\/completions'\)/g) || [];
    assert.equal(treffer.length, 1, 'Es darf nur den Groq-Aufruf im Trichter geben');
    assert.equal((apiSource.match(/callGoogleAPI\(/g) || []).length, 2, 'Definition + genau ein Aufruf im Trichter');
    assert.equal((apiSource.match(/callOpenRouterAPI\(/g) || []).length, 2, 'Definition + genau ein Aufruf im Trichter');
    // Die Transkription ist bewusst KEINE Chat-Anfrage und bleibt unveraendert.
    assert.match(apiSource, /getGroqApiUrl\('\/audio\/transcriptions'\)/);
});

test('UI-Hinweise fuer bereit/deaktiviert sind vorhanden', () => {
    assert.match(htmlSource, /id="api-desc-kanal"[^>]*>Die KI kommt aus der App-Sammlung\./);
    assert.match(htmlSource, /id="api-desc-kanal-aus"/);
    assert.match(htmlSource, /id="ki-aus-hinweis"/);
    // Eigene Schluesselfelder verschwinden, sobald der Host die KI stellt.
    assert.match(stylesSource, /body\.ki-host #settings-api-zugang \.api-section/);
    assert.match(stylesSource, /body\.ki-aus #settings-api-zugang \.api-section/);
    assert.match(stylesSource, /body\.ki-aus #btn-generate/);
});
