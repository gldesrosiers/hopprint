# Hopprint

A personal beer logging PWA built for [gldesrosiers](https://github.com/gldesrosiers).

**Live:** <https://gldesrosiers.github.io/hopprint>

## What it is

A single-file progressive web app for logging and analyzing what you drink. No subscription, no ads, no social layer — just your data, owned by you.

## Features

- **Check In** — Fast mobile entry with full autocomplete from 1,230+ beers and 274+ breweries seeded from personal history. Selecting a beer auto-fills brewery, style, ABV, IBU, and location.
- **Occasion tagging** — Log the context (home solo, bar/taproom, event, traveling, etc.) plus optional tags (with food, outdoors, celebrating, etc.)
- **Guided note prompts** — Rotating questions to encourage more intentional tasting notes
- **My Beers** — Full searchable history with inline editing and deletion
- **Analytics** — Activity by day/month/year, style breakdowns, venue and brewery rankings, YoY table, serve format, and more. Year-filter included. Pre-2024 data flagged as unique-beers-only.
- **Profile** — Auto-generated flavor identity, Wrapped-style annual summary, taste trend analysis
- **Discover** — Four recommendation modes (wheelhouse, adjacent, wildcard, random) with wishlist save. Context-aware (select your occasion first).
- **Export** — CSV and JSON export anytime. Untappd CSV import supported.

## Tech

Pure HTML/CSS/JS — no framework, no build step, no backend. Data lives in `localStorage`. Seed data embedded from 2,645 Untappd check-ins (through May 2026).

## Data note

Pre-2024 entries represent unique first-time beers only (not total consumption). Full tracking began January 2024.

## Roadmap

- [ ] Supabase backend for cross-device sync
- [ ] Shared beer database with community contributions
- [ ] Availability signals from aggregate check-in data
- [ ] Public app with multi-user support