# AGENTS.md: house rules for the Bay Bellerive stock app

These rules apply to every AI tool and every session. Two people edit this code with different
tools: **Linh** (maintainer, reviews and merges) and **Joe** (venue owner, non-technical).
The tools can't see each other's work, so this file is how they stay consistent.

## 1. Project overview

Stock control for Bay Bellerive, a bar and restaurant in Tasmania. Staff count and move stock in
the Bar, Kitchen and Barista areas; managers also set PAR levels, see costs and run the Admin area
(suppliers, staff accounts, change log). Roles: `staff`, `supervisor`, `manager`.

- **Frontend:** one file, `project/dist/index.html`: plain HTML, CSS and JavaScript, no framework.
- **Backend:** a Cloudflare Worker, source `project/worker/server-template.js`.
- **Data:** Supabase (Postgres). **Sign-in:** Google, through Supabase Auth; only emails in the `users` table get in.
- **Hosting:** Cloudflare deploys `main` to https://bay-bellerive-stock.baybellerivestockcontrol.workers.dev.
  Every other branch gets a preview link that uses the separate **staging** database.
- No npm packages. Needs Node.js 22.13 or later.

## 2. Collaboration workflow (every session, every tool)

1. **Start from the latest `main`** on a new branch named `<name>/<short-description>`:
   ```
   git fetch origin
   git switch -c joe/supplier-notes-field origin/main
   ```
   Branch from `origin/main`, not your local `main`. It is often out of date, and an old branch
   fails Cloudflare's preview build ("missing a `previews` block").
2. **Never commit or push to `main`.**
3. One topic per branch. Keep changes small and aim to merge within a day or two.
4. Finish by pushing the branch and opening a pull request using the template in section 9.
5. **Only Linh merges to `main`,** and only outside the venue's service hours. Merging deploys
   straight to the live site automatically; there is no separate deploy step.

## 3. Protected areas: stop and ask

If a request touches anything below, **do not make the change.** Explain in plain English what it
would affect, and tell the user to raise it with Linh.

- **Database (Supabase):** `project/supabase/` (schema, migrations), tables, columns, types,
  row-level security policies, triggers, functions. Never run SQL against any Supabase project.
- **Sign-in and permissions:** Google sign-in, the `users` table, roles, who can see costs, and
  the backend file `project/worker/server-template.js` as a whole (it holds sign-in checks,
  permissions, saving and validation).
- **Secrets and settings:** `.env` files (including `project/worker/.env.local`, which holds live
  keys), API keys, the Supabase service role key. Never print, copy, commit or hardcode them.
  The Supabase URL and the public "anon/publishable" key in `wrangler.toml` and `index.html` are
  public on purpose. Leave them alone.
- **Cloudflare deployment and build:** both `wrangler.toml` files and `project/tools/build-worker.mjs`.
- **Packages and libraries:** adding any dependency, including a `<script>` from a CDN.
- **Deleting files, or bulk changes** across many files or many sections of `index.html`.
- **Stock data:** anything that changes, imports, migrates or bulk-edits existing records,
  including the shape of saved stock items, `project/tools/import-*.mjs`, CSV import,
  backup/restore and recovery points.

## 4. Safe areas: OK to change on a branch

These are all in `project/dist/index.html`:

- Wording, labels, help text and messages.
- Layout and styling, using the existing colours and classes.
- The order of buttons, tabs and menus.
- Sorting and filtering on existing screens.
- New views or reports that only **read** data the page already loads.

If a "safe" change turns out to need a backend, database or permission change, stop (section 3).

## 5. Coding conventions

**Match the existing patterns. Don't introduce new libraries, frameworks, build tools or approaches.**

- **Where code lives:** edit only `project/dist/index.html` (frontend) and
  `project/worker/server-template.js` (backend, Linh only). `project/worker/index.js` and
  `project/dist/server/index.js` are **generated**. Never edit them by hand.
- **Rebuild after every change** to either source file, and commit the result:
  `node project/tools/build-worker.mjs`. Cloudflare deploys the committed bundle without
  rebuilding, so skipping this ships the old version.
- **Styling:** the inline `<style>` in `index.html`. Use the colour variables (`--ink`, `--cream`,
  `--paper`, `--gold`, `--red`, `--muted`, `--line`) and existing classes (`.btn`, `.btn.primary`,
  `.card`, `.form-grid`, `.field`, `.pill`). Dialogs are native `<dialog>` elements with
  `.modal-head`, `.modal-body` and `.modal-actions`. See `project/design.md`.
- **JavaScript style:** compact, no modules. `$('#id')` is `document.querySelector`. Screens are
  drawn by `render…()` functions that build HTML with template strings. **Always wrap any stored
  or typed text in `escapeHtml()`.**
- **Naming:** HTML ids and CSS classes in kebab-case (`supplier-name`), JS functions and variables in
  camelCase (`renderSuppliers`), database tables and columns in snake_case (`min_order_aud`).
  Saved stock items use short keys (`n` name, `a` area, `q` quantity, `t` PAR). Don't rename them.
- **Data:** the page never reads or writes Supabase directly. It calls the Worker's `/api/*`
  routes through `apiFetch()`, which adds the sign-in token. Stock is one shared document:
  loaded by `GET /api/bootstrap`, saved by `PUT /api/state`. Admin screens use `/api/admin/*`.
- **Unknown stays unknown:** a `null` quantity or PAR means "Not counted" / "Not set". Never turn
  it into `0`, and leave it out of low-stock and reorder maths.
- **Docs:** screens and flows are described in `project/sitemap.md` and `project/userflow.md`.

## 6. App conventions

- **Plain English** in the UI, no technical jargon. Users are venue staff on shift. Error
  messages say what happened and what to do, e.g. "That supplier couldn't be found."
- **Australian conventions:** AUD, DD/MM/YYYY, Australia/Hobart time, Australian/British spelling
  (colour, organise, cancelled). Reuse the `AUD` and `HOBART_DATE_TIME` formatters in `index.html`.
- **Archive, don't delete:** suppliers are archived, staff accounts deactivated, stock items
  marked discontinued. Never add a hard delete.
- **Mobile and tablet first:** it's used on the floor. Check the 720px and 620px layouts, keep
  buttons easy to tap, and don't add anything that needs hover or a wide screen.

## 7. Talking to a non-technical user

With Joe, or whenever the user seems non-technical:

- **Before** changing anything, explain in plain English what you'll change and why.
- **After,** summarise what changed in plain English: which screen, what looks or works differently.
- Give **step-by-step instructions** with the exact commands to copy, and say what they should see.
- **If something fails,** explain what it means and what to do next. Don't just paste the error.
- Never ask them to edit config, secrets or the database, even to "quickly fix" something.

## 8. Checks before opening a PR

Run from the repo root:

```
node project/tools/build-worker.mjs           # rebuild the bundle (required after any change)
node --check project/dist/server/index.js     # bundle parses
node project/tools/check-access.mjs           # should end with PASS
node project/tools/check-kitchen.mjs          # should end with PASS
git fetch origin && git merge origin/main     # bring the branch up to date
```

- If the merge conflicts in the two generated files, keep either version and run the rebuild again.
- Confirm the new code is in the bundle: search `project/dist/server/index.js` for it.
- `git status` and the diff contain **no** `.env` files, keys or passwords.
- **Test on the preview link,** not locally. Push the branch, then open the preview address from
  the Cloudflare check on the pull request. It uses the staging database, so test data is safe.
  Signing in needs an account in the **staging** `users` table, which is separate from live.
  Only Linh can add one. Without it the preview says "You don't have access to this app": ask
  Linh to add you, or to test the preview for you.
- Don't run `project/tools/dev-server.mjs` unless Linh has set it up for you: it uses
  `project/worker/.env.local`, which may point at the **live** database.

There is no lint step and no full test suite. The preview check is the real test.

## 9. Commit and PR format

**Commits:** one short plain-English sentence starting with a verb, no prefixes.
E.g. "Add notes field to supplier form", "Hide Transfer to on non-transfer movements".

**Pull request description** (GitHub pre-fills it from `.github/pull_request_template.md`):

```
## What changed
(plain English)

## Why
(the business reason)

## Screens affected

## How to test on the preview link
1. ...

## Touches a protected area?
No / Yes: (what it touches; flag Linh to review)
```

## 10. When unsure

Stop and ask the user rather than guessing. If it's still unclear, recommend checking with Linh.
