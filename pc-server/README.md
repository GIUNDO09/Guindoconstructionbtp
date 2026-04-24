# GCBTP — Serveur de fichiers sur le PC

Ce dossier contient le petit serveur Node.js qui tourne sur **ton PC** et sert les fichiers de chantier aux membres de l'équipe via un tunnel Cloudflare (accès HTTPS depuis Internet, sans ouvrir de ports sur ta box).

## 1. Installation (à faire une seule fois)

### 1.1 Installer Cloudflared (le tunnel)

Ouvre **PowerShell en administrateur** et lance :

```powershell
winget install --id Cloudflare.cloudflared
```

Si `winget` n'est pas disponible, télécharge le MSI ici : https://github.com/cloudflare/cloudflared/releases (prends le fichier `cloudflared-windows-amd64.msi`) puis installe-le.

Vérifie :
```powershell
cloudflared --version
```

### 1.2 Installer les dépendances du serveur

Dans PowerShell, va dans le dossier du serveur :

```powershell
cd C:\Users\user\Documents\httpsgithub.comGIUNDO09Guindoconstructionbtp\pc-server
npm install
```

### 1.3 Créer le fichier `.env`

Copie `.env.example` en `.env` :
```powershell
copy .env.example .env
```

Le fichier par défaut est déjà bon. Tu peux modifier `FILES_DIR` si tu veux changer l'endroit de stockage.

## 2. Lancement au quotidien

Tu dois avoir **2 fenêtres PowerShell ouvertes** en permanence :

### Fenêtre 1 : le serveur Node

```powershell
cd C:\Users\user\Documents\httpsgithub.comGIUNDO09Guindoconstructionbtp\pc-server
npm start
```

Tu verras :
```
✅ Serveur GCBTP démarré sur http://localhost:3000
```

### Fenêtre 2 : le tunnel Cloudflare

```powershell
cloudflared tunnel --url http://localhost:3000
```

Après 10-20 secondes, tu verras quelque chose comme :
```
Your quick tunnel has been created! Visit it at:
https://something-random-words-here.trycloudflare.com
```

👉 **Copie cette URL** (ex. `https://my-tunnel-xyz.trycloudflare.com`)

## 3. Connecter le site à ton serveur

Une fois que tu as l'URL du tunnel :

1. Va sur ton site : `https://www.guindoconstruction.xyz/equipe/`
2. Connecte-toi (admin)
3. Va dans l'onglet **Fichiers**
4. Clique sur **⚙️ Config serveur** en haut à droite
5. Colle l'URL du tunnel (sans `/` final) et enregistre

L'URL est sauvegardée dans la base Supabase et partagée automatiquement avec tous les membres.

## 4. Important

- ⚠️ **L'URL du tunnel change à chaque redémarrage** de `cloudflared` (c'est un tunnel rapide gratuit). Pour une URL fixe, il faudrait configurer un tunnel « named » avec un compte Cloudflare — voir plus bas.
- Garde les 2 fenêtres PowerShell ouvertes. Si tu les fermes, le service s'arrête.
- Si ton PC redémarre, il faut relancer les 2 commandes.

## 5. (Optionnel) Lancement automatique au démarrage

Pour que le serveur redémarre automatiquement avec Windows, deux options :

### Option simple : raccourcis dans le dossier Démarrage

1. Crée un fichier `start-server.bat` sur ton bureau :
   ```bat
   @echo off
   cd /d C:\Users\user\Documents\httpsgithub.comGIUNDO09Guindoconstructionbtp\pc-server
   npm start
   ```
2. Crée `start-tunnel.bat` :
   ```bat
   @echo off
   cloudflared tunnel --url http://localhost:3000
   ```
3. Déplace-les dans `shell:startup` (tape ça dans Exécuter).

### Option avancée : Named Tunnel avec URL fixe

Si tu veux une URL stable type `files.guindoconstruction.xyz` au lieu d'une URL aléatoire, il faut :
1. Créer un compte Cloudflare gratuit
2. Transférer la gestion DNS de ton domaine sur Cloudflare (il faut changer les nameservers chez Vercel)
3. Lancer `cloudflared tunnel login` puis créer un tunnel nommé

Dis-le moi quand tu veux passer à cette étape.
