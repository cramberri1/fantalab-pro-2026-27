# FantaLab Pro · Serie A 2026/27

App web per consultare il calendario, analizzare i calciatori e gestire le formazioni del fantacalcio. Le schede riportano statistiche, serie storiche, indice di schierabilità e copertura quando i dati lo consentono. Il Match Center usa le partite precedenti acquisite per stimare la difficoltà dei reparti. La simulazione Monte Carlo produce una distribuzione riproducibile dei fantapunti per il singolo o per l’undici con panchina.

## Avvio

La copia `FantaLab-Pro.html` si apre direttamente nel browser e include uno snapshot dei dati e la demo. Per eseguire i sorgenti da questa cartella, avvia `python -m http.server 8000` e visita [localhost:8000](http://localhost:8000). Il browser usa HTTP per caricare i moduli e i file JSON della versione a più file.

Per provare una simulazione completa, seleziona **Demo → La mia rosa → Carica rosa demo → Vai alla simulazione**. Il backup JSON include entrambe le modalità e consente di trasferire la rosa in un altro browser. Ogni copia dell’app e ogni dispositivo hanno il proprio salvataggio locale.

### Importare una rosa

In modalità **Dati reali**, apri **La mia rosa → Importa rosa CSV** e scegli l’export Classic di Fantacalcio.it. FantaLab usa nome, squadra e ruolo per cercare una corrispondenza univoca, anche quando i due listoni scrivono il nome in modi diversi. Le righe con squadra e ruolo riconosciuti che non trovano il calciatore nel listone vengono salvate nella tua rosa con l’etichetta **Da CSV · senza statistiche**. Il riepilogo segnala le righe ambigue. Le colonne delle quotazioni, dei costi, dei voti e dei prestiti non alimentano le statistiche dell’app.

L’importazione si aggiunge alla rosa salvata ed evita duplicati. Il file viene elaborato nel browser. Per gli altri CSV usa una colonna `id` oppure `nome` e, facoltativamente, `squadra`.

### Mercato della lega

In **Dati reali → Mercato**, carica separatamente l’Excel del **Listone completo** e quello degli **Svincolati della lega**. Il listone è consultabile e ricercabile. **Riparazione** confronta la rosa con gli svincolati, mentre **Scambi** confronta una coppia dello stesso ruolo. Le analisi usano le statistiche effettivamente disponibili, con evidenza del campione e quotazioni indicative. Gli Excel e i dati estratti restano nel browser.

[Caricamento degli Excel e metodo del mercato](docs/MERCATO.md)

## Dati e copertura

L’archivio unificato `data/serie-a-2026-27.json` collega squadre, partite, calciatori, statistiche e indisponibilità con ID stabili e metadati di provenienza. La demo ha un archivio a sé.

- Calendario di 380 partite e 50 risultati finali OpenFootball, fino alla 5ª giornata.
- 652 voci del listone TransferBeat del 1° ottobre e 1.416 voti FantaTB delle prime cinque giornate.
- xG, xA, minuti e altre statistiche individuali necessarie alle previsioni, nonché le indisponibilità attuali, richiedono un feed aggiuntivo. La modalità reale segnala le lacune. Gli indici e le simulazioni reali si attivano per i giocatori con dati sufficienti.

[Fonti, licenze e copertura](docs/FONTI.md) · [Metodo e limiti del modello](docs/MODELLO.md)

## GitHub Pages

1. Crea un [nuovo repository](https://github.com/new) nel tuo account e carica la cartella dei sorgenti, inclusa `.github`, sul branch `main`.
2. In **Settings → Pages**, scegli **GitHub Actions** come fonte di pubblicazione.
3. In **Actions**, avvia **Aggiorna FantaLab Pro e pubblica su Pages** su `main`. A pubblicazione riuscita, l’indirizzo compare in **Settings → Pages → Visit site**.

Il workflow pianificato aggiorna le fonti aperte ogni giorno alle 04:37 UTC e pubblica il sito solo quando la preparazione riesce. Per aggiungere feed con licenza e credenziali, segui la [guida agli aggiornamenti e ai Secrets](docs/AGGIORNAMENTI.md).

## Verifica e ricostruzione

```sh
python -m unittest discover -s tests -p 'test_*.py'
python tools/update_data.py --validate-only data/serie-a-2026-27.json
node --test tests/*.test.mjs
node tools/build_offline.mjs ../FantaLab-Pro.html
```
