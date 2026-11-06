import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { loadEvent } from './event.js';
import { createMailer } from './mailer.js';
import { openStorage } from './storage/index.js';

async function start() {
    const config = loadConfig();
    const event = loadEvent(config.eventConfigPath);
    const mailer = createMailer(config.smtp);

    const { database } = config;
    if (database.client === 'mysql') {
        // Only variable names are logged, never values.
        console.info(
            `Database: MySQL at ${database.host}:${database.port}/${database.database} (from ${database.source.join(', ')})`,
        );
    } else {
        console.info(`Database: SQLite file ${database.path}`);
    }

    const db = await openStorage(database);
    const app = createApp({ config, db, event, mailer });

    const server = app.listen(config.port, config.host, () => {
        console.info(`Hunghanians server listening on http://${config.host}:${config.port}`);
        console.info(`Event: ${event.id} | email: ${mailer.enabled ? 'SMTP' : 'disabled (logging only)'}`);
        if (!config.adminToken) console.info('Admin API disabled (set ADMIN_TOKEN, at least 16 characters, to enable it).');
        if (!config.trustProxy) console.info('TRUST_PROXY is 0: set TRUST_PROXY=1 when running behind a hosting proxy.');
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
}

start().catch((err) => {
    // Exit non-zero so the hosting platform restarts the app and shows the error in its logs.
    console.error('Failed to start:', err.message);
    process.exit(1);
});
