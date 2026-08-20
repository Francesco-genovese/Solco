-- ============================================================
-- Solco — schema database (Cloudflare D1)
-- Da eseguire a mano in Dashboard Cloudflare → D1 → Console.
-- Rieseguibile: usa IF NOT EXISTS, non cancella dati esistenti.
-- ============================================================

-- --- Autenticazione (base riutilizzabile, dal tutorial) ---

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'Utente',      -- 'Utente' | 'Amministratore'
  status TEXT NOT NULL DEFAULT 'ok',        -- 'ok' | 'sospeso'
  password_hash TEXT,
  avatar_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Codici invito: per aggiungere altre persone alla libreria privata
-- senza esporre una registrazione pubblica.
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  used_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  used_at TEXT
);

-- --- Specifiche di Solco ---

CREATE TABLE IF NOT EXISTS album (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  label TEXT,
  catalog_number TEXT,
  year INTEGER,
  genre TEXT,
  country TEXT,
  barcode TEXT,
  matrix_a TEXT,
  matrix_b TEXT,
  discogs_release_id TEXT,
  condition_media TEXT NOT NULL DEFAULT 'VG',   -- scala Goldmine: M, NM, VG+, VG, G+, G, F, P
  condition_sleeve TEXT,
  pressing_note TEXT,                            -- es. "1ª stampa IT"
  value_estimate REAL,
  value_low REAL,
  value_high REAL,
  notes TEXT,
  cover_color TEXT,                              -- colore segnaposto copertina (nessuna immagine reale)
  added_by TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  priority INTEGER NOT NULL DEFAULT 2,           -- 1 alta, 2 media, 3 bassa
  added_by TEXT,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_album_added_at ON album(added_at);
CREATE INDEX IF NOT EXISTS idx_album_genre ON album(genre);
CREATE INDEX IF NOT EXISTS idx_album_barcode ON album(barcode);
