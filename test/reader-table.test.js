/*
 * Tests für parseAsciiTableToRows (reader-text-view.js).
 * Reine Parser-Funktion, DOM-unabhängig: [TABELLE]-ASCII-Pipe-Tabellen (OCR)
 * werden im Lesemodus als kindgerechte HTML-Tabelle gerendert.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const ReaderTextView = require('../reader-text-view.js');
const { parseAsciiTableToRows } = ReaderTextView;

test('Tabellenblock startet ohne zusaetzliche Tabelle-Ueberschrift', () => {
  const reader = Object.create(ReaderTextView.prototype);
  reader._escapeHtml = (text) => text;
  reader._escapeAttr = (text) => text;
  const html = reader._formatSingleGraphicTag([
    '[TABELLE]',
    '| Futterart | Preis pro Packung |',
    '| Kaninchenfutter | 4,00 Euro |',
    '[/TABELLE]',
  ].join('\n'));

  assert.match(html, /reader-table-block/);
  assert.match(html, /class="reader-graphic-content"/);
  assert.doesNotMatch(html, /reader-graphic-header/);
  assert.doesNotMatch(html, />\s*Tabelle\s*</);
});

test('parseAsciiTableToRows: Standardtabelle mit Trennzeile (Ticketart/Preis)', () => {
  const content = [
    '| Ticketart | Preis |',
    '|-----------|-------|',
    '| Kind      | 5 €   |',
    '| Erwachsener | 9 € |',
  ].join('\n');

  const rows = parseAsciiTableToRows(content);

  assert.deepStrictEqual(rows, [
    ['Ticketart', 'Preis'],
    ['Kind', '5 €'],
    ['Erwachsener', '9 €'],
  ]);
});

test('parseAsciiTableToRows: Tabelle ohne Trennzeile', () => {
  const content = [
    '| Ticketart | Preis |',
    '| Kind | 5 € |',
    '| Erwachsener | 9 € |',
  ].join('\n');

  const rows = parseAsciiTableToRows(content);

  assert.deepStrictEqual(rows, [
    ['Ticketart', 'Preis'],
    ['Kind', '5 €'],
    ['Erwachsener', '9 €'],
  ]);
});

test('parseAsciiTableToRows: kaputter Text ohne Pipe-Struktur -> null', () => {
  const content = 'Das ist einfach nur ein Fließtext ohne jede Tabellenstruktur.\nZweite Zeile.';

  assert.strictEqual(parseAsciiTableToRows(content), null);
});

test('parseAsciiTableToRows: leerer / nicht-string Input -> null', () => {
  assert.strictEqual(parseAsciiTableToRows(''), null);
  assert.strictEqual(parseAsciiTableToRows('   \n  '), null);
  assert.strictEqual(parseAsciiTableToRows(null), null);
  assert.strictEqual(parseAsciiTableToRows(undefined), null);
});

test('parseAsciiTableToRows: nur eine Datenzeile -> null (weniger als 2 Zeilen)', () => {
  assert.strictEqual(parseAsciiTableToRows('| Nur eine Zeile | ohne Rest |'), null);
});

test('parseAsciiTableToRows: Umlaute und €-Zeichen in Zellen bleiben erhalten', () => {
  const content = [
    '| Übung | Größe (m²) |',
    '|-------|------------|',
    '| Äpfel zählen | 12,5 € |',
    '| Bär malen | 3 |',
  ].join('\n');

  const rows = parseAsciiTableToRows(content);

  assert.deepStrictEqual(rows, [
    ['Übung', 'Größe (m²)'],
    ['Äpfel zählen', '12,5 €'],
    ['Bär malen', '3'],
  ]);
});

test('parseAsciiTableToRows: ungleiche Spaltenzahl wird mit \'\' aufgefüllt', () => {
  const content = [
    '| A | B | C |',
    '|---|---|---|',
    '| 1 | 2 |',
    '| 3 | 4 | 5 |',
  ].join('\n');

  const rows = parseAsciiTableToRows(content);

  assert.deepStrictEqual(rows, [
    ['A', 'B', 'C'],
    ['1', '2', ''],
    ['3', '4', '5'],
  ]);
});

test('parseAsciiTableToRows: Trennzeile mit Doppelpunkten (Ausrichtung) wird übersprungen', () => {
  const content = [
    '| Links | Rechts |',
    '|:------|-------:|',
    '| a | b |',
    '| c | d |',
  ].join('\n');

  const rows = parseAsciiTableToRows(content);

  assert.deepStrictEqual(rows, [
    ['Links', 'Rechts'],
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

test('parseAsciiTableToRows: Tabelle ohne äußere Pipes (nur innere Trenner)', () => {
  const content = [
    'Ticketart | Preis',
    'Kind | 5 €',
    'Erwachsener | 9 €',
  ].join('\n');

  const rows = parseAsciiTableToRows(content);

  assert.deepStrictEqual(rows, [
    ['Ticketart', 'Preis'],
    ['Kind', '5 €'],
    ['Erwachsener', '9 €'],
  ]);
});
