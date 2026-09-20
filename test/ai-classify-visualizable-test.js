/*
 * test/ai-classify-visualizable-test.js (manuelles Integrationsskript)
 * Prüft die KI-Klassifikation des "visualizable"-Flags an Grenzfällen. Das Flag ist nur die
 * ZWEITE Verteidigungslinie hinter dem deterministischen Pre-Check (quantity-visualizer.js) -
 * einzelne Fehlklassifikationen sind kein Blocker, solange der Pre-Check sie abfängt.
 *
 * Der Prompt ist eine Kopie des relevanten Ausschnitts aus api.js::classifyTask
 * (ca. Z. 1875-1937, Browser-only, daher hier für den Node-Harness dupliziert).
 * Bei Prompt-Änderungen in api.js diesen Ausschnitt nachziehen.
 *
 * Aufruf: node test/ai-classify-visualizable-test.js
 */
const PROXY = process.env.RG_PROXY_URL;
if (!PROXY) {
  console.error('Bitte RG_PROXY_URL setzen (URL eines eigenen OpenAI-kompatiblen Proxys),');
  console.error('z. B.: RG_PROXY_URL=https://mein-proxy.workers.dev node ' + process.argv[1]);
  process.exit(1);
}

// Grenzfälle mit erwartetem visualizable-Flag
const CASES = [
  { id: 'zaehlbar-einfach', text: 'Lisa hat 5 Äpfel. Sie gibt 2 an Tom. Wie viele hat sie noch?', expected: true },
  { id: 'geld', text: 'Ein Heft kostet 3 Euro, ein Stift 2 Euro. Wie viel kosten beide zusammen?', expected: false },
  { id: 'laenge', text: 'Ein Seil ist 12 Meter lang. 5 Meter werden abgeschnitten. Wie lang ist der Rest?', expected: false },
  { id: 'kommazahl', text: 'Eine Flasche enthält 1,5 Liter. Wie viel sind 2 Flaschen?', expected: false },
  { id: 'vergleich', text: 'Tim hat 8 Murmeln, Anna hat 5. Wie viele mehr hat Tim?', expected: false },
  { id: 'drei-schritte', text: 'Ali hat 20 Karten. Er verschenkt 5, kauft 8 dazu und verliert 3. Wie viele hat er?', expected: false },
  { id: 'grosse-zahl', text: 'Die Schule hat 456 Kinder. 123 fahren mit dem Bus. Wie viele nicht?', expected: false },
  { id: 'teilen-einfach', text: '24 Muffins werden gerecht auf 8 Kinder verteilt. Wie viele bekommt jedes Kind?', expected: true }
];

// Kopie des Klassifikations-Prompts aus api.js::classifyTask (Abschnitt "EIGNUNG FÜR
// PLÄTTCHEN-VISUALISIERUNG" + JSON-Antwortformat). Original in api.js pflegen.
function buildPrompt(text) {
  return `Analysiere die folgende mathematische Sachaufgabe, klassifiziere sie und erstelle eine pädagogische Lösungsreferenz.

AUFGABE:
"${text}"

KLASSIFIKATIONSTYPEN:

1. STANDARD: Alle Informationen sind gegeben, die Aufgabe hat eine eindeutige Lösung.
   Merkmale: Alle Zahlen sind bekannt, klare Fragestellung, lösbar ohne Annahmen.

2. FERMI: Die Aufgabe ist unterbestimmt und erfordert Schätzungen/Annahmen.
   Merkmale:
   - Fehlende spezifische Mengen
   - Implizite Variablen (Alltagswissen nötig)
   - Großmaßstäbliche Schätzfragen
   - Signalwörter: "etwa", "ungefähr", "schätze", "wie viele ungefähr"
   - Fragen nach Mengen, die nicht direkt gegeben sind
   Beispiele: "Wie viele Bücher stehen in einer Schulbibliothek?", "Wie viele Schritte zum Pausenhof?"

3. CAPTAIN (Kapitänsaufgabe): Die Aufgabe ist unlösbar, die Zahlen haben keinen logischen Zusammenhang zur Frage.
   Merkmale: Zahlen haben nichts mit der Frage zu tun, irreführende Informationen.
   Beispiel: "Ein Schiff hat 26 Schafe. Wie alt ist der Kapitän?"

PÄDAGOGISCHE LÖSUNGSREFERENZ:
Erstelle zusätzlich eine kompakte Lösungs-Information, die später als interne Referenz für die KI dient (NICHT für das Kind sichtbar). Pflicht:
- Bei STANDARD: konkrete Rechenart, vollständige Rechnung, finale Antwort mit Einheit, sinnvolle Zwischenschritte, häufige Fehler/Stolperstellen.
- Bei FERMI: Beispiel-Annahmen mit Einheiten, plausibler Ergebnisbereich (z.B. "zwischen X und Y"), keine einzige "richtige" Antwort.
- Bei CAPTAIN: keine Rechenwerte erfinden, sondern explizit dokumentieren, warum die Aufgabe nicht lösbar ist (welche Information fehlt / welche Zahlen passen nicht zur Frage).

WICHTIG: Rechne SELBST nach, halluziniere keine Zahlen. Wenn du dir bei einer Zahl nicht sicher bist, lieber konservativ.

EIGNUNG FÜR PLÄTTCHEN-VISUALISIERUNG ("visualizable"):
Plättchen eignen sich NUR für GRUNDAUFGABEN mit ZÄHLBAREN Objekten. Sei streng - lieber keine
Visualisierung als eine falsche/unanschauliche.
- true NUR wenn ALLES zutrifft:
  (1) konkrete ZÄHLBARE Dinge (Äpfel, Murmeln, Kinder, Karten, Tiere ...);
  (2) natürliche Zahlen im anschaulichen Bereich;
  (3) HÖCHSTENS ZWEI aufeinanderfolgende Grundrechen-Schritte;
  (4) jeder Schritt passt zu einer mit Objekten legbaren Grundvorstellung der vier Grundrechenarten:
      Plus = dazulegen, Minus = wegnehmen, Mal = gleiche Gruppen oder ein Feld,
      Geteilt = gerecht verteilen oder in gleiche Gruppen aufteilen.
- false: GELD/Geldbeträge (Euro/Cent); GRÖSSEN bzw. nicht-zählbare Größen (Längen, Gewichte,
  Volumen, Zeit, Geschwindigkeit); gemischte Einheiten; Tabellen/Diagramme; Brüche/Kommazahlen;
  sehr große/unhandliche Zahlen; MEHR ALS ZWEI Operationen; Rechnungen, die sich nicht klar mit
  Objekten legen lassen; Fermi-/Kapitänsaufgaben; sehr komplexe oder mehrdeutige Aufgaben.
  Solche Aufgaben löst das Kind besser selbst zeichnend (über "Lösungen entwickeln").

Antworte NUR mit einem JSON-Objekt:
{
  "type": "standard" oder "fermi" oder "captain",
  "confidence": 0.0-1.0,
  "visualizable": true oder false,
  "missingInfo": ["Liste fehlender Informationen falls Fermi"],
  "requiredAssumptions": ["Liste nötiger Annahmen falls Fermi"],
  "reason": "Kurze Begründung auf Deutsch",
  "solutionHint": {
    "rechenart": "z.B. Plus / Minus / Mal / Geteilt / Mehrere Schritte / Nicht lösbar / Schätzung",
    "rechnung": "z.B. 8 + 6 = 14, oder bei mehreren Schritten: '60 - 26 = 34; 34 : 2 = 17', oder bei Fermi: 'z.B. 100 m / 50 cm pro Schritt = 200 Schritte', oder bei Captain: ''",
    "antwort": "z.B. '14 Murmeln', bei Fermi: 'ungefähr 200 Schritte (je nach Annahme)', bei Captain: 'Aufgabe nicht lösbar - Zahlen passen nicht zur Frage'",
    "zwischenSchritte": ["kurze Liste sinnvoller Teilschritte / leeres Array bei Captain"],
    "typischeFehler": ["typische Kinder-Fehler bei dieser Aufgabe / leeres Array wenn keine"]
  }
}`;
}

async function ai(prompt) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 700, temperature: 0.2 }), signal: ctrl.signal });
    const d = await r.json();
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
  } finally { clearTimeout(to); }
}

// JSON-Objekt aus der Antwort herauslösen - genau wie api.js::classifyTask
function parseResult(raw) {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    return null;
  }
}

(async () => {
  console.log(`\n=== Klassifikation "visualizable": ${CASES.length} Grenzfälle (Modell Gemini 3.1 Flash-Lite via Proxy) ===\n`);
  const summary = { PASS: 0, FAIL: 0 };
  const problems = [];
  for (const c of CASES) {
    let raw = '';
    try {
      raw = await ai(buildPrompt(c.text));
    } catch (e) {
      console.log(`❌ ${c.id.padEnd(20)} KI-Fehler ${e.message}`);
      summary.FAIL++; problems.push(c.id);
      await new Promise(r => setTimeout(r, 700));
      continue;
    }
    const result = parseResult(raw);
    // Bool-Bildung wie in api.js classifyTask (visualizable !== false && type === 'standard')
    const got = result ? (result.visualizable !== false && (result.type || 'standard') === 'standard') : null;
    const pass = got === c.expected;
    summary[pass ? 'PASS' : 'FAIL']++;
    const mark = pass ? '✅' : '❌';
    const detail = result ? ' (' + (result.reason || '').slice(0, 80) + ')' : ' (Parse-Fehler: ' + raw.slice(0, 60) + ')';
    console.log(`${mark} ${c.id.padEnd(20)} erwartet ${String(c.expected).padEnd(5)} erhalten ${String(got)}${detail}`);
    if (!pass) problems.push(c.id);
    await new Promise(r => setTimeout(r, 700));
  }
  console.log(`\n=== Zusammenfassung: PASS ${summary.PASS}  FAIL ${summary.FAIL} ===`);
  if (problems.length) console.log('Auffällig: ' + [...new Set(problems)].join(', '));
})();
