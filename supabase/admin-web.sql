-- ⚠ YA EJECUTADO (comprobado en Supabase el 19-10-2026). NO VOLVER A EJECUTAR.
--   Desde el 18-10-2026 «administradores» y «clases» son vistas de la base de datos común
--   (permisos y grupos) y este archivo daría error. Las reglas y las cuentas ya están allí.
--   Se guarda solo como historial.

-- Control de baños · gestionar desde la web las cuentas de administración y las clases
-- Ejecutar una vez en Supabase → SQL Editor (después de cursos.sql).
-- A partir de aquí, todo se hace en la pestaña «Administración» de la web.

-- Administración puede ver la lista completa, añadir cuentas del colegio y quitar a otras (no a sí misma)
drop policy if exists "ver propio" on administradores;
drop policy if exists "ver administradores" on administradores;
drop policy if exists "nuevo administrador" on administradores;
drop policy if exists "quitar administrador" on administradores;
create policy "ver administradores" on administradores for select to authenticated
  using (es_admin() or lower(email) = lower(auth.jwt() ->> 'email'));
create policy "nuevo administrador" on administradores for insert to authenticated
  with check (es_admin() and lower(email) like '%@salesianas.org');
create policy "quitar administrador" on administradores for delete to authenticated
  using (es_admin() and lower(email) <> lower(auth.jwt() ->> 'email'));

-- Administración puede cambiar el nombre y el tutor/a de las clases
drop policy if exists "editar clase" on clases;
create policy "editar clase" on clases for update to authenticated
  using (es_admin()) with check (es_admin());

insert into administradores (email) values
  ('laura.ramos@salesianas.org'),
  ('miguelangel.arcos@salesianas.org'),
  ('rocio.cano@salesianas.org'),
  ('anam.gallardo@salesianas.org'),
  ('ana.felipe@salesianas.org')
on conflict do nothing;

select email from administradores order by email;
