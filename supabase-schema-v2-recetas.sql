-- ============================================
-- Schema v2: stock + recetas + costos + márgenes
-- Ejecutar en: Supabase > SQL Editor > New query
-- Si ya corriste el schema anterior, borrá esas tablas antes
-- (drop table if exists ventas, stock, gastos, config cascade;)
-- ============================================

create extension if not exists "pgcrypto";

-- ============================================
-- TABLAS BASE
-- ============================================

create table insumos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null,
  unidad text not null,               -- kg, g, l, ml, unidades
  cantidad numeric not null default 0,     -- stock actual
  costo_unitario numeric not null default 0, -- costo por unidad de medida
  stock_minimo numeric not null default 0,
  created_at timestamptz default now()
);

create table productos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre text not null,               -- ej: "Porción red velvet", "Torta chocolate 20p"
  tipo text not null,                 -- 'Porción' | 'Torta entera'
  precio_venta numeric not null,
  created_at timestamptz default now()
);

create table receta_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade,
  insumo_id uuid not null references insumos(id) on delete restrict,
  cantidad_necesaria numeric not null,  -- cantidad de insumo por 1 unidad de producto
  created_at timestamptz default now(),
  unique (producto_id, insumo_id)
);

create table ventas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete restrict,
  fecha date not null,
  cantidad numeric not null,
  precio_unitario numeric not null,     -- snapshot del precio al momento de vender
  created_at timestamptz default now()
);

create table gastos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fecha date not null,
  descripcion text not null,
  categoria text not null,
  monto numeric not null,
  created_at timestamptz default now()
);

create table reposiciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  insumo_id uuid not null references insumos(id) on delete restrict,
  fecha date not null,
  cantidad numeric not null,            -- cuánto se compró
  costo_unitario numeric not null,      -- precio de esta compra
  monto_total numeric generated always as (cantidad * costo_unitario) stored,
  gasto_id uuid references gastos(id),
  created_at timestamptz default now()
);

create table config (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  nombre_negocio text default 'Mi Tortería'
);

-- ============================================
-- FUNCIONES + TRIGGERS
-- ============================================

-- Al vender: descuenta insumos según la receta del producto vendido
create or replace function fn_venta_descuenta_stock()
returns trigger as $$
begin
  update insumos i
  set cantidad = i.cantidad - (ri.cantidad_necesaria * new.cantidad)
  from receta_items ri
  where ri.producto_id = new.producto_id
    and ri.insumo_id = i.id;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_venta_descuenta_stock
after insert on ventas
for each row execute function fn_venta_descuenta_stock();

-- Al borrar una venta: devuelve el stock descontado
create or replace function fn_venta_restaura_stock()
returns trigger as $$
begin
  update insumos i
  set cantidad = i.cantidad + (ri.cantidad_necesaria * old.cantidad)
  from receta_items ri
  where ri.producto_id = old.producto_id
    and ri.insumo_id = i.id;
  return old;
end;
$$ language plpgsql security definer;

create trigger trg_venta_restaura_stock
after delete on ventas
for each row execute function fn_venta_restaura_stock();

-- Al reponer stock: suma cantidad, actualiza costo_unitario, y crea el gasto
create or replace function fn_reposicion_actualiza_stock_y_gasto()
returns trigger as $$
declare
  v_nombre_insumo text;
  v_gasto_id uuid;
begin
  select nombre into v_nombre_insumo from insumos where id = new.insumo_id;

  update insumos
  set cantidad = cantidad + new.cantidad,
      costo_unitario = new.costo_unitario
  where id = new.insumo_id;

  insert into gastos (user_id, fecha, descripcion, categoria, monto)
  values (new.user_id, new.fecha, 'Reposición de ' || v_nombre_insumo, 'Insumos', new.monto_total)
  returning id into v_gasto_id;

  update reposiciones set gasto_id = v_gasto_id where id = new.id;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_reposicion_actualiza_stock_y_gasto
after insert on reposiciones
for each row execute function fn_reposicion_actualiza_stock_y_gasto();

-- ============================================
-- VISTA: costo de receta y margen por producto
-- ============================================
create or replace view vw_producto_costos as
select
  p.id as producto_id,
  p.nombre,
  p.tipo,
  p.precio_venta,
  coalesce(sum(ri.cantidad_necesaria * i.costo_unitario), 0) as costo_receta,
  p.precio_venta - coalesce(sum(ri.cantidad_necesaria * i.costo_unitario), 0) as margen,
  p.user_id
from productos p
left join receta_items ri on ri.producto_id = p.id
left join insumos i on i.id = ri.insumo_id
group by p.id, p.nombre, p.tipo, p.precio_venta, p.user_id;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table insumos       enable row level security;
alter table productos     enable row level security;
alter table receta_items  enable row level security;
alter table ventas        enable row level security;
alter table gastos        enable row level security;
alter table reposiciones  enable row level security;
alter table config        enable row level security;

create policy "insumos: solo el dueño" on insumos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "productos: solo el dueño" on productos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "receta_items: solo el dueño" on receta_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ventas: solo el dueño" on ventas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "gastos: solo el dueño" on gastos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reposiciones: solo el dueño" on reposiciones
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "config: solo el dueño" on config
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter view vw_producto_costos set (security_invoker = true);
