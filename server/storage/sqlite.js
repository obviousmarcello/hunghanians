import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DuplicateError } from './errors.js';

/**
 * SQLite storage (Node's built-in node:sqlite). Used for local development and
 * tests, or on any host with a persistent disk.
 *
 * Schema migrations are applied in order. Never edit an existing entry once it
 * has been deployed - append a new one instead (and mirror it in mysql.js).
 */
const MIGRATIONS = [
    `CREATE TABLE messages (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        name        TEXT    NOT NULL,
        email       TEXT    NOT NULL,
        subject     TEXT    NOT NULL,
        message     TEXT    NOT NULL,
        lang        TEXT    NOT NULL DEFAULT 'en',
        handled     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE registrations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        event_id    TEXT    NOT NULL,
        name        TEXT    NOT NULL,
        email       TEXT    NOT NULL,
        phone       TEXT,
        adults      INTEGER NOT NULL,
        children    INTEGER NOT NULL DEFAULT 0,
        infants     INTEGER NOT NULL DEFAULT 0,
        notes       TEXT,
        lang        TEXT    NOT NULL DEFAULT 'en',
        total_fee   INTEGER NOT NULL,
        currency    TEXT    NOT NULL,
        status      TEXT    NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'cancelled')),
        UNIQUE (event_id, email)
    );

    CREATE INDEX idx_registrations_event ON registrations (event_id, status);`,
];

function migrate(db) {
    const { user_version: current } = db.prepare('PRAGMA user_version').get();
    for (let v = current; v < MIGRATIONS.length; v++) {
        db.exec('BEGIN');
        try {
            db.exec(MIGRATIONS[v]);
            db.exec(`PRAGMA user_version = ${v + 1}`);
            db.exec('COMMIT');
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    }
}

const REGISTRATION_COLUMNS = `id, created_at AS createdAt, event_id AS eventId, name, email, phone,
    adults, children, infants, notes, lang, total_fee AS totalFee, currency, status`;

const MESSAGE_COLUMNS = `id, created_at AS createdAt, name, email, subject, message, lang, handled`;

/** Opens (and migrates) the SQLite database. Pass ':memory:' for tests. */
export function openSqlite(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate(db);

    const stmts = {
        insertMessage: db.prepare(
            `INSERT INTO messages (name, email, subject, message, lang)
             VALUES (:name, :email, :subject, :message, :lang)`,
        ),
        listMessages: db.prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages ORDER BY id DESC`),
        markMessageHandled: db.prepare('UPDATE messages SET handled = :handled WHERE id = :id'),

        insertRegistration: db.prepare(
            `INSERT INTO registrations
                (event_id, name, email, phone, adults, children, infants, notes, lang, total_fee, currency)
             VALUES
                (:eventId, :name, :email, :phone, :adults, :children, :infants, :notes, :lang, :totalFee, :currency)`,
        ),
        getRegistration: db.prepare(`SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = ?`),
        listRegistrations: db.prepare(
            `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE event_id = ? ORDER BY id`,
        ),
        setRegistrationStatus: db.prepare('UPDATE registrations SET status = :status WHERE id = :id'),
        summary: db.prepare(
            `SELECT status,
                    COUNT(*)                    AS registrations,
                    COALESCE(SUM(adults), 0)    AS adults,
                    COALESCE(SUM(children), 0)  AS children,
                    COALESCE(SUM(infants), 0)   AS infants,
                    COALESCE(SUM(total_fee), 0) AS totalFee
             FROM registrations WHERE event_id = ? GROUP BY status ORDER BY status`,
        ),
        headcount: db.prepare(
            `SELECT COALESCE(SUM(adults + children + infants), 0) AS people
             FROM registrations WHERE event_id = ? AND status != 'cancelled'`,
        ),
    };

    // Same async interface as the MySQL store, so routes don't care which one is used.
    return {
        client: 'sqlite',
        async ping() {
            db.prepare('SELECT 1').get();
        },
        async close() {
            db.close();
        },

        async createMessage(msg) {
            const { lastInsertRowid } = stmts.insertMessage.run(msg);
            return Number(lastInsertRowid);
        },
        async listMessages() {
            return stmts.listMessages.all();
        },
        async setMessageHandled(id, handled) {
            return stmts.markMessageHandled.run({ id, handled: handled ? 1 : 0 }).changes > 0;
        },

        async createRegistration(reg) {
            try {
                const { lastInsertRowid } = stmts.insertRegistration.run(reg);
                return stmts.getRegistration.get(Number(lastInsertRowid));
            } catch (err) {
                if (/UNIQUE constraint failed/.test(err.message)) throw new DuplicateError();
                throw err;
            }
        },
        async getRegistration(id) {
            return stmts.getRegistration.get(id);
        },
        async listRegistrations(eventId) {
            return stmts.listRegistrations.all(eventId);
        },
        async setRegistrationStatus(id, status) {
            return stmts.setRegistrationStatus.run({ id, status }).changes > 0;
        },
        async registrationSummary(eventId) {
            return stmts.summary.all(eventId);
        },
        async headcount(eventId) {
            return stmts.headcount.get(eventId).people;
        },
    };
}
