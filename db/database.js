// db/database.js
// SQLite via better-sqlite3 — synchronous, zero-config, fast enough for this scale.

const Database = require('better-sqlite3');
const crypto  = require('crypto');
const path    = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './compliance.db';

let db;

function getDb() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      email                   TEXT    NOT NULL UNIQUE,
      stripe_customer_id      TEXT,
      stripe_subscription_id  TEXT,
      status                  TEXT    NOT NULL DEFAULT 'pending',
      tier                    TEXT    NOT NULL DEFAULT 'basic',
      unsubscribe_token       TEXT    NOT NULL,
      created_at              TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at              TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sent_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source        TEXT NOT NULL,
      item_guid     TEXT NOT NULL,
      title         TEXT,
      url           TEXT,
      published_at  TEXT,
      ingested_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(source, item_guid)
    );

    CREATE TABLE IF NOT EXISTS newsletters (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      subject       TEXT NOT NULL,
      html_body     TEXT NOT NULL,
      text_body     TEXT NOT NULL,
      item_count    INTEGER NOT NULL DEFAULT 0,
      recipient_count INTEGER NOT NULL DEFAULT 0,
      sent_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS send_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      newsletter_id   INTEGER NOT NULL REFERENCES newsletters(id),
      subscriber_id   INTEGER NOT NULL REFERENCES subscribers(id),
      email           TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'sent',
      sent_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// ── Subscribers ────────────────────────────────────────────────────────────────

function upsertSubscriber({ email, stripeCustomerId, stripeSubscriptionId, status, tier }) {
  const token = crypto.randomBytes(32).toString('hex');
  const db = getDb();
  return db.prepare(`
    INSERT INTO subscribers (email, stripe_customer_id, stripe_subscription_id, status, tier, unsubscribe_token)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      stripe_customer_id     = COALESCE(excluded.stripe_customer_id, stripe_customer_id),
      stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, stripe_subscription_id),
      status                 = excluded.status,
      tier                   = COALESCE(excluded.tier, tier),
      updated_at             = datetime('now')
    RETURNING *
  `).get(email, stripeCustomerId || null, stripeSubscriptionId || null, status || 'active', tier || 'basic', token);
}

function getActiveSubscribers() {
  return getDb().prepare(`SELECT * FROM subscribers WHERE status = 'active'`).all();
}

function getSubscriberByToken(token) {
  return getDb().prepare(`SELECT * FROM subscribers WHERE unsubscribe_token = ?`).get(token);
}

function getSubscriberByStripeCustomer(customerId) {
  return getDb().prepare(`SELECT * FROM subscribers WHERE stripe_customer_id = ?`).get(customerId);
}

function setSubscriberStatus(email, status) {
  getDb().prepare(`UPDATE subscribers SET status = ?, updated_at = datetime('now') WHERE email = ?`).run(status, email);
}

// ── Sent Items (deduplication) ─────────────────────────────────────────────────

function filterNewItems(items) {
  // Returns only items we haven't processed before
  const db = getDb();
  const check = db.prepare(`SELECT 1 FROM sent_items WHERE source = ? AND item_guid = ?`);
  return items.filter(item => !check.get(item.source, item.guid));
}

function markItemsSent(items) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO sent_items (source, item_guid, title, url, published_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertAll = db.transaction((items) => {
    for (const item of items) {
      insert.run(item.source, item.guid, item.title, item.url, item.publishedAt || null);
    }
  });
  insertAll(items);
}

// ── Newsletters ────────────────────────────────────────────────────────────────

function saveNewsletter({ subject, htmlBody, textBody, itemCount, recipientCount }) {
  return getDb().prepare(`
    INSERT INTO newsletters (subject, html_body, text_body, item_count, recipient_count)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id
  `).get(subject, htmlBody, textBody, itemCount, recipientCount);
}

function logSend(newsletterId, subscriberId, email, status = 'sent') {
  getDb().prepare(`
    INSERT INTO send_log (newsletter_id, subscriber_id, email, status)
    VALUES (?, ?, ?, ?)
  `).run(newsletterId, subscriberId, email, status);
}

module.exports = {
  getDb,
  upsertSubscriber,
  getActiveSubscribers,
  getSubscriberByToken,
  getSubscriberByStripeCustomer,
  setSubscriberStatus,
  filterNewItems,
  markItemsSent,
  saveNewsletter,
  logSend,
};
