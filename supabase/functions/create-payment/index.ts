// @ts-nocheck — Deno runtime
// supabase/functions/create-payment/index.ts
// Creates a Stripe PaymentIntent for an embedded card payment.
// Deploy: supabase functions deploy create-payment --no-verify-jwt
// Secrets needed:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_ACCOUNT_ID=acct_...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { cart, customer_name, customer_email, shipping_method, pickup_date, pickup_slot, shipping_cost } = await req.json()

    if (!Array.isArray(cart) || !cart.length || !customer_name || !customer_email) {
      return new Response(
        JSON.stringify({ error: 'cart (array), customer_name, and customer_email are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRe.test(customer_email)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email address' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate cart items server-side against DB
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const ids = cart.map((i: any) => i.id)
    const { data: items, error } = await supabase
      .from('items')
      .select('id, name, price, available')
      .in('id', ids)

    if (error) throw new Error('Could not load items')

    // Verify all requested items are available and sum authoritative prices
    let totalCents = 0
    const lineItems: string[] = []
    for (const cartItem of cart) {
      const dbItem = items?.find((i: any) => String(i.id) === String(cartItem.id))
      if (!dbItem) throw new Error(`Item not found: ${cartItem.id}`)
      if (!dbItem.available) throw new Error(`${dbItem.name} is no longer available`)
      totalCents += Math.round(parseFloat(dbItem.price) * 100)
      lineItems.push(dbItem.name)
    }

    // Add shipping cost if provided (validated as non-negative)
    const shippingCents = Math.round(Math.max(0, parseFloat(shipping_cost) || 0) * 100)
    totalCents += shippingCents

    // Load tax rate from settings table
    const { data: taxSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'tax_rate')
      .maybeSingle()
    const taxRate = parseFloat(taxSetting?.value ?? '7.5') / 100 || 0.075
    const taxCents = Math.round(totalCents * taxRate)
    totalCents += taxCents

    const stripeKey     = Deno.env.get('STRIPE_SECRET_KEY')
    const stripeAccount = Deno.env.get('STRIPE_ACCOUNT_ID')
    if (!stripeKey) throw new Error('Stripe is not configured')

    // Build PaymentIntent
    const params = new URLSearchParams()
    params.append('amount',   String(totalCents))
    params.append('currency', 'usd')
    params.append('automatic_payment_methods[enabled]', 'true')
    params.append('receipt_email', customer_email)
    params.append('description',   lineItems.join(', '))
    params.append('metadata[item_names]',    lineItems.join(', ').slice(0, 500))
    params.append('metadata[customer_name]', customer_name.slice(0, 500))
    params.append('metadata[customer_email]',customer_email.slice(0, 500))
    params.append('metadata[shipping_method]', (shipping_method || 'pickup').slice(0, 50))
    if (pickup_date) params.append('metadata[pickup_date]', String(pickup_date).slice(0, 50))
    if (pickup_slot) params.append('metadata[pickup_slot]', String(pickup_slot).slice(0, 50))
    if (shippingCents) params.append('metadata[shipping_cost]', String(shippingCents / 100))
    params.append('metadata[tax]', String((taxCents / 100).toFixed(2)))
    params.append('metadata[tax_rate_pct]', String((taxRate * 100).toFixed(3)))

    const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        'Authorization':  `Bearer ${stripeKey}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Stripe-Version': '2025-05-28.basil',
        ...(stripeAccount ? { 'Stripe-Context': stripeAccount } : {}),
      },
      body: params.toString(),
    })

    const pi = await stripeRes.json()
    if (!stripeRes.ok) throw new Error(pi.error?.message || 'Stripe error')

    return new Response(
      JSON.stringify({ client_secret: pi.client_secret }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
