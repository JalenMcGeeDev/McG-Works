/* Kithe — app.js
 * Vanilla JS PWA. No build step. Supabase (Postgres + Auth) backend.
 * Scope note: this build covers the v1 "core app" — auth, goals, check-ins,
 * streaks, calendar, goal detail (chart/moments/reflections), settings, and
 * a lightweight PWA shell. AI insights and push notifications are out of
 * scope for this pass (see kithe/spec.md §6–7) and can be added later.
 */
(function () {
  'use strict';

  // ── Supabase config (shared McGWorks project; anon key is public/RLS-safe) ─
  const SB_URL = 'https://awccquoyscijmtqtibgr.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Y2NxdW95c2Npam10cXRpYmdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDI0MDUsImV4cCI6MjA4MjM3ODQwNX0.zUBCXRah_oK8P_Q-1sFwZ5altAFUfZMOdBdY-tuXWrE';

  const T = { profiles: 'kithe_profiles', goals: 'kithe_goals', checkins: 'kithe_checkins', moments: 'kithe_moments' };

  const COLORS = ['#6366F1', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6', '#14B8A6'];
  const ICONS  = ['✨', '🧘', '💬', '🎯', '🌱', '🔥', '📚', '🫶', '🧠', '☀️'];
  const SUGGESTIONS = ['Patience', 'Empathy', 'Confidence', 'Discipline', 'Active listening', 'Gratitude', 'Calm under pressure', 'Assertiveness'];
  const MILESTONES = [3, 7, 14, 30, 60, 100];

  const PROMPTS = [
    'What moment today connected most to "{title}"?',
    'What tested you today when it comes to "{title}"?',
    'Where did you notice real progress on "{title}"?',
    'What\u2019s one thing you\u2019re proud of today related to "{title}"?',
    'Describe a moment today that surprised you.',
    'What almost derailed your progress today, and how did you respond?',
    'Who or what helped you show up for "{title}" today?',
    'What would "more of this" have looked like today?',
    'What\u2019s one small win you almost overlooked?',
    'What would you tell a friend who had the day you just had?',
    'Where did an old pattern show up today?',
    'What\u2019s one thing you\u2019d try differently tomorrow?',
  ];

  // ── Auth state / session persistence ────────────────────────────────────
  let session = null;

  function getHeaders(extra) {
    const tok = session ? session.access_token : SB_KEY;
    return Object.assign({ apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, extra || {});
  }
  function saveSession(s) {
    session = s;
    try { localStorage.setItem('kithe_session', JSON.stringify(s)); } catch (_) {}
  }
  function clearSession() {
    session = null;
    try { localStorage.removeItem('kithe_session'); } catch (_) {}
  }
  async function sbSignUp(email, password) {
    const r = await fetch(SB_URL + '/auth/v1/signup', {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || 'Sign up failed');
    return data;
  }
  async function sbSignIn(email, password) {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');
    return data;
  }
  async function sbRefreshToken(refreshToken) {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error('refresh failed');
    return data;
  }
  async function initAuth() {
    try {
      const stored = localStorage.getItem('kithe_session');
      if (!stored) return false;
      const s = JSON.parse(stored);
      if (s.expires_at && (s.expires_at - 60) > Date.now() / 1000) { session = s; return true; }
      if (!s.refresh_token) return false;
      const refreshed = await sbRefreshToken(s.refresh_token);
      saveSession({
        access_token: refreshed.access_token, refresh_token: refreshed.refresh_token,
        expires_at: refreshed.expires_in ? (Date.now() / 1000 + refreshed.expires_in) : null,
        user: refreshed.user,
      });
      return true;
    } catch (_) { clearSession(); return false; }
  }

  // ── Generic Supabase REST helpers ───────────────────────────────────────
  async function sbSelect(table, qs) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, { headers: getHeaders() });
    if (!r.ok) throw new Error('select ' + r.status);
    return r.json();
  }
  async function sbInsert(table, row) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST', headers: getHeaders({ Prefer: 'return=representation' }), body: JSON.stringify(row),
    });
    if (!r.ok) throw new Error('insert ' + r.status);
    const data = await r.json();
    return data[0];
  }
  async function sbPatch(table, id, patch) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: getHeaders({ Prefer: 'return=representation' }), body: JSON.stringify(patch),
    });
    if (!r.ok) throw new Error('patch ' + r.status);
    const data = await r.json();
    return data[0];
  }
  async function sbDelete(table, id) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: getHeaders() });
    if (!r.ok) throw new Error('delete ' + r.status);
  }
  async function sbDeleteWhere(table, column, value) {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}`, { method: 'DELETE', headers: getHeaders() });
    if (!r.ok) throw new Error('delete ' + r.status);
  }
  function isOfflineError(err) {
    return err instanceof TypeError || /network|fetch/i.test(err && err.message || '');
  }

  // ── App state ────────────────────────────────────────────────────────────
  let profile = null;
  let goals = [];
  let checkins = [];
  let moments = [];
  let loading = true;

  let route = 'today'; // today | calendar | settings | goal-detail | checkin | onboarding
  let modal = null;    // { type, ... } or null

  let onboarding = { step: 1, title: '', why: '', cadence: 'daily', customDays: [] };
  let checkinCtx = null;   // { goalId, date, isFirst }
  let checkinForm = null;  // { rating, ratingTouched, moments: [{kind,text}], reflection, promptUsed }
  let goalDetailCtx = { goalId: null, range: '1m', tab: 'moments', momentFilter: 'all', reflectionSearch: '' };
  let calendarCtx = { goalId: 'all', year: null, month: null };
  let settingsForm = null;

  let deferredInstallEvent = null;

  // ── Date / timezone helpers ─────────────────────────────────────────────
  function tz() { return (profile && profile.timezone) || 'America/New_York'; }
  function todayStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function parseLocal(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(iso, n) {
    const d = parseLocal(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  function daysBetween(a, b) {
    return Math.round((parseLocal(b) - parseLocal(a)) / 86400000);
  }
  function formatShort(iso) {
    return parseLocal(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function formatDayLabel(iso) {
    const today = todayStr();
    const diff = daysBetween(iso, today);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return parseLocal(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function weekStart(iso) {
    // Sunday-based week start, matching custom_days encoding (0=Sun..6=Sat)
    const d = parseLocal(iso);
    d.setDate(d.getDate() - d.getDay());
    return toISO(d);
  }

  // ── Cadence / scheduling ─────────────────────────────────────────────────
  function isScheduledOn(goal, iso) {
    if (goal.cadence === 'daily') return true;
    if (goal.cadence === 'custom') return (goal.custom_days || []).includes(parseLocal(iso).getDay());
    return true; // 'weekly' is scheduled every day; the *unit* that matters is the week
  }

  function goalCheckins(goalId) { return checkins.filter((c) => c.goal_id === goalId).sort((a, b) => a.checkin_date < b.checkin_date ? -1 : 1); }
  function checkinOn(goalId, iso) { return checkins.find((c) => c.goal_id === goalId && c.checkin_date === iso); }

  function todayStatus(goal) {
    const today = todayStr();
    if (goal.cadence === 'weekly') {
      const ws = weekStart(today);
      const done = goalCheckins(goal.id).some((c) => weekStart(c.checkin_date) === ws);
      return done ? 'done' : 'due';
    }
    if (!isScheduledOn(goal, today)) return 'not-scheduled';
    return checkinOn(goal.id, today) ? 'done' : 'due';
  }

  // Builds the ordered list of "scheduled units" (date strings for daily/custom,
  // week-start date strings for weekly) from goal creation up to and including today.
  // The window is extended backward to cover any backfilled check-ins that predate
  // the goal's creation timestamp (the 7-day backfill window doesn't check creation date).
  function scheduledUnits(goal) {
    const today = todayStr();
    const goalCreated = toISO(new Date(goal.created_at));
    const earliestCheckin = goalCheckins(goal.id)[0];
    const start = earliestCheckin && earliestCheckin.checkin_date < goalCreated ? earliestCheckin.checkin_date : goalCreated;
    const units = [];
    if (goal.cadence === 'weekly') {
      let w = weekStart(start);
      const lastW = weekStart(today);
      while (w <= lastW) { units.push(w); w = addDays(w, 7); }
    } else {
      let d = start;
      while (d <= today) {
        if (isScheduledOn(goal, d)) units.push(d);
        d = addDays(d, 1);
      }
    }
    return units;
  }

  function isUnitComplete(goal, unit) {
    if (goal.cadence === 'weekly') return goalCheckins(goal.id).some((c) => weekStart(c.checkin_date) === unit);
    return !!checkinOn(goal.id, unit);
  }

  // Streak with a "grace" rule: at most one missed scheduled unit inside any
  // trailing 14-unit window is forgiven (v1 simplification — always evaluated
  // against the goal's *current* cadence, per spec §10).
  function computeStreak(goal) {
    const units = scheduledUnits(goal);
    let streak = 0;
    const forgivenIdx = [];
    for (let i = units.length - 1; i >= 0; i--) {
      if (isUnitComplete(goal, units[i])) { streak++; continue; }
      const windowStart = Math.max(0, i - 13);
      const alreadyForgiven = forgivenIdx.some((j) => j >= windowStart && j <= i);
      if (!alreadyForgiven) { forgivenIdx.push(i); continue; }
      break;
    }
    return streak;
  }

  function totalCompletedCount(goal) {
    return scheduledUnits(goal).filter((u) => isUnitComplete(goal, u)).length;
  }

  // ── DOM builder ──────────────────────────────────────────────────────────
  function h(tag, attrs) {
    const el = document.createElement(tag);
    const kids = Array.prototype.slice.call(arguments, 2);
    for (const k in attrs || {}) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'className') el.className = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (k === 'disabled') el.disabled = !!v;
      else if (k.indexOf('data-') === 0) el.setAttribute(k, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') el[k] = v;
      else el.setAttribute(k, v);
    }
    kids.forEach((kid) => {
      if (kid == null || kid === false) return;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    });
    return el;
  }
  function svg(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    return el;
  }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function mount(el) { const main = document.getElementById('main'); clear(main); main.appendChild(el); }

  // ── Boot ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', boot);
  async function boot() {
    document.addEventListener('click', onDocClick);
    window.addEventListener('online', () => { hideSyncBanner(); flushPendingCheckins(); });
    window.addEventListener('offline', showSyncBanner);
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallEvent = e;
      maybeShowInstallBanner();
    });
    applyTheme();

    const ok = await initAuth();
    if (!ok) { renderAuth(); return; }
    await startApp();
  }

  async function startApp() {
    document.getElementById('auth-overlay').hidden = true;
    document.getElementById('app').hidden = false;
    try {
      await loadAll();
    } catch (err) {
      showErr();
    }
    if (!navigator.onLine) showSyncBanner();
    flushPendingCheckins();
    if (!goals.length) { route = 'onboarding'; renderOnboarding(); }
    else { route = 'today'; renderToday(); }
    updateTabBar();
    maybeShowInstallBanner();
  }

  async function loadAll() {
    const uid = session.user.id;
    let profiles = await sbSelect(T.profiles, `id=eq.${uid}&select=*`);
    if (!profiles.length) {
      profile = await sbInsert(T.profiles, { id: uid, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York' });
    } else {
      profile = profiles[0];
    }
    goals = await sbSelect(T.goals, `user_id=eq.${uid}&order=sort_order.asc,created_at.asc`);
    checkins = await sbSelect(T.checkins, `user_id=eq.${uid}&order=checkin_date.desc`);
    moments = await sbSelect(T.moments, `user_id=eq.${uid}&order=created_at.desc`);
    loading = false;
  }

  // ── Errors / banners ─────────────────────────────────────────────────────
  function showErr() { document.getElementById('save-error').classList.remove('hidden'); }
  function hideErr() { document.getElementById('save-error').classList.add('hidden'); }
  function showSyncBanner() { document.getElementById('sync-banner').classList.remove('hidden'); }
  function hideSyncBanner() { document.getElementById('sync-banner').classList.add('hidden'); }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function maybeShowInstallBanner() {
    const banner = document.getElementById('install-banner');
    if (!banner) return;
    const dismissed = localStorage.getItem('kithe_install_dismissed');
    const hasCheckedIn = checkins.length > 0;
    if (dismissed || isStandalone() || !hasCheckedIn) { banner.classList.add('hidden'); return; }
    if (deferredInstallEvent || isIOS()) banner.classList.remove('hidden');
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  function applyTheme() {
    const mode = localStorage.getItem('kithe_theme') || 'system';
    if (mode === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
  }
  function setTheme(mode) {
    localStorage.setItem('kithe_theme', mode);
    applyTheme();
    if (route === 'settings') renderSettings();
  }

  // ── Confetti ─────────────────────────────────────────────────────────────
  function fireConfetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layer = document.getElementById('confetti-layer');
    const colors = COLORS;
    for (let i = 0; i < 36; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = colors[i % colors.length];
      piece.style.animationDuration = (1.6 + Math.random() * 1.2) + 's';
      piece.style.transform = 'rotate(' + Math.floor(Math.random() * 360) + 'deg)';
      layer.appendChild(piece);
      setTimeout(() => piece.remove(), 3200);
    }
  }

  // ── Navigation ───────────────────────────────────────────────────────────
  function updateTabBar() {
    const bar = document.getElementById('tab-bar');
    const showBar = ['today', 'calendar', 'settings', 'goal-detail'].includes(route);
    bar.classList.toggle('hidden', !showBar);
    ['today', 'calendar', 'settings'].forEach((r) => {
      const el = document.getElementById('tab-' + r);
      el.classList.toggle('active', route === r || (route === 'goal-detail' && r === 'today'));
    });
  }
  function setHeaderActions(nodes) {
    const el = document.getElementById('header-actions');
    clear(el);
    (nodes || []).forEach((n) => el.appendChild(n));
  }
  function backButton(label, action) {
    return h('button', { className: 'header-back', 'data-action': action || 'nav-back' }, '← ' + (label || 'Back'));
  }

  function goTo(r, extra) {
    route = r;
    if (r === 'today') renderToday();
    else if (r === 'calendar') renderCalendar();
    else if (r === 'settings') renderSettings();
    else if (r === 'goal-detail') renderGoalDetail(extra);
    updateTabBar();
  }

  // ── Click dispatcher ─────────────────────────────────────────────────────
  function onDocClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const value = btn.dataset.value;
    switch (action) {
      case 'auth-toggle': authMode = authMode === 'signin' ? 'signup' : 'signin'; authError = ''; renderAuth(); break;
      case 'auth-toggle-signin': authMode = 'signin'; authError = ''; renderAuth(); break;
      case 'auth-submit': doAuth(); break;
      case 'nav': goTo(value); break;
      case 'nav-back': goTo('today'); break;
      case 'dismiss-error': hideErr(); break;
      case 'dismiss-install': localStorage.setItem('kithe_install_dismissed', '1'); document.getElementById('install-banner').classList.add('hidden'); break;
      case 'install-app': doInstall(); break;
      case 'sign-out': doSignOut(); break;

      // Onboarding
      case 'onboarding-suggestion': onboarding.title = value; renderOnboarding(); break;
      case 'onboarding-next': onboarding.step = 2; renderOnboarding(); break;
      case 'onboarding-back-step': onboarding.step = 1; renderOnboarding(); break;
      case 'onboarding-cadence': onboarding.cadence = value; renderOnboarding(); break;
      case 'onboarding-day': toggleDay(onboarding.customDays, Number(value)); renderOnboarding(); break;
      case 'onboarding-finish': finishOnboarding(); break;

      // Goal modal
      case 'open-new-goal': openGoalModal(null); break;
      case 'goal-modal-color': modal.form.color = value; renderModalHost(); break;
      case 'goal-modal-icon': modal.form.icon = value; renderModalHost(); break;
      case 'goal-modal-cadence': modal.form.cadence = value; renderModalHost(); break;
      case 'goal-modal-day': toggleDay(modal.form.customDays, Number(value)); renderModalHost(); break;
      case 'goal-modal-save': saveGoalModal(); break;
      case 'close-modal': modal = null; renderModalHost(); break;

      // Today / goal cards
      case 'open-goal': goTo('goal-detail', { goalId: id }); break;
      case 'open-checkin': openCheckin(id, btn.dataset.date || todayStr()); break;

      // Check-in screen
      case 'checkin-clear-rating': checkinForm.ratingTouched = false; renderCheckin(); break;
      case 'checkin-set-kind': checkinForm.moments[Number(btn.dataset.index)].kind = value; renderCheckin(); break;
      case 'checkin-add-moment': checkinForm.moments.push({ kind: 'win', text: '' }); renderCheckin(); break;
      case 'checkin-remove-moment': checkinForm.moments.splice(Number(id), 1); renderCheckin(); break;
      case 'checkin-save': saveCheckin(); break;
      case 'checkin-cancel': goTo('today'); break;

      // Goal detail
      case 'goal-detail-range': goalDetailCtx.range = value; renderGoalDetail(); break;
      case 'goal-detail-tab': goalDetailCtx.tab = value; renderGoalDetail(); break;
      case 'moment-filter': goalDetailCtx.momentFilter = value; renderGoalDetail(); break;
      case 'goal-detail-edit': openGoalModal(goalDetailCtx.goalId); break;
      case 'goal-detail-archive': archiveGoal(goalDetailCtx.goalId, true); break;
      case 'goal-detail-unarchive': archiveGoal(goalDetailCtx.goalId, false); break;
      case 'goal-detail-delete': openDeleteGoalModal(goalDetailCtx.goalId); break;
      case 'confirm-delete-goal': confirmDeleteGoal(); break;

      // Calendar
      case 'calendar-prev': shiftCalendarMonth(-1); break;
      case 'calendar-next': shiftCalendarMonth(1); break;
      case 'calendar-goal-select': calendarCtx.goalId = value; renderCalendar(); break;
      case 'calendar-day': onCalendarDayClick(btn.dataset.date); break;

      // Settings
      case 'settings-theme': setTheme(value); break;
      case 'settings-save-profile': saveProfile(); break;
      case 'settings-export': exportData(); break;
      case 'settings-manage-archived': openArchivedModal(); break;
      case 'unarchive-goal': archiveGoal(id, false); modal = null; renderModalHost(); goTo('today'); break;
      case 'settings-delete-data': openDeleteAccountModal(); break;
      case 'confirm-delete-data': confirmDeleteAllData(); break;
      default: break;
    }
  }

  function toggleDay(arr, day) {
    const i = arr.indexOf(day);
    if (i === -1) arr.push(day); else arr.splice(i, 1);
  }

  // ── Auth screens ─────────────────────────────────────────────────────────
  let authMode = 'signin';
  let authError = '';

  function renderAuth() {
    const overlay = document.getElementById('auth-overlay');
    overlay.hidden = false;
    clear(overlay);
    const isUp = authMode === 'signup';
    const card = h('div', { className: 'auth-card' },
      h('h1', { className: 'auth-title' }, 'Kithe'),
      h('p', { className: 'auth-subtitle' }, isUp ? 'Create your account' : 'Grow on purpose'),
    );
    if (authError) card.appendChild(h('div', { className: 'auth-error' }, authError));
    card.appendChild(h('div', { className: 'auth-field' },
      h('label', { className: 'auth-label' }, 'Email'),
      h('input', { type: 'email', id: 'auth-email', className: 'auth-input', placeholder: 'you@example.com', autocomplete: 'email' }),
    ));
    card.appendChild(h('div', { className: 'auth-field' },
      h('label', { className: 'auth-label' }, 'Password'),
      h('input', { type: 'password', id: 'auth-password', className: 'auth-input', placeholder: isUp ? 'Create a password' : 'Your password', autocomplete: isUp ? 'new-password' : 'current-password' }),
    ));
    card.appendChild(h('button', { className: 'auth-submit', 'data-action': 'auth-submit' }, isUp ? 'Create account' : 'Sign in'));
    card.appendChild(h('p', { className: 'auth-toggle' },
      isUp ? 'Already have an account? ' : 'Don\u2019t have an account? ',
      h('button', { className: 'auth-toggle-btn', 'data-action': 'auth-toggle' }, isUp ? 'Sign in' : 'Create account'),
    ));
    overlay.appendChild(card);
    setTimeout(() => { const f = overlay.querySelector('.auth-input'); if (f) f.focus(); }, 0);
  }

  async function doAuth() {
    const email = (qs('#auth-email').value || '').trim();
    const password = qs('#auth-password').value || '';
    if (!email || !password) { authError = 'Please fill in all fields.'; renderAuth(); return; }
    const btn = qs('#auth-overlay .auth-submit');
    if (btn) { btn.disabled = true; btn.textContent = authMode === 'signup' ? 'Creating\u2026' : 'Signing in\u2026'; }
    try {
      let data;
      if (authMode === 'signup') {
        data = await sbSignUp(email, password);
        if (!data.access_token) {
          const overlay = document.getElementById('auth-overlay');
          clear(overlay);
          overlay.appendChild(h('div', { className: 'auth-card' },
            h('h1', { className: 'auth-title' }, 'Check your email'),
            h('p', { className: 'auth-subtitle' }, 'A confirmation link was sent to ' + email + '. Click it, then sign in here.'),
            h('button', { className: 'auth-submit', 'data-action': 'auth-toggle-signin' }, 'Back to sign in'),
          ));
          authMode = 'signin';
          return;
        }
      } else {
        data = await sbSignIn(email, password);
      }
      saveSession({
        access_token: data.access_token, refresh_token: data.refresh_token,
        expires_at: data.expires_in ? (Date.now() / 1000 + data.expires_in) : null, user: data.user,
      });
      await startApp();
    } catch (err) {
      authError = err.message || 'Something went wrong. Try again.';
      renderAuth();
    }
  }

  async function doSignOut() {
    if (session) fetch(SB_URL + '/auth/v1/logout', { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + session.access_token } }).catch(() => {});
    clearSession();
    profile = null; goals = []; checkins = []; moments = [];
    document.getElementById('app').hidden = true;
    authMode = 'signin'; authError = '';
    renderAuth();
  }

  async function doInstall() {
    if (deferredInstallEvent) {
      deferredInstallEvent.prompt();
      await deferredInstallEvent.userChoice;
      deferredInstallEvent = null;
      document.getElementById('install-banner').classList.add('hidden');
      return;
    }
    if (isIOS()) {
      modal = { type: 'ios-install' };
      renderModalHost();
    }
  }

  // ── Onboarding ───────────────────────────────────────────────────────────
  function renderOnboarding() {
    route = 'onboarding';
    updateTabBar();
    setHeaderActions([]);
    const wrap = h('div', { className: 'onboarding-step' },
      h('div', { className: 'onboarding-progress' },
        h('span', { className: onboarding.step >= 1 ? 'done' : '' }),
        h('span', { className: onboarding.step >= 2 ? 'done' : '' }),
      ),
    );
    if (onboarding.step === 1) {
      wrap.appendChild(h('h2', { className: 'section-title' }, 'What do you want to grow?'));
      wrap.appendChild(h('p', { className: 'section-sub' }, 'Pick a starting point or write your own.'));
      wrap.appendChild(h('div', { className: 'chip-row', style: 'margin-bottom:18px' },
        ...SUGGESTIONS.map((s) => h('button', { className: 'chip' + (onboarding.title === s ? ' selected' : ''), 'data-action': 'onboarding-suggestion', 'data-value': s }, s)),
      ));
      const field = h('div', { className: 'field' },
        h('label', {}, 'Goal title'),
        h('input', { type: 'text', id: 'ob-title', value: onboarding.title, placeholder: 'e.g. Become more patient' }),
      );
      wrap.appendChild(field);
      const next = h('button', { className: 'btn btn-primary btn-block', 'data-action': 'onboarding-next' }, 'Continue');
      wrap.appendChild(next);
      mount(wrap);
      const input = qs('#ob-title');
      input.addEventListener('input', () => { onboarding.title = input.value; });
      input.focus();
      ensureFab();
    } else {
      const c = onboarding.cadence;
      wrap.appendChild(h('h2', { className: 'section-title' }, 'How often will you check in?'));
      wrap.appendChild(h('p', { className: 'section-sub' }, '"' + (onboarding.title || 'Your goal') + '"'));
      wrap.appendChild(cadenceOption('daily', c, 'Daily', 'A quick check-in every day.', 'onboarding-cadence'));
      wrap.appendChild(cadenceOption('weekly', c, 'Weekly', 'One check-in sometime each week.', 'onboarding-cadence'));
      wrap.appendChild(cadenceOption('custom', c, 'Custom days', 'Pick specific days of the week.', 'onboarding-cadence'));
      if (c === 'custom') wrap.appendChild(dayPicker(onboarding.customDays, 'onboarding-day'));
      const whyField = h('div', { className: 'field', style: 'margin-top:16px' },
        h('label', {}, 'Why does this matter to you? (optional)'),
        h('textarea', { id: 'ob-why', placeholder: 'This helps us surface the right context later.' }, onboarding.why),
      );
      wrap.appendChild(whyField);
      const actions = h('div', { className: 'modal-actions' },
        h('button', { className: 'btn', 'data-action': 'onboarding-back-step' }, 'Back'),
        h('button', { className: 'btn btn-primary', 'data-action': 'onboarding-finish', disabled: c === 'custom' && !onboarding.customDays.length }, 'Create goal'),
      );
      wrap.appendChild(actions);
      mount(wrap);
      const why = qs('#ob-why');
      why.value = onboarding.why;
      why.addEventListener('input', () => { onboarding.why = why.value; });
      ensureFab();
    }
  }

  function cadenceOption(value, current, title, desc, action) {
    return h('button', { className: 'cadence-option' + (current === value ? ' selected' : ''), 'data-action': action, 'data-value': value },
      h('strong', {}, title), h('span', {}, desc),
    );
  }
  function dayPicker(selected, action) {
    const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    return h('div', { className: 'day-picker' },
      ...dow.map((label, i) => h('button', { className: 'day-chip' + (selected.includes(i) ? ' selected' : ''), 'data-action': action, 'data-value': String(i) }, label)),
    );
  }

  async function finishOnboarding() {
    const title = (onboarding.title || '').trim();
    if (!title) { onboarding.step = 1; renderOnboarding(); return; }
    const color = COLORS[goals.length % COLORS.length];
    const icon = ICONS[goals.length % ICONS.length];
    try {
      const goal = await sbInsert(T.goals, {
        user_id: session.user.id, title, why: onboarding.why || null, color, icon,
        cadence: onboarding.cadence, custom_days: onboarding.cadence === 'custom' ? onboarding.customDays : null,
        sort_order: goals.length,
      });
      goals.push(goal);
      openCheckin(goal.id, todayStr(), true);
    } catch (_) { showErr(); }
  }

  // ── Goal create/edit modal ──────────────────────────────────────────────
  function openGoalModal(goalId) {
    const existing = goalId ? goals.find((g) => g.id === goalId) : null;
    modal = {
      type: 'goal-form', editingId: goalId,
      form: existing
        ? { title: existing.title, why: existing.why || '', color: existing.color, icon: existing.icon, cadence: existing.cadence, customDays: existing.custom_days || [] }
        : { title: '', why: '', color: COLORS[goals.length % COLORS.length], icon: ICONS[goals.length % ICONS.length], cadence: 'daily', customDays: [] },
    };
    renderModalHost();
  }

  function renderModal() {
    if (!modal) return;
    if (modal.type === 'goal-form') return renderGoalFormModal();
    if (modal.type === 'ios-install') return renderIosInstallModal();
    if (modal.type === 'archived-goals') return renderArchivedModal();
    if (modal.type === 'delete-goal') return renderDeleteGoalModal();
    if (modal.type === 'delete-data') return renderDeleteDataModal();
    if (modal.type === 'day-goal-pick') return renderDayGoalPickModal();
  }
  function renderModalHost() {
    let host = document.getElementById('modal-host');
    if (!host) { host = h('div', { id: 'modal-host' }); document.body.appendChild(host); }
    clear(host);
    if (modal) host.appendChild(renderModal());
  }

  function renderGoalFormModal() {
    const f = modal.form;
    const activeCount = goals.filter((g) => !g.is_archived).length;
    const sheet = h('div', { className: 'modal-sheet' },
      h('h2', { className: 'modal-title' }, modal.editingId ? 'Edit goal' : 'New goal'),
    );
    if (!modal.editingId && activeCount >= 3) {
      sheet.appendChild(h('p', { className: 'hint', style: 'margin-bottom:14px' },
        activeCount >= 5 ? 'You\u2019ve reached the recommended focus limit of 5 goals — you can still continue.' : 'Growth works best focused — sure you want another goal?'));
    }
    const titleField = h('div', { className: 'field' }, h('label', {}, 'Title'), h('input', { type: 'text', id: 'gm-title', value: f.title, placeholder: 'e.g. Active listening' }));
    sheet.appendChild(titleField);
    const whyField = h('div', { className: 'field' }, h('label', {}, 'Why does this matter? (optional)'), h('textarea', { id: 'gm-why' }, f.why));
    sheet.appendChild(whyField);
    sheet.appendChild(h('div', { className: 'field' },
      h('label', {}, 'Color'),
      h('div', { className: 'chip-row' }, ...COLORS.map((c) => h('button', {
        className: 'day-chip' + (f.color === c ? ' selected' : ''), style: 'background:' + c + (f.color === c ? '' : ';opacity:.55'),
        'data-action': 'goal-modal-color', 'data-value': c,
      }))),
    ));
    sheet.appendChild(h('div', { className: 'field' },
      h('label', {}, 'Icon'),
      h('div', { className: 'chip-row' }, ...ICONS.map((ic) => h('button', { className: 'chip' + (f.icon === ic ? ' selected' : ''), 'data-action': 'goal-modal-icon', 'data-value': ic }, ic))),
    ));
    sheet.appendChild(h('div', { className: 'field' },
      h('label', {}, 'Cadence'),
      cadenceOption('daily', f.cadence, 'Daily', 'A quick check-in every day.', 'goal-modal-cadence'),
      cadenceOption('weekly', f.cadence, 'Weekly', 'One check-in sometime each week.', 'goal-modal-cadence'),
      cadenceOption('custom', f.cadence, 'Custom days', 'Pick specific days of the week.', 'goal-modal-cadence'),
      f.cadence === 'custom' ? dayPicker(f.customDays, 'goal-modal-day') : null,
    ));
    sheet.appendChild(h('div', { className: 'modal-actions' },
      h('button', { className: 'btn', 'data-action': 'close-modal' }, 'Cancel'),
      h('button', { className: 'btn btn-primary', 'data-action': 'goal-modal-save', disabled: f.cadence === 'custom' && !f.customDays.length }, 'Save'),
    ));
    const backdrop = h('div', { className: 'modal-backdrop' }, sheet);
    setTimeout(() => {
      const t = qs('#gm-title'); if (t) { t.addEventListener('input', () => { f.title = t.value; }); }
      const w = qs('#gm-why'); if (w) { w.addEventListener('input', () => { f.why = w.value; }); }
    }, 0);
    return backdrop;
  }

  async function saveGoalModal() {
    const f = modal.form;
    const title = (f.title || '').trim();
    if (!title) return;
    try {
      if (modal.editingId) {
        const updated = await sbPatch(T.goals, modal.editingId, {
          title, why: f.why || null, color: f.color, icon: f.icon, cadence: f.cadence, custom_days: f.cadence === 'custom' ? f.customDays : null,
        });
        const idx = goals.findIndex((g) => g.id === modal.editingId);
        goals[idx] = updated;
        modal = null; renderModalHost();
        goTo('goal-detail', { goalId: updated.id });
      } else {
        const goal = await sbInsert(T.goals, {
          user_id: session.user.id, title, why: f.why || null, color: f.color, icon: f.icon,
          cadence: f.cadence, custom_days: f.cadence === 'custom' ? f.customDays : null, sort_order: goals.length,
        });
        goals.push(goal);
        modal = null; renderModalHost();
        goTo('today');
      }
    } catch (_) { showErr(); }
  }

  function renderIosInstallModal() {
    return h('div', { className: 'modal-backdrop' },
      h('div', { className: 'modal-sheet' },
        h('h2', { className: 'modal-title' }, 'Add Kithe to your home screen'),
        h('p', {}, 'Tap the Share icon in Safari, then choose "Add to Home Screen".'),
        h('div', { className: 'modal-actions' }, h('button', { className: 'btn btn-primary', 'data-action': 'close-modal' }, 'Got it')),
      ),
    );
  }

  // ── Check-in screen ──────────────────────────────────────────────────────
  function openCheckin(goalId, dateIso, isFirst) {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const existing = checkinOn(goalId, dateIso);
    const existingMoments = existing ? moments.filter((m) => m.checkin_id === existing.id).map((m) => ({ kind: m.kind, text: m.description })) : [];
    checkinCtx = { goalId, date: dateIso, isFirst: !!isFirst };
    checkinForm = {
      rating: existing && existing.rating != null ? existing.rating : 5,
      ratingTouched: !!(existing && existing.rating != null),
      moments: existingMoments,
      reflection: existing ? (existing.reflection || '') : '',
      promptUsed: existing ? (existing.prompt_used || pickPrompt(goal, dateIso)) : pickPrompt(goal, dateIso),
    };
    route = 'checkin';
    renderCheckin();
    updateTabBar();
  }

  function pickPrompt(goal, dateIso) {
    let hash = 0;
    const key = goal.id + dateIso;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return PROMPTS[hash % PROMPTS.length].replace('{title}', goal.title);
  }

  function renderCheckin() {
    const goal = goals.find((g) => g.id === checkinCtx.goalId);
    setHeaderActions([backButton('Today', 'checkin-cancel')]);
    const withinBackfill = daysBetween(checkinCtx.date, todayStr()) <= 7;
    const wrap = h('div', {});
    wrap.appendChild(h('div', { className: 'checkin-header' },
      h('span', { className: 'checkin-goal-pill', style: '--goal-color:' + goal.color + ';--goal-color-light:' + goal.color + '22' }, goal.icon + ' ' + goal.title),
      h('h2', { className: 'section-title' }, formatDayLabel(checkinCtx.date)),
    ));

    if (!withinBackfill) {
      wrap.appendChild(h('p', { className: 'hint' }, 'Backfill is limited to the last 7 days — this entry is read-only.'));
    }

    // Rating block
    const ratingBlock = h('div', { className: 'checkin-block', style: '--goal-color:' + goal.color },
      h('h3', {}, 'How did ' + (goal.title.toLowerCase()) + ' feel?'),
    );
    if (checkinForm.ratingTouched) {
      ratingBlock.appendChild(h('div', { className: 'rating-value' }, String(checkinForm.rating)));
      ratingBlock.appendChild(h('input', { type: 'range', min: '1', max: '10', value: String(checkinForm.rating), className: 'rating-slider', id: 'rating-slider', disabled: !withinBackfill }));
      ratingBlock.appendChild(h('div', { className: 'rating-labels' }, h('span', {}, 'Struggled a lot'), h('span', {}, 'At my best')));
      ratingBlock.appendChild(h('button', { className: 'rating-clear', 'data-action': 'checkin-clear-rating' }, 'Clear rating'));
    } else {
      ratingBlock.appendChild(h('button', { className: 'btn btn-block', id: 'rating-activate' }, 'Tap to rate 1–10'));
    }
    wrap.appendChild(ratingBlock);

    // Moments block
    const momentsBlock = h('div', { className: 'checkin-block' }, h('h3', {}, 'Moments'));
    checkinForm.moments.forEach((m, i) => {
      momentsBlock.appendChild(h('div', { className: 'moment-row' },
        h('div', { className: 'moment-kind-toggle' },
          h('button', { className: 'moment-kind-btn win' + (m.kind === 'win' ? ' selected' : ''), 'data-action': withinBackfill ? 'checkin-set-kind' : '', 'data-index': String(i), 'data-value': 'win', disabled: !withinBackfill }, '✓ Win'),
          h('button', { className: 'moment-kind-btn struggle' + (m.kind === 'struggle' ? ' selected' : ''), 'data-action': withinBackfill ? 'checkin-set-kind' : '', 'data-index': String(i), 'data-value': 'struggle', disabled: !withinBackfill }, '△ Struggle'),
        ),
        h('input', { type: 'text', className: 'moment-input', 'data-moment-index': String(i), placeholder: 'What happened?', value: m.text, disabled: !withinBackfill }),
        withinBackfill ? h('button', { className: 'moment-remove', 'data-action': 'checkin-remove-moment', 'data-id': String(i), 'aria-label': 'Remove' }, '×') : null,
      ));
    });
    if (withinBackfill) momentsBlock.appendChild(h('button', { className: 'moment-add-btn', 'data-action': 'checkin-add-moment' }, '+ Add a moment'));
    wrap.appendChild(momentsBlock);

    // Reflection block
    const reflectionBlock = h('div', { className: 'checkin-block' },
      h('h3', {}, 'Reflection'),
      h('p', { className: 'reflection-prompt' }, checkinForm.promptUsed),
      h('textarea', { className: 'reflection-textarea', id: 'reflection-input', placeholder: 'Write a little about it…', disabled: !withinBackfill }, checkinForm.reflection),
    );
    wrap.appendChild(reflectionBlock);

    wrap.appendChild(h('div', { className: 'checkin-save-bar' },
      h('button', { className: 'btn btn-primary btn-block', id: 'checkin-save-btn', 'data-action': withinBackfill ? 'checkin-save' : '' }, checkinCtx.isFirst ? 'Save my first check-in' : 'Save check-in'),
    ));

    mount(wrap);
    wireCheckinListeners(withinBackfill);
    ensureFab();
  }

  function wireCheckinListeners(withinBackfill) {
    const activate = qs('#rating-activate');
    if (activate) activate.addEventListener('click', () => { checkinForm.ratingTouched = true; renderCheckin(); });
    const slider = qs('#rating-slider');
    if (slider) slider.addEventListener('input', () => {
      checkinForm.rating = Number(slider.value);
      qs('.rating-value').textContent = slider.value;
    });
    document.querySelectorAll('[data-moment-index]').forEach((inp) => {
      inp.addEventListener('input', () => { checkinForm.moments[Number(inp.dataset.momentIndex)].text = inp.value; });
    });
    const reflection = qs('#reflection-input');
    if (reflection) reflection.addEventListener('input', () => { checkinForm.reflection = reflection.value; });
  }

  async function saveCheckin() {
    const f = checkinForm;
    const nonEmptyMoments = f.moments.filter((m) => m.text.trim());
    if (!f.ratingTouched && !nonEmptyMoments.length && !f.reflection.trim()) return;
    const btn = qs('#checkin-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }

    const payload = {
      goal_id: checkinCtx.goalId, user_id: session.user.id, checkin_date: checkinCtx.date,
      rating: f.ratingTouched ? f.rating : null, reflection: f.reflection.trim() || null,
      prompt_used: f.reflection.trim() ? f.promptUsed : null,
    };

    try {
      const existing = checkinOn(checkinCtx.goalId, checkinCtx.date);
      let saved;
      if (existing) {
        saved = await sbPatch(T.checkins, existing.id, payload);
        await sbDeleteWhere(T.moments, 'checkin_id', existing.id);
        moments = moments.filter((m) => m.checkin_id !== existing.id);
        checkins = checkins.map((c) => c.id === existing.id ? saved : c);
      } else {
        saved = await sbInsert(T.checkins, payload);
        checkins.push(saved);
      }
      for (const m of nonEmptyMoments) {
        const row = await sbInsert(T.moments, { checkin_id: saved.id, user_id: session.user.id, kind: m.kind, description: m.text.trim() });
        moments.push(row);
      }
      onCheckinSaved();
    } catch (err) {
      if (isOfflineError(err)) {
        queuePendingCheckin(payload, nonEmptyMoments);
        onCheckinSaved();
      } else {
        showErr();
        if (btn) { btn.disabled = false; btn.textContent = 'Save check-in'; }
      }
    }
  }

  function onCheckinSaved() {
    const goal = goals.find((g) => g.id === checkinCtx.goalId);
    const milestoneHit = goal && (MILESTONES.includes(computeStreak(goal)) || MILESTONES.includes(totalCompletedCount(goal)));
    if (milestoneHit) fireConfetti();
    const wasFirst = checkinCtx.isFirst;
    checkinCtx = null; checkinForm = null;
    goTo('today');
    if (wasFirst) maybeShowInstallBanner();
  }

  // ── Offline queue (check-ins only — see file header scope note) ─────────
  function queuePendingCheckin(payload, moments_) {
    const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem('kithe_pending_checkins') || '[]'); } catch (_) {}
    queue.push({ tempId, payload, moments: moments_.map((m) => ({ kind: m.kind, description: m.text.trim() })) });
    localStorage.setItem('kithe_pending_checkins', JSON.stringify(queue));

    const existingIdx = checkins.findIndex((c) => c.goal_id === payload.goal_id && c.checkin_date === payload.checkin_date);
    const oldId = existingIdx !== -1 ? checkins[existingIdx].id : null;
    const optimistic = Object.assign({ id: tempId, created_at: new Date().toISOString() }, payload);
    if (existingIdx !== -1) checkins[existingIdx] = optimistic; else checkins.push(optimistic);
    if (oldId) moments = moments.filter((m) => m.checkin_id !== oldId);
    moments_.forEach((m) => moments.push({ id: 'tmp-m-' + Math.random().toString(36).slice(2, 8), checkin_id: tempId, user_id: session.user.id, kind: m.kind, description: m.text.trim(), created_at: new Date().toISOString() }));
    showSyncBanner();
  }

  async function flushPendingCheckins() {
    if (!navigator.onLine || !session) return;
    let queue = [];
    try { queue = JSON.parse(localStorage.getItem('kithe_pending_checkins') || '[]'); } catch (_) {}
    if (!queue.length) { hideSyncBanner(); return; }
    for (const item of queue) {
      try {
        const existing = checkins.find((c) => c.goal_id === item.payload.goal_id && c.checkin_date === item.payload.checkin_date && !String(c.id).startsWith('tmp-'));
        let saved;
        if (existing) { saved = await sbPatch(T.checkins, existing.id, item.payload); await sbDeleteWhere(T.moments, 'checkin_id', existing.id); }
        else saved = await sbInsert(T.checkins, item.payload);
        for (const m of item.moments) await sbInsert(T.moments, Object.assign({ checkin_id: saved.id, user_id: session.user.id }, m));
      } catch (_) { return; /* stop and retry later; keep remaining queue intact */ }
    }
    localStorage.removeItem('kithe_pending_checkins');
    hideSyncBanner();
    try { await loadAll(); if (route === 'today') renderToday(); else if (route === 'goal-detail') renderGoalDetail(); } catch (_) {}
  }

  // ── Today screen ─────────────────────────────────────────────────────────
  function renderToday() {
    setHeaderActions([]);
    const active = goals.filter((g) => !g.is_archived).sort((a, b) => a.sort_order - b.sort_order);
    const wrap = h('div', {});
    if (!active.length) {
      wrap.appendChild(h('div', { className: 'empty-state' },
        h('div', { className: 'empty-state-icon' }, '🌱'),
        h('h3', {}, 'Nothing to grow yet'),
        h('p', {}, 'Create your first goal to start tracking real change over time.'),
        h('button', { className: 'btn btn-primary', 'data-action': 'open-new-goal' }, 'Create a goal'),
      ));
      mount(wrap);
      return;
    }
    const doneCount = active.filter((g) => todayStatus(g) === 'done').length;
    const dueCount = active.filter((g) => todayStatus(g) !== 'not-scheduled').length;
    wrap.appendChild(h('h2', { className: 'section-title' }, 'Today'));
    wrap.appendChild(h('p', { className: 'section-sub' }, doneCount + ' of ' + dueCount + ' check-ins done'));
    active.forEach((g) => wrap.appendChild(goalCard(g)));
    mount(wrap);
    ensureFab();
  }

  function ensureFab() {
    let fab = document.getElementById('new-goal-fab');
    if (!fab) {
      fab = h('button', { id: 'new-goal-fab', className: 'new-goal-fab', 'data-action': 'open-new-goal', 'aria-label': 'New goal' }, '+');
      document.body.appendChild(fab);
    }
    fab.classList.toggle('hidden', route !== 'today');
  }

  function goalCard(g) {
    const status = todayStatus(g);
    const streak = computeStreak(g);
    const checkinBtn = status === 'not-scheduled'
      ? h('span', { className: 'goal-status not-scheduled' }, 'Not scheduled')
      : h('button', {
          className: 'goal-action-btn checkin ' + status, 'data-action': 'open-checkin', 'data-id': g.id,
          'aria-label': (status === 'done' ? 'Edit today\u2019s check-in for ' : 'Check in for ') + g.title,
        }, status === 'done' ? 'Done ✓' : 'Check in');
    const manageBtn = h('button', {
      className: 'goal-action-btn manage', 'data-action': 'open-goal', 'data-id': g.id,
      'aria-label': 'Manage ' + g.title,
    }, '⚙');
    return h('div', {
      className: 'goal-card', style: '--goal-color:' + g.color + ';--goal-color-light:' + g.color + '22',
    },
      h('div', { className: 'goal-icon-dot', style: '--goal-color-light:' + g.color + '22' }, g.icon),
      h('div', { className: 'goal-card-body' },
        h('div', { className: 'goal-card-title' }, g.title),
        h('div', { className: 'goal-card-meta' },
          streak > 0 ? h('span', { className: 'streak-pill' }, '🔥 ' + streak) : h('span', {}, 'No streak yet'),
        ),
      ),
      h('div', { className: 'goal-card-actions' }, checkinBtn, manageBtn),
    );
  }

  // ── Goal detail ──────────────────────────────────────────────────────────
  function renderGoalDetail(extra) {
    if (extra && extra.goalId) { goalDetailCtx.goalId = extra.goalId; goalDetailCtx.range = '1m'; goalDetailCtx.tab = 'moments'; goalDetailCtx.momentFilter = 'all'; goalDetailCtx.reflectionSearch = ''; }
    const goal = goals.find((g) => g.id === goalDetailCtx.goalId);
    if (!goal) { goTo('today'); return; }
    setHeaderActions([backButton('Today'), h('button', { className: 'header-icon-btn', 'data-action': 'goal-detail-edit' }, 'Edit')]);

    const wrap = h('div', {});
    wrap.appendChild(h('div', { className: 'goal-detail-head' },
      h('div', { className: 'goal-detail-icon', style: '--goal-color-light:' + goal.color + '22' }, goal.icon),
      h('div', {}, h('h2', { className: 'section-title', style: 'margin:0' }, goal.title), h('span', { className: 'streak-pill' }, '🔥 ' + computeStreak(goal) + ' streak')),
    ));
    if (goal.why) wrap.appendChild(h('p', { className: 'goal-why' }, '"' + goal.why + '"'));

    const range = goalDetailCtx.range;
    const rangePoints = ratingPointsForRange(goal, range);
    const momentum = computeMomentum(goal, range);
    wrap.appendChild(h('div', { className: 'stat-row' },
      h('div', { className: 'stat-card' }, h('div', { className: 'stat-value' }, momentum.text), h('div', { className: 'stat-label' }, 'vs. previous period')),
      h('div', { className: 'stat-card' }, h('div', { className: 'stat-value' }, String(totalCompletedCount(goal))), h('div', { className: 'stat-label' }, 'total check-ins')),
    ));

    wrap.appendChild(h('div', { className: 'range-tabs' },
      ...[['2w', '2 wk'], ['1m', '1 mo'], ['3m', '3 mo'], ['all', 'All']].map(([v, label]) =>
        h('button', { className: 'range-tab' + (range === v ? ' active' : ''), 'data-action': 'goal-detail-range', 'data-value': v }, label)),
    ));
    wrap.appendChild(h('div', { className: 'chart-wrap' }, rangePoints.length ? chartSVG(rangePoints, goal.color) : h('div', { className: 'chart-empty' }, 'No ratings yet in this range.')));

    wrap.appendChild(h('div', { className: 'badge-row' },
      ...MILESTONES.map((m) => h('div', { className: 'milestone-badge' + (totalCompletedCount(goal) >= m ? ' achieved' : '') }, h('span', {}, String(m)))),
    ));

    wrap.appendChild(h('div', { className: 'tabs-underline' },
      h('button', { className: 'tab-underline-btn' + (goalDetailCtx.tab === 'moments' ? ' active' : ''), 'data-action': 'goal-detail-tab', 'data-value': 'moments' }, 'Moments'),
      h('button', { className: 'tab-underline-btn' + (goalDetailCtx.tab === 'reflections' ? ' active' : ''), 'data-action': 'goal-detail-tab', 'data-value': 'reflections' }, 'Reflections'),
    ));

    if (goalDetailCtx.tab === 'moments') wrap.appendChild(momentsFeed(goal));
    else wrap.appendChild(reflectionsFeed(goal));

    const archiveBtn = goal.is_archived
      ? h('button', { className: 'btn btn-block', 'data-action': 'goal-detail-unarchive' }, 'Unarchive goal')
      : h('button', { className: 'btn btn-block', 'data-action': 'goal-detail-archive' }, 'Archive goal');
    wrap.appendChild(h('div', { className: 'goal-manage-actions' },
      archiveBtn,
      h('button', { className: 'btn btn-danger btn-block', 'data-action': 'goal-detail-delete' }, 'Delete goal'),
    ));

    mount(wrap);
    ensureFab();
  }

  function rangeDays(range) { return range === '2w' ? 14 : range === '1m' ? 30 : range === '3m' ? 90 : Infinity; }

  function ratingPointsForRange(goal, range) {
    const n = rangeDays(range);
    const today = todayStr();
    const cutoff = n === Infinity ? toISO(new Date(goal.created_at)) : addDays(today, -(n - 1));
    return goalCheckins(goal.id)
      .filter((c) => c.rating != null && c.checkin_date >= cutoff && c.checkin_date <= today)
      .map((c) => ({ date: c.checkin_date, rating: c.rating }));
  }

  function computeMomentum(goal, range) {
    const n = rangeDays(range);
    if (n === Infinity) return { text: '\u2014' };
    const today = todayStr();
    const curStart = addDays(today, -(n - 1));
    const prevEnd = addDays(curStart, -1);
    const prevStart = addDays(curStart, -n);
    const cur = goalCheckins(goal.id).filter((c) => c.rating != null && c.checkin_date >= curStart && c.checkin_date <= today);
    const prev = goalCheckins(goal.id).filter((c) => c.rating != null && c.checkin_date >= prevStart && c.checkin_date <= prevEnd);
    if (!cur.length || !prev.length) return { text: 'Not enough data' };
    const avg = (arr) => arr.reduce((s, c) => s + c.rating, 0) / arr.length;
    const delta = avg(cur) - avg(prev);
    const arrow = delta > 0.05 ? '\u2191' : delta < -0.05 ? '\u2193' : '\u2192';
    return { text: arrow + ' ' + Math.abs(delta).toFixed(1) };
  }

  function chartSVG(points, color) {
    const width = 300, height = 120, pad = 10;
    const dates = points.map((p) => parseLocal(p.date).getTime());
    const minD = Math.min(...dates), maxD = Math.max(...dates);
    const spanD = Math.max(1, maxD - minD);
    const x = (d) => pad + ((parseLocal(d).getTime() - minD) / spanD) * (width - pad * 2);
    const y = (r) => height - pad - ((r - 1) / 9) * (height - pad * 2);

    const rolling = points.map((p, i) => {
      const windowStart = addDays(p.date, -6);
      const windowPts = points.filter((q) => q.date >= windowStart && q.date <= p.date);
      const avg = windowPts.reduce((s, q) => s + q.rating, 0) / windowPts.length;
      return { date: p.date, rating: avg };
    });

    const container = svg('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: '160', preserveAspectRatio: 'xMidYMid meet' });
    const rawPath = points.map((p) => x(p.date) + ',' + y(p.rating)).join(' ');
    const rollPath = rolling.map((p) => x(p.date) + ',' + y(p.rating)).join(' ');
    container.appendChild(svg('polyline', { points: rawPath, fill: 'none', stroke: color, 'stroke-width': '2', opacity: '0.35' }));
    container.appendChild(svg('polyline', { points: rollPath, fill: 'none', stroke: color, 'stroke-width': '2.5' }));
    points.forEach((p) => container.appendChild(svg('circle', { cx: String(x(p.date)), cy: String(y(p.rating)), r: '2.5', fill: color })));
    return container;
  }

  function momentsFeed(goal) {
    const wrap = h('div', {});
    const goalMoments = moments
      .filter((m) => goalCheckins(goal.id).some((c) => c.id === m.checkin_id))
      .filter((m) => goalDetailCtx.momentFilter === 'all' || m.kind === goalDetailCtx.momentFilter)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const allForGoal = moments.filter((m) => goalCheckins(goal.id).some((c) => c.id === m.checkin_id));
    const wins = allForGoal.filter((m) => m.kind === 'win').length;
    const struggles = allForGoal.filter((m) => m.kind === 'struggle').length;

    wrap.appendChild(h('div', { className: 'chip-row', style: 'margin-bottom:18px' },
      h('button', { className: 'chip' + (goalDetailCtx.momentFilter === 'all' ? ' selected' : ''), 'data-action': 'moment-filter', 'data-value': 'all' }, 'All'),
      h('button', { className: 'chip' + (goalDetailCtx.momentFilter === 'win' ? ' selected' : ''), 'data-action': 'moment-filter', 'data-value': 'win' }, '✓ Wins (' + wins + ')'),
      h('button', { className: 'chip' + (goalDetailCtx.momentFilter === 'struggle' ? ' selected' : ''), 'data-action': 'moment-filter', 'data-value': 'struggle' }, '△ Struggles (' + struggles + ')'),
    ));
    if (!goalMoments.length) { wrap.appendChild(h('div', { className: 'chart-empty' }, 'No moments logged yet.')); return wrap; }
    goalMoments.forEach((m) => {
      const c = checkins.find((c2) => c2.id === m.checkin_id);
      wrap.appendChild(h('div', { className: 'moment-item' },
        h('span', { className: 'moment-tag ' + m.kind }, m.kind === 'win' ? 'WIN' : 'STRUGGLE'),
        h('div', { className: 'moment-item-text' }, m.description, h('div', { className: 'moment-item-date' }, c ? formatShort(c.checkin_date) : '')),
      ));
    });
    return wrap;
  }

  function reflectionsFeed(goal) {
    const wrap = h('div', {});
    wrap.appendChild(h('input', { type: 'search', className: 'search-input', id: 'reflection-search', placeholder: 'Search reflections\u2026', value: goalDetailCtx.reflectionSearch }));
    const q = goalDetailCtx.reflectionSearch.toLowerCase();
    const list = goalCheckins(goal.id)
      .filter((c) => c.reflection && c.reflection.trim())
      .filter((c) => !q || c.reflection.toLowerCase().includes(q))
      .sort((a, b) => a.checkin_date < b.checkin_date ? 1 : -1);
    if (!list.length) wrap.appendChild(h('div', { className: 'chart-empty' }, q ? 'No reflections match your search.' : 'No reflections written yet.'));
    list.forEach((c) => {
      wrap.appendChild(h('div', { className: 'reflection-item' },
        h('div', { className: 'reflection-item-date' }, formatDayLabel(c.checkin_date)),
        c.prompt_used ? h('div', { className: 'reflection-item-prompt' }, c.prompt_used) : null,
        h('div', { className: 'reflection-item-body' }, c.reflection),
      ));
    });
    setTimeout(() => {
      const inp = qs('#reflection-search');
      if (inp) inp.addEventListener('input', () => { goalDetailCtx.reflectionSearch = inp.value; renderGoalDetail(); });
    }, 0);
    return wrap;
  }

  async function archiveGoal(goalId, archived) {
    try {
      const updated = await sbPatch(T.goals, goalId, { is_archived: archived });
      goals = goals.map((g) => g.id === goalId ? updated : g);
      if (route === 'goal-detail') renderGoalDetail();
    } catch (_) { showErr(); }
  }

  function openDeleteGoalModal(goalId) { modal = { type: 'delete-goal', goalId, confirmText: '' }; renderModalHost(); }
  function renderDeleteGoalModal() {
    const goal = goals.find((g) => g.id === modal.goalId);
    const sheet = h('div', { className: 'modal-sheet' },
      h('h2', { className: 'modal-title' }, 'Delete "' + (goal ? goal.title : '') + '"?'),
      h('p', {}, 'This permanently deletes the goal and all its check-ins, moments, and reflections. Type DELETE to confirm.'),
      h('input', { type: 'text', className: 'delete-typed-input', id: 'delete-goal-confirm', placeholder: 'DELETE' }),
      h('div', { className: 'modal-actions' },
        h('button', { className: 'btn', 'data-action': 'close-modal' }, 'Cancel'),
        h('button', { className: 'btn btn-danger', id: 'confirm-delete-goal-btn', 'data-action': 'confirm-delete-goal' }, 'Delete permanently'),
      ),
    );
    setTimeout(() => {
      const inp = qs('#delete-goal-confirm');
      inp.addEventListener('input', () => { modal.confirmText = inp.value; });
    }, 0);
    return h('div', { className: 'modal-backdrop' }, sheet);
  }
  async function confirmDeleteGoal() {
    if (modal.confirmText.trim().toUpperCase() !== 'DELETE') return;
    try {
      await sbDelete(T.goals, modal.goalId);
      goals = goals.filter((g) => g.id !== modal.goalId);
      checkins = checkins.filter((c) => c.goal_id !== modal.goalId);
      modal = null; renderModalHost();
      goTo('today');
    } catch (_) { showErr(); }
  }

  // ── Calendar screen ──────────────────────────────────────────────────────
  function renderCalendar() {
    setHeaderActions([]);
    const now = parseLocal(todayStr());
    if (calendarCtx.year == null) { calendarCtx.year = now.getFullYear(); calendarCtx.month = now.getMonth(); }
    const active = goals.filter((g) => !g.is_archived);
    const wrap = h('div', {});
    wrap.appendChild(h('h2', { className: 'section-title' }, 'Calendar'));
    if (active.length) {
      wrap.appendChild(h('div', { className: 'chip-row', style: 'margin-bottom:14px' },
        h('button', { className: 'chip' + (calendarCtx.goalId === 'all' ? ' selected' : ''), 'data-action': 'calendar-goal-select', 'data-value': 'all' }, 'All goals'),
        ...active.map((g) => h('button', { className: 'chip' + (calendarCtx.goalId === g.id ? ' selected' : ''), 'data-action': 'calendar-goal-select', 'data-value': g.id }, g.icon + ' ' + g.title)),
      ));
    }
    const monthLabel = new Date(calendarCtx.year, calendarCtx.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    wrap.appendChild(h('div', { className: 'calendar-nav' },
      h('button', { 'data-action': 'calendar-prev', 'aria-label': 'Previous month' }, '‹'),
      h('h3', {}, monthLabel),
      h('button', { 'data-action': 'calendar-next', 'aria-label': 'Next month' }, '›'),
    ));

    const grid = h('div', { className: 'calendar-grid' });
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d) => grid.appendChild(h('div', { className: 'calendar-dow' }, d)));
    const first = new Date(calendarCtx.year, calendarCtx.month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(calendarCtx.year, calendarCtx.month + 1, 0).getDate();
    const today = todayStr();
    for (let i = 0; i < startOffset; i++) grid.appendChild(h('div', { className: 'calendar-day outside' }));
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toISO(new Date(calendarCtx.year, calendarCtx.month, d));
      const isFuture = iso > today;
      const relevantGoals = calendarCtx.goalId === 'all' ? active : active.filter((g) => g.id === calendarCtx.goalId);
      const hasCheckin = relevantGoals.some((g) => checkinOn(g.id, iso));
      const cls = ['calendar-day'];
      if (isFuture) cls.push('future');
      if (iso === today) cls.push('today');
      if (hasCheckin) cls.push('done');
      grid.appendChild(h(isFuture ? 'div' : 'button', isFuture ? { className: cls.join(' ') } : { className: cls.join(' '), 'data-action': 'calendar-day', 'data-date': iso },
        h('span', {}, String(d)), hasCheckin ? h('span', { className: 'dot' }) : null,
      ));
    }
    wrap.appendChild(grid);
    mount(wrap);
    ensureFab();
  }

  function shiftCalendarMonth(delta) {
    let m = calendarCtx.month + delta, y = calendarCtx.year;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    calendarCtx.month = m; calendarCtx.year = y;
    renderCalendar();
  }

  function onCalendarDayClick(iso) {
    const active = goals.filter((g) => !g.is_archived);
    if (calendarCtx.goalId !== 'all') { openCheckin(calendarCtx.goalId, iso); return; }
    if (active.length === 1) { openCheckin(active[0].id, iso); return; }
    modal = { type: 'day-goal-pick', date: iso };
    renderModalHost();
  }

  // ── Settings screen ──────────────────────────────────────────────────────
  function renderSettings() {
    setHeaderActions([]);
    if (!settingsForm) settingsForm = { displayName: profile.display_name || '', timezone: profile.timezone };
    const themeMode = localStorage.getItem('kithe_theme') || 'system';
    const wrap = h('div', {});
    wrap.appendChild(h('h2', { className: 'section-title' }, 'Settings'));

    wrap.appendChild(h('div', { className: 'settings-group' },
      h('div', { className: 'settings-row', style: 'flex-direction:column;align-items:stretch;gap:8px' },
        h('label', {}, 'Display name'),
        h('input', { type: 'text', id: 'settings-name', value: settingsForm.displayName, placeholder: 'Your name' }),
      ),
      h('div', { className: 'settings-row', style: 'flex-direction:column;align-items:stretch;gap:8px' },
        h('label', {}, 'Timezone'),
        timezoneSelect(settingsForm.timezone),
      ),
      h('div', { className: 'settings-row' }, h('button', { className: 'btn btn-primary btn-sm', 'data-action': 'settings-save-profile' }, 'Save profile')),
    ));

    wrap.appendChild(h('div', { className: 'settings-group' },
      h('div', { className: 'settings-row', style: 'flex-direction:column;align-items:stretch;gap:8px' },
        h('label', {}, 'Appearance'),
        h('div', { className: 'chip-row' },
          h('button', { className: 'chip' + (themeMode === 'system' ? ' selected' : ''), 'data-action': 'settings-theme', 'data-value': 'system' }, 'System'),
          h('button', { className: 'chip' + (themeMode === 'light' ? ' selected' : ''), 'data-action': 'settings-theme', 'data-value': 'light' }, 'Light'),
          h('button', { className: 'chip' + (themeMode === 'dark' ? ' selected' : ''), 'data-action': 'settings-theme', 'data-value': 'dark' }, 'Dark'),
        ),
      ),
    ));

    const archivedCount = goals.filter((g) => g.is_archived).length;
    wrap.appendChild(h('div', { className: 'settings-group' },
      h('div', { className: 'settings-row' }, h('span', {}, 'Archived goals'), h('button', { className: 'btn btn-sm', 'data-action': 'settings-manage-archived' }, archivedCount + ' archived')),
      h('div', { className: 'settings-row' }, h('span', {}, 'Export your data'), h('button', { className: 'btn btn-sm', 'data-action': 'settings-export' }, 'Download JSON')),
    ));

    wrap.appendChild(h('div', { className: 'settings-group' },
      h('div', { className: 'settings-row' }, h('span', {}, 'Sign out'), h('button', { className: 'btn btn-sm', 'data-action': 'sign-out' }, 'Sign out')),
      h('div', { className: 'settings-row' }, h('span', {}, 'Delete all my Kithe data'), h('button', { className: 'btn btn-sm btn-danger', 'data-action': 'settings-delete-data' }, 'Delete')),
    ));

    mount(wrap);
    ensureFab();
    const nameInput = qs('#settings-name');
    nameInput.addEventListener('input', () => { settingsForm.displayName = nameInput.value; });
    const tzSelect = qs('#settings-timezone');
    if (tzSelect) tzSelect.addEventListener('change', () => { settingsForm.timezone = tzSelect.value; });
  }

  function timezoneSelect(current) {
    let zones;
    try { zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : null; } catch (_) { zones = null; }
    if (!zones || !zones.length) zones = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'UTC', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo'];
    return h('select', { id: 'settings-timezone' }, ...zones.map((z) => h('option', { value: z, selected: z === current }, z)));
  }

  async function saveProfile() {
    try {
      const updated = await sbPatch(T.profiles, session.user.id, { display_name: settingsForm.displayName || null, timezone: settingsForm.timezone });
      profile = updated;
      renderSettings();
    } catch (_) { showErr(); }
  }

  function exportData() {
    const data = { profile, goals, checkins, moments, exported_at: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'kithe-export.json';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function openArchivedModal() { modal = { type: 'archived-goals' }; renderModalHost(); }
  function renderArchivedModal() {
    const archived = goals.filter((g) => g.is_archived);
    const sheet = h('div', { className: 'modal-sheet' }, h('h2', { className: 'modal-title' }, 'Archived goals'));
    if (!archived.length) sheet.appendChild(h('p', { className: 'hint' }, 'No archived goals.'));
    archived.forEach((g) => sheet.appendChild(h('div', { className: 'settings-row' },
      h('span', {}, g.icon + ' ' + g.title),
      h('button', { className: 'btn btn-sm', 'data-action': 'unarchive-goal', 'data-id': g.id }, 'Unarchive'),
    )));
    sheet.appendChild(h('div', { className: 'modal-actions' }, h('button', { className: 'btn btn-block', 'data-action': 'close-modal' }, 'Close')));
    return h('div', { className: 'modal-backdrop' }, sheet);
  }

  function openDeleteAccountModal() { modal = { type: 'delete-data', confirmText: '' }; renderModalHost(); }
  function renderDeleteDataModal() {
    const sheet = h('div', { className: 'modal-sheet' },
      h('h2', { className: 'modal-title' }, 'Delete all your Kithe data?'),
      h('p', {}, 'This permanently deletes every goal, check-in, and reflection. Your login itself is unaffected. Type DELETE to confirm.'),
      h('input', { type: 'text', className: 'delete-typed-input', id: 'delete-data-confirm', placeholder: 'DELETE' }),
      h('div', { className: 'modal-actions' },
        h('button', { className: 'btn', 'data-action': 'close-modal' }, 'Cancel'),
        h('button', { className: 'btn btn-danger', 'data-action': 'confirm-delete-data' }, 'Delete everything'),
      ),
    );
    setTimeout(() => { const inp = qs('#delete-data-confirm'); inp.addEventListener('input', () => { modal.confirmText = inp.value; }); }, 0);
    return h('div', { className: 'modal-backdrop' }, sheet);
  }
  async function confirmDeleteAllData() {
    if (modal.confirmText.trim().toUpperCase() !== 'DELETE') return;
    try {
      for (const g of goals) await sbDelete(T.goals, g.id);
      goals = []; checkins = []; moments = [];
      modal = null; renderModalHost();
      route = 'onboarding';
      renderOnboarding();
    } catch (_) { showErr(); }
  }

  // Day-goal picker modal used from "All goals" calendar view
  function renderDayGoalPickModal() {
    const active = goals.filter((g) => !g.is_archived);
    const sheet = h('div', { className: 'modal-sheet' }, h('h2', { className: 'modal-title' }, 'Check in for ' + formatDayLabel(modal.date)));
    active.forEach((g) => sheet.appendChild(h('button', { className: 'btn btn-block', style: 'margin-bottom:8px', onclick: () => { const d = modal.date; modal = null; renderModalHost(); openCheckin(g.id, d); } }, g.icon + ' ' + g.title)));
    sheet.appendChild(h('div', { className: 'modal-actions' }, h('button', { className: 'btn btn-block', 'data-action': 'close-modal' }, 'Cancel')));
    return h('div', { className: 'modal-backdrop' }, sheet);
  }
})();
