export function renderFonti({
  dataset, safeUrl, html, date, heading, mode, coverageRows
}) {
  const sources = dataset.sources.map(source => {
    const href = safeUrl(source.url);
    return `<li>${href ? `<a href="${html(href)}" target="_blank" rel="noopener noreferrer">${html(source.name)}</a>` : html(source.name)}
      ${source.license ? ` · ${html(source.license)}` : ''}${source.updatedAt ? ` · aggiornato ${html(date(source.updatedAt))}` : ''}
      ${source.latestResultDate ? ` · ultimo risultato ${html(date(source.latestResultDate))}` : ''}
      ${source.note || source.modifications ? `<br>${html(source.note ?? source.modifications)}` : ''}</li>`;
  });
  return `${heading('Fonti e metodo', 'Controlla la provenienza, la copertura e le ipotesi delle stime.')}
  <div class="split"><section class="panel prose"><h2>Provenienza dei dati</h2>
    <p>${dataset.updatedAt ? `Snapshot elaborato il ${html(date(dataset.updatedAt))}.` : 'Data di elaborazione mancante.'} Il trattino indica un dato mancante. Un valore pari a zero viene mostrato come 0.</p>
    ${sources.length ? `<ul>${sources.join('')}</ul>` : ''}
    ${mode === 'real' ? `<h3>Copertura della stagione</h3><p>Lo snapshot può essere parziale. Una partita con data trascorsa e risultato assente viene mostrata come «Risultato mancante». L’assenza di segnalazioni non conferma la disponibilità.</p>` : '<p>Le statistiche demo sono sintetiche e servono per provare tutte le funzioni.</p>'}
    ${coverageRows()}
  </section><section class="panel prose"><h2>Metodo di calcolo</h2>
    <h3>Indice di schierabilità</h3><p>Scala 0–100. Probabilità di giocare 40%, minuti 25%, bonus 25% e avversario 10%. Il peso dei dati disponibili viene riproporzionato e la copertura è mostrata in scheda. Le partite concluse non ricevono una previsione retroattiva.</p>
    <h3>Match Center</h3><p>Il modello Poisson usa risultati precedenti alla partita, medie di campionato in casa e in trasferta e rendimento delle squadre sul rispettivo campo. Quando disponibile incorpora lo storico 2025/26. Il test retrospettivo è in Analisi.</p>
    <h3>Monte Carlo</h3><p>La stima può usare i voti degli Excel di giornata di Fantacalcio.it, i fantavoti CSV della lega o FantaTB e la fantamedia del listone. Quando ci sono statistiche di gioco sufficienti, simula minuti ed eventi. Le sostituzioni seguono l’ordine della panchina e il ruolo.</p>
    <h3>xG e xA</h3><p>xG stima la qualità dei tiri. xA stima la qualità delle occasioni create. I valori per 90 minuti si calcolano con minuti positivi e metriche acquisite.</p>
  </section></div>`;
}
