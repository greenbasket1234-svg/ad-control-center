require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id            SERIAL PRIMARY KEY,
      type          TEXT NOT NULL, -- 'batch', 'connect', 'error', 'info'
      channel       TEXT,
      advertiser_id INT REFERENCES advertisers(id) ON DELETE SET NULL,
      advertiser_name TEXT,
      message       TEXT NOT NULL,
      detail        TEXT,
      status        TEXT DEFAULT 'info', -- 'success', 'error', 'warning', 'info'
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_logs_created ON activity_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_type    ON activity_logs(type);

    CREATE TABLE IF NOT EXISTS advertisers (
      id             SERIAL PRIMARY KEY,
      name           TEXT NOT NULL,
      brand_color    TEXT DEFAULT '#2563eb',
      monthly_budget BIGINT DEFAULT 0,
      is_active      BOOLEAN DEFAULT TRUE,
      created_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at     TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'advertiser', -- 'admin' | 'advertiser'
      advertiser_id INT REFERENCES advertisers(id) ON DELETE SET NULL,
      name          TEXT,
      is_active     BOOLEAN DEFAULT TRUE,
      last_login_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ad_accounts (
      id               SERIAL PRIMARY KEY,
      advertiser_id    INT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
      channel          TEXT NOT NULL,
      status           TEXT DEFAULT 'pending',
      error_message    TEXT,
      credentials_enc  TEXT,
      last_tested_at   TIMESTAMPTZ,
      last_synced_at   TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (advertiser_id, channel)
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      id                SERIAL PRIMARY KEY,
      advertiser_id     INT NOT NULL REFERENCES advertisers(id) ON DELETE CASCADE,
      channel           TEXT NOT NULL,
      date              DATE NOT NULL,
      impressions       BIGINT DEFAULT 0,
      clicks            BIGINT DEFAULT 0,
      cost              BIGINT DEFAULT 0,
      conversions       BIGINT DEFAULT 0,
      conversion_amount BIGINT DEFAULT 0,
      ctr               NUMERIC(8,4) DEFAULT 0,
      cpc               NUMERIC(10,2) DEFAULT 0,
      cpm               NUMERIC(10,2) DEFAULT 0,
      roas              NUMERIC(8,2) DEFAULT 0,
      fetched_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (advertiser_id, channel, date)
    );

    CREATE INDEX IF NOT EXISTS idx_stats_date       ON daily_stats(date DESC);
    CREATE INDEX IF NOT EXISTS idx_stats_advertiser ON daily_stats(advertiser_id);
    CREATE INDEX IF NOT EXISTS idx_stats_channel    ON daily_stats(channel);
  `);
  console.log("[DB] 테이블 초기화 완료");
}

module.exports = { pool, initDB };
