-- ============================================================================
-- FT Giardini · Lavori — struttura del database Supabase
-- Come si usa: Supabase → SQL Editor → New query → incolla tutto questo file → Run.
-- Si può rieseguire senza perdere dati (aggiorna solo regole e funzioni).
-- ============================================================================

-- ---------- Squadra iniziale ----------
-- Quando crei un accesso (Authentication → Users → Add user) con una di queste email,
-- la persona riceve in automatico nome, ruolo e colore. Le password NON sono qui.
create table if not exists public.team_seed (
  email text primary key,
  name  text not null,
  title text not null default '',
  role  text not null default 'giardiniere',
  field boolean not null default true,
  color text not null default '#4F7CAC',
  days  smallint[] not null default '{}',
  sort  int not null default 100
);
alter table public.team_seed enable row level security; -- nessuno la legge dall'app

insert into public.team_seed (email, name, title, role, field, color, days, sort) values
  ('nicolas@lavori.ftgiardini.com',    'Nicolas',    'Titolare · Capo giardiniere', 'titolare',    true,  '#2A7D2E', '{}',  1),
  ('martina@lavori.ftgiardini.com',    'Martina',    'Ufficio · Pianificazione',    'ufficio',     false, '#48AB33', '{}',  2),
  ('alessandro@lavori.ftgiardini.com', 'Alessandro', 'Giardiniere',                 'giardiniere', true,  '#8A5A3B', '{}',  3),
  ('leonardo@lavori.ftgiardini.com',   'Leonardo',   'Giardiniere',                 'giardiniere', true,  '#4F7CAC', '{}',  4),
  ('manuel@lavori.ftgiardini.com',     'Manuel',     'Giardiniere',                 'giardiniere', true,  '#7B61C9', '{6}', 5),
  ('tomas@lavori.ftgiardini.com',      'Tomas',      'Giardiniere',                 'giardiniere', true,  '#D9772B', '{}',  6)
on conflict (email) do nothing;

-- ---------- Persone (una riga per ogni accesso) ----------
create table if not exists public.profiles (
  id    uuid primary key references auth.users (id) on delete cascade,
  email text,
  name  text not null,
  title text not null default '',
  role  text not null default 'giardiniere' check (role in ('titolare', 'ufficio', 'giardiniere')),
  field boolean not null default true,
  color text not null default '#4F7CAC',
  days  smallint[] not null default '{}',
  sort  int not null default 100,
  created_at timestamptz not null default now()
);

-- ---------- Impostazioni generali ----------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  work_days smallint[] not null default '{1,2,3,4,5,6}'
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------- Tipi di lavoro ----------
create table if not exists public.work_types (
  id     text primary key,
  name   text not null,
  icon   text not null default 'tool',
  color  text not null default '#7A8794',
  months smallint[] not null default '{}',
  sort   int not null default 100
);
insert into public.work_types (id, name, icon, color, months, sort) values
  ('taglio-erba',       'Sfalci',                                      'grass',    '#48AB33', '{4,5,6,7,8,9,10}',             0),
  ('potatura',          'Potatura cespugli',                           'scissors', '#8A5A3B', '{3,4,5,6,7,8,9,10}',           1),
  ('foglie',            'Raccolta foglie',                             'leaf',     '#D9772B', '{10,11,12}',                   2),
  ('diserbo',           'Utilizzo diserbante',                         'spray',    '#B8962E', '{4,5,6,7,8,9}',                3)
on conflict (id) do nothing;

-- ---------- Condomini ----------
create table if not exists public.condos (
  id             text primary key,
  name           text not null default '',
  address        text not null default '',
  city           text not null default '',
  admin_name     text not null default '',
  phone          text not null default '',
  email          text not null default '',
  notes          text not null default '',
  contract_start date,
  contract_end   date,
  team           text[] not null default '{}',
  works          jsonb not null default '[]',
  created_at     bigint,
  updated_at     timestamptz not null default now()
);

-- ---------- Interventi ----------
create table if not exists public.jobs (
  id           text primary key,
  condo_id     text not null references public.condos (id) on delete cascade,
  work_id      text not null,
  type_id      text not null,
  date         date,
  status       text not null default 'da-fare' check (status in ('da-fare', 'fatto')),
  assignees    text[] not null default '{}',
  note         text not null default '',
  done_at      bigint,
  done_by      text,
  date_moved   boolean not null default false,
  planned_date date,
  log          jsonb not null default '[]',
  updated_at   timestamptz not null default now()
);
create index if not exists jobs_condo_idx on public.jobs (condo_id);
create index if not exists jobs_date_idx on public.jobs (date);

-- ---------- Appuntamenti, promemoria, lavori extra ----------
create table if not exists public.events (
  id         text primary key,
  kind       text not null default 'appuntamento' check (kind in ('appuntamento', 'promemoria', 'lavoro')),
  title      text not null default '',
  date       date not null,
  start_time text check (start_time is null or start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time   text check (end_time is null or end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  place      text not null default '',
  note       text not null default '',
  assignees  text[] not null default '{}',
  done       boolean not null default false,
  done_at    bigint,
  done_by    text,
  created_by text,
  created_at bigint,
  updated_at timestamptz not null default now()
);
create index if not exists events_date_idx on public.events (date);

-- ============================================================================
-- Regole di accesso
--   titolare    → tutto
--   ufficio     → condomini, interventi, tipi di lavoro, impostazioni (non squadra, non eliminare condomini)
--   giardiniere → legge tutto, aggiorna solo gli interventi assegnati a lui (o senza assegnazione)
-- ============================================================================

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('titolare', 'ufficio') from public.profiles where id = auth.uid()), false)
$$;

alter table public.profiles   enable row level security;
alter table public.settings   enable row level security;
alter table public.work_types enable row level security;
alter table public.condos     enable row level security;
alter table public.jobs       enable row level security;
alter table public.events     enable row level security;

revoke all on public.profiles, public.settings, public.work_types, public.condos, public.jobs, public.events, public.team_seed from anon;
grant select, insert, update, delete on public.profiles, public.settings, public.work_types, public.condos, public.jobs, public.events to authenticated;

-- Persone
drop policy if exists "profili lettura" on public.profiles;
create policy "profili lettura" on public.profiles for select to authenticated using (true);
drop policy if exists "profili modifica titolare" on public.profiles;
create policy "profili modifica titolare" on public.profiles for update to authenticated
  using (public.my_role() = 'titolare') with check (public.my_role() = 'titolare');

-- Impostazioni e tipi di lavoro
drop policy if exists "impostazioni lettura" on public.settings;
create policy "impostazioni lettura" on public.settings for select to authenticated using (true);
drop policy if exists "impostazioni gestione" on public.settings;
create policy "impostazioni gestione" on public.settings for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists "tipi lettura" on public.work_types;
create policy "tipi lettura" on public.work_types for select to authenticated using (true);
drop policy if exists "tipi gestione" on public.work_types;
create policy "tipi gestione" on public.work_types for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Condomini
drop policy if exists "condomini lettura" on public.condos;
create policy "condomini lettura" on public.condos for select to authenticated using (true);
drop policy if exists "condomini inserimento" on public.condos;
create policy "condomini inserimento" on public.condos for insert to authenticated with check (public.is_manager());
drop policy if exists "condomini modifica" on public.condos;
create policy "condomini modifica" on public.condos for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
drop policy if exists "condomini eliminazione" on public.condos;
create policy "condomini eliminazione" on public.condos for delete to authenticated using (public.my_role() = 'titolare');

-- Interventi
drop policy if exists "interventi lettura" on public.jobs;
create policy "interventi lettura" on public.jobs for select to authenticated using (true);
drop policy if exists "interventi inserimento" on public.jobs;
create policy "interventi inserimento" on public.jobs for insert to authenticated with check (public.is_manager());
drop policy if exists "interventi eliminazione" on public.jobs;
create policy "interventi eliminazione" on public.jobs for delete to authenticated using (public.is_manager());
drop policy if exists "interventi modifica" on public.jobs;
create policy "interventi modifica" on public.jobs for update to authenticated
  using (public.is_manager() or cardinality(assignees) = 0 or auth.uid()::text = any (assignees))
  with check (true);

-- Un giardiniere può spuntare, rimandare e scrivere note, ma non spostare un intervento su un altro condominio/lavoro
create or replace function public.jobs_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager()
     and (new.id is distinct from old.id or new.condo_id is distinct from old.condo_id
          or new.work_id is distinct from old.work_id or new.type_id is distinct from old.type_id) then
    raise exception 'Modifica non consentita' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists jobs_guard on public.jobs;
create trigger jobs_guard before update on public.jobs for each row execute function public.jobs_guard();

-- Appuntamenti: Nicolas e Martina vedono e gestiscono tutto;
-- gli altri vedono solo quelli per loro (o per tutti) e possono solo segnarli come fatti
drop policy if exists "appuntamenti lettura" on public.events;
create policy "appuntamenti lettura" on public.events for select to authenticated
  using (public.is_manager() or cardinality(assignees) = 0 or auth.uid()::text = any (assignees));
drop policy if exists "appuntamenti inserimento" on public.events;
create policy "appuntamenti inserimento" on public.events for insert to authenticated with check (public.is_manager());
drop policy if exists "appuntamenti eliminazione" on public.events;
create policy "appuntamenti eliminazione" on public.events for delete to authenticated using (public.is_manager());
drop policy if exists "appuntamenti modifica" on public.events;
create policy "appuntamenti modifica" on public.events for update to authenticated
  using (public.is_manager() or cardinality(assignees) = 0 or auth.uid()::text = any (assignees))
  with check (true);

create or replace function public.events_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_manager()
     and (new.id, new.kind, new.title, new.date, new.start_time, new.end_time, new.place, new.note, new.assignees, new.created_by, new.created_at)
         is distinct from
         (old.id, old.kind, old.title, old.date, old.start_time, old.end_time, old.place, old.note, old.assignees, old.created_by, old.created_at) then
    raise exception 'Modifica non consentita' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists events_guard on public.events;
create trigger events_guard before update on public.events for each row execute function public.events_guard();

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists condos_touch on public.condos;
create trigger condos_touch before update on public.condos for each row execute function public.touch_updated_at();

-- ============================================================================
-- Accessi
-- ============================================================================

-- Nuovo accesso → crea la persona (con i dati della squadra iniziale se l'email corrisponde)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s public.team_seed%rowtype;
begin
  select * into s from public.team_seed where lower(email) = lower(new.email);
  insert into public.profiles (id, email, name, title, role, field, color, days, sort)
  values (
    new.id, new.email,
    coalesce(s.name, initcap(split_part(new.email, '@', 1))),
    coalesce(s.title, 'Giardiniere'),
    coalesce(s.role, 'giardiniere'),
    coalesce(s.field, true),
    coalesce(s.color, '#4F7CAC'),
    coalesce(s.days, '{}'),
    coalesce(s.sort, 100)
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Accessi creati prima di eseguire questo file
insert into public.profiles (id, email, name, title, role, field, color, days, sort)
select u.id, u.email,
       coalesce(s.name, initcap(split_part(u.email, '@', 1))), coalesce(s.title, 'Giardiniere'),
       coalesce(s.role, 'giardiniere'), coalesce(s.field, true), coalesce(s.color, '#4F7CAC'),
       coalesce(s.days, '{}'), coalesce(s.sort, 100)
from auth.users u
left join public.team_seed s on lower(s.email) = lower(u.email)
on conflict (id) do nothing;

-- Elenco nomi per la schermata di accesso (visibile prima di entrare: nome, ruolo, colore, email di accesso)
create or replace function public.elenco_accessi()
returns table (id uuid, name text, title text, role text, field boolean, color text, days smallint[], email text)
language sql stable security definer set search_path = public as $$
  select id, name, title, role, field, color, days, email from public.profiles order by sort, name
$$;
revoke all on function public.elenco_accessi() from public;
grant execute on function public.elenco_accessi() to anon, authenticated;

-- ============================================================================
-- Aggiornamenti in tempo reale
-- ============================================================================
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['profiles', 'settings', 'work_types', 'condos', 'jobs', 'events'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
