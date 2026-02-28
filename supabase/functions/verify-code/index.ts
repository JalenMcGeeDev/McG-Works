// @ts-nocheck — Deno runtime; not checked by Node/tsc
// supabase/functions/verify-code/index.ts
// Supabase Edge Function — verifies a proposal access code
// Deploy: supabase functions deploy verify-code
// Env var needed: SUPABASE_SERVICE_ROLE_KEY (set via supabase secrets set)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code } = await req.json()

    if (!code || typeof code !== 'string') {
      return new Response(
        JSON.stringify({ valid: false, error: 'Missing code' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use the service role key (hidden in env, never exposed to client)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!
    )

    // Case-insensitive match against plaintext code
    const { data, error } = await supabase
      .from('proposal_codes')
      .select('proposal_path, client_name')
      .ilike('code', code)
      .eq('is_active', true)
      .maybeSingle()

    if (error || !data) {
      return new Response(
        JSON.stringify({ valid: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ valid: true, proposal_path: data.proposal_path }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(
      JSON.stringify({ valid: false, error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
