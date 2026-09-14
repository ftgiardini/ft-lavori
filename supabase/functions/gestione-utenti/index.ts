// FT Giardini · Lavori — funzione "gestione-utenti"
// Permette al titolare, dall'app, di creare persone, cambiare password ed eliminare accessi.
// Usa la chiave segreta del progetto, che resta sul server di Supabase e non arriva mai all'app.
//
// Come si crea: Supabase → Edge Functions → Deploy a new function → Via Editor
// → nome: gestione-utenti → incolla questo file → Deploy.

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['titolare', 'ufficio', 'giardiniere'];
const MIN_PASSWORD = 6;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'Metodo non consentito' }, 405);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Chi sta chiamando? Deve essere collegato ed essere il titolare
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth?.user) return reply({ error: 'Accesso scaduto: esci e rientra.' }, 401);
    const { data: me } = await admin.from('profiles').select('role').eq('id', auth.user.id).maybeSingle();
    if (me?.role !== 'titolare') return reply({ error: 'Solo il titolare può gestire gli accessi.' }, 403);

    const body = await req.json();
    const password = typeof body.password === 'string' ? body.password.trim().toUpperCase() : '';

    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const p = body.profile || {};
      if (!email || !p.name) return reply({ error: 'Nome mancante.' }, 400);
      if (password.length < MIN_PASSWORD) return reply({ error: `La password deve avere almeno ${MIN_PASSWORD} caratteri.` }, 400);

      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return reply({ error: /already|registered|exists/i.test(error.message) ? 'Esiste già un accesso con questo nome.' : error.message }, 400);

      const { error: profileError } = await admin.from('profiles').upsert({
        id: data.user.id,
        email,
        name: String(p.name),
        title: String(p.title ?? ''),
        role: ROLES.includes(p.role) ? p.role : 'giardiniere',
        field: p.field !== false,
        color: String(p.color || '#4F7CAC'),
        days: Array.isArray(p.days) ? p.days : [],
        sort: Number(p.sort) || 100,
      });
      if (profileError) {
        await admin.auth.admin.deleteUser(data.user.id);
        return reply({ error: profileError.message }, 400);
      }
      return reply({ id: data.user.id, email });
    }

    if (body.action === 'set_password') {
      if (!body.id) return reply({ error: 'Persona mancante.' }, 400);
      if (password.length < MIN_PASSWORD) return reply({ error: `La password deve avere almeno ${MIN_PASSWORD} caratteri.` }, 400);
      const { error } = await admin.auth.admin.updateUserById(String(body.id), { password });
      if (error) return reply({ error: error.message }, 400);
      return reply({ ok: true });
    }

    if (body.action === 'delete') {
      if (!body.id) return reply({ error: 'Persona mancante.' }, 400);
      if (body.id === auth.user.id) return reply({ error: 'Non puoi eliminare il tuo stesso accesso.' }, 400);
      const { error } = await admin.auth.admin.deleteUser(String(body.id));
      if (error) return reply({ error: error.message }, 400);
      return reply({ ok: true });
    }

    return reply({ error: 'Azione sconosciuta.' }, 400);
  } catch (err) {
    return reply({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
