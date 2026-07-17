/* app.js – Vibe Check */
(function () {
  'use strict';

  // ── Supabase config ────────────────────────────────────────────────────
  const SB_URL = 'https://awccquoyscijmtqtibgr.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Y2NxdW95c2Npam10cXRpYmdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDI0MDUsImV4cCI6MjA4MjM3ODQwNX0.zUBCXRah_oK8P_Q-1sFwZ5altAFUfZMOdBdY-tuXWrE';
  const TABLE  = 'vibecheck_tasks';

  // ── Auth state ─────────────────────────────────────────────────────────
  let session  = null;

  function getHeaders(extra) {
    var tok = session ? session.access_token : SB_KEY;
    return Object.assign({
      apikey:         SB_KEY,
      Authorization:  'Bearer ' + tok,
      'Content-Type': 'application/json',
    }, extra || {});
  }

  function saveSession(s) {
    session = s;
    try { localStorage.setItem('jt_session', JSON.stringify(s)); } catch (_) {}
  }

  function clearSession() {
    session = null;
    try { localStorage.removeItem('jt_session'); } catch (_) {}
  }

  async function sbSignUp(name, email, password) {
    const r = await fetch(SB_URL + '/auth/v1/signup', {
      method:  'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email, password: password, data: { full_name: name } }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || 'Sign up failed');
    return data;
  }

  async function sbSignIn(email, password) {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method:  'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email, password: password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error_description || data.msg || 'Sign in failed');
    return data;
  }

  async function sbRefreshToken(refreshToken) {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method:  'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error('refresh failed');
    return data;
  }

  async function initAuth() {
    try {
      var stored = localStorage.getItem('jt_session');
      if (!stored) return false;
      var s = JSON.parse(stored);
      if (s.expires_at && (s.expires_at - 60) > Date.now() / 1000) {
        session = s;
        return true;
      }
      if (!s.refresh_token) return false;
      var refreshed = await sbRefreshToken(s.refresh_token);
      saveSession({
        access_token:  refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at:    refreshed.expires_in ? (Date.now() / 1000 + refreshed.expires_in) : null,
        user:          refreshed.user,
      });
      return true;
    } catch (_) {
      clearSession();
      return false;
    }
  }

  // ── Metadata ───────────────────────────────────────────────────────────
  const LEVELS = {
    1: { name: 'Locked in',      desc: 'Deep focus, no distractions',                emoji: '🎯', cls: 'l1' },
    2: { name: 'Half-attention', desc: 'Podcast or TV in the background is fine',     emoji: '🎧', cls: 'l2' },
    3: { name: 'Autopilot',      desc: 'Basically mindless',                          emoji: '🛋️', cls: 'l3' },
  };
  const SIZES = {
    S: { label: 'S · ~15 min', mins: 15  },
    M: { label: 'M · ~1 hr',   mins: 60  },
    L: { label: 'L · 2+ hrs',  mins: 180 },
  };
  const TIME_OPTS = [
    { label: 'Whatever it takes', value: 'any' },
    { label: '~15 min',           value: 15    },
    { label: '~1 hr',             value: 60    },
    { label: '2+ hrs',            value: 180   },
  ];

  // ── State ──────────────────────────────────────────────────────────────
  let tasks   = [];
  let loading = true;
  let view    = 'picker';   // 'picker' | 'all'
  let picker  = { level: null, time: null };
  let addOpen = false;
  let addForm   = { title: '', level: 2, size: 'M', cat: 'personal', priority: false, due: '' };
  let editingId   = null;
  let editForm    = { title: '', level: 2, size: 'M', cat: 'personal', priority: false, due: '' };
  let importOpen   = false;
  let importResult = null; // { imported: N, skipped: M } after a bulk import

  // Drag state
  var drag = { id: null, el: null, ghost: null, pid: null, elLeft: 0, elTop: 0, initX: 0, initY: 0, overId: null, overBefore: false, overEl: null, overGroupEl: null, overGroupLevel: null };

  // Auth UI state
  var authMode  = 'signin'; // 'signin' | 'signup'
  var authError = '';

  // ── Supabase REST helpers ──────────────────────────────────────────────
  async function sbLoad() {
    const r = await fetch(
      `${SB_URL}/rest/v1/${TABLE}?select=*&order=sort_order.asc.nullslast,created.asc`,
      { headers: getHeaders() }
    );
    if (!r.ok) throw new Error('load ' + r.status);
    return r.json();
  }

  async function sbInsert(row) {
    const r = await fetch(`${SB_URL}/rest/v1/${TABLE}`, {
      method:  'POST',
      headers: getHeaders({ Prefer: 'return=representation' }),
      body:    JSON.stringify(row),
    });
    if (!r.ok) throw new Error('insert ' + r.status);
    return (await r.json())[0];
  }

  async function sbPatch(id, patch) {
    const r = await fetch(
      `${SB_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: getHeaders({ Prefer: 'return=minimal' }), body: JSON.stringify(patch) }
    );
    if (!r.ok) throw new Error('patch ' + r.status);
  }

  async function sbDelete(id) {
    const r = await fetch(
      `${SB_URL}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: getHeaders() }
    );
    if (!r.ok) throw new Error('delete ' + r.status);
  }

  async function sbDeleteDone() {
    const r = await fetch(
      `${SB_URL}/rest/v1/${TABLE}?done=eq.true`,
      { method: 'DELETE', headers: getHeaders() }
    );
    if (!r.ok) throw new Error('deleteDone ' + r.status);
  }

  // ── Date helpers ───────────────────────────────────────────────────────
  function parseLocal(iso) {
    // Parse YYYY-MM-DD as local midnight — avoids UTC-offset day shifts
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function daysUntil(iso) {
    const today = (function () {
      const n = new Date();
      return new Date(n.getFullYear(), n.getMonth(), n.getDate());
    }());
    return Math.round((parseLocal(iso) - today) / 86400000);
  }

  function dueBadge(iso) {
    if (!iso) return null;
    const d = daysUntil(iso);
    const urgent = d <= 0;
    let text;
    if      (d < 0)  text = 'Overdue';
    else if (d === 0) text = 'Due today';
    else if (d === 1) text = 'Due tomorrow';
    else if (d <= 7) text = 'Due in ' + d + 'd';
    else             text = parseLocal(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { text, urgent };
  }

  // ── Scoring / sorting ──────────────────────────────────────────────────
  function score(t) {
    let s;
    if (t.due) {
      const d = daysUntil(t.due);
      if      (d < 0)  s = -1000 + d;
      else if (d === 0) s = -500;
      else if (d === 1) s = -100;
      else if (d <= 7) s = d;
      else             s = 100 + d;
    } else {
      s = 500;
    }
    if (t.priority) s -= 250;
    return s;
  }

  function sorted(arr) {
    return arr.slice().sort(function (a, b) {
      var ao = (a.sort_order != null) ? a.sort_order : score(a) + 1e6;
      var bo = (b.sort_order != null) ? b.sort_order : score(b) + 1e6;
      return ao - bo || a.created - b.created;
    });
  }

  // Assign sort_order to tasks that don't have one yet (runs in background after load)
  function initSortOrders() {
    if (!tasks.some(function (t) { return t.sort_order == null; })) return;
    [1, 2, 3].forEach(function (level) {
      var group = tasks
        .filter(function (t) { return t.level === level && t.sort_order == null; })
        .sort(function (a, b) { return score(a) - score(b) || a.created - b.created; });
      group.forEach(function (t, i) {
        t.sort_order = (i + 1) * 1000;
        sbPatch(t.id, { sort_order: t.sort_order }).catch(function () {});
      });
    });
  }

  // ── Vibe filtering ─────────────────────────────────────────────────────
  function vibeMatches() {
    const { level, time } = picker;
    if (level === null || time === null) return [];
    return sorted(tasks.filter(function (t) {
      if (t.done || t.level !== level) return false;
      return time === 'any' || SIZES[t.size].mins <= time;
    }));
  }

  // ── Save error ─────────────────────────────────────────────────────────
  function showErr() { document.getElementById('save-error').classList.remove('hidden'); }
  function hideErr() { document.getElementById('save-error').classList.add('hidden'); }

  // ── DOM builder ────────────────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if      (k === 'className') el.className = v;
      else if (k === 'value')     el.value     = v;
      else if (k === 'checked')   el.checked   = !!v;
      else if (k === 'hidden')    el.hidden    = !!v;
      else if (k.startsWith('data-')) el.dataset[k.slice(5)] = v;
      else el.setAttribute(k, v);
    }
    kids.forEach(function (kid) {
      if (kid == null || kid === false) return;
      el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return el;
  }

  // ── Tab bar sync ────────────────────────────────────────────────────
  function updateTabBar() {
    var p   = document.getElementById('tab-picker');
    var a   = document.getElementById('tab-all');
    var add = document.getElementById('tab-add');
    if (p)   { p.classList.toggle('active', view === 'picker' && !addOpen); p.setAttribute('aria-selected', String(view === 'picker' && !addOpen)); }
    if (a)   { a.classList.toggle('active', view === 'all'    && !addOpen); a.setAttribute('aria-selected', String(view === 'all'    && !addOpen)); }
    if (add) { add.classList.toggle('active', addOpen); }
  }

  // ── Sync form fields from current panel's DOM ──────────────────────────
  function syncForm() {
    if (!addOpen) return;
    var p = '#panel-' + view + ' ';
    var ti = document.querySelector(p + '.add-title-input');
    var di = document.querySelector(p + '.due-date-input');
    var pi = document.querySelector(p + '.add-priority-check');
    if (ti) addForm.title    = ti.value;
    if (di) addForm.due      = di.value;
    if (pi) addForm.priority = pi.checked;
  }

  function syncEditForm() {
    if (!editingId) return;
    var p = '#panel-' + view + ' .edit-form-card ';
    var ti = document.querySelector(p + '.edit-title-input');
    var di = document.querySelector(p + '.edit-due-input');
    var pi = document.querySelector(p + '.edit-priority-check');
    if (ti) editForm.title    = ti.value;
    if (di) editForm.due      = di.value;
    if (pi) editForm.priority = pi.checked;
  }

  // ── Render: edit form (inline task replacement) ────────────────────────
  function mkEditForm(task) {
    return h('div', { className: 'edit-form-card edit-lv-' + editForm.level, 'data-id': task.id },
      h('div', { className: 'add-title-row' },
        h('input', {
          type:        'text',
          className:   'add-title-input edit-title-input',
          value:       editForm.title,
          'aria-label': 'Task title',
        }),
        h('button', { className: 'add-submit-btn', 'data-action': 'save-edit', 'data-id': task.id }, 'Save'),
        h('button', { className: 'add-cancel-btn', 'data-action': 'cancel-edit' }, 'Cancel'),
      ),
      h('div', { className: 'form-row' },
        h('div', { className: 'chips-label' }, 'Focus level'),
        h('div', { className: 'chips' },
          h('button', { className: 'chip' + (editForm.level === 1 ? ' sel-l1' : ''), 'data-action': 'edit-level', 'data-value': '1' }, LEVELS[1].emoji + ' ' + LEVELS[1].name),
          h('button', { className: 'chip' + (editForm.level === 2 ? ' sel-l2' : ''), 'data-action': 'edit-level', 'data-value': '2' }, LEVELS[2].emoji + ' ' + LEVELS[2].name),
          h('button', { className: 'chip' + (editForm.level === 3 ? ' sel-l3' : ''), 'data-action': 'edit-level', 'data-value': '3' }, LEVELS[3].emoji + ' ' + LEVELS[3].name),
        ),
      ),
      h('div', { className: 'form-row' },
        h('div', { className: 'chips-label' }, 'Size'),
        h('div', { className: 'chips' },
          h('button', { className: 'chip' + (editForm.size === 'S' ? ' sel' : ''), 'data-action': 'edit-size', 'data-value': 'S' }, SIZES.S.label),
          h('button', { className: 'chip' + (editForm.size === 'M' ? ' sel' : ''), 'data-action': 'edit-size', 'data-value': 'M' }, SIZES.M.label),
          h('button', { className: 'chip' + (editForm.size === 'L' ? ' sel' : ''), 'data-action': 'edit-size', 'data-value': 'L' }, SIZES.L.label),
        ),
      ),
      h('div', { className: 'form-row' },
        h('div', { className: 'chips-label' }, 'Category'),
        h('div', { className: 'chips' },
          h('button', { className: 'chip' + (editForm.cat === 'work'     ? ' sel' : ''), 'data-action': 'edit-cat', 'data-value': 'work'     }, 'Work'),
          h('button', { className: 'chip' + (editForm.cat === 'personal' ? ' sel' : ''), 'data-action': 'edit-cat', 'data-value': 'personal' }, 'Personal'),
        ),
      ),
      h('div', { className: 'form-bottom' },
        h('label', { className: 'priority-label' },
          h('input', { type: 'checkbox', className: 'edit-priority-check', checked: editForm.priority }),
          'High priority',
        ),
        h('label', { className: 'due-label' },
          'Due:',
          h('input', { type: 'date', className: 'due-date-input edit-due-input', value: editForm.due }),
        ),
      ),
    );
  }

  // ── Render: add form ───────────────────────────────────────────────────
  function mkAddForm() {
    if (importOpen) return mkImportForm();
    if (!addOpen) return document.createDocumentFragment();

    return h('div', { className: 'add-form-panel' },
      h('div', { className: 'add-title-row' },
        h('input', {
          type:        'text',
          className:   'add-title-input',
          placeholder: 'Task title…',
          value:       addForm.title,
          'aria-label': 'Task title',
        }),
        h('button', { className: 'add-submit-btn', 'data-action': 'submit-add' }, 'Add'),
        h('button', { className: 'add-cancel-btn', 'data-action': 'cancel-add' }, 'Cancel'),
      ),
      h('div', { className: 'form-row' },
        h('div', { className: 'chips-label' }, 'Focus level'),
        h('div', { className: 'chips' },
          h('button', {
            className: 'chip' + (addForm.level === 1 ? ' sel-l1' : ''),
            'data-action': 'form-level', 'data-value': '1',
          }, LEVELS[1].emoji + ' ' + LEVELS[1].name),
          h('button', {
            className: 'chip' + (addForm.level === 2 ? ' sel-l2' : ''),
            'data-action': 'form-level', 'data-value': '2',
          }, LEVELS[2].emoji + ' ' + LEVELS[2].name),
          h('button', {
            className: 'chip' + (addForm.level === 3 ? ' sel-l3' : ''),
            'data-action': 'form-level', 'data-value': '3',
          }, LEVELS[3].emoji + ' ' + LEVELS[3].name),
        ),
      ),
      h('div', { className: 'form-row' },
        h('div', { className: 'chips-label' }, 'Size'),
        h('div', { className: 'chips' },
          h('button', {
            className: 'chip' + (addForm.size === 'S' ? ' sel' : ''),
            'data-action': 'form-size', 'data-value': 'S',
          }, SIZES.S.label),
          h('button', {
            className: 'chip' + (addForm.size === 'M' ? ' sel' : ''),
            'data-action': 'form-size', 'data-value': 'M',
          }, SIZES.M.label),
          h('button', {
            className: 'chip' + (addForm.size === 'L' ? ' sel' : ''),
            'data-action': 'form-size', 'data-value': 'L',
          }, SIZES.L.label),
        ),
      ),
      h('div', { className: 'form-row' },
        h('div', { className: 'chips-label' }, 'Category'),
        h('div', { className: 'chips' },
          h('button', {
            className: 'chip' + (addForm.cat === 'work' ? ' sel' : ''),
            'data-action': 'form-cat', 'data-value': 'work',
          }, 'Work'),
          h('button', {
            className: 'chip' + (addForm.cat === 'personal' ? ' sel' : ''),
            'data-action': 'form-cat', 'data-value': 'personal',
          }, 'Personal'),
        ),
      ),
      h('div', { className: 'form-bottom' },
        h('label', { className: 'priority-label' },
          h('input', { type: 'checkbox', className: 'add-priority-check', checked: addForm.priority }),
          'High priority',
        ),
        h('label', { className: 'due-label' },
          'Due:',
          h('input', { type: 'date', className: 'due-date-input', value: addForm.due }),
        ),
      ),
      h('div', { className: 'import-link-row' },
        h('button', { className: 'import-link-btn', 'data-action': 'open-import' }, 'Bulk import via CSV'),
      ),
    );
  }

  // ── Render: task card ──────────────────────────────────────────────────
  function mkTask(task) {
    if (editingId === task.id) return mkEditForm(task);

    var lvl  = LEVELS[task.level];
    var done = task.done;
    var due  = dueBadge(task.due);

    var cb = h('button', {
      className:    'task-cb' + (done ? ' ck-' + lvl.cls : ''),
      'aria-label': done ? 'Mark incomplete' : 'Mark complete',
      'data-action': 'toggle',
      'data-id':     task.id,
    }, done ? h('span', { className: 'cb-check' }, '✓') : null);

    var badgeNodes = [
      h('span', { className: 'badge' }, SIZES[task.size].label),
      h('span', { className: 'badge' }, task.cat === 'work' ? 'Work' : 'Personal'),
    ];
    if (task.priority) badgeNodes.push(h('span', { className: 'badge badge-priority' }, '★ Priority'));
    if (due) badgeNodes.push(h('span', { className: 'badge' + (due.urgent ? ' badge-urgent' : '') }, due.text));
    if (done) badgeNodes.push(h('span', { className: 'badge badge-lv-' + task.level }, lvl.emoji + ' ' + lvl.name));

    var handle = done ? null : h('div', { className: 'drag-handle', title: 'Drag to reorder' }, '⠇');

    var body = h('div', { className: 'task-body' },
      h('span', { className: 'task-title' + (done ? ' done' : '') }, task.title),
      h.apply(null, ['div', { className: 'task-badges' }].concat(badgeNodes)),
    );

    var edit = h('button', {
      className:    'task-edit',
      'aria-label': 'Edit task',
      'data-action': 'start-edit',
      'data-id':     task.id,
    }, 'Edit');

    var del = h('button', {
      className:    'task-del',
      'aria-label': 'Delete task',
      'data-action': 'delete',
      'data-id':     task.id,
    }, 'Delete');

    return h('div', { className: 'task-card' + (done ? ' done' : ''), 'data-id': task.id },
      handle, cb, body, edit, del
    );
  }

  // ── Auth UI ────────────────────────────────────────────────────────────
  function renderAuth() {
    var overlay = document.getElementById('auth-overlay');
    overlay.innerHTML = '';
    var isUp = authMode === 'signup';
    var card = h('div', { className: 'auth-card' },
      h('h1', { className: 'auth-title' }, "Jalen's To-Dos"),
      h('p',  { className: 'auth-subtitle' }, isUp ? 'Create your account' : 'Welcome back'),
    );
    if (authError) {
      card.appendChild(h('div', { className: 'auth-error' }, authError));
    }
    if (isUp) {
      card.appendChild(h('div', { className: 'auth-field' },
        h('label', { className: 'auth-label', for: 'auth-name' }, 'Your name'),
        h('input', { type: 'text', id: 'auth-name', className: 'auth-input',
          placeholder: 'What should we call you?', autocomplete: 'name' }),
      ));
    }
    card.appendChild(h('div', { className: 'auth-field' },
      h('label', { className: 'auth-label', for: 'auth-email' }, 'Email'),
      h('input', { type: 'email', id: 'auth-email', className: 'auth-input',
        placeholder: 'you@example.com', autocomplete: 'email' }),
    ));
    card.appendChild(h('div', { className: 'auth-field' },
      h('label', { className: 'auth-label', for: 'auth-password' }, 'Password'),
      h('input', { type: 'password', id: 'auth-password', className: 'auth-input',
        placeholder: isUp ? 'Create a password' : 'Your password',
        autocomplete: isUp ? 'new-password' : 'current-password' }),
    ));
    card.appendChild(h('button', { className: 'auth-submit', 'data-action': 'auth-submit' },
      isUp ? 'Create account' : 'Sign in'
    ));
    card.appendChild(h('p', { className: 'auth-toggle' },
      isUp ? 'Already have an account? ' : "Don't have an account? ",
      h('button', { className: 'auth-toggle-btn', 'data-action': 'auth-toggle' },
        isUp ? 'Sign in' : 'Create account'
      ),
    ));
    overlay.appendChild(card);
    setTimeout(function () {
      var first = overlay.querySelector('.auth-input');
      if (first) first.focus();
    }, 0);
  }

  async function doAuth() {
    var emailEl = document.getElementById('auth-email');
    var passEl  = document.getElementById('auth-password');
    var nameEl  = document.getElementById('auth-name');
    var email    = emailEl    ? emailEl.value.trim()    : '';
    var password = passEl     ? passEl.value            : '';
    var name     = nameEl     ? nameEl.value.trim()     : '';

    if (!email || !password) {
      authError = 'Please fill in all fields.';
      renderAuth();
      return;
    }
    if (authMode === 'signup' && !name) {
      authError = 'Please enter your name.';
      renderAuth();
      return;
    }

    var btn = document.querySelector('#auth-overlay .auth-submit');
    if (btn) { btn.disabled = true; btn.textContent = authMode === 'signup' ? 'Creating\u2026' : 'Signing in\u2026'; }

    try {
      var data;
      if (authMode === 'signup') {
        data = await sbSignUp(name, email, password);
        if (!data.access_token) {
          // Email confirmation required
          var overlay = document.getElementById('auth-overlay');
          overlay.innerHTML = '';
          overlay.appendChild(h('div', { className: 'auth-card' },
            h('h1', { className: 'auth-title' }, 'Check your email'),
            h('p',  { className: 'auth-subtitle' },
              'A confirmation link was sent to ' + email + '. Click it to activate your account, then sign in here.'
            ),
            h('button', { className: 'auth-submit', 'data-action': 'auth-goto-signin' }, 'Back to Sign in'),
          ));
          return;
        }
      } else {
        data = await sbSignIn(email, password);
      }
      saveSession({
        access_token:  data.access_token,
        refresh_token: data.refresh_token,
        expires_at:    data.expires_in ? (Date.now() / 1000 + data.expires_in) : null,
        user:          data.user,
      });
      startApp();
    } catch (err) {
      authError = err.message || 'Something went wrong. Try again.';
      renderAuth();
    }
  }

  function updateHeader() {
    var header = document.querySelector('.app-header');
    if (!header || !session) return;
    var existing = header.querySelector('.user-info');
    if (existing) existing.remove();
    var meta = session.user && session.user.user_metadata;
    var name = (meta && meta.full_name)
      ? meta.full_name.split(' ')[0]
      : (session.user && session.user.email ? session.user.email : 'You');
    header.appendChild(h('div', { className: 'user-info' },
      h('span',  { className: 'user-name' }, 'Hi, ' + name),
      h('button', { className: 'sign-out-btn', 'data-action': 'sign-out' }, 'Sign out'),
    ));
  }

  async function doSignOut() {
    if (session) {
      fetch(SB_URL + '/auth/v1/logout', {
        method:  'POST',
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + session.access_token },
      }).catch(function () {});
    }
    clearSession();
    tasks   = [];
    loading = true;
    view    = 'picker';
    picker  = { level: null, time: null };
    addOpen = false;
    var ui = document.querySelector('.user-info');
    if (ui) ui.remove();
    document.getElementById('app').hidden = true;
    document.getElementById('auth-overlay').hidden = false;
    authMode  = 'signin';
    authError = '';
    renderAuth();
  }

  function startApp() {
    document.getElementById('auth-overlay').hidden = true;
    document.getElementById('app').hidden = false;
    updateHeader();
    tasks   = [];
    loading = true;
    renderCurrent();
    sbLoad().then(function (rows) {
      tasks   = rows;
      loading = false;
      initSortOrders();
      renderCurrent();
    }).catch(function () {
      loading = false;
      showErr();
      renderCurrent();
    });
  }

  // ── CSV bulk import ─────────────────────────────────────────────────────
  function parseCSV(text) {
    var rows = [];
    var lines = text.split('\n');
    lines.forEach(function (line) {
      line = line.trim();
      if (!line) return;
      var fields = [];
      var i = 0;
      while (i < line.length) {
        if (line[i] === '"') {
          var j = i + 1;
          var field = '';
          while (j < line.length) {
            if (line[j] === '"' && line[j + 1] === '"') { field += '"'; j += 2; }
            else if (line[j] === '"') { j++; break; }
            else { field += line[j]; j++; }
          }
          fields.push(field);
          if (j < line.length && line[j] === ',') j++;
          i = j;
        } else {
          var end = line.indexOf(',', i);
          if (end === -1) { fields.push(line.slice(i).trim()); break; }
          else { fields.push(line.slice(i, end).trim()); i = end + 1; }
        }
      }
      rows.push(fields);
    });
    return rows;
  }

  function csvRowToTask(fields) {
    var title = (fields[0] || '').trim();
    if (!title) return null;

    var level = parseInt(fields[1], 10);
    if (level !== 1 && level !== 2 && level !== 3) level = 2;

    var size = (fields[2] || '').trim().toUpperCase();
    if (size !== 'S' && size !== 'M' && size !== 'L') size = 'M';

    var cat = (fields[3] || '').trim().toLowerCase();
    if (cat !== 'work' && cat !== 'personal') cat = 'personal';

    var priority = (fields[4] || '').trim().toLowerCase() === 'true';

    var due = (fields[5] || '').trim();
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) due = '';

    return {
      id:         crypto.randomUUID(),
      title:      title,
      level:      level,
      size:       size,
      cat:        cat,
      priority:   priority,
      due:        due || null,
      done:       false,
      created:    Date.now(),
      sort_order: null,
      user_id:    session ? session.user.id : null,
    };
  }

  function mkImportForm() {
    var placeholder = [
      'title,level,size,cat,priority,due',
      'Clean the garage,3,L,personal,,',
      'Review Q3 report,1,M,work,true,2026-07-20',
      'Call dentist,2,S,personal,,',
    ].join('\n');

    var panel = h('div', { className: 'add-form-panel' },
      h('div', { className: 'import-header' },
        h('span', { className: 'import-title' }, 'Bulk Import'),
        h('div', { className: 'import-actions' },
          h('button', { className: 'add-submit-btn', 'data-action': 'submit-import' }, 'Import'),
          h('button', { className: 'add-cancel-btn', 'data-action': 'cancel-import' }, 'Cancel'),
        ),
      ),
      h('textarea', {
        className:    'import-textarea',
        placeholder:  placeholder,
        'aria-label': 'CSV tasks to import',
        rows:         '8',
      }),
    );

    if (importResult) {
      var ok   = importResult.imported > 0;
      var msg  = ok
        ? '\u2713 Imported ' + importResult.imported + ' task' + (importResult.imported !== 1 ? 's' : '')
        : 'Nothing imported — check your format';
      if (importResult.skipped > 0)
        msg += ' \u00b7 ' + importResult.skipped + ' row' + (importResult.skipped !== 1 ? 's' : '') + ' skipped (no title)';
      panel.appendChild(h('p', { className: 'import-result' + (ok ? '' : ' import-result-warn') }, msg));
    }
    return panel;
  }

  async function doImport() {
    var ta = document.querySelector('.import-textarea');
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) return;

    var rows     = parseCSV(text);
    var newTasks = [];
    var skipped  = 0;

    rows.forEach(function (fields, idx) {
      if (idx === 0 && (fields[0] || '').trim().toLowerCase() === 'title') return; // header
      var task = csvRowToTask(fields);
      if (task) { newTasks.push(task); } else { skipped++; }
    });

    // Assign sort_orders after existing per-level tails
    var maxByLevel = {};
    tasks.forEach(function (t) {
      if (t.sort_order != null && !t.done) {
        if (!maxByLevel[t.level] || t.sort_order > maxByLevel[t.level])
          maxByLevel[t.level] = t.sort_order;
      }
    });
    newTasks.forEach(function (t) {
      maxByLevel[t.level] = (maxByLevel[t.level] || 0) + 1000;
      t.sort_order = maxByLevel[t.level];
    });

    // Optimistic add
    newTasks.forEach(function (t) { tasks.push(t); });
    importResult = { imported: newTasks.length, skipped: skipped };
    renderCurrent();

    // Persist and roll back individual failures
    for (var i = 0; i < newTasks.length; i++) {
      var taskId = newTasks[i].id;
      try {
        await sbInsert(newTasks[i]);
        hideErr();
      } catch (_) {
        showErr();
        var badIdx = tasks.findIndex(function (t) { return t.id === taskId; });
        if (badIdx !== -1) tasks.splice(badIdx, 1);
        importResult.imported--;
      }
    }

    renderCurrent();
    if (importResult.imported > 0) {
      setTimeout(function () {
        importOpen   = false;
        addOpen      = false;
        importResult = null;
        updateTabBar();
        renderCurrent();
      }, 1500);
    }
  }

  // ── Render: picker panel ───────────────────────────────────────────────
  function renderPicker() {
    var el = document.getElementById('panel-picker');
    el.innerHTML = '';
    el.appendChild(mkAddForm());
    if (addOpen) return; // form takes the full view

    if (loading) {
      el.appendChild(h('div', { className: 'loading' }, 'Loading your tasks…'));
      return;
    }

    // Headspace cards
    el.appendChild(h('p', { className: 'section-label' }, "What's your headspace?"));
    var cards = h('div', { className: 'vibe-cards' });
    [1, 2, 3].forEach(function (n) {
      var lvl   = LEVELS[n];
      var count = tasks.filter(function (t) { return !t.done && t.level === n; }).length;
      var sel   = picker.level === n;
      cards.appendChild(
        h('button', {
          className:    'vibe-card' + (sel ? ' sel-' + lvl.cls : ''),
          'data-action': 'pick-level',
          'data-value':  String(n),
        },
          h('span', { className: 'vibe-emoji' }, lvl.emoji),
          h('div', { className: 'vibe-text' },
            h('div', { className: 'vibe-name' }, lvl.name),
            h('div', { className: 'vibe-desc' }, lvl.desc),
          ),
          h('span', { className: 'vibe-count' },
            count + ' task' + (count !== 1 ? 's' : '') + ' waiting'
          ),
        )
      );
    });
    el.appendChild(cards);

    // Time pills
    el.appendChild(h('p', { className: 'section-label' }, 'How much time do you have?'));
    var pills = h('div', { className: 'time-pills' });
    TIME_OPTS.forEach(function (opt) {
      var sel = picker.time === opt.value;
      pills.appendChild(
        h('button', {
          className:    'time-pill' + (sel ? ' sel' : ''),
          'data-action': 'pick-time',
          'data-value':  String(opt.value),
        }, opt.label)
      );
    });
    el.appendChild(pills);

    // Results
    if (picker.level !== null && picker.time !== null) {
      var matches = vibeMatches();
      if (matches.length === 0) {
        el.appendChild(h('div', { className: 'empty-state' },
          'Nothing matches this vibe and time window. Add a task, or enjoy the free moment. ✨'
        ));
      } else {
        var top  = matches[0];
        var rest = matches.slice(1);

        el.appendChild(h('p', { className: 'results-header' }, 'Do this one'));
        var topWrap = h('div', { className: 'top-result lv-' + top.level });
        topWrap.appendChild(mkTask(top));
        el.appendChild(topWrap);

        if (rest.length > 0) {
          el.appendChild(h('p', { className: 'results-header' }, 'Or one of these'));
          rest.forEach(function (t) { el.appendChild(mkTask(t)); });
        }
      }
    }
  }

  // ── Render: all-tasks panel ────────────────────────────────────────────
  function renderAll() {
    var el = document.getElementById('panel-all');
    el.innerHTML = '';
    el.appendChild(mkAddForm());

    if (loading) {
      el.appendChild(h('div', { className: 'loading' }, 'Loading your tasks…'));
      return;
    }

    var open = tasks.filter(function (t) { return !t.done; });
    var done = tasks.filter(function (t) { return t.done; });

    [1, 2, 3].forEach(function (n) {
      var lvl   = LEVELS[n];
      var group = sorted(open.filter(function (t) { return t.level === n; }));
      var sec   = h('div', { className: 'group-sec', 'data-level': String(n) },
        h('div', { className: 'group-hdr' },
          h('span', { className: 'group-emoji' }, lvl.emoji),
          h('span', { className: 'group-name g-' + lvl.cls }, lvl.name),
          h('span', { className: 'group-count' }, group.length + ' open'),
        ),
      );

      if (group.length === 0) {
        sec.appendChild(h('p', { className: 'group-empty' }, 'Nothing here — nice.'));
      } else {
        group.forEach(function (t) { sec.appendChild(mkTask(t)); });
      }
      el.appendChild(sec);
    });

    if (done.length > 0) {
      var doneSec = h('div', { className: 'done-sec' },
        h('div', { className: 'done-hdr' },
          h('span', { className: 'done-title' }, 'Done (' + done.length + ')'),
          h('button', { className: 'clear-btn', 'data-action': 'clear-done' }, 'Clear completed'),
        ),
      );
      done.forEach(function (t) { doneSec.appendChild(mkTask(t)); });
      el.appendChild(doneSec);
    }
  }

  // Render only the active panel (avoids duplicate IDs across hidden panels)
  function renderCurrent() {
    if (view === 'picker') renderPicker(); else renderAll();
  }

  // ── Actions ────────────────────────────────────────────────────────────
  async function doAdd() {
    var p     = '#panel-' + view + ' ';
    var title = (document.querySelector(p + '.add-title-input')?.value || '').trim();
    if (!title) return;
    var due      = document.querySelector(p + '.due-date-input')?.value || null;
    var priority = !!document.querySelector(p + '.add-priority-check')?.checked;

    var maxOrder = tasks.reduce(function (m, t) { return (t.sort_order != null && t.level === addForm.level) ? Math.max(m, t.sort_order) : m; }, 0);
    var task = {
      id:         crypto.randomUUID(),
      title:      title,
      level:      addForm.level,
      size:       addForm.size,
      cat:        addForm.cat,
      priority:   priority,
      due:        due || null,
      done:       false,
      created:    Date.now(),
      sort_order: maxOrder + 1000,
      user_id:    session ? session.user.id : null,
    };

    tasks.push(task);
    // Reset title/priority/due; keep level/size/cat for batch entry
    addForm.title    = '';
    addForm.priority = false;
    addForm.due      = '';
    renderCurrent();
    setTimeout(function () {
      document.querySelector('#panel-' + view + ' .add-title-input')?.focus();
    }, 0);

    try {
      await sbInsert(task);
      hideErr();
    } catch (_) {
      showErr();
    }
  }

  async function doToggle(id) {
    var t = tasks.find(function (x) { return x.id === id; });
    if (!t) return;
    t.done = !t.done;
    renderCurrent();
    try {
      await sbPatch(id, { done: t.done });
      hideErr();
    } catch (_) {
      t.done = !t.done; // revert
      renderCurrent();
      showErr();
    }
  }

  async function doDelete(id) {
    var idx = tasks.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;
    var removed = tasks.splice(idx, 1)[0];
    renderCurrent();
    try {
      await sbDelete(id);
      hideErr();
    } catch (_) {
      tasks.splice(idx, 0, removed);
      renderCurrent();
      showErr();
    }
  }

  async function doClearDone() {
    var removed = tasks.filter(function (t) { return t.done; });
    tasks = tasks.filter(function (t) { return !t.done; });
    renderCurrent();
    try {
      await sbDeleteDone();
      hideErr();
    } catch (_) {
      tasks = tasks.concat(removed);
      renderCurrent();
      showErr();
    }
  }

  async function doMoveToGroup(sourceId, targetLevel) {
    var source = tasks.find(function (t) { return t.id === sourceId; });
    if (!source) return;
    var group = tasks
      .filter(function (t) { return t.level === targetLevel && !t.done && t.id !== sourceId; })
      .sort(function (a, b) {
        var ao = (a.sort_order != null) ? a.sort_order : 1e9;
        var bo = (b.sort_order != null) ? b.sort_order : 1e9;
        return ao - bo || a.created - b.created;
      });
    var last     = group[group.length - 1];
    var newOrder = last ? (last.sort_order != null ? last.sort_order + 1000 : 1000) : 1000;
    var oldLevel = source.level;
    var oldOrder = source.sort_order;
    source.level      = targetLevel;
    source.sort_order = newOrder;
    renderCurrent();
    var patch = { sort_order: newOrder };
    if (targetLevel !== oldLevel) patch.level = targetLevel;
    try {
      await sbPatch(sourceId, patch);
      hideErr();
    } catch (_) {
      source.level      = oldLevel;
      source.sort_order = oldOrder;
      renderCurrent();
      showErr();
    }
  }

  async function doReorder(sourceId, targetId, before, newLevel) {
    var source = tasks.find(function (t) { return t.id === sourceId; });
    var target = tasks.find(function (t) { return t.id === targetId; });
    if (!source || !target) return;

    newLevel = newLevel || target.level;

    // Ordered list of target-level open tasks, excluding the source
    var group = tasks
      .filter(function (t) { return t.level === newLevel && !t.done && t.id !== sourceId; })
      .sort(function (a, b) {
        var ao = (a.sort_order != null) ? a.sort_order : 1e9;
        var bo = (b.sort_order != null) ? b.sort_order : 1e9;
        return ao - bo || a.created - b.created;
      });

    var ti  = group.findIndex(function (t) { return t.id === targetId; });
    var cur = group[ti];
    var newOrder;
    if (before) {
      var prev     = group[ti - 1];
      var prevOrd  = prev ? (prev.sort_order != null ? prev.sort_order : 0) : (cur.sort_order != null ? cur.sort_order - 1000 : 0);
      var curOrd   = cur.sort_order != null ? cur.sort_order : prevOrd + 1000;
      newOrder = (prevOrd + curOrd) / 2;
    } else {
      var next     = group[ti + 1];
      var curOrd2  = cur.sort_order != null ? cur.sort_order : 1000;
      var nextOrd  = next ? (next.sort_order != null ? next.sort_order : curOrd2 + 1000) : curOrd2 + 1000;
      newOrder = (curOrd2 + nextOrd) / 2;
    }

    var oldLevel = source.level;
    var oldOrder = source.sort_order;
    source.level      = newLevel;
    source.sort_order = newOrder;
    renderCurrent();

    var patch = { sort_order: newOrder };
    if (newLevel !== oldLevel) patch.level = newLevel;
    try {
      await sbPatch(sourceId, patch);
      hideErr();
    } catch (_) {
      source.level      = oldLevel;
      source.sort_order = oldOrder;
      renderCurrent();
      showErr();
    }
  }

  async function doSaveEdit(id) {
    var p     = '#panel-' + view + ' .edit-form-card ';
    var title = (document.querySelector(p + '.edit-title-input')?.value || '').trim();
    if (!title) return;
    var due      = document.querySelector(p + '.edit-due-input')?.value || null;
    var priority = !!document.querySelector(p + '.edit-priority-check')?.checked;

    var t = tasks.find(function (x) { return x.id === id; });
    if (!t) return;

    var old   = { title: t.title, level: t.level, size: t.size, cat: t.cat, priority: t.priority, due: t.due };
    var patch = { title: title, level: editForm.level, size: editForm.size, cat: editForm.cat, priority: priority, due: due || null };

    Object.assign(t, patch);
    editingId = null;
    renderCurrent();

    try {
      await sbPatch(id, patch);
      hideErr();
    } catch (_) {
      Object.assign(t, old);
      editingId = id;
      editForm  = { title: patch.title, level: patch.level, size: patch.size, cat: patch.cat, priority: patch.priority, due: patch.due || '' };
      renderCurrent();
      showErr();
    }
  }

  // ── Event delegation ───────────────────────────────────────────────────
  document.getElementById('app').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.dataset.action;
    var value  = btn.dataset.value;
    var id     = btn.dataset.id;

    switch (action) {
      case 'switch-tab': {
        view = value;
        addOpen = false;
        document.getElementById('panel-picker').hidden = view !== 'picker';
        document.getElementById('panel-all').hidden    = view !== 'all';
        updateTabBar();
        renderCurrent();
        break;
      }
      case 'toggle-add': {
        addOpen = !addOpen;
        updateTabBar();
        renderCurrent();
        if (addOpen) {
          setTimeout(function () {
            document.querySelector('#panel-' + view + ' .add-title-input')?.focus();
          }, 0);
        }
        break;
      }
      case 'open-add': {
        addOpen = true;
        updateTabBar();
        renderCurrent();
        setTimeout(function () {
          document.querySelector('#panel-' + view + ' .add-title-input')?.focus();
        }, 0);
        break;
      }
      case 'cancel-add': {
        addOpen      = false;
        importOpen   = false;
        importResult = null;
        updateTabBar();
        renderCurrent();
        break;
      }
      case 'open-import': {
        addOpen    = true;
        importOpen = true;
        updateTabBar();
        renderCurrent();
        setTimeout(function () {
          var ta = document.querySelector('.import-textarea');
          if (ta) ta.focus();
        }, 0);
        break;
      }
      case 'cancel-import': {
        importOpen   = false;
        addOpen      = false;
        importResult = null;
        updateTabBar();
        renderCurrent();
        break;
      }
      case 'submit-import': {
        doImport();
        break;
      }
      case 'submit-add': {
        doAdd();
        break;
      }
      case 'form-level': {
        syncForm();
        addForm.level = parseInt(value, 10);
        renderCurrent();
        break;
      }
      case 'form-size': {
        syncForm();
        addForm.size = value;
        renderCurrent();
        break;
      }
      case 'form-cat': {
        syncForm();
        addForm.cat = value;
        renderCurrent();
        break;
      }
      case 'start-edit': {
        var t = tasks.find(function (x) { return x.id === id; });
        if (!t) break;
        editingId = id;
        editForm  = { title: t.title, level: t.level, size: t.size, cat: t.cat, priority: t.priority, due: t.due || '' };
        renderCurrent();
        setTimeout(function () {
          document.querySelector('#panel-' + view + ' .edit-title-input')?.focus();
        }, 0);
        break;
      }
      case 'cancel-edit': {
        editingId = null;
        renderCurrent();
        break;
      }
      case 'save-edit': {
        doSaveEdit(id);
        break;
      }
      case 'edit-level': {
        syncEditForm();
        editForm.level = parseInt(value, 10);
        renderCurrent();
        break;
      }
      case 'edit-size': {
        syncEditForm();
        editForm.size = value;
        renderCurrent();
        break;
      }
      case 'edit-cat': {
        syncEditForm();
        editForm.cat = value;
        renderCurrent();
        break;
      }
      case 'pick-level': {
        var n = parseInt(value, 10);
        picker.level = picker.level === n ? null : n;
        renderPicker();
        break;
      }
      case 'pick-time': {
        var tv = value === 'any' ? 'any' : parseInt(value, 10);
        picker.time = picker.time === tv ? null : tv;
        renderPicker();
        break;
      }
      case 'toggle':      doToggle(id);   break;
      case 'delete':      doDelete(id);   break;
      case 'clear-done':  doClearDone();  break;
      case 'dismiss-error': hideErr();    break;
      case 'sign-out':      doSignOut();  break;
    }
  });

  // ── Auth overlay events ────────────────────────────────────────────────
  document.getElementById('auth-overlay').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'auth-toggle':
        authMode  = authMode === 'signin' ? 'signup' : 'signin';
        authError = '';
        renderAuth();
        break;
      case 'auth-submit':
        doAuth();
        break;
      case 'auth-goto-signin':
        authMode  = 'signin';
        authError = '';
        renderAuth();
        break;
    }
  });

  document.getElementById('auth-overlay').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') doAuth();
  });

  // ── Drag-to-reorder (pointer events — works on desktop, Android, iOS) ──────────────
  document.getElementById('app').addEventListener('pointerdown', function (e) {
    if (!e.target.closest('.drag-handle')) return;
    var card = e.target.closest('.task-card[data-id]');
    if (!card || card.classList.contains('done')) return;
    var r       = card.getBoundingClientRect();
    drag.id     = card.dataset.id;
    drag.el     = card;
    drag.pid    = e.pointerId;
    drag.elLeft = r.left;
    drag.elTop  = r.top;
    drag.initX  = e.clientX;
    drag.initY  = e.clientY;
    e.target.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  document.addEventListener('pointermove', function (e) {
    if (!drag.id || e.pointerId !== drag.pid) return;
    var dx = e.clientX - drag.initX;
    var dy = e.clientY - drag.initY;

    if (!drag.ghost && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      drag.ghost = drag.el.cloneNode(true);
      Object.assign(drag.ghost.style, {
        position: 'fixed', pointerEvents: 'none', zIndex: '9999',
        width: drag.el.offsetWidth + 'px',
        left: drag.elLeft + 'px', top: drag.elTop + 'px',
        opacity: '0.9', boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
        borderRadius: '8px', transition: 'none',
      });
      document.body.appendChild(drag.ghost);
      drag.el.style.opacity = '0.3';
    }

    if (drag.ghost) {
      drag.ghost.style.left = (drag.elLeft + dx) + 'px';
      drag.ghost.style.top  = (drag.elTop  + dy) + 'px';

      drag.ghost.style.visibility = 'hidden';
      var under = document.elementFromPoint(e.clientX, e.clientY);
      drag.ghost.style.visibility = '';

      if (drag.overEl) drag.overEl.classList.remove('drop-above', 'drop-below');

      var overCard = under && under.closest('.task-card[data-id]');
      if (overCard && overCard !== drag.el && !overCard.classList.contains('done')) {
        var cr     = overCard.getBoundingClientRect();
        var before = e.clientY < cr.top + cr.height / 2;
        overCard.classList.toggle('drop-above', before);
        overCard.classList.toggle('drop-below', !before);
        drag.overEl     = overCard;
        drag.overId     = overCard.dataset.id;
        drag.overBefore = before;
        // Clear group highlight
        if (drag.overGroupEl) { drag.overGroupEl.classList.remove('drag-over-group'); drag.overGroupEl = null; drag.overGroupLevel = null; }
      } else {
        drag.overEl = null;
        drag.overId = null;
        // Check if hovering over a group section (including empty ones)
        var groupSec = under && under.closest('.group-sec[data-level]');
        if (drag.overGroupEl && drag.overGroupEl !== groupSec) {
          drag.overGroupEl.classList.remove('drag-over-group');
          drag.overGroupEl = null;
          drag.overGroupLevel = null;
        }
        if (groupSec) {
          groupSec.classList.add('drag-over-group');
          drag.overGroupEl    = groupSec;
          drag.overGroupLevel = parseInt(groupSec.dataset.level, 10);
        }
      }
    }
  });

  function commitDrop() {
    if (drag.ghost)      { drag.ghost.remove(); drag.ghost = null; }
    if (drag.el)         { drag.el.style.opacity = ''; }
    if (drag.overEl)     { drag.overEl.classList.remove('drop-above', 'drop-below'); }
    if (drag.overGroupEl){ drag.overGroupEl.classList.remove('drag-over-group'); }

    if (drag.overId && drag.overId !== drag.id) {
      var targetCard = document.querySelector('.task-card[data-id="' + drag.overId + '"]');
      var lvl = null;
      if (targetCard) {
        var gs = targetCard.closest('.group-sec');
        lvl = gs ? parseInt(gs.dataset.level, 10) : (picker.level || null);
      }
      doReorder(drag.id, drag.overId, drag.overBefore, lvl);
    } else if (drag.overGroupLevel != null && drag.id) {
      doMoveToGroup(drag.id, drag.overGroupLevel);
    }
    drag.id = drag.el = drag.overId = drag.overEl = drag.overGroupEl = null;
    drag.overGroupLevel = null;
    drag.pid = null;
  }
  document.addEventListener('pointerup',     commitDrop);
  document.addEventListener('pointercancel', commitDrop);

  // Keyboard shortcuts for forms
  document.getElementById('app').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      if (e.target.classList.contains('add-title-input')) {
        doAdd();
      } else if (e.target.classList.contains('edit-title-input')) {
        var card = e.target.closest('.edit-form-card');
        if (card) doSaveEdit(card.dataset.id);
      }
    }
    if (e.key === 'Escape' && editingId) {
      editingId = null;
      renderCurrent();
    }
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────
  initAuth().then(function (authenticated) {
    if (authenticated) {
      startApp();
    } else {
      document.getElementById('app').hidden = true;
      document.getElementById('auth-overlay').hidden = false;
      renderAuth();
    }
  });
})();
