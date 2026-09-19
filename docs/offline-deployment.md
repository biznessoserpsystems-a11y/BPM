# Running Bizness-Ph-OS fully offline

This system is designed to run with **zero ongoing internet dependency**:
no license phone-home, no telemetry, no CDN scripts, no cloud database.
The only two moments that need internet at all are the ones every piece
of installed software needs — downloading it once, and (optionally)
downloading updates later.

## The two pieces

Because the system is multi-branch and multi-user — every sale,
transfer, and journal entry shares one ledger — "offline" here means one
shared **server** on your network, with thin **desktop clients**
connecting to it. It does not mean each computer gets its own isolated
copy of the data (see `docs/desktop-app.md` for why that would silently
break shared inventory and the books the moment more than one till is in
use).

1. **The server** — runs on one computer (the "host"): the actual
   application, the SQLite database, everything. This is what holds your
   pharmacy's real data.
2. **The desktop client** — a small branded window (`desktop/`) installed
   on every till/office computer, including the host itself if staff use
   it there too. It has no database of its own; it just displays whatever
   the server sends it, the same way a web browser would.

## Setting up the server (host computer)

Download `BiznessPhOS-Server-Windows.zip` from the project's
[Releases](../../releases) page (built automatically by
`.github/workflows/release.yml` whenever a version tag is pushed) and
follow the `README.txt` inside it. In short:

1. Extract the zip somewhere permanent, e.g. `C:\BiznessPhOS-Server\`.
2. Double-click `start-server.bat`.
3. Allow it through the Windows Firewall prompt the first time.
4. Note the network address it prints (e.g. `192.168.1.42:3210`) — every
   desktop client will need this.

That's it — no `npm install`, no internet access, no Node.js
installation required. The zip bundles:

- a **portable copy of Node.js** (`node.exe`) just for running this
  server — not a system-wide install
- the app itself, already built (`next build`'s standalone output)
- a **pre-migrated, pre-seeded SQLite database** (`template.db`),
  produced at build time by `scripts/build-template-db.js` — so the
  server never needs to run `prisma db push` or download a Prisma engine
  on your machine

The first time it runs, it copies `template.db` to `db\custom.db` (its
real, growing database) and generates a `config.json` holding a
`JWT_SECRET` and `FIELD_ENCRYPTION_KEY` unique to this install — treat
that file the same way you'd treat a password.

### Running it automatically

Staff shouldn't need to remember to start the server by hand. Two
options, in order of effort:

- **Startup folder (simplest)** — put a shortcut to `start-server.bat`
  in `shell:startup` (Win+R → type `shell:startup` → Enter) so it starts
  when the host computer turns on. Downside: it still needs someone
  logged in, and the console window stays visible.
- **Windows service (recommended for production)** — use
  [NSSM](https://nssm.cc) to register `start-server.bat` as a proper
  Windows service:
  ```
  nssm install BiznessPhOS "C:\BiznessPhOS-Server\start-server.bat"
  nssm start BiznessPhOS
  ```
  This runs it in the background, survives without anyone logged in, and
  can be set to restart automatically if it ever crashes
  (`nssm set BiznessPhOS AppExit Default Restart`).

### Backing up

Everything is one file: `db\custom.db`, next to wherever you extracted
the bundle. Copy it somewhere safe on a schedule you're comfortable
with — the in-app **Settings → Backup & Restore** does this from inside
the running app, or you can just copy the file directly while the
server isn't mid-write (stop the server first for a guaranteed-safe
copy, or use `Settings → Backup & Restore` which does this correctly
while running).

## Setting up each desktop client

Install the desktop app (from the same release — `.exe` for Windows) on
every other computer. On first launch, it asks for the server's
address — enter the one the host printed (e.g. `192.168.1.42:3210`). It
remembers this after that. See `docs/desktop-app.md` for the full
behavior (changing the server later, what happens if the server is
temporarily unreachable, etc.).

## Network requirements

All of this runs over your **local network only** — no internet needed
between the server and its clients. Requirements:

- All computers (host + clients) must be on the same local network
  (same office Wi-Fi/router, or wired LAN).
- The host computer's IP address can change if your router uses DHCP and
  reassigns it — for a permanent setup, give the host computer a static
  IP (or a DHCP reservation on your router) so you don't have to
  reconfigure every desktop client after a reboot.
- Windows Firewall must allow inbound connections on the server's port
  (handled by the "Allow access" prompt on first run).

## What genuinely needs internet (and only once)

- Downloading the release zip/installer files themselves.
- If you ever rebuild from source instead of using a release download:
  `npm install`, `npx prisma generate`, and `npx prisma db push` all
  need internet access to fetch packages and Prisma's query/schema
  engine binaries. This is exactly why the release workflow does that
  work once, on a machine with internet (GitHub Actions), and ships the
  result — so the pharmacy's own computer never has to.
