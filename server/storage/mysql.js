import mysql from 'mysql2/promise';
import { DuplicateError } from './errors.js';

/**
 * MySQL storage, for hosts without a persistent disk (e.g. GoDaddy Node.js
 * Hosting, which provides a managed MySQL database).
 *
 * Migrations are applied in order and recorded in `schema_migrations`. Never
 * edit an existing entry once deployed - append a new one (and mirror it in
 * sqlite.js). MySQL commits DDL implicitly, so each statement is idempotent.
 */
const MIGRATIONS = [
    [
        `CREATE TABLE IF NOT EXISTS messages (
            id          INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
            created_at  DATETIME(3)   NOT NULL,
            name        VARCHAR(100)  NOT NULL,
            email       VARCHAR(254)  NOT NULL,
            subject     VARCHAR(200)  NOT NULL,
            message     TEXT          NOT NULL,
            lang        VARCHAR(5)    NOT NULL DEFAULT 'en',
            handled     TINYINT(1)    NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        `CREATE TABLE IF NOT EXISTS registrations (
            id          INT UNSIGNED  NOT NULL AUTO_INCREMENT PRIMARY KEY,
            created_at  DATETIME(3)   NOT NULL,
            event_id    VARCHAR(100)  NOT NULL,
            name        VARCHAR(100)  NOT NULL,
            email       VARCHAR(254)  NOT NULL,
            phone       VARCHAR(40)   NULL,
            adults      SMALLINT      NOT NULL,
            children    SMALLINT      NOT NULL DEFAULT 0,
            infants     SMALLINT      NOT NULL DEFAULT 0,
            notes       TEXT          NULL,
            lang        VARCHAR(5)    NOT NULL DEFAULT 'en',
            total_fee   INT           NOT NULL,
            currency    CHAR(3)       NOT NULL,
            status      ENUM('pending', 'paid', 'cancelled') NOT NULL DEFAULT 'pending',
            UNIQUE KEY uq_registrations_event_email (event_id, email),
            KEY idx_registrations_event (event_id, status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ],
];

const ER_DUP_ENTRY = 1062;

const REGISTRATION_COLUMNS = `id, created_at AS createdAt, event_id AS eventId, name, email, phone,
    adults, children, infants, notes, lang, total_fee AS totalFee, currency, status`;

const MESSAGE_COLUMNS = `id, created_at AS createdAt, name, email, subject, message, lang, handled`;

/** JS Date -> 'YYYY-MM-DD HH:MM:SS.mmm' in UTC (independent of the server's time zone). */
const toSqlDate = (date) => date.toISOString().slice(0, 23).replace('T', ' ');

/** 'YYYY-MM-DD HH:MM:SS.mmm' (UTC) -> ISO 8601, matching what the SQLite store returns. */
const toIso = (value) => (value ? `${String(value).replace(' ', 'T')}Z` : value);

const mapRow = (row) => (row ? { ...row, createdAt: toIso(row.createdAt) } : row);

async function migrate(pool) {
    const conn = await pool.getConnection();
    try {
        // Serialise migrations if several instances start at once.
        await conn.query("SELECT GET_LOCK('hunghanians_migrations', 30)");
        await conn.query(
            `CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INT UNSIGNED NOT NULL PRIMARY KEY,
                applied_at DATETIME(3)  NOT NULL
            ) ENGINE=InnoDB`,
        );
        const [rows] = await conn.query('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations');
        for (let v = Number(rows[0].v); v < MIGRATIONS.length; v++) {
            for (const statement of MIGRATIONS[v]) await conn.query(statement);
            await conn.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
                v + 1,
                toSqlDate(new Date()),
            ]);
        }
    } finally {
        await conn.query("SELECT RELEASE_LOCK('hunghanians_migrations')").catch(() => {});
        conn.release();
    }
}

/** Connects to MySQL, applies migrations and returns the store. */
export async function openMysql({ host, port, user, password, database, ssl }) {
    const pool = mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        ssl,
        charset: 'utf8mb4_unicode_ci',
        dateStrings: true,
        connectionLimit: 5,
        waitForConnections: true,
        enableKeepAlive: true,
    });

    await migrate(pool);

    const query = async (sql, params) => (await pool.execute(sql, params))[0];

    return {
        client: 'mysql',
        async ping() {
            await pool.query('SELECT 1');
        },
        close: () => pool.end(),

        async createMessage(msg) {
            const result = await query(
                `INSERT INTO messages (created_at, name, email, subject, message, lang)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [toSqlDate(new Date()), msg.name, msg.email, msg.subject, msg.message, msg.lang],
            );
            return result.insertId;
        },
        async listMessages() {
            const rows = await query(`SELECT ${MESSAGE_COLUMNS} FROM messages ORDER BY id DESC`);
            return rows.map(mapRow);
        },
        async setMessageHandled(id, handled) {
            const result = await query('UPDATE messages SET handled = ? WHERE id = ?', [handled ? 1 : 0, id]);
            return result.affectedRows > 0;
        },

        async createRegistration(reg) {
            let result;
            try {
                result = await query(
                    `INSERT INTO registrations
                        (created_at, event_id, name, email, phone, adults, children, infants, notes, lang, total_fee, currency)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        toSqlDate(new Date()), reg.eventId, reg.name, reg.email, reg.phone, reg.adults,
                        reg.children, reg.infants, reg.notes, reg.lang, reg.totalFee, reg.currency,
                    ],
                );
            } catch (err) {
                if (err.errno === ER_DUP_ENTRY) throw new DuplicateError();
                throw err;
            }
            return this.getRegistration(result.insertId);
        },
        async getRegistration(id) {
            const rows = await query(`SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = ?`, [id]);
            return mapRow(rows[0]);
        },
        async listRegistrations(eventId) {
            const rows = await query(
                `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE event_id = ? ORDER BY id`,
                [eventId],
            );
            return rows.map(mapRow);
        },
        async setRegistrationStatus(id, status) {
            const result = await query('UPDATE registrations SET status = ? WHERE id = ?', [status, id]);
            // affectedRows (not changedRows) so setting the same status again still counts as found.
            return result.affectedRows > 0;
        },
        async registrationSummary(eventId) {
            const rows = await query(
                `SELECT status,
                        COUNT(*)                    AS registrations,
                        COALESCE(SUM(adults), 0)    AS adults,
                        COALESCE(SUM(children), 0)  AS children,
                        COALESCE(SUM(infants), 0)   AS infants,
                        COALESCE(SUM(total_fee), 0) AS totalFee
                 FROM registrations WHERE event_id = ? GROUP BY status ORDER BY status`,
                [eventId],
            );
            // SUM() comes back as a DECIMAL string from MySQL.
            return rows.map((r) => ({
                status: r.status,
                registrations: Number(r.registrations),
                adults: Number(r.adults),
                children: Number(r.children),
                infants: Number(r.infants),
                totalFee: Number(r.totalFee),
            }));
        },
        async headcount(eventId) {
            const rows = await query(
                `SELECT COALESCE(SUM(adults + children + infants), 0) AS people
                 FROM registrations WHERE event_id = ? AND status != 'cancelled'`,
                [eventId],
            );
            return Number(rows[0].people);
        },
    };
}
