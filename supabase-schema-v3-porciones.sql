-- ============================================
-- Schema v3: porciones derivadas de una torta entera
-- Ejecutar en: Supabase > SQL Editor > New query
-- (aditivo — no borra ni toca datos existentes, corré después de
-- supabase-schema-v2-recetas.sql)
--
-- NOTA: este archivo se corrigió después de un primer intento fallido
-- (Postgres no deja reordenar/insertar columnas en el medio de una vista con
-- CREATE OR REPLACE VIEW, solo agregar al final). Los "if not exists" hacen
-- que se pueda volver a correr entero sin problema aunque el ALTER TABLE ya
-- se haya aplicado antes.
-- ============================================

-- Un producto tipo 'Porción' puede enlazarse a una 'Torta entera' existente:
-- en vez de cargarle su propia receta, el costo se deriva de la receta de la
-- torta madre dividida por la cantidad de porciones. Vender una porción NO
-- descuenta stock de nuevo (la porción no tiene receta_items propios) — el
-- stock de los insumos ya se descontó cuando se registró/horneó la torta
-- entera correspondiente.
alter table productos
  add column if not exists producto_padre_id uuid references productos(id) on delete set null,
  add column if not exists porciones_por_torta numeric;

-- ============================================
-- VISTA: se reemplaza para resolver el costo heredado cuando el producto
-- tiene producto_padre_id + porciones_por_torta. Si no tiene padre (o el
-- padre no tiene porciones cargadas), se comporta exactamente igual que
-- antes (costo de su propia receta).
--
-- Las columnas originales (producto_id, nombre, tipo, precio_venta,
-- costo_receta, margen, user_id) se mantienen en el mismo orden/nombre que
-- la vista v2 — Postgres exige eso para poder reemplazar una vista existente
-- con CREATE OR REPLACE. Las columnas nuevas van agregadas al final.
-- ============================================
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
  padre.nombre as producto_padre_nombre
from productos p
join costos_propios cp on cp.producto_id = p.id
left join productos padre on padre.id = p.producto_padre_id
left join costos_propios cp_padre on cp_padre.producto_id = p.producto_padre_id;

alter view vw_producto_costos set (security_invoker = true);
