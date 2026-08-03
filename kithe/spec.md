# Kithe — v1 Build Specification

## 1. Product Overview

### Problem
Habit trackers handle binary behaviors ("did I run today?") well, but personal growth goals are fuzzy, slow, and subjective. People who want to become more patient, empathetic, confident, or disciplined have no good way to see whether they're actually changing over time.

### Solution
A tracker built for *qualitative* goals, using three complementary measurement methods (self-ratings, journaling, and concrete moment logging), a flexible check-in cadence chosen per goal, and lightweight AI insights that surface patterns the user can't see themselves.

### Target user
Anyone doing intentional self-improvement: therapy clients, journalers, self-help readers, people with New Year's resolutions that aren't gym memberships. No niche assumed; UX must be approachable for non-technical users.

### v1 success criteria
- A new user can create a goal and complete their first check-in in under 2 minutes.
- A returning user can complete a daily check-in in under 30 seconds.
- After 2 weeks of use, the progress chart and AI insights make growth (or stagnation) visibly legible.


## 3. Core Concepts & Data Model

### Concepts
- **Goal** — a self-development aim (e.g., "Become more patient"). Has a user-chosen cadence, an optional "why" statement, and a color/icon.
- **Check-in** — a single tracking entry against a goal. Contains any combination of: a rating, a journal reflection, and one or more logged moments.
- **Moment** — a concrete real-world instance ("Stayed calm when my flight was delayed 3 hours"), tagged as a **win** or a **struggle**.
- **Insight** — an AI-generated observation about a goal, produced periodically (see §7).
- **Streak** — consecutive on-schedule check-ins per goal, respecting that goal's cadence.

### Supabase schema (SQL)

```sql
-- Enable UUID generation
create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'America/New_York',
  reminder_time time,                    -- preferred daily reminder time
  push_subscription jsonb,               -- Web Push subscription object
  created_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,                   -- "Become more patient"
  why text,                              -- optional motivation statement
  color text not null default '#6366f1',
  icon text not null default 'sparkles', -- lucide icon name
  cadence text not null check (cadence in ('daily','weekly','custom')),
  custom_days int[] default null,        -- for 'custom': 0=Sun..6=Sat
  is_archived boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  checkin_date date not null,            -- the day it counts for (user's tz)
  rating smallint check (rating between 1 and 10),  -- nullable
  reflection text,                       -- nullable journal entry
  prompt_used text,                      -- the reflection prompt shown, if any
  created_at timestamptz not null default now(),
  unique (goal_id, checkin_date)         -- one check-in per goal per day
);

create table public.moments (
  id uuid primary key default gen_random_uuid(),
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('win','struggle')),
  description text not null,
  created_at timestamptz not null default now()
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  body text not null,                    -- the insight text (markdown)
  kind text not null check (kind in ('pattern','nudge','celebration')),
  seen boolean not null default false,
  created_at timestamptz not null default now()
);
```

### Row Level Security (required)
Enable RLS on all tables. Every table gets policies restricting `select/insert/update/delete` to rows where `user_id = auth.uid()` (for `profiles`, `id = auth.uid()`). No public access to anything.

---

## 4. Feature Requirements

### 4.1 Onboarding
1. Sign in (magic link or Google).
2. Guided first-goal creation:
   - Free-text title, with 8 tappable starter suggestions: *patience, empathy, confidence, discipline, active listening, gratitude, calm under pressure, assertiveness*.
   - Optional "Why does this matter to you?" (stored in `goals.why`; resurfaced later by the app and used in AI insight context).
   - Cadence picker: **Daily / Weekly / Custom days** — explained in one sentence each. Default: daily.
3. Immediately flow into the first check-in so the user experiences the core loop before leaving onboarding.
4. After first check-in, soft-prompt PWA install ("Add Inward to your home screen") and, only if installed/accepted, offer push reminders.

### 4.2 Check-in flow (the core loop)
A check-in screen for one goal, all sections optional but at least one required to save:

1. **Rating (1–10 slider)** — labeled with the goal title: "How patient did you feel today?" Ends anchored: 1 = "Struggled a lot", 10 = "At my best".
2. **Moments** — quick-add list. Each moment: win/struggle toggle + one-line description. Multiple allowed.
3. **Reflection** — free-text journal area with a rotating prompt (e.g., "What tested your patience today, and what did you do?"). Store the prompt shown in `checkin.prompt_used`. Prompts come from a static local list of ~20 per goal-agnostic templates that interpolate the goal title; no AI call needed here.
4. Save → celebratory micro-animation + streak update.

**Speed requirement:** rating-only check-in must be achievable in ≤3 taps from the home screen.

**Backfill:** users may create/edit check-ins for past dates (up to 7 days back) via the calendar view. Backfilled check-ins count toward streak repair.

### 4.3 Home / Today screen
- List of active goals as cards showing: icon/color, title, current streak (🔥 n), today's status (done / due / not scheduled today).
- One-tap into check-in for any due goal.
- A "Today" header summarizing e.g. "2 of 3 check-ins done".
- Unseen insights surface as a dismissible banner/card at top.

### 4.4 Goal detail & progress
Per goal:
- **Rating chart** — line/area chart of ratings over time with selectable ranges (2w / 1m / 3m / all). Overlay a 7-day rolling average line. Handle sparse data gracefully (gaps, not zeroes).
- **Momentum stat** — rolling-average delta vs. previous period ("↑ 0.8 vs last month").
- **Moments feed** — reverse-chron list of wins/struggles, filterable by kind. Win/struggle ratio shown for selected range.
- **Reflections journal** — reverse-chron, searchable full-text (Postgres `ilike` is fine for v1).
- **Insights history** for this goal.
- Edit goal (title, why, cadence, color/icon), archive goal.

### 4.5 Streaks & gamification
- Streak = consecutive *scheduled* check-in days completed, per goal. Weekly-cadence goals streak in weeks; custom-cadence goals only count their scheduled days.
- **Grace rule:** one missed scheduled day per 14 does not break the streak (shown as a "streak freeze" used automatically). Prevents the demoralizing all-or-nothing cliff.
- Milestone badges at 3, 7, 14, 30, 60, 100 scheduled check-ins per goal, plus account-level "total check-ins" badges. Store computed on the fly (no extra table needed for v1; derive from data).
- Subtle confetti on milestones. Tone: warm and encouraging, never guilt-tripping. Copy must never shame a broken streak ("Fresh start today" not "You broke your streak").

### 4.6 Multiple goals
- Soft cap of 5 active goals with a gentle warning beyond 3 ("Growth works best focused — sure you want a 4th?"). Archive is always available and preserves all data.

---

## 5. Screens (v1 complete list)

1. **Auth** (magic link / Google)
2. **Onboarding wizard** (3 steps, skippable after first goal)
3. **Home / Today** (goal cards, due states, insight banner)
4. **Check-in** (rating + moments + reflection)
5. **Goal detail** (chart, momentum, moments, reflections, insights, edit/archive)
6. **Calendar view** (month grid per goal or all-goals; tap a day to view/backfill)
7. **Insights inbox** (all insights across goals, unread badges)
8. **Settings** (profile, timezone, reminder time, push toggle, export data as JSON, delete account)

Navigation: bottom tab bar (mobile) — Today / Calendar / Insights / Settings.

---

## 6. Reminders & Push Notifications

- Service worker handles `push` and `notificationclick` events; clicking opens the relevant check-in.
- User grants permission only via explicit opt-in in Settings or the post-install prompt — never on first page load.
- Store the `PushSubscription` JSON in `profiles.push_subscription`.
- A scheduled Supabase Edge Function (cron, runs every 15 min) finds users whose local `reminder_time` matches and who have a due, incomplete check-in today, and sends a push via `web-push` (VAPID keys in Supabase secrets).
- Notification copy rotates and references the goal: "A moment for patience? Your check-in takes 30 seconds."
- Fallback when push is unavailable (iOS not installed, permission denied): show an in-app "due" state only. Do not nag.

---

## 7. AI Insights (Lightweight)

**Scope: patterns and nudges only. No chat interface. No coaching conversations in v1.**

### Generation
- Supabase Edge Function `generate-insights`, triggered weekly per user (cron) and on-demand at most once/day via a "Refresh insights" button.
- Input per goal: last 30 days of ratings, moment descriptions + kinds, and reflections; plus the goal's `why`.
- Calls Anthropic API (Claude, small/fast model) server-side. **API key lives in Supabase secrets, never shipped to client.**
- Prompt instructs the model to return strict JSON: 1–3 insights per goal, each `{kind: "pattern"|"nudge"|"celebration", body: string ≤ 280 chars}`.
- Minimum data threshold: skip goals with < 5 check-ins in the window (show "Keep checking in — insights unlock after 5 entries").

### Insight kinds & examples
- **pattern**: "Your patience ratings dip on Mondays — 6 of your last 8 'struggle' moments happened then."
- **nudge**: "You haven't logged a win for empathy in 10 days, but your ratings are steady. Try capturing one small moment this week."
- **celebration**: "Your 7-day average is up 1.4 points this month — your reflections mention 'pausing before reacting' four times. It's working."

### Guardrails
- Insights are observational, never diagnostic or clinical. The system prompt must forbid mental-health diagnoses, therapy-style advice, and alarmist language.
- If reflections contain signals of crisis/self-harm, the function returns no AI insight for that goal and the app shows a supportive static message with a suggestion to reach out to a professional or trusted person.
- All insight text is stored; nothing streams to the client from the AI directly.

---

## 8. PWA Requirements Checklist

- [ ] `manifest.json`: name, short_name, theme/background colors, `display: standalone`, maskable icons (192, 512), screenshots for richer install UI.
- [ ] Service worker: precache app shell; runtime cache-first for static assets, network-first for Supabase API calls.
- [ ] Offline behavior: app shell loads offline; check-ins created offline are queued in IndexedDB and synced when back online (show a subtle "will sync" indicator). Read views show last-fetched data.
- [ ] Custom install prompt (`beforeinstallprompt` on Android/desktop; instructional sheet for iOS "Share → Add to Home Screen").
- [ ] Push: VAPID keys, subscription lifecycle (renew on `pushsubscriptionchange`).
- [ ] Lighthouse PWA audit passes.

---

## 9. Design Direction

- Mobile-first, thumb-reachable actions, generous tap targets.
- Mood: calm, warm, growth-oriented. Think journal, not dashboard. Soft gradients per-goal color, rounded cards, gentle motion.
- Dark mode from day one (system preference + manual toggle).
- Accessibility: WCAG AA contrast, full keyboard nav on desktop, `prefers-reduced-motion` respected (disables confetti).
- Empty states are teaching moments — every empty screen explains what will appear there and how.

---

## 10. Edge Cases & Rules

- **Timezones:** `checkin_date` is computed in the user's stored timezone. Changing timezone never retroactively rewrites past dates.
- **One check-in per goal per day** (unique constraint). Re-opening the same day edits the existing check-in.
- **Cadence changes** apply going forward only; historical streaks are recomputed against the schedule that was active (v1 simplification: recompute against current cadence is acceptable — note this in code comments).
- **Deletes:** deleting a goal requires typed confirmation and cascades. Archive is the promoted, reversible path.
- **Data export:** Settings → export downloads all user data as JSON.
- **Rate limits:** on-demand insight refresh limited to 1/day/user (enforce in Edge Function).

---

## 11. Out of Scope for v1 (explicit)

- Social features, sharing, or comparing with others
- AI chat coach / conversational interface
- Native apps or app-store distribution
- Habit-style binary tasks or to-do lists
- Wearable / health-data integrations
- Payments or premium tiers

---
