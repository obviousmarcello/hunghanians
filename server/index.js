import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig, ROOT_DIR } from './config.js';
import { loadEvent } from './event.js';
import { createMailer } from './mailer.js';
import { createResilientStorage, openStorage } from './storage/index.js';

// Make any crash visible in the host's logs with a clear message.
process.on('unhandledRejection', (err) => {
    console.error('Unhandled promise rejection:', err);
});
process.on('uncaughtException', (err) => {
    console.error('Fatal error, exiting:', err);
    process.exit(1);
});

// Load .env here rather than with `node --env-file-if-exists`, which only exists from Node 22.9:
// on an older Node 22 that flag stops the process before the app even starts.
// Variables already set by the host take precedence over the file.
const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const event = loadEvent(config.eventConfigPath);
const mailer = createMailer(config.smtp);

const { database } = config;
if (database.client === 'mysql') {
    // Only variable names are logged, never values.
    console.info(`Database: MySQL at ${database.host}:${database.port}/${database.database} (from ${database.source.join(', ')})`);
} else if (database.client === 'sqlite') {
    console.info(`Database: SQLite file ${database.path}`);
}

// The website starts immediately; the database connects in the background and is retried
// until it works, so a database problem never takes the whole site down.
const db = createResilientStorage(() => openStorage(database), {
    configError: database.client === 'invalid' ? database.error : undefined,
});
const app = createApp({ config, db, event, mailer });

const server = typeof config.port === 'number' ? app.listen(config.port, config.host) : app.listen(config.port);

server.on('listening', () => {
    const where = typeof config.port === 'number' ? `http://${config.host}:${config.port}` : config.port;
    console.info(`Hunghanians server listening on ${where} (Node ${process.version})`);
    console.info(`Event: ${event.id} | email: ${mailer.enabled ? 'SMTP' : 'disabled (logging only)'}`);
    if (!config.adminToken) console.info('Admin API disabled (set ADMIN_TOKEN, at least 16 characters, to enable it).');
    if (!config.trustProxy) console.info('TRUST_PROXY is 0: set TRUST_PROXY=1 when running behind a hosting proxy.');
    db.start();
});

server.on('error', (err) => {
    console.error(`Could not start the web server on ${config.port}: ${err.message}`);
    process.exit(1);
});

const shutdown = (signal) => {
    console.info(`${signal} received, shutting down`);
    server.close(async () => {
        await db.close().catch(() => {});
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
