import { Router } from 'express';
import { calculateFee, publicEvent, registrationClosedReason } from '../event.js';
import {
    contactNotification,
    registrationConfirmation,
    registrationNotification,
    sendInBackground,
} from '../mailer.js';
import { rateLimit } from '../middleware.js';
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

    router.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });

    router.get('/event', (req, res) => {
        res.set('Cache-Control', 'no-cache');
        res.json(publicEvent(event, db.headcount(event.id), now()));
    });

    router.post('/contact', limiter, (req, res) => {
        const body = req.body ?? {};
        // Pretend success so bots don't learn they were caught.
        if (isSpam(body)) return res.status(201).json({ ok: true });

        const { value, errors } = validateContact(body);
        if (Object.keys(errors).length) return badRequest(res, errors);

        const id = db.createMessage(value);
        sendInBackground(mailer, contactNotification(value, config.organizerEmail), logger);
        res.status(201).json({ ok: true, id });
    });

    router.post('/registrations', limiter, (req, res) => {
        const body = req.body ?? {};
        if (isSpam(body)) return res.status(201).json({ ok: true });

        const { value, errors } = validateRegistration(body);
        if (Object.keys(errors).length) return badRequest(res, errors);

        const at = now();
        const headcount = db.headcount(event.id);
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

        if (db.registrationExists(event.id, value.email)) {
            return res.status(409).json({
                error: 'This email address is already registered. Please contact us if you need to change your registration.',
                reason: 'duplicate',
            });
        }

        const registration = db.createRegistration({
            ...value,
            eventId: event.id,
            totalFee: calculateFee(event, value, at),
            currency: event.currency,
        });

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
