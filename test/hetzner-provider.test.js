const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(root, 'api.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/**
 * Laedt api.js in einer minimalen Browser-Attrappe und gibt window.RechengeschichtenAPI
 * zurueck. So lassen sich die Provider-Entscheidungen echt testen statt nur per Regex.
 */
function loadApi({ storage = {}, nativeProxy = false } = {}) {
    const store = { ...storage };
    const fakeWindow = { nativeApiProxyAvailable: nativeProxy };
    const fakeLocalStorage = {
        getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
        setItem: (key, value) => { store[key] = String(value); },
        removeItem: (key) => { delete store[key]; },
    };
    const factory = new Function(
        'window', 'localStorage', 'performance', 'console', 'fetch', 'document',
        `${apiSource}\nreturn window.RechengeschichtenAPI;`
    );
    return factory(
        fakeWindow,
        fakeLocalStorage,
        { now: () => 0 },
        console,
        async () => { throw new Error('Netzwerkzugriff im Test nicht erlaubt'); },
        undefined
    );
}

const HETZNER_MODEL_KEY = 'rechengeschichten_hetzner_model';
const HETZNER_URL_KEY = 'rechengeschichten_hetzner_worker_url';
const TEST_PROXY = 'https://eigener-proxy.example.dev';

// ===== Provider-Auswahl =====

test('Hetzner ist aus, solange kein Modell gewaehlt ist', () => {
    const api = loadApi({ storage: { [HETZNER_URL_KEY]: TEST_PROXY } });
    assert.equal(api.getHetznerModel(), null);
    assert.equal(api.getActiveProvider(), null);
});

test('Ein Modell ohne eigene Proxy-URL bleibt wirkungslos', () => {
    const api = loadApi({ storage: { [HETZNER_MODEL_KEY]: 'DeepSeek-V4-Flash-0731' } });
    assert.equal(api.getHetznerModel(), null);
    assert.equal(api.getActiveProvider(), null);
});

test('Ein gewaehltes Hetzner-Modell aktiviert den Provider vor Google und Groq', () => {
    const api = loadApi({
        storage: {
            [HETZNER_MODEL_KEY]: 'DeepSeek-V4-Flash-0731',
            [HETZNER_URL_KEY]: TEST_PROXY,
            rechengeschichten_google_api_key: 'AIzaTestKeyTestKeyTestKey',
            rechengeschichten_api_key: 'gsk_TestKeyTestKeyTestKey',
        },
    });
    assert.equal(api.getActiveProvider(), 'hetzner');
    assert.equal(api.getSelectedModel(), 'DeepSeek-V4-Flash-0731');
});

test('Ausschalten stellt die bisherige Reihenfolge wieder her', () => {
    const api = loadApi({
        storage: { rechengeschichten_google_api_key: 'AIzaTestKeyTestKeyTestKey' },
    });
    assert.equal(api.getActiveProvider(), 'google');
});

test('Der native iOS-Proxy behaelt Vorrang vor dem Hetzner-Test', () => {
    const api = loadApi({
        storage: { [HETZNER_MODEL_KEY]: 'DeepSeek-V4-Flash-0731', [HETZNER_URL_KEY]: TEST_PROXY },
        nativeProxy: true,
    });
    assert.equal(api.getActiveProvider(), 'google');
});

test('Ein unbekanntes gespeichertes Modell schaltet Hetzner ab, statt es blind zu senden', () => {
    const api = loadApi({ storage: { [HETZNER_MODEL_KEY]: 'gpt-4o', [HETZNER_URL_KEY]: TEST_PROXY } });
    assert.equal(api.getHetznerModel(), null);
    assert.equal(api.getActiveProvider(), null);
});

// ===== Bild-Modelle =====

test('Fuer Bilder wird ein reines Text-Modell durch das Vision-Modell ersetzt', () => {
    // DeepSeek und GLM antworten sonst mit HTTP 400 "is not a multimodal model"
    for (const textOnly of ['DeepSeek-V4-Flash-0731', 'GLM-5.2-NVFP4']) {
        const api = loadApi({ storage: { [HETZNER_MODEL_KEY]: textOnly, [HETZNER_URL_KEY]: TEST_PROXY } });
        assert.equal(api.getVisionModel(), 'Kimi-K2.7-Code');
        assert.equal(api.providerSupportsVision(), true);
    }
});

test('Ein bereits multimodales Modell bleibt fuer Bilder erhalten', () => {
    for (const multimodal of ['Kimi-K2.7-Code', 'Qwen3.8-27B']) {
        const api = loadApi({ storage: { [HETZNER_MODEL_KEY]: multimodal, [HETZNER_URL_KEY]: TEST_PROXY } });
        assert.equal(api.getVisionModel(), multimodal);
    }
});

test('Ohne Hetzner bleibt das Groq-Vision-Modell unveraendert', () => {
    const api = loadApi({ storage: { rechengeschichten_api_key: 'gsk_TestKeyTestKeyTestKey' } });
    assert.equal(api.getVisionModel(), 'meta-llama/llama-4-scout-17b-16e-instruct');
});

// ===== Worker-URL =====

test('Ohne eigene Proxy-URL gibt es keine Vorgabe', () => {
    const api = loadApi();
    assert.equal(api.getHetznerWorkerUrl(), '');
    assert.equal(api.getOpenRouterWorkerUrl(), '');
});

test('Eine eigene Worker-URL wird ohne Trailing Slash uebernommen', () => {
    const api = loadApi({
        storage: { [HETZNER_URL_KEY]: TEST_PROXY + '/' },
    });
    assert.equal(api.getHetznerWorkerUrl(), TEST_PROXY);
});
