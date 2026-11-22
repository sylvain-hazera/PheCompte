-- Base D1 du service PhéCompte (idempotent : rejouée à chaque déploiement)
CREATE TABLE IF NOT EXISTS trouvailles (
  id TEXT PRIMARY KEY,
  created TEXT NOT NULL,
  product TEXT NOT NULL,
  brand TEXT,
  type TEXT,
  ean TEXT,
  weight_g REAL,
  prot REAL NOT NULL,
  kcal REAL,
  ou TEXT NOT NULL,          -- 'magasin' | 'web'
  store TEXT,
  city TEXT,
  cp TEXT,
  url TEXT,
  price REAL,
  note TEXT,
  seen INTEGER NOT NULL DEFAULT 1,
  gone INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS trouvailles_recent ON trouvailles (hidden, last_seen);
-- un avis (« vu » / « plus disponible ») par appareil, par trouvaille et par jour
CREATE TABLE IF NOT EXISTS avis (find_id TEXT NOT NULL, ip_hash TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (find_id, ip_hash, day));
-- quotas anti-abus par appareil et par jour (empreinte non réversible, change chaque jour)
CREATE TABLE IF NOT EXISTS quotas (ip_hash TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ip_hash, day, kind));
