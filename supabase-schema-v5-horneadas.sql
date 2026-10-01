-- ============================================
-- Schema v5: horneadas (producción de tortas enteras) + stock de porciones
-- Ejecutar en: Supabase > SQL Editor > New query
-- (aditivo — corré después de v2/v3/v4, no borra ni toca datos existentes)
--
-- Resuelve un agujero real del modelo de porciones (v3): vender una
-- "Porción" derivada de una torta (producto_padre_id) no descuenta insumos
-- a propósito, porque se asume que el descuento ya pasó "al hacer la torta
-- entera" — pero la torta entera nunca se registraba como venta si se
-- cortaba en porciones, así que sus insumos no se descontaban en ningún
-- lado, y no había ningún tope que avisara si se vendían más porciones de
-- las que en verdad salieron de esa torta.
--
-- Ahora "hornear" una torta es un evento de PRODUCCIÓN (no de venta, tabla
-- nueva `horneadas`) que descuenta los insumos de su receta (igual que una
-- venta lo haría) y suma automáticamente porciones_por_torta × cantidad al
-- stock de cada producto 'Porción' que tenga a esa torta como padre. Vender
-- una porción descuenta de ese stock (y lo devuelve si se borra la venta) y
-- ahora rechaza la venta si no quedan suficientes porciones disponibles.
-- ============================================

alter table productos
  add column if not exists stock_porciones numeric not null default 0;

create table if not exists horneadas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete cascade, -- la torta entera horneada
  fecha date not null,
  cantidad numeric not null check (cantidad > 0), -- cuántas tortas enteras de esta receta se hicieron
  created_at timestamptz default now()
);

-- Al registrar una horneada: descuenta los insumos de la receta de la torta
-- (mismo criterio que una venta) y suma las porciones generadas al stock de
-- cada producto 'Porción' que tenga a esta torta como padre.
create or replace function fn_horneada_efectos()
returns trigger as $$
begin
  update insumos i
  set cantidad = i.cantidad - (ri.cantidad_necesaria * new.cantidad)
  from receta_items ri
  where ri.producto_id = new.producto_id
    and ri.insumo_id = i.id;

  update productos hijo
  set stock_porciones = hijo.stock_porciones + (hijo.porciones_por_torta * new.cantidad)
  where hijo.producto_padre_id = new.producto_id
    and hijo.porciones_por_torta > 0;

  return new;
end;
$$ language plpgsql security definer;

create trigger trg_horneada_efectos
after insert on horneadas
for each row execute function fn_horneada_efectos();

-- Al vender una porción derivada (producto_padre_id no nulo): descuenta del
-- stock de porciones disponibles y rechaza la venta si no alcanza.
create or replace function fn_venta_descuenta_stock_porciones()
returns trigger as $$
declare
  v_padre_id uuid;
  v_stock_actual numeric;
  v_nombre text;
begin
  select producto_padre_id, stock_porciones, nombre
    into v_padre_id, v_stock_actual, v_nombre
    from productos where id = new.producto_id;

  if v_padre_id is not null then
    if v_stock_actual < new.cantidad then
      raise exception 'No quedan suficientes porciones de "%" (disponibles: %, intentás vender: %). Registrá una horneada de la torta madre primero.', v_nombre, v_stock_actual, new.cantidad;
    end if;
    update productos set stock_porciones = stock_porciones - new.cantidad where id = new.producto_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_venta_descuenta_stock_porciones
after insert on ventas
for each row execute function fn_venta_descuenta_stock_porciones();

-- Al borrar una venta de porción derivada: devuelve el stock.
create or replace function fn_venta_restaura_stock_porciones()
returns trigger as $$
begin
  update productos
  set stock_porciones = stock_porciones + old.cantidad
  where id = old.producto_id and producto_padre_id is not null;
  return old;
end;
$$ language plpgsql security definer;

create trigger trg_venta_restaura_stock_porciones
after delete on ventas
for each row execute function fn_venta_restaura_stock_porciones();

-- La vista suma la columna nueva al final (mismo criterio que v3: Postgres
-- no deja reordenar/insertar columnas en el medio de una vista existente con
-- CREATE OR REPLACE VIEW, solo agregar al final).
create or replace view vw_producto_costos as
with costos_propios as (
  select
    p.id as producto_id,
    coalesce(sum(ri.cantidad_necesaria * i.costo_unitario), 0) as costo_receta_propio
  from productos p
  left join receta_items ri on ri.producto_id = p.id
  left join insumos i on i.id = ri.insumo_id
  group by p.id
)
select
  p.id as producto_id,
  p.nombre,
  p.tipo,
  p.precio_venta,
  case
    when p.producto_padre_id is not null and p.porciones_por_torta > 0
      then cp_padre.costo_receta_propio / p.porciones_por_torta
    else cp.costo_receta_propio
  end as costo_receta,
  p.precio_venta - case
    when p.producto_padre_id is not null and p.porciones_por_torta > 0
      then cp_padre.costo_receta_propio / p.porciones_por_torta
    else cp.costo_receta_propio
  end as margen,
  p.user_id,
  p.producto_padre_id,
  p.porciones_por_torta,
  padre.nombre as producto_padre_nombre,
  p.stock_porciones
from productos p
join costos_propios cp on cp.producto_id = p.id
left join productos padre on padre.id = p.producto_padre_id
left join costos_propios cp_padre on cp_padre.producto_id = p.producto_padre_id;

alter view vw_producto_costos set (security_invoker = true);

alter table horneadas enable row level security;
create policy "horneadas: solo el dueño" on horneadas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
