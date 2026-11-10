-- Admin → Categories: lets managers add their own sections (tabs).
--
-- Suppliers and supplier orders used to allow only the four built-in sections, so a new section
-- would fail with a database error when ticked on a supplier or ordered from. This removes those
-- two fixed lists. The sections now live in the app_state document ("layout"), and the Worker
-- checks every supplier and order against them (project/worker/server-template.js).
--
-- Apply to STAGING first, then to live BEFORE merging the app change. Safe to re-run.
--
-- No new tables, so no grants or row-level security changes. Existing rows are untouched.
-- The change log trigger from 20261106120000_category_layout_log.sql already records section
-- changes, so it isn't changed.

alter table suppliers drop constraint if exists suppliers_areas_valid;

alter table order_requests drop constraint if exists order_requests_area_valid;
