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

Il voto base è fisso a 6 in ogni presenza simulata. Ogni gol vale +3 e ogni assist +1. Dove lo storico è sufficiente, il modello sottrae 0,5 per una possibile ammonizione e 1 per ogni gol subito da un portiere. Se mancano sia il conteggio sia il valore atteso di gol o assist, la stima del fantapunteggio resta vuota.

## Simulazione Monte Carlo

Per ogni prova il simulatore estrae l’impiego di ciascun giocatore. Quando sono disponibili le titolarità, divide le presenze in due profili di minutaggio, da titolare e da subentrato. Estrae gol, assist e gol subiti da distribuzioni di Poisson con frequenze proporzionali ai minuti simulati. Assume indipendenza tra giocatori. I percentili P10, P50 e P90 sono ricavati dalla distribuzione dei punteggi delle prove. Lo stesso seme riproduce i risultati a parità di archivio, giornata e formazione.

Le riserve vengono provate nell’ordine impostato dall’utente. Ciascuna può sostituire un titolare senza presenza simulata dello stesso ruolo, fino al limite di sostituzioni. Quando mancano dati per un titolare, il risultato indica copertura parziale e mostra il giocatore tra gli esclusi. Il calcolo di una giornata richiede un incontro verificato per ogni giocatore incluso. Le proiezioni riguardano le partite da giocare e usano le statistiche disponibili alla data dell’archivio.

Per eseguire i test del modello con Node.js 22 o successivo, apri il terminale nella cartella del progetto ed esegui `node --test tests/model.test.mjs`.
