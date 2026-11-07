import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { loadEvent } from '../server/event.js';
import { createResilientStorage, openStorage, ServiceUnavailableError } from '../server/storage/index.js';

const quietLogger = () => {
    const lines = [];
    return { lines, info: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) };
};

describe('database connection at startup', () => {
    test('retries until the database is reachable, failing calls with 503 meanwhile', async () => {
        let attempts = 0;
        const logger = quietLogger();
        const db = createResilientStorage(
            async () => {
                attempts++;
                if (attempts < 3) throw new Error('connect ECONNREFUSED');
                return openStorage({ client: 'sqlite', path: ':memory:' });
            },
            { logger, delaysMs: [5, 5] },
        );

        await assert.rejects(db.headcount('x'), ServiceUnavailableError);
        assert.equal(db.client, 'unavailable');

        await db.start();
        assert.equal(attempts, 3);
        assert.equal(db.ready, true);
        assert.equal(db.client, 'sqlite');
        assert.equal(await db.headcount('x'), 0);
        assert.match(logger.lines.join('\n'), /attempt 1\): connect ECONNREFUSED\. Retrying/);
        await db.close();
    });

    test('a settings error is reported once and never retried', async () => {
        let attempts = 0;
        const logger = quietLogger();
        const db = createResilientStorage(async () => attempts++, { logger, configError: 'MYSQL_USER is missing' });
        await db.start();
        assert.equal(attempts, 0);
        assert.match(logger.lines[0], /Database settings are invalid: MYSQL_USER is missing/);
        await assert.rejects(db.ping(), ServiceUnavailableError);
    });

    test('loadConfig does not throw on bad database settings', () => {
        const config = loadConfig({ MYSQL_HOST: 'db.example.com' });
        assert.equal(config.database.client, 'invalid');
        assert.match(config.database.error, /MYSQL_USER/);
    });

    test('PORT may be a socket or pipe path', () => {
        assert.equal(loadConfig({ PORT: '8080' }).port, 8080);
        assert.equal(loadConfig({ PORT: '/tmp/app.sock' }).port, '/tmp/app.sock');
        assert.equal(loadConfig({}).port, 3000);
    });
});

describe('site while the database is unavailable', () => {
    const db = createResilientStorage(async () => {
        throw new Error('down');
    });
    const app = createApp({
        config: loadConfig({}),
        db,
        event: loadEvent(new URL('../server/event.json', import.meta.url).pathname),
        mailer: { enabled: false, send: async () => {} },
        logger: quietLogger(),
    });
    const server = app.listen(0, '127.0.0.1');
    const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;
    after(() => new Promise((r) => server.close(r)));

    test('the website still loads', async () => {
        assert.equal((await fetch(url('/'))).status, 200);
        assert.equal((await fetch(url('/gallery.html'))).status, 200);
    });

    test('the API answers 503 with a readable message', async () => {
        const res = await fetch(url('/api/event'));
        assert.equal(res.status, 503);
        assert.match((await res.json()).error, /temporarily unavailable/);

        const contact = await fetch(url('/api/contact'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'A', email: 'a@example.com', subject: 's', message: 'm' }),
        });
        assert.equal(contact.status, 503);
    });

    test('the health check reports the problem', async () => {
        const res = await fetch(url('/api/health'));
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { status: 'error', database: 'unavailable' });
    });
});
