# Sitemap — `dist/index.html`

The shared frontend is a single HTML page (no router, no URL changes). "Screens" are either the one persistent view or native `<dialog>` overlays toggled by JS. Visibility of most controls depends on `currentUser.role` (`staff` / `supervisor` / `manager`), set from `/api/bootstrap`.

```
/ (index.html) — Stock overview
├─ Header (persistent)
│  ├─ Brand
│  ├─ Account name + role
│  ├─ "Accounts" button ──────────────► Staff accounts dialog          [manager only]
│  └─ Today's date
│
├─ Toolbar (persistent, above tabs)
│  ├─ "Start stocktake" ──────────────► Start stocktake dialog          [all roles]
│  ├─ "Record movement" ──────────────► Record stock movement dialog   [all roles]
│  ├─ "Data backup" ───────────────────► Data backup dialog             [manager only]
│  └─ "+ Add item" ────────────────────► Add stock item dialog          [manager only]
│
├─ Area tabs (persistent, client-side state only)
│  ├─ Bar        (default)
│  ├─ Kitchen
│  └─ Barista
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
│  └─ Item table, grouped by category
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
```

## Dialogs (modal overlays — the app's "sub-pages")

| Dialog | Opened from | Role gate | Purpose |
|---|---|---|---|
| Resolve save conflict | Footer "Resolve conflict" (auto-shown on save conflict) | any | Compare local vs. shared quantities after a 409; download, recheck, or discard local changes |
| Reorder list | "Reorder list" | supervisor, manager | Generated supplier-grouped reorder text; copy or download CSV |
| Weekly stock history | "History" | supervisor, manager | Per-week movement/audit log; download CSV |
| Record stock movement | "Record movement" | all | Log delivery / wastage / transfer / staff meal / correction against one product |
| Start stocktake | "Start stocktake" | all | Physical count entry per area, with draft autosave and variance-reason enforcement |
| Add stock item | "+ Add item" | manager | Create a new product with unit, targets, supplier, pack size, portion info |
| Edit stock item | row "Edit item" | manager | Edit an existing product's metadata (not its on-hand quantity) |
| Staff accounts | header "Accounts" | manager | List/add/update staff (name, email, role, active status) via `/api/users` |
| Data backup | "Data backup" | manager | Download/import JSON backups; manager also gets "Download recovery point" (`/api/recovery`) |

## Backend endpoints the page depends on

- `GET /api/bootstrap` — initial user identity, revision, and shared state (`data`, `history`, `stocktakes`).
- `PUT /api/state` — save shared state; idempotent via `requestId`, returns `409` on conflict.
- `GET /api/users`, `POST /api/users` — staff account list/create/update.
- `GET /api/recovery`, `GET /api/recovery?id=` — list and download server-side recovery snapshots.

## Not part of this sitemap

- `Bay-Bellerive-Local-Trial.html` is a separate standalone build (no `/api/*` calls, browser-storage only) with its own extra kitchen features — not reflected here since it is not yet merged into `dist/index.html`.
