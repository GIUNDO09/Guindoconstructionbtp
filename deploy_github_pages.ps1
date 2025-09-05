# Script PowerShell d'automatisation du déploiement GitHub Pages

# Demande du token GitHub
$token = Read-Host -Prompt "Entrez votre token GitHub (PAT) avec droits repo/public_repo"

# Variables
$repo = "guindomhg/gcbtp-website"
$remote = "https://github.com/guindomhg/gcbtp-website.git"
$branch = "main"

# Initialisation du dépôt (si besoin)
git init
try { git remote remove origin } catch {}
git remote add origin $remote

git add .
git commit -m "Mise en ligne du site GCBTP via PowerShell"
git branch -M $branch
git push -u origin $branch

Write-Host "Code poussé sur GitHub. Activation de GitHub Pages..."

# Activation GitHub Pages via l'API
$headers = @{ Authorization = "token $token"; Accept = "application/vnd.github+json" }
$body = @{ source = @{ branch = $branch; path = "/" } } | ConvertTo-Json
$uri = "https://api.github.com/repos/$repo/pages"

$response = Invoke-RestMethod -Uri $uri -Method PUT -Headers $headers -Body $body

if ($response -or $LASTEXITCODE -eq 0) {
    Write-Host "GitHub Pages activé avec succès !"
    Write-Host "Votre site sera bientôt en ligne à : https://guindomhg.github.io/gcbtp-website/"
} else {
    Write-Host "Erreur lors de l'activation de GitHub Pages. Vérifiez votre token et vos droits."
}

pause 