import { Router } from 'express';
import { requireAdmin } from '../middleware.js';

const STATUSES = new Set(['pending', 'paid', 'cancelled']);

const REGISTRATION_CSV_COLUMNS = [
    'id', 'createdAt', 'name', 'email', 'phone', 'adults', 'children', 'infants',
    'notes', 'lang', 'totalFee', 'currency', 'status',
];

function csvCell(value) {
    if (value == null) return '';
    let s = String(value);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
    const lines = [columns.join(',')];
    for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
    // BOM so Excel opens UTF-8 (Hungarian accents) correctly.
    return `﻿${lines.join('\r\n')}\r\n`;
}

function parseId(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: 'Invalid id' });
        return null;
    }
    return id;
}

/**
 * Admin API, protected by the ADMIN_TOKEN bearer token. Examples:
 *
 *   curl -H "Authorization: Bearer $ADMIN_TOKEN" https://hunghanians.hu/api/admin/summary
 *   curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://hunghanians.hu/api/admin/registrations?format=csv" -o registrations.csv
 *   curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
 *        -d '{"status":"paid"}' https://hunghanians.hu/api/admin/registrations/12
 */
export function adminRoutes({ db, event, config }) {
    const router = Router();
    router.use(requireAdmin(config.adminToken));
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });

    router.get('/summary', (req, res) => {
        const byStatus = db.registrationSummary(event.id);
        const active = byStatus.filter((r) => r.status !== 'cancelled');
        const sum = (rows, key) => rows.reduce((acc, r) => acc + r[key], 0);
        res.json({
            eventId: event.id,
            byStatus,
            expected: {
                registrations: sum(active, 'registrations'),
                adults: sum(active, 'adults'),
                children: sum(active, 'children'),
                infants: sum(active, 'infants'),
                people: sum(active, 'adults') + sum(active, 'children') + sum(active, 'infants'),
            },
            paidTotal: sum(byStatus.filter((r) => r.status === 'paid'), 'totalFee'),
            outstandingTotal: sum(byStatus.filter((r) => r.status === 'pending'), 'totalFee'),
            currency: event.currency,
        });
    });

    router.get('/registrations', (req, res) => {
        const rows = db.listRegistrations(event.id);
        if (req.query.format === 'csv') {
            res.set('Content-Type', 'text/csv; charset=utf-8');
            res.set('Content-Disposition', `attachment; filename="${event.id}-registrations.csv"`);
            return res.send(toCsv(rows, REGISTRATION_CSV_COLUMNS));
        }
        res.json(rows);
    });

    router.patch('/registrations/:id', (req, res) => {
        const id = parseId(req, res);
        if (id === null) return;
        const status = req.body?.status;
        if (!STATUSES.has(status)) {
            return res.status(400).json({ error: `status must be one of: ${[...STATUSES].join(', ')}` });
        }
        if (!db.setRegistrationStatus(id, status)) return res.status(404).json({ error: 'Not found' });
        res.json(db.getRegistration(id));
    });

    router.get('/messages', (req, res) => {
        res.json(db.listMessages());
    });

    router.patch('/messages/:id', (req, res) => {
        const id = parseId(req, res);
        if (id === null) return;
        if (typeof req.body?.handled !== 'boolean') {
            return res.status(400).json({ error: 'handled must be true or false' });
        }
        if (!db.setMessageHandled(id, req.body.handled)) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    });

    return router;
}
