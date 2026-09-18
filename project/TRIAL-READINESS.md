# Bay Bellerive trial readiness — work in progress

Do not begin the two-week operational trial until the remaining checks below pass. Storage moved from Cloudflare D1 to Supabase (Postgres) since this file was first written; items below have been re-checked against that change, not just carried over.

## Implemented locally, not published

- Independent authentication: Google OAuth via Supabase Auth. The Worker verifies each session token directly with Supabase, then gates on the `users` table — only a pre-existing active row gets in, using that row's own name/role. No self-enrolment; a Google profile alone grants nothing. An unrecognised or disabled account sees "You don't have access" and is signed out immediately, closing the account-disabling half of item 1 below.
- Shared API removes cost, price, margin and valuation fields recursively for staff and supervisors.
- Only previously registered active accounts may use the API. No first-visitor manager assignment or automatic staff creation.
- Failed writes retain a per-account draft. Conflicts stop saving without discarding the draft. Manual reconciliation is still required.
- Retried requests carry a stable request ID; acknowledged requests cannot be applied twice while still the latest saved request. Later intervening writes produce a conflict for review.
- Server validates non-negative finite stock and PAR quantities.
- Each successful update atomically preserves the previous stock state in a recovery snapshot (now via a Postgres function, `save_app_state` in `supabase/schema.sql`, instead of a D1 batch write — same atomicity guarantee). Managers can download the latest 30 snapshots; older snapshots remain stored.
- Shared save status replaces the misleading device-only footer.
- All three Supabase tables have row-level security enabled with no policies, so only the service-role key the Worker holds can read or write them at all — the anon key embedded in the client can only reach Supabase's own auth endpoints, never stock data directly.

## Verification completed

`tools/check-access.mjs` now covers cost redaction, stable event-key deduplication, an unlisted-account rejection (via a stubbed fetch), and anonymous API rejection. Client JavaScript parses successfully. It **no longer** runs the deeper role-gating/atomicity/conflict suite it used to — that was written against an in-memory D1-shaped SQLite database and doesn't apply now that storage is Supabase over HTTP.

In its place, the following was verified manually against a real Supabase project (via `tools/dev-server.mjs` and direct `curl` calls, not an automated test): bootstrap on empty state, first save, a second save producing an atomic recovery snapshot that correctly captured the pre-update quantity, stale-revision rejection (409), role-gated `/api/users` access, and the Google sign-in round trip end-to-end in a browser. Rebuilding that D1-era suite as either a fake-PostgREST mock or an opt-in real-project test is still outstanding — treat every Supabase-backed request path as manually spot-checked, not regression-tested.

## Required before publication and trial

1. **Partially done.** Independent authentication is implemented (see above). Business-owned hosting is not — nothing runs anywhere but `localhost` via `tools/dev-server.mjs`. A Cloudflare Workers deployment target (or an alternative) still needs to be chosen and set up. Account recovery is delegated to each person's own Google account recovery, which has not been separately discussed or confirmed as acceptable.
2. **Still open.** Recovery snapshots now live in Supabase's `audit_events` table instead of D1, but the underlying gap is unchanged: they're in the same database as the live data, which is not an offsite backup. Independent backup storage, a retention policy, and scheduled checks are still missing. Account configuration (roles/active flags) still needs to be included in that backup without reverting disabled accounts during a routine stock restore.
3. **Partially done.** Day, Evening and Event PAR targets with an explicit "(default)" fallback label already exist in the add/edit item forms and the stock table (this predates this round of work and was confirmed by reading the current code, not newly built). Supplier lead times and an outstanding-purchase-order/receiving workflow do not exist and remain open.
4. **Not re-verified this round.** Movement validation, transfer conservation, and stable item IDs were substantially in place before this round of changes (transfers already assign a fresh id to a newly created destination item; movements that would take stock below zero are rejected outright rather than silently clamped) — but this file's original description of these gaps predates any of that being confirmed, and none of it has been re-tested against this exact checklist item in this round. Treat it as unverified, not resolved, until it's explicitly checked again.
5. **Not re-verified this round.** Same caveat as item 4 — `validateEvents()` server-side history validation, role-gated movement types, and audit attribution (`recordedBy`/`recordedByEmail`) already exist in `worker/server-template.js`, but haven't been freshly re-audited against this item's exact bar in this round of work.
6. **Not reviewed this round.** HTML-escaping of product/supplier/history/account text and photo URL validation were not touched or re-audited during this round.
7. **Not done.** Incomplete stocktake form entries, lock/unlock behaviour, and real Safari/iPhone testing remain untested.
8. **Not done.** The reconciliation screen exists (manual compare/download/discard, see `project/userflow.md` §10) but has not been reviewed against this item's bar for clarity, and stocktake/backup-merge success messaging still explicitly warns it's device-local until the footer confirms a shared save — this still relies on the user reading that warning rather than the UI enforcing it.
9. **Partially done, narrowly.** The Supabase-backed save/conflict/recovery-snapshot path was manually verified this round (see "Verification completed" above), but only against a single browser/session, not two devices or two concurrent real role sessions. Recovery under network interruption, a staged snapshot restore, and a full offsite restore test remain undone.
10. **Not done.** Hosting costs, account ownership, recovery contacts, and a business-controlled domain remain unconfirmed. No paid services have been purchased or opened.

Nothing has been deployed anywhere public. The original Sites-hosted website has not received any of this work, and existing production records and accounts (if any still exist there) have not been migrated or modified by it.
