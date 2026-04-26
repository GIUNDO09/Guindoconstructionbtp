(() => {
  const { sb } = window.gcbtp;

  async function requireAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    return session;
  }

  async function logout() {
    await sb.auth.signOut();
    window.location.href = 'index.html';
  }

  async function currentProfile() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
    return data;
  }

  // -----------------------------------------------------------
  // Cache sessionStorage : accélère la nav entre onglets en évitant
  // de refetch les données qui changent rarement.
  // Pattern : "stale-while-revalidate" — on retourne le cache immédiatement
  // si présent, et on rafraîchit en arrière-plan pour la prochaine fois.
  // -----------------------------------------------------------
  function readCache(key, ttlMs) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const { value, at } = JSON.parse(raw);
      if (Date.now() - at > ttlMs) return null;
      return value;
    } catch { return null; }
  }
  function writeCache(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify({ value, at: Date.now() })); } catch {}
  }
  function invalidateCache(prefix) {
    try {
      const keys = Object.keys(sessionStorage).filter(k => !prefix || k.startsWith(prefix));
      keys.forEach(k => sessionStorage.removeItem(k));
    } catch {}
  }

  // serverUrl : change rarement, cache 5 min
  async function getServerUrl({ refresh = false } = {}) {
    const KEY = 'gcbtp.serverUrl';
    if (!refresh) {
      const cached = readCache(KEY, 5 * 60 * 1000);
      if (cached !== null) {
        // Revalide en arrière-plan
        sb.from('app_settings').select('value').eq('key', 'file_server_url').maybeSingle()
          .then(({ data }) => { if (data?.value) writeCache(KEY, data.value); }).catch(() => {});
        return cached;
      }
    }
    const { data } = await sb.from('app_settings').select('value').eq('key', 'file_server_url').maybeSingle();
    const url = data?.value || null;
    if (url) writeCache(KEY, url);
    return url;
  }

  // profiles (la liste de tous les membres) : cache 60s
  async function getProfiles({ refresh = false } = {}) {
    const KEY = 'gcbtp.profiles';
    if (!refresh) {
      const cached = readCache(KEY, 60 * 1000);
      if (cached) {
        sb.from('profiles').select('*').then(({ data }) => { if (data) writeCache(KEY, data); }).catch(() => {});
        return cached;
      }
    }
    const { data } = await sb.from('profiles').select('*');
    if (data) writeCache(KEY, data);
    return data || [];
  }

  // Mon profil : cache 5 min
  async function getMe({ refresh = false } = {}) {
    const KEY = 'gcbtp.me';
    if (!refresh) {
      const cached = readCache(KEY, 5 * 60 * 1000);
      if (cached) {
        currentProfile().then(p => { if (p) writeCache(KEY, p); }).catch(() => {});
        return cached;
      }
    }
    const me = await currentProfile();
    if (me) writeCache(KEY, me);
    return me;
  }

  window.gcbtp.requireAuth = requireAuth;
  window.gcbtp.logout = logout;
  window.gcbtp.currentProfile = currentProfile;
  window.gcbtp.cache = {
    getServerUrl, getProfiles, getMe, invalidate: invalidateCache
  };

  // -----------------------------------------------------------
  // Auto-monte la pastille avatar du header (toutes pages protégées).
  // L'élément cible est <a id="headerAvatar" class="header-avatar"></a>.
  // -----------------------------------------------------------
  function initialsOf(s) {
    const parts = String(s || '').trim().split(/\s+/);
    if (!parts[0]) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  async function mountHeaderAvatar() {
    const slot = document.getElementById('headerAvatar');
    if (!slot) return;
    const me = await getMe().catch(() => null);
    if (!me) return;

    if (slot.tagName === 'A') {
      slot.href = `profil-public.html?id=${me.id}`;
      slot.title = me.full_name ? `Voir le profil de ${me.full_name}` : 'Mon profil';
    }

    // Initiales par défaut (fallback immédiat, évite le flash vide)
    slot.textContent = initialsOf(me.full_name || '?');

    if (!me.avatar_file_id) return;
    const serverUrl = await getServerUrl().catch(() => null);
    if (!serverUrl) return;
    try {
      const token = (await sb.auth.getSession()).data.session?.access_token;
      if (!token) return;
      const r = await fetch(`${serverUrl}/stream/${me.avatar_file_id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!r.ok) return;
      const blob = await r.blob();
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.alt = '';
      slot.textContent = '';
      slot.appendChild(img);
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountHeaderAvatar);
  } else {
    mountHeaderAvatar();
  }
})();
