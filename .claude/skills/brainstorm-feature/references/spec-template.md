# Feature spec template

Use this for `project/specs/<feature-name>.md`. Five numbered sections, then the closing sections.
Write in plain Australian English, in the user's own words wherever possible. Keep it short for simple
features. Don't pad a section just to fill it.

Tags you may use anywhere:
- `[unclear]`: the user hasn't said. Never guess to fill it.
- `[my assumption]`: you inferred it. Confirm every one before handing over.
- **Needs Linh**: touches a protected area in AGENTS.md section 3.

---

```markdown
# <Feature name, in the user's word>

**Asked for by:** <name> · **Date:** <DD/MM/YYYY> · **Status:** Draft spec, not built

**In one sentence:** <what it lets someone do, in their words>

**Safe or Needs Linh:** <Safe: only changes existing screens / only reads what the app already has>
OR <Needs Linh: list which protected areas, e.g. "stores something new (database)",
"changes who can see costs (permissions)">

## 1. Users & problem

| Role | Area | The question they want answered |
|---|---|---|
| staff / supervisor / manager | Bar / Kitchen / Barista / all | "<their words>" |

**How it's done now:** <paper sheet, spreadsheet, memory…>
**Where it hurts most:** "<their EXACT words>"
**What changes if it works:** <on a shift / at the end of the week>

## 2. How it works on a shift

Use ONE of the two forms below.

### Form A: it goes through steps

| Step | Who does it | What they do | Waits for sign-off by |
|---|---|---|---|
| 1. <step> | <role> | <action> | — / supervisor / manager |
| 2. <step> | … | … | … |

What can go back a step, and who can do that: <…>

### Form B: it's recorded once

<Who> records a <thing> when <moment on the shift>. After that it <never changes / can be
corrected by <role> / can be archived by <role>>.

### Numbers the app must work out

Never stored, always worked out when the screen opens.

| Number | Worked out as | If something is "Not counted" / "Not set" |
|---|---|---|
| <e.g. Amount below PAR> | <PAR minus count on hand> | <left out, shows "Not set"> |

## 3. Screens

Use real screen names from `project/sitemap.md`. Mark each as changed or new.

| Screen | Changed or new | Who sees it | What's on it | What you can do there |
|---|---|---|---|---|
| <e.g. Bar → Stock> | changed | staff+ | <…> | <…> |

Phone and tablet: <anything specific about using it on the floor: what must be visible without
scrolling, what's tapped most>

## 4. Information

For each thing: what it holds, and the ONE-or-MANY answers the user gave.

**Already in the app:** <items, counts, PAR, suppliers… which ones this feature uses>

**New (Needs Linh):** <only if the feature stores something new>

| Thing | Holds | One-or-many (user's answer) |
|---|---|---|
| <e.g. Waste entry> | item, quantity, reason, who, when | one item per entry; an item has many entries |

Unknown values: <what shows when a count or PAR isn't entered. Never treated as 0>
Removing things: <archived / deactivated / marked discontinued. Never deleted>
Costs: <shown to managers only / not involved>

## 5. Done when

Things to tap on the **preview link** (staging, so test data is safe). Each one has an action and
what you should see. No adjectives.

1. <Tap … → see …>
2. <Save a <thing> with <field> left blank → a message says what's missing, nothing is saved>
3. <Record one more <thing> → <figure> goes up correctly>
4. <Archive a <thing> entered by mistake → <figure> corrects itself>
5. <An item with no count → shows "Not counted", not in the low-stock list>
6. <Signed in as staff → <costs / manager-only part> isn't shown>
7. <Works on a phone: <the main action> can be done without zooming or scrolling sideways>

## Needs Linh

Only if anything is protected. For each one: what it is, why it's needed, in plain English.

- <e.g. A new place to store waste entries (database). Needed because waste is recorded once and
  kept, and nothing in the app holds it today.>

## Considered and deferred

What was cut, and why, in the user's words where they gave a reason. This is the plan for later rounds.

- <Feature>: <reason>

## Still missing

Only if the session stopped early. The exact questions not yet asked.

- <question>
```
