import nodemailer from 'nodemailer';

/**
 * Sends email through SMTP when configured; otherwise logs what would have
 * been sent, so the site works locally without a mail server.
 */
export function createMailer(smtp, logger = console) {
    if (!smtp) {
        return {
            enabled: false,
            async send(mail) {
                logger.info(`[mail disabled] to=${mail.to} subject=${JSON.stringify(mail.subject)}`);
            },
        };
    }

    const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });

    return {
        enabled: true,
        send: (mail) => transport.sendMail({ from: smtp.from, ...mail }),
    };
}

/** Fire-and-forget: the submission is already stored, so a mail failure must not fail the request. */
export function sendInBackground(mailer, mail, logger = console) {
    Promise.resolve()
        .then(() => mailer.send(mail))
        .catch((err) => logger.error(`Failed to send email to ${mail.to}:`, err.message));
}

const fmtMoney = (amount, currency, lang) =>
    new Intl.NumberFormat(lang === 'hu' ? 'hu-HU' : 'en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
    }).format(amount);

export function contactNotification(msg, organizerEmail) {
    return {
        to: organizerEmail,
        replyTo: msg.email,
        subject: `[Hunghanians] ${msg.subject}`,
        text: `New message from the website contact form.\n\nName: ${msg.name}\nEmail: ${msg.email}\nLanguage: ${msg.lang}\n\n${msg.message}\n`,
    };
}

export function registrationNotification(reg, event, organizerEmail) {
    return {
        to: organizerEmail,
        replyTo: reg.email,
        subject: `[Hunghanians] New registration: ${reg.name} (${reg.adults + reg.children + reg.infants} people)`,
        text: [
            `New registration for ${event.name?.en ?? event.id}.`,
            '',
            `Name: ${reg.name}`,
            `Email: ${reg.email}`,
            `Phone: ${reg.phone ?? '-'}`,
            `Adults: ${reg.adults}`,
            `Children (6-14): ${reg.children}`,
            `Children (under 6): ${reg.infants}`,
            `Total fee: ${fmtMoney(reg.totalFee, reg.currency, 'en')}`,
            `Notes: ${reg.notes ?? '-'}`,
            '',
            `Registration #${reg.id}`,
        ].join('\n'),
    };
}

export function registrationConfirmation(reg, event, organizerEmail) {
    const total = fmtMoney(reg.totalFee, reg.currency, reg.lang);
    if (reg.lang === 'hu') {
        return {
            to: reg.email,
            replyTo: organizerEmail,
            subject: `Regisztráció visszaigazolása – ${event.name?.hu ?? event.id}`,
            text: [
                `Kedves ${reg.name}!`,
                '',
                `Köszönjük a regisztrációt (#${reg.id}).`,
                `Felnőttek: ${reg.adults}, gyerekek (6–14): ${reg.children}, gyerekek (6 év alatt): ${reg.infants}`,
                `Fizetendő összeg: ${total}`,
                '',
                'Kérjük, a részvételi díjat 5 napon belül banki átutalással fizesd be. Az utalás adatait hamarosan külön e-mailben küldjük.',
                'Fizetés nélkül sajnos nem tudjuk megerősíteni a részvételedet.',
                '',
                'Üdvözlettel,',
                'Hunghanians',
            ].join('\n'),
        };
    }
    return {
        to: reg.email,
        replyTo: organizerEmail,
        subject: `Registration received – ${event.name?.en ?? event.id}`,
        text: [
            `Dear ${reg.name},`,
            '',
            `Thank you for registering (#${reg.id}).`,
            `Adults: ${reg.adults}, children (6–14): ${reg.children}, children (under 6): ${reg.infants}`,
            `Total to pay: ${total}`,
            '',
            'Please pay the participation fee by bank transfer within 5 days. We will send you the bank details in a separate email shortly.',
            "Unfortunately, without payment we won't be able to confirm your spot.",
            '',
            'Best wishes,',
            'Hunghanians',
        ].join('\n'),
    };
}
