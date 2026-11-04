-- Cleaning area: lets suppliers be tagged "Cleaning" and supplier orders be sent from the new
-- Cleaning tab. Before this, both checks only allowed Bar, Kitchen and Barista, so ticking
-- Cleaning on a supplier or starting an order on the Cleaning tab failed with a database error.
--
-- Apply to STAGING first, then to live BEFORE merging the app change. Needs the supplier order
-- and supplier area migrations (20261012120000, 20261013120000). Safe to re-run.
--
-- No new tables, so no grants or row-level security changes. Existing rows are untouched:
-- every value they hold is still allowed.

alter table suppliers drop constraint if exists suppliers_areas_valid;
alter table suppliers add constraint suppliers_areas_valid
  check (areas <@ array['Bar','Kitchen','Barista','Cleaning']);

alter table order_requests drop constraint if exists order_requests_area_valid;
alter table order_requests add constraint order_requests_area_valid
  check (area in ('Bar', 'Kitchen', 'Barista', 'Cleaning'));
