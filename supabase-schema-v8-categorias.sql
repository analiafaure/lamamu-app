-- ============================================
-- Schema v8: productos agrupados por categoría
-- Ejecutar en: Supabase > SQL Editor > New query
-- (aditivo — corré después de v7, no borra ni toca datos existentes)
--
-- Problema real: la lista de Productos era plana — con varios tamaños de la
-- misma torta (ej. "Matilda" en distintos cm) o varios sabores, se volvía
-- difícil de leer. Ahora cada producto tiene una `categoria` de texto libre
-- (ej. "Matilda", "Vainilla", "Chocolate", "Red velvet") y la pantalla de
-- Productos agrupa la tabla por esa categoría en vez de mostrar todo junto.
-- ============================================

alter table productos
  add column if not exists categoria text;

-- La vista suma la columna nueva al final (mismo criterio que v3/v5:
-- Postgres no deja reordenar/insertar columnas en el medio de una vista
-- existente con CREATE OR REPLACE VIEW, solo agregar al final).
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
  p.stock_porciones,
  p.categoria
from productos p
join costos_propios cp on cp.producto_id = p.id
left join productos padre on padre.id = p.producto_padre_id
left join costos_propios cp_padre on cp_padre.producto_id = p.producto_padre_id;

alter view vw_producto_costos set (security_invoker = true);
