-- FT Giardini · Lavori — aggiornamento: i pagamenti li vede e li gestisce anche Martina (ufficio)
-- Supabase → SQL Editor → New query → incolla tutto → Run. Si può rieseguire senza problemi.

create or replace function public.can_see_payments() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('titolare', 'ufficio', 'amministrazione') from public.profiles where id = auth.uid()), false)
$$;

-- l'app lo usa per sapere se la persona collegata può vedere i pagamenti
grant execute on function public.can_see_payments() to authenticated;

notify pgrst, 'reload schema';

select 'Aggiornamento riuscito: pagamenti visibili a Nicolas, Martina e Alessandro' as risultato;
