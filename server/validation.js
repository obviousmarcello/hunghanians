/**
 * Small, dependency-free validators for the public forms. Each `validate*`
 * function returns `{ value, errors }` where `errors` maps field -> message.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\d\s./-]{6,40}$/;
const LANGS = new Set(['en', 'hu']);

function str(input, field, { required = false, max = 200 } = {}, errors) {
    const raw = input[field];
    if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') {
        errors[field] = 'Invalid value.';
        return '';
    }
    // Strip control characters (keeps newlines and tabs) and trim.
    // eslint-disable-next-line no-control-regex
    const value = String(raw ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
    if (required && !value) errors[field] = 'This field is required.';
    else if (value.length > max) errors[field] = `Must be at most ${max} characters.`;
    return value;
}

function email(input, field, errors) {
    const value = str(input, field, { required: true, max: 254 }, errors).toLowerCase();
    if (!errors[field] && !EMAIL_RE.test(value)) errors[field] = 'Please enter a valid email address.';
    return value;
}

function int(input, field, { min, max, fallback }, errors) {
    const raw = input[field];
    if (raw == null || raw === '') {
        if (fallback !== undefined) return fallback;
        errors[field] = 'This field is required.';
        return 0;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
        errors[field] = `Must be a whole number between ${min} and ${max}.`;
        return 0;
    }
    return n;
}

function lang(input) {
    return LANGS.has(input.lang) ? input.lang : 'en';
}

export function validateContact(input) {
    const errors = {};
    const value = {
        name: str(input, 'name', { required: true, max: 100 }, errors),
        email: email(input, 'email', errors),
        subject: str(input, 'subject', { required: true, max: 200 }, errors),
        message: str(input, 'message', { required: true, max: 5000 }, errors),
        lang: lang(input),
    };
    return { value, errors };
}

export function validateRegistration(input) {
    const errors = {};
    const value = {
        name: str(input, 'name', { required: true, max: 100 }, errors),
        email: email(input, 'email', errors),
        phone: str(input, 'phone', { max: 40 }, errors) || null,
        adults: int(input, 'adults', { min: 1, max: 20 }, errors),
        children: int(input, 'children', { min: 0, max: 20, fallback: 0 }, errors),
        infants: int(input, 'infants', { min: 0, max: 20, fallback: 0 }, errors),
        notes: str(input, 'notes', { max: 2000 }, errors) || null,
        lang: lang(input),
    };
    if (value.phone && !PHONE_RE.test(value.phone)) errors.phone = 'Please enter a valid phone number.';
    const consent = input.consent;
    if (!(consent === true || consent === 'yes' || consent === 'on' || consent === 'true')) {
        errors.consent = 'Consent is required to register.';
    }
    return { value, errors };
}

/** True when a hidden honeypot field was filled in (i.e. the sender is almost certainly a bot). */
export function isSpam(input) {
    return typeof input.website === 'string' && input.website.trim() !== '';
}
