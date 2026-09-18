# Bay Bellerive trial readiness — work in progress

Do not begin the two-week operational trial until the remaining checks below pass.

## Implemented locally, not published

- Shared API removes cost, price, margin and valuation fields recursively for staff and supervisors.
- Only previously registered active accounts may use the API. No first-visitor manager assignment or automatic staff creation.
- Failed writes retain a per-account draft. Conflicts stop saving without discarding the draft. Manual reconciliation is still required.
- Retried requests carry a stable request ID; acknowledged requests cannot be applied twice while still the latest saved request. Later intervening writes produce a conflict for review.
- Server validates non-negative finite stock and PAR quantities.
- Each successful update atomically preserves the previous stock state in a recovery snapshot. Managers can download the latest 30 snapshots; older snapshots remain stored.
- Shared save status replaces the misleading device-only footer.

## Verification completed

`tools/check-access.mjs` exercises the Worker with an in-memory SQLite database: staff/supervisor cost filtering, restricted account and recovery endpoints, disabled/unlisted/anonymous account rejection, stale-write rejection, duplicate retry handling, snapshot creation and restoration of a previous quantity. Client JavaScript parses successfully.

## Required before publication and trial

1. Choose business-owned hosting and independent authentication, including account recovery and disabling sessions. Current private Sites hosting still requires OpenAI sign-in.
2. Independent backup storage, retention policy and scheduled checks. Recovery snapshots in the same database do not protect against loss of that database. Include account configuration in the independent backup without reverting disabled accounts during routine stock restoration.
3. Service-specific Day, Evening and Event PAR targets, explicit fallback labels, supplier lead times and outstanding purchase orders with receiving workflow.
4. Harden movement validation, transfer conservation and stable item IDs. Existing transfer code can copy an item's ID; fix and migrate existing duplicates safely. Prevent reducing stock below zero through silent clamping.
5. Ensure stock quantity changes are accompanied by server-validated history. Existing whole-state writes still trust too much client history. Implement operation-level permissions and audit attribution.
6. Escape product, supplier, history and account text before HTML rendering; validate photo URLs.
7. Preserve incomplete stocktake form entries, not only already-submitted changes. Confirm lock/unlock and Safari behaviour on an actual iPhone.
8. Add a clear reconciliation screen and avoid claiming stocktake submission or backup merge succeeded until shared saving is acknowledged.
9. Test two devices and real role sessions, recovery under network interruption, and snapshot restore in staging. Test an offsite full restore separately.
10. Confirm hosting costs, account ownership, recovery contacts and business-controlled domain. No paid services have been purchased or opened.

The live website has not received these local changes. Existing records and accounts have not been migrated or modified by this work.
