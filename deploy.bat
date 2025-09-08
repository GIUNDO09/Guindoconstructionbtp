@echo off
echo 🚀 Déploiement du site GCBTP sur GitHub Pages...
echo.

echo 📋 Vérification du statut Git...
git status

echo.
echo 📦 Ajout des fichiers modifiés...
git add .

echo.
echo 💾 Commit des modifications...
git commit -m "🔧 Fix: Configuration formulaire devis + GitHub Pages"

echo.
echo 🚀 Push vers GitHub...
git push origin main

echo.
echo ✅ Déploiement terminé !
echo 🌐 Votre site sera disponible dans quelques minutes à :
echo    https://giundo09.github.io/Guindo-construction/
echo.
pause
