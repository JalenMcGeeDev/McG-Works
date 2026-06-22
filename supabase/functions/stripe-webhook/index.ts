// @ts-nocheck — Deno runtime
// supabase/functions/stripe-webhook/index.ts
// Receives Stripe webhook events and records completed payments as orders.
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets needed:
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/** Verify Stripe webhook signature using Web Crypto (HMAC-SHA256). */
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  const parts = sigHeader.split(',').reduce((acc, part) => {
    const idx = part.indexOf('=')
    acc[part.slice(0, idx)] = part.slice(idx + 1)
    return acc
  }, {} as Record<string, string>)

  const timestamp = parts['t']
  const expectedSig = parts['v1']
  if (!timestamp || !expectedSig) return false

  // Reject events older than 5 minutes to prevent replay attacks
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signedPayload = `${timestamp}.${payload}`
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload))
  const computed = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return computed === expectedSig
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const payload   = await req.text()
  const sigHeader = req.headers.get('stripe-signature') ?? ''
  const secret    = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''

  const valid = await verifyStripeSignature(payload, sigHeader, secret)
  if (!valid) {
    return new Response('Invalid signature', { status: 400 })
  }

  let event: any
  try {
    event = JSON.parse(payload)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi   = event.data.object
    const meta = pi.metadata ?? {}

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { error } = await supabase.from('orders').insert([{
      item_id:           meta.item_id    ? parseInt(meta.item_id)    : null,
      item_name:         meta.item_name  ?? null,
      item_price:        meta.item_price ? parseFloat(meta.item_price) : null,
      customer_name:     meta.customer_name  ?? null,
      customer_email:    meta.customer_email ?? null,
      customer_phone:    null,
      status:            'paid',
      stripe_session_id: pi.id,
    }])

    if (error) {
      console.error('Failed to insert order:', error)
      // Still return 200 so Stripe doesn't retry — log and investigate separately
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
