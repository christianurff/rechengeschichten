/*
 * test/ai-interactive-test.js (manuelles Integrationsskript)
 * Simuliert einen ko-konstruktiven Dialog mit der echten KI und prüft, dass sie pro Runde
 * gültige [VISUALISIERUNG]-Schritte liefert, die die Engine korrekt verarbeitet.
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

async function ai(messages) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(PROXY, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: 600, temperature: 0.5 }), signal: ctrl.signal });
    const d = await r.json();
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
  } finally { clearTimeout(to); }
}

async function runDialogue(label, taskText, answers) {
  console.log(`\n--- ${label} ---\n${taskText}`);
  const system = VP.getVisualizeInteractivePrompt(AGE);
  const history = [
    { role: 'system', content: system },
    { role: 'user', content: `DIE SACHAUFGABE:\n${taskText}` },
    { role: 'assistant', content: 'Ich habe die Aufgabe verstanden.' },
    { role: 'user', content: VP.getVisualizeStartPrompt() }
  ];
  let state = QV.createState();
  let firstTurn = await ai(history);
  history.push({ role: 'assistant', content: firstTurn });
  console.log(`KI: ${firstTurn.replace(/\s+/g, ' ').slice(0, 110)}`);

  let stepsSeen = 0, stepsValid = 0;
  for (const ans of answers) {
    history.push({ role: 'user', content: ans });
    const resp = await ai(history);
    history.push({ role: 'assistant', content: resp });
    const steps = QV.parseVisualizationSteps(resp);
    const clean = QV.stripVisualizationTag(resp).replace(/\s+/g, ' ').trim();
    let info = '(kein Schritt)';
    if (steps.length) {
      const applied = [];
      for (const st of steps) {
        stepsSeen++;
        const v = QV.validateStep(st);
        if (v.ok) { stepsValid++; state = QV.reduceStep(state, st); applied.push(st.aktion + (st.anzahl !== undefined ? ' ' + st.anzahl : '')); }
        else applied.push('UNGÜLTIG(' + v.error + ')');
      }
      info = applied.join(' + ');
    }
    console.log(`Kind: "${ans}"`);
    console.log(`  KI: ${clean.slice(0, 90)}`);
    console.log(`  Schritte: ${info}  | aktiv: ${QV.activeTokens(state).length}`);
    await new Promise(r => setTimeout(r, 700));
  }
  console.log(`=> Schritte gesehen: ${stepsSeen}, gültig: ${stepsValid}, Endmenge aktiv: ${QV.activeTokens(state).length}`);
}

(async () => {
  await runDialogue('Äpfel (5 - 2)',
    'Lisa hat 5 Äpfel. Sie gibt 2 Äpfel an ihren Freund Tom. Wie viele Äpfel hat Lisa jetzt noch?',
    ['Es geht um Äpfel.', 'Lisa hat 5 Äpfel.', 'Sie gibt 2 Äpfel weg.']);

  await runDialogue('Muffins (24 ÷ 8)',
    'Für den Kindergeburtstag werden 24 Muffins gebacken. Es kommen 8 Kinder. Wie viele Muffins bekommt jedes Kind?',
    ['Um Muffins.', 'Es sind 24 Muffins.', 'Sie werden auf 8 Kinder verteilt.']);

  // Mehr-Gruppen-Addition wie im Screenshot: Ausgangsmenge muss erhalten bleiben
  await runDialogue('Karten (24 + 28 + 22)',
    'Gruppe Blau hat 24 Karten, Gruppe Rot 28, Gruppe Grün 22. Wie viele Karten sind das zusammen?',
    ['Um Karten.', 'Gruppe Blau hat 24.', 'Gruppe Rot hat 28 dazu.', 'Gruppe Grün hat 22 dazu.']);
})();
