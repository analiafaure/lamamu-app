# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

`lamamu-app`: internal management app for a home bakery/tortería business (cake slices sold on weekends, plus whole cakes by custom order), together with a separate public marketing landing page. Two distinct products sharing the same visual identity: the management app is an internal tool (stock, recipes/costs, sales, expenses, monthly summary), the landing page is for marketing and taking orders via WhatsApp.

## Architecture

- **No custom backend.** The frontend (static HTML/JS) talks directly to Supabase via `supabase-js`, the browser client that hits Supabase's auto-generated REST API over Postgres.
- **Why**: for this business's volume (simple CRUD, a single real user), a bespoke backend (Node/Nest/FastAPI) would be needless complexity. If server-side logic is ever needed (integrations, heavy reports, multi-user roles), add Supabase Edge Functions or a separate Node backend later without touching the data model.
- **Hosting**: two independent static sites from this one repo — `app/` (the management app) and `landing/` (the public page) — each deployed as its own Netlify/Vercel project pointed at this same GitHub repo (`analiafaure/lamamu-app`) with a different base/root directory. No build step for either.
- **Auth**: Supabase Auth, magic link (email login, no passwords). Only one real user today (the business owner), but the model already supports multi-user via `user_id` + RLS if that's ever needed.
- **Security**: Row Level Security is enabled on every table — each row belongs to a `user_id`, and policies only allow seeing/touching your own rows (`auth.uid() = user_id`).

## Files

- `app/index.html` — the management app (this is its own deploy root — see Hosting above). Magic-link login + full tab shell. **Resumen**, **Insumos**, **Productos y recetas** (con soporte para porciones derivadas de una torta entera), **Ventas**, **Reposición**, and **Gastos** are all implemented — every internal-tool screen from the original roadmap. Resumen is the default tab on login.
- `landing/index.html` — public marketing landing (this is its own deploy root). Has real business data now (WhatsApp number, products/prices, logo, photos in `landing/img/`, Instagram/Facebook). Has a cart flow for **porciones** only (quantity steppers, floating cart button/modal, envío/transferencia handling, one consolidated WhatsApp message) — **tortas enteras** intentionally stay on the simpler "Consultar por WhatsApp" flow (price varies by size, no cart). Also loads `supabase-js` (same Supabase project as the app) for a simple visit counter in the footer — this is its *only* other Supabase dependency; there's no login, no other data read/written.
- `gestion-torteria-supabase.html` (repo root) — an **earlier prototype**, built against the OLD schema (flat `stock`/`ventas`/`gastos` tables, no `productos`/`receta_items` model, no automatic stock deduction). Not deployed anywhere, kept only for reference — don't use it as a source for queries (schema is stale), only possibly for UI/markup patterns.
- `supabase-schema-v2-recetas.sql` (repo root) — the full schema (tables, triggers, view, RLS), checked into the repo and already run in production. Authoritative source for exact column/relation names.
- `supabase-schema-v3-porciones.sql` (repo root) — additive migration on top of v2: adds `productos.producto_padre_id`/`porciones_por_torta` and replaces `vw_producto_costos` to support porciones derived from a torta entera (see Data model below). **Needs to be run manually in the Supabase SQL editor** — not auto-applied.
- `supabase-schema-v4-visitas.sql` (repo root) — additive migration: `visitas_landing` table (one row per landing page load, no personal data) with RLS allowing public insert + public read of the count, backing the landing's visit counter. **Needs to be run manually in the Supabase SQL editor.**

## Data model (already applied in Supabase)

- `insumos`: id, user_id, nombre, unidad (kg/g/l/ml/unidades), cantidad (stock actual), costo_unitario, stock_minimo.
- `productos`: id, user_id, nombre (ej. "Porción red velvet"), tipo ('Porción' | 'Torta entera'), precio_venta, `producto_padre_id` (self-FK a productos, nullable, on delete set null), `porciones_por_torta` (numeric, nullable). Los últimos dos son para una "Porción" que deriva su costo de una "Torta entera" ya cargada — ver más abajo.
- `receta_items`: bridge productos↔insumos. id, user_id, producto_id, insumo_id, cantidad_necesaria (cuánto de ese insumo lleva 1 unidad del producto). Unique (producto_id, insumo_id).
- `ventas`: id, user_id, producto_id, fecha, cantidad, precio_unitario (snapshot al momento de la venta — puede diferir del precio_venta actual del producto).
- `gastos`: id, user_id, fecha, descripcion, categoria, monto.
- `reposiciones`: registro de compra de insumos. id, user_id, insumo_id, fecha, cantidad, costo_unitario, monto_total (columna generada = cantidad × costo_unitario), gasto_id (se completa solo, vía trigger).
- `config`: user_id (PK), nombre_negocio.
- View `vw_producto_costos`: por producto, `costo_receta` y `margen` (precio_venta − costo_receta), más `producto_padre_id`/`porciones_por_torta`/`producto_padre_nombre`. Si el producto tiene `producto_padre_id` + `porciones_por_torta` > 0, `costo_receta` sale de la receta de la torta madre (su propia receta, no la de la porción) dividida por `porciones_por_torta` — si no, es la suma normal de `cantidad_necesaria × costo_unitario` de su propia receta (igual que antes). Se consulta directo, sin recalcular en el frontend.

### Porciones derivadas de una torta entera

Una "Porción" puede enlazarse a una "Torta entera" ya cargada (con receta propia) en vez de tener su propia receta: el costo/margen de la porción se deriva automáticamente de la receta de la torta madre ÷ cantidad de porciones (ver la vista arriba). Esto es a propósito — decisión del negocio, no un detalle técnico:

- Vender una porción **no descuenta stock de insumos**: la porción enlazada no tiene `receta_items` propios, así que el trigger de venta no encuentra nada que descontar (no es un error, simplemente no hace nada). El stock de esos insumos ya se descuenta cuando se registra/hornea la torta entera correspondiente (esa sí tiene su receta propia, y su venta sí descuenta stock normalmente).
- El enlace (`producto_padre_id`/`porciones_por_torta`) solo se puede definir al **crear** el producto desde el formulario — no hay edición posterior en la UI. Para cambiarlo hay que borrar y volver a cargar el producto.
- Si se borra la torta madre, `producto_padre_id` de sus porciones vuelve a `null` (on delete set null) y esas porciones pasan a calcular su costo desde su propia receta (vacía → costo 0, margen = precio_venta completo) — no rompe nada, pero el margen mostrado cambia de golpe.

## Triggers (la lógica de negocio vive en la base, no en el frontend)

- `trg_venta_descuenta_stock` (AFTER INSERT ON ventas): descuenta `insumos.cantidad` según la receta del producto vendido × cantidad vendida.
- `trg_venta_restaura_stock` (AFTER DELETE ON ventas): devuelve el stock descontado si se borra una venta.
- `trg_reposicion_actualiza_stock_y_gasto` (AFTER INSERT ON reposiciones): suma `insumos.cantidad`, actualiza `insumos.costo_unitario` al precio de esta compra (último precio, no promedio ponderado — simplificación deliberada, ver roadmap), y crea automáticamente una fila en `gastos` (categoría "Insumos") vinculada vía `gasto_id`.
- Como el cálculo de stock vive en triggers, las pantallas de Ventas/Reposiciones solo necesitan hacer INSERT y volver a pedir los datos — nada de aritmética de stock en el cliente.

## Identidad visual (mantener consistencia entre app y landing)

- Paleta: `--plum:#5E2439` (principal), `--plum-dark:#421A29`, `--butter:#F2B93B` (acento/CTA), `--cream:#FBF7F0` (fondo), `--ink:#2B2420` (texto).
- Tipografía: Fraunces (serif, títulos) + Work Sans (sans, resto) — ambas vía Google Fonts.
- Mismo criterio visual en los dos productos aunque cumplen funciones distintas (marketing vs. herramienta interna).

## Known resolved issues (don't reintroduce)

- El nombre de variable `supabase` colisiona con el global que inyecta el script del CDN — el cliente se tiene que llamar distinto (`supabaseClient`), no `supabase`.
- La URL de Supabase es la base del proyecto, **sin** `/rest/v1` al final.
- El redirect del magic link necesita Site URL / Redirect URL configuradas en Supabase Auth apuntando a donde se sirve la app de verdad — abrir el HTML con doble-click (`file://`) no funciona, hace falta servirlo desde un server local (o el dominio de producción).

## Roadmap (orden sugerido)

1. ✅ **Productos y recetas**: CRUD de productos (nombre, tipo, precio_venta) + UI para armar la receta de cada producto (agregar/quitar insumos con cantidad_necesaria vía receta_items). Costo_receta/margen se muestran leyendo vw_producto_costos, se refrescan después de cada cambio en la receta.
2. ✅ **Ventas**: registrar venta eligiendo producto (dropdown, precio se autocompleta con productos.precio_venta y es editable) + cantidad + fecha (default hoy). El trigger de la base descuenta stock — la UI inserta y refresca ventas + insumos.
3. ✅ **Gastos**: CRUD de gastos manuales. Los gastos generados por una reposición se marcan con un tag "reposición" y no se pueden borrar desde acá (la FK `reposiciones.gasto_id` rechaza el delete).
4. ✅ **Reposición de stock**: formulario (insumo, cantidad, costo unitario, fecha) que inserta en `reposiciones` y confía en el trigger para actualizar stock/costo y generar el gasto. Sin botón de borrar — no hay trigger que revierta stock/costo, así que el historial queda fijo.
5. ✅ **Resumen/dashboard**: ventas del mes, gastos del mes, ganancia neta (stat cards, color según signo), alertas de stock bajo, ranking de productos por margen, últimas ventas. Es la pestaña por defecto al loguearse. No pega queries propias — se calcula en el cliente a partir de lo que ya cargan las otras pestañas (ventas/gastos/insumos/productosResumen), y se recalcula cada vez que cualquiera de esos cuatro termina de cargar.
6. ✅ (estructura) **Landing page**: creada (`landing/index.html`) — hero, grillas de Porciones/Tortas enteras, "¿Cómo pedís?", botón flotante de WhatsApp. Cada tarjeta de producto arma un link `wa.me` con el mensaje precargado. **Falta**: reemplazar el número de WhatsApp, los productos/precios/descripciones y las fotos de ejemplo por los datos reales (todo editable en el bloque `<script>` de configuración al principio del archivo).
7. ✅ (repo listo) **Deploy**: repo reorganizado en `app/` y `landing/` para poder crear dos sitios independientes en Netlify/Vercel apuntando al mismo repo de GitHub (`analiafaure/lamamu-app`), cada uno con su propio "base/root directory". La creación de los sitios en sí se hace a mano desde el dashboard de Netlify/Vercel (no se puede automatizar desde acá). **Pendiente**: crear los dos sitios (ver instrucciones que se le pasaron a la dueña del negocio) y, una vez que estén online, apuntar Site URL / Redirect URLs de Supabase Auth (Authentication → URL Configuration) al dominio de producción de `app` — si no, el magic link de login redirige a localhost y no funciona en producción.
8. (Opcional, más adelante) Promedio ponderado de costo en vez de "último precio de compra", si el negocio lo llega a necesitar.
