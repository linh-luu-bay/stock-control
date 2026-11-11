# User flows — `dist/index.html`

Roles referenced throughout: **staff** (count/record only), **supervisor** (staff abilities + typing counts straight into the stock list, history, reorder list), **manager** (everything, including products, backups and the Admin page; see section 8). Role comes from the `users` table via `/api/bootstrap` and is not client-editable.

## 1. Load and sign in

1. If this browser has no saved sign-in, the page shows a sign-in card: "Sign in with a Google account added by your manager." and **Log in with Google**.
2. Tapping it goes to Google through Supabase Auth and returns to the app with a session, which is kept in this browser and refreshed automatically before it expires. If it can't be refreshed, the card comes back with "Your session has ended. Please sign in again."
3. The page requests `GET /api/bootstrap` with the session token. The server only lets in emails that are active accounts in Admin → Staff accounts. Anyone else is signed out and sees "You don't have access to this app. Ask a manager to add your account."
4. On any other failure → the whole page is replaced with an error card ("Stock records unavailable") telling the user to refresh or contact a manager. There is no retry button here, only a manual refresh.
5. On success → `currentUser`, `serverRevision`, `layout`, and shared `data`/`history`/`stocktakes` are set; the header shows the signed-in name, role and Google profile photo; role-gated buttons are shown/hidden. If the address was an `#admin/<tab>` link, a manager lands on that Admin tab.
6. **Sign out** ends the session and returns to the sign-in card.
7. If this browser has an unsaved draft for this user's email (from a previous failed/interrupted save), it is silently recovered into memory and the sync bar reports "Recovered unsaved work — use Retry save", or, if the draft's base revision no longer matches, the page merges it with the latest shared records automatically (see section 10).

## 2. Everyday quantity count (inline)

1. User picks an area tab (the sections managers set up in Admin → Categories) — client-side only, no reload.
2. User optionally narrows the list with the category filter or search, and switches the target selector (Default/Day/Evening/Event) to see the relevant PAR column. Category and subgroup headings can be tapped to collapse them.
3. A supervisor or manager types a new on-hand number directly into a row's quantity box. The box is disabled for staff, who use Record movement or Start stocktake instead. Clearing the box means "Not counted", never zero.
4. The **Confirm count** dialog asks "Change the count for Gin (Bar) from 4 bottles to 6 bottles?" (or "Mark … as Not counted?") with an optional reason. Cancelling puts the old number back. If someone else changed that item while the dialog was open, the app asks the user to type the count again.
5. On **Save count**, a `count_adjustment` history entry is written (with the reason), the row and stats re-render, and a debounced save (500 ms) pushes to `/api/state`. The count also appears in Admin → Change log.

## 3. Record a stock movement

1. Any role clicks "Record movement" (blocked with an alert if the current area has no active products).
2. Choose movement type: Delivery received, Wastage/breakage, Transfer between areas, Staff meal/complimentary, Physical count correction — the quantity label and help text swap per type.
3. Choose product (scoped to the active area); enter quantity; managers additionally see an optional unit-cost field for deliveries.
4. Transfer type reveals a destination-area selector listing the sections with "Can transfer stock" on. Transfer isn't offered on a section with it off (Cleaning by default), and such a section isn't a destination; submitting a transfer that exceeds on-hand stock is rejected with an alert before any state changes.
5. On submit: on-hand quantity is adjusted (or, for transfer, split into a `transfer_out` entry here and a `transfer_in` entry on a matching/created product in the destination area); a history entry is written for each side; state is saved and the dialog closes.

## 4. Start and submit a stocktake

1. User clicks "Start stocktake"; dialog opens pre-filled with the current area and "Morning shift" type; counts start blank by design (independent physical count, not pre-filled from system stock).
2. Switching stocktake type to "Special event" reveals a required event-name field.
3. As the user types counts/notes, a debounced (300 ms) per-user-per-area draft is written to `localStorage`; switching area or closing/hiding the tab also force-saves the draft. Reopening the dialog for that area resumes the draft ("Resumed unsaved counts for this area").
4. On submit, every product needs a numeric count. Any count whose variance from current stock exceeds a threshold (≥0.5 or 20% of target for measured items; ≥2 or 20% of target otherwise) must have a reason, or the row is flagged red and submission is blocked with a focus jump to the missing note.
5. On success: quantities are updated, a `stocktake` history entry is written per product, a locked stocktake session record is stored, the area's draft is cleared, and an alert confirms it is recorded and locked **on this device**, and that the green "Saved to shared records" message at the top of the page confirms it has saved.

## 5. Generate and export a reorder list

1. Supervisor/manager clicks "Reorder list" (hidden entirely for staff).
2. The app filters active items below their effective target for the current area (items with no count or no PAR are left out), groups by supplier, and renders plain text into a read-only textarea.
3. "Copy list" copies to clipboard (with a `document.execCommand` fallback); "Download CSV" exports a fuller structured version (area, supplier, category, item, on-hand, target, pack info, quantities to order).

### 5.1 Email a supplier order (manager only)

1. For a manager, the Reorder list also shows **Email supplier orders**, if the section has "Shows in supplier orders" on in Admin → Categories. There is one row per supplier with items to order, plus any draft or today's orders for this section. Each row says where the email will go, or what's missing ("No order email saved. Add one in Admin → Suppliers.").
2. **Email order** (or **Continue draft**) opens the **Order email** dialog. The delivery date is pre-filled with the supplier's next delivery day, and the subject and email are filled from a fixed template using the supplier, items, notes and the venue address from Admin → Settings. Changing the delivery details refills the email, asking first if the user has edited the email text.
3. **Copy email** or **Open in email app** first needs a delivery date, then holds an order reference (`BAY-YYYYMMDD-nn`) as a draft and puts it into the email. Open in email app starts a `mailto:` email; a very long order is copied for pasting instead. **The app never sends email itself.**
4. After sending it from their own email app, the manager taps **Mark as sent** (with a confirmation). The row then shows "Sent <reference> · <name> · <time>". **Discard draft** records an unsent draft as not sent; its number isn't reused.
5. **Cancel order** on a sent order asks for a reason and only updates the app. The manager still has to tell the supplier. Every step appears in Admin → Change log under Supplier orders.

## 6. Review weekly history

1. Supervisor/manager clicks "History" (hidden for staff).
2. A week-beginning dropdown (Monday-start weeks, derived from recorded entries) filters the table; each row shows timestamp, staff member, movement type + reason, area, item, before/after, and a signed delta (green up / red down).
3. "Download history CSV" exports every week's entries, not just the week shown.

## 7. Add or edit a stock item (manager only)

**Add**: "+ Add item" → fill name, category (scoped to current area), optional subgroup (pick an existing one or type a new one), unit, default PAR + optional Day/Evening/Event overrides, count method, supplier, location, order-pack size/name, optional unit cost, and (for portion-based units) portion weight/volume. The supplier list shows active suppliers from Admin → Suppliers, this section's first, plus "Not listed (type a name)…". Validation blocks cans with a pack size of 1. New item starts at zero on-hand stock.

**Import from CSV**: "Import CSV" → **Download CSV template** (Name, Category, Subgroup, Stock unit, Default target, Count method, Supplier, Storage location, Items per pack, Pack name) → **Choose CSV file**. A preview lists each row with any issue: rows with no name, or a category this section doesn't have, are skipped; a bad target is ignored, and a bad count method or pack size falls back to a default. **Import items** then updates products in this section with the same name and adds the rest, with on-hand stock "Not counted".

**Unit cost** (managers only): what the venue pays a supplier for one stock unit. It shows on each stock row, where a manager can tap it to change it, and in Add/Edit item. It also updates when a delivery is recorded with a cost. A blank cost shows as "Not set" and is left out of the stock value box, as are items with no count. History says only "unit cost updated", because staff can read History; the amounts are in the Admin change log.

**Edit**: row → "Edit item" opens the same shape pre-filled, plus an active/discontinued status field and a Section list. Choosing another section moves the whole item, with its count and PAR levels, and is refused if that section already has an item with the same name; on-hand quantity itself is explicitly not editable here. Saving diffs every field against the previous values and writes a single `par_change` (if the PAR/target changed) or `item_update` history entry summarising what changed, in prose.

## 8. Admin page (manager only)

### 8.1 Open and move around Admin

1. A manager taps **Admin** in the header. The stock view is swapped for the Admin page and the address changes to `#admin/<tab>`. It reopens on the tab used last in this visit, or **Suppliers** the first time.
2. Tabs: **Suppliers**, **Staff accounts**, **Categories**, **Change log**, **Settings**. Each tab loads its data fresh when opened. The browser Back button moves between tabs, and **← Back to stock** returns to the stock view.
3. A supervisor or staff member who opens an `#admin` address is sent back to the stock view. The Admin button is hidden for them, and the server refuses every admin request from anyone but a manager.
4. After each action a message line under the tabs confirms what happened ("Fresh Produce Co has been added.") or explains what went wrong. Success messages fade after 6 seconds; errors stay.

### 8.2 Suppliers

1. The list shows active suppliers by default. **Search** matches name, rep, phone, ordering email, account number and notes. The area filter shows one section's suppliers, and the status filter switches between Active, Archived and All suppliers.
2. **+ Add supplier** or a row's **Edit** opens the supplier dialog: name (required), rep name, phone, ordering email, account number, notes, areas (sections that take supplier orders), order days, order cut-off time, delivery days and minimum order (AUD).
3. On save, the form is checked: a name is required, names must be unique (archived suppliers count), the email must look like an email, and the minimum order must be $0 or more. Errors show in the dialog and nothing is saved.
4. **Archive** (row or dialog) asks for confirmation, then moves the supplier to the Archived list. Nothing is deleted. **Restore** brings it back.
5. A supplier's order days, delivery days, minimum order and email are used by supplier order emails from the Reorder list.

### 8.3 Staff accounts

1. The table lists every account: name ("Awaiting sign-in" until they first sign in), email, access level and status.
2. **Add a staff member**: enter name, email address, access level (Staff, Supervisor, Manager) and status, then **Add account**. Giving someone manager access asks for confirmation first. The confirmation says they can then sign in with Google using that email. Only emails in this list can sign in; there is no self-sign-up.
3. **Edit** on a row fills the same form (the email can't be changed) and the button becomes **Save changes**. Changing the access level or deactivating an account asks for confirmation first. **New member** clears the form.
4. Accounts are deactivated, never deleted. A manager can't deactivate their own account or remove their own manager access.

### 8.4 Categories (sections, categories and subgroups)

1. A row of section tabs picks which section to edit. The section's card shows its item count, **← →** to change the tab order on the stock screen, and **⋯** for **Rename** and **Archive**.
2. Two switches on the card: **Can transfer stock** (whether stock can move to and from this section) and **Shows in supplier orders** (whether suppliers can be tagged with it and orders emailed from it). Turning the second off, or archiving the section, is refused while it has draft supplier orders. Send or discard them from its Reorder list first.
3. **+ Add section** asks for the section name and its first category. It appears as a new tab for everyone.
4. Categories are listed in the order staff see them, each with its item count. **↑ ↓** move a category; **⋯** opens Rename or Archive; **Add category** adds one at the end.
5. Tap a category (or **▸**) to see its subgroups, which have the same move, rename, archive and restore controls, plus an **Add subgroup** box. **Expand all** / **Collapse all** opens or closes every category.
6. **Rename** keeps all items, counts and PAR levels and moves them to the new name. **Archive** hides the category, subgroup or section from the stock screens. If a category or subgroup still has items, the dialog asks where to move them first. A section's items are hidden with it, not moved. The last active category in a section, and the last active section, can't be archived.
7. Archived sections, categories and subgroups are listed under **Archived (n)** with a **Restore** button.
8. Every change is saved on its own, together with the items it affects. Other devices pick it up the next time they save or refresh.

### 8.5 Change log

1. Shows changes to stock item details, counts typed straight into a quantity box, count corrections, categories and sections, suppliers, staff accounts, supplier orders and settings. Deliveries, wastage, transfers and stocktakes are in History instead. Entries are recorded automatically and can't be edited or deleted.
2. Each entry shows the time (Hobart, DD/MM/YYYY), a plain-English summary ("Sam changed Gin par level 4 → 6") and which section it belongs to. Tapping it opens a Detail / Before / After table, with **Show raw data** for the full record.
3. Filters: **From** and **To** dates (shown as DD/MM/YYYY on every device; tapping opens the device's date picker), **Person**, **Section** and **Type of change** (Added, Edited, Archived/discontinued/deactivated, Restored/reactivated, Deleted). Each filter change reloads the list. A From date after the To date is refused with a message. **Clear filters** resets them all.
4. The newest 100 entries load first. **Show older changes** loads the next 100.

### 8.6 Settings

1. Venue delivery address, venue phone, venue email, sender name and sender role are saved once and used in every supplier order email. The delivery address appears in each order; the email signature comes from the manager's own email app.
2. **Save settings** checks the venue email looks valid, saves, and confirms "Settings have been saved."

## 9. Back up, import, and recover data (manager only)

1. "Data backup" → shows current on-device product count.
2. "Download backup" exports a JSON snapshot (data + history + stocktakes) tagged with a format marker.
3. "Import and merge backup" reads a same-format JSON file, matches products by area+name (case-insensitive), adds unmatched ones and merges fields into matched ones, de-duplicates history/stocktake entries, then saves — with an explicit warning that the merge is local-only until the shared save succeeds.
4. Managers also see "Download recovery point," which lists server-held pre-save snapshots (`GET /api/recovery`) and downloads a chosen one — read-only, does not touch live stock.

## 10. Handle a save conflict

1. A `PUT /api/state` that returns `409` means someone else saved first. The page re-fetches `/api/bootstrap` and merges automatically ("Someone else saved at the same time — adding your changes to theirs…"):
   - This device's own new history entries (those not yet in the shared history) are re-applied on top of the latest shared stock. Deliveries, wastage, staff meals and transfers are re-applied as amounts; typed counts, physical corrections and stocktake counts are set numbers. Each entry's before/after is rewritten to match the latest stock, so the server's history check still passes.
   - Item details this device changed since it last loaded or saved (`base`) are kept; other people's edits to other details are kept too.
   - Then it saves again. Items are updated in place, so open forms keep pointing at the right product.
2. Only when this device set a count for an item that someone else also changed does it stop and open **Choose which numbers to keep**, one row per item ("Someone else" with their name and movement, or "You"). Choosing re-runs the merge and saves.
3. After three merges in a row that still fail, or if the latest records can't be loaded, it falls back to the manual **Resolve save conflict** dialog: **Recheck shared records**, **Download my local changes**, or **Discard local changes and reload**.
4. Separately, every 60 seconds and whenever the app is reopened, a device with nothing waiting to save, no dialog open and no box being typed in loads the latest shared records, so people see each other's changes without reloading.

## 11. Offline / interrupted-session resilience

1. Every change is written to a per-user `localStorage` draft immediately, before any network call.
2. Going offline switches the status line to "Offline — changes have not reached the shared records"; coming back online automatically retries.
3. Closing the tab or hiding it while a stocktake dialog is open force-flushes that dialog's draft first; `beforeunload` also warns the browser if there's unsaved shared-state work.
4. Failed saves keep a stable `requestId` so a retry cannot be double-applied server-side as long as it's still the latest saved request.

## Known limits that affect these flows

- Stocktake, count and backup changes are saved on the device first. The alerts say to wait for the green "Saved to shared records" message, but nothing stops someone walking away before it appears. The draft stays in that browser and is recovered the next time that person opens the app there (section 1).
- Supplier order emails are sent by a person from their own email app. The app only records that they said it was sent.
- The automated checks (`tools/check-access.mjs`) don't exercise the Supabase-backed save, conflict and admin paths. Those are tested by hand on the preview link.
