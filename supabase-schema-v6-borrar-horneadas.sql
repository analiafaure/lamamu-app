-- ============================================
-- Schema v6: permite borrar una horneada (arrepentimiento / error de carga)
-- Ejecutar en: Supabase > SQL Editor > New query
-- (aditivo — corré después de v5, no borra ni toca datos existentes)
--
-- v5 dejó `horneadas` como registro fijo (sin trigger de reversión, igual
-- que `reposiciones`) a propósito. Pero a diferencia de una reposición, una
-- horneada es fácil de cargar mal (torta equivocada, cantidad de más) y se
-- suele notar al toque — tiene sentido poder deshacerla. Esto agrega el
-- trigger de reversión (devuelve los insumos descontados y resta las
-- porciones que había sumado) con un freno: si ya se vendieron porciones de
-- esa horneada, no se puede borrar (quedaría el stock en negativo) hasta
-- corregir esas ventas primero.
-- ============================================

create or replace function fn_horneada_revierte_efectos()
returns trigger as $$
declare
  v_insuficiente record;
begin
  -- Si alguna porción hija ya vendió más de lo que esta horneada le dejaría
  -- al revertirse, no se puede borrar sin dejar el stock en negativo.
  select hijo.nombre, hijo.stock_porciones, (hijo.porciones_por_torta * old.cantidad) as a_restar
    into v_insuficiente
    from productos hijo
    where hijo.producto_padre_id = old.producto_id
      and hijo.porciones_por_torta > 0
      and hijo.stock_porciones < (hijo.porciones_por_torta * old.cantidad)
    limit 1;

  if v_insuficiente is not null then
    raise exception 'No se puede borrar: ya se vendieron porciones de "%" (quedan % disponibles, esta horneada había sumado %). Borrá esas ventas primero.',
      v_insuficiente.nombre, v_insuficiente.stock_porciones, v_insuficiente.a_restar;
  end if;

  update insumos i
  set cantidad = i.cantidad + (ri.cantidad_necesaria * old.cantidad)
  from receta_items ri
  where ri.producto_id = old.producto_id
    and ri.insumo_id = i.id;

  update productos hijo
  set stock_porciones = hijo.stock_porciones - (hijo.porciones_por_torta * old.cantidad)
  where hijo.producto_padre_id = old.producto_id
    and hijo.porciones_por_torta > 0;

  return old;
end;
$$ language plpgsql security definer;

create trigger trg_horneada_revierte_efectos
after delete on horneadas
for each row execute function fn_horneada_revierte_efectos();
