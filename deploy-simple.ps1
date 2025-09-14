# Script d'automatisation du déploiement GitHub Pages (version simplifiee)
# Usage: .\deploy-simple.ps1

param(
    [string]$CommitMessage = "Auto-deploy: Mise a jour du site",
    [switch]$Force = $false
)

# Configuration
$REPO_NAME = "Guindo-construction"
$GITHUB_USERNAME = "giundo09"
$BRANCH = "main"

Write-Host "Demarrage du deploiement automatique GitHub Pages" -ForegroundColor Green
Write-Host "Repository: $GITHUB_USERNAME/$REPO_NAME" -ForegroundColor Cyan

# Verifier si Git est initialise
if (-not (Test-Path ".git")) {
    Write-Host "Erreur: Ce repertoire n'est pas un depot Git" -ForegroundColor Red
    Write-Host "Initialisation du depot Git..." -ForegroundColor Yellow
    
    git init
    git remote add origin "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"
}

# Verifier le statut Git
Write-Host "Verification du statut Git..." -ForegroundColor Yellow
$gitStatus = git status --porcelain

if ($gitStatus -and -not $Force) {
    Write-Host "Fichiers modifies detectes:" -ForegroundColor Yellow
    Write-Host $gitStatus -ForegroundColor Gray
    
    $response = Read-Host "Voulez-vous continuer le deploiement? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "Deploiement annule" -ForegroundColor Red
        exit 1
    }
}

# Ajouter tous les fichiers
Write-Host "Ajout des fichiers..." -ForegroundColor Yellow
git add .

# Commit des changements
Write-Host "Creation du commit..." -ForegroundColor Yellow
git commit -m $CommitMessage

# Push vers GitHub
Write-Host "Push vers GitHub..." -ForegroundColor Yellow
try {
    git push origin $BRANCH
    Write-Host "Push reussi!" -ForegroundColor Green
} catch {
    Write-Host "Erreur lors du push: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Verifier le deploiement
Write-Host "Verification du deploiement..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

$siteUrl = "https://$GITHUB_USERNAME.github.io/$REPO_NAME"
Write-Host "Votre site sera disponible a: $siteUrl" -ForegroundColor Green
Write-Host "Page Hotel Deep C: $siteUrl/hotel-deep-c.html" -ForegroundColor Cyan

# Ouvrir le site dans le navigateur
$openBrowser = Read-Host "Voulez-vous ouvrir le site dans votre navigateur? (y/N)"
if ($openBrowser -eq "y" -or $openBrowser -eq "Y") {
    Start-Process $siteUrl
}

Write-Host "Deploiement termine!" -ForegroundColor Green
Write-Host "Le site peut prendre quelques minutes a etre mis a jour" -ForegroundColor Yellow
