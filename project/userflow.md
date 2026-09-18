# User flows — `dist/index.html`

Roles referenced throughout: **staff** (count/record only), **supervisor** (staff abilities + history/reorder), **manager** (everything, including product/account/backup admin). Role comes from `/api/bootstrap` and is not client-editable.

## 1. Load and sign in

1. Page requests `GET /api/bootstrap`.
2. On failure → the whole page is replaced with an error card ("Stock records unavailable") telling the user to refresh or contact a manager. There is no retry button here, only a manual refresh.
3. On success → `currentUser`, `serverRevision`, and shared `data`/`history`/`stocktakes` are set; the header shows the signed-in name and role; role-gated buttons are shown/hidden.
4. If this browser has an unsaved draft for this user's email (from a previous failed/interrupted save), it is silently recovered into memory and the sync bar reports either "Recovered unsaved work — use Retry save" or, if the draft's base revision no longer matches, a conflict banner.

## 2. Everyday quantity count (inline)

1. User picks an area tab (Bar/Kitchen/Barista) — client-side only, no reload.
2. User optionally switches the target selector (Default/Day/Evening/Event) to see the relevant PAR column, and/or searches by name.
3. Staff/supervisor/manager types a new on-hand number directly into a row's quantity input (disabled for staff role... **note**: code disables the input when role is `staff`, so plain staff cannot edit quantity inline — they must use Record movement or Start stocktake instead).
4. On change, the previous value is diffed and a `count_adjustment` history entry is written; the row and stats re-render; a debounced save (500 ms) pushes to `/api/state`.

## 3. Record a stock movement

1. Any role clicks "Record movement" (blocked with an alert if the current area has no active products).
2. Choose movement type: Delivery received, Wastage/breakage, Transfer between areas, Staff meal/complimentary, Physical count correction — the quantity label and help text swap per type.
3. Choose product (scoped to the active area); enter quantity; managers additionally see an optional unit-cost field for deliveries.
4. Transfer type reveals a destination-area selector; submitting a transfer that exceeds on-hand stock is rejected with an alert before any state changes.
5. On submit: on-hand quantity is adjusted (or, for transfer, split into a `transfer_out` entry here and a `transfer_in` entry on a matching/created product in the destination area); a history entry is written for each side; state is saved and the dialog closes.

## 4. Start and submit a stocktake

1. User clicks "Start stocktake"; dialog opens pre-filled with the current area and "Morning shift" type; counts start blank by design (independent physical count, not pre-filled from system stock).
2. Switching stocktake type to "Special event" reveals a required event-name field.
3. As the user types counts/notes, a debounced (300 ms) per-user-per-area draft is written to `localStorage`; switching area or closing/hiding the tab also force-saves the draft. Reopening the dialog for that area resumes the draft ("Resumed unsaved counts for this area").
4. On submit, every product needs a numeric count. Any count whose variance from current stock exceeds a threshold (≥0.5 or 20% of target for measured items; ≥2 or 20% of target otherwise) must have a reason, or the row is flagged red and submission is blocked with a focus jump to the missing note.
5. On success: quantities are updated, a `stocktake` history entry is written per product, a locked stocktake session record is stored, the area's draft is cleared, and an alert confirms it is recorded **on this device** but "not yet confirmed on the shared records — watch the status bar."

## 5. Generate and export a reorder list

1. Supervisor/manager clicks "Reorder list" (hidden entirely for staff).
2. The app filters active items below their effective target for the current area, groups by supplier, and renders plain text into a read-only textarea.
3. "Copy list" copies to clipboard (with a `document.execCommand` fallback); "Download CSV" exports a fuller structured version (area, supplier, category, item, on-hand, target, pack info, quantities to order).

## 6. Review weekly history

1. Supervisor/manager clicks "History" (hidden for staff).
2. A week-beginning dropdown (Monday-start weeks, derived from recorded entries) filters the table; each row shows timestamp, staff member, movement type + reason, area, item, before/after, and a signed delta (green up / red down).
3. "Download history CSV" exports the same rows.

## 7. Add or edit a stock item (manager only)

**Add**: "+ Add item" → fill name, category (scoped to current area), unit, default PAR + optional Day/Evening/Event overrides, count method, supplier, location, order-pack size/name, and (for portion-based units) portion weight/volume. Validation blocks cans with a pack size of 1. New item starts at zero on-hand stock.

**Edit**: row → "Edit item" opens the same shape pre-filled, plus an active/discontinued status field; on-hand quantity itself is explicitly not editable here. Saving diffs every field against the previous values and writes a single `par_change` (if the PAR/target changed) or `item_update` history entry summarising what changed, in prose.

## 8. Manage staff accounts (manager only)

1. Header "Accounts" → `GET /api/users` populates the table.
2. Form adds or updates an account by name, email, role (staff/supervisor/manager), and active/disabled status via `POST /api/users`; the backend is the source of truth for who may sign in at all (no self-enrolment).

## 9. Back up, import, and recover data (manager only)

1. "Data backup" → shows current on-device product count.
2. "Download backup" exports a JSON snapshot (data + history + stocktakes) tagged with a format marker.
3. "Import and merge backup" reads a same-format JSON file, matches products by area+name (case-insensitive), adds unmatched ones and merges fields into matched ones, de-duplicates history/stocktake entries, then saves — with an explicit warning that the merge is local-only until the shared save succeeds.
4. Managers also see "Download recovery point," which lists server-held pre-save snapshots (`GET /api/recovery`) and downloads a chosen one — read-only, does not touch live stock.

## 10. Handle a save conflict

1. A `PUT /api/state` that returns `409` means someone else saved first. The footer switches to "Not saved — another person changed stock" and reveals "Resolve conflict."
2. Opening it re-fetches `/api/bootstrap` and diffs the user's local data against the latest shared quantities by item ID, listing only genuinely differing products.
3. User options: **Recheck shared records** (re-diff), **Download my local changes** (safety export before doing anything destructive), or **Discard local changes and reload** (confirmed via a native `confirm()`, then a full page reload against the latest shared state).
4. There is no automatic merge — reconciliation is manual, by design (per `TRIAL-READINESS.md`'s "manual reconciliation is still required").

## 11. Offline / interrupted-session resilience

1. Every change is written to a per-user `localStorage` draft immediately, before any network call.
2. Going offline switches the status line to "Offline — changes have not reached the shared records"; coming back online automatically retries.
3. Closing the tab or hiding it while a stocktake dialog is open force-flushes that dialog's draft first; `beforeunload` also warns the browser if there's unsaved shared-state work.
4. Failed saves keep a stable `requestId` so a retry cannot be double-applied server-side as long as it's still the latest saved request.

## Known incompleteness (from `TRIAL-READINESS.md`, affects these flows)

- No independent authentication yet — `currentUser` comes from headers the current Sites gateway supplies, not a verified login of its own.
- Reconciliation flow above is manual-only; there is no assisted per-field merge.
- Stocktake/backup "success" alerts explicitly say the change is device-local until the footer confirms a shared save — but nothing in the UI blocks a manager from walking away before that confirmation lands.
