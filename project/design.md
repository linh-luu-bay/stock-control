# Design reference — `dist/index.html`

Extracted from the shared frontend's inline `<style>` block. This documents the design system as implemented, not a target to redesign toward.

## Colour tokens

| Token | Value | Used for |
|---|---|---|
| `--ink` | `#132b28` | Header background, primary text, headings, active tab |
| `--cream` | `#f5f2e9` | Page background |
| `--paper` | `#fff` | Cards, inputs, dialogs |
| `--gold` | `#d99b2b` | Primary action buttons (`.btn.primary`) |
| `--red` | `#b73b35` | Danger/low-stock text, low-stock pill, invalid stocktake rows |
| `--muted` | `#64736f` | Secondary text, labels, placeholders |
| `--line` | `#dfe4df` | Borders, dividers |

Status colours outside the token set: `#31966a` (on-target dot / positive history change), `#23714f` (copy confirmation, positive change), `#8b2d28` (low-stock pill text), `#e7f0ed` / `#fae5e3` (pill backgrounds, neutral/low).

## Typography

- **Brand/headings**: Georgia, serif — `.brand` (22px/700), `h1` (34px/700), `.panel-head h2` (22px/700), dialog `h2` (24px/700), `.category-row` (17px/700).
- **Body/UI**: `system-ui, -apple-system, "Segoe UI", sans-serif`, 16px base, 1.45 line-height.
- **Monospace**: `ui-monospace, SFMono-Regular, Consolas, monospace` — used only for the reorder-list textarea.
- Uppercase, letter-spaced labels (`.02–.06em`) mark table headers and category item counts.

## Layout

- Single-column app shell, `max-width: 1180px`, centred, `22px` padding (`.shell`).
- `header` is a full-width dark bar (`--ink`) with brand left, account info + date right.
- Content stacks: title/toolbar row (`.top`) → area tabs (`.tabs`) → 3-column stat cards (`.stats`) → one card containing the stock table (`.card`).
- `footer` is centred, muted, small text — carries live sync status and recovery actions instead of navigation links.

## Components

- **Buttons** (`.btn`, `.tabs button`): white fill, 1px `--line` border, 9px radius, 600-weight 14px label. Active tab and primary actions invert to solid fill (`--ink` for active tab, `--gold` for primary).
- **Stat card** (`.card.stat`): big Georgia number (30px/700) over a muted caption; the "below target" stat is always rendered in `--red`.
- **Stock table**: sticky-feeling category divider rows (`.category-row`, bold serif, 2px top border) group items; each item row is a `.product-line` (48×48 photo button + stacked text) plus an editable quantity `<input>`, computed target column, a method `.pill`, and a status cell with a coloured `.dot` + label.
- **Pills**: rounded 20px badges — neutral `#e7f0ed`, low-stock variant `#fae5e3` on `--red`-family text.
- **Dialogs** (native `<dialog>`): 16px radius, no border, heavy drop shadow, dark 60%-opacity backdrop. Shared anatomy: `.modal-head` (title + `×` close), `.modal-body`, `.modal-actions` (right-aligned button row, primary action last).
- **Forms**: `.form-grid` is a responsive 2-column grid (`.field.full` spans both); every field stacks a bold 14px label over a full-width input/select/textarea with 9px radius.
- **Info banners**: `.movement-help` (light grey, muted text) for contextual instructions; `.staff-banner` (same grey, bold key facts) for "who/what" context in stocktake and movement flows.
- **Inactive/disabled state**: discontinued items render at `opacity:.62` (`.inactive-item`) and their status column always reads "Discontinued" regardless of stock level.

## Responsive behaviour

- `@media (max-width: 720px)`: stat cards collapse to 1 column, shell padding tightens, table wrapper scrolls horizontally, header wraps, toolbar buttons/inputs stretch to full width.
- `@media (max-width: 620px)`: dialog `.form-grid` collapses to 1 column; `.staff-banner` switches from flex row to block.

## Iconography

No icon font/SVG sprite — the only glyphs are a camera emoji (📷) as the photo-button placeholder and a plain `×` for dialog close buttons. The favicon and app icon are inline SVGs (rounded square, `--ink`-family background, gold shelf glyph).

## Design gaps to flag before a real trial

- No focus-visible styling beyond the browser default — worth checking contrast/keyboard visibility given `TRIAL-READINESS.md` calls out untested Safari/iPhone behaviour.
- Only one dark colour (`--ink`) carries both "brand" and "danger-adjacent" duty in a couple of components (e.g. active tab vs status dot); low but non-zero risk of colour-only status meaning for colour-blind users — the dot is always paired with text, which mitigates this.
