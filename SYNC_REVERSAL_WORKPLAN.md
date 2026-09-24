# SYNC_REVERSAL_WORKPLAN.md — Supabase as source of truth, client sync layer, wishlist table

**Status:** Decisions locked (SY1–SY13) in session dated below. Phase 0 (schema) and Phase 1 (SDK + code login) complete September 23, 2026; Phase 2 (upload side) verified live; Phase 3 (pull-down) verified live; Phase 4 (first-load states) verified live; Phase 5 (Greg's migration) next. **Do not push `main` until Phase 5.** Any future session can begin cold from this document.
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
- **✅ Done — September 23, 2026.** Migrations applied (Supabase migration names): `sy1_check_ins_updated_at_trigger`, `sy11_wishlist_table`, `sy5_check_ins_created_at_wall_clock`, `revoke_truncate_on_user_tables`, `revoke_truncate_profiles_feedback_and_defaults`. SY5 ran after SY1/SY11 (independent; table was empty). Verified:
  - Pre-flight: `check_ins` held 0 rows (no test rows to delete); `authenticated` has the update grant and `check_ins: update own` has both `using` and `with check` — Part 3 live-state note confirmed.
  - `check_ins.created_at` is `timestamp without time zone`; `updated_at`/`synced_at` are `timestamptz`.
  - Trigger test in a rolled-back transaction (throwaway `auth.users` row): inserting with `updated_at = 2020-01-01` then updating bumped it to `now()` on both `check_ins` and `wishlist`; `created_at` `'2026-09-23 21:00'` read back unshifted. Post-test counts: 0 users, 0 check-ins, 0 wishlist rows.
  - `wishlist`: 7 columns, RLS on, four own-row policies, trigger + `(user_id, updated_at)` index. Security advisors: no lints.
- **Security fix found during Phase 0 (outside SY1–SY13):** Supabase's default privileges had granted `TRUNCATE`, `REFERENCES`, and `TRIGGER` to `anon` and `authenticated` on every public table. `TRUNCATE` bypasses RLS — anyone holding the public anon key could have wiped all users' rows. Revoked on `check_ins`, `wishlist`, `profiles`, and `feedback`, and removed from the schema's default privileges so future tables don't inherit it. `anon` now holds no table privileges on `check_ins`/`wishlist`; `authenticated` holds exactly `select, insert, update, delete`. Any future table still needs its own explicit grants (as SY11 does).

### Phase 1 — SDK + auth (code login)
- Resolve nothing new: SY12 is locked. Add the pinned SDK script and client.
- Run `PROFILE_CREATION_UX_WORKPLAN.md` Phases 1, 3, and 4 (gate, signup form, `terms.html`) as written, with the Part 6 substitutions. **Replace its Phase 2** (magic-link redirect handler) with the code flow: email screen → code screen (echo the address, resend cooldown ~30–60s, "wrong or expired code" messages) → PC9 branch.
- Dashboard: update both email templates (SY8), confirm OTP length/expiry.
- **Deliverable:** a new email completes email → code → signup form → app; a returning user with a persisted session skips all of it.
- **✅ Verified end to end — September 23, 2026 (local server).** Greg signed up with a new email: code email delivered through the custom SMTP → code verified → signup form → app. The `profiles` row was checked in the database: email copied from `auth.users`, username/birthdate/location codes/optional fields as entered, `consent_timestamp` stamped at submit, `terms_version = '2026-09-23'`. Not yet pushed (pushing to `main` deploys the gate to GitHub Pages).
  - **SY13 email sender, resolved:** Supabase's built-in sender only delivers to organization team members (other addresses fail with "Email address not authorized"), and its templates can't be edited without custom SMTP. Custom SMTP is now set up, sending from a subdomain of Greg's existing related-site domain (testers know him from it). The Magic Link and Confirm signup templates carry `{{ .Token }}`. OTP length is 6 and expiry 3600s (confirmed in the dashboard). Moving to a Hopprint domain later is a dashboard SMTP change only; no code change. SY13's other checks (plan tier, auto-pause) are still open.
  - **Decisions made at build start** (PROFILE_CREATION_UX_WORKPLAN.md open items): **O2** email is copied from the session user into `profiles.email`. **O3** usernames are lowercased, 3–20 of `a-z 0-9 _`, checked as typed; a collision is caught on submit ("That username's taken — try another."). No live availability check (RLS hides other users' profiles). Rule is client-side only; the DB enforces uniqueness only. **O4** `terms_version = '2026-09-23'`, shown on `terms.html` as "Last updated". **O5** land on Check In. **OS4** Sign Out button on the Profile tab (Account section), `signOut({ scope: 'local' })`, **keeps** the local cache. **Terms** `terms.html` is a plain-language draft marked DRAFT; its contact email is a placeholder to fill before inviting testers.
  - **Stored formats (new):** `location_country` holds ISO codes `US` / `CA` / `MX`; `location_state` holds USPS codes (`CO`), null outside the US. Gender values match `profiles_gender_check`.
  - **Offline behavior (new):** after a successful profiles check the user id is saved under `hopprint_profile_ok`. On later opens that user goes straight to the app with no network round-trip. If the access token has expired while offline, a known user is still let in (supabase-js keeps the stored session and refreshes it once online). With no network and no known user, a "Can't reach Hopprint — Try Again" screen shows. If the SDK script itself failed to load, the same rules apply.
  - **SY9 shipped early (in Phase 1, not 3):** the Phase 1 session and `profiles` reads are GETs the worker would otherwise cache. `CACHE_NAME` was already `hopprint-v2` from the brand refresh, so it went to `hopprint-v3`.
  - **SDK:** `@supabase/supabase-js@2.117.1` UMD from jsDelivr (cdnjs doesn't carry it).
  - **Checks:** `node --check` passes; token guard passes; all 122 pre-existing inline functions byte-identical to the previous commit (only the bottom `init();` call became `authBoot();`, and the Account markup was appended to the Profile-tab template). `tests/auth.test.js` (13 tests, real-source-pulled) passes: age cutoff incl. Feb 29 clamp, username rules, profile row shaping, insert-error mapping, auth-error mapping, gender/country/state options vs constraints, SDK pin, SW bypass, terms version. Browser check: gate renders with shell hidden and no console errors; inline validation; code field; resend cooldown; no horizontal scroll at phone width; gate → app handoff.
  - **⚠ Carry into Phase 2 (consequence of OS4 = keep cache):** after one person signs out and another signs in on the same device, the cache still holds the first person's check-ins. Phase 2 must not upload cache rows it didn't create for the current user. Tie the pending pile and cache to a `user_id`, and don't auto-queue pre-existing rows.
  - **Still open before inviting testers:** fill the contact email in `terms.html`; SY13 plan-tier and auto-pause checks.

### Phase 2 — Sync core (upload side)
- uuid ids (SY4) including the three quoted-id fixes; wishlist ids and `removeWish` by id.
- Pending pile, upload shaping, and upsert/delete calls at the five check-in write sites and the two wishlist write sites (SY6/SY7).
- "N not synced" indicator.
- **Deliverable:** with a signed-in account, every add/edit/rating/delete reaches Supabase; airplane-mode writes appear after reconnecting; retries create no duplicates.
- **✅ Verified live — September 23, 2026 (local server, Greg's account).** API edge logs show each path hit once: check-in POST 201 (rating debounced into the same insert), wish list POST 201, edit POST 200 (update to the same id), check-in DELETE 204, wish list DELETE 204, no requests while offline, then the offline check-in POST 201 on reconnect. End state: exactly one check-in, 0 wish list rows, no duplicates; `created_at` stored as local wall-clock time. Not pushed.
  - **Observed, pre-existing (not Phase 2):** the check-in form's date is set when the form resets after the previous check-in, not at submit, so a check-in logged minutes later carries the earlier time unless changed.
  - **Decisions made at build start:** **OS6** a header pill next to "Check can date". Hidden when nothing is pending; otherwise shows "⟳ N not synced", or "⟳ Syncing…" during an upload. Tapping it retries now and toasts the result. **Owner guard** (the Phase 1 carry-over): the first account to sign in on a device owns its cache (`hopprint_cache_owner`). If a different account signs in, the pill reads "Sync paused" and nothing uploads. That account's own new rows are still queued, tagged with its id, so Phase 3's pull-down (pending wins) can keep and upload them. Its edits to the owner's rows stay local. Phase 3 lifts the pause when the pull-down replaces the cache.
  - **Pending pile:** `hopprint_pending`, one entry per row (`table:id` → `{op, owner, seq}`). A later write replaces an earlier one, and a delete wins. The upload always sends the row's *current* cached version. `seq` ensures an upload that lands after a newer write doesn't clear the newer one. Flush triggers: app open, the browser `online` event, a restored or refreshed session, 1.5s after any write (debounced; the rating slider saves on every tick), a tap on the pill, and again if anything was written during a flush.
  - **Upload rules:** upserts go up in chunks of 500 with `onConflict: 'id'`; deletes in chunks of 100 via `in('id', …)` (ids travel in the URL). A network error or rejected session (`PGRST3xx`/401) stops the flush and leaves the pile intact. A data error on a chunk falls back to row-by-row, so one bad row can't hold back the rest; the bad row stays pending and shows in the count.
  - **Interpretations (flag if wrong):** (1) SY7(d) undated CSV rows are skipped at import entirely, not just at upload. They would never upload, and Phase 3's id check would drop them anyway. The import diagnostic reports the count. (2) Non-numeric ABV (e.g. "N/A") is sent as `null`, like blank. (3) `saveEdit` still allows clearing a beer name or date. Such a row can't be sent (not-null columns) and stays in the "not synced" count until fixed. (4) Legacy numeric-id check-ins are never queued (SY4), so edits and deletes to them stay local until SY10. (5) Pre-sync wish list items get a uuid on load (needed for remove-by-id) but are not queued.
  - **For Phase 5 (SY10):** the migration script must **keep existing uuids** (post-Phase-2 check-ins and all wish list items already have them) and upsert on `id`, so rows already uploaded aren't duplicated.
  - **For Phase 3:** a tester who used the app before sign-in existed has legacy rows that never upload (TS8 clean start). The first pull-down replaces the local list, so those rows would disappear from that device. Decide in Phase 3/4 whether to warn or offer an export first.
  - **Functions changed** (all others byte-identical): `submitCheckin`, `saveRating`, `saveEdit`, `deleteEntry`, `handleImport`, `addWishlistItem`, `removeWish` (write sites), `renderHistory`, `openEdit` (quoted ids via `idArg`), `renderWishlist` (remove by id), `enterApp` (claim owner, flush on open). Header markup gained a `.header-right` wrapper for the pill.
  - **Checks:** `node --check`, token guard, `tests/auth.test.js` (13) and `tests/sync.test.js` (20) all pass: 33 tests. The sync tests run the real flush code against a fake Supabase client: 500-row chunking, offline retry resending the same ids, an expired session stopping the flush, bad-row isolation, a mid-upload edit sent next, chunked deletes, wish list field mapping, owner guard both ways, and undated-import skip. The mid-upload test caught a real bug (a superseded upload wasn't followed by a re-flush), which is now fixed. A browser check with a fake local user covered owner claim, the pill states and remove-by-id; no console errors.

### Phase 3 — Pull-down + service worker
- `sw.js` exclusion and cache bump (SY9) — ship with or before the pull-down code.
- Paged, bookmark-based pull; pending-wins merge; id check (SY2); post-pull refresh (Part 2 step 6). Applies to `check_ins` and `wishlist`.
- **Deliverable:** clearing browser storage and signing back in restores the full history; a check-in deleted on one device disappears from another after its next id check.
- **✅ Verified live — September 23, 2026 (two local origins as two devices, Greg's account).** Edge logs: each fresh sign-in did a full pull plus id check for both tables (the full history was restored after clearing site data). A check-in added on one tab appeared on the other within 1–3s, as did a rating edit (incremental pulls using the bookmark, which advanced to the new row's `updated_at`). A delete reached the server (DELETE 204) but, as designed, did not propagate on the other tab's incremental pull. "Sync Now" (forced id check) removed it. End state in the database matches.
  - **Observed behavior, kept:** supabase-js fires a `SIGNED_IN` auth event when a tab or app becomes visible again, and the app already runs `syncNow()` on that event. So every return to the app flushes and pulls, which in practice is the "on open" sync for a PWA resumed from the background. Cost: two small GETs (only changed rows).
  - **OS5 reconfirmed after seeing this:** deletions still wait for the daily id check or Sync Now; the id check is not added to every resume.
- SY9 already shipped in Phase 1.
  - **Decisions:** **OS5** keep the default: id check once per calendar day on open, plus a manual "⟳ Sync Now" button (Profile → Account), which forces it. **Deploy order:** Phase 3 is **not pushed to the live site before Phase 5**. The first pull replaces the local list, so Greg's legacy check-ins would vanish from the live app until SY10 puts them in Supabase. Since `main` now holds Phase 3, **nothing on `main` gets pushed until Phase 5 is done** (or Phases 1–2 would need their own branch).
  - **How it works:** on open (and on the `online` event, a restored session, the pill, and Sync Now) the app runs `syncNow()`: flush pending, then pull. The pull pages at 1,000 rows ordered by `(updated_at, id)`. The first page uses `updated_at >= bookmark`; later pages use a keyset `or=(updated_at.gt.T,and(updated_at.eq.T,id.gt.ID))`, so rows tied on one bulk-insert timestamp can't be skipped at a page boundary. The bookmark is the newest `updated_at` the server returned, stored per user in `hopprint_sync_state`. All network reads finish before any merge, and the merge runs synchronously against the *current* cache, so a write made mid-pull is never overwritten. Pending wins. The id check fetches `select=id` paged by id and drops local rows the server lacks, except pending ones. Because a fresh device has never had an id check, its first pull replaces the local list (SY4). After a pull that changed something: `buildLiveLists()`, `updateHeaderMeta()`, `renderWishlist()`, and a re-render of the active tab. Flush and pull never overlap: a flush during a pull reschedules, and a pull during a flush is skipped (the flush's own chain covers it).
  - **Shared-device take-over:** when a different account signs in (sync paused), the pull takes the cache over *only if the previous owner has no unsynced rows*. It then resets sync state so the forced id check replaces the old rows with this account's own. If the previous owner still has unsynced rows, the device stays paused (the pill reads "Sync paused") until that owner signs in and syncs.
  - **Server → cache shape:** same keys and order as `submitCheckin` builds (the JSON export shape is unchanged), null text → `''`, ABV → string, `user_id`/`updated_at`/`synced_at` not stored locally. Check-ins are sorted newest first after a merge (history renders in array order); wish list items oldest first.
  - **Functions changed** (all from Phases 1–2; no original app function touched): `enterApp`, `flushPending`, `updateSyncPill`, `onSyncPillTap`. Account section gained "⟳ Sync Now".
  - **Checks:** `node --check`, token guard, 52 tests passing (`auth` 13, `sync` 20, `pull` 19). `tests/pull.test.js` runs the real pull code against an in-memory server that applies the actual filters: 2,500 rows in three tied-timestamp batches (none skipped), bookmark-only second pull, daily vs forced id check, cross-device delete and edit, offline pull leaving the cache and bookmark untouched, first pull replacing legacy rows but keeping pending ones, take-over allowed and refused, flush/pull exclusion. Browser boot check clean. (The test extractor now skips default-parameter braces like `(opts = {})`.)

### Phase 4 — First-load and edge states
- Resolve the Part 5 first-load items (welcome modal, empty-state flash, export-before-sync) and build what they decide.
- **Deliverable:** a returning user on a fresh device never sees the welcome modal or an "empty" state while the first pull is in flight.
- **✅ Verified live — September 23, 2026 (local server, Greg's account).** (1) After clearing site data and signing in, the loading note showed briefly, history restored, and there was no welcome modal. (2) With `hopprint_sync_state` removed and the network offline, the "Can't reach Hopprint" note showed with export disabled, and the list loaded by itself on reconnect. (3) With a seeded legacy row, the pre-sync prompt showed "1 check-in", Export downloaded it, and Continue removed it. Not pushed (Phase 3 rule: nothing on `main` until Phase 5).
  - **Decisions (Greg, all four recommendations):** **OS1** the welcome modal is decided only after this device's first full pull, and shows only if the account has no check-ins. **OS2** while the first pull runs, My Beers / Analytics / Profile show "Loading your check-ins…" instead of their empty states; Check In works normally. **OS3** export (and import, which de-dupes against the local list) are disabled with a hint until the first pull finishes. **Pre-sign-in data:** if the first pull would drop rows the account doesn't have, a one-time "Before your first sync" prompt offers **Export Them** (`hopprint_before_signin.json`, `{check_ins, wishlist}`) and **Continue**.
  - **How it works:** "first pull done" means this user's `hopprint_sync_state` has a `lastIdCheck`. `enterApp()` sets `body.first-sync` when it isn't done (and the device isn't paused). CSS hides the three tabs' content behind `.first-sync-note` and dims `.needs-first-sync` buttons. After every `syncNow()`, `afterSyncAttempt()` either exits the mode (re-render, then `maybeShowWelcome()`) or updates the note. Offline it reads "Can't reach Hopprint right now…" and waits for the `online` event; online it retries with backoff (5s, 10s, 20s, 40s, then every 60s). The prompt runs inside the first pull after all fetches and before the merge, so nothing is dropped until Continue. It never appears on later id checks or after a shared-device take-over (the previous owner's rows are already in their account).
  - **Note for Phase 5:** on Greg's live device the SY10 script gives his legacy rows new uuids, so the local numeric-id copies aren't "on the server" by id. His first pull will show this prompt with about 2,600 check-ins. That's expected, and **Export Them** is a free extra backup alongside the Phase 5 step 1 export and the `hopprint_entries_premigration` key.
  - **Functions changed:** `maybeShowWelcome` (original app, named by OS1: returns early while the first sync is pending), plus `enterApp`, `pullChanges`, `syncNow` from earlier phases. Markup: three `.first-sync-note` divs, `needs-first-sync` on the Export CSV / Export JSON / Import buttons plus a hint, and `#preSyncModal`.
  - **Checks:** `node --check`, token guard, 66 tests passing (`first-load` 13 new, `pull` 20, `sync` 20, `auth` 13). The new tests cover mode entry/exit, per-user state, paused devices, welcome gating for empty vs returning accounts, offline note vs online backoff, the CSS/markup contract, the prompt's row selection, copy, export contents, waiting for Continue, and first-pull-only timing. Browser check with a fake local user (sync stubbed): loading note on My Beers, list hidden, exports disabled, welcome held back and then shown once the first pull is marked done; prompt renders; no console errors.
  - **Test-session note:** a browser check reused the `127.0.0.1:8000` origin that Greg had signed into as his "second device" and cleared its storage, signing him out there. Nothing was written to Supabase (verified: still 1 check-in, last change 03:10:44 UTC). Future automated checks use a fresh port.

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
| **OS1** | ~~**First-load welcome modal.**~~ **Resolved Sept 23, 2026:** decided after the first pull; shown only if the account has no check-ins. | 4 |
| **OS2** | ~~**Empty-state flash on a new device.**~~ **Resolved Sept 23, 2026:** "Loading your check-ins…" on My Beers / Analytics / Profile until the first pull finishes. | 4 |
| **OS3** | ~~**Export before first sync.**~~ **Resolved Sept 23, 2026:** export and import disabled until the first pull finishes. | 4 |
| **OS4** | ~~**Sign-out and shared devices.**~~ **Resolved Sept 23, 2026:** Sign Out button on the Profile tab; signing out **keeps** the local cache. Phase 2 must guard against uploading one user's cached rows under another (see Phase 1 notes). | 1–2 |
| **OS5** | ~~**Id-check frequency.**~~ **Resolved Sept 23, 2026:** once per calendar day on open, plus a manual "Sync Now" (Profile → Account). | 3 |
| **OS6** | ~~**Sync-status indicator** placement and copy.~~ **Resolved Sept 23, 2026:** header pill, tap to retry (see Phase 2 notes). | 2 |
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
