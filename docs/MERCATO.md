# Mercato Classic

Apri **Mercato** e carica i due file Excel esportati dalla tua lega. Il **Listone completo** contiene calciatori, ruoli, quotazioni e assegnazioni alle fantasquadre. La **Lista svincolati** definisce chi può entrare tra i candidati al mercato di riparazione. Il listone si può consultare anche prima di avere una rosa. Per confrontare acquisti e uscite, aggiungi prima i tuoi calciatori in **La mia rosa**.

Il browser legge e salva localmente i dati utili all’analisi. Ricarica entrambi i file quando cambiano le assegnazioni o le statistiche della lega. La data di caricamento indica quando hai importato il file. La fonte per quotazioni, voti e proprietà rimane l’export della lega.

## Riparazione e scambi

- **Riparazione.** Cerca alternative di pari ruolo tra gli svincolati. Un calciatore segnato come fuori lista, già assegnato o già nella tua rosa viene escluso dai suggerimenti. Usa il tetto di quotazione per limitare la ricerca a un intervallo di riferimento.
- **Scambi.** Confronta due calciatori dello stesso ruolo. `FantaSquadra` mostra il titolare del cartellino al momento dell’export. La trattativa, il prezzo d’acquisto e il recupero crediti dipendono dalle regole della lega. `QUOT.` e `FVM/1000` sono riferimenti del listone. `Costo`, quando presente, è il costo storico di acquisto.

## Come leggere i consigli

`PGv` conta le partite in cui il giocatore ha ricevuto un voto. `MV` è la media voto e `FM` la fantamedia del file. Un giocatore con zero partite a voto ha evidenza insufficiente per l’indice di mercato.

L’indice confronta giocatori dello stesso ruolo. Il 65% misura la qualità della fantamedia, corretta verso la media del ruolo quando ci sono poche partite a voto. Il restante 35% misura il volume di partite a voto rispetto al massimo osservato nel listone. La correzione usa un peso equivalente a sei partite. Il confronto mostra la differenza di indice e segnala i campioni limitati.

L’indice descrive i dati storici dell’export. Le eventuali proiezioni di giornata provengono dal modello FantaLab e compaiono a parte quando l’archivio del sito ha i dati necessari.
