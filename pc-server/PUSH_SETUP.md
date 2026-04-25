# Setup — Web Push notifications

Procédure pour activer les notifications push hors-onglet sur ton PC-server.

## 1. Installer le package

Dans `pc-server/` :

```bash
npm install
```

(Le `package.json` contient déjà `web-push` ajouté en phase 10.)

## 2. Exécuter la migration SQL

Dans **Supabase Dashboard → SQL Editor**, exécute le contenu de :

```
equipe/sql/phase10.sql
```

Ça crée la table `push_subscriptions` + RLS.

## 3. Ajouter les clés VAPID dans `.env`

Les clés ont déjà été générées pour toi :

```
VAPID_PUBLIC_KEY=BB9Jz7_5op7x8mUZ7H4eMjo8yrcWyjmXCAmQnZiY8Rs5VF0D2uqXnJZ_lfQKo4sJY9n94pLjANblv_fzV8irmiw
VAPID_PRIVATE_KEY=6cnKUPPwzMdgF-m17n0a5TH9dedaV4-t122Lc3qKBYo
VAPID_SUBJECT=mailto:contact@guindoconstruction.xyz
```

Ajoute ces 3 lignes à `pc-server/.env` (à côté des autres variables).

> ⚠️ Garde la clé privée **secrète** — ne la partage jamais publiquement.
> Si tu veux régénérer une paire (par exemple si la privée a fuité) :
> ```bash
> npx web-push generate-vapid-keys
> ```
> Tous les abonnements existants devront être recréés (table `push_subscriptions` à vider).

## 4. Redémarrer le pc-server

```bash
# Arrête le serveur en cours (Ctrl+C), puis :
npm start
```

Tu dois voir :
```
🔔 Web Push activé
```

## 5. Côté utilisateur — s'abonner

Chaque membre de l'équipe doit aller sur **Mon profil** → bouton **🔔 Activer les notifications push**.

Le navigateur demandera la permission. Une fois acceptée, l'utilisateur recevra des notifs push même si l'onglet/PWA est fermé.

## 6. Test

1. Connecte-toi sur PC avec compte A
2. Active push depuis "Mon profil"
3. Ferme l'onglet
4. Sur ton téléphone (ou un autre device avec compte B), envoie un message dans le chat
5. Tu dois recevoir une notification système sur le PC

## Compatibilité

- ✅ Chrome / Edge / Brave (Windows, Mac, Linux, Android)
- ✅ Firefox (toutes plateformes)
- ✅ Safari macOS 16+
- ✅ Safari iOS 16.4+ (uniquement si l'app est **installée en PWA**)
- ❌ Pas supporté sur des navigateurs très anciens

## Dépannage

- **"Push non configuré côté serveur"** : VAPID keys absentes du `.env` ou mauvaises
- **Permission refusée** : l'utilisateur doit aller dans les paramètres du navigateur pour ré-autoriser
- **Pas de notif sur iOS** : il faut l'installer en PWA (icône Partage → Sur l'écran d'accueil)
- **Endpoints expirés (404/410)** : nettoyés automatiquement par le pc-server
