# TESTER_SUPABASE_HANDOFF.md — Data sharing, auth, and tester-phase schema

**Status:** Planning complete, all decisions locked. **Built and live, with changes:** TS6 and TS7 were superseded, and the DDL/grants below are the *original* plan. The live schema differs; see **Live-state addendum (September 24, 2026)** at the end. Any future session can begin cold from this document **plus `SYNC_REVERSAL_WORKPLAN.md`**.
**Date:** July 20, 2026
**Scope:** Resolves Tier 0 (data-sharing conflict, age-gating, sustainability sentence, trademark/domain checks) and scopes the tester-phase Supabase schema (`profiles`, `check_ins`) plus RLS/GRANTs. Does **not** cover the full Stage 2 normalized schema (`locations`/`breweries`/`styles`/`beers`) — that's explicitly deferred, see TS3 below.
**Depends on:** `GO_PUBLIC_CHECKLIST.md` (Tier 0/1 structure), Project Instructions (original Stage 2 schema scope).

---

## Part 1 — Tier 0 policy decisions

### TS1 — Data-sharing policy (resolves the GO_PUBLIC_CHECKLIST open conflict)

| # | Decision |
|---|----------|
| **TS1** | **Option B, narrower.** Individual user data (row-level check-ins, identities) is never sold or shared — full stop. Aggregate, opt-in, anonymized community insights are a separate category and may be offered commercially later. |

**Implication:** `data_sharing_consent` is opt-in at signup (default `false`, never assumed true), with a timestamp and terms-version field so consent stays auditable if terms change later. This supersedes the absolute-prohibition reading in the original Project Instructions.

### TS2 — Age-gating mechanism

| # | Decision |
|---|----------|
| **TS2** | **Collect birthdate, gate on it** — not a self-attestation checkbox. Checked against 21+ at signup time, server-side (not just client-side JS, which is trivially bypassed). Under-21 signups are blocked outright, not flagged. |

### TS3 — Sustainability / kill-switch commitment

| # | Decision |
|---|----------|
| **TS3** | **90-day notice window**, delivered via **email + in-app notice**. Requires verified email at signup (not just collected — bounces/fake addresses defeat the guarantee). |

**Locked sentence:**
> "Export always works, any time. If Hopprint ever shuts down, you'll get at least 90 days' notice — by email and in the app — plus a one-click export of everything you've logged, before anything goes away."

Export (CSV/JSON) already works today from any app state — this sentence is already true, not aspirational.

### TS4 — Trademark / domain checks

| # | Finding |
|---|----------|
| **Trademark** | No exact "Hopprint" match against indexed USPTO records. Closest neighbors: HOPSTRACT, HOP ALLIANCE, HOPSHOT — none conflict directly. **Not a formal clearance search** (casual search against indexed registrations only, doesn't cover common-law/unregistered use). Treat as a good early signal, not clearance. |
| **Domain** | Not resolved — no live WHOIS query available via search tooling. **Action item:** check `hopprint.com` (+ `.app`, `.beer` as fallbacks) manually at a registrar. |

---

## Part 2 — Tester-phase schema decisions

### TS5 — Normalize now vs. defer to Stage 3

| # | Decision |
|---|----------|
| **TS5** | **Flat `check_ins` table now.** Denormalized text columns (`beer_name`, `brewery_name`, etc.) mirroring the current localStorage entry shape — no separate `beers`/`breweries`/`locations`/`styles` tables yet. Full normalization (with beer/brewery dedup + canonicalization) is deferred to Stage 3, when shared-catalog contribution actually requires it. |

**Rationale:** Avoids building dedup/matching logic against imagined edge cases before real tester data exists. Consistent with the project's standing "ship minimal proven thing, expand later" pattern (Phase D+/E, Date Lookup).

**Known future cost:** Stage 3 will require a migration pass to match/canonicalize accumulated text values (e.g., "Trillium" vs. "Trillium Brewing Company") into normalized `beers`/`breweries` rows.

### TS6 — Auth method

| # | Decision |
|---|----------|
| **TS6** | ~~**Magic link for the tester phase.**~~ **Superseded by SY8 (`SYNC_REVERSAL_WORKPLAN.md`): login is an emailed 6-digit code.** On iOS a magic link opens Safari, which doesn't share a login with the installed home-screen app. Email/password still arrives at Stage 3 as an addition, not a rebuild (Supabase Auth supports both providers on one account when the email matches). |

**Note for Stage 3:** Testers who signed up with an emailed code won't have a password yet — enabling email/password later requires a one-time "set a password" step (Supabase's password-reset flow doubles as this) communicated directly to the existing tester cohort.

**Session persistence:** Not affected by this choice either way — Supabase's refresh-token mechanism (`persistSession: true`, default) keeps testers logged in indefinitely without repeat logins, same behavior regardless of auth method.

### TS7 — Sync direction

| # | Decision |
|---|----------|
| **TS7** | ~~**One-way: device → Supabase only.**~~ **Superseded by SY3 (`SYNC_REVERSAL_WORKPLAN.md`): Supabase is the source of truth, and localStorage is a cache.** Writes upload in the background from a pending pile (SY6); each device pulls changes on open, on return to the app, and on "Sync Now", with a daily id check for deletions (SY1/SY2/OS5). Cross-device sync is live. |

~~**Tester communication requirement:** App is single-device during this phase.~~ No longer true: testers can use more than one device, and signing in on a new device restores their history.

### TS8 — Existing local data on first login

| # | Decision |
|---|----------|
| **TS8** | **Clean start — no upload-once/merge logic needed.** Account creation is required before any check-in, so no tester will ever have pre-existing local entries at signup time. *(Held. Safety net added in Phase 4: if a device's first sync would drop local rows the account doesn't have, a one-time prompt offers to export them first.)* |

**Greg's own data:** Not the app's problem to solve. *(Done September 24, 2026 via `scripts/migrate.js` (SY10): 2,789 check-ins, rehearsed on a scratch account, verified against the export. See `SYNC_REVERSAL_WORKPLAN.md` Phase 5.)*

---

## Part 3 — Schema DDL

> **Original plan, not the live schema.** See the Live-state addendum at the end for what actually runs today (`created_at` type, `updated_at`, `wishlist`, profile constraints).

```sql
-- ═══════════════════════════════════════════════════════════════
-- PROFILES
-- One row per tester, created at signup (before any check-in is possible)
-- ═══════════════════════════════════════════════════════════════
create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  first_name text,
  last_name text,
  username text,
  gender text,
  location_state text,
  location_country text,
  birthdate date not null,                    -- TS2: 21+ gate, enforced server-side
  data_sharing_consent boolean not null default false,  -- TS1: opt-in, never assumed true
  consent_timestamp timestamptz,
  terms_version text,
  supporter_tier text,
  supporter_since timestamptz,
  created_at timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════
-- CHECK_INS
-- Flat/denormalized (TS5) — mirrors current localStorage entry shape.
-- One-way sync target (TS7): device writes here, nothing reads back down yet.
-- ═══════════════════════════════════════════════════════════════
create table check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  beer_name text not null,
  brewery_name text,
  brewery_city text,
  brewery_state text,
  beer_type text,                              -- validated client-side against existing BJCP style list
  beer_abv numeric,

  venue_name text,
  purchase_venue text,
  serving_type text,
  occasion text,
  occasion_ctx text[],

  comment text,

  rating integer check (rating >= 0 and rating <= 100),  -- band range enforced at the DB level
  rating_mode text,                             -- 'live_button' | 'live_slider' | 'import'
  source text not null default 'live',          -- 'live' | 'import'

  created_at timestamptz not null,              -- the check-in's own date/time, not insert time
  synced_at timestamptz not null default now()
);

create index idx_check_ins_user_id on check_ins(user_id);
```

---

## Part 4 — RLS + GRANTs

> **Original plan.** The live grants differ: `check_ins` has an **update** grant and an own-row update policy. See the Live-state addendum.

```sql
-- ═══════════════════════════════════════════════════════════════
-- ENABLE RLS — required per table before any policy takes effect
-- ═══════════════════════════════════════════════════════════════
alter table profiles enable row level security;
alter table check_ins enable row level security;

-- ═══════════════════════════════════════════════════════════════
-- GRANTS (baseline permissions — RLS narrows these, doesn't create them)
-- ═══════════════════════════════════════════════════════════════
grant select, insert, update on profiles to authenticated;
grant select, insert, delete on check_ins to authenticated;
-- No update grant on check_ins: one-way sync (TS7) means the client only
-- ever creates rows going forward. Local edits after sync don't push
-- back up in this phase.

-- ═══════════════════════════════════════════════════════════════
-- POLICIES — profiles (own-row access only)
-- ═══════════════════════════════════════════════════════════════
create policy "profiles: select own" on profiles for select using (auth.uid() = user_id);
create policy "profiles: insert own" on profiles for insert with check (auth.uid() = user_id);
create policy "profiles: update own" on profiles for update using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- POLICIES — check_ins (own-row access only)
-- ═══════════════════════════════════════════════════════════════
create policy "check_ins: select own" on check_ins for select using (auth.uid() = user_id);
create policy "check_ins: insert own" on check_ins for insert with check (auth.uid() = user_id);
create policy "check_ins: delete own" on check_ins for delete using (auth.uid() = user_id);
```

**No delete policy on `profiles`.** Testers cannot delete their profile row directly via the API — see TS9 below.

---

## Part 5 — Parked item

### TS9 — Full account deletion

| # | Decision |
|---|----------|
| **TS9** | Testers can delete individual check-ins (policy above ships with this session's work). **Full account deletion is parked** — deliberately not scoped here. |

**Why it's parked, not just deferred casually:** Deleting an `auth.users` row can't be done via a client-side RLS policy — it requires Supabase's admin API (`auth.admin.deleteUser()`), which needs the service role key. That key can never be exposed client-side, so this requires a **Supabase Edge Function**: a logged-in tester calls it, the function verifies the request is genuinely from that user, then deletes their `auth.users` row server-side using the service role key. Because `profiles` and `check_ins` both reference `auth.users(id) on delete cascade`, that single deletion cascades cleanly through both tables — no extra cleanup logic needed.

**Revisit alongside:** the profile-creation session (TS10 below) — account deletion is a natural companion to signup/profile UX.

---

## Part 6 — Explicitly not decided here (next session's scope)

Flagged, not forgotten. The profile-creation UX session should resolve:

- **`username`** — unique constraint or not? Public-facing anywhere, or internal only?
- **`gender`** — free text vs. a fixed set of options (affects column type/structure)
- **`first_name` / `last_name`** — required at signup, or optional/add-later?
- **`location_state` / `location_country`** — self-reported at signup, or derived some other way?
- **TS9 (account deletion Edge Function)** — parked above, belongs in this same session
- **Consent UI** — the actual signup-screen moment for `data_sharing_consent`, alongside birthdate and the above fields

---

## Part 7 — Explicitly out of scope (Stage 3+, not this document)

- Full normalized schema (`locations`, `breweries`, `styles`, `beers`) and the beer/brewery dedup migration it requires
- ~~Two-way sync / cross-device reconciliation~~ *(built: `SYNC_REVERSAL_WORKPLAN.md`, SY1–SY13)*
- Email/password auth (added alongside existing emailed-code accounts)
- Moderation model for shared beer database (GO_PUBLIC_CHECKLIST Tier 2)

---

## Cross-references

- `SYNC_REVERSAL_WORKPLAN.md` — supersedes TS6 (SY8) and TS7 (SY3); schema changes SY1/SY5/SY11; Greg's migration (SY10, Phase 5)

- `GO_PUBLIC_CHECKLIST.md` — Tier 0/1/2/3 structure this session resolves against
- Project Instructions — original (now superseded on TS1) data-sharing stance and original Stage 2 schema scope
- Next build item once this ships: client-side sync logic in `index.html`, minimal landing page, tester expectations doc, donate feature

---

## Live-state addendum (September 24, 2026)

What the database actually looks like, verified against Supabase project `sacbsvhdnqcgqvlkdpyx`. Build against this, not Parts 3–4.

**`check_ins`** (changes from Part 3):
- `created_at` is **`timestamp` (no time zone)**: the wall-clock time as entered (SY5). `synced_at` stays `timestamptz`.
- **`updated_at timestamptz not null default now()`**, bumped on every update by the `check_ins_set_updated_at` trigger (shared function `public.set_updated_at()`, `search_path = ''`). Index `idx_check_ins_user_updated (user_id, updated_at)`. This is the sync bookmark (SY1).
- Ids are client-generated uuids (SY4); `gen_random_uuid()` stays as the fallback default.

**`wishlist`** (new, SY11): `id uuid pk`, `user_id → auth.users on delete cascade`, `beer_name text not null`, `brewery_name`, `beer_type`, `added_at timestamptz`, `updated_at timestamptz` (same trigger), index `(user_id, updated_at)`, RLS on with four own-row policies.

**`profiles`** (resolved in `PROFILE_CREATION_UX_*`): `username text not null unique`; `gender` check (`male`, `female`, `non-binary`, `prefer_not_to_say`, `other`); `profiles_age_gate_21plus` check (`birthdate <= current_date - 21 years`, the server-side half of TS2).

**Grants** (RLS narrows these; it doesn't create them):

| Table | `authenticated` | `anon` | `service_role` |
|---|---|---|---|
| `check_ins` | select, insert, **update**, delete | none | no DML* |
| `wishlist` | select, insert, update, delete | none | no DML* |
| `profiles` | select, insert, update | none | no DML* |
| `feedback` | none | insert | no DML* |

- `check_ins: update own` policy has both `using` and `with check` (`auth.uid() = user_id`).
- **`TRUNCATE`, `REFERENCES` and `TRIGGER` were revoked** from `anon` and `authenticated` on every public table, and from the schema's default privileges (Phase 0). Supabase had granted them by default, and `TRUNCATE` bypasses RLS: anyone holding the public anon key could have wiped every user's rows.
- \*`service_role` has never had table DML in this project (only `REFERENCES/TRIGGER/TRUNCATE`). A temporary grant on `check_ins`/`wishlist` was applied for the Phase 5 migration and **revoked** afterwards. A future admin script (or the TS9 Edge Function, if it ever touches tables directly) needs its own explicit grant.

**Auth:** emailed 6-digit code (SY8), OTP length 6, expiry 3600s, sent through custom SMTP on a subdomain of Greg's related-site domain (Supabase's built-in sender only delivers to organization team members). Both the "Magic Link" and "Confirm signup" templates carry `{{ .Token }}`.
