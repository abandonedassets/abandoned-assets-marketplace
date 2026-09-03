import { createFileRoute } from '@tanstack/react-router'
import { createClient } from '@supabase/supabase-js'
import { createHmac } from 'crypto'

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/resend'

type StrikeRow = {
  id: string
  pipeline_item_id: string
  zip: string | null
  original_price: number | null
  floor_price: number | null
  counter_offer: number | null
  seller_routing_json: { email?: string; webhook_url?: string; seller_ref?: string } | null
  payload: Record<string, unknown>
  dispatch_attempts: number
}

function signPayload(payload: unknown, secret: string) {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
}

export const Route = createFileRoute('/api/public/hooks/reverse-strike-dispatch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get('apikey')
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response('Unauthorized', { status: 401 })
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        )

        const { data: rows, error } = await supabase
          .from('reverse_strike_queue')
          .select('id,pipeline_item_id,zip,original_price,floor_price,counter_offer,seller_routing_json,payload,dispatch_attempts')
          .eq('status', 'pending')
          .lt('dispatch_attempts', 5)
          .order('created_at', { ascending: true })
          .limit(25)
          .returns<StrikeRow[]>()

        if (error) {
          return Response.json({ ok: false, error: error.message }, { status: 500 })
        }

        const signingSecret = process.env.FLOW_CALLBACK_SECRET || ''
        const senderEmail = process.env.ESCROW_SENDER_EMAIL || 'onboarding@resend.dev'
        const results: Array<{ id: string; status: string; channel: string; error?: string }> = []

        for (const row of rows ?? []) {
          const routing = row.seller_routing_json ?? {}
          const signedPayload = {
            ...row.payload,
            queue_id: row.id,
            signature: signingSecret ? signPayload(row.payload, signingSecret) : null,
          }

          const attempts: Array<{ channel: string; ok: boolean; status?: number; body?: unknown; error?: string }> = []

          // Channel 1: webhook (preferred, server-to-server)
          if (routing.webhook_url) {
            try {
              const r = await fetch(routing.webhook_url, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Signature': signedPayload.signature ?? '',
                  'X-Event': 'reverse_strike',
                },
                body: JSON.stringify(signedPayload),
              })
              const body = await r.text().catch(() => '')
              attempts.push({ channel: 'webhook', ok: r.ok, status: r.status, body: body.slice(0, 500) })
            } catch (e) {
              attempts.push({ channel: 'webhook', ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          }

          // Channel 2: Resend email (fallback or parallel)
          if (routing.email && process.env.LOVABLE_API_KEY && process.env.RESEND_API_KEY) {
            try {
              const subject = `Counter-offer — Asset ${row.zip ?? ''} — $${row.counter_offer ?? 0}`
              const html = `
                <h2>Algorithmic Counter-Offer</h2>
                <p>Market algorithms rejected the asset at <strong>$${row.original_price ?? 0}</strong>.</p>
                <p>Our instant-clear offer is now <strong>$${row.counter_offer ?? 0}</strong>.</p>
                <p>Floor reference: $${row.floor_price ?? 0} · ZIP: ${row.zip ?? '—'}</p>
                <p>Reply <code>ACCEPT ${row.id}</code> to execute, or reply <code>DECLINE ${row.id}</code>.</p>
                <hr/>
                <small>Signature: ${signedPayload.signature ?? 'unsigned'}</small>
              `
              const r = await fetch(`${GATEWAY_URL}/emails`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
                  'X-Connection-Api-Key': process.env.RESEND_API_KEY,
                },
                body: JSON.stringify({
                  from: senderEmail,
                  to: [routing.email],
                  subject,
                  html,
                }),
              })
              const body = await r.json().catch(() => ({}))
              attempts.push({ channel: 'email', ok: r.ok, status: r.status, body })
            } catch (e) {
              attempts.push({ channel: 'email', ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          }

          const anyOk = attempts.some(a => a.ok)
          const nextAttempts = row.dispatch_attempts + 1
          const finalStatus = anyOk ? 'dispatched' : nextAttempts >= 5 ? 'abandoned' : 'pending'

          await supabase
            .from('reverse_strike_queue')
            .update({
              status: finalStatus,
              dispatch_attempts: nextAttempts,
              last_attempt_at: new Date().toISOString(),
              last_response: attempts as unknown as Record<string, unknown>,
              last_error: anyOk ? null : attempts.find(a => a.error)?.error ?? 'no_channel_succeeded',
              dispatched_at: anyOk ? new Date().toISOString() : null,
            })
            .eq('id', row.id)

          const channel = attempts.find(a => a.ok)?.channel ?? attempts[0]?.channel ?? 'none'
          results.push({ id: row.id, status: finalStatus, channel })
        }

        return Response.json({ ok: true, processed: results.length, results })
      },
    },
  },
})
