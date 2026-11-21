-- CamGood central database. Safe to run on every start (idempotent).

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cameras (
  id          SERIAL PRIMARY KEY,
  did         TEXT NOT NULL UNIQUE,          -- P2P id, e.g. PIXB-HCAM12345678ABCDE
  name        TEXT NOT NULL,
  cam_user    TEXT NOT NULL DEFAULT 'admin',
  cam_pwd_enc TEXT NOT NULL,                 -- camera password, AES-256-GCM encrypted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- which (non-admin) users may use which cameras; admins see every camera
CREATE TABLE IF NOT EXISTS camera_access (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, camera_id)
);

CREATE TABLE IF NOT EXISTS media (
  id         SERIAL PRIMARY KEY,
  camera_id  INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('photo', 'video')),
  file_path  TEXT NOT NULL,                  -- relative to MEDIA_DIR
  mime       TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  duration_ms INTEGER,
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_camera_taken ON media (camera_id, taken_at DESC);

-- who did what: logins, live views, uploads, admin changes
CREATE TABLE IF NOT EXISTS access_log (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  camera_id  INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  detail     JSONB,
  ip         TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_log_created ON access_log (created_at DESC);
