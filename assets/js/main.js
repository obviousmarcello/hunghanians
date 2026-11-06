/* Hunghanians - front-end behaviour.
 *
 * The site works as a plain static site (GitHub Pages). When the Node backend
 * in /server is serving the site, the contact form posts to it and the
 * "Register" buttons open a built-in registration form instead of Google Forms.
 */
(() => {
    'use strict';

    document.documentElement.classList.add('js');

    const LANG_KEY = 'hunghanians.lang';
    const SUPPORTED_LANGS = ['en', 'hu'];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const MESSAGES = {
        en: {
            sending: 'Sending...',
            genericError: 'Oops! There was a problem sending your message. Please try again.',
            invalidForm: 'Please fill in all required fields correctly.',
            eventLive: 'The Get Together is happening now! 🎉',
            eventEnded: 'This event has ended. Thank you for celebrating with us — see you next year!',
            total: (amount) => `Total to pay: ${amount}`,
            earlybirdLeft: (days) => (days <= 1 ? 'Earlybird ends today' : `Earlybird · ${days} days left`),
            earlybirdEnded: 'Earlybird offer ended',
            perPerson: '/ person',
            viewAllPhotos: (n) => `View all ${n} photos`,
            allPhotos: 'All',
            photoCount: (n) => (n === 1 ? '1 photo' : `${n} photos`),
            galleryEmpty: 'No photos here yet.',
            galleryError: 'Sorry, the gallery could not be loaded. Please try again later.',
        },
        hu: {
            sending: 'Küldés...',
            genericError: 'Hoppá! Hiba történt az üzenet küldésekor. Kérlek, próbáld újra.',
            invalidForm: 'Kérjük, töltsd ki helyesen az összes kötelező mezőt.',
            eventLive: 'A találkozó most zajlik! 🎉',
            eventEnded: 'Az esemény véget ért. Köszönjük, hogy velünk ünnepeltél — jövőre találkozunk!',
            total: (amount) => `Fizetendő összeg: ${amount}`,
            earlybirdLeft: (days) => (days <= 1 ? 'Az earlybird ma lejár' : `Earlybird · még ${days} nap`),
            earlybirdEnded: 'Az earlybird ajánlat lejárt',
            perPerson: '/ fő',
            viewAllPhotos: (n) => `Mind a(z) ${n} fotó`,
            allPhotos: 'Összes',
            photoCount: (n) => `${n} fotó`,
            galleryEmpty: 'Itt még nincsenek fotók.',
            galleryError: 'Sajnos a galériát nem sikerült betölteni. Kérjük, próbáld újra később.',
        },
    };

    let currentLang = 'en';
    const t = (key) => MESSAGES[currentLang][key];
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    const formatMoney = (amount, currency = 'HUF') =>
        new Intl.NumberFormat(currentLang === 'hu' ? 'hu-HU' : 'en-GB', {
            style: 'currency',
            currency,
            maximumFractionDigits: 0,
        }).format(amount);

    /* ---------------------------------------------------------------- i18n */

    function applyLanguage(lang) {
        currentLang = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
        document.documentElement.lang = currentLang;

        $$('[data-en]').forEach((el) => {
            const text = el.dataset[currentLang];
            if (text) el.textContent = text;
        });

        $$('.lang-btn').forEach((btn) => {
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
        $$('.lang-btn').forEach((btn) => btn.addEventListener('click', () => applyLanguage(btn.dataset.lang)));
        const lang = initialLanguage();
        if (lang !== 'en') applyLanguage(lang);
    }

    /* ---------------------------------------------------------- navigation */

    function initNavigation() {
        const nav = $('#nav');
        const toggle = $('#menuToggle');
        const links = $('#navLinks');
        let menuOpen = false;

        const updateSolid = () => nav.classList.toggle('is-solid', menuOpen || window.scrollY > 40);

        const setOpen = (open) => {
            menuOpen = open;
            links.classList.toggle('open', open);
            toggle.setAttribute('aria-expanded', String(open));
            updateSolid();
        };

        toggle.addEventListener('click', () => setOpen(!menuOpen));
        $$('a', links).forEach((a) => a.addEventListener('click', () => setOpen(false)));
        document.addEventListener('click', (e) => {
            if (menuOpen && !nav.contains(e.target)) setOpen(false);
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && menuOpen) setOpen(false);
        });

        window.addEventListener('scroll', updateSolid, { passive: true });
        updateSolid();

        // Highlight the nav link of the section currently in view.
        const navLinks = new Map($$('a[href^="#"]', links).map((a) => [a.getAttribute('href').slice(1), a]));
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const link = navLinks.get(entry.target.id);
                    if (link) link.classList.toggle('is-active', entry.isIntersecting);
                });
            },
            { rootMargin: '-45% 0px -50% 0px' },
        );
        navLinks.forEach((_, id) => {
            const section = document.getElementById(id);
            if (section) observer.observe(section);
        });
    }

    /* ------------------------------------------------------ hero parallax */

    function initParallax() {
        const hero = $('.hero');
        const img = $('.hero-media img');
        if (!hero || !img) return;

        let ticking = false;
        const update = () => {
            ticking = false;
            const y = window.scrollY;
            if (reducedMotion.matches || y > hero.offsetHeight) return;
            img.style.transform = `translate3d(0, ${y * 0.3}px, 0) scale(1.05)`;
        };
        window.addEventListener(
            'scroll',
            () => {
                if (!ticking) {
                    ticking = true;
                    requestAnimationFrame(update);
                }
            },
            { passive: true },
        );
        update();
    }

    /* ------------------------------------------------------- scroll reveal */

    function initReveal() {
        const items = $$('.reveal');
        if (!('IntersectionObserver' in window) || reducedMotion.matches) {
            items.forEach((el) => el.classList.add('is-visible'));
            return;
        }

        // Stagger siblings that reveal together (e.g. cards in a grid).
        const groups = new Map();
        items.forEach((el) => {
            const siblings = groups.get(el.parentElement) || [];
            el.style.setProperty('--reveal-delay', `${Math.min(siblings.length, 6) * 0.08}s`);
            siblings.push(el);
            groups.set(el.parentElement, siblings);
        });

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                });
            },
            { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
        );
        items.forEach((el) => observer.observe(el));
    }

    /* ----------------------------------------------------------- countdown */

    const countdown = {
        el: null,
        start: NaN,
        end: NaN,
        timer: null,
        last: {},

        init() {
            this.el = $('#countdown');
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
            const clock = $('.countdown-clock', this.el);
            const status = $('.countdown-status', this.el);

            if (now < this.start) {
                clock.hidden = false;
                status.hidden = true;
                const distance = this.start - now;
                const parts = {
                    days: String(Math.floor(distance / 86400000)),
                    hours: String(Math.floor((distance % 86400000) / 3600000)).padStart(2, '0'),
                    minutes: String(Math.floor((distance % 3600000) / 60000)).padStart(2, '0'),
                    seconds: String(Math.floor((distance % 60000) / 1000)).padStart(2, '0'),
                };
                for (const [unit, value] of Object.entries(parts)) {
                    if (this.last[unit] === value) continue;
                    const node = $(`[data-unit="${unit}"]`, this.el);
                    node.textContent = value;
                    // Restart the "roll" animation on each change.
                    node.classList.remove('is-ticking');
                    void node.offsetWidth;
                    node.classList.add('is-ticking');
                    this.last[unit] = value;
                }
                return;
            }

            clock.hidden = true;
            status.hidden = false;
            status.textContent = now < this.end ? t('eventLive') : t('eventEnded');
            if (now >= this.end) clearInterval(this.timer);
        },
    };

    /* ------------------------------------------------------- pricing card */

    const pricing = {
        card: null,
        until: NaN,
        prices: null, // { adult, child, currency } once known from the backend

        init() {
            this.card = $('#priceCard');
            if (!this.card) return;
            this.until = Date.parse(this.card.dataset.earlybirdUntil);
            document.addEventListener('languagechange', () => this.render());
            this.render();
        },

        update(event) {
            if (!event?.prices) return;
            this.prices = { ...event.prices, currency: event.currency };
            this.until = Date.parse(event.prices.validUntil);
            this.render();
        },

        render() {
            const badge = $('#earlybirdBadge', this.card);
            if (!Number.isNaN(this.until)) {
                const daysLeft = Math.ceil((this.until - Date.now()) / 86400000);
                badge.textContent = daysLeft > 0 ? t('earlybirdLeft')(daysLeft) : t('earlybirdEnded');
                badge.classList.toggle('badge--muted', daysLeft <= 0);
            } else if (this.prices) {
                badge.hidden = true; // regular (final) pricing tier
            }

            if (this.prices) {
                $$('[data-price]', this.card).forEach((el) => {
                    const amount = this.prices[el.dataset.price];
                    if (typeof amount === 'number') el.textContent = formatMoney(amount, this.prices.currency);
                });
            }
        },
    };

    /* ------------------------------------------------------------- dialogs */

    function openDialog(dialog) {
        if (dialog.open) return;
        dialog.showModal();
        document.body.classList.add('no-scroll');
    }

    function initDialogs() {
        $$('dialog').forEach((dialog) => {
            dialog.addEventListener('close', () => {
                document.body.classList.remove('no-scroll');
                dialog.dispatchEvent(new CustomEvent('dialogreset'));
            });
            // Clicking the backdrop (the dialog element itself) closes it.
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) dialog.close();
            });
            $$('[data-close]', dialog).forEach((btn) => btn.addEventListener('click', () => dialog.close()));
        });
    }

    /* ------------------------------------------------------------ gallery */
    // Photos come from assets/data/gallery.json, which `npm run gallery` writes.

    const GALLERY_URL = 'assets/data/gallery.json';
    const FEATURED_LAYOUT = ['gallery-item--feature', '', '', 'gallery-item--wide', 'gallery-item--wide', 'gallery-item--wide'];
    const PAGE_SIZE = 40;

    let galleryData = null;
    const loadGallery = () => {
        galleryData ??= fetch(GALLERY_URL, { cache: 'no-cache' }).then((res) => {
            if (!res.ok) throw new Error(`Gallery request failed with ${res.status}`);
            return res.json();
        });
        return galleryData;
    };

    const albumTitle = (data, id) => {
        const album = data.albums.find((a) => a.id === id);
        return album?.title?.[currentLang] || album?.title?.en || '';
    };
    const captionText = (photo) => photo.caption?.[currentLang] || photo.caption?.en || '';

    function createTile(photo, className, sizes) {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = className;
        tile.style.setProperty('--w', photo.width);
        tile.style.setProperty('--h', photo.height);
        tile.style.backgroundColor = photo.color;

        const img = document.createElement('img');
        img.src = photo.src[480];
        img.srcset = `${photo.src[480]} 480w, ${photo.src[960]} 960w`;
        img.sizes = sizes;
        img.width = photo.width;
        img.height = photo.height;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = captionText(photo);
        img.addEventListener('load', () => tile.classList.add('is-loaded'), { once: true });
        tile.append(img);

        const text = captionText(photo);
        if (text) {
            const caption = document.createElement('span');
            caption.className = 'gallery-caption';
            caption.textContent = text;
            tile.append(caption);
        }
        return tile;
    }

    /** The photo viewer. Works on any list of photos from gallery.json. */
    const lightbox = {
        list: [],
        index: 0,
        onChange: null,
        onClose: null,

        init() {
            this.dialog = $('#lightbox');
            if (!this.dialog) return false;
            this.img = $('#lightboxImage');
            this.caption = $('#lightboxCaption');
            this.counter = $('#lightboxCounter');

            $$('[data-step]', this.dialog).forEach((btn) =>
                btn.addEventListener('click', () => this.show(this.index + Number(btn.dataset.step))),
            );
            this.dialog.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft') this.show(this.index - 1);
                if (e.key === 'ArrowRight') this.show(this.index + 1);
            });
            // Clicking empty space around the photo closes the viewer.
            this.dialog.addEventListener('click', (e) => {
                if (e.target === this.dialog || e.target.classList.contains('lightbox-figure')) this.dialog.close();
            });
            this.dialog.addEventListener('close', () => this.onClose?.());

            // Swipe left/right on touch screens.
            let startX = null;
            this.img.addEventListener('pointerdown', (e) => {
                startX = e.clientX;
            });
            this.img.addEventListener('pointerup', (e) => {
                if (startX === null) return;
                const dx = e.clientX - startX;
                startX = null;
                if (Math.abs(dx) > 40) this.show(this.index + (dx < 0 ? 1 : -1));
            });

            document.addEventListener('languagechange', () => {
                if (this.dialog.open) this.show(this.index);
            });
            return true;
        },

        open(list, index) {
            this.list = list;
            this.show(index);
            openDialog(this.dialog);
        },

        show(i) {
            const { list } = this;
            if (!list.length) return;
            this.index = (i + list.length) % list.length;
            const photo = list[this.index];
            this.img.width = photo.width;
            this.img.height = photo.height;
            this.img.src = photo.src[1920];
            this.img.alt = captionText(photo);
            this.caption.textContent = captionText(photo);
            this.counter.textContent = `${this.index + 1} / ${list.length}`;
            this.img.classList.remove('is-entering');
            void this.img.offsetWidth;
            this.img.classList.add('is-entering');
            // Warm the cache for the neighbours.
            [this.index - 1, this.index + 1].forEach((n) => {
                new Image().src = list[(n + list.length) % list.length].src[1920];
            });
            this.onChange?.(photo);
        },
    };

    /** Homepage: up to six photos (those with a "featured" position first, then the newest). */
    async function initFeaturedGallery() {
        const grid = $('#galleryGrid');
        if (!grid) return;
        const viewAll = $('#galleryViewAll');

        let data;
        try {
            data = await loadGallery();
        } catch (err) {
            console.error(err);
            grid.closest('section').hidden = true;
            return;
        }

        const featured = data.photos
            .filter((p) => typeof p.featured === 'number')
            .sort((a, b) => a.featured - b.featured);
        const rest = data.photos.filter((p) => typeof p.featured !== 'number');
        const shown = [...featured, ...rest].slice(0, FEATURED_LAYOUT.length);

        const render = () => {
            grid.replaceChildren(
                ...shown.map((photo, i) => {
                    const tile = createTile(
                        photo,
                        `gallery-item ${FEATURED_LAYOUT[i]}`.trim(),
                        i === 0 ? '(max-width: 820px) 80vw, 50vw' : '(max-width: 820px) 80vw, 25vw',
                    );
                    tile.addEventListener('click', () => lightbox.open(shown, i));
                    return tile;
                }),
            );
            if (viewAll) {
                viewAll.hidden = data.photos.length <= shown.length;
                $('span', viewAll).textContent = t('viewAllPhotos')(data.photos.length);
            }
        };
        render();
        document.addEventListener('languagechange', render);
    }

    /** gallery.html: every photo, filterable by album, loaded in batches while scrolling. */
    async function initPhotoWall() {
        const wall = $('#photoWall');
        if (!wall) return;
        const filters = $('#albumFilters');
        const count = $('#galleryCount');
        const sentinel = $('#wallSentinel');
        const status = $('#wallStatus');

        let data;
        try {
            data = await loadGallery();
        } catch (err) {
            console.error(err);
            status.textContent = t('galleryError');
            status.hidden = false;
            return;
        }

        const params = new URLSearchParams(location.search);
        let album = data.albums.some((a) => a.id === params.get('album')) ? params.get('album') : 'all';
        let list = [];
        let rendered = 0;

        const appendBatch = () => {
            const next = list.slice(rendered, rendered + PAGE_SIZE);
            const offset = rendered;
            wall.append(
                ...next.map((photo, i) => {
                    const tile = createTile(photo, 'photo-tile', '(max-width: 600px) 50vw, 360px');
                    tile.addEventListener('click', () => lightbox.open(list, offset + i));
                    return tile;
                }),
            );
            rendered += next.length;
            sentinel.hidden = rendered >= list.length;
        };

        const renderFilters = () => {
            const counts = Object.fromEntries(data.albums.map((a) => [a.id, 0]));
            data.photos.forEach((p) => {
                counts[p.album] = (counts[p.album] || 0) + 1;
            });
            const options = [
                ['all', t('allPhotos'), data.photos.length],
                ...data.albums.filter((a) => counts[a.id]).map((a) => [a.id, albumTitle(data, a.id), counts[a.id]]),
            ];
            filters.hidden = options.length <= 2; // "All" plus a single album: no need to filter
            filters.replaceChildren(
                ...options.map(([id, label, n]) => {
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'chip';
                    chip.setAttribute('aria-pressed', String(id === album));
                    chip.textContent = `${label} `;
                    const small = document.createElement('small');
                    small.textContent = n;
                    chip.append(small);
                    chip.addEventListener('click', () => {
                        album = id;
                        const url = new URL(location.href);
                        if (id === 'all') url.searchParams.delete('album');
                        else url.searchParams.set('album', id);
                        history.replaceState(null, '', url);
                        render();
                    });
                    return chip;
                }),
            );
        };

        const render = ({ keepCount = false } = {}) => {
            const keep = keepCount ? rendered : 0;
            list = album === 'all' ? data.photos : data.photos.filter((p) => p.album === album);
            count.textContent = t('photoCount')(list.length);
            status.textContent = list.length ? '' : t('galleryEmpty');
            status.hidden = list.length > 0;
            renderFilters();
            wall.replaceChildren();
            rendered = 0;
            do appendBatch();
            while (rendered < keep && rendered < list.length);
        };

        render();
        document.addEventListener('languagechange', () => render({ keepCount: true }));

        new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting) && rendered < list.length) appendBatch();
            },
            { rootMargin: '1200px 0px' },
        ).observe(sentinel);

        // Shareable links to a single photo: gallery.html#photo-<id>
        lightbox.onChange = (photo) => history.replaceState(null, '', `${location.pathname}${location.search}#photo-${photo.id}`);
        lightbox.onClose = () => history.replaceState(null, '', `${location.pathname}${location.search}`);
        const linked = location.hash.startsWith('#photo-') ? list.findIndex((p) => `#photo-${p.id}` === location.hash) : -1;
        if (linked >= 0) lightbox.open(list, linked);
    }

    function initGallery() {
        if (!lightbox.init()) return;
        initFeaturedGallery();
        initPhotoWall();
    }

    /* ---------------------------------------------------------------- map */

    function initMap() {
        const button = $('#showMap');
        const wrapper = $('#mapWrapper');
        if (!button || !wrapper) return;

        button.addEventListener('click', () => {
            if (!wrapper.firstChild) {
                const iframe = document.createElement('iframe');
                iframe.src = wrapper.dataset.src;
                iframe.title = 'Map of the event location';
                iframe.loading = 'lazy';
                iframe.referrerPolicy = 'no-referrer-when-downgrade';
                iframe.allowFullscreen = true;
                wrapper.append(iframe);
            }
            const show = wrapper.hidden;
            wrapper.hidden = !show;
            button.setAttribute('aria-expanded', String(show));
        });
    }

    /* ----------------------------------------------------------------- FAQ */

    function initFaq() {
        const questions = $$('.faq-question');
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
     * Wires a form: client-side validation, loading state, error display and a
     * success panel (the `.success-message` next to the form). Returns a reset
     * function that brings the form back.
     */
    function setupForm(form, submit) {
        const container = form.parentElement;
        const button = $('[type="submit"]', form);
        const errorBox = $('.form-error', form);
        const success = $('.success-message', container);

        const restoreButton = () => {
            button.disabled = false;
            button.textContent = button.dataset[currentLang];
        };

        const reset = () => {
            form.reset();
            form.hidden = false;
            success.hidden = true;
            errorBox.textContent = '';
            restoreButton();
        };

        $('[data-reset]', container)?.addEventListener('click', () => {
            reset();
            $('input', form)?.focus();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorBox.textContent = '';

            if (!form.checkValidity()) {
                errorBox.textContent = t('invalidForm');
                $(':invalid', form)?.focus();
                return;
            }

            button.disabled = true;
            button.textContent = t('sending');

            try {
                await submit(Object.fromEntries(new FormData(form)));
                form.hidden = true;
                success.hidden = false;
            } catch (err) {
                errorBox.textContent = err instanceof UserFacingError ? err.message : t('genericError');
            } finally {
                restoreButton();
            }
        });

        return reset;
    }

    function initContactForm(backendReady) {
        const form = $('#contactForm');
        if (!form) return;

        setupForm(form, async (data) => {
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
        });
    }

    function initRegistration(backend) {
        const dialog = $('#registerModal');
        const form = $('#registerForm');
        if (!dialog || !form) return;
        const totalEl = $('.registration-total', dialog);

        // Without a backend (or once registration closes) the buttons keep linking to Google Forms.
        if (!backend.available || !backend.event?.registrationOpen) return;

        $$('.js-register').forEach((button) =>
            button.addEventListener('click', (e) => {
                e.preventDefault();
                openDialog(dialog);
                $('input', form)?.focus();
            }),
        );

        const reset = setupForm(form, async (data) => {
            const result = await postJson(form.dataset.api, data);
            totalEl.textContent =
                typeof result?.totalFee === 'number' ? t('total')(formatMoney(result.totalFee, result.currency)) : '';
        });
        dialog.addEventListener('dialogreset', () => {
            reset();
            totalEl.textContent = '';
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
        $('#year').textContent = new Date().getFullYear();

        initLanguageSwitcher();
        initNavigation();
        initParallax();
        initReveal();
        countdown.init();
        pricing.init();
        initDialogs();
        initGallery();
        initMap();
        initFaq();

        const backendReady = detectBackend();
        initContactForm(backendReady);

        const backend = await backendReady;
        if (backend.event?.startsAt) countdown.setDates(backend.event.startsAt, backend.event.endsAt);
        pricing.update(backend.event);
        initRegistration(backend);
    }

    main();
})();
