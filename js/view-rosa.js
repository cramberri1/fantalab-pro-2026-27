export function renderRosa({
  modeState, lineup, groupPlayers, validateLineup, playerContexts, manualAvailabilityFor,
  previousLineup, dataset, mode, heading, html, getTeam, SHORT, dragAttributes, lineupContextLabel,
  status, empty, importReport, lineupUndo, round, suggestionPanel, lineupCopyPreview, FORMATION_OPTIONS,
  pitch, iconSpan, officialArchive
}) {
  const state = modeState();
  const record = lineup();
  const starters = groupPlayers(record.starters);
  const roster = groupPlayers(state.roster);
  const validation = validateLineup(starters, record.formation);
  const reserves = groupPlayers(record.reserves);
  const context = playerContexts(roster);
  const penaltyTakers = new Set(state.penaltyTakers);
  for (const [id, item] of context) {
    item.manual = manualAvailabilityFor(id);
    item.penaltyTaker = penaltyTakers.has(id);
  }
  const previous = previousLineup();
  const copy = previous?.record;
  const choices = dataset.players.filter(p => !state.roster.includes(p.id)).sort((a,b) => a.name.localeCompare(b.name,'it'));
  const presetButton = mode === 'demo' && dataset.demoPreset
    ? '<button class="primary" data-load-preset>Carica rosa demo</button>'
    : '<a class="btn" href="#mercato">Apri il mercato</a>';
  return `${heading('La mia rosa', 'Organizza titolari e panchina per giornata. Le modifiche vengono salvate su questo browser.', presetButton)}
  <p class="inline-status lineup-help">Trascina un calciatore oppure selezionalo e scegli dove metterlo. Per sostituire un titolare, scegli un calciatore dello stesso ruolo.</p>
  <p class="lineup-selection" id="lineup-selection" role="status"></p>
  <div class="split lineup-board">
    <section class="panel lineup-roster"><div class="panel-head"><div><h2>Rosa</h2><p>${roster.length} calciatori</p></div><a class="text-link" href="#giocatori">Apri il listone →</a></div>
      ${choices.length ? `<form class="roster-add" id="roster-add"><label class="field-label">Aggiungi dal listone<select id="roster-choice" required><option value="">Seleziona calciatore</option>${choices.map(p => `<option value="${html(p.id)}">${html(p.name)} · ${html(getTeam(p.teamId)?.shortName)} · ${SHORT[p.position] ?? '—'}</option>`).join('')}</select></label><button type="submit">Aggiungi</button></form>` : ''}
      ${roster.length ? `<ul class="roster-list" data-lineup-scroll>${roster.map(p => {
        const active = record.starters.includes(p.id) ? 'starter' : record.reserves.includes(p.id) ? 'reserve' : 'none';
        return `<li><button type="button" class="lineup-handle" ${dragAttributes(p)} aria-label="Sposta ${html(p.name)}"><span aria-hidden="true">⠿</span><span aria-hidden="true">${SHORT[p.position] ?? '—'}</span></button><div class="lineup-roster-player"><button class="player-name" data-player="${html(p.id)}">${html(p.name)}</button>${lineupContextLabel(context.get(p.id))}</div>
          ${p.id.startsWith('csv:') ? status('Da CSV · senza statistiche', 'partial') : ''}
          <select data-lineup-role="${html(p.id)}" aria-label="Impiego di ${html(p.name)}">${[['none','Fuori'],['starter','Titolare'],['reserve','Panchina']].map(([key,label]) => `<option value="${key}" ${key === active ? 'selected' : ''}>${label}</option>`).join('')}</select>
          <button data-remove="${html(p.id)}" aria-label="Rimuovi ${html(p.name)}">✕</button></li>`;
      }).join('')}</ul>` : empty('Aggiungi calciatori dal listone o importa un CSV.')}
      ${state.roster.length !== roster.length ? `<p class="inline-status">${state.roster.length - roster.length} ID salvati non compaiono nello snapshot corrente. Restano nel backup.</p>` : ''}
      <div class="file-actions"><label class="btn button-file">Importa rosa CSV<input type="file" accept=".csv,text/csv" id="roster-csv" aria-label="Importa rosa CSV"></label>
      <button data-csv-template>Modello CSV</button><button data-export>Esporta backup</button>
      <label class="btn button-file">Importa backup<input type="file" accept=".json,application/json" id="backup-json" aria-label="Importa backup"></label></div>
      <p class="inline-status">Puoi usare l’export Classic di Fantacalcio.it o il modello CSV. Il backup è personale${officialArchive.days.length ? ' e include anche i voti di giornata importati' : ''}.</p>
      ${importReport ? `<div class="notice neutral"><p role="status">${html(importReport.message)}</p>
        ${importReport.unresolved?.length ? `<details><summary>Righe da verificare</summary><ul>
          ${importReport.unresolved.slice(0, 50).map(row => `<li>${html(row.label)} · ${html(row.reason)}</li>`).join('')}
          ${importReport.unresolved.length > 50 ? '<li>Mostrate le prime 50 righe.</li>' : ''}
        </ul></details>` : ''}</div>` : ''}
    </section>
    <section class="panel lineup-formation">
      <div class="panel-head"><div><h2>Formazione</h2><p>Giornata ${round}</p></div>${status(validation.valid ? '11 titolari validi' : `${starters.length} / 11 titolari`, validation.valid ? 'available' : 'partial')}</div>
      <div class="actions lineup-actions">
        ${copy ? `<button type="button" data-lineup-copy>Copia formazione G${round - 1}</button>` : ''}
        <button type="button" data-lineup-undo ${lineupUndo[mode].has(round) ? '' : 'disabled'}>Annulla ultima modifica</button>
        <button type="button" data-lineup-suggest ${roster.length < 11 ? 'disabled' : ''}>Suggerisci formazione</button>
      </div>
      ${suggestionPanel()}
      ${copy && lineupCopyPreview ? `<div class="notice neutral lineup-copy-preview"><p>La formazione della G${round - 1} sostituirà quella attuale. Modulo ${html(copy.formation)}, ${copy.starters.length} titolari, ${copy.reserves.length} riserve e ${copy.maxSubstitutions} cambi.${previous.missing ? ` ${previous.missing} calciatori non sono più disponibili nella rosa.` : ''}</p>
        <div class="actions"><button type="button" data-lineup-copy-confirm>Sostituisci formazione</button><button type="button" data-lineup-copy-cancel>Mantieni quella attuale</button></div></div>` : ''}
      <div class="lineup-controls"><label class="field-label">Modulo<select id="formation">${FORMATION_OPTIONS.map(f => `<option value="${f}" ${f === record.formation ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label class="field-label">Max cambi<select id="substitutions">${[0,1,2,3,4,5].map(n => `<option value="${n}" ${n === record.maxSubstitutions ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      ${pitch(record, validation, context)}
      ${!validation.valid && starters.length ? `<p class="inline-status">${html(validation.errors.join(' '))}</p>` : ''}
      <div class="duel lineup-bench"><h3>Panchina</h3><p>Priorità dall’alto verso il basso. Sostituzioni fra calciatori dello stesso ruolo.</p>
      ${reserves.length ? `<ol class="bench">${reserves.map((p, i) => `<li data-lineup-drop="reserve" data-drop-player="${html(p.id)}"><button type="button" class="bench-player" ${dragAttributes(p)}><span aria-hidden="true">⠿</span> ${html(p.name)} <small>${SHORT[p.position] ?? '—'}</small>${lineupContextLabel(context.get(p.id), true)}</button><button data-reserve="${html(p.id)}" data-move="-1" aria-label="Sposta ${html(p.name)} in alto" ${i === 0 ? 'disabled' : ''}>↑</button><button data-reserve="${html(p.id)}" data-move="1" aria-label="Sposta ${html(p.name)} in basso" ${i === reserves.length - 1 ? 'disabled' : ''}>↓</button></li>`).join('')}</ol>` : ''}
      <button class="lineup-drop-button" type="button" data-lineup-drop="reserve" data-drop-append>Aggiungi in coda</button></div>
      <button class="lineup-drop-button lineup-drop-out" type="button" data-lineup-drop="none">Fuori formazione</button>
      <a class="btn primary" href="#simulazione">Vai alla simulazione ${iconSpan('arrow')}</a>
      <a class="btn quiet" href="#match" data-show-difficulty>Difficoltà prossime giornate</a>
    </section>
  </div>`;
}
