/*
 * test/ai-plan-quality-test.js (manuelles Integrationsskript)
 * Prüft die QUALITÄT der von der KI erzeugten Gesamtpläne über viele Kontexte:
 * - Plan startet mit der Ausgangsmenge (vorbereiten -> hinzufuegen/malnehmen)
 * - alle Schritte gültig, Engine läuft fehlerfrei
 * - Arithmetik stimmt (Endmenge / Gruppengröße gegen Lösungsschlüssel)
 *
 * Aufruf: node test/ai-plan-quality-test.js [runs]   (runs = Wiederholungen je Aufgabe, Default 1)
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
const RUNS = parseInt(process.argv[2] || '1', 10);

// Kuratierte Aufgaben mit Lösungsschlüssel (active = Token am Ende; perGroup = Anzahl je Gruppe)
const TASKS = [
  { id: 'apples (5-2)', text: 'Lisa hat 5 Äpfel. Sie gibt 2 Äpfel an Tom. Wie viele Äpfel hat Lisa noch?', expected: { active: 3 } },
  { id: 'marbles (8+6)', text: 'Tim hat 8 Murmeln. Er bekommt 6 Murmeln dazu. Wie viele hat er jetzt?', expected: { active: 14 } },
  { id: 'stickers (12+9)', text: 'Anna hat 12 Sticker. Sie bekommt 9 Sticker dazu. Wie viele hat sie jetzt?', expected: { active: 21 } },
  { id: 'ducks (12-5+3)', text: 'Im Teich schwimmen 12 Entchen. 5 klettern heraus. Dann kommen 3 dazu. Wie viele schwimmen jetzt im Teich?', expected: { active: 10 } },
  { id: 'kerzen (8-3-4)', text: 'Auf dem Kuchen brennen 8 Kerzen. Lisa pustet 3 aus, dann nochmal 4. Wie viele brennen noch?', expected: { active: 1 } },
  { id: 'books (56-28+15)', text: 'Im Regal stehen 56 Bücher. 28 werden ausgeliehen. Dann kommen 15 neue dazu. Wie viele sind jetzt da?', expected: { active: 43 } },
  { id: 'party (24:8)', text: '24 Muffins werden gerecht auf 8 Kinder verteilt. Wie viele bekommt jedes Kind?', expected: { active: 24, perGroup: 3 } },
  { id: 'schoko (24:4)', text: 'Eine Tafel Schokolade hat 24 Stücke. 4 Kinder teilen sie gerecht. Wie viele bekommt jedes?', expected: { active: 24, perGroup: 6 } },
  { id: 'soccer (96:8)', text: '96 Spieler verteilen sich gerecht auf 8 Mannschaften. Wie viele je Mannschaft?', expected: { active: 96, perGroup: 12 } },
  { id: 'garden (5x7)', text: 'Im Garten stehen 5 Reihen mit je 7 Blumen. Wie viele Blumen sind das?', expected: { active: 35 } },
  { id: 'autos (6x8)', text: 'Auf dem Parkplatz stehen 6 Reihen mit je 8 Autos. Wie viele Autos sind das?', expected: { active: 48 } },
  { id: 'bonbons (3x5-4)', text: 'Lena hat 3 Tüten mit je 5 Bonbons. Sie isst 4 Bonbons. Wie viele bleiben?', expected: { active: 11 } },
  { id: 'muscheln (4x5-12)', text: 'Leon sammelt 4 Tage lang je 5 Muscheln. Dann verschenkt er 12 Muscheln. Wie viele bleiben?', expected: { active: 8 } },
  { id: 'baelle (2x12+3x8)', text: 'In der Turnhalle stehen 2 Kisten mit je 12 Bällen und 3 Kisten mit je 8 Bällen. Wie viele Bälle sind das zusammen?', expected: { active: 48 } },
  { id: 'suessigk (36:3,-4ea)', text: '36 Gummibärchen werden gerecht auf 3 Kinder verteilt. Dann isst jedes Kind 4. Wie viele hat jedes noch?', expected: { active: 24, perGroup: 8 } }
];

async function ai(messages) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: 1100, temperature: 0.3 }), signal: ctrl.signal });
    const d = await r.json();
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
  } finally { clearTimeout(to); }
}

function evaluate(task, plan) {
  const issues = [];
  if (!plan.length) return { verdict: 'FAIL', issues: ['leerer Plan'], active: 0, plan };
  const firstVisible = plan.find(s => s.aktion !== 'vorbereiten');
  if (!firstVisible || !['hinzufuegen', 'malnehmen'].includes(firstVisible.aktion)) {
    issues.push('startet nicht mit Ausgangsmenge');
  }
  let state = QV.createState();
  for (let i = 0; i < plan.length; i++) {
    const v = QV.validateStep(plan[i]);
    if (!v.ok) issues.push('Schritt ' + i + ' ungültig: ' + v.error);
    try { state = QV.reduceStep(state, plan[i]); } catch (e) { issues.push('Schritt ' + i + ' wirft'); }
  }
  const active = QV.activeTokens(state).length;
  const exp = task.expected || {};
  if (exp.active !== undefined && active !== exp.active) issues.push(`Endmenge ${active}, erwartet ${exp.active}`);
  if (exp.perGroup !== undefined) {
    const groups = {};
    QV.activeTokens(state).forEach(t => { groups[t.group] = (groups[t.group] || 0) + 1; });
    const sizes = Object.values(groups);
    if (!(sizes.length && sizes.every(s => s === exp.perGroup))) {
      issues.push(`Gruppengröße [${sizes.join(',')}], erwartet je ${exp.perGroup}`);
    }
  }
  let verdict = 'PASS';
  if (issues.some(i => /ungültig|wirft|leerer/.test(i))) verdict = 'FAIL';
  else if (issues.length) verdict = 'WARN';
  return { verdict, issues, active, plan };
}

function planStr(plan) {
  return plan.map(s => s.aktion === 'vorbereiten' ? 'vorb' :
    s.aktion === 'hinzufuegen' ? '+' + s.anzahl + (s.jeGruppe ? '/Gr' : '') :
    s.aktion === 'wegnehmen' ? '-' + s.anzahl + (s.jeGruppe ? '/Gr' : '') :
    s.aktion === 'malnehmen' ? '×(' + s.gruppen + '·' + s.proGruppe + (s.anhaengen ? ',+' : '') + ')' :
    s.aktion === 'teilen' ? '÷(' + s.grundvorstellung + ',' + (s.anzahlGruppen || s.proGruppe) + ')' :
    s.aktion).join(' ');
}

(async () => {
  console.log(`\n=== Plan-Qualität: ${TASKS.length} Aufgaben × ${RUNS} Lauf/Läufe (Modell Gemini 3.1 Flash-Lite via Proxy) ===\n`);
  const summary = { PASS: 0, WARN: 0, FAIL: 0 };
  const problems = [];
  for (const task of TASKS) {
    for (let run = 0; run < RUNS; run++) {
      let plan = [];
      try {
        const raw = await ai([
          { role: 'system', content: VP.getVisualizeScriptSystemPrompt(AGE) },
          { role: 'user', content: 'DIE SACHAUFGABE:\n' + task.text }
        ]);
        plan = VP.parseVisualizationScript(raw).map(QV.normalizeStep);
      } catch (e) { console.log(`❌ ${task.id}: KI-Fehler ${e.message}`); summary.FAIL++; problems.push(task.id); continue; }
      const res = evaluate(task, plan);
      summary[res.verdict]++;
      const mark = res.verdict === 'PASS' ? '✅' : res.verdict === 'WARN' ? '⚠️ ' : '❌';
      console.log(`${mark} ${task.id.padEnd(20)} ${planStr(plan)}`);
      if (res.issues.length) { console.log('     ' + res.issues.join(' | ')); problems.push(task.id); }
      await new Promise(r => setTimeout(r, 700));
    }
  }
  console.log(`\n=== Zusammenfassung: PASS ${summary.PASS}  WARN ${summary.WARN}  FAIL ${summary.FAIL} ===`);
  if (problems.length) console.log('Auffällig: ' + [...new Set(problems)].join(', '));
})();
