// @ts-nocheck — Deno runtime; not checked by Node/tsc
// supabase/functions/comments/index.ts
// Supabase Edge Function — handles proposal comments (read + write)
// Deploy: supabase functions deploy comments
// Env var needed: SUPABASE_SERVICE_ROLE_KEY (set via supabase secrets set)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SERVICE_ROLE_KEY')!
  )

  try {
    const body = await req.json()
    const { action } = body

    // ---- GET COMMENTS ----
    if (action === 'list') {
      const { proposal_id, code_hash } = body

      if (!proposal_id || !code_hash) {
        return new Response(
          JSON.stringify({ error: 'Missing proposal_id or code_hash' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Verify the caller has access to this proposal
      const { data: codeData } = await supabase
        .from('proposal_codes')
        .select('proposal_path')
        .eq('code_hash', code_hash)
        .eq('proposal_path', proposal_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!codeData) {
        return new Response(
          JSON.stringify({ error: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data, error } = await supabase
        .from('proposal_comments')
        .select('*')
        .eq('proposal_id', proposal_id)
        .order('created_at', { ascending: true })

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to load comments' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ comments: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ---- POST COMMENT ----
    if (action === 'create') {
      const { proposal_id, code_hash, parent_id, author_name, is_mcg, mcg_passphrase, content } = body

      if (!proposal_id || !code_hash || !author_name || !content) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Verify access
      const { data: codeData } = await supabase
        .from('proposal_codes')
        .select('proposal_path')
        .eq('code_hash', code_hash)
        .eq('proposal_path', proposal_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!codeData) {
        return new Response(
          JSON.stringify({ error: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Verify McG Works team passphrase server-side
      let verifiedMcg = false
      if (is_mcg) {
        const serverPassphrase = Deno.env.get('MCG_PASSPHRASE')
        if (!mcg_passphrase || mcg_passphrase !== serverPassphrase) {
          return new Response(
            JSON.stringify({ error: 'Invalid team passphrase.' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        verifiedMcg = true
      }

      const { data, error } = await supabase
        .from('proposal_comments')
        .insert({
          proposal_id,
          parent_id: parent_id || null,
          author_name,
          is_mcg: verifiedMcg,
          content
        })
        .select()
        .single()

      if (error) {
        return new Response(
          JSON.stringify({ error: 'Failed to post comment' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ comment: data }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(
      JSON.stringify({ error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
