-- Replaces every Barista item with the 53-item list from bay-bellerive-barista-import-template.csv
-- (2026-10-02). Bar and Kitchen items, stock history and stocktakes are left untouched.
--
-- The new items have no count and no PAR yet (q and t are null: "Not counted" / "PAR not set"),
-- unit "units", count method "Whole count", no supplier and no storage location, matching the
-- defaults the app's CSV import uses for blank columns.
--
-- Before changing anything it saves a recovery point (the same kind the app saves on every
-- save), so the old Barista items can be restored from Data backup if needed. It also bumps the
-- revision, so a page that was already open must reload before it can save over the new list.
--
-- Safe to re-run: the new items have fixed ids (barista-20261002-NN), and if any of them is
-- already present the migration does nothing. Deploy the matching index.html (with the new
-- Barista categories) before or together with this, or the items won't show on the Barista tab.

do $$
declare
  v_state app_state%rowtype;
  v_items jsonb;
  v_new_items jsonb;
begin
  select * into v_state from app_state where id = 1 for update;
  if not found then
    raise notice 'No stock records yet; nothing to replace. The app seeds the new Barista list itself.';
    return;
  end if;

  v_items := case when jsonb_typeof(v_state.value -> 'data') = 'array' then v_state.value -> 'data' else '[]'::jsonb end;

  if exists (select 1 from jsonb_array_elements(v_items) e where e ->> 'id' like 'barista-20261002-%') then
    raise notice 'The new Barista list is already in place; nothing to do.';
    return;
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', id, 'a', 'Barista', 'c', category, 'group', subgroup, 'n', name,
           'q', null, 't', null, 'tDay', null, 'tEvening', null, 'tEvent', null,
           'u', 'units', 'm', 'Whole count', 's', 'Unassigned supplier', 'location', 'Not set',
           'active', true, 'p', 1, 'pl', 'unit', 'pv', 0, 'pu', 'g', 'photo', '')
         order by ord)
    into v_new_items
  from (values
    (1, 'barista-20261002-01', 'Retail Items', 'Retail Coffee Beans', 'Villino Coffee - 1 kg'),
    (2, 'barista-20261002-02', 'Retail Items', 'Retail Coffee Beans', 'Villino Coffee - 500 g'),
    (3, 'barista-20261002-03', 'Retail Items', 'Retail Coffee Beans', 'Villino Coffee - 250 g'),
    (4, 'barista-20261002-04', 'Retail Items', 'Retail Coffee Beans', 'Villino Decaf Coffee - 500g'),
    (5, 'barista-20261002-05', 'Stationery and Point of Sale', '', 'Notepads'),
    (6, 'barista-20261002-06', 'Stationery and Point of Sale', '', 'Thermal Receipt Rolls'),
    (7, 'barista-20261002-07', 'Coffee and Hot Beverage Ingredients', '', 'Villino Coffee'),
    (8, 'barista-20261002-08', 'Coffee and Hot Beverage Ingredients', '', 'Sugar'),
    (9, 'barista-20261002-09', 'Coffee and Hot Beverage Ingredients', '', 'Matcha'),
    (10, 'barista-20261002-10', 'Coffee and Hot Beverage Ingredients', '', 'Chai Powder'),
    (11, 'barista-20261002-11', 'Coffee and Hot Beverage Ingredients', '', 'Chocolate Powder'),
    (12, 'barista-20261002-12', 'Coffee and Hot Beverage Ingredients', '', 'Cinnamon'),
    (13, 'barista-20261002-13', 'Coffee and Hot Beverage Ingredients', '', 'Marshmallows'),
    (14, 'barista-20261002-14', 'Syrups', '', 'Vanilla Syrup'),
    (15, 'barista-20261002-15', 'Syrups', '', 'Caramel Syrup'),
    (16, 'barista-20261002-16', 'Syrups', '', 'Hazelnut Syrup'),
    (17, 'barista-20261002-17', 'Tea', '', 'English Breakfast Tea'),
    (18, 'barista-20261002-18', 'Tea', '', 'Earl Grey Tea'),
    (19, 'barista-20261002-19', 'Tea', '', 'Peppermint Tea'),
    (20, 'barista-20261002-20', 'Tea', '', 'Lemongrass and Ginger Tea'),
    (21, 'barista-20261002-21', 'Tea', '', 'Chai Tea'),
    (22, 'barista-20261002-22', 'Tea', '', 'Green Tea'),
    (23, 'barista-20261002-23', 'Milk, Alternative Milk and Cream', '', 'Full Cream Milk'),
    (24, 'barista-20261002-24', 'Milk, Alternative Milk and Cream', '', 'Light Milk'),
    (25, 'barista-20261002-25', 'Milk, Alternative Milk and Cream', '', 'Cream'),
    (26, 'barista-20261002-26', 'Milk, Alternative Milk and Cream', '', 'Soy Milk'),
    (27, 'barista-20261002-27', 'Milk, Alternative Milk and Cream', '', 'Almond Milk'),
    (28, 'barista-20261002-28', 'Milk, Alternative Milk and Cream', '', 'Oat Milk'),
    (29, 'barista-20261002-29', 'Milk, Alternative Milk and Cream', '', 'Lactose-Free Milk'),
    (30, 'barista-20261002-30', 'Juice, Water and Cold Drinks', '', 'Apple Juice'),
    (31, 'barista-20261002-31', 'Juice, Water and Cold Drinks', '', 'Orange Juice'),
    (32, 'barista-20261002-32', 'Juice, Water and Cold Drinks', '', 'Coconut Water'),
    (33, 'barista-20261002-33', 'Juice, Water and Cold Drinks', '', 'Sparkling Water'),
    (34, 'barista-20261002-34', 'Takeaway Packaging and Consumables', '', 'Hot Takeaway Cups - 4 oz'),
    (35, 'barista-20261002-35', 'Takeaway Packaging and Consumables', '', 'Hot Takeaway Cups - 6 oz'),
    (36, 'barista-20261002-36', 'Takeaway Packaging and Consumables', '', 'Hot Takeaway Cups - 12 oz'),
    (37, 'barista-20261002-37', 'Takeaway Packaging and Consumables', '', 'Hot Takeaway Lids - 4 oz'),
    (38, 'barista-20261002-38', 'Takeaway Packaging and Consumables', '', 'Hot Takeaway Lids - 6 and 12 oz'),
    (39, 'barista-20261002-39', 'Takeaway Packaging and Consumables', '', 'Iced Takeaway Cups'),
    (40, 'barista-20261002-40', 'Takeaway Packaging and Consumables', '', 'Iced Takeaway Lids'),
    (41, 'barista-20261002-41', 'Takeaway Packaging and Consumables', '', 'Straws'),
    (42, 'barista-20261002-42', 'Takeaway Packaging and Consumables', '', 'Takeaway Food Boxes - Small'),
    (43, 'barista-20261002-43', 'Takeaway Packaging and Consumables', '', 'Takeaway Food Boxes - Large'),
    (44, 'barista-20261002-44', 'Takeaway Packaging and Consumables', '', 'Paper Bags - Small'),
    (45, 'barista-20261002-45', 'Takeaway Packaging and Consumables', '', 'Paper Bags - Large'),
    (46, 'barista-20261002-46', 'Takeaway Packaging and Consumables', '', 'Carry Trays'),
    (47, 'barista-20261002-47', 'Takeaway Packaging and Consumables', '', 'Wooden Forks'),
    (48, 'barista-20261002-48', 'Takeaway Packaging and Consumables', '', 'Wooden Knives'),
    (49, 'barista-20261002-49', 'Takeaway Packaging and Consumables', '', 'Wooden Spoons'),
    (50, 'barista-20261002-50', 'Takeaway Packaging and Consumables', '', 'Napkins'),
    (51, 'barista-20261002-51', 'Kitchen and Food-Handling Consumables', '', 'Baking Paper'),
    (52, 'barista-20261002-52', 'Kitchen and Food-Handling Consumables', '', 'Food Gloves'),
    (53, 'barista-20261002-53', 'Cleaning Chemicals', '', 'Coffee Machine Cleaning Chemical')
  ) as new_items(ord, id, category, subgroup, name);

  insert into audit_events (actor_email, actor_name, actor_role, action, details)
  values ('migration@bay-bellerive.local', 'Barista item list update', 'manager', 'recovery_snapshot',
          jsonb_build_object('format', 'bay-bellerive-stock-backup', 'version', 1,
                             'exportedAt', now(), 'revision', v_state.revision) || v_state.value);

  update app_state
     set value = jsonb_set(value, '{data}',
                   coalesce((select jsonb_agg(e) from jsonb_array_elements(v_items) e where e ->> 'a' is distinct from 'Barista'), '[]'::jsonb)
                   || v_new_items),
         revision = revision + 1,
         updated_at = now(),
         updated_by = 'migration@bay-bellerive.local'
   where id = 1;

  raise notice 'Replaced % Barista item(s) with % new ones.',
    (select count(*) from jsonb_array_elements(v_items) e where e ->> 'a' = 'Barista'),
    jsonb_array_length(v_new_items);
end;
$$;
