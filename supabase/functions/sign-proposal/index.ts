// @ts-nocheck — Deno runtime; not checked by Node/tsc
// supabase/functions/sign-proposal/index.ts
// Supabase Edge Function — records a proposal signature and emails both parties
// Deploy: npx supabase functions deploy sign-proposal
// Env vars: SUPABASE_URL, SERVICE_ROLE_KEY, RESEND_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const JALEN_EMAIL = 'Jalen@mcg-works.com'
const FROM_ADDRESS = 'McG Works Proposals <proposals@mcg-works.com>'

Deno.serve(async (req) => {
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

    // ---- CHECK: has this proposal already been signed? ----
    if (action === 'check') {
      const { code, proposal_id } = body

      if (!code || !proposal_id) {
        return new Response(
          JSON.stringify({ error: 'Missing code or proposal_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Verify access
      const { data: codeData } = await supabase
        .from('proposal_codes')
        .select('proposal_path')
        .ilike('code', code)
        .eq('proposal_path', proposal_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!codeData) {
        return new Response(
          JSON.stringify({ error: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const { data: sig } = await supabase
        .from('proposal_signatures')
        .select('signed_at, client_name')
        .ilike('code', code)
        .maybeSingle()

      return new Response(
        JSON.stringify({
          signed: !!sig,
          signed_at: sig?.signed_at ?? null,
          client_name: sig?.client_name ?? null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ---- SIGN ----
    if (action === 'sign') {
      const { code, proposal_id, client_name, client_email, pdf_base64 } = body

      if (!code || !proposal_id || !client_name || !client_email) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Basic email format check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client_email)) {
        return new Response(
          JSON.stringify({ error: 'Invalid email address' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Verify access
      const { data: codeData } = await supabase
        .from('proposal_codes')
        .select('proposal_path, client_name')
        .ilike('code', code)
        .eq('proposal_path', proposal_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!codeData) {
        return new Response(
          JSON.stringify({ error: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Block duplicate signatures (unique constraint on code)
      const { data: existingSig } = await supabase
        .from('proposal_signatures')
        .select('id')
        .ilike('code', code)
        .maybeSingle()

      if (existingSig) {
        return new Response(
          JSON.stringify({ error: 'This proposal has already been signed.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Capture IP from forwarded header
      const ip_address = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

      // Insert signature record
      const { data: sig, error: insertError } = await supabase
        .from('proposal_signatures')
        .insert({
          proposal_id,
          code: code.toUpperCase(),
          client_name,
          client_email,
          ip_address,
        })
        .select()
        .single()

      if (insertError) {
        console.error('[sign-proposal] Insert error:', insertError)
        return new Response(
          JSON.stringify({ error: 'Failed to record signature' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const proposalLabel = codeData.client_name ?? proposal_id
      const proposalUrl = `https://mcg-works.com/proposals/${proposal_id}/`
      const signedAt = new Date(sig.signed_at).toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })

      const resendKey = Deno.env.get('RESEND_API_KEY')!

      const clientEmailPayload = {
        from: FROM_ADDRESS,
        to: [client_email],
        subject: `Your signed McG Works proposal – ${proposalLabel}`,
        html: `
          <p>Hi ${escHtml(client_name)},</p>
          <p>Thank you for signing the <strong>${escHtml(proposalLabel)}</strong> proposal with McG Works.</p>
          <table style="border-collapse:collapse;margin:12px 0;">
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;">Signed by</td><td style="font-size:14px;">${escHtml(client_name)}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;">Date</td><td style="font-size:14px;">${signedAt}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;">Access code</td><td style="font-size:14px;font-family:monospace;">${escHtml(code.toUpperCase())}</td></tr>
          </table>
          <p>Your proposal will remain accessible at the link below — you can return to it at any time using your access code:</p>
          <p><a href="${proposalUrl}">${proposalUrl}</a></p>
          <p>The McG Works team will be in touch shortly to schedule your kickoff.</p>
          <p style="color:#6b7280;font-size:13px;">— McG Works</p>
        `,
      }

      const jalenEmailPayload = {
        from: FROM_ADDRESS,
        to: [JALEN_EMAIL],
        subject: `Proposal signed: ${proposalLabel} – ${client_name}`,
        html: `
          <p><strong>${escHtml(client_name)}</strong> (${escHtml(client_email)}) has signed the <strong>${escHtml(proposalLabel)}</strong> proposal.</p>
          <table style="border-collapse:collapse;margin:12px 0;">
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;">Signed</td><td style="font-size:14px;">${signedAt}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:14px;">IP</td><td style="font-size:14px;">${ip_address ?? 'unknown'}</td></tr>
          </table>
          <p>View the proposal: <a href="${proposalUrl}">${proposalUrl}</a></p>
        `,
      }

      const [clientRes, jalenRes] = await Promise.all([
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(clientEmailPayload),
        }),
        fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(jalenEmailPayload),
        }),
      ])

      if (!clientRes.ok || !jalenRes.ok) {
        const clientErr = !clientRes.ok ? await clientRes.text() : null
        const jalenErr = !jalenRes.ok ? await jalenRes.text() : null
        console.error('[sign-proposal] Resend error:', { clientErr, jalenErr })
      }

      return new Response(
        JSON.stringify({
          success: true,
          signed_at: sig.signed_at,
          email_sent: clientRes.ok && jalenRes.ok,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[sign-proposal] Unexpected error:', err)
    return new Response(
      JSON.stringify({ error: 'Server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
