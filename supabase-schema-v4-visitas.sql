-- ============================================
-- Schema v4: contador de visitas de la landing
-- Ejecutar en: Supabase > SQL Editor > New query
-- (aditivo — no borra ni toca datos existentes)
-- ============================================

-- Una fila por visita a la landing (no requiere login: la landing es pública
-- y no tiene ningún otro vínculo con Supabase). Solo guarda cuándo pasó, sin
-- ningún dato personal ni de identificación del visitante.
create table if not exists visitas_landing (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);

alter table visitas_landing enable row level security;

-- Cualquiera puede registrar una visita (insertar una fila)...
create policy "insertar visita" on visitas_landing
  for insert
  with check (true);

-- ...y cualquiera puede leer el conteo total, para poder mostrarlo en la
-- misma landing sin necesitar login ni una API aparte.
create policy "leer conteo de visitas" on visitas_landing
  for select
  using (true);
