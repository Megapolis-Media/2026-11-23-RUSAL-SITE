CREATE TABLE IF NOT EXISTS music (
  id TEXT PRIMARY KEY,
  song TEXT NOT NULL,
  normalized TEXT NOT NULL,
  visitor TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS music_lookup ON music (normalized, visitor, created DESC);

CREATE TABLE IF NOT EXISTS messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  first TEXT NOT NULL,
  last TEXT NOT NULL,
  company TEXT NOT NULL,
  message TEXT NOT NULL,
  created INTEGER NOT NULL,
  consent_version TEXT NOT NULL,
  photo TEXT
);
CREATE TABLE IF NOT EXISTS photo_chunks (
  message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  part INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (message_id, part)
);
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  route TEXT NOT NULL,
  visitor TEXT NOT NULL,
  slot INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY (route, visitor, slot)
);
CREATE INDEX IF NOT EXISTS rate_limit_expiry ON rate_limits (expires);
