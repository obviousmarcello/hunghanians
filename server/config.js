import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function intFromEnv(value, fallback) {
    const n = Number.parseInt(value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
}

/** Returns the value and name of the first environment variable in `names` that is set. */
function firstEnv(env, names) {
    for (const name of names) {
        if (env[name] != null && env[name] !== '') return { name, value: env[name] };
    }
    return null;
}

/**
 * MySQL is used when DATABASE_URL (mysql://user:pass@host:port/db) or a MySQL host
 * variable is set; otherwise a local SQLite file. Several common variable names are
 * accepted because hosting providers differ (e.g. GoDaddy injects the credentials of
 * its managed database as environment variables).
 */
const MYSQL_ENV = {
    host: ['MYSQL_HOST', 'DB_HOST', 'DATABASE_HOST'],
    port: ['MYSQL_PORT', 'DB_PORT', 'DATABASE_PORT'],
    user: ['MYSQL_USER', 'MYSQL_USERNAME', 'DB_USER', 'DB_USERNAME', 'DATABASE_USER', 'DATABASE_USERNAME'],
    password: ['MYSQL_PASSWORD', 'DB_PASSWORD', 'DB_PASS', 'DATABASE_PASSWORD'],
    database: ['MYSQL_DATABASE', 'MYSQL_DB', 'DB_NAME', 'DB_DATABASE', 'DATABASE_NAME'],
};

export function databaseConfig(env = process.env) {
    const ssl = env.DB_SSL === 'true' ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined;

    if (env.DATABASE_URL) {
        let url;
        try {
            url = new URL(env.DATABASE_URL);
        } catch {
            throw new Error('DATABASE_URL is not a valid URL');
        }
        if (url.protocol !== 'mysql:') {
            throw new Error(`DATABASE_URL must start with mysql:// (got ${url.protocol}//)`);
        }
        return {
            client: 'mysql',
            host: url.hostname,
            port: url.port ? Number(url.port) : 3306,
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
            database: decodeURIComponent(url.pathname.slice(1)),
            ssl,
            source: ['DATABASE_URL'],
        };
    }

    const host = firstEnv(env, MYSQL_ENV.host);
    if (host) {
        const found = Object.fromEntries(
            Object.entries(MYSQL_ENV).map(([key, names]) => [key, firstEnv(env, names)]),
        );
        const missing = ['user', 'database'].filter((key) => !found[key]);
        if (missing.length) {
            throw new Error(
                `MySQL host is set (${host.name}) but ${missing.map((k) => MYSQL_ENV[k].join('/')).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing`,
            );
        }
        return {
            client: 'mysql',
            host: host.value,
            port: found.port ? Number(found.port.value) : 3306,
            user: found.user.value,
            password: found.password?.value ?? '',
            database: found.database.value,
            ssl,
            source: Object.values(found).filter(Boolean).map((f) => f.name),
        };
    }

    return {
        client: 'sqlite',
        path: env.DATABASE_PATH || path.join(ROOT_DIR, 'data', 'hunghanians.db'),
    };
}

/** Like databaseConfig, but returns the problem instead of throwing, so the site can still start. */
function safeDatabaseConfig(env) {
    try {
        return databaseConfig(env);
    } catch (err) {
        return { client: 'invalid', error: err.message };
    }
}

/** Reads runtime configuration from environment variables (see .env.example). */
export function loadConfig(env = process.env) {
    return {
        // Usually a number; some hosts pass a socket or pipe path instead.
        port: !env.PORT ? 3000 : /^\d+$/.test(env.PORT) ? Number(env.PORT) : env.PORT,
        host: env.HOST || '0.0.0.0',
        // Number of reverse proxies in front of the app (for correct client IPs in rate limiting).
        trustProxy: intFromEnv(env.TRUST_PROXY, 0),
        database: safeDatabaseConfig(env),
        eventConfigPath: env.EVENT_CONFIG_PATH || path.join(ROOT_DIR, 'server', 'event.json'),
        // Admin API is disabled unless a token of reasonable length is set.
        adminToken: env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 16 ? env.ADMIN_TOKEN : null,
        organizerEmail: env.ORGANIZER_EMAIL || 'hunghanians@gmail.com',
        // Comma-separated list of origins allowed to call the API cross-origin
        // (e.g. https://hunghanians.hu when the API runs on a separate host).
        corsOrigins: (env.CORS_ORIGINS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        smtp: env.SMTP_HOST
            ? {
                  host: env.SMTP_HOST,
                  port: intFromEnv(env.SMTP_PORT, 587),
                  secure: env.SMTP_SECURE === 'true',
                  user: env.SMTP_USER,
                  pass: env.SMTP_PASS,
                  from: env.MAIL_FROM || env.SMTP_USER,
              }
            : null,
        rateLimit: {
            windowMs: intFromEnv(env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
            max: intFromEnv(env.RATE_LIMIT_MAX, 10),
        },
    };
}
