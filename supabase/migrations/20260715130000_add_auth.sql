-- Migration: add user_id + update RLS for multi-user Supabase Auth
-- Prerequisites:
--   1. Enable the Email provider under Authentication → Providers in the Supabase dashboard.
--   2. Run the previous two migrations first if you haven't.

-- Add per-user ownership column (nullable so existing rows aren't broken)
alter table vibecheck_tasks
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Drop the old open-access anon policy
drop policy if exists "vibecheck_anon_all" on vibecheck_tasks;

-- Authenticated users can only see and modify their own tasks
create policy "vibecheck_user_all"
  on vibecheck_tasks
  for all
  to authenticated
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
