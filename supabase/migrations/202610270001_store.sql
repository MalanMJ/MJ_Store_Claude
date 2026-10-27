-- Mobile Joe store: storefront catalog, private inventory, checkout reservations and staff tools.
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  brand text not null default '',
  category text not null,
  description text not null default '',
  specs jsonb not null default '[]'::jsonb,
  featured boolean not null default false,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  attributes jsonb not null default '{}'::jsonb,
  price_cad numeric(10,2) not null check (price_cad >= 0),
  in_stock boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Exact counts live in this admin only table and are never selected by storefront visitors.
create table if not exists public.inventory (
  variant_id uuid primary key references public.product_variants(id) on delete cascade,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  marketplace_qty integer check (marketplace_qty is null or marketplace_qty >= 0),
  updated_at timestamptz not null default now(),
  check (reserved <= on_hand)
);

create or replace function public.sync_variant_availability()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update public.product_variants set in_stock = (new.on_hand - new.reserved > 0), updated_at = now()
    where id = new.variant_id;
  return new;
end;
$$;
drop trigger if exists inventory_availability_changed on public.inventory;
create trigger inventory_availability_changed after insert or update of on_hand, reserved on public.inventory
for each row execute function public.sync_variant_availability();

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'pending' check (status in ('pending','paid','fulfilled','expired')),
  currency text not null default 'cad' check (currency = 'cad'),
  total_cents integer not null check (total_cents >= 0),
  stripe_session_id text unique,
  reserved_until timestamptz not null default now() + interval '35 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  sku text not null,
  product_name text not null,
  attributes jsonb not null default '{}'::jsonb,
  quantity integer not null check (quantity between 1 and 20),
  unit_price_cents integer not null check (unit_price_cents >= 0)
);

create table if not exists public.marketplace_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  records_seen integer not null default 0,
  records_updated integer not null default 0,
  records_skipped integer not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.is_store_admin(_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public, pg_temp set row_security = off
as $$ select exists (select 1 from public.admin_users where user_id = _user_id); $$;

alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.inventory enable row level security;
alter table public.admin_users enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.marketplace_sync_runs enable row level security;

drop policy if exists "active products are public" on public.products;
create policy "active products are public" on public.products for select to anon, authenticated using (active);
drop policy if exists "admins manage products" on public.products;
create policy "admins manage products" on public.products for all to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

drop policy if exists "store variants are public" on public.product_variants;
create policy "store variants are public" on public.product_variants for select to anon, authenticated using (active and exists (select 1 from public.products p where p.id = product_id and p.active));
drop policy if exists "admins manage variants" on public.product_variants;
create policy "admins manage variants" on public.product_variants for all to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

drop policy if exists "admins manage inventory" on public.inventory;
create policy "admins manage inventory" on public.inventory for all to authenticated using (public.is_store_admin()) with check (public.is_store_admin());
drop policy if exists "users see own admin row" on public.admin_users;
create policy "users see own admin row" on public.admin_users for select to authenticated using (user_id = auth.uid());

drop policy if exists "admins read orders" on public.orders;
create policy "admins read orders" on public.orders for select to authenticated using (public.is_store_admin());
drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders" on public.orders for update to authenticated using (public.is_store_admin()) with check (public.is_store_admin());
drop policy if exists "admins read order items" on public.order_items;
create policy "admins read order items" on public.order_items for select to authenticated using (public.is_store_admin());
drop policy if exists "admins read stock sync history" on public.marketplace_sync_runs;
create policy "admins read stock sync history" on public.marketplace_sync_runs for select to authenticated using (public.is_store_admin());
drop policy if exists "admins write stock sync history" on public.marketplace_sync_runs;
create policy "admins write stock sync history" on public.marketplace_sync_runs for insert to authenticated with check (public.is_store_admin());

grant select on public.products, public.product_variants to anon, authenticated;
grant all on public.products, public.product_variants, public.inventory to authenticated;
grant select on public.admin_users, public.orders, public.order_items, public.marketplace_sync_runs to authenticated;
grant update on public.orders to authenticated;
grant insert on public.marketplace_sync_runs to authenticated;

create or replace function public.reserve_store_order(p_email text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  item jsonb;
  v record;
  v_order_id uuid := gen_random_uuid();
  v_quantity integer;
  v_total integer := 0;
  v_lines jsonb := '[]'::jsonb;
begin
  if p_email is null or length(trim(p_email)) < 5 or length(p_email) > 320 or position('@' in p_email) < 2 then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 50 then
    raise exception 'Your bag is empty or has too many items.' using errcode = '22023';
  end if;
  for item in
    select jsonb_build_object('sku', requested.sku, 'quantity', requested.quantity)
    from (select entry.value->>'sku' as sku, sum((entry.value->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as entry(value) group by entry.value->>'sku') as requested
    order by requested.sku
  loop
    v_quantity := (item->>'quantity')::integer;
    if v_quantity is null or v_quantity < 1 or v_quantity > 20 then raise exception 'Each item quantity must be between 1 and 20.' using errcode = '22023'; end if;
    select pv.id as variant_id, pv.sku, pv.attributes, pv.price_cad, p.name, i.on_hand, i.reserved
      into v from public.product_variants pv join public.products p on p.id = pv.product_id
      join public.inventory i on i.variant_id = pv.id
      where pv.sku = item->>'sku' and pv.active and p.active for update of i;
    if not found then raise exception 'An item in your bag is no longer available.' using errcode = 'P0001'; end if;
    if v.on_hand - v.reserved < v_quantity then raise exception 'Not enough stock for %.', v.name using errcode = 'P0001'; end if;
    update public.inventory set reserved = reserved + v_quantity, updated_at = now() where variant_id = v.variant_id;
    v_total := v_total + round(v.price_cad * 100)::integer * v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('sku',v.sku,'name',v.name,'quantity',v_quantity,'unit_price_cents',round(v.price_cad*100)::integer));
  end loop;
  insert into public.orders(id,email,total_cents) values(v_order_id,trim(p_email),v_total);
  for item in
    select jsonb_build_object('sku', requested.sku, 'quantity', requested.quantity)
    from (select entry.value->>'sku' as sku, sum((entry.value->>'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) as entry(value) group by entry.value->>'sku') as requested
    order by requested.sku
  loop
    select pv.id as variant_id,pv.sku,pv.attributes,pv.price_cad,p.name into v
      from public.product_variants pv join public.products p on p.id=pv.product_id where pv.sku=item->>'sku';
    insert into public.order_items(order_id,variant_id,sku,product_name,attributes,quantity,unit_price_cents)
    values(v_order_id,v.variant_id,v.sku,v.name,v.attributes,(item->>'quantity')::integer,round(v.price_cad*100)::integer);
  end loop;
  update public.product_variants pv set in_stock = (i.on_hand - i.reserved > 0), updated_at = now()
    from public.inventory i where i.variant_id = pv.id and pv.sku in (select x->>'sku' from jsonb_array_elements(p_items) x);
  return jsonb_build_object('order_id',v_order_id,'total_cents',v_total,'items',v_lines);
end;
$$;

create or replace function public.release_store_order(p_order_id uuid, p_status text default 'expired')
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  select status into v_status from public.orders where id=p_order_id for update;
  if not found or v_status <> 'pending' then return; end if;
  update public.inventory i set reserved = greatest(0,i.reserved-oi.quantity), updated_at=now()
    from public.order_items oi where oi.order_id=p_order_id and oi.variant_id=i.variant_id;
  update public.orders set status=case when p_status='expired' then 'expired' else 'expired' end,updated_at=now() where id=p_order_id;
  update public.product_variants pv set in_stock=(i.on_hand-i.reserved>0),updated_at=now()
    from public.inventory i where i.variant_id=pv.id and pv.id in (select variant_id from public.order_items where order_id=p_order_id);
end;
$$;

create or replace function public.complete_store_order(p_order_id uuid, p_paid_total_cents integer default null)
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  select status into v_status from public.orders where id=p_order_id for update;
  if not found or v_status='paid' or v_status='fulfilled' then return; end if;
  if v_status <> 'pending' then raise exception 'Order is no longer pending.'; end if;
  update public.inventory i set on_hand=i.on_hand-oi.quantity,reserved=i.reserved-oi.quantity,updated_at=now()
    from public.order_items oi where oi.order_id=p_order_id and oi.variant_id=i.variant_id;
  update public.orders set status='paid',total_cents=coalesce(p_paid_total_cents,total_cents),updated_at=now() where id=p_order_id;
  update public.product_variants pv set in_stock=(i.on_hand-i.reserved>0),updated_at=now()
    from public.inventory i where i.variant_id=pv.id and pv.id in (select variant_id from public.order_items where order_id=p_order_id);
end;
$$;

revoke all on function public.reserve_store_order(text,jsonb) from public, anon, authenticated;
revoke all on function public.release_store_order(uuid,text) from public, anon, authenticated;
revoke all on function public.complete_store_order(uuid,integer) from public, anon, authenticated;
grant execute on function public.reserve_store_order(text,jsonb) to service_role;
grant execute on function public.release_store_order(uuid,text) to service_role;
grant execute on function public.complete_store_order(uuid,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,8388608,array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public=true,file_size_limit=8388608,allowed_mime_types=array['image/jpeg','image/png','image/webp','image/avif'];

drop policy if exists "public can view product photos" on storage.objects;
create policy "public can view product photos" on storage.objects for select using (bucket_id='product-images');
drop policy if exists "admins upload product photos" on storage.objects;
create policy "admins upload product photos" on storage.objects for insert to authenticated with check (bucket_id='product-images' and public.is_store_admin());
drop policy if exists "admins update product photos" on storage.objects;
create policy "admins update product photos" on storage.objects for update to authenticated using (bucket_id='product-images' and public.is_store_admin()) with check (bucket_id='product-images' and public.is_store_admin());
drop policy if exists "admins delete product photos" on storage.objects;
create policy "admins delete product photos" on storage.objects for delete to authenticated using (bucket_id='product-images' and public.is_store_admin());

-- Promote a staff login after creating it in Supabase Auth:
-- insert into public.admin_users(user_id) select id from auth.users where email='joe@example.com';
