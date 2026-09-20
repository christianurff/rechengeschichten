/*
 * Headless-Test der Render-Schicht (QuantityVisualizer) mit minimalem DOM-Stub.
 * Prüft, dass mount/applyStep/setRepresentation ohne Fehler laufen und die richtige
 * Anzahl Token-Elemente entsteht. (Kein echtes Layout/Pixel-Rendering.)
 */
const { test } = require('node:test');
const assert = require('node:assert');

// ---- minimaler DOM-Stub ----
function makeEl(tag) {
  const el = {
    tagName: tag, className: '', textContent: '', children: [], parentNode: null,
    style: {}, dataset: {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    remove() { if (el.parentNode) { const i = el.parentNode.children.indexOf(el); if (i >= 0) el.parentNode.children.splice(i, 1); } },
    querySelectorAll(sel) {
      const classes = sel.split(',').map(s => s.trim().replace(/^\./, ''));
      const out = [];
      (function walk(node) {
        (node.children || []).forEach(ch => {
          const toks = (ch.className || '').split(/\s+/);
          if (classes.some(c => toks.includes(c))) out.push(ch);
          walk(ch);
        });
      })(el);
      return out;
    },
    get offsetWidth() { return 1; }
  };
  Object.defineProperty(el, 'innerHTML', { get() { return ''; }, set(v) { if (v === '') el.children = []; } });
  return el;
}

global.document = { createElement: makeEl, getElementById: () => null };
global.window = global; // window.RechengeschichtenAPI bleibt undefined -> Plättchen-Fallback

require('../quantity-visualizer.js');
const QV = globalThis.QuantityVisualizer;

function countTokenEls() { return Object.keys(QV._els).length; }

test('Render: mount + Mehrschritt (12 -3 ÷3) ohne Fehler, korrekte Token-Anzahl', async () => {
  const container = makeEl('div');
  QV.mount(container);
  await QV.applyStep({ aktion: 'vorbereiten', objekte: [{ name: 'keks' }], darstellung: 'plaettchen' });
  await QV.applyStep({ aktion: 'hinzufuegen', objekt: 'keks', anzahl: 12 });
  await QV.applyStep({ aktion: 'wegnehmen', objekt: 'keks', anzahl: 3 });
  await QV.applyStep({ aktion: 'teilen', grundvorstellung: 'verteilen', anzahlGruppen: 3 });

  assert.strictEqual(QV.activeCountForTest ? QV.activeCountForTest() : QV.getState().tokens.filter(t => t.status === 'aktiv').length, 9);
  // 9 aktive + 3 entfernte = 12 Token-Elemente in der Bühne
  assert.strictEqual(countTokenEls(), 12);
  // Es gibt 3 Gruppen-Boxen
  const boxes = QV._stage.querySelectorAll('.qv-box');
  assert.strictEqual(boxes.length, 3);
});

test('Render: Symbol/Plättchen-Schalter wirft nicht', () => {
  assert.doesNotThrow(() => { QV.setRepresentation('symbol'); QV.setRepresentation('plaettchen'); });
});

test('Render: Teilen zeigt die Gruppen erst nach dem Sammeln unterhalb der Gruppenpositionen', async () => {
  const container = makeEl('div');
  QV.mount(container);
  QV.setSpeed('schnell');
  await QV.applyStep({ aktion: 'hinzufuegen', objekt: 'keks', anzahl: 6 });

  const renderCalls = [];
  const originalRender = QV._render;
  QV._render = async function (opts) {
    renderCalls.push(opts ? Object.assign({}, opts) : {});
    return originalRender.call(this, opts);
  };
  try {
    await QV.applyStep({ aktion: 'teilen', grundvorstellung: 'verteilen', anzahlGruppen: 2 });
  } finally {
    QV._render = originalRender;
    QV.setSpeed('langsam');
  }

  assert.deepStrictEqual(renderCalls.slice(0, 3), [
    { pool: true, hideBoxes: true },
    { pool: true },
    {}
  ]);
  assert.strictEqual(QV._stage.querySelectorAll('.qv-box').length, 2);
});

test('Render: Mal zeigt zuerst leere benannte Gruppen, dann deren Inhalt, dann die Gesamtmenge', async () => {
  const container = makeEl('div');
  QV.mount(container);
  await QV.applyStep({ aktion: 'vorbereiten', objekte: [{ name: 'karotte' }] });
  await QV.applyStep({ aktion: 'gruppen_anlegen', gruppen: 4, proGruppe: 3, gruppenname: 'Hase' });
  assert.strictEqual(countTokenEls(), 0);
  assert.strictEqual(QV._stage.querySelectorAll('.qv-box').length, 4);
  const labels = QV._stage.querySelectorAll('.qv-box-label').map(el => el.textContent);
  assert.deepStrictEqual(labels, ['Hase 1', 'Hase 2', 'Hase 3', 'Hase 4']);

  await QV.applyStep({ aktion: 'malnehmen', gruppen: 4, proGruppe: 3, grundvorstellung: 'gruppen' });
  assert.strictEqual(countTokenEls(), 12);
  assert.strictEqual(QV._stage.querySelectorAll('.qv-box').length, 4);

  await QV.applyStep({ aktion: 'zusammenfassen' });
  assert.strictEqual(countTokenEls(), 12);
  assert.strictEqual(QV._stage.querySelectorAll('.qv-box').length, 0);
});

test('Darstellung bleibt nach Neuaufbau erhalten (Bug-Fix: kein Zurückspringen auf Bilder)', async () => {
  const container = makeEl('div');
  QV.mount(container);
  QV.setRepresentation('plaettchen');
  // Neuaufbau über loadSequence (enthält "vorbereiten" mit darstellung:symbol)
  await QV.loadSequence([
    { aktion: 'vorbereiten', objekte: [{ name: 'keks' }], darstellung: 'symbol' },
    { aktion: 'hinzufuegen', objekt: 'keks', anzahl: 3 }
  ]);
  await QV.stepForward();
  await QV.stepForward();
  assert.strictEqual(QV.getRepresentation(), 'plaettchen'); // NICHT auf 'symbol' zurückgefallen
});

test('Render: reset leert Bühne und Token-Map', () => {
  QV.reset();
  assert.strictEqual(countTokenEls(), 0);
});

test('Speed: setSpeed wählt Profil, getStepPause passt, Fallback = langsam', () => {
  QV.setSpeed('schnell');
  assert.strictEqual(QV.getStepPause(), 700);
  QV.setSpeed('sehr-langsam');
  assert.strictEqual(QV.getStepPause(), 2600);
  QV.setSpeed('quatsch');
  assert.strictEqual(QV.getStepPause(), 1700); // Fallback 'langsam'
  QV.setSpeed('langsam');
});

test('Sequenz: loadSequence + stepForward/stepBack navigieren korrekt', async () => {
  const container = makeEl('div');
  QV.mount(container);
  await QV.loadSequence([
    { aktion: 'vorbereiten', objekte: [{ name: 'keks' }], darstellung: 'plaettchen' },
    { aktion: 'hinzufuegen', objekt: 'keks', anzahl: 5 },
    { aktion: 'wegnehmen', objekt: 'keks', anzahl: 2 }
  ]);
  assert.deepStrictEqual(QV.seqInfo(), { index: 0, total: 3 });
  const active = () => QV.getState().tokens.filter(t => t.status === 'aktiv').length;

  await QV.stepForward(); // vorbereiten
  await QV.stepForward(); // +5
  assert.strictEqual(active(), 5);
  assert.strictEqual(QV.seqInfo().index, 2);

  await QV.stepForward(); // -2
  assert.strictEqual(active(), 3);
  assert.strictEqual(QV.seqInfo().index, 3);

  await QV.stepBack();    // zurück auf Stand nach +5
  assert.strictEqual(active(), 5);
  assert.strictEqual(QV.seqInfo().index, 2);
});
