// @ts-nocheck — Deno runtime
// supabase/functions/get-rates/index.ts
// Fetches live shipping rates from EasyPost for a ship-method order.
// Deploy: supabase functions deploy get-rates --no-verify-jwt
// Secrets needed:
//   supabase secrets set EASYPOST_API_KEY=EZAK_...
//   supabase secrets set SHIP_FROM_NAME="Jalen's Woodshop"
//   supabase secrets set SHIP_FROM_STREET="300 N Roxboro St"
//   supabase secrets set SHIP_FROM_CITY=Durham
//   supabase secrets set SHIP_FROM_STATE=NC
//   supabase secrets set SHIP_FROM_ZIP=27701

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { order_id, cart, to_street, to_city, to_state, to_zip } = body

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let toAddr: { name: string; street1: string; city: string; state: string; zip: string }
    let weightOz = 48
    let customerName = 'Customer'

    if (order_id) {
      // Admin mode: look up the order
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('*')
        .eq('id', order_id)
        .single()

      if (orderErr || !order) throw new Error('Order not found')
      if (order.shipping_method !== 'ship') throw new Error('Rates only available for ship orders')

      const addr = order.shipping_address
      if (!addr?.street || !addr?.zip) throw new Error('Order has no shipping address')

      customerName = order.customer_name || 'Customer'
      toAddr = { name: customerName, street1: addr.street, city: addr.city, state: addr.state, zip: addr.zip }

      const itemIds = Array.isArray(order.cart_items)
        ? order.cart_items.map((i: any) => i.id)
        : order.item_id ? [order.item_id] : []

      if (itemIds.length) {
        const { data: items } = await supabase.from('items').select('weight_oz').in('id', itemIds)
        if (items?.length) {
          weightOz = items.reduce((sum: number, i: any) => sum + (parseFloat(i.weight_oz) || 48), 0)
        }
      }
    } else if (to_zip) {
      // Checkout mode: address passed directly
      if (!to_city || !to_state) throw new Error('to_city and to_state are required')
      toAddr = { name: 'Customer', street1: to_street || '', city: to_city, state: to_state, zip: to_zip }

      // Look up weights from cart item IDs if provided
      const itemIds = Array.isArray(cart) ? cart.map((i: any) => i.id) : []
      if (itemIds.length) {
        const { data: items } = await supabase.from('items').select('weight_oz').in('id', itemIds)
        if (items?.length) {
          weightOz = items.reduce((sum: number, i: any) => sum + (parseFloat(i.weight_oz) || 48), 0)
        }
      }
    } else {
      throw new Error('Provide either order_id or to_zip/to_city/to_state')
    }

    const apiKey = Deno.env.get('EASYPOST_API_KEY')
    if (!apiKey) throw new Error('EASYPOST_API_KEY secret is not set')

    const shipment = {
      to_address: { ...toAddr, country: 'US' },
      from_address: {
        name:    Deno.env.get('SHIP_FROM_NAME')   || "Jalen's Woodshop",
        street1: Deno.env.get('SHIP_FROM_STREET') || '',
        city:    Deno.env.get('SHIP_FROM_CITY')   || 'Durham',
        state:   Deno.env.get('SHIP_FROM_STATE')  || 'NC',
        zip:     Deno.env.get('SHIP_FROM_ZIP')    || '27701',
        country: 'US',
      },
      parcel: {
        weight: weightOz, // oz
        length: 14,
        width:  10,
        height: 6,
      },
    }

    const epRes = await fetch('https://api.easypost.com/v2/shipments', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Basic ' + btoa(apiKey + ':'),
      },
      body: JSON.stringify({ shipment }),
    })

    const epData = await epRes.json()
    if (!epRes.ok) throw new Error(epData.error?.message || 'EasyPost API error')

    // Filter to FedEx only, pick cheapest
    const fedexRates = (epData.rates || [])
      .filter((r: any) => r.carrier?.toLowerCase().includes('fedex'))
      .sort((a: any, b: any) => parseFloat(a.rate) - parseFloat(b.rate))

    if (!fedexRates.length) throw new Error('No FedEx rates available for this address')

    const best = fedexRates[0]
    const rate = {
      carrier:       best.carrier,
      service:       best.service,
      rate:          best.rate,
      delivery_days: best.delivery_days,
    }

    return new Response(
      JSON.stringify({ rates: [rate] }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
