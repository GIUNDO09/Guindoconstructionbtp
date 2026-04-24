# Named Tunnel Cloudflare — URL stable `files.guindoconstruction.xyz`

Remplace l'URL aléatoire `xxx.trycloudflare.com` par un sous-domaine fixe `files.guindoconstruction.xyz`. Nécessite de **migrer la gestion DNS de Vercel vers Cloudflare**. Ton site vitrine continue de tourner sur Vercel — on change juste qui gère les enregistrements DNS.

**Temps total : 30-60 min + propagation DNS (jusqu'à quelques heures)**

---

## Étape 1 — Créer un compte Cloudflare (2 min)

1. Va sur https://dash.cloudflare.com/sign-up
2. Crée un compte gratuit
3. Plan : **Free** (0€/mois, suffit largement)

## Étape 2 — Ajouter ton domaine sur Cloudflare (5 min)

1. Sur le dashboard Cloudflare, clique **Add a Site**
2. Entre `guindoconstruction.xyz`
3. Choisis le plan **Free**
4. Cloudflare scanne les DNS existants — **il devrait détecter automatiquement** les enregistrements Vercel. **Vérifie** que les lignes suivantes sont présentes (crée-les manuellement si besoin) :

| Type  | Name | Content                        | Proxy  |
|-------|------|--------------------------------|--------|
| A     | @    | `76.76.21.21`                 | 🟠 Proxied (ou DNS only) |
| CNAME | www  | `cname.vercel-dns.com`        | 🟠 Proxied (ou DNS only) |

👉 Pour l'instant **laisse-les en DNS only** (nuage gris) pour pas casser Vercel.

5. Clique **Continue**

## Étape 3 — Changer les nameservers chez Vercel (5 min)

Cloudflare te donne **2 nameservers** à utiliser, quelque chose comme :
- `xxx.ns.cloudflare.com`
- `yyy.ns.cloudflare.com`

**Copie-les précieusement**.

1. Va sur Vercel : https://vercel.com/dashboard → **Domains** (menu latéral)
2. Clique sur `guindoconstruction.xyz`
3. Section **Nameservers** : remplace ceux de Vercel par ceux de Cloudflare
4. Sauvegarde

⏳ La propagation DNS peut prendre **de 15 min à 24h**. Cloudflare t'envoie un email quand c'est actif.

## Étape 4 — Vérifier que le site vitrine marche toujours

Dès que Cloudflare affiche "Active" sur ton domaine (ou reçois l'email), ouvre `https://www.guindoconstruction.xyz` en navigation privée.

Si le site s'affiche → parfait, on continue.
Si erreur → retour dans Cloudflare DNS, vérifie que les enregistrements vers Vercel sont là et corrects.

## Étape 5 — Créer le Named Tunnel (PowerShell sur ton PC)

Ouvre **PowerShell** (pas admin nécessaire) :

```powershell
cloudflared tunnel login
```

Une fenêtre de navigateur s'ouvre → connecte-toi à ton compte Cloudflare → autorise le tunnel sur `guindoconstruction.xyz`.

Puis crée le tunnel :

```powershell
cloudflared tunnel create gcbtp-files
```

Tu verras quelque chose comme :
```
Created tunnel gcbtp-files with id 12345678-abcd-...
```

**Note l'UUID** (ou garde la fenêtre ouverte).

## Étape 6 — Configurer le tunnel

Crée le fichier `C:\Users\user\.cloudflared\config.yml` avec ce contenu (en remplaçant `UUID_ICI` par l'UUID créé à l'étape 5) :

```yaml
tunnel: UUID_ICI
credentials-file: C:\Users\user\.cloudflared\UUID_ICI.json

ingress:
  - hostname: files.guindoconstruction.xyz
    service: http://localhost:3000
  - service: http_status:404
```

## Étape 7 — Lier le sous-domaine au tunnel

```powershell
cloudflared tunnel route dns gcbtp-files files.guindoconstruction.xyz
```

Cloudflare crée automatiquement un enregistrement DNS CNAME pour `files.guindoconstruction.xyz`.

## Étape 8 — Lancer le tunnel

```powershell
cloudflared tunnel run gcbtp-files
```

Si tout va bien tu verras `Connection registered` et le tunnel est prêt.

Teste dans ton navigateur : `https://files.guindoconstruction.xyz/health` → doit répondre `{"ok":true,...}`.

## Étape 9 — Mettre à jour le manager

Ouvre `pc-server/manager.ps1` et change la ligne :
```powershell
$TunnelMode = 'quick'
```
en :
```powershell
$TunnelMode = 'named'
```

Relance GCBTP Manager. Le bouton « Démarrer tout » utilisera maintenant le Named Tunnel stable.

## Étape 10 — Mettre à jour l'URL dans Supabase

1. Va sur ton site : `https://www.guindoconstruction.xyz/equipe/`
2. Connecte-toi (admin)
3. Onglet **Fichiers** → **⚙️ Config serveur**
4. Remplace par : `https://files.guindoconstruction.xyz`
5. OK

✅ Terminé. Ton serveur est désormais accessible de façon permanente à la même URL.

---

## Si tu veux le lancement automatique au démarrage Windows

Crée un raccourci vers `GCBTP Manager.bat` dans :
```
C:\Users\user\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
```

Ou tape `shell:startup` dans Exécuter (Win+R) et glisse-dépose le .bat.

Au démarrage Windows, l'app se lance ; clique "Démarrer tout".

**Pour un lancement vraiment automatique** (sans interaction), crée à la place un second `.bat` :
```bat
@echo off
cd /d "C:\Users\user\Documents\httpsgithub.comGIUNDO09Guindoconstructionbtp\pc-server"
start /B cmd /c "npm start >> logs\server.log 2>&1"
start /B cmd /c "cloudflared tunnel run gcbtp-files >> logs\tunnel.log 2>&1"
```
et place-le dans `shell:startup`.
