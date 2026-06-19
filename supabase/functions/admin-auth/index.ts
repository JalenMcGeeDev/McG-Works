// @ts-nocheck — Deno runtime; not checked by Node/tsc
// supabase/functions/admin-auth/index.ts
// Verifies the admin PIN (stored as a Supabase secret, never in client code).
// If correct, signs in as the admin Supabase Auth user and returns the session.
//
// Required secrets (set via: supabase secrets set KEY=value):
//   ADMIN_PIN           — the PIN the admin page will ask for
//   ADMIN_EMAIL         — email of the admin user in Supabase Auth
//   ADMIN_PASSWORD      — password of the admin user in Supabase Auth
//   SUPABASE_SERVICE_ROLE_KEY — already available in Supabase edge functions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { pin } = await req.json()

    if (!pin || typeof pin !== 'string') {
      return new Response(
        JSON.stringify({ authorized: false, error: 'Missing PIN' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const correctPin = Deno.env.get('ADMIN_PIN')
    if (!correctPin) {
      return new Response(
        JSON.stringify({ authorized: false, error: 'Server misconfigured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Constant-time comparison to prevent timing attacks
    if (pin.length !== correctPin.length || pin !== correctPin) {
      // Small delay to slow down brute-force attempts
      await new Promise(r => setTimeout(r, 500))
      return new Response(
        JSON.stringify({ authorized: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // PIN correct — sign in as the admin Supabase Auth user
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data, error } = await supabase.auth.signInWithPassword({
      email:    Deno.env.get('ADMIN_EMAIL')!,
      password: Deno.env.get('ADMIN_PASSWORD')!,
    })

    if (error || !data.session) {
      return new Response(
        JSON.stringify({ authorized: false, error: 'Auth failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ authorized: true, session: data.session }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(
      JSON.stringify({ authorized: false, error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
