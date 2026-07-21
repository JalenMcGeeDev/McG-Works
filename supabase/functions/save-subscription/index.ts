import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return new Response('Unauthorized', { status: 401 });

  if (req.method === 'POST') {
    const body = await req.json();
    const { endpoint, keys } = body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return new Response('Bad Request', { status: 400 });
    }
    const { error: dbErr } = await supabase.from('push_subscriptions').upsert(
      { user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      { onConflict: 'user_id,endpoint' }
    );
    if (dbErr) return new Response(JSON.stringify({ error: dbErr.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  if (req.method === 'DELETE') {
    const { endpoint } = await req.json();
    const { error: dbErr } = await supabase.from('push_subscriptions')
      .delete().eq('user_id', user.id).eq('endpoint', endpoint);
    if (dbErr) return new Response(JSON.stringify({ error: dbErr.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  return new Response('Method Not Allowed', { status: 405 });
});
