#!/usr/bin/env node
/**
 * Gallery photo pipeline.
 *
 *   npm run gallery
 *
 * Takes every photo in photos/inbox/ (optionally in a sub-folder per album,
 * e.g. photos/inbox/get-together-2025/IMG_1234.jpg), plus any photo uploaded
 * to the top level of the repository by mistake, and for each one:
 *
 *   - converts HEIC/HEIF (iPhone) photos with `heif-convert` (libheif-examples),
 *   - rotates it upright and removes all metadata (including GPS location),
 *   - writes web-sized WebP files to assets/images/gallery/<id>-{480,960,1920}.webp,
 *   - adds it to assets/data/gallery.json (size, colour, date taken, album),
 *   - deletes the original from the inbox.
 *
 * The same photo is never added twice (the id is a hash of the file).
 * Runs automatically in GitHub Actions when photos are pushed to photos/inbox/.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import exifReader from 'exif-reader';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = path.join(ROOT, 'photos', 'inbox');
const OUT_DIR = path.join(ROOT, 'assets', 'images', 'gallery');
const MANIFEST = path.join(ROOT, 'assets', 'data', 'gallery.json');
const WEB_PATH = 'assets/images/gallery';

const WIDTHS = [480, 960]; // grid thumbnails (1x / 2x)
const FULL_SIZE = 1920; // longest edge in the photo viewer
const DEFAULT_ALBUM = 'photos';
const KEEP = new Set(['.gitkeep', 'README.md']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.heic', '.heif']);

const run = promisify(execFile);

async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(full)));
        else if (!KEEP.has(entry.name) && !entry.name.startsWith('.')) files.push(full);
    }
    return files;
}

const slugify = (s) =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || DEFAULT_ALBUM;

const titleFromFolder = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase()).trim();

async function loadManifest() {
    try {
        return JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        return { albums: [], photos: [] };
    }
}

/** Returns a sharp-readable input: HEIC/HEIF is converted to JPEG first. */
async function readableInput(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.heic' && ext !== '.heif') return { input: file, cleanup: async () => {} };
    const tmp = path.join(os.tmpdir(), `${crypto.randomUUID()}.jpg`);
    try {
        await run('heif-convert', ['-q', '92', file, tmp]);
    } catch (err) {
        throw new Error(
            err.code === 'ENOENT'
                ? 'HEIC photo found but `heif-convert` is not installed (apt-get install libheif-examples)'
                : `heif-convert failed: ${err.stderr || err.message}`,
        );
    }
    return { input: tmp, cleanup: () => fs.rm(tmp, { force: true }) };
}

function takenAt(exif) {
    if (!exif) return null;
    try {
        const data = exifReader(exif);
        const date = data.Photo?.DateTimeOriginal || data.Image?.DateTime;
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    } catch {
        return null;
    }
}

const hex = ({ r, g, b }) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

async function processPhoto(file, album) {
    const bytes = await fs.readFile(file);
    const id = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 12);
    const { input, cleanup } = await readableInput(file);

    try {
        // .rotate() with no arguments applies the EXIF orientation; output has no metadata.
        const base = sharp(input, { failOn: 'error' }).rotate();
        const meta = await sharp(input).metadata();
        const full = await base
            .clone()
            .resize({ width: FULL_SIZE, height: FULL_SIZE, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(path.join(OUT_DIR, `${id}-${FULL_SIZE}.webp`));

        const src = { [FULL_SIZE]: `${WEB_PATH}/${id}-${FULL_SIZE}.webp` };
        for (const width of WIDTHS) {
            await base
                .clone()
                .resize({ width, withoutEnlargement: true })
                .webp({ quality: 72 })
                .toFile(path.join(OUT_DIR, `${id}-${width}.webp`));
            src[width] = `${WEB_PATH}/${id}-${width}.webp`;
        }

        const { dominant } = await base.clone().resize(64).stats();
        return {
            id,
            album,
            width: full.width,
            height: full.height,
            color: hex(dominant),
            takenAt: takenAt(meta.exif),
            addedAt: new Date().toISOString(),
            featured: false,
            caption: { en: '', hu: '' },
            src,
        };
    } finally {
        await cleanup();
    }
}

async function main() {
    await fs.mkdir(OUT_DIR, { recursive: true });
    await fs.mkdir(path.dirname(MANIFEST), { recursive: true });

    const manifest = await loadManifest();
    const known = new Set(manifest.photos.map((p) => p.id));
    // Photos uploaded to the top level of the repository by mistake (GitHub's
    // "Upload files" puts them in whatever folder is open) are handled too.
    const rootPhotos = (await fs.readdir(ROOT, { withFileTypes: true }))
        .filter((e) => e.isFile() && IMAGE_EXT.has(path.extname(e.name).toLowerCase()))
        .map((e) => path.join(ROOT, e.name));
    const files = [...(await walk(INBOX)), ...rootPhotos];
    let added = 0;
    let skipped = 0;
    const failed = [];

    for (const file of files) {
        const fromRoot = path.dirname(file) === ROOT;
        const rel = fromRoot ? path.basename(file) : path.relative(INBOX, file);
        if (!IMAGE_EXT.has(path.extname(file).toLowerCase())) {
            console.warn(`skip  ${rel} (not a supported image type)`);
            failed.push(rel);
            continue;
        }

        const folder = fromRoot || path.dirname(rel) === '.' ? null : rel.split(path.sep)[0];
        const album = folder ? slugify(folder) : DEFAULT_ALBUM;
        if (!manifest.albums.some((a) => a.id === album)) {
            const title = folder ? titleFromFolder(folder) : null;
            manifest.albums.push({ id: album, title: { en: title || 'Photos', hu: title || 'Fotók' } });
        }

        try {
            const photo = await processPhoto(file, album);
            if (known.has(photo.id)) {
                console.log(`dup   ${rel} (already in the gallery)`);
                skipped++;
            } else {
                manifest.photos.push(photo);
                known.add(photo.id);
                console.log(`add   ${rel} -> ${photo.id} (${photo.width}x${photo.height}, album "${album}")`);
                added++;
            }
            await fs.rm(file);
        } catch (err) {
            console.error(`FAIL  ${rel}: ${err.message}`);
            failed.push(rel);
        }
    }

    // Only touch the photo list when something was added, so runs without new
    // photos don't produce a commit.
    if (added) {
        // Photos with a date taken first, newest first; then undated ones, newest added first.
        manifest.photos.sort((a, b) => {
            if (a.takenAt && b.takenAt) return b.takenAt.localeCompare(a.takenAt);
            if (a.takenAt || b.takenAt) return a.takenAt ? -1 : 1;
            return b.addedAt.localeCompare(a.addedAt);
        });
        manifest.albums = manifest.albums.filter((a) => manifest.photos.some((p) => p.album === a.id));
        await fs.writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    }

    // Remove album folders left empty in the inbox.
    for (const entry of await fs.readdir(INBOX, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory()) await fs.rmdir(path.join(INBOX, entry.name)).catch(() => {});
    }

    console.log(`\n${added} added, ${skipped} duplicates, ${failed.length} failed. Gallery: ${manifest.photos.length} photos.`);
    if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
