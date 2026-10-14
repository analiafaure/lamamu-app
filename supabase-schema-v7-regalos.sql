-- ============================================
-- Schema v7: ventas marcadas como "regalo" registran su costo como gasto
-- Ejecutar en: Supabase > SQL Editor > New query
-- (aditivo — corré después de v6, no borra ni toca datos existentes)
--
-- Problema real: cuando una torta/porción no se vende sino que se regala,
-- eso no quedaba reflejado en ningún lado como pérdida — los números de
-- ganancia quedaban inflados porque ese costo "desaparecía" sin afectar el
-- resumen financiero.
--
-- Ahora una venta se puede marcar `es_regalo = true` (precio_unitario queda
-- en 0 — hay un check que lo obliga): sigue descontando el stock de
-- porciones/insumos igual que cualquier venta (mismos triggers de siempre),
-- pero además genera automáticamente un gasto por el costo de receta de lo
-- regalado (categoría 'Regalos/mermas'), vinculado a la venta para que no
-- se pueda borrar el gasto suelto sin borrar la venta que lo generó.
-- ============================================

alter table ventas
  add column if not exists es_regalo boolean not null default false,
  add column if not exists gasto_id uuid references gastos(id);

alter table ventas
  drop constraint if exists ventas_regalo_sin_precio;
alter table ventas
  add constraint ventas_regalo_sin_precio check (not es_regalo or precio_unitario = 0);

-- Costo de receta de un producto (igual criterio que vw_producto_costos: si
-- es una porción derivada de una torta madre, la receta de la torta madre
-- ÷ porciones_por_torta; si no, la suma de su propia receta). Se extrae a
-- función aparte para no duplicar esta lógica a mano en el trigger de abajo
-- y para poder reusarla en el futuro sin tocar la vista existente.
create or replace function fn_costo_receta_producto(p_producto_id uuid)
returns numeric as $$
declare
  v_costo numeric;
  v_padre_id uuid;
  v_porciones numeric;
begin
  select producto_padre_id, porciones_por_torta into v_padre_id, v_porciones
  from productos where id = p_producto_id;

  if v_padre_id is not null and v_porciones > 0 then
    select coalesce(sum(ri.cantidad_necesaria * i.costo_unitario), 0) into v_costo
    from receta_items ri join insumos i on i.id = ri.insumo_id
    where ri.producto_id = v_padre_id;
    return v_costo / v_porciones;
  else
    select coalesce(sum(ri.cantidad_necesaria * i.costo_unitario), 0) into v_costo
    from receta_items ri join insumos i on i.id = ri.insumo_id
    where ri.producto_id = p_producto_id;
    return v_costo;
  end if;
end;
$$ language plpgsql stable;

-- Al registrar una venta marcada como regalo: crea el gasto por el costo de
-- receta × cantidad, y guarda el id en ventas.gasto_id (para poder borrarlo
-- si se borra la venta, y para que no se pueda borrar suelto desde Gastos).
create or replace function fn_venta_registra_regalo_como_gasto()
returns trigger as $$
declare
  v_nombre_producto text;
  v_monto numeric;
  v_gasto_id uuid;
begin
  if new.es_regalo then
    select nombre into v_nombre_producto from productos where id = new.producto_id;
    v_monto := fn_costo_receta_producto(new.producto_id) * new.cantidad;

    if v_monto > 0 then
      insert into gastos (user_id, fecha, descripcion, categoria, monto)
      values (new.user_id, new.fecha, 'Regalo: ' || coalesce(v_nombre_producto, '—'), 'Regalos/mermas', v_monto)
      returning id into v_gasto_id;

      update ventas set gasto_id = v_gasto_id where id = new.id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_venta_registra_regalo_como_gasto
after insert on ventas
for each row execute function fn_venta_registra_regalo_como_gasto();

-- Al borrar una venta-regalo: borra también el gasto que había generado
-- (si no, quedaría un gasto fantasma sin la venta que lo originó).
create or replace function fn_venta_borra_gasto_regalo()
returns trigger as $$
begin
  if old.gasto_id is not null then
    delete from gastos where id = old.gasto_id;
  end if;
  return old;
end;
$$ language plpgsql security definer;

create trigger trg_venta_borra_gasto_regalo
after delete on ventas
for each row execute function fn_venta_borra_gasto_regalo();
