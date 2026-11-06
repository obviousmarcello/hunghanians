# Photo inbox

Upload new gallery photos here (JPEG, PNG, HEIC from iPhones, WebP, AVIF or TIFF).

* Put them in a **sub-folder per album**, e.g. `photos/inbox/get-together-2025/`.
  The folder name becomes the album name (you can rename it later in `assets/data/gallery.json`).
  Photos directly in this folder go into the album "Photos".
* After you commit, the **Gallery photos** GitHub Action resizes every photo, removes its
  location data and other metadata, adds it to the gallery and deletes the original from this folder.
  Within a few minutes the photos are on the site.
* Uploading the same photo twice is harmless: duplicates are skipped.

Captions, album names and which photos appear on the homepage are edited in
`assets/data/gallery.json`; see the README section "Adding photos".
