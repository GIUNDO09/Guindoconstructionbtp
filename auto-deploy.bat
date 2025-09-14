@echo off
REM Script d'automatisation du déploiement GitHub Pages (Windows Batch)
REM Usage: auto-deploy.bat [message_commit]

setlocal enabledelayedexpansion

REM Configuration
set REPO_NAME=Guindo-construction
set GITHUB_USERNAME=giundo09
set BRANCH=main
set COMMIT_MESSAGE=%1
if "%COMMIT_MESSAGE%"=="" set COMMIT_MESSAGE=Auto-deploy: Mise à jour du site

echo 🚀 Démarrage du déploiement automatique GitHub Pages
echo Repository: %GITHUB_USERNAME%/%REPO_NAME%

REM Vérifier si Git est initialisé
if not exist ".git" (
    echo ❌ Erreur: Ce répertoire n'est pas un dépôt Git
    echo Initialisation du dépôt Git...
    git init
    git remote add origin https://github.com/%GITHUB_USERNAME%/%REPO_NAME%.git
)

REM Vérifier le statut Git
echo 📊 Vérification du statut Git...
git status --porcelain > temp_status.txt
set /p GIT_STATUS=<temp_status.txt
del temp_status.txt

if not "%GIT_STATUS%"=="" (
    echo 📝 Fichiers modifiés détectés
    set /p CONTINUE="Voulez-vous continuer le déploiement? (y/N): "
    if /i not "%CONTINUE%"=="y" (
        echo ❌ Déploiement annulé
        exit /b 1
    )
)

REM Ajouter tous les fichiers
echo 📁 Ajout des fichiers...
git add .

REM Commit des changements
echo 💾 Création du commit...
git commit -m "%COMMIT_MESSAGE%"

REM Push vers GitHub
echo ⬆️ Push vers GitHub...
git push origin %BRANCH%
if errorlevel 1 (
    echo ❌ Erreur lors du push
    exit /b 1
)

echo ✅ Push réussi!

REM Vérifier le déploiement
echo 🔍 Vérification du déploiement...
timeout /t 5 /nobreak >nul

set SITE_URL=https://%GITHUB_USERNAME%.github.io/%REPO_NAME%
echo 🌐 Votre site sera disponible à: %SITE_URL%
echo 📄 Page Hôtel Deep C: %SITE_URL%/hotel-deep-c.html

set /p OPEN_BROWSER="Voulez-vous ouvrir le site dans votre navigateur? (y/N): "
if /i "%OPEN_BROWSER%"=="y" (
    start %SITE_URL%
)

echo 🎉 Déploiement terminé!
echo ⏱️ Le site peut prendre quelques minutes à être mis à jour

pause
