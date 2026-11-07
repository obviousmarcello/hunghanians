import path from 'node:path';
import express from 'express';
import { ROOT_DIR } from './config.js';
import { cors, INDEX_CSP, securityHeaders } from './middleware.js';
import { adminRoutes } from './routes/admin.js';
import { publicRoutes } from './routes/public.js';

/**
 * Builds the Express app. Dependencies are injected so tests can use an
 * in-memory database, a fake mailer and a fixed clock.
 */
export function createApp({ config, db, event, mailer, logger = console, now }) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.use(securityHeaders);

    // ---- API ----
    const api = express.Router();
    api.use(cors(config.corsOrigins));
    api.use(express.json({ limit: '20kb' }));
    api.use(express.urlencoded({ extended: false, limit: '20kb' }));
    api.use(publicRoutes({ db, event, mailer, config, logger, now }));
    api.use('/admin', adminRoutes({ db, event, config }));
    api.use((req, res) => res.status(404).json({ error: 'Not found' }));
    app.use('/api', api);

    // ---- Static site ----
    // Only the public parts of the repository are served (never server code, data or .git).
    const sendPage = (file, csp) => (req, res) => {
        if (csp) res.set('Content-Security-Policy', csp);
        res.sendFile(path.join(ROOT_DIR, file));
    };
    app.get(['/', '/index.html'], sendPage('index.html', INDEX_CSP));
    app.get('/gallery.html', sendPage('gallery.html', INDEX_CSP));
    app.get('/ghana_hungary_event.html', sendPage('ghana_hungary_event.html'));
    app.use(
        '/assets',
        express.static(path.join(ROOT_DIR, 'assets'), {
            maxAge: '7d',
            fallthrough: false,
            setHeaders(res, file) {
                // The photo list changes whenever photos are added; the photo files
                // themselves are named by content hash, so they can be cached for long.
                if (file.endsWith('.json')) res.set('Cache-Control', 'no-cache');
            },
        }),
    );

    app.use((req, res) => res.status(404).type('text').send('Not found'));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        const status = err.status || err.statusCode || 500;
        if (status >= 500 && !err.expose) logger.error(err);
        const message = err.expose
            ? err.message
            : status === 400
              ? 'Malformed request body.'
              : status >= 500
                ? 'Internal server error.'
                : err.message;
        if (req.path.startsWith('/api')) return res.status(status).json({ error: message });
        res.status(status).type('text').send(message);
    });

    return app;
}
