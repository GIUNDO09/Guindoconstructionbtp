# Script d'automatisation du déploiement GitHub Pages
# Usage: .\auto-deploy.ps1

param(
    [string]$CommitMessage = "Auto-deploy: Mise à jour du site",
    [switch]$Force = $false
)

# Configuration
$REPO_NAME = "Guindo-construction"
$GITHUB_USERNAME = "giundo09"
$BRANCH = "main"

Write-Host "🚀 Démarrage du déploiement automatique GitHub Pages" -ForegroundColor Green
Write-Host "Repository: $GITHUB_USERNAME/$REPO_NAME" -ForegroundColor Cyan

# Vérifier si Git est initialisé
if (-not (Test-Path ".git")) {
    Write-Host "❌ Erreur: Ce répertoire n'est pas un dépôt Git" -ForegroundColor Red
    Write-Host "Initialisation du dépôt Git..." -ForegroundColor Yellow
    
    git init
    git remote add origin "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"
}

# Vérifier le statut Git
Write-Host "📊 Vérification du statut Git..." -ForegroundColor Yellow
$gitStatus = git status --porcelain

if ($gitStatus -and -not $Force) {
    Write-Host "📝 Fichiers modifiés détectés:" -ForegroundColor Yellow
    Write-Host $gitStatus -ForegroundColor Gray
    
    $response = Read-Host "Voulez-vous continuer le déploiement? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "❌ Déploiement annulé" -ForegroundColor Red
        exit 1
    }
}

# Ajouter tous les fichiers
Write-Host "📁 Ajout des fichiers..." -ForegroundColor Yellow
git add .

# Commit des changements
Write-Host "💾 Création du commit..." -ForegroundColor Yellow
git commit -m $CommitMessage

# Push vers GitHub
Write-Host "⬆️ Push vers GitHub..." -ForegroundColor Yellow
try {
    git push origin $BRANCH
    Write-Host "✅ Push réussi!" -ForegroundColor Green
} catch {
    Write-Host "❌ Erreur lors du push: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Vérifier le déploiement
Write-Host "🔍 Vérification du déploiement..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$siteUrl = "https://$GITHUB_USERNAME.github.io/$REPO_NAME"
Write-Host "🌐 Votre site sera disponible à: $siteUrl" -ForegroundColor Green
Write-Host "📄 Page Hôtel Deep C: $siteUrl/hotel-deep-c.html" -ForegroundColor Cyan

# Ouvrir le site dans le navigateur
$openBrowser = Read-Host "Voulez-vous ouvrir le site dans votre navigateur? (y/N)"
if ($openBrowser -eq "y" -or $openBrowser -eq "Y") {
    Start-Process $siteUrl
}

Write-Host "🎉 Déploiement terminé!" -ForegroundColor Green
Write-Host "⏱️ Le site peut prendre quelques minutes à être mis à jour" -ForegroundColor Yellow
