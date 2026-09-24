# SYNC_REVERSAL_WORKPLAN.md — Supabase as source of truth, client sync layer, wishlist table

**Status:** Decisions locked (SY1–SY13) in session dated below. Build not started. Any future session can begin cold from this document.
**Date:** September 20, 2026
**Scope:** Reverse the one-way sync decision (TS7) so Supabase holds the authoritative copy of every check-in and wishlist item, and localStorage becomes a fast local cache. Covers schema changes, the client sync layer, the login method change, the service worker change, and the one-time migration of Greg's existing data.
**Supersedes:** TS7 (one-way device → Supabase sync); TS6 (magic link → emailed 6-digit code); parts of PC7/PC8/O6 in `PROFILE_CREATION_UX_WORKPLAN.md` (see Part 6); the "migrate manually" half of PC10 (still manual, but now a script, see SY10).
**Depends on:** `TESTER_SUPABASE_HANDOFF.md` (schema, RLS/GRANTs, TS1–TS9), `PROFILE_CREATION_UX_HANDOFF.md`, `PROFILE_CREATION_UX_WORKPLAN.md` (auth gate, signup form).
**Does NOT cover:** Stage 3 normalized schema (`beers`/`breweries`/`styles`), account deletion (TS9), realtime subscriptions, conflict resolution beyond last-write-wins, OAuth/phone auth, Discover or Phase E work.

---

## Part 1 — Locked decisions (build against these, do not re-litigate)

Decision IDs use the `SY` (Sync) prefix, continuing the project's DD/DE/TS/PC convention.

| # | Decision |
|---|----------|
| **SY1** | **`updated_at` on `check_ins`, bumped by trigger.** Add `updated_at timestamptz not null default now()` plus a `before update` trigger that sets `new.updated_at = now()`. (The column default only fires on insert; the trigger is what makes edits and ratings visible to sync.) Backfill existing rows from `synced_at` **before** creating the trigger, or the backfill update will overwrite itself. `synced_at` is unchanged. The client's sync bookmark is the newest `updated_at` the **server** has returned — never the device clock — so a wrong phone clock cannot cause missed changes. |
| **SY2** | **Deletes are hard deletes, reconciled by an id check.** A delete removes the row for real (the existing `delete own` policy already allows it). To propagate deletes to other devices, the app fetches only the list of ids (`select=id`, paged) and drops any local row the server no longer has, **except** rows still in the pending pile (SY6). No `deleted_at` column, no purge job. Rationale: privacy-first — deleted means deleted. |
| **SY3** | **Supabase is the source of truth; localStorage is a cache (supersedes TS7).** On open: render the cache immediately, then pull changes from Supabase in the background. Writes go to the cache first and upload in the background (SY6). `hopprint_entries` remains the cache key. |
| **SY4** | **Client-generated uuids.** New check-ins and wishlist items get `crypto.randomUUID()` and send it as the row `id` (works offline — the id exists before upload; the table's `gen_random_uuid()` default stays as a fallback). Legacy numeric ids are **not** migrated in-app: the SY10 script assigns uuids, and the first pull-down replaces the local list. `handleImport`'s `Date.now() + Math.random()` ids become uuids. **Build-time catch:** history cards write the id unquoted into HTML (`onclick="openEdit(${e.id})"`); with string ids these break. Quote them at all three sites (entry card, "Rate it" badge, edit-modal rating link — `index.html` ~lines 2074, 2093, 2127). |
| **SY5** | **Check-in times are wall-clock time, plain `timestamp` (not `timestamptz`).** Change `check_ins.created_at` to `timestamp without time zone`. The app's analytics (weekday, month, year) and the edit modal (`created_at.slice(0,16)`) all assume the local wall-clock string from the `datetime-local` input; storing it as-is means "9pm is always 9pm," with no conversion step and no UTC-shift bug class. Trade-off accepted: the exact global instant is not recorded (nothing on the roadmap needs it yet). Run the `ALTER` while the table holds no real data; delete any test rows first. `updated_at` and `synced_at` stay `timestamptz` (server-side bookkeeping, not user-facing). |
| **SY6** | **Local-first writes with a pending pile.** Every add, edit, rating, and delete updates the local cache first (UI never waits on the network), then queues an upload. The pending pile is persisted in localStorage and survives closing the app. It retries on app open, on the browser `online` event, and after any successful upload. **Pending wins over pull-down:** a row with a pending edit is not overwritten by the server's older version, and a row with a pending delete is not resurrected. Conflict rule: last write wins (safe while effectively single-device). A small "N not synced" indicator shows while the pile is non-empty so nothing fails silently. |
| **SY7** | **Paging, batching, and shaping.** (a) Fetches page at 1,000 rows (PostgREST default cap) ordered by `(updated_at, id)`. (b) The bookmark query uses `updated_at >= bookmark` and de-duplicates by id — bulk inserts give every row in the batch the same `updated_at`, and a strict `>` could skip rows across a page boundary. (c) Uploads go up in chunks of ~500 as **upserts** (`on conflict (id)`), so retries cannot create duplicates. (d) Shaping on the way up: empty `beer_abv` → `null`; imported rows with no `created_at` are skipped and counted in the import diagnostic (the column is `not null`, and analytics can't place them). |
| **SY8** | **Login = 6-digit emailed code only (supersedes TS6 magic link).** Email screen → code-entry screen → existing PC9 `profiles`-existence branch. Client calls: `signInWithOtp({ email, options: { shouldCreateUser: true } })` then `verifyOtp({ email, token, type: 'email' })` (confirm against current Supabase docs at build time). Dashboard: **both** the "Magic Link" and "Confirm signup" email templates must contain the code placeholder (`{{ .Token }}`) — new users are sent the signup template, returning users the magic-link one; a template without the code leaves testers stuck. Confirm the OTP length setting is 6 and review the expiry. Reason: on iOS, an emailed link opens Safari, which does not share a login with the installed home-screen PWA. |
| **SY9** | **Service worker leaves Supabase alone.** `sw.js` currently serves cross-origin GETs cache-first, which would return stale `check_ins` and store authenticated responses in Cache Storage. Add an early return (no `respondWith`) for any `*.supabase.co` request, and bump `CACHE_NAME` (`hopprint-v1` → `hopprint-v2`) so existing installs pick it up. Must ship no later than the pull-down phase. |
| **SY10** | **Greg's existing data moves in via a one-off script, not in-app code.** Claude Code (Supabase MCP or REST with the service role key — never committed, never client-side) inserts the exported entries and wishlist under Greg's `user_id`, assigning uuids. The app's own pull-down then loads them; matching counts prove the pipeline end to end. Sequence in Part 4 (Phase 5). TS8 (testers get a clean start) is unchanged. |
| **SY11** | **Wishlist gets a table now.** `wishlist` mirrors `check_ins` conventions (DDL in Part 3). Wishlist items gain uuids and removal switches from array index (`removeWish(i)`) to id. Same sync rules as check-ins: local-first + pending pile (SY6), hard delete + id check (SY2), incremental via `updated_at` (SY1). `added_at` stays `timestamptz` — the app already stores it as a true instant (`toISOString()`), so no conversion is needed. The wishlist becomes exportable; the **entries** JSON export shape is unchanged so migration backups are unaffected. Duplicate-item handling is left open (Part 5). |
| **SY12** | **Official Supabase SDK via CDN (resolves O1).** Load `@supabase/supabase-js` as a UMD `<script>` from a CDN, pinned to an exact version (no floating tag), consistent with how Chart.js loads. Create the client with `persistSession: true`, `autoRefreshToken: true`, and `detectSessionInUrl: false` (no redirect flow under SY8). Keep the legacy JWT-format anon key (`eyJhbGci…`). The existing hand-rolled `feedback` `fetch` may stay as is. |
| **SY13** | **Action item, not yet a decision: check the Supabase dashboard before recruiting testers.** Look at (1) plan tier, (2) whether the project auto-pauses after inactivity (a paused project fails or stalls the first request), (3) the hourly limit on the built-in email sender (a low limit could block onboarding 10–15 testers; a custom email provider may be needed). If any is a problem, upgrading or adding an email provider becomes a real decision with a cost — bring the facts back before deciding. |

---

## Part 2 — Canonical flows (the spec every build step implements)

### App open
1. Load `hopprint_entries` and `hopprint_wishlist` from cache; render immediately.
2. Check session (`getSession()`). No session → email/code gate (PC7).
3. Flush the pending pile (SY6).
4. Pull changes since the bookmark, paged (SY1/SY7); merge into the cache with **pending wins** (SY6).
5. If an id check is due, run it and drop local rows the server no longer has (SY2), skipping pending rows.
6. Save the new bookmark. Re-run the post-pull refresh: `buildLiveLists()`, `updateHeaderMeta()`, `renderWishlist()`, and re-render the active tab (autocomplete and headers are built once at `init()` from the cache).

### Any write (add / edit / rating / delete, check-in or wishlist)
1. Update the local cache and re-render (no network wait).
2. Add or update the item in the pending pile.
3. Attempt upload in the background (upsert or delete); on success, remove from the pile and advance nothing else — the bookmark only moves on pull.
4. On failure, leave in the pile; the indicator shows the count; retry per SY6.

### Five check-in write sites today
`submitCheckin` (insert) · `saveRating` (update — the rating is a **second** write after the insert) · `saveEdit` (update) · `deleteEntry` (delete) · `handleImport` (bulk insert). Wishlist: `addWishlistItem` (insert) · `removeWish` (delete).

---

## Part 3 — Schema changes (DDL)

Run in order, via the Supabase MCP after review. Verify each with a query before moving on.

```sql
-- ═══════════════════════════════════════════════════════════════
-- SY5: created_at becomes wall-clock time
-- Run only while check_ins holds no real data (delete test rows first).
-- ═══════════════════════════════════════════════════════════════
alter table check_ins
  alter column created_at type timestamp
  using created_at at time zone 'UTC';

-- ═══════════════════════════════════════════════════════════════
-- SY1: updated_at + trigger (backfill BEFORE creating the trigger)
-- ═══════════════════════════════════════════════════════════════
alter table check_ins add column updated_at timestamptz not null default now();
update check_ins set updated_at = synced_at;

create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger check_ins_set_updated_at
  before update on check_ins
  for each row execute function set_updated_at();

create index idx_check_ins_user_updated on check_ins(user_id, updated_at);

-- ═══════════════════════════════════════════════════════════════
-- SY11: wishlist
-- ═══════════════════════════════════════════════════════════════
create table wishlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  beer_name text not null,
  brewery_name text,
  beer_type text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_wishlist_user_updated on wishlist(user_id, updated_at);

create trigger wishlist_set_updated_at
  before update on wishlist
  for each row execute function set_updated_at();

alter table wishlist enable row level security;

grant select, insert, update, delete on wishlist to authenticated;

create policy "wishlist: select own" on wishlist for select using (auth.uid() = user_id);
create policy "wishlist: insert own" on wishlist for insert with check (auth.uid() = user_id);
create policy "wishlist: update own" on wishlist for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "wishlist: delete own" on wishlist for delete using (auth.uid() = user_id);
```

**Local ↔ table field mapping (wishlist):** `name` → `beer_name`, `brewery` → `brewery_name`, `style` → `beer_type`, `added` → `added_at`, plus a new local `id` (uuid).

**Live-state note:** the DDL in `TESTER_SUPABASE_HANDOFF.md` shows no update grant on `check_ins`; the live database has an update grant and an own-row update policy (`using` + `with check`) per the `PROFILE_CREATION_UX_HANDOFF.md` addendum. Confirm this in the dashboard before Phase 2 — SY6/SY7 upserts depend on it.

---

## Part 4 — Build phases (additive, phased per project convention)

Each phase is additive. Existing functions verified byte-identical post-build except those named. `node --check` on the inline script after each phase. Decisions-before-build stands: any new ambiguity goes back to Part 5 before code.

### Phase 0 — Schema
- Run the Part 3 DDL (SY5, SY1, SY11); confirm the live update grant/policy on `check_ins`.
- **Deliverable:** verification queries show `created_at` is `timestamp`, `updated_at` bumps on update, `wishlist` exists with RLS on and four policies.

### Phase 1 — SDK + auth (code login)
- Resolve nothing new: SY12 is locked. Add the pinned SDK script and client.
- Run `PROFILE_CREATION_UX_WORKPLAN.md` Phases 1, 3, and 4 (gate, signup form, `terms.html`) as written, with the Part 6 substitutions. **Replace its Phase 2** (magic-link redirect handler) with the code flow: email screen → code screen (echo the address, resend cooldown ~30–60s, "wrong or expired code" messages) → PC9 branch.
- Dashboard: update both email templates (SY8), confirm OTP length/expiry.
- **Deliverable:** a new email completes email → code → signup form → app; a returning user with a persisted session skips all of it.

### Phase 2 — Sync core (upload side)
- uuid ids (SY4) including the three quoted-id fixes; wishlist ids and `removeWish` by id.
- Pending pile, upload shaping, and upsert/delete calls at the five check-in write sites and the two wishlist write sites (SY6/SY7).
- "N not synced" indicator.
- **Deliverable:** with a signed-in account, every add/edit/rating/delete reaches Supabase; airplane-mode writes appear after reconnecting; retries create no duplicates.

### Phase 3 — Pull-down + service worker
- `sw.js` exclusion and cache bump (SY9) — ship with or before the pull-down code.
- Paged, bookmark-based pull; pending-wins merge; id check (SY2); post-pull refresh (Part 2 step 6). Applies to `check_ins` and `wishlist`.
- **Deliverable:** clearing browser storage and signing back in restores the full history; a check-in deleted on one device disappears from another after its next id check.

### Phase 4 — First-load and edge states
- Resolve the Part 5 first-load items (welcome modal, empty-state flash, export-before-sync) and build what they decide.
- **Deliverable:** a returning user on a fresh device never sees the welcome modal or an "empty" state while the first pull is in flight.

### Phase 5 — Greg's migration (SY10)
Prerequisites: Phases 1–3 shipped; Greg has an account and `profiles` row (through the real signup flow).
1. **Backup:** export JSON (entries) and copy the local wishlist; store both outside the browser.
2. **Audit** the export: blank `created_at`, blank `beer_name`, non-numeric ABV, `rating` outside 0–100, unexpected `rating_mode`/`source` values, duplicate `beer_name|created_at` pairs. Decide skips before inserting.
3. **Rehearse** on a scratch account end to end (insert → sign in → pull-down → compare counts).
4. **Freeze:** no logging during the switch. Copy `hopprint_entries` to a backup key (e.g. `hopprint_entries_premigration`) before the first pull-down on the real account.
5. **Insert** entries and wishlist under Greg's `user_id` in ~500-row upserts, assigning uuids, keeping `created_at` as entered, `beer_abv` `''` → `null`, undated rows skipped and listed.
6. **Verify:** open the app; pull-down loads everything; count equals the export minus documented skips; spot-check styles, ratings, dates (a few evening check-ins land on the right day and hour).
7. Keep the JSON backup and premigration key until verified across a few days of real use.

### Phase 6 — Test battery
Real-source-pulled tests (no reimplementation) per project discipline: upload shaping (ABV blank, undated skip), pending-wins merge, id check skips pending rows, bookmark paging with tied `updated_at`, upsert retry idempotence, quoted-id rendering, wishlist remove-by-id. Byte-identical preservation of untouched functions. `node --check` on the full inline script. Tests are written alongside each phase and consolidated here.

---

## Part 5 — Open items (not decided — resolve before or during the phase named)

| # | Item | Phase |
|---|------|-------|
| **OS1** | **First-load welcome modal.** `init()` calls `maybeShowWelcome()` synchronously against the cache. On a fresh device (empty cache, no welcomed flag) a returning user would wrongly see the first-run modal before the first pull finishes. Decide: gate it on "first pull completed," and what shows meanwhile. | 4 |
| **OS2** | **Empty-state flash on a new device.** The improved empty states (with CTAs) would show while the first pull is in flight. Decide the loading state. | 4 |
| **OS3** | **Export before first sync.** Exports read the cache; on a new device mid-pull they would be partial. Decide: block, warn, or wait for the pull. | 4 |
| **OS4** | **Sign-out and shared devices.** Should signing out clear the local check-in/wishlist cache? Privacy suggests yes; needs a decision and a sign-out UI (none exists yet). | 1–2 |
| **OS5** | **Id-check frequency.** Working default: once per calendar day on open, plus a manual refresh. Tunable; not locked. | 3 |
| **OS6** | **Sync-status indicator** placement and copy. | 2 |
| **OS7** | **Wishlist duplicates.** No uniqueness rule today; decide whether to add one later. Low stakes. | later |

---

## Part 6 — Corrections needed in existing docs

- `TESTER_SUPABASE_HANDOFF.md`: TS6 (magic link → emailed code, SY8); TS7 (one-way → superseded by SY3, and the "no update grant" line is stale — live DB has one); DDL sample (`created_at` type, `updated_at`); add pointer to this workplan.
- `PROFILE_CREATION_UX_WORKPLAN.md`: PC6 wording ("magic link only"); PC8 email-screen copy (add the code screen); Part 2 flow steps 2–3 (no redirect — code entry instead); O6 (expired-link errors → wrong/expired-code errors); Phase 2 (replaced, see Phase 1 above); PC10 (script, not manual import).
- `PROFILE_CREATION_UX_HANDOFF.md`: none required beyond the update-grant addendum already present.

---

## Part 7 — Explicitly out of scope

- Stage 3 normalized schema and the beer/brewery dedup migration it requires
- Account deletion (TS9) — note that deleting individual check-ins now propagates across devices (SY2), but full account deletion is still not possible for anyone
- Conflict resolution beyond last-write-wins; realtime subscriptions
- OAuth / phone auth (PC6 stands for the deferral)
- Syncing the Discover suppression list or the welcome flag (both stay per-device local)

---

## Cross-references

- `TESTER_SUPABASE_HANDOFF.md` — schema DDL, RLS/GRANT policies, TS1–TS9
- `PROFILE_CREATION_UX_WORKPLAN.md` — auth gate, signup form, PC1–PC10, O1–O6 (O1 resolved as SY12)
- `PROFILE_CREATION_UX_HANDOFF.md` — update-grant addendum
- `GO_PUBLIC_CHECKLIST.md` — Tier 0/1/2/3 structure
- `index.html` — build target; key anchors (project copy): `init()` ~1681, `submitCheckin` ~1855, `saveRating` ~1965, `save()` ~2050, `saveEdit` ~2143, `deleteEntry` ~2164, `addWishlistItem` ~3737, `removeWish` ~3769, `handleImport` ~3795, unconditional `init()` call ~3950
- `sw.js` — cross-origin cache-first branch (SY9)
