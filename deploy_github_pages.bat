@echo off
REM === Script d'automatisation du déploiement GitHub Pages ===

REM Configuration utilisateur
set REPO=https://github.com/guindomhg/gcbtp-website.git
set BRANCH=main

REM Initialisation du dépôt (si besoin)
git init

git remote remove origin 2>nul
REM Ajout du remote origin
git remote add origin %REPO%

git add .
git commit -m "Mise en ligne du site GCBTP"
git branch -M %BRANCH%
git push -u origin %BRANCH%

REM Message de fin
echo.
echo "Site envoye sur GitHub!"
echo "Activez GitHub Pages dans les settings du repo si ce n'est pas deja fait."
pause 