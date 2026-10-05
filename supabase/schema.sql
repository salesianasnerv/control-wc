-- Control de baños · estructura de la base de datos (Supabase / PostgreSQL)
-- Ejecutar una vez en Supabase → SQL Editor. Después, ejecutar seed.sql.

create table if not exists clases (
  id     serial primary key,
  nombre text not null unique,
  tutor  text,
  orden  int not null default 0
);

create table if not exists alumnos (
  id       serial primary key,
  clase_id int not null references clases(id) on delete cascade,
  nombre   text not null,            -- "Apellidos, Nombre"
  orden    int not null default 0,
  activo   boolean not null default true
);

create table if not exists salidas (
  id              bigserial primary key,
  alumno_id       int not null references alumnos(id) on delete cascade,
  clase_id        int not null references clases(id) on delete cascade,
  salida          timestamptz not null default now(),
  vuelta          timestamptz,
  urgencia        boolean not null default false,  -- registrada en franja no permitida
  profesor_email  text not null default (auth.jwt() ->> 'email'),
  profesor_nombre text
);

create index if not exists salidas_salida_idx on salidas (salida desc);
create index if not exists salidas_abiertas_idx on salidas (salida) where vuelta is null;

-- ── Seguridad: solo profesorado con cuenta @salesianas.org ──────────────────
create or replace function es_profesorado() returns boolean
language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@salesianas.org', false)
$$;

alter table clases  enable row level security;
alter table alumnos enable row level security;
alter table salidas enable row level security;

drop policy if exists "leer clases"  on clases;
drop policy if exists "leer alumnos" on alumnos;
drop policy if exists "leer salidas" on salidas;
drop policy if exists "crear salida" on salidas;
drop policy if exists "marcar vuelta" on salidas;
drop policy if exists "borrar propia" on salidas;

create policy "leer clases"  on clases  for select to authenticated using (es_profesorado());
create policy "leer alumnos" on alumnos for select to authenticated using (es_profesorado());
create policy "leer salidas" on salidas for select to authenticated using (es_profesorado());

-- Cada registro queda firmado con el correo de quien lo crea (no se puede falsear)
create policy "crear salida" on salidas for insert to authenticated
  with check (es_profesorado() and profesor_email = auth.jwt() ->> 'email');

-- Cualquier profesor/a puede marcar la vuelta (el alumno puede volver con otro profesor)
create policy "marcar vuelta" on salidas for update to authenticated
  using (es_profesorado()) with check (es_profesorado());

-- Solo quien lo creó puede borrar un registro (para corregir errores)
create policy "borrar propia" on salidas for delete to authenticated
  using (es_profesorado() and profesor_email = auth.jwt() ->> 'email');

-- Impide modificar por UPDATE algo distinto de la hora de vuelta
create or replace function solo_vuelta() returns trigger language plpgsql as $$
begin
  new.alumno_id := old.alumno_id;  new.clase_id := old.clase_id;
  new.salida := old.salida;        new.urgencia := old.urgencia;
  new.profesor_email := old.profesor_email; new.profesor_nombre := old.profesor_nombre;
  return new;
end $$;
drop trigger if exists salidas_solo_vuelta on salidas;
create trigger salidas_solo_vuelta before update on salidas
  for each row execute function solo_vuelta();
