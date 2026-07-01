# Hopprint

A personal beer logging PWA built for [gldesrosiers](https://github.com/gldesrosiers).

**Live:** https://gldesrosiers.github.io/hopprint

## What it is

A single-file progressive web app for logging and analyzing what you drink. No subscription, no ads, no social layer — just your data, owned by you.

## Features

- **Check In** — Fast mobile entry with full autocomplete from 1,230+ beers and 274+ breweries seeded from personal history. Selecting a beer auto-fills brewery, style, ABV, and location.
- **Have Again? rating** — Quick post-check-in rating (Never / Maybe / Definitely, with optional fine-tune) so every entry captures repurchase intent, not just a score.
- **Occasion tagging** — Log the context (home solo, bar/taproom, event, traveling, etc.) plus optional tags (with food, outdoors, celebrating, etc.)
- **Guided note prompts** — Rotating questions to encourage more intentional tasting notes
- **My Beers** — Full searchable history with inline editing and deletion
- **Analytics** — Activity by day/month/year, style breakdowns, venue and brewery rankings, YoY table, serve format, and more. Year-filter included. Pre-2024 data flagged as unique-beers-only.
- **Profile** — Auto-generated flavor identity, Wrapped-style annual summary, taste trend analysis
- **Discover** — Four recommendation modes (wheelhouse, adjacent, wildcard, random) with wishlist save. Context-aware (select your occasion first).
- **Export** — CSV and JSON export anytime. Untappd CSV import supported (including star-rating conversion).
- **Feedback** — In-app feedback capture (bug/idea/confusion/other) for testers, sent to a lightweight Supabase table.
- **Installable** — Full PWA manifest + icons + offline app-shell caching via service worker.

## Tech

Core app is pure HTML/CSS/JS — no framework, no build step, no backend for beer data. Data lives in `localStorage`. Seed data embedded from 2,645 Untappd check-ins (through May 2026).

The repo also includes standard PWA scaffolding alongside `index.html`: `manifest.json`, `sw.js` (service worker for offline app-shell caching), and an `icons/` folder. These are static assets only — no build step is introduced.

In-app feedback is sent to a small Supabase table (`feedback`, insert-only via RLS) — this is unrelated to the core beer-tracking data, which remains fully local until the Stage 2 Supabase migration.

## Data note

Pre-2024 entries represent unique first-time beers only (not total consumption). Full tracking began January 2024.

## Roadmap

- [ ] Supabase backend for cross-device sync
- [ ] Shared beer database with community contributions
- [ ] Availability signals from aggregate check-in data
- [ ] Public app with multi-user support
