// Tiny Supabase REST wrapper — replaces the 90KB Supabase JS SDK on customer-facing pages.
// Only supports what the shop, gallery, and item pages need.
(function () {
    const URL_BASE = 'https://awccquoyscijmtqtibgr.supabase.co';
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3Y2NxdW95c2Npam10cXRpYmdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY4MDI0MDUsImV4cCI6MjA4MjM3ODQwNX0.zUBCXRah_oK8P_Q-1sFwZ5altAFUfZMOdBdY-tuXWrE';
    const HDR = { apikey: KEY, Authorization: 'Bearer ' + KEY };

    async function select(table, params) {
        const qs = new URLSearchParams(params).toString();
        const r = await fetch(`${URL_BASE}/rest/v1/${table}?${qs}`, { headers: HDR });
        if (!r.ok) throw new Error('select ' + table + ' failed: ' + r.status);
        return await r.json();
    }

    async function selectOne(table, params) {
        const qs = new URLSearchParams(params).toString();
        const r = await fetch(`${URL_BASE}/rest/v1/${table}?${qs}`, {
            headers: { ...HDR, Accept: 'application/vnd.pgrst.object+json' }
        });
        if (r.status === 406 || r.status === 404) return null;
        if (!r.ok) throw new Error('selectOne ' + table + ' failed: ' + r.status);
        return await r.json();
    }

    async function insert(table, rows, opts) {
        const ret = (opts && opts.return) || 'minimal';
        const r = await fetch(`${URL_BASE}/rest/v1/${table}`, {
            method: 'POST',
            headers: { ...HDR, 'Content-Type': 'application/json', Prefer: 'return=' + ret },
            body: JSON.stringify(rows)
        });
        if (!r.ok) throw new Error('insert ' + table + ' failed: ' + r.status);
        return ret === 'minimal' ? null : await r.json();
    }

    function imageUrl(bucket, path) {
        if (!path) return null;
        if (path.startsWith('http')) return path;
        if (path.length < 10) return path;
        return `${URL_BASE}/storage/v1/object/public/${bucket}/${path}`;
    }

    // Supabase Image Transformations (Pro plan only). Falls back to `imageUrl` when disabled.
    function thumbUrl(bucket, path, opts) {
        if (!path) return null;
        if (path.startsWith('http')) return path;
        if (path.length < 10) return path;
        if (!opts || !opts.enabled) return imageUrl(bucket, path);
        const q = new URLSearchParams({
            width: opts.width || 700,
            quality: opts.quality || 70,
            resize: opts.resize || 'cover'
        }).toString();
        return `${URL_BASE}/storage/v1/render/image/public/${bucket}/${path}?${q}`;
    }

    window.JWS_API = { URL: URL_BASE, KEY, select, selectOne, insert, imageUrl, thumbUrl };
})();
