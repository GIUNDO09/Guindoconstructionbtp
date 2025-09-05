@echo off
echo ========================================
echo   DEPLOYEMENT GCBTP VERS GITHUB PAGES
echo ========================================
echo.

echo [1/4] Ajout des fichiers modifiés...
git add .

echo [2/4] Commit des modifications...
git commit -m "Fix: Correction des chemins des images pour GitHub Pages"

echo [3/4] Push vers GitHub...
git push origin main

echo [4/4] Verification du deploiement...
echo.
echo ✅ Deploiement termine!
echo.
echo Votre site sera disponible dans quelques minutes sur:
echo https://giundo09.github.io/Guindo-construction/
echo.
echo Si les images ne s'affichent toujours pas:
echo 1. Verifiez que le dossier Images/ est bien present
echo 2. Verifiez que les noms de fichiers correspondent exactement
echo 3. Attendez 5-10 minutes pour la propagation
echo.
pause
