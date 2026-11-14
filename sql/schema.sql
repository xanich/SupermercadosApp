-- Esquema para Supabase. Pegar en: Supabase > SQL Editor > New query > Run.
-- Seguridad: solo usuarios con sesion iniciada (vosotros dos) pueden leer y escribir.
-- El proceso diario usa la clave "service_role", que se salta estas reglas: guardarla SOLO
-- como secreto de GitHub, nunca en el codigo de la app.

create table if not exists ingredientes (
  id        text primary key,           -- p.ej. 'arroz-basmati'
  nombre    text not null,
  consulta  text not null,              -- texto con el que se busca en BM y Eroski
  modo      text not null default 'unidad' check (modo in ('unidad','peso'))
                                        -- 'peso': se compra por kilos y el precio es €/kg
);
alter table ingredientes add column if not exists modo text not null default 'unidad'
  check (modo in ('unidad','peso'));
-- 'carne': se compra en la carniceria cercana (tienda "halal") y no en Dia.
alter table ingredientes add column if not exists carne boolean not null default false;

-- El producto concreto que compras de cada ingrediente en cada tienda, con su ultimo precio.
create table if not exists elecciones (
  id             bigint generated always as identity primary key,
  ingrediente_id text not null references ingredientes(id) on delete cascade,
  tienda         text not null check (tienda in ('dia','eroski','bm','carrefour','halal')),
  nombre         text,                  -- nombre del producto en esa tienda
  ext_id         text,                  -- id del producto en la tienda (solo BM/Eroski)
  url            text,
  precio         numeric(8,2),          -- precio del envase (o €/kg si el ingrediente es 'peso')
  precio_unidad  numeric(8,2),          -- precio por kg o litro, si se conoce
  unidad         text check (unidad in ('kg','l')),
  actualizado    timestamptz default now(),
  origen         text not null default 'manual' check (origen in ('auto','manual','excel')),
  unique (ingrediente_id, tienda)
);

-- Bases creadas antes de existir "halal": se amplia la lista de tiendas permitidas.
alter table elecciones drop constraint if exists elecciones_tienda_check;
alter table elecciones add constraint elecciones_tienda_check
  check (tienda in ('dia','eroski','bm','carrefour','halal'));

-- Una fila por cambio de precio automatico, para ver la evolucion.
create table if not exists historial (
  id             bigint generated always as identity primary key,
  ingrediente_id text not null references ingredientes(id) on delete cascade,
  tienda         text not null,
  precio         numeric(8,2),
  precio_unidad  numeric(8,2),
  fecha          timestamptz default now()
);

-- Lista de la compra compartida.
create table if not exists lista (
  ingrediente_id text primary key references ingredientes(id) on delete cascade,
  cantidad       numeric(8,3) not null default 1,   -- unidades, o kilos si el ingrediente es 'peso'
  hecho          boolean not null default false
);

-- Linea de la lista fijada a mano: tienda donde se compra y precio pagado (por unidad o por kg).
alter table lista add column if not exists tienda_compra text;
alter table lista add column if not exists precio_pagado numeric(8,2);

-- Compras terminadas: fecha, total y las lineas (ingrediente, cantidad, tienda, precio, coste).
create table if not exists compras (
  id     uuid primary key default gen_random_uuid(),
  fecha  timestamptz not null default now(),
  total  numeric(9,2) not null,
  lineas jsonb not null default '[]'
);

-- Ajustes compartidos (tiendas activas, ahorro minimo por tienda...).
create table if not exists ajustes (
  clave  text primary key,
  valor  jsonb not null
);

-- Recetas: solo un nombre y sus ingredientes con la cantidad que se compra.
create table if not exists recetas (
  id        text primary key,
  nombre    text not null,
  personas  smallint not null default 2 check (personas in (1, 2))  -- para cuantas personas es la cantidad
);
alter table recetas add column if not exists personas smallint not null default 2;
alter table recetas drop constraint if exists recetas_personas_check;
alter table recetas add constraint recetas_personas_check check (personas in (1, 2));

create table if not exists receta_ingredientes (
  receta_id      text not null references recetas(id) on delete cascade,
  ingrediente_id text not null references ingredientes(id) on delete cascade,
  cantidad       numeric(8,3) not null default 1,   -- unidades, o kilos si el ingrediente es 'peso'
  primary key (receta_id, ingrediente_id)
);

-- Menu semanal. dia 0 = lunes ... 6 = domingo.
-- quien: 'ambos' = una receta para los dos; 'p1' / 'p2' = cada persona la suya (comida "separada").
-- receta_id puede ser nulo: un hueco separado que aun no tiene receta.
create table if not exists menu (
  dia        smallint not null check (dia between 0 and 6),
  comida     text not null check (comida in ('desayuno','comida','cena')),
  quien      text not null default 'ambos' check (quien in ('ambos','p1','p2')),
  receta_id  text references recetas(id) on delete set null,
  primary key (dia, comida, quien)
);
-- Bases creadas antes de existir "quien": se adapta la tabla (los huecos que habia pasan a 'ambos').
alter table menu add column if not exists quien text not null default 'ambos';
alter table menu drop constraint if exists menu_quien_check;
alter table menu add constraint menu_quien_check check (quien in ('ambos','p1','p2'));
alter table menu drop constraint if exists menu_pkey;
alter table menu add primary key (dia, comida, quien);
alter table menu alter column receta_id drop not null;
alter table menu drop constraint if exists menu_receta_id_fkey;
alter table menu add constraint menu_receta_id_fkey foreign key (receta_id) references recetas(id) on delete set null;

alter table ingredientes enable row level security;
alter table elecciones   enable row level security;
alter table historial    enable row level security;
alter table lista        enable row level security;
alter table ajustes      enable row level security;
alter table recetas      enable row level security;
alter table receta_ingredientes enable row level security;
alter table menu         enable row level security;
alter table compras      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ingredientes','elecciones','historial','lista','ajustes','recetas','receta_ingredientes','menu','compras'] loop
    execute format('drop policy if exists "solo_autenticados" on %I', t);
    execute format(
      'create policy "solo_autenticados" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Para ver los cambios en tiempo real en los dos moviles.
-- (Se puede ejecutar el archivo varias veces: solo añade las tablas que falten.)
do $$
declare t text;
begin
  foreach t in array array['lista','elecciones','ingredientes','recetas','receta_ingredientes','menu','compras'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
