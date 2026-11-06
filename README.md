# Hunghanians

Website of **Hunghanians**, the Ghanaian community in Hungary: <https://hunghanians.hu>.

The repository holds two things:

1. **A static website** (`index.html` + `assets/`). It works on its own and is what GitHub Pages serves today.
2. **An optional Node.js backend** (`server/`). It serves the same site and adds an API for contact
   messages, event registrations and an admin view.

The front end detects the backend at runtime (it calls `GET /api/event`):

| Feature        | Static hosting (GitHub Pages)       | With the backend                                    |
| -------------- | ----------------------------------- | --------------------------------------------------- |
| Contact form   | Sent through Formspree              | Stored in the database and emailed to the organisers |
| "Register" button | Opens the Google Form            | Opens the built-in registration form               |
| Countdown      | Uses `data-start`/`data-end` in `index.html` | Uses the dates in `server/event.json`      |

## Project layout

```
index.html                 Main page (all copy, in English and Hungarian)
ghana_hungary_event.html   Older event page, kept so existing links keep working
assets/css/styles.css      Styles
assets/js/main.js          Language switcher, countdown, gallery, dialogs, forms
assets/images/             Full-size photos, logos (logo-light/logo-dark.png, transparent)
  gallery/                 Gallery thumbnails (1000×750)
  hero/                    Hero (desktop + mobile crops) and contact-section backgrounds
server/                    Express backend (API + static file server)
  event.json               Event dates, prices, capacity, registration on/off
test/                      Backend tests (node:test)
```

### Editing content

* **Text** is in `index.html`. Each translated element carries both languages in
  `data-en="…"` / `data-hu="…"`. Update both attributes and the text between the tags.
  Only put these attributes on elements that contain plain text. If an element also has an icon,
  wrap the text in a `<span>` and put the attributes on the span.
* **Gallery**: add the full-size photo to `assets/images/` and a 1000×750 thumbnail to
  `assets/images/gallery/`, for example:
  `convert photo.jpg -auto-orient -resize 1000x750^ -gravity center -extent 1000x750 -strip -quality 68 thumb.jpg`.
  Then add a `<button class="gallery-item">` with an English and Hungarian caption. On desktop the grid has
  4 columns: `gallery-item--feature` takes 2×2 cells and `gallery-item--wide` takes 2×1, so arrange them to fill
  complete rows. On phones the gallery becomes a swipeable strip.
* **Design tokens**: colours, the fluid type scale (`--step-*`) and spacing (`--space-*`) are defined at the top
  of `assets/css/styles.css`. Use them instead of fixed sizes.
* **Scroll animations**: add `class="reveal"` to any element to make it fade in as it scrolls into view.
* **Event dates and prices**: update `server/event.json`, and in `index.html` the `data-start` / `data-end`
  attributes on `#countdown`, `data-earlybird-until` on `#priceCard` and the amounts in the price table. The
  static site uses these, while the backend overrides them from `event.json`.

## Running the backend

Requires Node.js 22.13 or newer. It uses the built-in `node:sqlite`, so there are no native modules to compile.

```bash
npm install
```

```bash
cp .env.example .env    # optional, every setting has a default
```

```bash
npm start
```

`npm start` reads `.env` if it exists. Then open <http://localhost:3000>.

`npm run dev` restarts the server on file changes. Run `npm test` to run the API tests.

Locally, data is stored in SQLite at `data/hunghanians.db`, which git ignores. When MySQL settings are present
(see below) the app uses MySQL instead and creates its tables automatically on first start.

### Configuration

All settings are environment variables. See [`.env.example`](.env.example). The most important ones:

* Database: `DATABASE_URL=mysql://user:pass@host:3306/db`, or `MYSQL_HOST`/`DB_HOST`, `MYSQL_USER`/`DB_USER`,
  `MYSQL_PASSWORD`/`DB_PASSWORD`, `MYSQL_DATABASE`/`DB_NAME` (and optionally a port and `DB_SSL=true`).
  Without them, SQLite is used.
* `ADMIN_TOKEN`: enables the admin API (at least 16 characters).
* `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, …: outgoing email. Without them, emails are only logged.
  With Gmail, use an App Password.
* `ORGANIZER_EMAIL`: where notifications go (default `hunghanians@gmail.com`).
* `TRUST_PROXY=1`: set when running behind a reverse proxy, so rate limiting sees real client IPs.

### API

| Method & path                         | Description                                                  |
| ------------------------------------- | ------------------------------------------------------------ |
| `GET /api/health`                     | Liveness check                                                |
| `GET /api/event`                      | Public event info: dates, current prices, whether registration is open, spots left |
| `POST /api/contact`                   | `{ name, email, subject, message, lang }`                     |
| `POST /api/registrations`             | `{ name, email, phone?, adults, children?, infants?, notes?, consent, lang }`. Returns the total fee |

POST endpoints accept JSON or form-encoded bodies, are rate-limited per IP and include a honeypot
field (`website`) against spam bots. Registrations are refused (HTTP 409) when the email is already
registered, after `registration.closesAt`, or when `capacity` is reached. The fee is calculated on the
server from the pricing tier valid at the time of registration (for example earlybird until 31 March).

Registrants get a confirmation email in their language and the organisers get a notification.

### Admin API

Send `Authorization: Bearer $ADMIN_TOKEN` with every request.

```bash
# Headcount for food planning, plus paid and outstanding amounts
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://hunghanians.hu/api/admin/summary
```

```bash
# All registrations as a spreadsheet (opens in Excel with Hungarian accents intact)
curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://hunghanians.hu/api/admin/registrations?format=csv" -o registrations.csv
```

```bash
# Mark registration 12 as paid (or "pending" / "cancelled")
curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
     -d '{"status":"paid"}' https://hunghanians.hu/api/admin/registrations/12
```

Also available: `GET /api/admin/registrations` (JSON), `GET /api/admin/messages`, and
`PATCH /api/admin/messages/:id` with `{"handled": true}`.

## Deployment

### GoDaddy Node.js Hosting (current setup)

GoDaddy runs the app as a Node.js 22 process from the GitHub repository and provides a managed MySQL
database. Its disk should not be relied on for data, so **the app must use that MySQL database**.

1. In the GoDaddy Node.js Hosting dashboard, the app is connected to this repository and the `main` branch.
   If asked for commands: install `npm ci`, start `npm start`. There is no build step.
2. Under the app's environment variables, set:
   * `ADMIN_TOKEN`: a long random string (enables the admin API).
   * `TRUST_PROXY=1`: GoDaddy's proxy sits in front of the app; without this, every visitor shares one rate limit.
   * `ORGANIZER_EMAIL` and the `SMTP_*` / `MAIL_FROM` settings, so confirmation emails are actually sent.
3. Database: GoDaddy adds the managed database's host, user, password and name as environment variables.
   The app recognises `DATABASE_URL` and the common `MYSQL_*` / `DB_*` names. If GoDaddy uses other names,
   add `DATABASE_URL=mysql://USER:PASSWORD@HOST:PORT/DATABASE` yourself with the same values
   (URL-encode special characters in the password).
4. Deploy, then check:
   * The app log shows `Database: MySQL at … (from …)`. If it says `SQLite`, the database variables were not
     recognised and registrations **will not be kept**. Fix step 3 before going live.
   * `https://<your-app-address>/api/health` returns `{"status":"ok","database":"mysql"}`.
5. Point the domain: attach `hunghanians.hu` to the app in GoDaddy and update DNS as GoDaddy instructs. Then
   remove the custom domain from GitHub Pages (repository Settings → Pages) so the two don't compete.
6. Back up the database regularly (for example with an export from GoDaddy's database tools), and download the
   registrations CSV from the admin API before the event.

### Other hosts

* **Static only (current setup):** GitHub Pages serves the repository root. `_config.yml`
  stops Jekyll from publishing the backend code.
* **With the backend:** deploy the `Dockerfile` to any container host (Fly.io, Render, Railway, a VPS…).
  Mount a persistent volume at `/app/data`, set the environment variables, and point the
  `hunghanians.hu` DNS at the new host instead of GitHub Pages. The backend serves the whole site,
  so nothing else is needed.

```bash
docker build -t hunghanians .
```

```bash
docker run -p 3000:3000 -v hunghanians-data:/app/data -e ADMIN_TOKEN=change-me-to-something-long hunghanians
```
