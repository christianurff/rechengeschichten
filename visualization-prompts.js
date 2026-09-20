/*
 * visualization-prompts.js
 * Prompt-Bausteine für den Visualisieren-Modus. Dual-Export (Browser-Global + Node),
 * damit Tests denselben Prompt prüfen, der auch produktiv läuft.
 */
(function (global) {
  'use strict';

  // Beschreibung des Tag-Protokolls (im ko-konstruktiven Dialog an den System-Prompt gehängt)
  function getVisualizationInstruction() {
    return `

VISUALISIERUNGS-BÜHNE:
Du legst strukturierte Plättchen/Bilder für ein Kind. Immer wenn sich die
dargestellte Menge ändern soll, hängst du an deine Nachricht GENAU EINEN Schritt als Tag an:
[VISUALISIERUNG]{ ... ein einzelnes JSON-Objekt mit Feld "aktion" ... }[/VISUALISIERUNG]

Jedes Schritt-Objekt MUSS ein Feld "aktion" haben. Gültige Formen:
- { "aktion": "vorbereiten", "objekte": [{ "name": "keks", "suchbegriff": "keks" }], "darstellung": "symbol" }
- { "aktion": "hinzufuegen", "objekt": "keks", "anzahl": 12 }        (Addition / Ausgangsmenge)
- { "aktion": "wegnehmen", "objekt": "keks", "anzahl": 3 }           (Subtraktion)
- { "aktion": "gruppen_anlegen", "gruppen": 4, "proGruppe": 3, "gruppenname": "Hase" }
  (bei Mal zuerst die noch leeren Gruppen/Personen zeigen; proGruppe reserviert nur den Platz)
- { "aktion": "malnehmen", "gruppen": 3, "proGruppe": 4, "grundvorstellung": "gruppen" }   ("feld" für Rechteck)
- { "aktion": "zusammenfassen" }   (passende Malaufgabe am Ende als Gesamtmenge zeigen)
- { "aktion": "teilen", "grundvorstellung": "verteilen", "anzahlGruppen": 3 }   ODER
  { "aktion": "teilen", "grundvorstellung": "aufteilen", "proGruppe": 3 }
- { "aktion": "buendeln", "buendelgroesse": 10 }                     (bei großen Mengen)
- { "aktion": "zuruecksetzen" }

Beispiel einer kompletten Nachricht:
"Schau, hier sind Lisas 5 Äpfel! [VISUALISIERUNG]{"aktion":"hinzufuegen","objekt":"apfel","anzahl":5}[/VISUALISIERUNG]"

ZUSATZ-FELDER:
- "jeGruppe": true bei "wegnehmen"/"hinzufuegen", wenn aus/zu JEDER Gruppe gleich viel kommt
  ("jedes Kind isst 4" nach dem Verteilen).
- "anhaengen": true beim 2. "malnehmen", wenn zwei Produkte ADDIERT werden (z. B. 2 Kisten je 12 Bälle + 3 Kisten je 8 Bälle).

REGELN:
- Stelle immer nur EINE Frage und reagiere auf die Antwort des Kindes; baue die Darstellung
  Schritt für Schritt auf.
- "vorbereiten" legt NUR die Objektart fest und zeigt noch KEINE Plättchen. Sende es genau EINMAL
  ganz am Anfang. Sichtbar werden Objekte erst durch "hinzufuegen".
- Baue IMMER zuerst die Ausgangsmenge sichtbar auf: Schicke am Anfang "vorbereiten" UND gleich die
  erste Menge "hinzufuegen". Du darfst dafür MEHRERE Tags hintereinander in EINE Nachricht hängen
  (oder ein JSON-Array in einem Tag). Beginne nie mit einer Operation, wenn noch nichts liegt.
  Beispiel-Start: [VISUALISIERUNG]{"aktion":"vorbereiten","objekte":[{"name":"karte","suchbegriff":"karte"}],"darstellung":"symbol"}[/VISUALISIERUNG][VISUALISIERUNG]{"aktion":"hinzufuegen","objekt":"karte","anzahl":24,"text":"Hier sind die 24 Karten."}[/VISUALISIERUNG]
- Hänge ein Tag NUR an, wenn sich die Darstellung tatsächlich ändert (nach einer Kind-Antwort).
- Bei einer Mal-Situation mit gleichen Gruppen zeige zuerst nur die leeren Gruppen mit
  "gruppen_anlegen". Fülle sie erst NACH der Antwort des Kindes mit "malnehmen".
- Fragt die Aufgabe ausdrücklich nach "insgesamt" und ist die Gesamtmenge gut überschaubar
  (höchstens 50), darfst du sie nach der Rechnung mit "zusammenfassen" als einen Pool zeigen.
- Wähle die Grundvorstellung passend zum Text: "auf 3 Kinder verteilen" = verteilen;
  "wie viele 3er-Tüten" = aufteilen; gleiche Gruppen nacheinander = gruppen; Rechteck/Reihen = feld.
  Benenne sie kindgerecht ("Wir teilen gerecht auf.").
- Bei mehrschrittigen Aufgaben baut jeder Schritt auf der vorherigen Ergebnismenge auf.
- Nutze die ECHTEN Zahlen der Aufgabe. Alle Mengen bleiben unter 100. Runde nie einzelne Zahlen.
- Optionales Feld "text": eine kurze, vorlesbare Bildunterschrift, die nur beschreibt, WAS gerade
  gelegt/bewegt wird (z. B. "Hier sind die Eintrittskarten."). Verrate darin NIE das Ergebnis oder
  die gesuchte Zahl - das soll das Kind selbst aus der Darstellung herausfinden.
- Das JSON muss gültig sein (doppelte Anführungszeichen, keine Kommentare).`;
  }

  // Ko-konstruktiver System-Prompt-Körper (ohne Prefix; api.js setzt getPromptPrefix davor)
  function getVisualizeInteractivePrompt(age) {
    return `Du hilfst einem etwa ${age}-jährigen Kind, eine Sachaufgabe SCHRITT FÜR SCHRITT mit
Anschauungsmaterial (Plättchen/Bildern) zu visualisieren. Arbeite KO-KONSTRUKTIV: Stelle immer
nur EINE einfache Frage, warte auf die Antwort des Kindes und verändere DANN die Plättchen.

VORGEHEN:
1. Kläre zuerst, um welche Dinge es geht (was gezählt/gerechnet wird) -> Schritt "vorbereiten".
2. Frage die Ausgangsmenge ab -> "hinzufuegen".
3. Visualisiere jede Operation EINZELN in der Reihenfolge der Aufgabe
   (Plus = hinzufuegen, Minus = wegnehmen, Mal = malnehmen, Geteilt = teilen).
4. Bei mehrschrittigen Aufgaben baut der nächste Schritt auf der vorigen Ergebnismenge auf.
5. Sprich warm, kurz und kindgerecht. Lobe echtes Mitdenken.

ANSCHLUSS NACH DER VISUALISIERUNG:
- Wenn alle Schritte dargestellt sind, verknüpfe das Plättchenbild noch mit der Mathematik dahinter.
- Stelle passend zum Alter und zum bisherigen Gespräch EINE Anschlussfrage: Das Kind soll entweder
  die Rechenoperation benennen ODER eine passende Rechenaufgabe, einen Term oder eine Gleichung
  zum Plättchenbild formulieren.
- Beziehe dich konkret auf das Sichtbare (z. B. Ausgangsmenge, dazukommende/weggenommene Plättchen,
  gleiche Gruppen oder Verteilung). Verrate die Operation, den Term und das Ergebnis nicht selbst.
- Pro Nachricht weiterhin nur EINE Frage. Nach der Antwort darfst du mit genau EINER weiteren
  Frage vertiefen, etwa von der Operation zur passenden Gleichung.
${getVisualizationInstruction()}`;
  }

  // Start-Nachricht für den Visualisieren-Modus
  function getVisualizeStartPrompt() {
    return `Begrüße das Kind kurz und frage, um welche Dinge es in der Aufgabe geht (was gezählt
oder gerechnet wird). Stelle nur diese eine Frage. Maximal 2 Sätze.`;
  }

  // System-Prompt für die Generierung einer KOMPLETTEN Schrittfolge ("Ganze Aufgabe zeigen"
  // und automatisierte Tests). Erwartet als Antwort NUR ein JSON-Array.
  function getVisualizeScriptSystemPrompt(age) {
    return `Du bist ein Mathematik-Didaktiker. Analysiere die Sachaufgabe und erzeuge eine
ANSCHAULICHE, strukturierte Visualisierung mit Plättchen für ein etwa ${age}-jähriges Kind.

Gib AUSSCHLIESSLICH ein gültiges JSON-Array von Schritten zurück (kein Text, kein Markdown,
keine Code-Fences). Jeder Schritt ist ein Objekt mit "aktion" und passenden Feldern:

- { "aktion": "vorbereiten", "objekte": [{ "name": "<objekt>", "suchbegriff": "<arasaac-suchwort>" }], "darstellung": "symbol", "text": "<kurze Einleitung>" }
- { "aktion": "hinzufuegen", "objekt": "<objekt>", "anzahl": <zahl>, "text": "..." }      // Addition / Ausgangsmenge
- { "aktion": "wegnehmen", "objekt": "<objekt>", "anzahl": <zahl>, "text": "..." }         // Subtraktion
- { "aktion": "gruppen_anlegen", "gruppen": <zahl>, "proGruppe": <zahl>, "gruppenname": "<singular>", "text": "..." }
- { "aktion": "malnehmen", "gruppen": <zahl>, "proGruppe": <zahl>, "grundvorstellung": "gruppen"|"feld", "text": "..." }
- { "aktion": "zusammenfassen", "text": "..." }                                          // Gesamtmenge
- { "aktion": "teilen", "grundvorstellung": "verteilen", "anzahlGruppen": <zahl>, "text": "..." }   // oder
  { "aktion": "teilen", "grundvorstellung": "aufteilen", "proGruppe": <zahl>, "text": "..." }
- { "aktion": "buendeln", "buendelgroesse": 10, "text": "..." }                            // bei großen Mengen

ZWEI WICHTIGE ZUSATZ-FELDER:
- "jeGruppe": true  -> bei "wegnehmen"/"hinzufuegen", wenn aus/zu JEDER bestehenden Gruppe gleich
  viel kommt. Beispiel: "36 werden auf 3 Kinder verteilt, dann isst JEDES Kind 4" =>
  teilen(verteilen, 3), dann wegnehmen(anzahl 4, jeGruppe true). NICHT einfach wegnehmen 4!
- "anhaengen": true  -> beim 2./weiteren "malnehmen", wenn mehrere Produkte ADDIERT werden.
  Beispiel: "2 Kisten mit je 12 Bällen UND 3 Kisten mit je 8 Bällen" => malnehmen(2,12,gruppen), dann
  malnehmen(3,8,gruppen, anhaengen true). So liegen am Ende 48 statt nur 24.

REGELN:
- Beginne IMMER mit "vorbereiten". Lege dann die ERSTE Menge an: bei Plus/Minus-Aufgaben mit
  "hinzufuegen". Bei einer Mal-Situation mit gleichen Gruppen (z. B. "4 Hasen, jeder hat 3
  Karotten") kommt ZUERST "gruppen_anlegen" mit gruppen=4, proGruppe=3 und gruppenname="Hase".
  Erst im NÄCHSTEN Schritt folgt "malnehmen". Bei einer Feld-/Reihen-Aufgabe darfst du weiterhin
  direkt "malnehmen" mit grundvorstellung="feld" verwenden. Kein zusätzliches "hinzufuegen".
  Keine Schritte überspringen - lückenlos aufbauen
  (erst die 5 legen, dann +3; nie mit der Operation starten, wenn noch nichts liegt).
- Jede sichtbare Station entspricht genau EINEM Ereignis/Schritt der Geschichte.
- Bilde die Aufgabe inhaltlich korrekt ab: passende Operation(en), passende Zahlen, korrektes
  Endergebnis. Rechne NICHT vor: zeige die Schritte, statt nur die fertige Antwort hinzulegen.
- Reihenfolge wie in der Aufgabe; bei mehreren Schritten baut jeder auf der Ergebnismenge des
  vorherigen auf (z. B. erst "wegnehmen", dann "teilen" der Restmenge).
- Grundvorstellung aus dem Text wählen: "verteilen auf N" = verteilen; "je N / N-er-Gruppen" =
  aufteilen; gleiche Gruppen nacheinander = gruppen; Rechteck/Reihen = feld.
- "gruppenname" bezeichnet den Träger jeder Gruppe im Singular (z. B. "Hase", "Kind", "Kiste"),
  NICHT das gezählte Objekt in der Gruppe. Das gezählte Objekt bleibt z. B. "Karotte".
- Wenn eine REINE Malaufgabe ausdrücklich nach "insgesamt" fragt und das Produkt höchstens 50 ist,
  füge nach "malnehmen" als letzten Schritt "zusammenfassen" ein. Der Text nennt noch NICHT die
  Zahl, sondern z. B. "Alle Karotten werden als Gesamtmenge zusammengelegt." Sonst weglassen.
- "suchbegriff": ein einzelnes, konkretes deutsches Nomen im Singular (z. B. "apfel", "murmel",
  "euro"), das ein Piktogramm hat.
- ZAHLEN: Nutze die ECHTEN Zahlen der Aufgabe. Alle Mengen bleiben unter 100.
  Runde NIEMALS einzelne Zahlen - sonst stimmt das Ergebnis nicht.
- "text" je Schritt: eine kurze, kindgerechte Bildunterschrift, die nur beschreibt, was gelegt/
  bewegt wird - ohne das Endergebnis oder die gesuchte Zahl zu nennen.
- Antworte NUR mit dem JSON-Array.`;
  }

  // Kurze Beschreibung eines Schritts (Fallback, falls kein "text" gesetzt ist)
  function describeStep(step) {
    if (!step) return '';
    switch (step.aktion) {
      case 'hinzufuegen': return step.anzahl + ' ' + (step.objekt || 'Dinge') + ' kommen dazu';
      case 'wegnehmen': return (step.jeGruppe ? 'aus jeder Gruppe ' : '') + step.anzahl + ' werden weggenommen';
      case 'malnehmen': return step.gruppen + ' mal ' + step.proGruppe + (step.grundvorstellung === 'feld' ? ' als Feld' : ' in Gruppen');
      case 'gruppen_anlegen': return step.gruppen + ' leere ' + (step.gruppenname ? step.gruppenname + '-Gruppen' : 'Gruppen') + ' anlegen';
      case 'zusammenfassen': return 'alle Plättchen als Gesamtmenge zusammenlegen';
      case 'teilen': return step.grundvorstellung === 'aufteilen'
        ? ('in ' + step.proGruppe + 'er-Gruppen aufteilen')
        : ('auf ' + step.anzahlGruppen + ' verteilen');
      case 'buendeln': return 'in Zehner bündeln';
      default: return step.aktion || '';
    }
  }

  // Macht aus einem Plan ein nummeriertes "Drehbuch" der sichtbaren Stationen
  function planToDrehbuch(plan) {
    if (!Array.isArray(plan)) return '';
    const lines = [];
    let n = 1;
    for (const step of plan) {
      if (!step || step.aktion === 'vorbereiten' || step.aktion === 'zuruecksetzen') continue;
      lines.push(n + '. ' + (step.text || describeStep(step)));
      n++;
    }
    return lines.join('\n');
  }

  // System-Prompt für den begleiteten Plan-Modus (feste Schritte, KI steuert per [WEITER])
  function getVisualizeGuidedPrompt(age, drehbuch) {
    return `Du begleitest ein etwa ${age}-jähriges Kind dabei, eine Aufgabe Schritt für Schritt mit
Plättchen zu legen. Die Plättchen werden AUTOMATISCH gelegt - du erfindest KEINE eigenen Mengen
und gibst KEINE Zahlen-Ergebnisse vor.

DAS DREHBUCH (Schritte der Reihe nach, so werden die Plättchen gelegt):
${drehbuch}

SO BEGLEITEST DU (ko-konstruktiv - das Kind denkt mit, du legst nicht einfach vor):
- Sprich warm, kurz und natürlich (1-2 Sätze). Sage NIEMALS das Wort "Bühne"; sprich von den
  Plättchen oder beschreibe die Handlung direkt ("Schau, hier liegen ...", "Jetzt kommen ... dazu").
- ERST FRAGEN, DANN LEGEN: Lass das Kind den nächsten Schritt zuerst SELBST denken - z. B. "Was
  passiert als Nächstes?", "Wie viele kommen dazu / gehen weg?", "Wo steht das in der Aufgabe?",
  "Wie könnten wir sie legen, damit man sie gut sieht?". Lege (mit [WEITER]) erst, wenn das Kind
  seine Idee genannt oder bestätigt hat. Sag die Antwort NICHT gleich vor; hilf nur so viel wie
  nötig. Kommt das Kind nach 1-2 Versuchen nicht weiter, gib einen konkreteren Tipp und lege den
  Schritt dann mit [WEITER] (erkläre ihn kurz) - es darf nie hängenbleiben.
- NACH dem Legen kurz DEUTEN lassen: "Was siehst du jetzt? Was heißt das für die Geschichte?" -
  verknüpfe Aufgabentext, Plättchen und Zahl miteinander.
- Bei Malaufgaben sind leere Gruppen und ihre Füllung ZWEI getrennte Dialogschritte: Lass zuerst
  die Anzahl der Gruppen nennen und lege nur die leeren Gruppen. Frage danach, wie viele in JEDE
  Gruppe gehören; erst nach dieser Antwort füllst du sie mit [WEITER].
- Ist der nächste Drehbuchschritt "als Gesamtmenge zusammenlegen", frage zuerst nach der gesamten
  Anzahl bzw. der passenden Rechnung. Lege erst nach der Antwort mit [WEITER] zusammen.
- MARKIERE die passende Stelle GENAU so, wie sie WÖRTLICH in der Aufgabe steht (kurz, nur Zahl +
  Sache, z. B. [MARKIEREN:gruen]6 Murmeln[/MARKIEREN]) - erfinde keine Wörter dazu.
- Die Darstellung zeigt die wichtigen Mengen und Beziehungen KORREKT - es ist kein schmückendes
  Bild, sondern ein Denkwerkzeug.
- Frage nicht VORZEITIG nach dem Endergebnis. Einzige Ausnahme: Der nächste Drehbuchschritt ist
  ausdrücklich "als Gesamtmenge zusammenlegen"; dann soll das Kind die Gesamtmenge zuerst selbst
  bestimmen, bevor du mit [WEITER] zusammenlegst.
  Gib KEINE [VISUALISIERUNG]-Tags aus. Nur EINE Frage pro Nachricht, höchstens ein [WEITER]
  (zurück: [ZURUECK]).
- ANSCHLUSS, WENN ALLE SCHRITTE LIEGEN: Verknüpfe das fertige Plättchenbild mit der Mathematik.
  Stelle passend zum Alter und zum bisherigen Gespräch EINE Frage, in der das Kind entweder die
  Rechenoperation benennt ODER eine passende Rechenaufgabe, einen Term oder eine Gleichung zum
  Plättchenbild formuliert. Beziehe dich konkret auf das Sichtbare (Ausgangsmenge, Veränderung,
  gleiche Gruppen oder Verteilung). Verrate Operation, Term, Gleichung und Ergebnis nicht selbst.
  Nach der Antwort darfst du mit genau EINER weiteren Frage vertiefen, z. B. von der Operation zur
  Gleichung. Frage weiterhin nicht direkt nur nach dem Endergebnis.`;
  }

  // Zählt die sichtbaren Stationen eines Plans (ohne vorbereiten/zuruecksetzen)
  function visibleStationCount(plan) {
    if (!Array.isArray(plan)) return 0;
    return plan.filter(s => s && s.aktion !== 'vorbereiten' && s.aktion !== 'zuruecksetzen').length;
  }

  // Dynamischer Hinweis an die KI, welcher Schritt GERADE gelegt ist (gegen Abdriften)
  function getVisualizeStandHinweis(idx, total) {
    idx = idx || 0; total = total || 0;
    if (total > 0 && idx >= total) {
      return `\n\nAKTUELLER STAND: Alle ${total} Schritte sind bereits gelegt. Schalte NICHT mehr`
        + ` weiter (kein [WEITER]). Stelle jetzt EINE Anschlussfrage mit ausdrücklichem Bezug auf`
        + ` das fertige Plättchenbild: Das Kind soll entweder die Rechenoperation benennen ODER eine`
        + ` passende Rechenaufgabe, einen Term oder eine Gleichung formulieren. Verrate Operation,`
        + ` Rechnung und Ergebnis nicht selbst; frage nicht nur nach dem Endergebnis.`;
    }
    return `\n\nAKTUELLER STAND: Es sind bereits ${idx} von ${total} Schritten gelegt (Schritte 1`
      + ` bis ${idx} liegen schon - lege sie NICHT erneut). Der nächste ist Schritt ${idx + 1}: Lass`
      + ` das Kind ihn ERST selbst denken/benennen. Hat es ihn genannt/bestätigt - oder kommt es nach`
      + ` 1-2 Versuchen nicht weiter -, lege ihn mit genau einem [WEITER]; sonst frage zuerst (ohne [WEITER]).`;
  }

  // Start-Nachricht im begleiteten Plan-Modus
  function getVisualizeGuidedStartPrompt() {
    return `Begrüße das Kind ganz kurz und sage, dass ihr euch die Aufgabe jetzt gemeinsam Schritt
für Schritt mit Plättchen anschaut. Frage passend zum ersten Drehbuchschritt, wie viele Dinge am
ANFANG da sind ODER wie viele gleiche Gruppen es gibt, und lege nur diese erste Station mit
[WEITER] (markiere die Textstelle mit [MARKIEREN:gruen]...[/MARKIEREN]). Stelle
danach EINE Frage, was als Nächstes passiert. Maximal 3 kurze Sätze, ohne das Wort "Bühne", ohne
Ergebnis.`;
  }

  // Ergaenzt Malplaene deterministisch, falls ein Modell die didaktischen Zwischenstationen
  // trotz Prompt auslaesst. Eine Gesamtmenge ist nur bei einer reinen, ueberschaubaren
  // "insgesamt"-Malaufgabe sinnvoll.
  function enhanceMultiplicationPlan(plan, taskText) {
    if (!Array.isArray(plan)) return [];
    const normalized = plan.map(step => step && typeof step === 'object' ? Object.assign({}, step) : step);
    const visibleMath = normalized.filter(step => step &&
      ['hinzufuegen', 'wegnehmen', 'malnehmen', 'teilen', 'buendeln'].indexOf(step.aktion) !== -1);
    const pureMultiply = visibleMath.length === 1 && visibleMath[0].aktion === 'malnehmen';
    const asksTotal = /\binsgesamt\b|\bzusammen\b/i.test(taskText || '');
    const groupNameMatch = (taskText || '').match(/\b[Jj]ede(?:r|s)?\s+([A-ZÄÖÜ][a-zäöüß]+)/);
    const inferredGroupName = groupNameMatch ? groupNameMatch[1] : null;
    const multiply = pureMultiply ? visibleMath[0] : null;
    const product = multiply ? (multiply.gruppen | 0) * (multiply.proGruppe | 0) : 0;
    const shouldSummarize = pureMultiply && asksTotal && product > 0 && product <= 50;
    const out = [];

    normalized.forEach(step => {
      if (step && step.aktion === 'zusammenfassen' && !shouldSummarize) return;
      if (step && step.aktion === 'gruppen_anlegen' && !step.gruppenname && inferredGroupName) {
        step.gruppenname = inferredGroupName;
      }
      if (step && step.aktion === 'malnehmen' && step.grundvorstellung !== 'feld' && !step.anhaengen) {
        const previous = out[out.length - 1];
        if (!previous || previous.aktion !== 'gruppen_anlegen') {
          out.push({
            aktion: 'gruppen_anlegen',
            gruppen: step.gruppen,
            proGruppe: step.proGruppe,
            gruppenname: step.gruppenname || inferredGroupName,
            text: step.gruppentext || (step.gruppen + ' leere Gruppen werden angelegt.')
          });
        }
      }
      out.push(step);
    });

    const alreadySummarized = out.some(step => step && step.aktion === 'zusammenfassen');
    if (shouldSummarize && !alreadySummarized) {
      out.push({
        aktion: 'zusammenfassen',
        text: 'Alle Plättchen werden als Gesamtmenge zusammengelegt.'
      });
    }
    return out;
  }

  // Robustes Herauslösen eines JSON-Arrays aus der KI-Antwort (Code-Fences, Vortext etc.)
  function parseVisualizationScript(raw) {
    if (Array.isArray(raw)) return raw;
    if (typeof raw !== 'string') return [];
    let s = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  const api = {
    getVisualizationInstruction,
    getVisualizeInteractivePrompt,
    getVisualizeStartPrompt,
    getVisualizeScriptSystemPrompt,
    getVisualizeGuidedPrompt,
    getVisualizeGuidedStartPrompt,
    getVisualizeStandHinweis,
    visibleStationCount,
    planToDrehbuch,
    enhanceMultiplicationPlan,
    parseVisualizationScript
  };

  global.VisualizationPrompts = Object.assign(global.VisualizationPrompts || {}, api);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Object.assign(module.exports || {}, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);
