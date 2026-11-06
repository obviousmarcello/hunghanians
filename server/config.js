import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function intFromEnv(value, fallback) {
    const n = Number.parseInt(value ?? '', 10);
    return Number.isFinite(n) ? n : fallback;
}

/** Reads runtime configuration from environment variables (see .env.example). */
export function loadConfig(env = process.env) {
    return {
        port: intFromEnv(env.PORT, 3000),
        host: env.HOST || '0.0.0.0',
        // Number of reverse proxies in front of the app (for correct client IPs in rate limiting).
        trustProxy: intFromEnv(env.TRUST_PROXY, 0),
        databasePath: env.DATABASE_PATH || path.join(ROOT_DIR, 'data', 'hunghanians.db'),
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
