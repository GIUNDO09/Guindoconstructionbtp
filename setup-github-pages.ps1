# Script de configuration automatique de GitHub Pages
# Ce script configure GitHub Pages via l'API GitHub

param(
    [string]$GitHubToken = "",
    [string]$Repository = "giundo09/Guindo-construction"
)

Write-Host "🔧 Configuration automatique de GitHub Pages" -ForegroundColor Green

# Vérifier si un token GitHub est fourni
if (-not $GitHubToken) {
    Write-Host "⚠️ Token GitHub requis pour la configuration automatique" -ForegroundColor Yellow
    Write-Host "Vous pouvez obtenir un token sur: https://github.com/settings/tokens" -ForegroundColor Cyan
    Write-Host "Permissions nécessaires: repo, admin:org" -ForegroundColor Gray
    
    $GitHubToken = Read-Host "Entrez votre token GitHub (ou appuyez sur Entrée pour ignorer)"
    
    if (-not $GitHubToken) {
        Write-Host "❌ Configuration automatique ignorée" -ForegroundColor Red
        Write-Host "📋 Instructions manuelles:" -ForegroundColor Yellow
        Write-Host "1. Allez sur https://github.com/$Repository/settings/pages" -ForegroundColor White
        Write-Host "2. Sélectionnez 'Deploy from a branch'" -ForegroundColor White
        Write-Host "3. Choisissez 'main' comme branche source" -ForegroundColor White
        Write-Host "4. Sélectionnez '/ (root)' comme dossier" -ForegroundColor White
        Write-Host "5. Cliquez sur 'Save'" -ForegroundColor White
        exit 0
    }
}

# Configuration de GitHub Pages via API
$headers = @{
    "Authorization" = "token $GitHubToken"
    "Accept" = "application/vnd.github.v3+json"
    "User-Agent" = "GitHub-Pages-Setup"
}

$body = @{
    source = @{
        branch = "main"
        path = "/"
    }
} | ConvertTo-Json -Depth 3

try {
    Write-Host "📡 Configuration de GitHub Pages..." -ForegroundColor Yellow
    
    $response = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/pages" -Method "POST" -Headers $headers -Body $body -ContentType "application/json"
    
    Write-Host "✅ GitHub Pages configuré avec succès!" -ForegroundColor Green
    Write-Host "🌐 URL du site: https://giundo09.github.io/Guindo-construction/" -ForegroundColor Cyan
    
} catch {
    Write-Host "❌ Erreur lors de la configuration: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response.StatusCode -eq 422) {
        Write-Host "ℹ️ GitHub Pages est peut-être déjà configuré" -ForegroundColor Yellow
    }
    
    Write-Host "📋 Configuration manuelle requise:" -ForegroundColor Yellow
    Write-Host "1. Allez sur https://github.com/$Repository/settings/pages" -ForegroundColor White
    Write-Host "2. Sélectionnez 'Deploy from a branch'" -ForegroundColor White
    Write-Host "3. Choisissez 'main' comme branche source" -ForegroundColor White
    Write-Host "4. Sélectionnez '/ (root)' comme dossier" -ForegroundColor White
    Write-Host "5. Cliquez sur 'Save'" -ForegroundColor White
}

Write-Host "🚀 Utilisez '.\auto-deploy.ps1' pour déployer automatiquement" -ForegroundColor Green
