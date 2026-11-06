import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { loadEvent } from './event.js';
import { createMailer } from './mailer.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const event = loadEvent(config.eventConfigPath);
const mailer = createMailer(config.smtp);

const app = createApp({ config, db, event, mailer });

const server = app.listen(config.port, config.host, () => {
    console.info(`Hunghanians server listening on http://${config.host}:${config.port}`);
    console.info(`Event: ${event.id} | database: ${config.databasePath} | email: ${mailer.enabled ? 'SMTP' : 'disabled (logging only)'}`);
    if (!config.adminToken) console.info('Admin API disabled (set ADMIN_TOKEN, at least 16 characters, to enable it).');
});

function shutdown(signal) {
    console.info(`${signal} received, shutting down`);
    server.close(() => {
        db.close();
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
