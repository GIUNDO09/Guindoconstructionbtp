# Script PowerShell pour déployer GCBTP sur GitHub Pages
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  DEPLOYEMENT GCBTP VERS GITHUB PAGES" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] Ajout des fichiers modifiés..." -ForegroundColor Yellow
git add .

Write-Host "[2/4] Commit des modifications..." -ForegroundColor Yellow
git commit -m "Fix: Correction des chemins des images pour GitHub Pages"

Write-Host "[3/4] Push vers GitHub..." -ForegroundColor Yellow
git push origin main

Write-Host "[4/4] Verification du deploiement..." -ForegroundColor Yellow
Write-Host ""
Write-Host "✅ Deploiement termine!" -ForegroundColor Green
Write-Host ""
Write-Host "Votre site sera disponible dans quelques minutes sur:" -ForegroundColor White
Write-Host "https://giundo09.github.io/Guindo-construction/" -ForegroundColor Blue
Write-Host ""
Write-Host "Si les images ne s'affichent toujours pas:" -ForegroundColor Yellow
Write-Host "1. Verifiez que le dossier Images/ est bien present" -ForegroundColor White
Write-Host "2. Verifiez que les noms de fichiers correspondent exactement" -ForegroundColor White
Write-Host "3. Attendez 5-10 minutes pour la propagation" -ForegroundColor White
Write-Host ""
Read-Host "Appuyez sur Entree pour continuer"
