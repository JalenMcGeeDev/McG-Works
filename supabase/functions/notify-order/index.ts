// @ts-nocheck — Deno runtime
// supabase/functions/notify-order/index.ts
// Sends an email notification to Jalen when an order or custom request is placed.
// Deploy: supabase functions deploy notify-order --no-verify-jwt
// Secrets needed: RESEND_API_KEY

import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const {
      type,             // 'order' | 'custom_request'
      customer_name,
      customer_email,
      customer_phone,
      shipping_method,
      item_name,
      cart_items,
      shipping_address,
      pickup_date,
      pickup_slot,
      amount_total,
      message,
    } = body

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) throw new Error('RESEND_API_KEY not set')

    const isCustom = type === 'custom_request'

    // ── Build subject ──────────────────────────────────────────
    const subject = isCustom
      ? `✏️ Custom Request — ${customer_name}`
      : `🛒 New Order — ${customer_name} (${shipping_method})`

    // ── Build fulfillment section ─────────────────────────────
    let fulfillmentHtml = ''
    if (!isCustom) {
      if (shipping_method === 'pickup') {
        fulfillmentHtml = `
          <tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Fulfillment</td>
              <td style="padding:6px 0;font-weight:600">🏛️ Pickup — ${pickup_date || ''} &middot; ${pickup_slot || ''}</td></tr>`
      } else if (shipping_method === 'delivery') {
        const a = shipping_address || {}
        fulfillmentHtml = `
          <tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Fulfillment</td>
              <td style="padding:6px 0;font-weight:600">🚗 Delivery</td></tr>
          <tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Address</td>
              <td style="padding:6px 0">${[a.street, a.city, a.state, a.zip].filter(Boolean).join(', ')}</td></tr>`
      } else if (shipping_method === 'ship') {
        const a = shipping_address || {}
        fulfillmentHtml = `
          <tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Fulfillment</td>
              <td style="padding:6px 0;font-weight:600">📦 Ship</td></tr>
          <tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Ship to</td>
              <td style="padding:6px 0">${[a.street, a.city, a.state, a.zip].filter(Boolean).join(', ')}</td></tr>`
      }
    }

    // ── Build items section ───────────────────────────────────
    const items = Array.isArray(cart_items) && cart_items.length
      ? cart_items.map(i => `<li style="margin-bottom:.25rem">${i.name}${i.price ? ` — $${parseFloat(i.price).toFixed(2)}` : ''}</li>`).join('')
      : `<li>${item_name || 'Item'}</li>`

    // ── Build total line ──────────────────────────────────────
    const totalLine = (!isCustom && amount_total)
      ? `<tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Total charged</td>
             <td style="padding:6px 0;font-weight:700;font-size:1.1rem">$${parseFloat(amount_total).toFixed(2)}</td></tr>`
      : ''

    // ── Build message/description line ────────────────────────
    const msgLine = message
      ? `<div style="margin-top:1.25rem;padding:1rem;background:#f5f1e8;border-radius:8px;font-size:.93rem;line-height:1.6">
           <strong>${isCustom ? 'Request details' : 'Note'}:</strong><br>${message}
         </div>`
      : ''

    // ── HTML email ────────────────────────────────────────────
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0ebe0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:2rem auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.1)">
    <div style="background:linear-gradient(135deg,#5d4e37,#3d2f20);padding:1.5rem 1.75rem;color:#fff">
      <div style="font-size:1.4rem;font-weight:700">🪵 Jalen's Woodshop</div>
      <div style="opacity:.8;font-size:.88rem;margin-top:.25rem">${isCustom ? 'New custom request' : 'New order received'}</div>
    </div>
    <div style="padding:1.75rem">
      <h2 style="margin:0 0 1.25rem;font-size:1.15rem;color:#3d2f20">${isCustom ? '✏️ Custom Request' : '🛒 Order'} from ${customer_name}</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Name</td>
            <td style="padding:6px 0;font-weight:600">${customer_name}</td></tr>
        <tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Email</td>
            <td style="padding:6px 0"><a href="mailto:${customer_email}" style="color:#5d4e37">${customer_email}</a></td></tr>
        ${customer_phone ? `<tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem">Phone</td>
            <td style="padding:6px 0">${customer_phone}</td></tr>` : ''}
        ${!isCustom ? `<tr><td style="padding:6px 0;color:#7a6a55;font-size:.88rem;vertical-align:top">Items</td>
            <td style="padding:6px 0"><ul style="margin:0;padding-left:1.2rem">${items}</ul></td></tr>` : ''}
        ${fulfillmentHtml}
        ${totalLine}
      </table>
      ${msgLine}
      <div style="margin-top:1.75rem;padding-top:1.25rem;border-top:1px solid #e8dcc8;text-align:center">
        <a href="https://mcg.works/jalenswoodshop/admin" style="display:inline-block;background:#3d2f20;color:#fff;text-decoration:none;padding:.65rem 1.5rem;border-radius:40px;font-size:.88rem;font-weight:700">Open Admin Panel</a>
      </div>
    </div>
  </div>
</body>
</html>`

    // ── Send via Resend ───────────────────────────────────────
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'orders@mcg.works',
        to:   ['jalen@mcg.works'],
        subject,
        html,
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.message || 'Resend error')

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    // Non-fatal — don't block the order if email fails
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
