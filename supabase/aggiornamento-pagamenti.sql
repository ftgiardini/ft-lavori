-- FT Giardini · Lavori — aggiornamento: pagamenti e tempo dei lavori extra
-- Supabase → SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

-- Pagamenti dei clienti (rate, incassi)
create table if not exists public.payments (
  id         text primary key,
  condo_id   text not null references public.condos (id) on delete cascade,
  title      text not null default '',
  amount     numeric(12, 2) not null default 0,
  due_date   date,
  paid       boolean not null default false,
  paid_date  date,
  method     text not null default '',
  note       text not null default '',
  paid_by    text,
  created_by text,
  created_at bigint,
  updated_at timestamptz not null default now()
);
create index if not exists payments_condo_idx on public.payments (condo_id);
create index if not exists payments_due_idx on public.payments (due_date);

alter table public.payments enable row level security;
revoke all on public.payments from anon;
grant select, insert, update, delete on public.payments to authenticated;

-- solo il titolare e l'amministrazione vedono e modificano i pagamenti
create or replace function public.can_see_payments() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('titolare', 'amministrazione') from public.profiles where id = auth.uid()), false)
$$;
drop policy if exists "pagamenti contabilita" on public.payments;
create policy "pagamenti contabilita" on public.payments for all to authenticated
  using (public.can_see_payments()) with check (public.can_see_payments());

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();

-- Lavori extra: tempo impiegato, cosa è stato fatto, chi c'era
alter table public.events add column if not exists done_minutes int;
alter table public.events add column if not exists done_note text;
alter table public.events add column if not exists done_team text[];

-- Aggiornamenti in tempo reale anche per i pagamenti
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments') then
    alter publication supabase_realtime add table public.payments;
  end if;
end $$;

-- l'app vede subito le novità
notify pgrst, 'reload schema';

select 'Aggiornamento riuscito' as risultato;
