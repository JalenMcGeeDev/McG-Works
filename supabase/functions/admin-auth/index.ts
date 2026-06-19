// @ts-nocheck — Deno runtime; not checked by Node/tsc
// supabase/functions/admin-auth/index.ts
// Verifies the admin PIN (stored as a Supabase secret, never in client code).
// Returns a short-lived token on success — no Supabase Auth user required.
//
// Required secrets (set via: supabase secrets set KEY=value):
//   ADMIN_PIN    — the PIN the admin page will ask for
//   ADMIN_TOKEN  — a long random string you generate once (acts as a session secret)

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
    const token      = Deno.env.get('ADMIN_TOKEN')

    if (!correctPin || !token) {
      return new Response(
        JSON.stringify({ authorized: false, error: 'Server misconfigured — secrets not set' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Constant-time comparison to prevent timing attacks
    const encoder = new TextEncoder()
    const pinBuf  = encoder.encode(pin)
    const okBuf   = encoder.encode(correctPin)
    let mismatch  = pinBuf.length !== okBuf.length ? 1 : 0
    const len     = Math.min(pinBuf.length, okBuf.length)
    for (let i = 0; i < len; i++) mismatch |= pinBuf[i] ^ okBuf[i]

    if (mismatch !== 0) {
      await new Promise(r => setTimeout(r, 500)) // slow down brute force
      return new Response(
        JSON.stringify({ authorized: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // PIN correct — return the server-side token so the client can prove auth
    return new Response(
      JSON.stringify({ authorized: true, token }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ authorized: false, error: e?.message ?? 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
