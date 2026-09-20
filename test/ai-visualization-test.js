/*
 * test/ai-visualization-test.js  (manuelles Integrationsskript, KEIN Unit-Test)
 *
 * Ruft die echte KI (OpenRouter-Proxy, kein Key nötig) mit dem produktiven
 * Visualisierungs-Skript-Prompt für jede Aufgabe der Sammlung auf, prüft die erzeugte
 * Schrittfolge gegen die Engine und bewertet, ob die KI die Aufgabe passend visualisiert.
 *
 * Aufruf:
 *   node test/ai-visualization-test.js            # alle Standard-Aufgaben
 *   node test/ai-visualization-test.js all         # wirklich alle (auch fermi/captain)
 *   node test/ai-visualization-test.js example_party example_bakery   # nur diese IDs
 */
const fs = require('fs');
const path = require('path');
const QV = require('../quantity-visualizer.js');
const VP = require('../visualization-prompts.js');

const PROXY = process.env.RG_PROXY_URL;
if (!PROXY) {
  console.error('Bitte RG_PROXY_URL setzen (URL eines eigenen OpenAI-kompatiblen Proxys),');
  console.error('z. B.: RG_PROXY_URL=https://mein-proxy.workers.dev node ' + process.argv[1]);
  process.exit(1);
}
const AGE = 8;
const tasks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'example-tasks.json'), 'utf8'));

const OP_TO_ACTION = {
  addition: 'hinzufuegen',
  subtraction: 'wegnehmen',
  multiplication: 'malnehmen',
  division: 'teilen'
};

function pickTasks(argv) {
  const args = argv.slice(2);
  if (args.length === 0) return tasks.filter(t => (t.classification || {}).type === 'standard');
  if (args.length === 1 && args[0] === 'all') return tasks;
  return tasks.filter(t => args.includes(t.id));
}

async function callAI(messages, { timeoutMs = 45000 } = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: 1200, temperature: 0.3 }),
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
  } finally { clearTimeout(to); }
}

function evaluate(task, steps) {
  const issues = [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return { verdict: 'FAIL', issues: ['leere/ungültige Schrittfolge'], finalActive: 0, actions: [] };
  }
  if (steps[0].aktion !== 'vorbereiten') issues.push('erster Schritt ist nicht "vorbereiten"');

  // Engine durchlaufen
  let state = QV.createState();
  for (let i = 0; i < steps.length; i++) {
    const v = QV.validateStep(steps[i]);
    if (!v.ok) issues.push(`Schritt ${i} ungültig: ${v.error}`);
    try { state = QV.reduceStep(state, steps[i]); }
    catch (e) { issues.push(`Schritt ${i} wirft: ${e.message}`); }
  }
  const finalActive = QV.activeTokens(state).length;
  const actions = steps.map(s => s.aktion);

  // Operationen-Abdeckung. "anhaengen" auf malnehmen UND "teilen" repräsentieren ebenfalls
  // eine Addition bzw. (bei aufteilen) das Zusammenfassen — als abgedeckt werten.
  const hasAnhaengen = steps.some(s => s.aktion === 'malnehmen' && s.anhaengen);
  const expectedOps = (task.classification || {}).operations || [];
  const missing = expectedOps.map(o => OP_TO_ACTION[o]).filter(Boolean).filter(a => {
    if (actions.includes(a)) return false;
    if (a === 'hinzufuegen' && hasAnhaengen) return false; // anhaengen = Addition der Produkte
    return true;
  });
  if (missing.length) issues.push('fehlende Operation(en): ' + missing.join(', '));

  if (finalActive === 0 && steps.some(s => s.aktion === 'hinzufuegen' || s.aktion === 'malnehmen')) {
    issues.push('Endmenge ist 0 (vermutlich unpassend)');
  }

  let verdict = 'PASS';
  if (issues.some(i => i.includes('ungültig') || i.includes('wirft') || i.includes('leere'))) verdict = 'FAIL';
  else if (issues.length) verdict = 'WARN';
  return { verdict, issues, finalActive, actions };
}

function compactSteps(steps) {
  return steps.map(s => {
    if (s.aktion === 'vorbereiten') return `vorbereiten(${(s.objekte || []).map(o => o.name + (o.einheit > 1 ? '×' + o.einheit : '')).join(',')})`;
    if (s.aktion === 'hinzufuegen') return `+${s.anzahl}${s.jeGruppe ? '/Gr' : ''}`;
    if (s.aktion === 'wegnehmen') return `-${s.anzahl}${s.jeGruppe ? '/Gr' : ''}`;
    if (s.aktion === 'malnehmen') return `×(${s.gruppen}·${s.proGruppe},${s.grundvorstellung}${s.anhaengen ? ',+' : ''})`;
    if (s.aktion === 'teilen') return `÷(${s.grundvorstellung},${s.anzahlGruppen || s.proGruppe})`;
    if (s.aktion === 'buendeln') return `bündeln(${s.buendelgroesse})`;
    return s.aktion;
  }).join(' ');
}

(async () => {
  const selected = pickTasks(process.argv);
  console.log(`\n=== KI-Visualisierungstest: ${selected.length} Aufgaben (Modell: Gemini 3.1 Flash-Lite via Proxy, Alter ${AGE}) ===\n`);
  const summary = { PASS: 0, WARN: 0, FAIL: 0 };
  const failures = [];

  for (const task of selected) {
    const messages = [
      { role: 'system', content: VP.getVisualizeScriptSystemPrompt(AGE) },
      { role: 'user', content: `DIE SACHAUFGABE:\n${task.text}` }
    ];
    let steps = [], raw = '';
    try {
      raw = await callAI(messages);
      steps = VP.parseVisualizationScript(raw).map(QV.normalizeStep);
    } catch (e) {
      console.log(`${task.id}\n  AUFGABE: ${task.text}\n  ❌ KI-Fehler: ${e.message}\n`);
      summary.FAIL++; failures.push(task.id); continue;
    }
    const res = evaluate(task, steps);
    summary[res.verdict]++;
    if (res.verdict !== 'PASS') failures.push(task.id);
    const mark = res.verdict === 'PASS' ? '✅' : res.verdict === 'WARN' ? '⚠️ ' : '❌';
    console.log(`${mark} ${task.id}  [${(task.classification || {}).operations || []}]`);
    console.log(`   Aufgabe: ${task.text}`);
    console.log(`   Schritte: ${compactSteps(steps)}`);
    console.log(`   Endmenge aktiv: ${res.finalActive}`);
    if (res.issues.length) console.log(`   Hinweise: ${res.issues.join(' | ')}`);
    if (!steps.length) console.log(`   ROH: ${raw.slice(0, 200)}`);
    console.log('');
    await new Promise(r => setTimeout(r, 800)); // sanft zum Proxy
  }

  console.log('=== Zusammenfassung ===');
  console.log(`PASS ${summary.PASS}  WARN ${summary.WARN}  FAIL ${summary.FAIL}`);
  if (failures.length) console.log('Auffällig: ' + failures.join(', '));
})();
