// Daily digest + day-of reminders for Jalen's To-Dos.
// Called by a Supabase cron job — authorize with SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push';

Deno.serve(async (req) => {
  // Only allow calls authenticated with the service role key (cron jobs)
  const expectedKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = (req.headers.get('Authorization') || '').replace('Bearer ', '');
  if (auth !== expectedKey) {
    return new Response('Unauthorized', { status: 401 });
  }

  const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const VAPID_SUBJECT     = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@mcg-works.com';

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Today in YYYY-MM-DD (UTC). Cron fires at 13:00 UTC = 9 AM Eastern.
  const today = new Date().toISOString().split('T')[0];

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*');

  if (!subscriptions?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no subscriptions' }));
  }

  let totalSent = 0;

  for (const sub of subscriptions) {
    const { data: tasks } = await supabase
      .from('vibecheck_tasks')
      .select('id, title')
      .eq('user_id', sub.user_id)
      .eq('due', today)
      .eq('done', false);

    if (!tasks?.length) continue;

    const count = tasks.length;
    const title = "📋 Jalen's To-Dos";
    let body: string;
    if (count === 1) {
      body = `1 task due today: ${tasks[0].title}`;
    } else if (count <= 3) {
      body = `${count} tasks due today:\n` + tasks.map(t => `• ${t.title}`).join('\n');
    } else {
      body = `${count} tasks due today`;
    }

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body, url: '/todo/' })
      );
      totalSent++;
    } catch (err: unknown) {
      // Subscription expired — clean it up
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }

  return new Response(JSON.stringify({ sent: totalSent }));
});
