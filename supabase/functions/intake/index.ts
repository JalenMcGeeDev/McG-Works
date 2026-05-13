// @ts-nocheck — Deno runtime; not checked by Node/tsc
// supabase/functions/intake/index.ts
// Receives a work request, optionally uploads an attachment to Supabase Storage,
// then sends a notification email to jalen@mcg-works.com via Resend.
//
// Required secrets (set with `supabase secrets set KEY=value`):
//   RESEND_API_KEY      — your Resend API key
//   SERVICE_ROLE_KEY    — Supabase service role key (for Storage uploads)
//
// Required setup:
//   1. Create a private Supabase Storage bucket named "intake-files"
//   2. Deploy: supabase functions deploy intake
//   3. Verify the mcg-works.com domain in your Resend dashboard

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const TO_EMAIL       = 'jalen@mcg-works.com'
const FROM_EMAIL     = 'intake@mcg-works.com'
const STORAGE_BUCKET = 'intake-files'
const SIGNED_URL_TTL = 60 * 60 * 24 * 30 // 30 days

// ── HTML-escape a string to prevent injection in email body ──────────────────
function esc(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Basic email format check ─────────────────────────────────────────────────
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

  try {
    const body = await req.json()
    const { name, email, phone, description, budget, timeline, referral, file } = body

    // ── Validate required fields ─────────────────────────────────────────────
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Name is required.' }),
        { status: 400, headers: responseHeaders }
      )
    }

    if (!email || !isValidEmail(email)) {
      return new Response(
        JSON.stringify({ error: 'A valid email address is required.' }),
        { status: 400, headers: responseHeaders }
      )
    }

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Project description is required.' }),
        { status: 400, headers: responseHeaders }
      )
    }

    // ── Upload attachment to Supabase Storage (if provided) ──────────────────
    let fileUrl: string | null = null

    if (file && typeof file.content === 'string' && file.name) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SERVICE_ROLE_KEY')!
        )

        // Decode base64 → bytes
        const binaryStr = atob(file.content)
        const bytes     = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i)
        }

        // Sanitize filename and prefix with timestamp to avoid collisions
        const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `${Date.now()}-${safeName}`

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, bytes, { contentType: file.type || 'application/octet-stream' })

        if (!uploadError) {
          const { data: signedData } = await supabase.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(storagePath, SIGNED_URL_TTL)

          fileUrl = signedData?.signedUrl ?? null
        }
        // If upload fails, we still send the email — just without the attachment link
      } catch {
        // Non-fatal: continue without file
      }
    }

    // ── Build email HTML ─────────────────────────────────────────────────────
    const fields: [string, string][] = [
      ['Name',     name],
      ['Email',    email],
      ['Phone',    phone  || '—'],
      ['Budget',   budget || '—'],
      ['Timeline', timeline || '—'],
      ['Referral', referral || '—'],
    ]

    const tableRows = fields.map(([label, value]) => `
      <tr>
        <td style="padding:8px 16px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;white-space:nowrap;vertical-align:top;">${esc(label)}</td>
        <td style="padding:8px 16px;font-size:15px;color:#f9fafb;">${esc(value)}</td>
      </tr>`
    ).join('')

    const attachmentBlock = fileUrl ? `
      <div style="margin-top:20px;">
        <a href="${esc(fileUrl)}" style="display:inline-block;padding:10px 18px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
          Download Attachment
        </a>
        <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Link expires in 30 days.</p>
      </div>` : ''

    const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#111111;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:#1f2937;border:1px solid #374151;border-radius:16px;overflow:hidden;">
    <div style="padding:28px 32px;border-bottom:1px solid #374151;">
      <h1 style="margin:0;font-size:20px;color:#ffffff;letter-spacing:-0.5px;">New Work Request</h1>
      <p style="margin:6px 0 0;font-size:14px;color:#6b7280;">Submitted via mcg-works.com/intake</p>
    </div>

    <div style="padding:24px 16px;">
      <table style="width:100%;border-collapse:collapse;">
        ${tableRows}
      </table>

      <div style="margin:20px 16px 0;padding:16px;background:#111827;border:1px solid #374151;border-radius:10px;">
        <p style="margin:0 0 10px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;">Project Description</p>
        <p style="margin:0;font-size:15px;color:#f9fafb;line-height:1.7;white-space:pre-wrap;">${esc(description)}</p>
      </div>

      ${attachmentBlock}
    </div>

    <div style="padding:16px 32px;border-top:1px solid #374151;">
      <p style="margin:0;font-size:12px;color:#6b7280;">Reply to this email to respond directly to ${esc(name)}.</p>
    </div>
  </div>
</body>
</html>`

    // ── Send via Resend ──────────────────────────────────────────────────────
    const resendRes = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:     FROM_EMAIL,
        to:       [TO_EMAIL],
        reply_to: email,
        subject:  `New Request — ${name}`,
        html:     emailHtml,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      throw new Error(`Resend error: ${errText}`)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: responseHeaders }
    )

  } catch (err) {
    console.error('[intake]', err)
    return new Response(
      JSON.stringify({ error: err?.message ?? 'Internal error. Please try again.' }),
      { status: 500, headers: responseHeaders }
    )
  }
})
