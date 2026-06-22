// @ts-nocheck — Deno runtime
// supabase/functions/calc-delivery/index.ts
// Calculates driving distance from the seller's address to the customer's address
// and returns a delivery fee at $2.50/mile (rounded to nearest dollar).
// The origin address is stored as a secret and never exposed to the browser.
//
// Deploy: supabase functions deploy calc-delivery --no-verify-jwt
// Secrets needed:
//   supabase secrets set DELIVERY_ORIGIN="218 Hocutt Road Durham NC 27703"
//   supabase secrets set GMAPS_SERVER_KEY=AIza...  (server-side key, no HTTP referrer restriction)

import { corsHeaders } from '../_shared/cors.ts'

const RATE_PER_MILE = 2.50
const MAX_MILES     = 30

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { street, city, state, zip } = await req.json()
    if (!city || !state || !zip) throw new Error('city, state, and zip are required')

    const apiKey = Deno.env.get('GMAPS_SERVER_KEY')
    if (!apiKey) throw new Error('GMAPS_SERVER_KEY secret is not set')

    const origin = Deno.env.get('DELIVERY_ORIGIN') || 'Durham, NC 27703, USA'
    const destination = [street, city, state, zip].filter(Boolean).join(', ') + ', USA'

    const url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
      + '?origins=' + encodeURIComponent(origin)
      + '&destinations=' + encodeURIComponent(destination)
      + '&mode=driving'
      + '&units=imperial'
      + '&key=' + apiKey

    const res  = await fetch(url)
    const data = await res.json()

    if (data.status !== 'OK') throw new Error('Distance Matrix error: ' + data.status)

    const element = data.rows?.[0]?.elements?.[0]
    if (!element || element.status !== 'OK') throw new Error('Could not calculate distance to that address')

    const meters = element.distance.value
    const miles  = meters / 1609.344

    if (miles > MAX_MILES) {
      return new Response(
        JSON.stringify({ error: `Sorry, your address is ${miles.toFixed(1)} miles away — outside our ${MAX_MILES}-mile delivery area.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const fee = Math.round(miles * RATE_PER_MILE)

    return new Response(
      JSON.stringify({ fee, miles: parseFloat(miles.toFixed(1)) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
