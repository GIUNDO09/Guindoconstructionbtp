# 🤖 Automatisation GitHub Pages - GCBTP

Ce guide explique comment utiliser les scripts d'automatisation pour déployer votre site GCBTP sur GitHub Pages.

## 🚀 Déploiement Automatique

### Option 1: Script PowerShell (Recommandé)

```powershell
# Déploiement simple
.\auto-deploy.ps1

# Déploiement avec message personnalisé
.\auto-deploy.ps1 -CommitMessage "Ajout de nouvelles fonctionnalités"

# Déploiement forcé (sans confirmation)
.\auto-deploy.ps1 -Force
```

### Option 2: Script Batch (Windows)

```batch
# Déploiement simple
auto-deploy.bat

# Déploiement avec message personnalisé
auto-deploy.bat "Mise à jour du contenu"
```

### Option 3: GitHub Actions (Automatique)

Le workflow `.github/workflows/deploy.yml` se déclenche automatiquement à chaque push sur la branche `main`.

## ⚙️ Configuration Initiale

### 1. Configuration de GitHub Pages

```powershell
# Configuration automatique (nécessite un token GitHub)
.\setup-github-pages.ps1 -GitHubToken "votre_token_github"
```

### 2. Configuration Manuelle

1. Allez sur [GitHub Pages Settings](https://github.com/giundo09/Guindo-construction/settings/pages)
2. Sélectionnez **"Deploy from a branch"**
3. Choisissez **"main"** comme branche source
4. Sélectionnez **"/ (root)"** comme dossier
5. Cliquez sur **"Save"**

## 📁 Fichiers Créés

- `.github/workflows/deploy.yml` - Workflow GitHub Actions
- `auto-deploy.ps1` - Script PowerShell d'automatisation
- `auto-deploy.bat` - Script Batch Windows
- `setup-github-pages.ps1` - Configuration automatique
- `_headers` - Configuration des en-têtes HTTP
- `_redirects` - Redirections et gestion d'erreurs

## 🌐 URLs du Site

Une fois configuré, votre site sera accessible à :

- **Page d'accueil** : https://giundo09.github.io/Guindo-construction/
- **Page Hôtel Deep C** : https://giundo09.github.io/Guindo-construction/hotel-deep-c.html
- **Page Contact** : https://giundo09.github.io/Guindo-construction/contact.html

## 🔧 Fonctionnalités Automatiques

### GitHub Actions
- ✅ Déploiement automatique à chaque push
- ✅ Gestion des permissions
- ✅ Annulation des déploiements en cours
- ✅ URL de déploiement dans les logs

### Scripts Locaux
- ✅ Vérification du statut Git
- ✅ Confirmation avant déploiement
- ✅ Messages de commit personnalisables
- ✅ Ouverture automatique du site
- ✅ Gestion d'erreurs

### Optimisations
- ✅ Cache des ressources statiques
- ✅ En-têtes de sécurité
- ✅ Redirections automatiques
- ✅ Gestion des erreurs 404

## 🛠️ Dépannage

### Erreur 404 persistante
1. Vérifiez que GitHub Pages est activé
2. Attendez 5-10 minutes après le déploiement
3. Videz le cache de votre navigateur

### Erreur de push Git
1. Vérifiez vos identifiants Git
2. Assurez-vous d'avoir les permissions sur le dépôt
3. Vérifiez la connectivité internet

### Workflow GitHub Actions échoue
1. Vérifiez les permissions du dépôt
2. Consultez les logs dans l'onglet "Actions"
3. Vérifiez la syntaxe YAML

## 📞 Support

Pour toute question ou problème :
- Consultez les logs GitHub Actions
- Vérifiez la documentation GitHub Pages
- Contactez l'équipe technique

---

**🎉 Votre site GCBTP est maintenant entièrement automatisé !**
