/*
 * test/ai-guided-multi.js (manuelles Integrationsskript)
 * Prüft den begleiteten Plan-Dialog MIT Zustands-Einblendung (wie in der App):
 * - Stationen laufen konsistent zum Plan (kein Abdriften der Erzählung)
 * - KI sagt nicht "Bühne"
 * - KI markiert die passende Textstelle ([MARKIEREN:...])
 * - kein Ergebnis-Spoiler vor der letzten Station
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

const TASKS = [
  { id: 'marbles (8+6=14)', text: 'Tim hat 8 Murmeln. Er bekommt von seiner Oma 6 Murmeln dazu. Wie viele Murmeln hat Tim jetzt?', answerNum: 14 },
  { id: 'ducks (12-5+3=10)', text: 'Im Teich schwimmen 12 Entchen. 5 klettern heraus. Dann kommen 3 dazu. Wie viele schwimmen jetzt im Teich?', answerNum: 10 },
  { id: 'party (24:8 -> 3)', text: '24 Muffins werden gerecht auf 8 Kinder verteilt. Wie viele bekommt jedes Kind?', answerNum: 3 },
  { id: 'cinema (2x12+3x8=48)', text: 'Kino: 2 Erwachsene je 12 Euro und 3 Kinder je 8 Euro. Wie viel kostet es zusammen?', answerNum: 48 }
];

async function ai(messages) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: 900, temperature: 0.4 }), signal: ctrl.signal });
    const d = await r.json();
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
  } finally { clearTimeout(to); }
}
function stateAfter(plan, V) {
  let s = QV.createState(); let visible = 0;
  for (const step of plan) { s = QV.reduceStep(s, step); if (step.aktion !== 'vorbereiten' && step.aktion !== 'zuruecksetzen') { visible++; if (visible >= V) break; } }
  return s;
}

async function runTask(task) {
  const planRaw = await ai([
    { role: 'system', content: VP.getVisualizeScriptSystemPrompt(AGE) },
    { role: 'user', content: 'DIE SACHAUFGABE:\n' + task.text }
  ]);
  const plan = VP.parseVisualizationScript(planRaw).map(QV.normalizeStep);
  const total = VP.visibleStationCount(plan);
  const guided = VP.getVisualizeGuidedPrompt(AGE, VP.planToDrehbuch(plan));
  const history = [
    { role: 'system', content: guided },
    { role: 'user', content: 'DIE SACHAUFGABE:\n' + task.text + '\n\n---\n\n' + VP.getVisualizeGuidedStartPrompt() }
  ];
  const prompts = ['', 'Ich glaube, da kommen welche dazu.', 'Ja, mach weiter.', 'Okay, weiter.',
    'Ja genau.', 'Und dann?', 'Weiter bitte.', 'Ja.', 'Fertig?'];
  let station = 0, spoilers = 0, buehne = 0, marks = 0, asks = 0;
  console.log(`\n--- ${task.id} ---  Stationen: ${total}`);
  const maxTurns = total * 2 + 3;
  for (let turn = 0; turn <= maxTurns; turn++) {
    history[0] = { role: 'system', content: guided + VP.getVisualizeStandHinweis(station, total) }; // Einblendung wie App
    if (turn > 0) history.push({ role: 'user', content: prompts[Math.min(turn, prompts.length - 1)] });
    const resp = await ai(history);
    history.push({ role: 'assistant', content: resp });
    const fwd = (resp.match(/\[WEITER\]/gi) || []).length, back = (resp.match(/\[ZURUECK\]/gi) || []).length;
    if (turn > 0 && fwd === 0) asks++; // Runde, in der die KI nur fragt statt zu legen (ko-konstruktiv)
    station = Math.max(0, Math.min(total, station + fwd - back));
    const clean = resp.replace(/\[WEITER\]|\[ZURUECK\]/gi, '').trim();
    if (/Bühne/i.test(clean)) buehne++;
    if (/\[MARKIEREN/i.test(resp)) marks++;
    const noMark = clean.replace(/\[MARKIEREN:[^\]]*\]|\[\/MARKIEREN\]/gi, '');
    if (station < total && new RegExp('\\b' + task.answerNum + '\\b').test(noMark) && /insgesamt|zusammen|sind es|ergebnis/i.test(noMark)) spoilers++;
    const disp = clean.replace(/\[MARKIEREN:[^\]]*\]/gi, '«').replace(/\[\/MARKIEREN\]/gi, '»').replace(/\s+/g, ' ');
    console.log(`  ${turn === 0 ? 'START' : 'Kind '} St.${station}/${total} aktiv ${QV.activeTokens(stateAfter(plan, station)).length} | ${disp.slice(0, 95)}`);
    if (station >= total) break;
    await new Promise(r => setTimeout(r, 600));
  }
  console.log(`  => Ende:${station >= total ? 'ja' : 'NEIN'}  Spoiler:${spoilers}  "Bühne":${buehne}  Markierungen:${marks}  Frage-vor-Legen-Runden:${asks}`);
  return { ok: station >= total, spoilers, buehne, marks, asks };
}

(async () => {
  let ok = 0, sp = 0, bu = 0, noMark = 0, totalAsks = 0;
  for (const t of TASKS) {
    const r = await runTask(t);
    if (r.ok) ok++;
    sp += r.spoilers; bu += r.buehne; totalAsks += r.asks;
    if (r.marks === 0) noMark++;
  }
  console.log(`\n=== ${ok}/${TASKS.length} sauber bis Ende | Spoiler ${sp} | "Bühne" ${bu} | ohne Markierung ${noMark} | Frage-vor-Legen-Runden gesamt ${totalAsks} ===`);
})();
