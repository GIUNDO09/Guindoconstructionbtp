// =========================================================
// GCBTP — Web Push subscription helper
// Expose window.gcbtp.push avec subscribe/unsubscribe/status
// =========================================================
(() => {
  window.gcbtp = window.gcbtp || {};

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function getServerUrl() {
    const sb = window.gcbtp.sb;
    if (!sb) return null;
    const { data } = await sb.from('app_settings').select('value').eq('key', 'file_server_url').maybeSingle();
    return data?.value || null;
  }

  async function getRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    try { return await navigator.serviceWorker.ready; } catch { return null; }
  }

  async function getCurrentSubscription() {
    const reg = await getRegistration();
    if (!reg) return null;
    return reg.pushManager.getSubscription();
  }

  async function isSubscribed() {
    const s = await getCurrentSubscription();
    return !!s;
  }

  async function subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('Push non supporté par ce navigateur');
    }
    const perm = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Permission refusée');

    const serverUrl = await getServerUrl();
    if (!serverUrl) throw new Error('Serveur non configuré');

    // Récupérer la clé publique VAPID depuis le pc-server
    const r = await fetch(`${serverUrl}/push/vapid-public-key`);
    if (!r.ok) throw new Error('Clé VAPID indisponible — push pas configuré côté serveur');
    const { key } = await r.json();

    const reg = await getRegistration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      });
    }

    // Enregistrer côté serveur
    const token = (await window.gcbtp.sb.auth.getSession()).data.session?.access_token;
    if (!token) throw new Error('Non connecté');
    const subJson = sub.toJSON();
    const r2 = await fetch(`${serverUrl}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ endpoint: subJson.endpoint, keys: subJson.keys })
    });
    if (!r2.ok) throw new Error('Échec enregistrement subscription');
    return sub;
  }

  async function unsubscribe() {
    const sub = await getCurrentSubscription();
    if (!sub) return;
    const serverUrl = await getServerUrl();
    if (serverUrl) {
      try {
        const token = (await window.gcbtp.sb.auth.getSession()).data.session?.access_token;
        await fetch(`${serverUrl}/push/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ endpoint: sub.endpoint })
        });
      } catch {}
    }
    await sub.unsubscribe();
  }

  window.gcbtp.push = { subscribe, unsubscribe, isSubscribed };
})();
