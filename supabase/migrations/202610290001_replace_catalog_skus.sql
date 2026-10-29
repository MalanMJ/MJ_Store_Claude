-- Align existing variant identifiers with the authoritative October 28 inventory CSV.
-- Order item SKU fields are historical snapshots and intentionally remain unchanged.
begin;

do $$
declare
  conflicting_skus text;
begin
  select string_agg(mapping.new_sku, ', ' order by mapping.new_sku)
    into conflicting_skus
  from (values
    ('SAM-USB-A-C-BLACK', '2428559'),
    ('SAM-USB-A-C-WHITE', '2426741'),
    ('SAM-TA20-BLACK-15W', '2428458'),
    ('SAM-TA20-WHITE-15W', '2427347'),
    ('SAM-45W-ADAPTER', '2430678'),
    ('SAM-35W-ADAPTER-DUO', '2431287'),
    ('SAM-25W-ADAPTER-BLACK', '2428357'),
    ('SAM-25W-ADAPTER-WHITE', '2426842'),
    ('SAM-USB-C-C-1M-BLACK', '2428256'),
    ('SAM-USB-C-C-2M-BLACK', '2430779'),
    ('SAM-USB-C-C-2M-WHITE', '24487490'),
    ('SAM-65W-ADAPTER', '2430982'),
    ('APPLE-20W-ADAPTER', '2426438'),
    ('APPLE-USB-C-L-1M', '2427751'),
    ('APPLE-USB-C-L-2M', '2427852'),
    ('APPLE-USB-C-C-1M', '2428155'),
    ('APPLE-USB-C-C-2M', '24354153'),
    ('APPLE-EARPODS-LIGHTNING', '24329106'),
    ('APPLE-EARPODS-TYPE-C', '24330107'),
    ('APPLE-WATCH-USB-A', '24332121'),
    ('APPLE5W-ADAPTER', '2428054'),
    ('APPLE-USB-A-L-1M', '2427953'),
    ('APPLE-USB-A-L-2M', '2426337'),
    ('APPLE-61W-ADAPTER-2M-C-C-CABLE', '2427650'),
    ('APPLE-MAGSAFE', '2429568'),
    ('SAM-TYPE-C-AKG-BLACK', '2429467'),
    ('SAM-TYPE-C-AKG-WHITE', '2426539'),
    ('SAM-3-5-AKG-BLACK', '2427549')
  ) as mapping(old_sku, new_sku)
  join public.product_variants old_variant on old_variant.sku = mapping.old_sku
  join public.product_variants new_variant on new_variant.sku = mapping.new_sku
  where new_variant.id <> old_variant.id;

  if conflicting_skus is not null then
    raise exception 'Cannot replace catalog SKUs because target SKU(s) already belong to another variant: %', conflicting_skus;
  end if;

  update public.product_variants variant
  set sku = mapping.new_sku,
      updated_at = now()
  from (values
    ('SAM-USB-A-C-BLACK', '2428559'),
    ('SAM-USB-A-C-WHITE', '2426741'),
    ('SAM-TA20-BLACK-15W', '2428458'),
    ('SAM-TA20-WHITE-15W', '2427347'),
    ('SAM-45W-ADAPTER', '2430678'),
    ('SAM-35W-ADAPTER-DUO', '2431287'),
    ('SAM-25W-ADAPTER-BLACK', '2428357'),
    ('SAM-25W-ADAPTER-WHITE', '2426842'),
    ('SAM-USB-C-C-1M-BLACK', '2428256'),
    ('SAM-USB-C-C-2M-BLACK', '2430779'),
    ('SAM-USB-C-C-2M-WHITE', '24487490'),
    ('SAM-65W-ADAPTER', '2430982'),
    ('APPLE-20W-ADAPTER', '2426438'),
    ('APPLE-USB-C-L-1M', '2427751'),
    ('APPLE-USB-C-L-2M', '2427852'),
    ('APPLE-USB-C-C-1M', '2428155'),
    ('APPLE-USB-C-C-2M', '24354153'),
    ('APPLE-EARPODS-LIGHTNING', '24329106'),
    ('APPLE-EARPODS-TYPE-C', '24330107'),
    ('APPLE-WATCH-USB-A', '24332121'),
    ('APPLE5W-ADAPTER', '2428054'),
    ('APPLE-USB-A-L-1M', '2427953'),
    ('APPLE-USB-A-L-2M', '2426337'),
    ('APPLE-61W-ADAPTER-2M-C-C-CABLE', '2427650'),
    ('APPLE-MAGSAFE', '2429568'),
    ('SAM-TYPE-C-AKG-BLACK', '2429467'),
    ('SAM-TYPE-C-AKG-WHITE', '2426539'),
    ('SAM-3-5-AKG-BLACK', '2427549')
  ) as mapping(old_sku, new_sku)
  where variant.sku = mapping.old_sku;
end
$$;

commit;