-- Push notification subscriptions for Jalen's To-Dos PWA
create table if not exists push_subscriptions (
  id         uuid default gen_random_uuid() primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now(),
  unique (user_id, endpoint)
);

alter table push_subscriptions enable row level security;

create policy "Users manage own push subscriptions"
  on push_subscriptions for all
  using (auth.uid() = user_id);
