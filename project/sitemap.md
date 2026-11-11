# Sitemap — `dist/index.html`

The shared frontend is a single HTML page. It has two views: the **Stock overview** (the default) and the **Admin page** (managers only), which swap in place. The Admin page is reached through the address hash (`#admin/<tab>`), so the browser Back button and bookmarks work; there is no other routing. Everything else is a native `<dialog>` overlay toggled by JS. Visibility of most controls depends on `currentUser.role` (`staff` / `supervisor` / `manager`), set from `/api/bootstrap`.

```
/ (index.html) — Stock overview
├─ Header (persistent, shown on both views)
│  ├─ Brand
│  ├─ Account name + role
│  ├─ "Admin" button ──────────────────► Admin page (see below)          [manager only]
│  ├─ "Sign out"
│  └─ Today's date
│
├─ Toolbar (persistent, above tabs)
│  ├─ "Start stocktake" ──────────────► Start stocktake dialog          [all roles]
│  ├─ "Record movement" ──────────────► Record stock movement dialog   [all roles]
│  ├─ "Data backup" ───────────────────► Data backup dialog             [manager only]
│  └─ "+ Add item" ────────────────────► Add stock item dialog          [manager only]
│
├─ Area tabs (persistent, client-side state only; managers add, rename, reorder and archive them in Admin → Categories)
│  ├─ Bar        (default)
│  ├─ Kitchen
│  ├─ Barista
│  └─ Cleaning   (categories: Bar, Kitchen, Barista; transfers off by default)
│
├─ Stats row (persistent, recalculated per area/filter)
│  ├─ Items tracked
│  ├─ Below target
│  └─ Order packs needed
│
├─ Stock panel (persistent, per selected area)
│  ├─ Heading — "<Area> stock"
│  ├─ Target selector — Default / Day / Evening / Event
│  ├─ Search box
│  ├─ "History" button ────────────────► Weekly stock history dialog   [hidden for staff]
│  ├─ "Show discontinued" toggle                                       [manager only]
│  ├─ "Reorder list" button ───────────► Reorder list dialog           [hidden for staff]
│  └─ Item table, grouped by category (order and names set in Admin → Categories)
│     └─ per-row actions (inline, not dialogs):
│        ├─ Photo button → file picker (camera capture)                [manager only]
│        ├─ Remove photo                                               [manager only]
│        ├─ Change supplier (prompt())                                 [manager only]
│        ├─ Change order pack (prompt())                                [manager only]
│        ├─ Change portion size (prompt(), portions unit only)          [manager only]
│        ├─ "Edit item" ───────────────► Edit stock item dialog          [manager only]
│        └─ On-hand quantity input (inline edit)                       [disabled for staff]
│
└─ Footer (persistent — sync/status bar, not navigation)
   ├─ Live sync status text
   ├─ "Retry save"
   ├─ "Download unsaved work"
   └─ "Resolve conflict" ──────────────► Resolve save conflict dialog   [shown only on 409 conflict]

#admin/<tab> — Admin page                                               [manager only]
├─ Heading — "Admin" + "← Back to stock"
├─ Message line (success / error after each action)
├─ Tabs: Suppliers (default) · Staff accounts · Categories · Change log · Settings
│
├─ Suppliers           #admin/suppliers
│  ├─ Search box, area filter, status filter (Active / Archived / All suppliers)
│  ├─ "+ Add supplier" ────────────────► Add / Edit supplier dialog
│  └─ Supplier table: Supplier (+ account number), Areas, Contact (rep, tap-to-call phone,
│     ordering email), Ordering (order days + cut-off), Delivery days, Minimum order
│     └─ per-row: "Edit" ───────────────► Add / Edit supplier dialog
│                 "Archive" / "Restore" (confirm before archiving; nothing is deleted)
│
├─ Staff accounts      #admin/accounts
│  ├─ Form: Name, Email address, Access level (Staff / Supervisor / Manager),
│  │  Account status (Active / Deactivated); "Add account" or "Save changes"; "New member" resets it
│  └─ Accounts table: Name ("Awaiting sign-in" until first sign-in), Email, Access level, Status
│     └─ per-row: "Edit" (fills the form above; email can't be changed)
│
├─ Categories          #admin/categories
│  ├─ Section tabs (one per active section) + "+ Add section" ─► Category / section dialog
│  ├─ Selected section's card
│  │  ├─ ← → (change the tab order) and ⋯ → Rename / Archive ──► Category / section dialog
│  │  ├─ Switch: "Can transfer stock"
│  │  ├─ Switch: "Shows in supplier orders"
│  │  └─ "Archived sections (n)" → Restore
│  ├─ "Add category" box, "Expand all" / "Collapse all"
│  ├─ Category list, in the order staff see them (item count each)
│  │  ├─ ↑ ↓ move, ⋯ → Rename / Archive ─────────────────────► Category / section dialog
│  │  └─ ▸ expand → subgroups: ↑ ↓ move, ⋯ → Rename / Archive, Restore, "Add subgroup" box
│  └─ "Archived (n)" categories → Restore
│
├─ Change log          #admin/log
│  ├─ Filters: From, To (shown as DD/MM/YYYY), Person, Section, Type of change; "Clear filters"
│  ├─ Entries, newest first: Hobart time, one-line summary, section pill
│  │  └─ tap an entry → Detail / Before / After table + "Show raw data"
│  └─ "Show older changes" (100 at a time)
│
└─ Settings            #admin/settings
   └─ Form: Venue delivery address, Venue phone, Venue email, Sender name, Sender role; "Save settings"
```

## Dialogs (modal overlays — the app's "sub-pages")

| Dialog | Opened from | Role gate | Purpose |
|---|---|---|---|
| Choose which numbers to keep | Opens by itself after a 409 when someone else changed the count of the same item; also from "Resolve conflict" | any | Pick "Someone else" or "You" for each clashing count; everything else merges automatically |
| Resolve save conflict | Banner / footer "Resolve conflict" when automatic merging can't finish | any | Compare local vs. shared quantities after a 409; download, recheck, or discard local changes |
| Reorder list | "Reorder list" | supervisor, manager | Generated supplier-grouped reorder text; copy or download CSV |
| Weekly stock history | "History" | supervisor, manager | Per-week movement/audit log; download CSV |
| Record stock movement | "Record movement" | all | Log delivery / wastage / transfer / staff meal / correction against one product |
| Start stocktake | "Start stocktake" | all | Physical count entry per area, with draft autosave and variance-reason enforcement |
| Add stock item | "+ Add item" | manager | Create a new product with unit, targets, supplier, pack size, portion info and optional unit cost |
| Edit stock item | row "Edit item" | manager | Edit an existing product's metadata (not its on-hand quantity), including its unit cost and moving it to another section |
| Add / Edit supplier | Admin → Suppliers: "+ Add supplier" or row "Edit" | manager | Name, rep, phone, ordering email, account number, notes, areas, order days, order cut-off, delivery days, minimum order; "Archive supplier" / "Restore supplier" when editing |
| Category / section | Admin → Categories: "+ Add section", or Rename / Archive under ⋯ | manager | Add a section (with its first category); rename a section, category or subgroup; archive one, choosing where its items move to |
| Data backup | "Data backup" | manager | Download/import JSON backups; manager also gets "Download recovery point" (`/api/recovery`) |

## Backend endpoints the page depends on

- `GET /api/bootstrap` — initial user identity, revision, shared state (`data`, `history`, `stocktakes`) and `layout` (each area's categories and subgroups, in order; archived ones are flagged).
- `PUT /api/state` — save shared state; idempotent via `requestId`, returns `409` on conflict.
- `GET /api/recovery`, `GET /api/recovery?id=` — list and download server-side recovery snapshots.

Admin routes. Every `/api/admin/*` route and `/api/users` returns `403` ("Only managers can use the admin area.") for anyone but a manager, and Supabase row-level security enforces the same rule.

- `GET /api/admin/suppliers`, `POST /api/admin/suppliers`, `PATCH /api/admin/suppliers?id=` — Admin → Suppliers: list, add, edit, and archive/restore (a `PATCH` with `archived`).
- `GET /api/users`, `POST /api/users` — Admin → Staff accounts: list, and add or update by email. A manager can't deactivate or demote their own account.
- `POST /api/admin/layout` — Admin → Categories: one change per request (add, rename, move up/down, archive with "move items to", restore a category or subgroup; add, rename, move, archive, restore or switch a section). Updates the layout and the affected items together and returns the new `layout` and revision. Archiving a section, or turning off "Shows in supplier orders", is refused while that section has draft supplier orders.
- `GET /api/admin/change-log` (`from`, `to`, `user`, `section`, `action`, `before`; 100 rows per page), `GET /api/admin/change-log/people` — Admin → Change log.
- `GET /api/admin/settings`, `PATCH /api/admin/settings` — Admin → Settings.
- `/api/admin/order-requests` (`GET`, `POST`, `/sent`, `/cancel`) — supplier order emails from the Reorder list; not an Admin tab, but they use the Settings and appear in the Change log.

## Not part of this sitemap

- `Bay-Bellerive-Local-Trial.html` is a separate standalone build (no `/api/*` calls, browser-storage only) with its own extra kitchen features — not reflected here since it is not yet merged into `dist/index.html`.
