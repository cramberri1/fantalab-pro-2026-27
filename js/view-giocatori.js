export function renderGiocatori({
  dataset, mode, heading, html, filters, ROLES, playerList, comparison
}) {
  const teams = [...dataset.teams].sort((a,b) => a.shortName.localeCompare(b.shortName, 'it'));
  return `${heading('Calciatori', 'Apri una scheda per vedere numeri stagionali, andamento e motivi dell’indice di schierabilità.',
      mode === 'real' ? '<button data-market-tab="listone">Apri listone della lega</button>' : '')}
    <section class="panel">
      <div class="filters">
        <input id="player-search" type="search" aria-label="Cerca calciatore" placeholder="Cerca per nome o squadra" value="${html(filters.search)}">
        <select id="player-position" aria-label="Filtra per ruolo"><option value="">Tutti i ruoli</option>${Object.entries(ROLES).map(([id, name]) => `<option value="${id}" ${id === filters.position ? 'selected' : ''}>${name}</option>`).join('')}</select>
        <select id="player-team" aria-label="Filtra per squadra"><option value="">Tutte le squadre</option>${teams.map(t => `<option value="${html(t.id)}" ${t.id === filters.team ? 'selected' : ''}>${html(t.shortName)}</option>`).join('')}</select>
        <select id="player-sort" aria-label="Ordina calciatori">${[['name','Nome'],['index','Schierabilità'],['xg','xG'],['xa','xA'],['minutes','Minuti'],['goals','Gol']].map(([key, label]) => `<option value="${key}" ${key === filters.sort ? 'selected' : ''}>Ordina per ${label}</option>`).join('')}</select>
      </div>
      <p class="inline-status">Il trattino indica un dato mancante. ${mode === 'real' ? '<a class="text-link" href="#fonti">Verifica copertura e fonti</a>' : ''}</p><div id="player-list">${playerList()}</div>
    </section>
    <div id="comparison">${comparison()}</div>`;
}
