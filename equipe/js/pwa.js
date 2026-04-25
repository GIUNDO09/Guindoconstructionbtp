(() => {
  // Enregistrer le service worker pour rendre l'app installable
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .catch(err => console.warn('SW register failed:', err));
    });
  }

  // Bouton "Installer l'app" — capture l'événement beforeinstallprompt
  // (Chrome/Edge desktop & Android). Sur iOS, on doit afficher des instructions.
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.querySelectorAll('[data-install-app]').forEach(btn => {
      btn.hidden = false;
      btn.onclick = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        btn.hidden = true;
      };
    });
  });

  // Quand l'app est installée, masquer les boutons
  window.addEventListener('appinstalled', () => {
    document.querySelectorAll('[data-install-app]').forEach(b => b.hidden = true);
  });

  // Détection iOS Safari (pas de beforeinstallprompt) → on garde le bouton
  // pour afficher des instructions
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isIOS && !isStandalone) {
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('[data-install-app]').forEach(btn => {
        btn.hidden = false;
        btn.onclick = () => alert(
          'Pour installer l\'app sur iPhone :\n\n' +
          '1. Touche le bouton Partager (carré avec flèche vers le haut)\n' +
          '2. Fais défiler et choisis « Sur l\'écran d\'accueil »\n' +
          '3. Touche « Ajouter »'
        );
      });
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
