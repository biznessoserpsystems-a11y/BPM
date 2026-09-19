# The Bizness-Ph-OS desktop app

`desktop/` is a small, separate Electron shell — a branded native window
that opens your Bizness-Ph-OS server, so staff get a proper installed app
(Start Menu shortcut, its own icon, its own window) instead of having to
open a browser and type in an address every time.

## What this is — and isn't

**It's a thin client.** It does not bundle the Next.js server, Prisma, or
a database. When it launches, it connects to a Bizness-Ph-OS server that's
already running somewhere — the same LAN server or hosted instance covered
in `docs/offline-deployment.md` and `docs/deployment-checklist.md`.

This is deliberate, not a limitation to work around: the system is
multi-branch and multi-user, with every sale, transfer, and journal entry
sharing one ledger. An installer that bundled its own local server and
database would give each machine its own isolated copy of the data —
silently breaking shared inventory, inter-branch transfers, and the books
the moment more than one till is in use. One shared server, many thin
desktop clients pointed at it, is the correct shape here.

## First launch

On first launch (or if it can't reach the server it last used), the app
shows a simple screen asking for the server's address — the same address
you'd type into a browser (e.g. `192.168.1.20:3000` for a LAN server, or a
full `https://` address for a hosted one). It remembers this and connects
automatically after that. Staff can change it any time from the app's own
menu: **Bizness-Ph-OS → Change Server…**

If the server becomes unreachable while the app is open (network hiccup,
server restarted), it shows a friendly retry screen instead of a blank
page or a browser-style error.

## Building an installer

You don't build this locally — push a version tag and GitHub Actions
builds it for you, on real Windows/Mac/Linux runners rather than
cross-compiling:

```bash
git tag v1.0.0
git push origin v1.0.0
```

`.github/workflows/release.yml` picks that up and, a few minutes later,
attaches the finished installers to a GitHub Release on your repo:

- **Windows** — an NSIS installer (`.exe`), built on `windows-latest`
- **macOS** — a `.dmg`, built on `macos-latest`
- **Linux** — an `.AppImage`, built on `ubuntu-latest`

You can also trigger a build by hand from the **Actions** tab (choose
`release.yml` → **Run workflow**) without pushing a tag first — useful for
a test build. That path uploads the installers as a **draft** release
instead of a published one, so it won't show up for anyone until you
publish it.

## Building locally (optional, for testing changes to the shell itself)

```bash
cd desktop
npm install
npm run start        # runs the shell directly, no installer
npm run build:win    # or build:mac / build:linux — needs the matching OS
```

Building a Windows installer requires Windows (or Wine on Linux, which
isn't set up here); building a `.dmg` requires macOS. This is exactly why
the release workflow builds each target on its own native OS runner
instead of trying to cross-compile from one machine.

## The icon

`desktop/build/icon.ico` (Windows) and `desktop/build/icon.png` (Linux,
and the source electron-builder uses to derive a macOS icon) are
generated from `public/brand/logo-icon.png` — the same logo used
throughout the web app. If that logo changes, regenerate these to match
rather than letting the desktop app's icon drift from the web app's.

## Advanced: scripting the server address

For a fleet of machines you're setting up ahead of time, you can also
pre-populate the connection outside the setup screen. The app stores its
configured server as `server-config.json` in the OS's per-user app-data
folder for `bizness-ph-os-desktop` (Windows: `%APPDATA%`, macOS/Linux:
`~/.config` or `~/Library/Application Support`) — dropping a
`{"serverUrl": "http://192.168.1.20:3000"}` file there before first
launch skips the setup screen entirely.
