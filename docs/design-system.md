# Design System: "Apothecary Ledger"

## The brief, in one sentence

Bizness-Ph-OS is used for hours a day by pharmacy staff doing precise,
high-stakes work — dispensing medicine and handling money. The redesign's
job: make the daily-use interface feel calm, precise, and trustworthy —
like a well-run apothecary's own record book — while staying fast to scan
across data-dense screens.

## What was replaced

The original build used shadcn/ui's out-of-the-box defaults almost
unmodified: bright generic "emerald" green (`oklch(0.627 0.194 149.214)`,
Tailwind's literal `emerald-600`), a pure-white background, and Geist/Geist
Mono — the same look thousands of AI-generated dashboards ship with. None
of it was wrong, exactly, but none of it was *this* app either.

## Color

A deep, desaturated bottle-glass green replaces the bright default —
noticeably darker and less saturated than generic emerald, meant to read
as glass and ink rather than mint and neon:

| Token | Value | Used for |
|---|---|---|
| `brand-600` (primary) | `oklch(0.42 0.095 155)` | Buttons, links, primary actions |
| `brand-50`–`brand-950` | full scale, same hue | Tints, borders, the dark sidebar |
| `amber-500` (accent) | Tailwind default amber | The *one* accent — active nav indicator, avatar badges, login hero icons |
| Background | `oklch(0.985 0.004 155)` | Cool, barely-tinted clinical paper — deliberately not the warm cream (`#F4F1EA`-ish) that's become an AI-design cliché |

Amber is used narrowly and consistently — it never competes with the green
for attention, it just marks "this is active" or "this is the brand mark."

## Type

Three faces, each with one job:

- **Fraunces** (display) — used in exactly two places: the login screen's
  headline, and the Dashboard's KPI figures. Both are genuine "glance at
  this first" moments; everywhere else stays quiet on purpose.
- **IBM Plex Sans** (body/UI) — every table, form, button, label. Chosen
  over the ubiquitous Inter/Geist for a more technical, clinical character
  that still stays out of the way at data-table sizes.
- **IBM Plex Mono** (codes) — see below.

## The signature: code chips

This system runs on reference codes — SKU, batch number, invoice number,
journal entry number, transfer code, Rx number, asset code, lease code,
contract code. Every single one, across every view, now gets the identical
treatment: IBM Plex Mono, in a small bordered chip with a brand-tinted
background (`bg-brand-50 text-brand-800 border-brand-200`).

It's a small, cheap, systemic choice — but it's *everywhere*, which is
what makes it a real signature rather than decoration on one page. It also
does real work: a code now visually announces itself as "this is a
reference number, not a description" the instant you see it, across all
14 tables that display one.

One deliberate exception: the Audit Log's `entityId` column stays plain
muted text, not chipped — it's a secondary technical trail in an already
dense list, and chip-ing every row there would be noise, not signal.

## Shell

The sidebar moved from a light, generically-templated look to a deep ink
panel (`--sidebar`), with the amber accent marking the active item as a
left border — closer to a bookmark ribbon than a filled pill. It's the one
surface visible on every single screen, so it carries the most identity.

## Radius

Tightened from the shadcn default (`0.625rem`) to `0.4rem` — crisper,
closer to a precision instrument than a soft consumer-app bubble, without
going all the way to the sharp-cornered "broadsheet" look.

## What to reuse going forward

- New view/component? Reference codes go in a `font-mono text-xs px-1.5
  py-0.5 rounded bg-brand-50 text-brand-800 border border-brand-200` span —
  match the existing pattern exactly.
- Primary actions: `bg-brand-600 hover:bg-brand-700`.
- Don't reach for Fraunces or the amber accent outside their established
  roles — that's what keeps them meaning something.
