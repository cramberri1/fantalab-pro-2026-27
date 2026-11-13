# Aggiornamenti Serie A 2026/27

Il sito legge lo snapshot unificato `data/serie-a-2026-27.json`. Le chiavi `teamId`, `fixtureId` e `playerId` collegano calendario, giocatori, statistiche e indisponibilità. I campi `coverage`, `sources` e `updatedAt` riportano copertura e provenienza. Un valore `null` indica un dato mancante. La modalità dimostrativa usa `data/demo.json`.

## GitHub Pages

1. Carica il progetto in un nuovo repository con ramo `main`, includendo `.github/workflows/pages.yml`.
2. In **Settings → Pages → Build and deployment**, scegli **GitHub Actions** come sorgente.
3. In **Actions**, apri **Aggiorna FantaLab Pro e pubblica su Pages** e usa **Run workflow** su `main`.

Il workflow parte anche a ogni push su `main` e tutti i giorni alle 04:37 UTC. OpenFootball, l’export con licenza di Football Analytics e TransferBeat si aggiornano senza chiavi. Gli xG di squadra di calcio.it provengono dallo snapshot con attribuzione incluso nei sorgenti. Un errore di rete, quota, integrità o licenza configurata fa fallire il job prima della pubblicazione. Il sito continua a servire l’ultimo deploy riuscito. Il workflow pubblica soltanto i file dell’app e gli snapshot normalizzati.

Per validare o aggiornare i dati in locale, dalla cartella del progetto con Python 3.11 o successivo:

```sh
python tools/update_data.py --validate-only data/serie-a-2026-27.json
python tools/update_data.py
python -m unittest discover -s tests -p 'test_*.py'
```

Gli aggiornamenti locali con `--openfootball-file`, `--footballanalytics-file`, `--roster-file` e `--ratings-dir` usano file originali scaricati a parte. Per lavorare sul solo calendario usa `--calendar-only`. Su Windows, se Python non trova il fuso `Europe/Rome`, installa `tzdata` con `python -m pip install tzdata`.

## API-Football

In **Settings → Secrets and variables → Actions**, aggiungi il segreto `API_FOOTBALL_KEY` con la chiave diretta API-Sports. Imposta la variabile `API_FOOTBALL_PUBLISH_ALLOWED=true` quando il contratto copre il sito pubblico, l’uso fantasy e la pubblicazione dello snapshot sul browser. La variabile facoltativa `API_FOOTBALL_REQUEST_BUDGET` limita le richieste per esecuzione e vale 75 per impostazione predefinita.

L’adattatore verifica l’accesso alla lega `135` e alla stagione `2026`. Importa risultati finali mancanti, statistiche stagionali su identità compatibili con il listone e indisponibilità legate a una partita quando la copertura e l’abbinamento lo permettono. Un’assenza di segnalazioni lascia la disponibilità sconosciuta. Un abbinamento ambiguo lascia vuoti i campi del giocatore. In locale, passa `--with-api-football` con chiave e variabile d’ambiente configurate.

Nel 2026 il piano Free dà accesso alle stagioni 2022/23–2024/25. Per valutare fornitori con accesso gratuito alla stagione corrente, consulta [le API esaminate](ANALISI.md#api-con-piano-gratuito). [Guida ufficiale API-Football](https://www.api-football.com/news/post/how-to-get-all-data-from-a-league-with-api-football)

## Statistiche da un feed autorizzato

Pubblica l’export normalizzato presso un endpoint HTTPS accessibile al runner. Configura i segreti `FANTALAB_METRICS_URL` e, se l’endpoint lo richiede, `FANTALAB_METRICS_BEARER`. Attiva `METRICS_PUBLISH_ALLOWED=true` quando i diritti coprono i campi che saranno esposti sul sito. In locale usa `FANTALAB_METRICS_FILE` per il percorso del JSON e aggiungi `--with-metrics` al comando.

Il documento JSON contiene `season` uguale a `2026/27`, `source` e le eventuali liste `players`, `fixtures` e `absences`. `source` richiede `name`, `url` pubblico, `license`, `licenseUrl`, `updatedAt` (ISO 8601 con fuso) e `throughDate` (data ISO dell’ultimo dato incluso). Indica il modello xG/xA nel nome della fonte se serve a distinguerlo. Usa gli ID dello snapshot pubblicato per collegare i record.

| Lista | Chiave | Campi supportati |
|---|---|---|
| `players` | `id` | `appearances`, `starts`, `minutes`, `goals`, `assists`, `shots`, `yellowCards`, `xg`, `xa`, `npxg`, `history` |
| `players[].history` | `fixtureId` | `minutes`, `goals`, `assists`, `xg`, `xa` |
| `fixtures` | `id` | `homeXg`, `awayXg` per risultati finali già acquisiti |
| `absences` | `playerId`, `fixtureId`, `teamId` | `status` (`out`, `doubtful`, `reported`), `reason` facoltativo |

Le statistiche aggregate devono coprire la stessa stagione, fino a `throughDate`. Per i singoli campi dei giocatori un campo omesso conserva l’eventuale dato API-Football, mentre `null` indica esplicitamente che il dato è mancante. Le credenziali si configurano fuori dal file e fuori dal repository.

Per interrompere la pubblicazione di una fonte facoltativa, disattiva la relativa variabile e rilancia il workflow per sostituire lo snapshot pubblico.

[Copertura e condizioni delle fonti](FONTI.md)
