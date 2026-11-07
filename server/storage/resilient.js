/**
 * Wraps the real store so the web server never depends on the database being
 * reachable at startup: it connects in the background, retrying with
 * increasing delays, and until then every storage call fails with a 503
 * (the site itself keeps working, and the page falls back to Formspree and
 * the Google Form).
 */

export class ServiceUnavailableError extends Error {
    constructor() {
        super('The service is temporarily unavailable. Please try again in a few minutes.');
        this.name = 'ServiceUnavailableError';
        this.status = 503;
        this.expose = true;
    }
}

const METHODS = [
    'ping',
    'createMessage',
    'listMessages',
    'setMessageHandled',
    'createRegistration',
    'getRegistration',
    'listRegistrations',
    'setRegistrationStatus',
    'registrationSummary',
    'headcount',
];

const DEFAULT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

/**
 * @param {() => Promise<object>} open   opens the real store (may throw)
 * @param {object} options
 * @param {string} [options.configError] a configuration problem: logged, never retried
 */
export function createResilientStorage(open, { logger = console, delaysMs = DEFAULT_DELAYS_MS, configError } = {}) {
    let current = null;
    let stopped = false;
    let timer = null;
    let attempt = 0;

    const store = {
        get client() {
            return current?.client ?? 'unavailable';
        },
        get ready() {
            return current !== null;
        },

        /** Connects in the background; resolves once connected (or when stopped). */
        start() {
            if (configError) {
                logger.error(`Database settings are invalid: ${configError}`);
                logger.error('The website is running, but contact messages and registrations are disabled until this is fixed.');
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                const tryOpen = async () => {
                    if (stopped) return resolve();
                    attempt++;
                    try {
                        current = await open();
                        if (stopped) await current.close().catch(() => {});
                        else logger.info(`Database connected${attempt > 1 ? ` after ${attempt} attempts` : ''}.`);
                        resolve();
                    } catch (err) {
                        const delay = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)];
                        logger.error(
                            `Database connection failed (attempt ${attempt}): ${err.message}. Retrying in ${Math.round(delay / 1000)}s.`,
                        );
                        timer = setTimeout(tryOpen, delay);
                        timer.unref?.();
                    }
                };
                tryOpen();
            });
        },

        async close() {
            stopped = true;
            clearTimeout(timer);
            await current?.close();
        },
    };

    for (const method of METHODS) {
        store[method] = (...args) => {
            if (!current) return Promise.reject(new ServiceUnavailableError());
            return current[method](...args);
        };
    }
    return store;
}
