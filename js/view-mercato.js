export function renderMercato({
  mode, heading, getMarket, MARKET_UPLOADS, marketImportCard, number, marketImports, marketNotice, html,
  MARKET_TABS, marketFilters, marketToolbar, marketResults
}) {
  if (mode === 'demo') return `${heading('Mercato', 'Analizza gli svincolati e gli scambi della tua lega.')}
    <section class="panel"><p>Gli Excel della lega si caricano in modalità Dati reali.</p><button data-mode="real">Passa ai dati reali</button></section>`;
  const market = getMarket();
  const coverage = market.coverage;
  return `${heading('Mercato', 'Cerca possibili miglioramenti tra gli svincolati e confronta gli scambi per ruolo.')}
    <div class="market-inputs">${Object.keys(MARKET_UPLOADS).map(marketImportCard).join('')}</div>
    <p class="inline-status">Gli Excel e le assegnazioni restano su questo browser. Il listone della lega è disponibile in questa sezione.</p>
    ${coverage.catalog ? `<div class="market-facts market-coverage" aria-label="Copertura analisi">
      ${coverage.roster ? `<span>Rosa collegata ${number(coverage.matchedRoster)}/${number(coverage.roster)}</span>` : ''}
      ${marketImports.svincolati ? `<span>${number(coverage.eligibleFreeAgents)} svincolati candidabili</span><span>${number(coverage.unscoredFreeAgents)} senza indice</span>` : ''}
      ${coverage.conflictingFreeAgents ? `<span>${number(coverage.conflictingFreeAgents)} righe discordanti escluse</span>` : ''}
      <span>Stima di giornata per ${number(coverage.fixtureProjections)}/${number(coverage.catalog)} profili</span>
    </div>` : ''}
    ${marketNotice ? `<p class="notice neutral" role="status">${html(marketNotice)}</p>` : ''}
    <section class="panel market-workbench">
      <div class="panel-head"><div><h2>${MARKET_TABS[marketFilters.tab]}</h2><p>${marketFilters.tab === 'riparazione'
        ? 'Il filtro usa la quotazione di riferimento. Il prezzo effettivo dipende dalla tua asta.'
        : marketFilters.tab === 'scambi' ? 'Un confronto alla volta tra giocatori dello stesso ruolo. Conguaglio positivo se paghi, negativo se incassi.'
        : 'Cerca tra tutti i giocatori dell’Excel, compresi quelli fuori lista.'}</p></div></div>
      <div class="mode-switch market-tabs" role="group" aria-label="Sezione mercato">${Object.entries(MARKET_TABS).map(([id,label]) =>
        `<button type="button" data-market-tab="${id}" aria-pressed="${id === marketFilters.tab}">${label}</button>`).join('')}</div>
      ${marketToolbar(market)}
      <div id="market-results">${marketResults(market)}</div>
      <details class="market-method"><summary>Fonti e metodo dell’indice</summary>
        <p>Il confronto usa fantamedia e partite a voto dell’Excel. La fantamedia corretta si avvicina al valore tipico del ruolo quando il campione è piccolo. Quotazioni e FVM sono riferimenti del file. Il trattino indica un dato mancante.</p>
        ${market.notes.length ? `<ul>${market.notes.map(note => `<li>${html(note)}</li>`).join('')}</ul>` : ''}
      </details>
    </section>`;
}
