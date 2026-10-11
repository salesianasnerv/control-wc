-- Control de baños · cursos escolares y administración
-- Ejecutar una vez en Supabase → SQL Editor (después de schema.sql y seed.sql).
-- Convierte los datos actuales en el curso 2026-2027 y permite crear cursos nuevos desde la web.

-- ── Cursos ──────────────────────────────────────────────────────────────────
create table if not exists cursos (
  id     serial primary key,
  nombre text not null unique,            -- "2026-2027"
  activo boolean not null default false,  -- solo uno a la vez: el que se usa en Registrar
  creado timestamptz not null default now()
);
create unique index if not exists cursos_un_activo on cursos (activo) where activo;

insert into cursos (nombre, activo) values ('2026-2027', true) on conflict (nombre) do nothing;

alter table clases add column if not exists curso_id int references cursos(id) on delete cascade;
update clases set curso_id = (select id from cursos where nombre = '2026-2027') where curso_id is null;
alter table clases alter column curso_id set not null;

-- El nombre de una clase ya no es único en general, sino dentro de cada curso
alter table clases drop constraint if exists clases_nombre_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clases_curso_nombre_key') then
    alter table clases add constraint clases_curso_nombre_key unique (curso_id, nombre);
  end if;
end $$;

-- ── Administración ──────────────────────────────────────────────────────────
-- Para añadir otra cuenta más adelante:
--   insert into administradores (email) values ('nombre.apellido@salesianas.org');
create table if not exists administradores (
  email  text primary key,
  creado timestamptz not null default now()
);
insert into administradores (email) values ('mangeles.chavez@salesianas.org') on conflict do nothing;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores where lower(email) = lower(auth.jwt() ->> 'email'))
$$;

-- ── Seguridad ───────────────────────────────────────────────────────────────
alter table cursos enable row level security;
alter table administradores enable row level security;

drop policy if exists "leer cursos" on cursos;
create policy "leer cursos" on cursos for select to authenticated using (es_profesorado());

-- Cada persona solo puede ver si ella misma es administradora
drop policy if exists "ver propio" on administradores;
create policy "ver propio" on administradores for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

-- Altas, bajas y cambios de clase: solo administración
drop policy if exists "alta alumno" on alumnos;
drop policy if exists "editar alumno" on alumnos;
create policy "alta alumno" on alumnos for insert to authenticated with check (es_admin());
create policy "editar alumno" on alumnos for update to authenticated using (es_admin()) with check (es_admin());

-- ── Crear un curso nuevo (todo o nada) ─────────────────────────────────────
-- p_clases: [{"nombre": "1º ESO A", "tutor": "...", "alumnos": ["Apellidos, Nombre", ...]}, ...]
create or replace function crear_curso(p_nombre text, p_clases jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_curso int; v_clase int; c jsonb; i int;
begin
  if not es_admin() then raise exception 'Solo administración puede crear cursos'; end if;
  if exists (select 1 from cursos where nombre = p_nombre) then raise exception 'Ya existe el curso %', p_nombre; end if;

  update cursos set activo = false where activo;
  insert into cursos (nombre, activo) values (p_nombre, true) returning id into v_curso;

  for c, i in select value, ordinality from jsonb_array_elements(p_clases) with ordinality loop
    insert into clases (curso_id, nombre, tutor, orden)
      values (v_curso, c ->> 'nombre', c ->> 'tutor', i) returning id into v_clase;
    insert into alumnos (clase_id, nombre, orden)
      select v_clase, a.value, a.ordinality from jsonb_array_elements_text(c -> 'alumnos') with ordinality a;
  end loop;
  return v_curso;
end $$;

-- Volver a poner como actual un curso (por si se crea uno por error)
create or replace function activar_curso(p_id int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo administración'; end if;
  update cursos set activo = false where activo and id <> p_id;
  update cursos set activo = true where id = p_id;
end $$;

revoke execute on function crear_curso(text, jsonb) from public, anon;
revoke execute on function activar_curso(int) from public, anon;
grant execute on function crear_curso(text, jsonb) to authenticated;
grant execute on function activar_curso(int) to authenticated;
