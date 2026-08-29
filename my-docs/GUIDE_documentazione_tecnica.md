# Documentazione Tecnica — bt-gui

## Architettura dati

### DataSource (tabella `data_sources`)

I dati di prezzo e gli indicatori pre-calcolati sono memorizzati nel database SQLite `bt_gui.db` all'interno della tabella `data_sources`.

| Colonna | Tipo | Descrizione |
|---------|------|-------------|
| `id` | INTEGER | Chiave primaria auto-incrementale |
| `name` | VARCHAR | Nome univoco del datasource |
| `type` | VARCHAR | `price`, `volume`, `volatility`, ecc. |
| `source` | VARCHAR | Origine: `ffn`, `csv`, `parquet`, `computed` |
| `path_or_tickers` | VARCHAR | Lista ticker (per ffn) o nome file (per upload) |
| `meta_json` | JSON | Metadati aggiuntivi |
| `parquet_blob` | BLOB | DataFrame serializzato in formato parquet (byte) |

### Formati di archiviazione

- **Nessun file esterno** viene creato per i dati. Tutto è contenuto nel DB SQLite.
- I DataFrame pandas vengono serializzati come byte parquet (`df.to_parquet()`) e salvati nella colonna `parquet_blob`.
- La deserializzazione avviene con `pd.read_parquet(io.BytesIO(blob))`.

### Tabella backtest_runs

Salva i risultati dei backtest con le stesse convenzioni di serializzazione parquet per curve di equity, pesi e transazioni.

### Tabella strategies

Contiene l'albero della strategia (JSON serializzato) per il salvataggio e caricamento persistente.

---

*Ultimo aggiornamento: 2026-08-28*
