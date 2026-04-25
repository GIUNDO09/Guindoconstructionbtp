(() => {
  // Enregistrer le service worker pour rendre l'app installable
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .catch(err => console.warn('SW register failed:', err));
    });
  }

  // Helpers Notification + son partagés
  window.gcbtp = window.gcbtp || {};

  window.gcbtp.notif = {
    async requestPermission() {
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') return false;
      const r = await Notification.requestPermission();
      return r === 'granted';
    },

    show(title, body, options = {}) {
      if (Notification.permission !== 'granted') return null;
      try {
        return new Notification(title, {
          body,
          icon: '../Images/LOGO-1.png',
          badge: '../Images/LOGO-1.png',
          tag: options.tag,
          renotify: true,
          ...options
        });
      } catch (e) {
        console.warn('Notification failed:', e);
      }
    },

    // Bip sonore court via Web Audio (pas de fichier à charger)
    beep(freq = 880, duration = 0.18) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.4, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.start(now);
        osc.stop(now + duration + 0.02);
        // Auto-close ctx après le son pour libérer les ressources
        setTimeout(() => ctx.close().catch(() => {}), 500);
      } catch (e) { /* silent */ }
    },

    // Double bip pour les notifications
    chime() {
      this.beep(880, 0.12);
      setTimeout(() => this.beep(1320, 0.18), 130);
    }
  };
})();
