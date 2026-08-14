// @ts-nocheck — Deno runtime; not checked by Node/tsc
// supabase/functions/project-tasks/index.ts
// Supabase Edge Function — client-facing project kanban board (tasks + comments)
// Deploy: supabase functions deploy project-tasks
// Env vars needed: SUPABASE_URL, SERVICE_ROLE_KEY, ADMIN_EMAILS (comma-separated allowlist)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { escapeLikePattern } from '../_shared/like.ts'

const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' }

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

    // ---- Verify a client's proposal code grants access to proposal_id ----
    async function verifyClientAccess(proposal_id: string, code: string) {
      if (!proposal_id || !code) return null
      const { data } = await supabase
        .from('proposal_codes')
        .select('proposal_path, client_name')
        .ilike('code', escapeLikePattern(code))
        .eq('proposal_path', proposal_id)
        .eq('is_active', true)
        .maybeSingle()
      return data
    }

    // ---- Verify the request carries a valid, allow-listed admin session ----
    async function verifyAdmin() {
      const authHeader = req.headers.get('Authorization') ?? ''
      const jwt = authHeader.replace(/^Bearer\s+/i, '')
      if (!jwt) return null

      const { data: userData, error } = await supabase.auth.getUser(jwt)
      if (error || !userData?.user?.email) return null

      const allowList = (Deno.env.get('ADMIN_EMAILS') ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)

      if (!allowList.includes(userData.user.email.toLowerCase())) return null
      return userData.user
    }

    function denied(status = 403, error = 'Access denied') {
      return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS })
    }

    // ---- Record a 'created' or 'moved' entry in the project activity log ----
    async function logEvent(entry) {
      await supabase.from('project_task_events').insert({
        task_id: entry.task_id,
        proposal_id: entry.proposal_id,
        task_title: entry.task_title,
        event_type: entry.event_type,
        from_status: entry.from_status ?? null,
        to_status: entry.to_status ?? null,
        actor: entry.actor,
      })
    }

    // ---- Email a client per their notification preferences (best-effort, never throws) ----
    async function notifyClient(proposal_id, kind, { task_title, detail }) {
      try {
        const { data: sub } = await supabase
          .from('project_notification_subscriptions')
          .select('email, notify_new_task, notify_task_moved, notify_comment')
          .eq('proposal_id', proposal_id)
          .maybeSingle()

        if (!sub?.email) return
        if (kind === 'new_task' && !sub.notify_new_task) return
        if (kind === 'task_moved' && !sub.notify_task_moved) return
        if (kind === 'comment' && !sub.notify_comment) return

        const resendKey = Deno.env.get('RESEND_API_KEY')
        if (!resendKey) return

        const subject = kind === 'new_task'
          ? `New task for you — ${task_title}`
          : kind === 'task_moved'
            ? `Task update — ${task_title}`
            : `New comment — ${task_title}`

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0b0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:2rem auto;background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1e293b">
    <div style="padding:1.5rem 1.75rem;border-bottom:1px solid #1e293b">
      <div style="font-size:1.2rem;font-weight:700;color:#fff">McG Works — Project Board</div>
    </div>
    <div style="padding:1.75rem;color:#e2e8f0">
      <p style="margin:0 0 1rem;font-size:1rem"><strong>${task_title}</strong></p>
      <p style="margin:0 0 1.5rem;opacity:.8;font-size:.92rem">${detail}</p>
      <a href="https://mcg-works.com/project" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:.65rem 1.5rem;border-radius:8px;font-size:.88rem;font-weight:700">View Board</a>
    </div>
  </div>
</body>
</html>`

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'projects@mcg-works.com', to: [sub.email], subject, html }),
        })
      } catch {
        // Non-fatal — never block the underlying action if email fails
      }
    }

    // =========================================
    // CLIENT ACTIONS (require proposal_id + code)
    // =========================================

    if (action === 'list') {
      const { proposal_id, code } = body
      const access = await verifyClientAccess(proposal_id, code)
      if (!access) return denied()

      const { data, error } = await supabase
        .from('project_tasks')
        .select('*')
        .eq('proposal_id', proposal_id)
        .order('status', { ascending: true })
        .order('sort_order', { ascending: true })

      if (error) return denied(500, 'Failed to load tasks')

      return new Response(
        JSON.stringify({ tasks: data, client_name: access.client_name }),
        { headers: JSON_HEADERS }
      )
    }

    if (action === 'list_events') {
      const { proposal_id, code } = body
      const access = await verifyClientAccess(proposal_id, code)
      if (!access) return denied()

      const { data, error } = await supabase
        .from('project_task_events')
        .select('*')
        .eq('proposal_id', proposal_id)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) return denied(500, 'Failed to load activity log')

      return new Response(JSON.stringify({ events: data }), { headers: JSON_HEADERS })
    }

    if (action === 'get_subscription') {
      const { proposal_id, code } = body
      const access = await verifyClientAccess(proposal_id, code)
      if (!access) return denied()

      const { data, error } = await supabase
        .from('project_notification_subscriptions')
        .select('email, notify_new_task, notify_task_moved, notify_comment')
        .eq('proposal_id', proposal_id)
        .maybeSingle()

      if (error) return denied(500, 'Failed to load notification settings')

      return new Response(
        JSON.stringify({ subscription: data ?? { email: '', notify_new_task: false, notify_task_moved: false, notify_comment: false } }),
        { headers: JSON_HEADERS }
      )
    }

    if (action === 'update_subscription') {
      const { proposal_id, code, email, notify_new_task, notify_task_moved, notify_comment } = body
      const access = await verifyClientAccess(proposal_id, code)
      if (!access) return denied()
      if (!email) return denied(400, 'Email is required')

      const { data, error } = await supabase
        .from('project_notification_subscriptions')
        .upsert(
          {
            proposal_id,
            email,
            notify_new_task: !!notify_new_task,
            notify_task_moved: !!notify_task_moved,
            notify_comment: !!notify_comment,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'proposal_id' }
        )
        .select()
        .single()

      if (error) return denied(500, 'Failed to save notification settings')

      return new Response(JSON.stringify({ subscription: data }), { headers: JSON_HEADERS })
    }

    if (action === 'list_comments') {
      const { task_id, proposal_id, code } = body
      const access = await verifyClientAccess(proposal_id, code)
      if (!access) return denied()

      const { data, error } = await supabase
        .from('project_task_comments')
        .select('*')
        .eq('task_id', task_id)
        .eq('proposal_id', proposal_id)
        .order('created_at', { ascending: true })

      if (error) return denied(500, 'Failed to load comments')

      return new Response(JSON.stringify({ comments: data }), { headers: JSON_HEADERS })
    }

    if (action === 'create_comment') {
      const { task_id, proposal_id, code, content } = body
      if (!task_id || !content) return denied(400, 'Missing required fields')
      const access = await verifyClientAccess(proposal_id, code)
      if (!access) return denied()

      const { data, error } = await supabase
        .from('project_task_comments')
        .insert({
          task_id,
          proposal_id,
          author_name: access.client_name ?? proposal_id,
          is_mcg: false,
          content,
        })
        .select()
        .single()

      if (error) return denied(500, 'Failed to post comment')

      return new Response(JSON.stringify({ comment: data }), { headers: JSON_HEADERS })
    }

    if (action === 'update_card' || action === 'move_card') {
      const { task_id, proposal_id, code } = body
      const access = await verifyClientAccess(proposal_id, code)
      if (!access) return denied()

      // Clients may only touch cards assigned to them
      const { data: task } = await supabase
        .from('project_tasks')
        .select('id, assignee, title, status')
        .eq('id', task_id)
        .eq('proposal_id', proposal_id)
        .maybeSingle()

      if (!task || task.assignee !== 'client') return denied()

      const updates = { updated_at: new Date().toISOString() }
      if (action === 'update_card') {
        const { title, description } = body
        if (title !== undefined) updates.title = title
        if (description !== undefined) updates.description = description
      } else {
        const { new_status, new_sort_order } = body
        if (!['todo', 'doing', 'done'].includes(new_status)) return denied(400, 'Invalid status')
        updates.status = new_status
        updates.sort_order = new_sort_order ?? 0
      }

      const { data, error } = await supabase
        .from('project_tasks')
        .update(updates)
        .eq('id', task_id)
        .select()
        .single()

      if (error) return denied(500, 'Failed to update task')

      if (action === 'move_card' && data.status !== task.status) {
        await logEvent({
          task_id: data.id,
          proposal_id,
          task_title: data.title,
          event_type: 'moved',
          from_status: task.status,
          to_status: data.status,
          actor: access.client_name ?? proposal_id,
        })
      }

      return new Response(JSON.stringify({ task: data }), { headers: JSON_HEADERS })
    }

    // =========================================
    // ADMIN ACTIONS (require Bearer Supabase JWT + ADMIN_EMAILS allowlist)
    // =========================================

    if (action?.startsWith('admin_')) {
      const admin = await verifyAdmin()
      if (!admin) return denied(401, 'Admin authentication required')

      if (action === 'admin_list_projects') {
        const { data, error } = await supabase
          .from('proposal_codes')
          .select('proposal_path, client_name, code')
          .eq('is_active', true)
          .order('client_name', { ascending: true })

        if (error) return denied(500, 'Failed to load projects')
        return new Response(JSON.stringify({ projects: data }), { headers: JSON_HEADERS })
      }

      if (action === 'admin_list_tasks') {
        const { proposal_id } = body
        const { data, error } = await supabase
          .from('project_tasks')
          .select('*')
          .eq('proposal_id', proposal_id)
          .order('status', { ascending: true })
          .order('sort_order', { ascending: true })

        if (error) return denied(500, 'Failed to load tasks')
        return new Response(JSON.stringify({ tasks: data }), { headers: JSON_HEADERS })
      }

      if (action === 'admin_create_task') {
        const { proposal_id, title, description, status, assignee, sort_order } = body
        if (!proposal_id || !title) return denied(400, 'Missing required fields')

        const { data, error } = await supabase
          .from('project_tasks')
          .insert({
            proposal_id,
            title,
            description: description ?? null,
            status: status ?? 'todo',
            assignee: assignee ?? 'mcg',
            sort_order: sort_order ?? 0,
          })
          .select()
          .single()

        if (error) return denied(500, 'Failed to create task')

        await logEvent({
          task_id: data.id,
          proposal_id,
          task_title: data.title,
          event_type: 'created',
          to_status: data.status,
          actor: 'McG Works',
        })

        if (data.assignee === 'client') {
          await notifyClient(proposal_id, 'new_task', {
            task_title: data.title,
            detail: `A new task was added to your board: "${data.title}".`,
          })
        }

        return new Response(JSON.stringify({ task: data }), { headers: JSON_HEADERS })
      }

      if (action === 'admin_update_task') {
        const { task_id, title, description, status, assignee, sort_order } = body
        if (!task_id) return denied(400, 'Missing task_id')

        const { data: existing } = await supabase
          .from('project_tasks')
          .select('proposal_id, status')
          .eq('id', task_id)
          .maybeSingle()

        const updates = { updated_at: new Date().toISOString() }
        if (title !== undefined) updates.title = title
        if (description !== undefined) updates.description = description
        if (status !== undefined) updates.status = status
        if (assignee !== undefined) updates.assignee = assignee
        if (sort_order !== undefined) updates.sort_order = sort_order

        const { data, error } = await supabase
          .from('project_tasks')
          .update(updates)
          .eq('id', task_id)
          .select()
          .single()

        if (error) return denied(500, 'Failed to update task')

        if (existing && status !== undefined && status !== existing.status) {
          await logEvent({
            task_id,
            proposal_id: existing.proposal_id,
            task_title: data.title,
            event_type: 'moved',
            from_status: existing.status,
            to_status: status,
            actor: 'McG Works',
          })

          await notifyClient(existing.proposal_id, 'task_moved', {
            task_title: data.title,
            detail: `"${data.title}" moved from ${existing.status} to ${status}.`,
          })
        }

        return new Response(JSON.stringify({ task: data }), { headers: JSON_HEADERS })
      }

      if (action === 'admin_delete_task') {
        const { task_id } = body
        if (!task_id) return denied(400, 'Missing task_id')

        const { error } = await supabase.from('project_tasks').delete().eq('id', task_id)
        if (error) return denied(500, 'Failed to delete task')
        return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS })
      }

      if (action === 'admin_list_events') {
        const { proposal_id } = body
        if (!proposal_id) return denied(400, 'Missing proposal_id')

        const { data, error } = await supabase
          .from('project_task_events')
          .select('*')
          .eq('proposal_id', proposal_id)
          .order('created_at', { ascending: false })
          .limit(100)

        if (error) return denied(500, 'Failed to load activity log')
        return new Response(JSON.stringify({ events: data }), { headers: JSON_HEADERS })
      }

      if (action === 'admin_get_subscription') {
        const { proposal_id } = body
        if (!proposal_id) return denied(400, 'Missing proposal_id')

        const { data, error } = await supabase
          .from('project_notification_subscriptions')
          .select('email, notify_new_task, notify_task_moved, notify_comment')
          .eq('proposal_id', proposal_id)
          .maybeSingle()

        if (error) return denied(500, 'Failed to load notification settings')
        return new Response(
          JSON.stringify({ subscription: data ?? { email: '', notify_new_task: false, notify_task_moved: false, notify_comment: false } }),
          { headers: JSON_HEADERS }
        )
      }

      if (action === 'admin_send_invite') {
        const { proposal_id, to_email, subject, body: emailBody } = body
        if (!proposal_id) return denied(400, 'Missing proposal_id')
        if (!to_email || !EMAIL_RE.test(to_email)) return denied(400, 'A valid recipient email is required')
        if (!subject || !emailBody) return denied(400, 'Subject and body are required')

        const resendKey = Deno.env.get('RESEND_API_KEY')
        if (!resendKey) return denied(500, 'Email is not configured')

        // Escape first, then linkify — safe since URL characters survive HTML-escaping untouched
        const bodyHtml = escapeHtml(emailBody).replace(
          /(https?:\/\/[^\s<]+)/g,
          '<a href="$1" style="color:#3b82f6">$1</a>'
        )

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0b0f14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:2rem auto;background:#111827;border-radius:12px;overflow:hidden;border:1px solid #1e293b">
    <div style="padding:1.5rem 1.75rem;border-bottom:1px solid #1e293b">
      <div style="font-size:1.2rem;font-weight:700;color:#fff">McG Works</div>
    </div>
    <div style="padding:1.75rem;color:#e2e8f0;white-space:pre-wrap;font-size:.95rem;line-height:1.6">${bodyHtml}</div>
  </div>
</body>
</html>`

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'projects@mcg-works.com', to: [to_email], subject, html }),
        })

        if (!res.ok) return denied(500, 'Failed to send invite email')
        return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS })
      }

      if (action === 'admin_list_comments') {
        const { task_id } = body
        const { data, error } = await supabase
          .from('project_task_comments')
          .select('*')
          .eq('task_id', task_id)
          .order('created_at', { ascending: true })

        if (error) return denied(500, 'Failed to load comments')
        return new Response(JSON.stringify({ comments: data }), { headers: JSON_HEADERS })
      }

      if (action === 'admin_create_comment') {
        const { task_id, proposal_id, content } = body
        if (!task_id || !proposal_id || !content) return denied(400, 'Missing required fields')

        const { data, error } = await supabase
          .from('project_task_comments')
          .insert({ task_id, proposal_id, author_name: 'McG Works', is_mcg: true, content })
          .select()
          .single()

        if (error) return denied(500, 'Failed to post comment')

        const { data: parentTask } = await supabase
          .from('project_tasks')
          .select('title')
          .eq('id', task_id)
          .maybeSingle()

        await notifyClient(proposal_id, 'comment', {
          task_title: parentTask?.title ?? 'Task',
          detail: `McG Works left a new comment: "${content}"`,
        })

        return new Response(JSON.stringify({ comment: data }), { headers: JSON_HEADERS })
      }

      return denied(400, 'Unknown admin action')
    }

    return denied(400, 'Unknown action')
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers: JSON_HEADERS })
  }
})
