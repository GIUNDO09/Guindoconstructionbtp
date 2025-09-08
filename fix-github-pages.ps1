# Script PowerShell pour réparer GitHub Pages
Write-Host "🚀 Réparation GitHub Pages pour GCBTP..." -ForegroundColor Green
Write-Host ""

# Vérification du statut
Write-Host "📋 Vérification du statut Git..." -ForegroundColor Yellow
git status

Write-Host ""
Write-Host "📦 Ajout des fichiers..." -ForegroundColor Yellow
git add .

Write-Host ""
Write-Host "💾 Commit des modifications..." -ForegroundColor Yellow
git commit -m "🔧 Fix: Configuration formulaire devis + GitHub Pages"

Write-Host ""
Write-Host "🚀 Push vers GitHub (force)..." -ForegroundColor Yellow
git push origin main --force

Write-Host ""
Write-Host "✅ Déploiement terminé !" -ForegroundColor Green
Write-Host "🌐 Votre site sera disponible dans quelques minutes à :" -ForegroundColor Cyan
Write-Host "   https://giundo09.github.io/Guindo-construction/" -ForegroundColor Cyan
Write-Host ""
Write-Host "📧 Pour tester les emails de devis, utilisez le bouton 'Test Email Devis'" -ForegroundColor Magenta
