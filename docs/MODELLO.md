# Schierabilità e fantapunteggio

Ogni stima usa l’archivio selezionato nell’app. I dati della demo sono sintetici e appartengono a club e giocatori di fantasia. Nell’archivio reale un valore `null` indica un dato mancante e `0` indica un valore registrato pari a zero. I fantapunteggi sono stime anche quando gli input sono reali.

## Indice di schierabilità

L’indice arrotonda a un intero da 0 a 100 la somma di quattro contributi.

| Componente | Peso | Calcolo |
| --- | --- | --- |
| Probabilità di impiego | 40% | Presenze divise per le gare concluse della squadra. |
| Minuti attesi | 25% | Probabilità di impiego × minuti medi per presenza, divisi per 90. |
| Potenziale bonus | 25% | Punti attesi per gol e assist per 90 minuti. Il massimo del componente corrisponde a 2,5 punti bonus per 90. |
| Avversario | 10% | Gol subiti di recente dall’avversario per i giocatori di movimento, gol segnati per i portieri, in rapporto alla media del campionato. |

Se manca un componente, i pesi degli altri vengono riscalati. La copertura somma i pesi originali dei componenti calcolabili. Presenze, minuti e gare concluse sono necessari per stimare l’impiego. Il confronto dell’avversario richiede almeno 12 gare di campionato con risultato e almeno quattro gare utili dell’avversario. Una segnalazione di indisponibilità confermata per la partita imposta la stima d’impiego a zero. Una segnalazione di dubbio riduce le probabilità d’impiego del 25% come ipotesi del modello. Una segnalazione generica resta visibile con la sua motivazione.

## Stima dei punti

Le frequenze di gol e assist per 90 minuti combinano il 65% del valore atteso e il 35% degli eventi registrati quando entrambi sono disponibili. Se è disponibile uno solo dei due, si usa quello. Il valore del provider conserva la propria provenienza. Il fattore avversario per i gol e gli assist stimati va da 0,8 a 1,2. La stima per il portiere usa anche la media tra i gol subiti di recente dalla sua squadra e i gol segnati di recente dall’avversario, con almeno quattro partite utili per squadra.

Nel modello per eventi il voto base è centrato su 6. La deviazione standard usa almeno 20 voti FantaTB del ruolo, pubblicati prima della previsione. In mancanza di campione usa 0,45 per portieri, difensori e centrocampisti e 0,50 per attaccanti. Il regolamento Classic in **Simulazione** permette di cambiare i bonus e i malus. Le penalità prive di dati vengono indicate nelle note. Il modificatore difesa considera, dopo i cambi, almeno quattro difensori a voto e il portiere se previsto dal regolamento.

Il modificatore di difesa si applica alle simulazioni per eventi e a quelle basate sugli Excel di giornata, che generano un voto base individuale.

In modalità reale, la stima del fantapunteggio privilegia le basi di voto disponibili. Quando sono disponibili minuti e statistiche di gioco, l’indice di schierabilità continua a usarli.

- **Excel Voti Fantacalcio.it.** Quando i titolari hanno sufficiente copertura, ha la precedenza sulle altre basi. La stima richiede almeno tre turni osservati e due voti della redazione scelta. La probabilità di voto approssima l’impiego. Un’assenza dall’Excel può essere considerata senza voto solo in una giornata completa, con partita conclusa e squadra del calciatore identificata senza ambiguità. I voti con asterisco alimentano il rendimento, mentre la deviazione standard del ruolo usa almeno 20 voti senza asterisco. Le frequenze per partita a voto usano cinque osservazioni equivalenti del ruolo per ridurre il peso dei piccoli campioni. I rigori segnati e i gol su azione hanno frequenze distinte. Bonus e malus seguono il regolamento salvato, con porta inviolata opzionale. Il modello basato su questi voti campiona eventi individuali con frequenze per partita a voto.
- **CSV di lega.** Campiona almeno due fantavoti su almeno tre registrazioni esplicite del 2026/27. Ogni riga usata deve riferirsi a una partita già conclusa prima della previsione e a un giocatore abbinato alla squadra. Le righe esplicite senza voto influiscono sulla probabilità di ricevere voto. I fantavoti 2025/26 restano consultabili in scheda.
- **FantaTB.** Campiona i fantavoti registrati prima della partita, con almeno tre osservazioni esplicite e almeno due voti. Una riga assente resta sconosciuta. I senza voto espliciti entrano nel campione solo se l’archivio è privo di voti ambigui.
- **Excel di lega.** Dopo aver indicato la giornata inclusa nel file in **Mercato**, il modello può usare le partite a voto e la fantamedia della lega per la giornata immediatamente successiva. La probabilità di ricevere voto è il rapporto tra voti e gare concluse della squadra. Con almeno tre voti, ogni esito a voto usa la fantamedia del file. La variabilità del voto non si ricava da una sola media.

Una simulazione di formazione usa una sola base di punteggio, selezionata per coprire più titolari. A parità di copertura ha precedenza l’Excel Voti Fantacalcio.it, seguito da CSV di lega, listone Excel, FantaTB e statistiche di gioco. La tabella mostra il metodo impiegato e le eventuali esclusioni.

### Taratura sui voti di giornata

L’app ricalcola localmente la verifica a ogni importazione, rimozione o modifica della redazione o delle regole Classic. Per ciascun turno completo il confronto usa solo i risultati e i voti dei giorni precedenti. Confronta la media storica con un metodo che pesa maggiormente gli ultimi turni e avvicina il voto base alla media del ruolo. Le frequenze dei singoli eventi continuano a usare le osservazioni del giocatore e del ruolo. La forma recente si attiva soltanto con almeno 150 previsioni individuali su quattro turni di verifica e una riduzione di almeno l’1% per entrambi gli errori. Il report mostra il Brier della probabilità di voto, l’errore medio assoluto in fantapunti e la replica della scelta compiuta prima di ogni turno. I senza voto verificati valgono zero nell’errore individuale. Le identità irrisolte e le giornate parziali restano escluse dalla verifica.

Con il metodo Excel, se l’indice da statistiche di gioco è assente, la probabilità di voto pesa il 65% e la media voto pesa il 35%. La media voto è riportata su una scala da 0 a 100 fra 4 e 8. Se manca, la probabilità di voto viene riscalata e la copertura resta al 65%. La fantamedia alimenta il punteggio atteso. Partite a voto, voto e fantavoto sono distinti da presenze, minuti e statistiche di gioco.

Le segnalazioni manuali valgono per la giornata indicata e hanno precedenza sulla fonte automatica. Indisponibilità e squalifica azzerano l’impiego, il dubbio lo riduce del 25% e la diffida ha valore informativo. Il backup include segnalazioni e formazioni di riferimento. L’annullamento dell’ultima modifica per giornata vale durante la sessione.

## Previsione 1X2

Il Match Center stima i gol di casa e trasferta dai risultati precedenti al giorno italiano della partita. Combina attacco e difesa sul rispettivo campo e mostra il rapporto fra le medie gol casa e trasferta. Le gare 2025/26 contribuiscono fino a quattro partite equivalenti per squadra e campo. La correzione Dixon–Coles ripesa 0–0, 0–1, 1–0 e 1–1. Si attiva dopo almeno 50 gare di confronto, quando riduce sia Brier sia log loss rispetto al Poisson per squadra. **Analisi** confronta i due modelli e il Poisson di campionato. [Dixon e Coles](https://doi.org/10.1111/1467-9876.00065)

La taratura automatica del totale gol usa lo scarto fra gol osservati e attesi nelle gare precedenti. Il fattore comune per casa e trasferta è limitato a 0,8–1,2 e tende a 1 con campioni piccoli. Si attiva se migliora la devianza del totale gol senza aumentare Brier e log loss 1X2, dopo almeno 30 confronti prospettici su almeno quattro date. La replica dell’intera politica include sia le date con taratura attiva sia quelle senza.

## Simulazione Monte Carlo

Per ogni prova il simulatore estrae l’impiego. Quando il Match Center stima la partita, estrae un punteggio comune e attribuisce gol e assist ai calciatori in base al minutaggio e alle frequenze. Parte degli eventi può spettare al resto della squadra. Le reti subite del portiere derivano dallo stesso punteggio, ponderate per la presenza in campo. Il flag rigorista aumenta il peso di assegnazione dei rigori segnati dove il tasso è acquisito. Se il punteggio comune manca, la simulazione usa frequenze individuali indipendenti. I percentili P10, P50 e P90 sono ricavati dalle prove riproducibili a parità di input e seme.

Il suggeritore massimizza la somma delle stime individuali degli undici titolari. Usa una sola base di punteggio e ordina la panchina per punti attesi. La stima del suggeritore è precedente alle sostituzioni e alle correlazioni della simulazione. Il confronto tra formazioni usa invece due simulazioni con gli stessi dati e lo stesso limite di cambi.

**Rendimento** confronta le previsioni salvate prima della giornata con i fantavoti osservati. Una riga senza voto esplicita può attivare una sostituzione. Una riga mancante resta ignota. Lo scarto viene mostrato quando il totale è risolvibile e le fonti di punteggio sono confrontabili.

Per ogni base di punteggio confrontabile, **Rendimento** aggrega errore assoluto medio, scarto medio e frequenza con cui il totale cade nell’intervallo P10–P90 salvato prima del turno. Le previsioni vecchie senza percentili alimentano soltanto le statistiche sull’errore.

Le riserve vengono provate nell’ordine impostato dall’utente. Ciascuna può sostituire un titolare senza presenza simulata dello stesso ruolo, fino al limite di sostituzioni. Quando mancano dati per un titolare, il risultato indica copertura parziale e mostra il giocatore tra gli esclusi. Il calcolo di una giornata richiede un incontro verificato per ogni giocatore incluso. Le proiezioni riguardano le partite da giocare e usano le statistiche disponibili alla data dell’archivio.

Per eseguire i test del modello con Node.js 22 o successivo, apri il terminale nella cartella del progetto ed esegui `node --test tests/model.test.mjs`.
