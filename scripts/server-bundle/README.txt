Bizness-Ph-OS — Server

This is the computer that will hold the pharmacy's actual data. Set this
up on ONE computer (the "host"). Every other till/office computer runs
the separate Bizness-Ph-OS desktop app and connects to this one — see
"desktop-setup" in the release you downloaded this from.

SETUP (one time)
-----------------
1. Extract this whole folder somewhere permanent on the host computer,
   e.g. C:\BiznessShopOS-Server\ — don't run it from inside a zip or from
   a USB drive you'll remove later.
2. Double-click start-server.bat.
3. The first time it runs, Windows may show a firewall prompt
   ("Windows Defender Firewall has blocked some features...") — click
   "Allow access" so other computers on your network can reach it.
4. A window will open showing two addresses:
     - one for using the app on this computer
     - one for every OTHER computer to use (starts with your network's
       address, e.g. 192.168.1.42)
   Write down the second one.
5. Leave this window open — closing it stops the server for everyone.
   See "Running automatically" below to avoid needing to remember this.
6. On this computer or any other, open the desktop app (or a web
   browser, pointed at the address from step 4) and use "Create a
   company" to set up your pharmacy's first real Admin account. You'll
   need a license token for this — see the main project's
   scripts/generate-license-token.js, or ask whoever provided this
   software.

DAY TO DAY
----------
Just double-click start-server.bat whenever you want the system
available, and leave the window open. To stop it, close the window (or
press Ctrl+C inside it).

RUNNING AUTOMATICALLY (recommended once you're set up)
-------------------------------------------------------
So staff don't have to remember to start it:
  - Simplest: put a shortcut to start-server.bat in this PC's Startup
    folder (Win+R, type shell:startup, press Enter, drop the shortcut
    in there) so it launches automatically when the computer turns on.
  - More robust: run it as a proper Windows service with a tool like
    NSSM (https://nssm.cc) so it survives without anyone logging in —
    see docs/offline-deployment.md in the main project repository for
    the full walkthrough.

BACKING UP YOUR DATA
---------------------
All of your pharmacy's data lives in one file: db\custom.db, next to
this README. Copy that file somewhere safe on a regular schedule (a USB
drive, another computer, etc.) — that one file IS the entire database.
The in-app Settings -> Backup & Restore does this for you from inside
the app itself.

OFFLINE BY DESIGN
------------------
Nothing in this folder ever contacts the internet — no license checks,
no update pings, no telemetry. node.exe here is a portable copy of
Node.js bundled just for running this server, not a system install.
