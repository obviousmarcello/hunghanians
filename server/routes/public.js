import { Router } from 'express';
import { calculateFee, publicEvent, registrationClosedReason } from '../event.js';
import {
    contactNotification,
    registrationConfirmation,
    registrationNotification,
    sendInBackground,
} from '../mailer.js';
import { rateLimit } from '../middleware.js';
import { DuplicateError } from '../storage/index.js';
import { isSpam, validateContact, validateRegistration } from '../validation.js';

const CLOSED_MESSAGES = {
    closed: 'Registration is currently closed.',
    deadline_passed: 'The registration deadline has passed.',
    full: 'Sorry, the event is fully booked.',
};

function badRequest(res, errors) {
    const first = Object.values(errors)[0];
    return res.status(400).json({ error: first || 'Invalid request.', fields: errors });
}

export function publicRoutes({ db, event, mailer, config, logger, now = () => new Date() }) {
    const router = Router();
    const limiter = rateLimit(config.rateLimit);

    // Also checks the database, so hosting health checks notice a lost connection.
    router.get('/health', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            await db.ping();
            res.json({ status: 'ok', database: db.client });
        } catch (err) {
            logger.error('Health check failed:', err.message);
            res.status(503).json({ status: 'error', database: db.client });
        }
    });

    router.get('/event', async (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.json(publicEvent(event, await db.headcount(event.id), now()));
    });

    router.post('/contact', limiter, async (req, res) => {
        const body = req.body ?? {};
        // Pretend success so bots don't learn they were caught.
        if (isSpam(body)) return res.status(201).json({ ok: true });

        const { value, errors } = validateContact(body);
        if (Object.keys(errors).length) return badRequest(res, errors);

        const id = await db.createMessage(value);
        sendInBackground(mailer, contactNotification(value, config.organizerEmail), logger);
        res.status(201).json({ ok: true, id });
    });

    router.post('/registrations', limiter, async (req, res) => {
        const body = req.body ?? {};
        if (isSpam(body)) return res.status(201).json({ ok: true });

        const { value, errors } = validateRegistration(body);
        if (Object.keys(errors).length) return badRequest(res, errors);

        const at = now();
        const headcount = await db.headcount(event.id);
        const closed = registrationClosedReason(event, headcount, at);
        if (closed) return res.status(409).json({ error: CLOSED_MESSAGES[closed], reason: closed });

        const capacity = event.registration?.capacity;
        const people = value.adults + value.children + value.infants;
        if (capacity != null && headcount + people > capacity) {
            return res.status(409).json({
                error: `Sorry, only ${capacity - headcount} spot(s) are left.`,
                reason: 'full',
            });
        }

        let registration;
        try {
            registration = await db.createRegistration({
                ...value,
                eventId: event.id,
                totalFee: calculateFee(event, value, at),
                currency: event.currency,
            });
        } catch (err) {
            if (!(err instanceof DuplicateError)) throw err;
            return res.status(409).json({
                error: 'This email address is already registered. Please contact us if you need to change your registration.',
                reason: 'duplicate',
            });
        }

        sendInBackground(mailer, registrationNotification(registration, event, config.organizerEmail), logger);
        sendInBackground(mailer, registrationConfirmation(registration, event, config.organizerEmail), logger);

        res.status(201).json({
            ok: true,
            id: registration.id,
            totalFee: registration.totalFee,
            currency: registration.currency,
        });
    });

    return router;
}
