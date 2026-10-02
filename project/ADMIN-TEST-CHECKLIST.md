# Admin area: test checklist for the preview

Run this on the Cloudflare **preview** address for the `feature/admin-area` branch before merging. The preview must point at the **staging** Supabase project, not live (see README.md, "Admin area → Applying the migrations to staging").

**You'll need two Google accounts in the staging `users` table:**

- **Manager**: your own account (see "Setting the first admin" in the README).
- **Staff**: a second account. You'll add it in section C, and it's used again in section G.

Tick each box as you go. If anything fails, note what you did and what you saw.

---

## A. Before you start

- [ ] The preview address opens and shows "Log in with Google".
- [ ] Signing in with the manager account works, and the stock screen loads.
- [ ] You're on staging, not live. Stock should be empty or show only data you imported into staging. If you see today's real counts, stop: the preview is pointing at live.

## B. Suppliers

- [ ] **Admin** appears in the header. Tap it and the **Suppliers** tab opens.
- [ ] If you imported a backup (README step 7), the supplier names from your stock items are listed.
- [ ] **+ Add supplier** with every field filled in:
  - name, rep name, phone and ordering email
  - account number
  - order days Mon + Thu, cut-off 2:00 pm, delivery days Tue + Fri
  - minimum order 250, and some notes
- [ ] Save shows "… has been added." The row shows "Mon, Thu / Cut-off 2:00 pm", "Tue, Fri" and "$250.00".
- [ ] The phone number and email are tappable (they open the phone dialler or email app).
- [ ] **Edit** the supplier, change the phone number, and save. You see "… has been updated.", and the new number shows.
- [ ] Each of these gives a clear message and saves nothing:
  - a blank name
  - a name that already exists, typed with different capitals (for example "BIDFOOD")
  - an ordering email with no "@"
  - a minimum order of -5
- [ ] Search finds a supplier by part of its name, rep name or phone.
- [ ] **Archive** asks "Archive …?" first. Choosing **Cancel** leaves it where it was.
- [ ] **Archive** again and choose **OK**. It disappears from **Active**, appears under **Archived**, and a success message shows.
- [ ] **Restore** from the Archived list brings it back to Active.
- [ ] There is no Delete button anywhere.

## B2. Master data → Categories

Run `20261002130000_master_data_categories.sql` on staging first.

- [ ] **Admin** has a **Master data** tab between Suppliers and Staff accounts, with a **Categories** sub-tab.
- [ ] For each area (Bar, Kitchen, Barista), the categories are in the same order as on the stock page, with the right item counts and subgroups (Barista → Retail Items → Retail Coffee Beans).
- [ ] **+ Add category**, e.g. "Test category" in Bar. It appears last in the list and on the Bar stock page's category filter.
- [ ] Adding the same name again (any capitals) gives "This area already has a category with that name."
- [ ] **↑ / ↓** move it. The stock page shows the new order.
- [ ] **+ Subgroup** on it, e.g. "Test subgroup". Edit an item on the stock page: the Subgroup field suggests it. Typing a subgroup that isn't listed is refused with a message pointing to Master data.
- [ ] **Rename** a category that has items (e.g. Spirits → Spirits & Liqueurs). The dialog says how many items move. Afterwards the stock page shows those items under the new name, with nothing missing, and the footer says "Saved to shared records".
- [ ] Rename it back.
- [ ] **Delete** a category that still has items: refused, with how many items are in it. Delete "Test category": it goes, along with its subgroup.
- [ ] **CSV import** with a subgroup that isn't listed for its category skips that row and says why.
- [ ] **Change log** shows the category and subgroup changes (Section: Categories / Subgroups), plus one stock item entry for each item a rename moved.
- [ ] On a second device with the stock page open during a rename, the next save there reports a conflict instead of undoing the rename.

## C. Staff accounts

- [ ] The **Staff accounts** tab lists existing accounts with Active / Deactivated status.
- [ ] Add the staff test account (access level **Staff**). You see a message saying they can now sign in.
- [ ] Edit that account, change the access level to **Supervisor**, and save. You're asked to confirm the change from Staff to Supervisor. Choosing **Cancel** changes nothing.
- [ ] Save again and choose **OK**. The level updates.
- [ ] Edit it, set status to **Deactivated**, and save. You're asked to confirm. After **OK** it shows as Deactivated.
- [ ] In a private browser window, the deactivated account can't sign in ("You don't have access…").
- [ ] Reactivate it and set it back to **Staff**.
- [ ] Edit your own account and set yourself to Staff. You're blocked with "You cannot disable or remove your own manager access."

## D. Change log

- [ ] The **Change log** tab shows what you just did, newest first, in plain English. For example: "*Your name* added supplier …", "*Your name* changed …'s phone … → …", "*Your name* archived supplier …", "*Your name* changed …'s access level Staff → Supervisor".
- [ ] Dates and times are **DD/MM/YYYY** in **Hobart time**, and match the clock.
- [ ] Tap an entry. A Before / After table opens, and **Show raw data** reveals the technical detail.
- [ ] Go **Back to stock**, open **Edit item** on a product, and change its **Default target / par level** (for example 48 → 72). Wait for "Saved to shared records". The change log shows "*Your name* changed *Item* par level 48 → 72".
- [ ] Change only an on-hand **count** on the stock screen. **No** new change-log entry appears; the count shows in **History** as before.
- [ ] In **Edit item**, set **Item status** to **Discontinued**. The log shows "*Your name* discontinued *Item*".
- [ ] Filters:
  - **From/To** set to today shows only today.
  - **Person**, **Section** and **Type of change** each narrow the list.
  - **Clear filters** shows everything again.
  - A **From** date after the **To** date shows a message.
- [ ] In the staging Supabase dashboard, open **Table Editor → change_log** and try to edit or delete a row. It's refused ("The change log is read-only…").
- [ ] In the Table Editor, edit a supplier's notes directly. The app's change log then shows an entry by "Supabase dashboard".

## E. Phone and tablet

Use a real phone and a tablet if you can, or a narrow browser window.

- [ ] On a phone, each supplier and staff account shows as a stacked card, and nothing needs sideways scrolling.
- [ ] The supplier form is easy to fill on a phone: the day buttons are big enough to tap, the keyboard shows numbers for the minimum order, and there's a time picker for the cut-off.
- [ ] The change log is readable on a phone, and tapping an entry opens its details.
- [ ] On a tablet in both orientations, the three tabs and the tables are readable.

## F. Nothing else broke

- [ ] **Back to stock** returns to the normal stock screen.
- [ ] Reloading while on an Admin tab keeps you on that tab.
- [ ] Start a stocktake, record a movement, add an item, and open History and the Reorder list. All work as before.
- [ ] Sign out, then sign back in.

## G. Staff can't get in

Sign in with the **staff** account.

- [ ] There's no **Admin** button.
- [ ] Typing the preview address with `#admin/suppliers` on the end shows the normal stock screen, not Admin.
- [ ] Stocktakes and movements still work for staff.

---

When everything is ticked, it's ready to merge. Before or at the same time as deploying, apply the migrations to the **live** Supabase project (README: "Going live: order matters").
