# Guide de Déploiement GCBTP - GitHub Pages

## Problème Résolu : Images qui ne s'affichent pas

### Cause du problème
Les images ne s'affichaient pas sur GitHub Pages car les chemins dans le code HTML ne correspondaient pas aux noms réels des fichiers d'images.

### Corrections apportées

#### 1. Fichier `index.html`
- ✅ `Images/hotel1.png` → `Images/Hotel1.png`
- ✅ `Images/hotel2.png` → `Images/Hotel2.png`
- ✅ `Images/hotel3.png` → `Images/Hotel3.png`
- ✅ `Images/hotel4.png` → `Images/Hotel4.png`
- ✅ `Images/hotel5.png` → `Images/Hotel5.png`
- ✅ `Images/hotel6.png` → `Images/Hotel6.png`

#### 2. Fichier `hotel-medina-gardens.html`
- ✅ `Images/hotel2-1.png` → `Images/Hotel2.png`
- ✅ `Images/hotel2-2.png` → `Images/Hotel2.png`
- ✅ `Images/hotel2-3.png` → `Images/Hotel2.png`

#### 3. Fichier `hotel-hopital-ibn-rochd.html`
- ✅ `Images/hotel3-1.png` → `Images/Hotel3.png`
- ✅ `Images/hotel3-2.png` → `Images/Hotel3.png`
- ✅ `Images/hotel3-3.png` → `Images/Hotel3.png`

## Comment déployer les corrections

### Option 1 : Script automatique (Recommandé)
```bash
# Windows (PowerShell)
.\deploy_to_github.ps1

# Windows (Command Prompt)
deploy_to_github.bat
```

### Option 2 : Commandes manuelles
```bash
git add .
git commit -m "Fix: Correction des chemins des images pour GitHub Pages"
git push origin main
```

## Vérification après déploiement

1. **Attendez 5-10 minutes** pour la propagation GitHub Pages
2. **Visitez votre site** : https://giundo09.github.io/Guindo-construction/
3. **Vérifiez que les images s'affichent** :
   - Logo dans le header
   - Image de couverture (hero)
   - Images des projets
   - Images du bureau

## Structure des fichiers d'images

```
Images/
├── LOGO.jpg                    ✅ Utilisé dans le header
├── acceuil.png                 ✅ Image de couverture
├── bureau gcbtp.png           ✅ Image du bureau
├── gcbtp1.png                 ✅ Image du bureau
├── b1.png, b2.png, b3.png     ✅ Images du bureau
├── Hotel1.png                 ✅ Projet 1
├── Hotel2.png                 ✅ Projet 2
├── Hotel3.png                 ✅ Projet 3
├── Hotel4.png                 ✅ Projet 4
├── Hotel5.png                 ✅ Projet 5
├── Hotel6.png                 ✅ Projet 6
├── 4.png                      ✅ Image carrières
└── hotel/
    ├── h1.png                 ✅ Détail projet
    ├── h2.png                 ✅ Détail projet
    └── h3.png                 ✅ Détail projet
```

## Conseils pour éviter ce problème à l'avenir

1. **Vérifiez les noms de fichiers** avant de référencer les images
2. **Utilisez des noms cohérents** (évitez les espaces et caractères spéciaux)
3. **Testez localement** avant de déployer
4. **Vérifiez la casse** (majuscules/minuscules) des noms de fichiers

## Support

Si vous rencontrez encore des problèmes :
1. Vérifiez la console du navigateur (F12) pour les erreurs 404
2. Vérifiez que le dossier `Images/` est bien présent dans votre dépôt GitHub
3. Vérifiez que les noms de fichiers correspondent exactement (sensible à la casse)

---
**GCBTP** - Bureau d'Études Techniques
Site web : https://giundo09.github.io/Guindo-construction/
