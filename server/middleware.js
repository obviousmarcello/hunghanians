import crypto from 'node:crypto';

/** Simple fixed-window, in-memory rate limiter keyed by client IP. Good enough for a single instance. */
export function rateLimit({ windowMs, max }) {
    const hits = new Map();

    const sweep = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    }, windowMs);
    sweep.unref();

    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip;
        let entry = hits.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(key, entry);
        }
        entry.count += 1;
        if (entry.count > max) {
            res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
        next();
    };
}

/** Requires `Authorization: Bearer <ADMIN_TOKEN>`. Responds 404 when no token is configured. */
export function requireAdmin(adminToken) {
    const expected = adminToken ? crypto.createHash('sha256').update(adminToken).digest() : null;

    return (req, res, next) => {
        if (!expected) return res.status(404).json({ error: 'Not found' });
        const match = /^Bearer (.+)$/.exec(req.get('authorization') || '');
        const given = crypto.createHash('sha256').update(match ? match[1] : '').digest();
        if (!match || !crypto.timingSafeEqual(given, expected)) {
            res.set('WWW-Authenticate', 'Bearer');
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    };
}

export function securityHeaders(req, res, next) {
    res.set({
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
}

/** Content Security Policy for the main page (it has no inline scripts or styles). */
export const INDEX_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data:",
    'frame-src https://www.google.com',
    "connect-src 'self' https://formspree.io",
    "form-action 'self' https://formspree.io",
    "base-uri 'self'",
    "frame-ancestors 'self'",
].join('; ');

export function cors(allowedOrigins) {
    const allowed = new Set(allowedOrigins);
    return (req, res, next) => {
        const origin = req.get('origin');
        if (origin && allowed.has(origin)) {
            res.set({
                'Access-Control-Allow-Origin': origin,
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                Vary: 'Origin',
            });
        }
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    };
}
