CREATE TABLE IF NOT EXISTS licenses (
  key        TEXT PRIMARY KEY,
  tier       TEXT NOT NULL,
  note       TEXT DEFAULT '',
  discord_id TEXT DEFAULT '',
  created    INTEGER NOT NULL,
  expires    INTEGER NOT NULL DEFAULT 0,
  revoked    INTEGER NOT NULL DEFAULT 0,
  max_hwid   INTEGER NOT NULL DEFAULT 3,
  last_reset INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hwids (
  key        TEXT NOT NULL,
  hwid       TEXT NOT NULL,
  uid        TEXT,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (key, hwid)
);

CREATE TABLE IF NOT EXISTS presence (
  uid       TEXT PRIMARY KEY,
  name      TEXT,
  display   TEXT,
  tier      TEXT DEFAULT 'FREE',
  game      TEXT,
  place     TEXT,
  last_seen INTEGER NOT NULL,
  last_chat INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_presence_name ON presence (lower(name));

CREATE TABLE IF NOT EXISTS chat (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  ts    INTEGER NOT NULL,
  uid   TEXT,
  name  TEXT,
  text  TEXT,
  tier  TEXT DEFAULT 'FREE',
  owner INTEGER NOT NULL DEFAULT 0,
  room  TEXT NOT NULL DEFAULT 'global'
);

CREATE TABLE IF NOT EXISTS announcements (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,
  title    TEXT,
  text     TEXT,
  duration INTEGER NOT NULL DEFAULT 15,
  sound    TEXT,
  author   TEXT,
  role     TEXT
);

CREATE TABLE IF NOT EXISTS dms (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        INTEGER NOT NULL,
  from_uid  TEXT,
  from_name TEXT,
  to_name   TEXT,
  text      TEXT
);

CREATE TABLE IF NOT EXISTS bans (
  uid    TEXT PRIMARY KEY,
  reason TEXT,
  ts     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS vstate (
  job  TEXT NOT NULL,
  uid  TEXT NOT NULL,
  held TEXT,
  back TEXT,
  ts   INTEGER NOT NULL,
  PRIMARY KEY (job, uid)
);

CREATE TABLE IF NOT EXISTS site_comments (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       INTEGER NOT NULL,
  name     TEXT NOT NULL,
  text     TEXT NOT NULL,
  role     TEXT NOT NULL DEFAULT 'GUEST',
  verified INTEGER NOT NULL DEFAULT 0,
  pinned   INTEGER NOT NULL DEFAULT 0,
  ip       TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_comments_ts ON site_comments (ts);

CREATE TABLE IF NOT EXISTS roles (
  uid     TEXT PRIMARY KEY,
  name    TEXT DEFAULT '',
  role    TEXT NOT NULL,
  expires INTEGER NOT NULL DEFAULT 0,
  note    TEXT DEFAULT '',
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ts     INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);
