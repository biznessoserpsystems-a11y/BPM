# New site deployment checklist

A step-by-step run sheet for setting up Bizness-Ph-OS at a new pharmacy.
See `docs/offline-deployment.md` for the reasoning behind each step.

## 1. Cut a release (once per version — skip if one already exists)

```bash
git tag v1.0.0
git push origin v1.0.0
```

Wait for `.github/workflows/release.yml` to finish (check the **Actions**
tab), then confirm the **Releases** page has:

- [ ] `BiznessPhOS-Server-Windows.zip`
- [ ] A desktop installer per OS you need (`.exe` for Windows here)

## 2. Set up the host computer

- [ ] Pick which computer will be the host — ideally one that stays on
      during business hours and doesn't move networks
- [ ] Download and extract `BiznessPhOS-Server-Windows.zip` to a
      permanent location (e.g. `C:\BiznessPhOS-Server\`)
- [ ] Run `start-server.bat`
- [ ] Allow it through the Windows Firewall prompt
- [ ] Write down the network address it prints
- [ ] (Recommended) Give this computer a static IP / DHCP reservation on
      your router, so the address doesn't change later
- [ ] (Recommended) Set it up to run automatically — Startup folder
      shortcut, or NSSM as a service (see `docs/offline-deployment.md`)

## 3. Create the first company

- [ ] Generate a license token: on any machine with the source checked
      out and dependencies installed, run
      `node scripts/generate-license-token.js "<pharmacy name>" 1`
- [ ] On the host (or any desktop client once installed), open the app
      and use **Create a company**
- [ ] Enter the company name, code, admin username/password, and the
      license token
- [ ] Confirm you can log in as the new Admin

## 4. Install desktop clients

For the host computer itself (if staff will use the app there too) and
every other till/office computer:

- [ ] Install the desktop app (`.exe`/`.dmg`/`.AppImage` matching that
      computer's OS)
- [ ] On first launch, enter the host's network address from step 2
- [ ] Confirm it loads the login screen and you can sign in

## 5. Configure the company

Inside the app, as Admin:

- [ ] Settings → Company — logo, name, contact details
- [ ] Settings → Branches — add any additional branches beyond the
      default one
- [ ] Settings → Access Control — review roles if you need anything
      beyond the default Admin/Manager/Employee split
- [ ] Catalog → Products/Suppliers — start entering real inventory data
- [ ] Payroll → Tax & SSNIT Settings — verify the pre-filled PAYE bands
      and SSNIT rates are still current (GRA can update these — see the
      in-app link to GRA's own page)

## 6. Verify backups are happening

- [ ] Do a test backup via Settings → Backup & Restore
- [ ] Confirm someone knows where `db\custom.db` lives on the host and
      has it on a recurring backup schedule (external drive, another
      computer, etc.)

## 7. Handoff

- [ ] Give the host's network address to whoever manages IT at the site,
      in case a desktop client needs reconfiguring later
      (`Change Server…` in the desktop app's menu)
- [ ] Confirm staff know to leave the host computer's server window
      running (or that it's set up as a service per step 2)
