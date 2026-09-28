# Karaokej

**Karaoke** + Swedish **okej** (OK). Karaokej is a self-hosted karaoke player for KaraFun `.kfn` files.

- A **screen** (TV, laptop, tablet or phone) opens `/screen` and plays songs full screen, with lyrics that color in syllable by syllable.
- When nothing is playing, the screen shows a **QR code**. Guests scan it with their phone to open `/remote`, where they search the library, queue songs (with their name), reorder the queue, and pause, restart or skip.
- A small Node server indexes your library into SQLite, so searching is instant even when the files are on a slow network mount. It serves the app and keeps the shared queue in sync over a WebSocket.

## Quick start

Requires Node (see `.nvmrc`) and pnpm (the version is pinned in `package.json`).

```sh
pnpm install
KARAOKEJ_LIBRARY=/path/to/Karaoke pnpm dev
```

Open `http://localhost:5173/screen` on the screen and scan the QR code with a phone. The dev server listens on your LAN, so phones can reach it.

For production:

```sh
pnpm build
KARAOKEJ_LIBRARY=/path/to/Karaoke pnpm start   # http://<host>:3000/screen
```

The first index of a large library takes a while (about 35 s for 2,000+ files over a network mount). After that, restarts only `stat` the files and re-read the ones that changed.

## Configuration

| Variable                  | Default            | Purpose                                                                                                                                         |
| ------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `KARAOKEJ_LIBRARY`        | (required)         | Folder containing `.kfn` files. Subfolders are fine, and the top-level folder becomes the category.                                             |
| `KARAOKEJ_DB`             | `data/karaokej.db` | SQLite index. It's safe to delete: it is rebuilt from the library.                                                                              |
| `PORT`                    | `3000`             | HTTP port.                                                                                                                                      |
| `HOST`                    | all interfaces     | Listen address.                                                                                                                                 |
| `KARAOKEJ_PUBLIC_URL`     | auto               | URL phones should open, used for the QR code. Auto-detected from the LAN IP when not set. Set it when running in a container or behind a proxy. |
| `KARAOKEJ_RESCAN_MINUTES` | `0`                | Re-index periodically. `0` means only at startup and on `POST /api/library/rescan`.                                                             |

## Using it

- **Screen:** browsers only allow sound after a click, so press **Start** once. Fullscreen can be toggled from the toolbar, which appears when you move the mouse, or by double-clicking or pressing `F`. The screen device plays the music, so it must stay awake: the screen asks the browser to keep the display on, but if you use a phone or tablet as the screen, also set its auto-lock to "never" while plugged in. Keep the screen tab visible, because browsers pause media loading in background tabs.
- **Remote:** search by title, artist or album. Accents are ignored, so "pokemon" finds "Pokémon". Tap a song to queue it, and use the **Queue** tab to reorder. The bar at the bottom controls playback. Remote phones can sleep freely: the queue lives on the server and plays on the screen, and a phone reconnects by itself when woken.

## Deploy with Podman and systemd (user service)

```sh
podman build -t localhost/karaokej .
mkdir -p ~/.config/karaokej ~/.config/systemd/user
cp deploy/systemd/karaokej.env.example ~/.config/karaokej/karaokej.env   # edit paths and URL
cp deploy/systemd/karaokej.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now karaokej
loginctl enable-linger "$USER"   # start at boot without logging in
journalctl --user -u karaokej -f
```

The service restarts the container if it crashes. It also restarts it if `/api/health` fails 3 times in a row, which happens when the database or the library mount becomes unavailable. To update, rebuild the image and run `systemctl --user restart karaokej`.

Notes:

- The library is mounted read-only, and the index lives in the `karaokej-data` volume.
- The unit runs the container with `--userns=keep-id`, so the app reads the library as your own user.
- **FUSE mounts** (rclone, sshfs) are invisible to containers unless mounted with `--allow-other` (and `user_allow_other` in `/etc/fuse.conf`).

## Development

```sh
pnpm dev            # Vite (5173) + API server with reload (3000)
pnpm story:dev      # Histoire component stories
pnpm test           # Vitest: parser, timeline, reducer, indexer, REST and WebSocket
pnpm lint && pnpm format:check && pnpm typecheck
```

- `src/kfn/`: the KFN parser, shared by the browser (which plays the files) and the server (which reads headers for the index)
- `src/shared/protocol.ts`: the REST and WebSocket types
- `server/`: Hono app, SQLite (`node:sqlite`) with plain SQL migrations, the incremental indexer, and the session reducer
- `src/views/`: `ScreenView` and `RemoteView`
- `histoire.offline.ts`: keeps the Histoire UI offline by dropping its Google Fonts import and serving its icons from local `@iconify-json/*` sets instead of the Iconify API

Database changes go in `server/db/migrations.ts` as a new entry. Never edit a released migration.

### KFN files and tests

**Never commit `.kfn` files.** They are copyrighted karaoke content, and `*.kfn` and `examples/` are gitignored. Tests build synthetic KFN files with `src/kfn/buildKfn.ts`. If you put real files in `examples/`, `tests/examples.local.test.ts` checks them locally. That test is skipped in CI.

## File format

The KFN format was described in UlduzSoft's reverse-engineering series:
[header](https://www.ulduzsoft.com/2012/10/reverse-engineering-the-karafun-file-format-part-1-the-header/),
[directory](https://www.ulduzsoft.com/2012/10/reverse-engineering-the-karafun-file-format-part-2-the-directory/),
[Song.ini](https://www.ulduzsoft.com/2012/10/reverse-engineering-the-karafun-file-format-part-3-the-song-ini-file/),
[encryption](https://www.ulduzsoft.com/2012/10/reverse-engineering-the-karafun-file-format-part-4-the-encryption/).

- `KFNB` magic, then header tags (4-char id + type byte; type 1 = int32, type 2 = length-prefixed bytes) up to `ENDH`.
- Directory: entry count, then per entry: name, type (1 Song.ini, 2 music, 3 image, 4 font, 5 video), length, offset (from the end of the directory), stored length, flags (1 = encrypted).
- Encrypted entries use AES-128-ECB with the 16-byte `FLID` header value as the key.
- `Song.ini` lyrics effects (`ID=1`) contain `TextN` lines, where `/` splits syllables and blank lines are breaks, and `SyncN` start times in 1/100 s, one per syllable. A song can have several lyrics effects (duets, backing vocals), and each gets its own band on the screen.
