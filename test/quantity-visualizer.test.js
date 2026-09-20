const { test } = require('node:test');
const assert = require('node:assert');
const {
  createState, addTokens, removeTokens, activeTokens,
  applyMultiply, prepareGroups, summarizeTotal, applyDivide, applyBundle,
  validateStep, normalizeStep, parseVisualizationTag, parseVisualizationSteps, stripVisualizationTag,
  reduceStep, chooseStructure, computeLayout
} = require('../quantity-visualizer.js');

test('parseVisualizationSteps: mehrere Tags in einer Nachricht', () => {
  const txt = 'Hier! [VISUALISIERUNG]{"aktion":"vorbereiten","objekte":[{"name":"karte"}]}[/VISUALISIERUNG] und ' +
    '[VISUALISIERUNG]{"aktion":"hinzufuegen","objekt":"karte","anzahl":24}[/VISUALISIERUNG]';
  const steps = parseVisualizationSteps(txt);
  assert.strictEqual(steps.length, 2);
  assert.strictEqual(steps[0].aktion, 'vorbereiten');
  assert.strictEqual(steps[1].aktion, 'hinzufuegen');
  assert.strictEqual(steps[1].anzahl, 24);
});

test('parseVisualizationSteps: Array in einem Tag', () => {
  const txt = '[VISUALISIERUNG][{"aktion":"vorbereiten","objekte":[{"name":"k"}]},{"aktion":"hinzufuegen","objekt":"k","anzahl":5}][/VISUALISIERUNG]';
  const steps = parseVisualizationSteps(txt);
  assert.strictEqual(steps.length, 2);
  assert.strictEqual(steps[1].anzahl, 5);
});

test('reduceStep: erneutes vorbereiten löscht bereits gelegte Token NICHT', () => {
  let s = reduceStep(createState(), { aktion: 'vorbereiten', objekte: [{ name: 'karte' }] });
  s = reduceStep(s, { aktion: 'hinzufuegen', objekt: 'karte', anzahl: 24 });
  s = reduceStep(s, { aktion: 'vorbereiten', objekte: [{ name: 'karte' }] }); // erneut (z.B. nächste Gruppe)
  s = reduceStep(s, { aktion: 'hinzufuegen', objekt: 'karte', anzahl: 28 });
  assert.strictEqual(activeTokens(s).length, 52);
});

test('normalizeStep: verschachtelte Form {vorbereiten:{...}} -> aktion-Form', () => {
  const n = normalizeStep({ vorbereiten: { objekte: [{ name: 'apfel' }], darstellung: 'symbol' } });
  assert.strictEqual(n.aktion, 'vorbereiten');
  assert.strictEqual(n.objekte[0].name, 'apfel');
});

test('parseVisualizationTag: verschachtelte Form wird toleriert', () => {
  const s = parseVisualizationTag('x [VISUALISIERUNG]{"hinzufuegen":{"objekt":"apfel","anzahl":5}}[/VISUALISIERUNG]');
  assert.strictEqual(s.aktion, 'hinzufuegen');
  assert.strictEqual(s.anzahl, 5);
});

test('reduceStep: verschachtelte Form funktioniert end-to-end', () => {
  let s = reduceStep(createState(), { vorbereiten: { objekte: [{ name: 'apfel' }] } });
  s = reduceStep(s, { hinzufuegen: { objekt: 'apfel', anzahl: 5 } });
  s = reduceStep(s, { wegnehmen: { objekt: 'apfel', anzahl: 2 } });
  assert.strictEqual(activeTokens(s).length, 3);
});

// ---------- Zustand & Add/Remove ----------

test('createState: leerer Zustand', () => {
  const s = createState();
  assert.deepStrictEqual(s.tokens, []);
  assert.strictEqual(s.darstellung, 'symbol');
  assert.strictEqual(s.layout, 'auto');
  assert.strictEqual(s.nextId, 1);
});

test('addTokens: fügt N aktive Token mit stabiler ID hinzu', () => {
  const s = addTokens(createState(), 'keks', 3);
  assert.strictEqual(s.tokens.length, 3);
  assert.deepStrictEqual(s.tokens.map(t => t.id), ['t1', 't2', 't3']);
  assert.ok(s.tokens.every(t => t.status === 'aktiv' && t.kind === 'keks' && t.group === null));
});

test('addTokens: ist immutabel (Original unverändert)', () => {
  const s0 = createState();
  addTokens(s0, 'keks', 2);
  assert.strictEqual(s0.tokens.length, 0);
});

test('removeTokens: markiert die letzten N aktiven Token als entfernt', () => {
  let s = addTokens(createState(), 'keks', 12);
  s = removeTokens(s, 'keks', 3);
  assert.strictEqual(activeTokens(s).length, 9);
  assert.strictEqual(s.tokens.filter(t => t.status === 'entfernt').length, 3);
  assert.deepStrictEqual(s.tokens.slice(9).map(t => t.status), ['entfernt', 'entfernt', 'entfernt']);
});

test('removeTokens: mehr als vorhanden -> alle entfernt, kein Fehler', () => {
  let s = addTokens(createState(), 'keks', 2);
  s = removeTokens(s, 'keks', 5);
  assert.strictEqual(activeTokens(s).length, 0);
});

// ---------- Multiplikation, Division, Bündeln ----------

test('applyMultiply gruppen: 3x4 -> 12 Token in 3 Gruppen zu 4', () => {
  let s = createState(); s.objects = [{ name: 'murmel' }];
  s = applyMultiply(s, 3, 4, 'gruppen');
  assert.strictEqual(activeTokens(s).length, 12);
  assert.strictEqual(s.layout, 'gruppen');
  assert.strictEqual(s.groupCount, 3);
  assert.strictEqual(s.tokens.filter(t => t.group === 'g0').length, 4);
  assert.ok(s.tokens.every(t => t.kind === 'murmel'));
});

test('prepareGroups: legt leere, benannte Gruppen mit reservierter Breite an', () => {
  const s = prepareGroups(createState(), 4, 3, 'Hase');
  assert.strictEqual(activeTokens(s).length, 0);
  assert.strictEqual(s.layout, 'gruppen');
  assert.strictEqual(s.groupCount, 4);
  assert.strictEqual(s.groupCapacity, 3);
  assert.strictEqual(s.groupLabel, 'Hase');
  const layout = computeLayout(s);
  assert.strictEqual(layout.boxes.length, 4);
  assert.deepStrictEqual(layout.boxes.map(b => b.label), ['Hase 1', 'Hase 2', 'Hase 3', 'Hase 4']);
});

test('Malabfolge: leere Gruppen bleiben beim Fuellen stabil und werden danach zusammengefasst', () => {
  let s = prepareGroups(createState(), 4, 3, 'Hase');
  const emptyBoxes = computeLayout(s).boxes;
  s = applyMultiply(s, 4, 3, 'gruppen');
  const filledBoxes = computeLayout(s).boxes;
  assert.deepStrictEqual(
    filledBoxes.map(b => [b.x, b.y, b.w, b.h]),
    emptyBoxes.map(b => [b.x, b.y, b.w, b.h])
  );
  assert.strictEqual(activeTokens(s).length, 12);
  assert.strictEqual(s.groupLabel, 'Hase');

  s = summarizeTotal(s);
  assert.strictEqual(activeTokens(s).length, 12);
  assert.strictEqual(s.layout, 'auto');
  assert.ok(activeTokens(s).every(t => t.group === null));
});

test('applyMultiply feld: 4x3 -> dims rows=4 cols=3, ein Pool', () => {
  let s = applyMultiply(createState(), 4, 3, 'feld');
  assert.strictEqual(activeTokens(s).length, 12);
  assert.strictEqual(s.layout, 'feld');
  assert.deepStrictEqual(s.dims, { rows: 4, cols: 3 });
  assert.ok(s.tokens.every(t => t.group === null));
});

test('applyDivide verteilen: 9 auf 3 Gruppen -> je 3 (Round-Robin)', () => {
  let s = addTokens(createState(), 'keks', 9);
  s = applyDivide(s, 'verteilen', 3);
  assert.strictEqual(s.groupCount, 3);
  for (const g of ['g0', 'g1', 'g2']) {
    assert.strictEqual(s.tokens.filter(t => t.group === g).length, 3);
  }
});

test('applyDivide verteilen: nur aktive Token werden verteilt', () => {
  let s = addTokens(createState(), 'keks', 12);
  s = removeTokens(s, 'keks', 3);
  s = applyDivide(s, 'verteilen', 3);
  assert.strictEqual(s.tokens.filter(t => t.status === 'aktiv' && t.group === 'g0').length, 3);
  assert.strictEqual(activeTokens(s).length, 9);
});

test('applyDivide aufteilen: 12, je 3 -> 4 Gruppen', () => {
  let s = addTokens(createState(), 'keks', 12);
  s = applyDivide(s, 'aufteilen', 3);
  assert.strictEqual(s.groupCount, 4);
  assert.deepStrictEqual(
    [0, 1, 2, 3].map(i => s.tokens.filter(t => t.group === 'g' + i).length), [3, 3, 3, 3]);
});

test('applyBundle: 23 in Zehnerbündel -> 3 Bündel (10/10/3)', () => {
  let s = addTokens(createState(), 'stift', 23);
  s = applyBundle(s, 10);
  assert.strictEqual(s.layout, 'buendel');
  assert.strictEqual(s.groupCount, 3);
  assert.strictEqual(s.tokens.filter(t => t.group === 'b0').length, 10);
  assert.strictEqual(s.tokens.filter(t => t.group === 'b2').length, 3);
});

test('removePerGroup: jedes von 3 Gruppen zu 12 verliert 4 -> je 8 (gesamt 24)', () => {
  let s = addTokens(createState(), 'gummi', 36);
  s = applyDivide(s, 'verteilen', 3);          // 3 Gruppen zu 12
  s = require('../quantity-visualizer.js').removePerGroup(s, 4);
  assert.strictEqual(activeTokens(s).length, 24);
  for (const g of ['g0', 'g1', 'g2']) {
    assert.strictEqual(s.tokens.filter(t => t.status === 'aktiv' && t.group === g).length, 8);
  }
});

test('addPerGroup: jede von 2 Gruppen bekommt 3 dazu', () => {
  const QV = require('../quantity-visualizer.js');
  let s = addTokens(createState(), 'x', 4);
  s = applyDivide(s, 'verteilen', 2);          // 2 Gruppen zu 2
  s = QV.addPerGroup(s, 3, 'x');
  assert.strictEqual(activeTokens(s).length, 10); // 4 + 2*3
});

test('applyMultiply anhaengen: 2x12 + 3x8 = 48 in 5 Gruppen', () => {
  let s = createState(); s.objects = [{ name: 'euro' }];
  s = applyMultiply(s, 2, 12, 'gruppen');
  s = applyMultiply(s, 3, 8, 'gruppen', true);  // anhaengen
  assert.strictEqual(activeTokens(s).length, 48);
  assert.strictEqual(s.groupCount, 5);
});

test('applyMultiply ohne anhaengen ersetzt die Arbeitsmenge', () => {
  let s = createState(); s.objects = [{ name: 'euro' }];
  s = applyMultiply(s, 2, 12, 'gruppen');
  s = applyMultiply(s, 3, 8, 'gruppen');        // kein anhaengen -> ersetzt
  assert.strictEqual(activeTokens(s).length, 24);
});

test('applyMultiply: Faktor über Kappung bleibt korrekt (3x120=360)', () => {
  let s = createState(); s.objects = [{ name: 'km' }];
  s = applyMultiply(s, 3, 120, 'gruppen');
  assert.strictEqual(activeTokens(s).length, 360);
});

test('reduceStep: suessigkeiten (36 ÷3, jedes isst 4 -> 24 aktiv)', () => {
  let s = reduceStep(createState(), { aktion: 'vorbereiten', objekte: [{ name: 'gummi' }] });
  s = reduceStep(s, { aktion: 'hinzufuegen', objekt: 'gummi', anzahl: 36 });
  s = reduceStep(s, { aktion: 'teilen', grundvorstellung: 'verteilen', anzahlGruppen: 3 });
  s = reduceStep(s, { aktion: 'wegnehmen', anzahl: 4, jeGruppe: true });
  assert.strictEqual(activeTokens(s).length, 24);
});

test('reduceStep: cinema (2x12 + 3x8 anhaengen -> 48)', () => {
  let s = reduceStep(createState(), { aktion: 'vorbereiten', objekte: [{ name: 'euro' }] });
  s = reduceStep(s, { aktion: 'malnehmen', gruppen: 2, proGruppe: 12, grundvorstellung: 'gruppen' });
  s = reduceStep(s, { aktion: 'malnehmen', gruppen: 3, proGruppe: 8, grundvorstellung: 'gruppen', anhaengen: true });
  assert.strictEqual(activeTokens(s).length, 48);
});

// ---------- Validierung & Tag-Parsing ----------

test('validateStep: gültige Aktion', () => {
  assert.strictEqual(validateStep({ aktion: 'hinzufuegen', objekt: 'keks', anzahl: 3 }).ok, true);
});

test('validateStep: gruppen_anlegen braucht Gruppen und Gruppengröße', () => {
  assert.strictEqual(validateStep({ aktion: 'gruppen_anlegen', gruppen: 4 }).ok, false);
  assert.strictEqual(validateStep({ aktion: 'gruppen_anlegen', gruppen: 4, proGruppe: 3 }).ok, true);
  assert.strictEqual(validateStep({ aktion: 'zusammenfassen' }).ok, true);
});

test('validateStep: unbekannte Aktion -> ok:false', () => {
  assert.strictEqual(validateStep({ aktion: 'zaubern' }).ok, false);
});

test('validateStep: fehlende Anzahl bei hinzufuegen -> ok:false', () => {
  assert.strictEqual(validateStep({ aktion: 'hinzufuegen', objekt: 'keks' }).ok, false);
});

test('validateStep: teilen ohne anzahlGruppen/proGruppe -> ok:false', () => {
  assert.strictEqual(validateStep({ aktion: 'teilen', grundvorstellung: 'verteilen' }).ok, false);
  assert.strictEqual(validateStep({ aktion: 'teilen', grundvorstellung: 'verteilen', anzahlGruppen: 3 }).ok, true);
});

test('parseVisualizationTag: extrahiert JSON', () => {
  const txt = 'Schau mal! [VISUALISIERUNG]{"aktion":"hinzufuegen","objekt":"keks","anzahl":12}[/VISUALISIERUNG] Toll.';
  const step = parseVisualizationTag(txt);
  assert.strictEqual(step.aktion, 'hinzufuegen');
  assert.strictEqual(step.anzahl, 12);
});

test('parseVisualizationTag: kein Tag -> null', () => {
  assert.strictEqual(parseVisualizationTag('Nur Text.'), null);
});

test('parseVisualizationTag: kaputtes JSON -> null (kein Wurf)', () => {
  assert.strictEqual(parseVisualizationTag('[VISUALISIERUNG]{kaputt}[/VISUALISIERUNG]'), null);
});

test('stripVisualizationTag: entfernt Tag aus Text', () => {
  const txt = 'Hallo [VISUALISIERUNG]{"aktion":"zuruecksetzen"}[/VISUALISIERUNG] Welt';
  assert.strictEqual(stripVisualizationTag(txt).replace(/\s+/g, ' ').trim(), 'Hallo Welt');
});

// ---------- Dispatcher ----------

test('reduceStep: vorbereiten setzt Objekte und Darstellung', () => {
  const s = reduceStep(createState(), {
    aktion: 'vorbereiten',
    objekte: [{ name: 'keks', suchbegriff: 'keks', einheit: 1 }],
    darstellung: 'symbol'
  });
  assert.strictEqual(s.objects[0].name, 'keks');
  assert.strictEqual(s.darstellung, 'symbol');
});

test('reduceStep: Kette hinzufuegen -> wegnehmen -> teilen (mehrschrittig)', () => {
  let s = reduceStep(createState(), { aktion: 'vorbereiten', objekte: [{ name: 'keks' }] });
  s = reduceStep(s, { aktion: 'hinzufuegen', objekt: 'keks', anzahl: 12 });
  s = reduceStep(s, { aktion: 'wegnehmen', objekt: 'keks', anzahl: 3 });
  s = reduceStep(s, { aktion: 'teilen', grundvorstellung: 'verteilen', anzahlGruppen: 3 });
  assert.strictEqual(activeTokens(s).length, 9);
  assert.strictEqual(s.tokens.filter(t => t.status === 'aktiv' && t.group === 'g0').length, 3);
});

test('reduceStep: ungültiger Schritt lässt State unverändert', () => {
  const s0 = reduceStep(createState(), { aktion: 'hinzufuegen', objekt: 'keks', anzahl: 5 });
  const s1 = reduceStep(s0, { aktion: 'bloedsinn' });
  assert.deepStrictEqual(s1.tokens.map(t => t.id), s0.tokens.map(t => t.id));
});

// ---------- Layout ----------

test('chooseStructure: Schwellen', () => {
  assert.strictEqual(chooseStructure(7), 'fuenfer');
  assert.strictEqual(chooseStructure(10), 'fuenfer');
  assert.strictEqual(chooseStructure(11), 'feld');
  assert.strictEqual(chooseStructure(100), 'feld');
  assert.strictEqual(chooseStructure(120), 'buendel');
});

test('computeLayout: liefert für jedes aktive Token eine Position', () => {
  const s = addTokens(createState(), 'keks', 7);
  const out = computeLayout(s);
  assert.strictEqual(out.tokens.filter(t => !t.ghost).length, 7);
  assert.ok(out.tokens.every(t => typeof t.x === 'number' && typeof t.y === 'number'));
});

test('computeLayout: gleiches Objekt -> einheitliche Farbe', () => {
  const s = addTokens(createState(), 'keks', 7);
  const out = computeLayout(s);
  const colors = new Set(out.tokens.filter(t => !t.ghost).map(t => t.color));
  assert.strictEqual(colors.size, 1); // alle Plättchen gleicher Objektart = gleiche Farbe
});

test('computeLayout: verschiedene Objekte -> verschiedene Farben', () => {
  let s = reduceStep(createState(), { aktion: 'vorbereiten', objekte: [{ name: 'apfel' }, { name: 'birne' }] });
  s = addTokens(s, 'apfel', 3);
  s = addTokens(s, 'birne', 3);
  const out = computeLayout(s);
  const cApfel = out.tokens.find(t => t.kind === 'apfel').color;
  const cBirne = out.tokens.find(t => t.kind === 'birne').color;
  assert.notStrictEqual(cApfel, cBirne);
});

test('computeLayout: entfernte Token sind ghost', () => {
  let s = addTokens(createState(), 'keks', 5);
  s = removeTokens(s, 'keks', 2);
  const out = computeLayout(s);
  assert.strictEqual(out.tokens.filter(t => t.ghost).length, 2);
});

test('computeLayout gruppen: eine Box pro Gruppe, Farbe je Gruppe einheitlich', () => {
  let s = addTokens(createState(), 'keks', 9);
  s = applyDivide(s, 'verteilen', 3);
  const out = computeLayout(s);
  assert.strictEqual(out.boxes.length, 3);
  const g0ids = s.tokens.filter(t => t.group === 'g0').map(t => t.id);
  const colors = new Set(out.tokens.filter(t => g0ids.includes(t.id)).map(t => t.color));
  assert.strictEqual(colors.size, 1);
});

test('computeLayout feld: 4x3 -> 12 positionierte Token', () => {
  const s = applyMultiply(createState(), 4, 3, 'feld');
  const out = computeLayout(s);
  assert.strictEqual(out.tokens.filter(t => !t.ghost).length, 12);
});

test('computeLayout pool: Verteilen sammelt Token UNTER den Gruppen-Boxen', () => {
  let s = addTokens(createState(), 'keks', 9);
  s = applyDivide(s, 'verteilen', 3);
  const normal = computeLayout(s);
  const pooled = computeLayout(s, { pool: true });
  assert.strictEqual(pooled.boxes.length, 3);
  assert.strictEqual(pooled.tokens.filter(t => !t.ghost).length, 9);
  const boxBottom = Math.max.apply(null, normal.boxes.map(b => b.y + b.h));
  assert.ok(pooled.tokens.every(t => t.y >= boxBottom), 'Pool liegt unter den Boxen');
});

test('computeLayout: >100 nutzt Hundertertafeln nebeneinander', () => {
  const s = addTokens(createState(), 'euro', 150);
  const out = computeLayout(s);
  assert.strictEqual(out.tokens.filter(t => !t.ghost).length, 150);
  const byId = Object.fromEntries(out.tokens.map(t => [t.id, t]));
  // t1 = erster Block (links oben); t101 = Beginn 2. Block -> deutlich weiter rechts, gleiche Höhe
  assert.ok(byId['t101'].x > byId['t1'].x + 150, 'zweiter Block liegt rechts');
  assert.strictEqual(byId['t101'].y, byId['t1'].y, 'zweiter Block auf gleicher Höhe');
});
