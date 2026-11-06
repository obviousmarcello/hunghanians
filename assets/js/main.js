/* Hunghanians - front-end behaviour.
 *
 * The site works as a plain static site (GitHub Pages). When the Node backend
 * in /server is serving the site, the contact form posts to it and the
 * "Register" button opens a built-in registration form instead of Google Forms.
 */
(() => {
    'use strict';

    const LANG_KEY = 'hunghanians.lang';
    const SUPPORTED_LANGS = ['en', 'hu'];

    const MESSAGES = {
        en: {
            sending: 'Sending...',
            genericError: 'Oops! There was a problem sending your message. Please try again.',
            invalidForm: 'Please fill in all required fields correctly.',
            eventLive: 'The event is happening now! 🎉',
            eventEnded: 'This event has ended. Thank you for celebrating with us — see you next year!',
            total: (amount) => `Total to pay: ${amount}`,
        },
        hu: {
            sending: 'Küldés...',
            genericError: 'Hoppá! Hiba történt az üzenet küldésekor. Kérlek, próbáld újra.',
            invalidForm: 'Kérjük, töltsd ki helyesen az összes kötelező mezőt.',
            eventLive: 'Az esemény most zajlik! 🎉',
            eventEnded: 'Az esemény véget ért. Köszönjük, hogy velünk ünnepeltél — jövőre találkozunk!',
            total: (amount) => `Fizetendő összeg: ${amount}`,
        },
    };

    let currentLang = 'en';
    const t = (key) => MESSAGES[currentLang][key];

    /* ---------------------------------------------------------------- i18n */

    function applyLanguage(lang) {
        currentLang = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
        document.documentElement.lang = currentLang;

        document.querySelectorAll('[data-en]').forEach((el) => {
            const text = el.dataset[currentLang];
            if (text) el.textContent = text;
        });

        document.querySelectorAll('.lang-btn').forEach((btn) => {
            btn.setAttribute('aria-pressed', String(btn.dataset.lang === currentLang));
        });

        try {
            localStorage.setItem(LANG_KEY, currentLang);
        } catch {
            /* storage unavailable (private mode etc.) - ignore */
        }

        document.dispatchEvent(new CustomEvent('languagechange'));
    }

    function initialLanguage() {
        try {
            const saved = localStorage.getItem(LANG_KEY);
            if (SUPPORTED_LANGS.includes(saved)) return saved;
        } catch {
            /* ignore */
        }
        return (navigator.language || '').toLowerCase().startsWith('hu') ? 'hu' : 'en';
    }

    function initLanguageSwitcher() {
        document.querySelectorAll('.lang-btn').forEach((btn) => {
            btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
        });
        const lang = initialLanguage();
        if (lang !== 'en') applyLanguage(lang);
        else document.documentElement.lang = 'en';
    }

    /* ---------------------------------------------------------- navigation */

    function initNavigation() {
        const nav = document.querySelector('.nav');
        const toggle = document.getElementById('menuToggle');
        const links = document.getElementById('navLinks');

        const setOpen = (open) => {
            links.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', String(open));
        };

        toggle.addEventListener('click', () => setOpen(!links.classList.contains('open')));
        links.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
        document.addEventListener('click', (e) => {
            if (!nav.contains(e.target)) setOpen(false);
        });

        const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 100);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
    }

    /* ----------------------------------------------------------- countdown */

    const countdown = {
        el: null,
        start: NaN,
        end: NaN,
        timer: null,

        init() {
            this.el = document.getElementById('countdown');
            if (!this.el) return;
            this.setDates(this.el.dataset.start, this.el.dataset.end);
            document.addEventListener('languagechange', () => this.render());
        },

        setDates(start, end) {
            this.start = Date.parse(start);
            this.end = Date.parse(end);
            if (Number.isNaN(this.end)) this.end = this.start + 24 * 60 * 60 * 1000;
            clearInterval(this.timer);
            this.render();
            if (Date.now() < this.end) this.timer = setInterval(() => this.render(), 1000);
        },

        render() {
            if (Number.isNaN(this.start)) return;
            const now = Date.now();
            const status = this.el.querySelector('.countdown-status');
            const clock = this.el.querySelector('.countdown');
            const title = this.el.querySelector('.countdown-title');

            if (now < this.start) {
                clock.hidden = false;
                title.hidden = false;
                status.hidden = true;
                const distance = this.start - now;
                const parts = {
                    days: Math.floor(distance / 86400000),
                    hours: Math.floor((distance % 86400000) / 3600000),
                    minutes: Math.floor((distance % 3600000) / 60000),
                    seconds: Math.floor((distance % 60000) / 1000),
                };
                for (const [unit, value] of Object.entries(parts)) {
                    this.el.querySelector(`[data-unit="${unit}"]`).textContent = value;
                }
                return;
            }

            clock.hidden = true;
            title.hidden = true;
            status.hidden = false;
            status.textContent = now < this.end ? t('eventLive') : t('eventEnded');
            if (now >= this.end) clearInterval(this.timer);
        },
    };

    /* ------------------------------------------------------------- dialogs */

    function openDialog(dialog) {
        if (dialog.open) return;
        dialog.showModal();
        document.body.classList.add('no-scroll');
    }

    function initDialogs() {
        document.querySelectorAll('dialog').forEach((dialog) => {
            dialog.addEventListener('close', () => {
                document.body.classList.remove('no-scroll');
                dialog.dispatchEvent(new CustomEvent('dialogreset'));
            });
            // Click on the backdrop (the dialog element itself, outside its content) closes it.
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) dialog.close();
            });
            dialog.querySelectorAll('[data-close]').forEach((btn) => {
                btn.addEventListener('click', () => dialog.close());
            });
        });
    }

    /* ------------------------------------------------------------- gallery */

    function initGallery() {
        const dialog = document.getElementById('imageModal');
        const img = document.getElementById('modalImage');

        document.querySelectorAll('.gallery-item').forEach((item) => {
            item.addEventListener('click', () => {
                const thumb = item.querySelector('img');
                img.src = item.dataset.full || thumb.src;
                img.alt = thumb.alt;
                openDialog(dialog);
            });
        });

        // Clicking the photo itself also closes the lightbox.
        img.addEventListener('click', () => dialog.close());
    }

    /* ----------------------------------------------------------------- FAQ */

    function initFaq() {
        const questions = document.querySelectorAll('.faq-question');
        questions.forEach((q) => {
            q.addEventListener('click', () => {
                const wasOpen = q.getAttribute('aria-expanded') === 'true';
                questions.forEach((other) => other.setAttribute('aria-expanded', 'false'));
                q.setAttribute('aria-expanded', String(!wasOpen));
            });
        });
    }

    /* --------------------------------------------------------------- forms */

    /** Thrown when the backend replied with a validation error the user should see. */
    class UserFacingError extends Error {}

    async function postJson(url, data) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ ...data, lang: currentLang }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return body;
        if (response.status === 400 || response.status === 409 || response.status === 429) {
            throw new UserFacingError(body.error || t('genericError'));
        }
        throw new Error(`Request failed with ${response.status}`);
    }

    /**
     * Wires a form inside a dialog: client-side validation, loading state,
     * error display, success panel, and reset when the dialog closes.
     */
    function setupDialogForm(form, submit, { autoCloseMs = 0 } = {}) {
        const dialog = form.closest('dialog');
        const button = form.querySelector('[type="submit"]');
        const errorBox = form.querySelector('.form-error');
        const success = dialog.querySelector('.success-message');

        const restoreButton = () => {
            button.disabled = false;
            button.textContent = button.dataset[currentLang];
        };

        dialog.addEventListener('dialogreset', () => {
            form.reset();
            form.hidden = false;
            success.hidden = true;
            errorBox.textContent = '';
            restoreButton();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorBox.textContent = '';

            if (!form.checkValidity()) {
                errorBox.textContent = t('invalidForm');
                form.querySelector(':invalid')?.focus();
                return;
            }

            button.disabled = true;
            button.textContent = t('sending');

            try {
                const data = Object.fromEntries(new FormData(form));
                await submit(data);
                form.hidden = true;
                success.hidden = false;
                if (autoCloseMs) setTimeout(() => dialog.close(), autoCloseMs);
            } catch (err) {
                errorBox.textContent = err instanceof UserFacingError ? err.message : t('genericError');
            } finally {
                restoreButton();
            }
        });
    }

    function initContactForm(backendReady) {
        const form = document.getElementById('contactForm');
        const dialog = document.getElementById('contactModal');

        document.getElementById('contactBtn').addEventListener('click', () => {
            openDialog(dialog);
            form.querySelector('input')?.focus();
        });

        setupDialogForm(form, async (data) => {
            const backend = await backendReady;
            if (backend.available) return postJson(form.dataset.api, data);

            // Static hosting fallback: Formspree.
            if (data.website) return; // honeypot
            const formspreeData = new FormData();
            formspreeData.append('name', data.name);
            formspreeData.append('email', data.email);
            formspreeData.append('_subject', data.subject);
            formspreeData.append('message', data.message);
            const response = await fetch(form.action, {
                method: 'POST',
                body: formspreeData,
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) throw new Error('Formspree submission failed');
        }, { autoCloseMs: 3000 });
    }

    function initRegistration(backend) {
        const button = document.getElementById('registerBtn');
        const dialog = document.getElementById('registerModal');
        const form = document.getElementById('registerForm');
        const totalEl = dialog.querySelector('.registration-total');

        // Without a backend (or once registration closes) the button keeps linking to Google Forms.
        if (!backend.available || !backend.event?.registrationOpen) return;

        button.addEventListener('click', (e) => {
            e.preventDefault();
            openDialog(dialog);
            form.querySelector('input')?.focus();
        });

        setupDialogForm(form, async (data) => {
            const result = await postJson(form.dataset.api, data);
            if (result && typeof result.totalFee === 'number') {
                const amount = new Intl.NumberFormat(currentLang === 'hu' ? 'hu-HU' : 'en-GB', {
                    style: 'currency',
                    currency: result.currency || 'HUF',
                    maximumFractionDigits: 0,
                }).format(result.totalFee);
                totalEl.textContent = t('total')(amount);
            }
        });
    }

    /* ------------------------------------------------------------- backend */

    /** Detects whether the API is available (it isn't on GitHub Pages). */
    async function detectBackend() {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        try {
            const response = await fetch('/api/event', {
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            });
            const type = response.headers.get('content-type') || '';
            if (!response.ok || !type.includes('application/json')) return { available: false };
            return { available: true, event: await response.json() };
        } catch {
            return { available: false };
        } finally {
            clearTimeout(timeout);
        }
    }

    /* ---------------------------------------------------------------- boot */

    async function main() {
        document.getElementById('year').textContent = new Date().getFullYear();

        initLanguageSwitcher();
        initNavigation();
        countdown.init();
        initDialogs();
        initGallery();
        initFaq();

        const backendReady = detectBackend();
        initContactForm(backendReady);

        const backend = await backendReady;
        if (backend.event?.startsAt) countdown.setDates(backend.event.startsAt, backend.event.endsAt);
        initRegistration(backend);
    }

    main();
})();
