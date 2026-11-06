import fs from 'node:fs';

/**
 * Event settings live in server/event.json so organisers can update dates,
 * prices and registration status without touching code.
 *
 * - registration.closesAt: defaults to the event start when omitted.
 * - registration.capacity: maximum number of people (adults + children + infants), or null.
 * - pricing: tiers in chronological order; each applies until its `until`
 *   timestamp, and the last tier (without `until`) applies afterwards.
 */
export function loadEvent(file) {
    const event = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateEvent(event);
    return event;
}

function validateEvent(event) {
    const problems = [];
    if (!event.id) problems.push('id is required');
    if (Number.isNaN(Date.parse(event.startsAt))) problems.push('startsAt must be an ISO date');
    if (Number.isNaN(Date.parse(event.endsAt))) problems.push('endsAt must be an ISO date');
    if (!Array.isArray(event.pricing) || event.pricing.length === 0) problems.push('pricing needs at least one tier');
    if (event.pricing?.at(-1)?.until) problems.push('the last pricing tier must not have an "until" date');
    if (problems.length) throw new Error(`Invalid event config: ${problems.join('; ')}`);
}

export function priceTier(event, now = new Date()) {
    return event.pricing.find((tier) => !tier.until || now <= new Date(tier.until));
}

export function calculateFee(event, { adults, children, infants }, now = new Date()) {
    const tier = priceTier(event, now);
    return adults * tier.adult + children * tier.child + infants * (tier.infant ?? 0);
}

export function registrationClosesAt(event) {
    return new Date(event.registration?.closesAt ?? event.startsAt);
}

/** Returns null when registration is open, or a reason code when it is not. */
export function registrationClosedReason(event, headcount, now = new Date()) {
    if (!event.registration?.open) return 'closed';
    if (now >= registrationClosesAt(event)) return 'deadline_passed';
    const capacity = event.registration.capacity;
    if (capacity != null && headcount >= capacity) return 'full';
    return null;
}

/** The public view of the event returned by GET /api/event. */
export function publicEvent(event, headcount, now = new Date()) {
    const tier = priceTier(event, now);
    const closedReason = registrationClosedReason(event, headcount, now);
    const capacity = event.registration?.capacity ?? null;
    return {
        id: event.id,
        name: event.name,
        location: event.location,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        currency: event.currency,
        prices: { adult: tier.adult, child: tier.child, infant: tier.infant ?? 0, validUntil: tier.until ?? null },
        registrationOpen: closedReason === null,
        registrationClosedReason: closedReason,
        registrationClosesAt: registrationClosesAt(event).toISOString(),
        spotsLeft: capacity == null ? null : Math.max(0, capacity - headcount),
    };
}
