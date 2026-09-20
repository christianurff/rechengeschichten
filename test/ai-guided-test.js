/*
 * test/ai-guided-test.js (manuelles Integrationsskript)
 * Prüft den begleiteten Plan-Modus: KI erzeugt einen Plan, begleitet das Kind und steuert die
 * Bühne nur per [WEITER]/[ZURUECK]. Wir prüfen, dass die Stationen konsistent zum Plan bleiben.
 */
const QV = require('../quantity-visualizer.js');
const VP = require('../visualization-prompts.js');
const PROXY = process.env.RG_PROXY_URL;
if (!PROXY) {
  console.error('Bitte RG_PROXY_URL setzen (URL eines eigenen OpenAI-kompatiblen Proxys),');
  console.error('z. B.: RG_PROXY_URL=https://mein-proxy.workers.dev node ' + process.argv[1]);
  process.exit(1);
}
const AGE = 8;

async function ai(messages, max = 700) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: max, temperature: 0.4 }), signal: ctrl.signal });
    const d = await r.json();
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
  } finally { clearTimeout(to); }
}

// Engine-Zustand nach V sichtbaren Stationen
function stateAfter(plan, V) {
  let s = QV.createState(); let visible = 0;
  for (const step of plan) {
    s = QV.reduceStep(s, step);
    if (step.aktion !== 'vorbereiten' && step.aktion !== 'zuruecksetzen') { visible++; if (visible >= V) break; }
  }
  return s;
}
function visibleCount(plan) { return plan.filter(s => s.aktion !== 'vorbereiten' && s.aktion !== 'zuruecksetzen').length; }

(async () => {
  const task = 'In einem kleinen Teich schwimmen 12 gelbe Entchen. 5 Entchen klettern aus dem Wasser auf die Wiese. Kurze Zeit später kommen 3 grüne Entchen dazu. Wie viele Entchen schwimmen jetzt im Teich?';
  console.log('Aufgabe:', task, '\n');

  // 1) Plan erzeugen
  const planRaw = await ai([
    { role: 'system', content: VP.getVisualizeScriptSystemPrompt(AGE) },
    { role: 'user', content: 'DIE SACHAUFGABE:\n' + task }
  ], 1000);
  const plan = VP.parseVisualizationScript(planRaw).map(QV.normalizeStep);
  console.log('PLAN:', plan.map(s => s.aktion + (s.anzahl !== undefined ? ' ' + s.anzahl : '')).join(' -> '));
  console.log('Drehbuch:\n' + VP.planToDrehbuch(plan) + '\n');
  const totalStations = visibleCount(plan);

  // 2) Begleiteter Dialog
  const system = VP.getVisualizeGuidedPrompt(AGE, VP.planToDrehbuch(plan));
  const history = [
    { role: 'system', content: system },
    { role: 'user', content: 'DIE SACHAUFGABE:\n' + task + '\n\n---\n\n' + VP.getVisualizeGuidedStartPrompt() }
  ];
  let station = 0;
  const answers = ['', 'Es gehen 5 weg.', 'Es kommen 3 dazu.', 'Fertig?'];
  for (let turn = 0; turn < answers.length; turn++) {
    if (turn > 0) history.push({ role: 'user', content: answers[turn] });
    const resp = await ai(history);
    history.push({ role: 'assistant', content: resp });
    const fwd = (resp.match(/\[WEITER\]/gi) || []).length;
    const back = (resp.match(/\[ZURUECK\]/gi) || []).length;
    station = Math.max(0, Math.min(totalStations, station + fwd - back));
    const st = stateAfter(plan, station);
    const clean = resp.replace(/\[WEITER\]|\[ZURUECK\]/gi, '').replace(/\s+/g, ' ').trim();
    const spoiler = /\b(insgesamt|sind es|ergebnis|10 Entchen|sind 10)\b/i.test(clean) ? '  ⚠️ evtl. Ergebnis verraten' : '';
    console.log(`${turn === 0 ? 'START' : 'Kind: "' + answers[turn] + '"'}`);
    console.log(`  KI: ${clean.slice(0, 120)}${spoiler}`);
    console.log(`  -> Station ${station}/${totalStations}, aktiv auf Bühne: ${QV.activeTokens(st).length}`);
    await new Promise(r => setTimeout(r, 700));
  }
  const final = stateAfter(plan, totalStations);
  console.log(`\nErwartetes Endergebnis 12-5+3 = 10; Plan-Endmenge: ${QV.activeTokens(final).length}`);
})();
