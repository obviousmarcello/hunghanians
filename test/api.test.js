import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { databaseConfig } from '../server/config.js';
import { openStorage } from '../server/storage/index.js';
import { calculateFee } from '../server/event.js';
import { toCsv } from '../server/routes/admin.js';

const ADMIN_TOKEN = 'test-admin-token-1234567890';

const baseEvent = () => ({
    id: 'test-event',
    name: { en: 'Test Event', hu: 'Teszt esemény' },
    location: 'Somewhere',
    startsAt: '2026-08-08T00:00:00+02:00',
    endsAt: '2026-08-10T00:00:00+02:00',
    currency: 'HUF',
    registration: { open: true, closesAt: '2026-08-01T00:00:00+02:00', capacity: null },
    pricing: [
        { until: '2026-03-31T23:59:59+02:00', adult: 10000, child: 5000, infant: 0 },
        { adult: 12000, child: 6000, infant: 0 },
    ],
});

const validRegistration = (overrides = {}) => ({
    name: 'Kofi Mensah',
    email: 'kofi@example.com',
    phone: '+36 30 123 4567',
    adults: 2,
    children: 1,
    infants: 1,
    notes: 'Vegetarian',
    consent: 'yes',
    lang: 'en',
    ...overrides,
});


/** Storage backends to run the API suite against. MySQL only runs when TEST_MYSQL_URL is set. */
const BACKENDS = [['SQLite', () => openStorage({ client: 'sqlite', path: ':memory:' })]];

if (process.env.TEST_MYSQL_URL) {
    const mysqlConfig = databaseConfig({ DATABASE_URL: process.env.TEST_MYSQL_URL });
    BACKENDS.push([
        'MySQL',
        async () => {
            // Start every test from an empty schema; this also exercises the migrations.
            const { default: mysql } = await import('mysql2/promise');
            const { host, port, user, password, database } = mysqlConfig;
            const conn = await mysql.createConnection({ host, port, user, password, database });
            await conn.query('DROP TABLE IF EXISTS messages, registrations, schema_migrations');
            await conn.end();
            return openStorage(mysqlConfig);
        },
    ]);
}

for (const [backendName, openDb] of BACKENDS) {
describe(`API (${backendName})`, () => {
    let server;
    let baseUrl;
    let db;
    let event;
    let sentMail;
    let clock;

    async function startServer(eventOverrides = {}, envOverrides = {}) {
        if (server) await new Promise((r) => server.close(r));
        await db?.close();

        event = { ...baseEvent(), ...eventOverrides };
        db = await openDb();
        sentMail = [];
        const config = loadConfig({ ADMIN_TOKEN, RATE_LIMIT_MAX: '100', ...envOverrides });
        const mailer = { enabled: true, send: async (mail) => sentMail.push(mail) };
        const logger = { info() {}, error() {} };
        const app = createApp({ config, db, event, mailer, logger, now: () => clock });

        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', resolve);
        });
        baseUrl = `http://127.0.0.1:${server.address().port}`;
    }

    function request(path, { method = 'GET', body, token, headers = {} } = {}) {
        return fetch(baseUrl + path, {
            method,
            headers: {
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }

    const flushMail = () => new Promise((r) => setImmediate(r));

    before(() => {
        clock = new Date('2026-03-01T12:00:00Z');
    });

    beforeEach(async () => {
        clock = new Date('2026-03-01T12:00:00Z');
        await startServer();
    });

    after(async () => {
        await new Promise((r) => server.close(r));
        await db.close();
        server = undefined;
        db = undefined;
    });

    describe('static site', () => {
        test('serves index.html with a CSP', async () => {
            const res = await request('/');
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
            assert.match(await res.text(), /Akwaaba/);
        });

        test('serves the gallery page and an uncached photo list', async () => {
            const page = await request('/gallery.html');
            assert.equal(page.status, 200);
            assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
            const list = await request('/assets/data/gallery.json');
            assert.equal(list.status, 200);
            assert.equal(list.headers.get('cache-control'), 'no-cache');
            assert.ok(Array.isArray((await list.json()).photos));
        });

        test('serves assets', async () => {
            const res = await request('/assets/js/main.js');
            assert.equal(res.status, 200);
        });

        test('does not expose server code, data or dotfiles', async () => {
            for (const path of ['/server/app.js', '/package.json', '/data/hunghanians.db', '/.git/config', '/assets/../server/app.js']) {
                const res = await request(path);
                assert.equal(res.status, 404, path);
            }
        });
    });

    describe('GET /api/event', () => {
        test('returns public event info with current prices', async () => {
            const res = await request('/api/event');
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.id, 'test-event');
            assert.equal(body.registrationOpen, true);
            assert.deepEqual(body.prices, { adult: 10000, child: 5000, infant: 0, validUntil: '2026-03-31T23:59:59+02:00' });
        });

        test('reports registration closed after the deadline', async () => {
            clock = new Date('2026-08-05T00:00:00Z');
            const body = await (await request('/api/event')).json();
            assert.equal(body.registrationOpen, false);
            assert.equal(body.registrationClosedReason, 'deadline_passed');
            assert.equal(body.prices.adult, 12000);
        });
    });

    describe('POST /api/contact', () => {
        const message = { name: 'Ama', email: 'Ama@Example.com', subject: 'Hello', message: 'Akwaaba!' };

        test('stores the message and notifies the organisers', async () => {
            const res = await request('/api/contact', { method: 'POST', body: message });
            assert.equal(res.status, 201);
            const [stored] = (await db.listMessages());
            assert.equal(stored.email, 'ama@example.com');
            await flushMail();
            assert.equal(sentMail.length, 1);
            assert.equal(sentMail[0].replyTo, 'ama@example.com');
        });

        test('accepts form-encoded bodies', async () => {
            const res = await fetch(`${baseUrl}/api/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(message),
            });
            assert.equal(res.status, 201);
        });

        test('rejects invalid input with field errors', async () => {
            const res = await request('/api/contact', { method: 'POST', body: { ...message, email: 'nope' } });
            assert.equal(res.status, 400);
            const body = await res.json();
            assert.ok(body.fields.email);
            assert.equal((await db.listMessages()).length, 0);
        });

        test('rejects malformed JSON', async () => {
            const res = await fetch(`${baseUrl}/api/contact`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{not json',
            });
            assert.equal(res.status, 400);
        });

        test('silently drops honeypot submissions', async () => {
            const res = await request('/api/contact', { method: 'POST', body: { ...message, website: 'http://spam' } });
            assert.equal(res.status, 201);
            assert.equal((await db.listMessages()).length, 0);
        });

        test('rate limits by IP', async () => {
            await startServer({}, { RATE_LIMIT_MAX: '2' });
            for (let i = 0; i < 2; i++) {
                assert.equal((await request('/api/contact', { method: 'POST', body: message })).status, 201);
            }
            const res = await request('/api/contact', { method: 'POST', body: message });
            assert.equal(res.status, 429);
            assert.ok(res.headers.get('retry-after'));
        });
    });

    describe('POST /api/registrations', () => {
        test('creates a registration with the earlybird fee and sends emails', async () => {
            const res = await request('/api/registrations', { method: 'POST', body: validRegistration() });
            assert.equal(res.status, 201);
            const body = await res.json();
            assert.equal(body.totalFee, 2 * 10000 + 5000);
            assert.equal(body.currency, 'HUF');

            await flushMail();
            const recipients = sentMail.map((m) => m.to).sort();
            assert.deepEqual(recipients, ['hunghanians@gmail.com', 'kofi@example.com']);
        });

        test('uses the regular price after the earlybird deadline', async () => {
            clock = new Date('2026-04-15T12:00:00Z');
            const body = await (await request('/api/registrations', { method: 'POST', body: validRegistration() })).json();
            assert.equal(body.totalFee, 2 * 12000 + 6000);
        });

        test('sends the confirmation in Hungarian when lang=hu', async () => {
            await request('/api/registrations', { method: 'POST', body: validRegistration({ lang: 'hu' }) });
            await flushMail();
            const confirmation = sentMail.find((m) => m.to === 'kofi@example.com');
            assert.match(confirmation.text, /Kedves Kofi Mensah/);
        });

        test('requires consent', async () => {
            const res = await request('/api/registrations', { method: 'POST', body: validRegistration({ consent: undefined }) });
            assert.equal(res.status, 400);
            assert.ok((await res.json()).fields.consent);
        });

        test('validates attendee counts', async () => {
            for (const bad of [{ adults: 0 }, { adults: 1.5 }, { children: -1 }, { adults: 'many' }]) {
                const res = await request('/api/registrations', { method: 'POST', body: validRegistration(bad) });
                assert.equal(res.status, 400, JSON.stringify(bad));
            }
        });

        test('rejects duplicate emails (case-insensitive)', async () => {
            await request('/api/registrations', { method: 'POST', body: validRegistration() });
            const res = await request('/api/registrations', {
                method: 'POST',
                body: validRegistration({ email: 'KOFI@example.com' }),
            });
            assert.equal(res.status, 409);
            assert.equal((await res.json()).reason, 'duplicate');
        });

        test('allows only one of two simultaneous registrations with the same email', async () => {
            const [a, b] = await Promise.all([
                request('/api/registrations', { method: 'POST', body: validRegistration() }),
                request('/api/registrations', { method: 'POST', body: validRegistration() }),
            ]);
            assert.deepEqual([a.status, b.status].sort(), [201, 409]);
            assert.equal((await db.listRegistrations(event.id)).length, 1);
        });

        test('health check reports the database', async () => {
            const res = await request('/api/health');
            assert.equal(res.status, 200);
            assert.equal((await res.json()).status, 'ok');
        });

        test('rejects registrations after the deadline', async () => {
            clock = new Date('2026-08-02T00:00:00Z');
            const res = await request('/api/registrations', { method: 'POST', body: validRegistration() });
            assert.equal(res.status, 409);
            assert.equal((await res.json()).reason, 'deadline_passed');
        });

        test('enforces capacity', async () => {
            await startServer({ registration: { open: true, capacity: 5 } });
            assert.equal((await request('/api/registrations', { method: 'POST', body: validRegistration() })).status, 201);
            // 4 people registered, 1 spot left; a party of 2 must be refused.
            const res = await request('/api/registrations', {
                method: 'POST',
                body: validRegistration({ email: 'other@example.com', adults: 2, children: 0, infants: 0 }),
            });
            assert.equal(res.status, 409);
            assert.equal((await res.json()).reason, 'full');
        });
    });

    describe('admin API', () => {
        test('is disabled without ADMIN_TOKEN', async () => {
            await startServer({}, { ADMIN_TOKEN: '' });
            assert.equal((await request('/api/admin/summary', { token: 'anything' })).status, 404);
        });

        test('requires the correct token', async () => {
            assert.equal((await request('/api/admin/summary')).status, 401);
            assert.equal((await request('/api/admin/summary', { token: 'wrong-token-wrong-token' })).status, 401);
            assert.equal((await request('/api/admin/summary', { token: ADMIN_TOKEN })).status, 200);
        });

        test('lists registrations, updates status and summarises', async () => {
            await request('/api/registrations', { method: 'POST', body: validRegistration() });
            await request('/api/registrations', {
                method: 'POST',
                body: validRegistration({ email: 'efua@example.com', adults: 1, children: 0, infants: 0 }),
            });

            const list = await (await request('/api/admin/registrations', { token: ADMIN_TOKEN })).json();
            assert.equal(list.length, 2);
            assert.equal(list[0].status, 'pending');

            const patched = await request(`/api/admin/registrations/${list[0].id}`, {
                method: 'PATCH',
                token: ADMIN_TOKEN,
                body: { status: 'paid' },
            });
            assert.equal(patched.status, 200);
            assert.equal((await patched.json()).status, 'paid');

            const bad = await request(`/api/admin/registrations/${list[0].id}`, {
                method: 'PATCH',
                token: ADMIN_TOKEN,
                body: { status: 'refunded' },
            });
            assert.equal(bad.status, 400);

            const summary = await (await request('/api/admin/summary', { token: ADMIN_TOKEN })).json();
            assert.equal(summary.expected.people, 5);
            assert.equal(summary.paidTotal, 25000);
            assert.equal(summary.outstandingTotal, 10000);
        });

        test('exports registrations as CSV', async () => {
            await request('/api/registrations', { method: 'POST', body: validRegistration({ notes: '=HYPERLINK("x")' }) });
            const res = await request('/api/admin/registrations?format=csv', { token: ADMIN_TOKEN });
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /text\/csv/);
            const bytes = Buffer.from(await res.arrayBuffer());
            assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM so Excel reads accents');
            const text = bytes.subarray(3).toString('utf8');
            assert.match(text, /^id,createdAt,name/);
            assert.match(text, /"'=HYPERLINK\(""x""\)"/);
        });

        test('lists messages and marks them handled', async () => {
            await request('/api/contact', {
                method: 'POST',
                body: { name: 'Ama', email: 'ama@example.com', subject: 'Hi', message: 'Hello' },
            });
            const [msg] = await (await request('/api/admin/messages', { token: ADMIN_TOKEN })).json();
            assert.equal(msg.handled, 0);
            const res = await request(`/api/admin/messages/${msg.id}`, { method: 'PATCH', token: ADMIN_TOKEN, body: { handled: true } });
            assert.equal(res.status, 200);
            assert.equal((await db.listMessages())[0].handled, 1);
        });
    });
});
}

describe('database configuration', () => {
    test('defaults to a local SQLite file', () => {
        assert.equal(databaseConfig({}).client, 'sqlite');
        assert.equal(databaseConfig({ DATABASE_PATH: '/tmp/x.db' }).path, '/tmp/x.db');
    });

    test('parses DATABASE_URL, including encoded credentials', () => {
        const cfg = databaseConfig({ DATABASE_URL: 'mysql://user%40x:p%23ss@db.example.com:3307/hh' });
        assert.deepEqual(
            { client: cfg.client, host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database },
            { client: 'mysql', host: 'db.example.com', port: 3307, user: 'user@x', password: 'p#ss', database: 'hh' },
        );
    });

    test('rejects a non-MySQL DATABASE_URL', () => {
        assert.throws(() => databaseConfig({ DATABASE_URL: 'postgres://u:p@h/db' }), /mysql:\/\//);
    });

    test('accepts the common MySQL variable names and reports which were used', () => {
        const cfg = databaseConfig({ DB_HOST: 'h', DB_USERNAME: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' });
        assert.equal(cfg.client, 'mysql');
        assert.equal(cfg.port, 3306);
        assert.deepEqual(cfg.source, ['DB_HOST', 'DB_USERNAME', 'DB_PASSWORD', 'DB_NAME']);
    });

    test('explains which variables are missing', () => {
        assert.throws(() => databaseConfig({ MYSQL_HOST: 'h', MYSQL_USER: 'u' }), /MYSQL_DATABASE/);
    });
});

describe('helpers', () => {
    test('calculateFee picks the tier valid at the given time', () => {
        const ev = baseEvent();
        const party = { adults: 1, children: 2, infants: 1 };
        assert.equal(calculateFee(ev, party, new Date('2026-03-31T21:00:00Z')), 20000);
        assert.equal(calculateFee(ev, party, new Date('2026-04-01T00:00:00Z')), 24000);
    });

    test('toCsv escapes quotes, commas and newlines', () => {
        const csv = toCsv([{ a: 'x,y', b: 'say "hi"\nthere' }], ['a', 'b']);
        assert.equal(csv, '﻿a,b\r\n"x,y","say ""hi""\nthere"\r\n');
    });
});
