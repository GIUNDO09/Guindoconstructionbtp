# =========================================================
# GCBTP Manager — App Windows pour piloter le serveur + tunnel
# Double-clique "GCBTP Manager.bat" pour lancer cette fenêtre
# =========================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ---------- Config ----------
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot   = Split-Path -Parent $ScriptDir
$ServerPort = 3000
$TunnelMode = 'quick'     # 'quick' (trycloudflare) ou 'named'
$TunnelName = 'gcbtp-files'   # utilisé uniquement si TunnelMode='named'
$LogDir     = Join-Path $ScriptDir 'logs'
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$ServerLog  = Join-Path $LogDir 'server.log'
$TunnelLog  = Join-Path $LogDir 'tunnel.log'
$StateFile  = Join-Path $ScriptDir '.state.json'
$EnvFile    = Join-Path $ScriptDir '.env'

# Lecture du .env (simple)
function Read-DotEnv($path) {
  $dict = @{}
  if (Test-Path $path) {
    foreach ($line in Get-Content $path) {
      if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$') {
        $dict[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
      }
    }
  }
  return $dict
}

$script:lastPublishedUrl = $null
$script:lastPublishStatus = ''

# ---------- Helpers ----------
function Test-PortOpen($port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $c.Connect('127.0.0.1', $port)
    $c.Close()
    return $true
  } catch { return $false }
}

function Get-ServerPid {
  if (Test-Path $StateFile) {
    $s = Get-Content $StateFile -Raw | ConvertFrom-Json
    if ($s.serverPid -and (Get-Process -Id $s.serverPid -ErrorAction SilentlyContinue)) {
      return $s.serverPid
    }
  }
  return $null
}

function Get-TunnelPid {
  if (Test-Path $StateFile) {
    $s = Get-Content $StateFile -Raw | ConvertFrom-Json
    if ($s.tunnelPid -and (Get-Process -Id $s.tunnelPid -ErrorAction SilentlyContinue)) {
      return $s.tunnelPid
    }
  }
  return $null
}

function Save-State($serverPid, $tunnelPid) {
  @{ serverPid = $serverPid; tunnelPid = $tunnelPid } |
    ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8
}

function Read-TunnelUrl {
  if ($TunnelMode -eq 'named') {
    return 'https://files.guindoconstruction.xyz'
  }
  if (-not (Test-Path $TunnelLog)) { return $null }
  $content = Get-Content $TunnelLog -Raw -ErrorAction SilentlyContinue
  if (-not $content) { return $null }
  $m = [regex]::Match($content, 'https://[a-z0-9\-]+\.trycloudflare\.com')
  if ($m.Success) { return $m.Value }
  return $null
}

# Publie l'URL dans la table app_settings de Supabase (via la service_role key)
function Publish-TunnelUrl($url) {
  $envVars = Read-DotEnv $EnvFile
  $supaUrl = $envVars['SUPABASE_URL']
  $srKey   = $envVars['SUPABASE_SERVICE_ROLE_KEY']
  if (-not $supaUrl -or -not $srKey) {
    return 'skipped: SUPABASE_SERVICE_ROLE_KEY manquante dans .env'
  }
  $headers = @{
    'apikey'        = $srKey
    'Authorization' = "Bearer $srKey"
    'Content-Type'  = 'application/json'
    'Prefer'        = 'resolution=merge-duplicates'
  }
  $body = @{ key = 'file_server_url'; value = $url; updated_at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri "$supaUrl/rest/v1/app_settings" `
      -Method Post -Headers $headers -Body $body -ErrorAction Stop | Out-Null
    return 'ok'
  } catch {
    return "error: $($_.Exception.Message)"
  }
}

# ---------- Actions ----------
function Start-Server {
  if (Get-ServerPid) { return }
  if (Test-Path $ServerLog) { Clear-Content -Path $ServerLog -ErrorAction SilentlyContinue }
  $bat = Join-Path $ScriptDir '_start-server.bat'
  $p = Start-Process -FilePath $bat `
    -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
  Save-State $p.Id (Get-TunnelPid)
}

function Stop-Server {
  $spid = Get-ServerPid
  if ($spid) {
    try { taskkill /PID $spid /T /F 2>&1 | Out-Null } catch {}
  }
  # Filet de sécurité : tuer aussi tout node.exe orphelin
  Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force } catch {}
  }
  Save-State $null (Get-TunnelPid)
}

function Start-Tunnel {
  if (Get-TunnelPid) { return }
  if (Test-Path $TunnelLog) { Clear-Content -Path $TunnelLog -ErrorAction SilentlyContinue }
  $bat = if ($TunnelMode -eq 'named') {
    Join-Path $ScriptDir '_start-tunnel-named.bat'
  } else {
    Join-Path $ScriptDir '_start-tunnel-quick.bat'
  }
  $p = Start-Process -FilePath $bat `
    -WorkingDirectory $ScriptDir -WindowStyle Hidden -PassThru
  Save-State (Get-ServerPid) $p.Id
}

function Stop-Tunnel {
  $tpid = Get-TunnelPid
  if ($tpid) {
    try { taskkill /PID $tpid /T /F 2>&1 | Out-Null } catch {}
  }
  # Filet de sécurité : tuer tout cloudflared orphelin
  Get-Process -Name cloudflared -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force } catch {}
  }
  Save-State (Get-ServerPid) $null
}

function Start-All { Start-Server; Start-Sleep -Seconds 2; Start-Tunnel }
function Stop-All  { Stop-Tunnel; Stop-Server }

# ---------- UI ----------
$form = New-Object Windows.Forms.Form
$form.Text = 'GCBTP Manager'
$form.Size = New-Object Drawing.Size(560, 480)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [Drawing.Color]::FromArgb(248, 249, 250)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false

# Titre
$title = New-Object Windows.Forms.Label
$title.Text = 'GCBTP — Serveur de fichiers'
$title.Font = New-Object Drawing.Font('Segoe UI', 16, [Drawing.FontStyle]::Bold)
$title.ForeColor = [Drawing.Color]::FromArgb(15, 37, 66)
$title.Location = New-Object Drawing.Point(20, 16)
$title.Size = New-Object Drawing.Size(520, 30)
$form.Controls.Add($title)

# Sous-titre
$subtitle = New-Object Windows.Forms.Label
$subtitle.Text = "Pilote le serveur Node.js et le tunnel Cloudflare"
$subtitle.Font = New-Object Drawing.Font('Segoe UI', 9)
$subtitle.ForeColor = [Drawing.Color]::Gray
$subtitle.Location = New-Object Drawing.Point(20, 48)
$subtitle.Size = New-Object Drawing.Size(520, 20)
$form.Controls.Add($subtitle)

# Status serveur
$serverBox = New-Object Windows.Forms.GroupBox
$serverBox.Text = 'Serveur Node.js'
$serverBox.Location = New-Object Drawing.Point(20, 80)
$serverBox.Size = New-Object Drawing.Size(250, 110)
$form.Controls.Add($serverBox)

$serverStatus = New-Object Windows.Forms.Label
$serverStatus.Text = '🔴 Arrêté'
$serverStatus.Font = New-Object Drawing.Font('Segoe UI', 11, [Drawing.FontStyle]::Bold)
$serverStatus.Location = New-Object Drawing.Point(12, 28)
$serverStatus.Size = New-Object Drawing.Size(220, 22)
$serverBox.Controls.Add($serverStatus)

$serverInfo = New-Object Windows.Forms.Label
$serverInfo.Text = "Port $ServerPort"
$serverInfo.Font = New-Object Drawing.Font('Segoe UI', 8)
$serverInfo.ForeColor = [Drawing.Color]::Gray
$serverInfo.Location = New-Object Drawing.Point(12, 52)
$serverInfo.Size = New-Object Drawing.Size(220, 16)
$serverBox.Controls.Add($serverInfo)

# Status tunnel
$tunnelBox = New-Object Windows.Forms.GroupBox
$tunnelBox.Text = 'Tunnel Cloudflare'
$tunnelBox.Location = New-Object Drawing.Point(280, 80)
$tunnelBox.Size = New-Object Drawing.Size(250, 110)
$form.Controls.Add($tunnelBox)

$tunnelStatus = New-Object Windows.Forms.Label
$tunnelStatus.Text = '🔴 Arrêté'
$tunnelStatus.Font = New-Object Drawing.Font('Segoe UI', 11, [Drawing.FontStyle]::Bold)
$tunnelStatus.Location = New-Object Drawing.Point(12, 28)
$tunnelStatus.Size = New-Object Drawing.Size(220, 22)
$tunnelBox.Controls.Add($tunnelStatus)

$tunnelUrl = New-Object Windows.Forms.Label
$tunnelUrl.Text = ''
$tunnelUrl.Font = New-Object Drawing.Font('Consolas', 8)
$tunnelUrl.ForeColor = [Drawing.Color]::FromArgb(232, 119, 34)
$tunnelUrl.Location = New-Object Drawing.Point(12, 52)
$tunnelUrl.Size = New-Object Drawing.Size(220, 40)
$tunnelBox.Controls.Add($tunnelUrl)

# Boutons principaux
$btnStart = New-Object Windows.Forms.Button
$btnStart.Text = '▶  Démarrer tout'
$btnStart.Location = New-Object Drawing.Point(20, 210)
$btnStart.Size = New-Object Drawing.Size(250, 42)
$btnStart.BackColor = [Drawing.Color]::FromArgb(47, 158, 68)
$btnStart.ForeColor = [Drawing.Color]::White
$btnStart.Font = New-Object Drawing.Font('Segoe UI', 11, [Drawing.FontStyle]::Bold)
$btnStart.FlatStyle = 'Flat'
$btnStart.FlatAppearance.BorderSize = 0
$btnStart.Add_Click({ Start-All; Update-UI })
$form.Controls.Add($btnStart)

$btnStop = New-Object Windows.Forms.Button
$btnStop.Text = '■  Arrêter tout'
$btnStop.Location = New-Object Drawing.Point(280, 210)
$btnStop.Size = New-Object Drawing.Size(250, 42)
$btnStop.BackColor = [Drawing.Color]::FromArgb(224, 49, 49)
$btnStop.ForeColor = [Drawing.Color]::White
$btnStop.Font = New-Object Drawing.Font('Segoe UI', 11, [Drawing.FontStyle]::Bold)
$btnStop.FlatStyle = 'Flat'
$btnStop.FlatAppearance.BorderSize = 0
$btnStop.Add_Click({ Stop-All; Update-UI })
$form.Controls.Add($btnStop)

# Actions secondaires
$btnCopyUrl = New-Object Windows.Forms.Button
$btnCopyUrl.Text = '📋 Copier l''URL'
$btnCopyUrl.Location = New-Object Drawing.Point(20, 270)
$btnCopyUrl.Size = New-Object Drawing.Size(163, 32)
$btnCopyUrl.Font = New-Object Drawing.Font('Segoe UI', 9)
$btnCopyUrl.Add_Click({
  if ($tunnelUrl.Text) {
    [Windows.Forms.Clipboard]::SetText($tunnelUrl.Text)
  }
})
$form.Controls.Add($btnCopyUrl)

$btnOpenSite = New-Object Windows.Forms.Button
$btnOpenSite.Text = '🌐 Site équipe'
$btnOpenSite.Location = New-Object Drawing.Point(193, 270)
$btnOpenSite.Size = New-Object Drawing.Size(163, 32)
$btnOpenSite.Font = New-Object Drawing.Font('Segoe UI', 9)
$btnOpenSite.Add_Click({ Start-Process 'https://www.guindoconstruction.xyz/equipe/' })
$form.Controls.Add($btnOpenSite)

$btnOpenFolder = New-Object Windows.Forms.Button
$btnOpenFolder.Text = '📁 Dossier fichiers'
$btnOpenFolder.Location = New-Object Drawing.Point(366, 270)
$btnOpenFolder.Size = New-Object Drawing.Size(164, 32)
$btnOpenFolder.Font = New-Object Drawing.Font('Segoe UI', 9)
$btnOpenFolder.Add_Click({
  $dir = 'C:\gcbtp-files'
  if (Test-Path $dir) { Start-Process explorer.exe $dir }
})
$form.Controls.Add($btnOpenFolder)

$btnUpdate = New-Object Windows.Forms.Button
$btnUpdate.Text = '🔄 Mettre à jour le code (git pull)'
$btnUpdate.Location = New-Object Drawing.Point(20, 310)
$btnUpdate.Size = New-Object Drawing.Size(336, 32)
$btnUpdate.Font = New-Object Drawing.Font('Segoe UI', 9)
$btnUpdate.Add_Click({
  $btnUpdate.Enabled = $false
  $btnUpdate.Text = 'Mise à jour…'
  try {
    $out = (& git -C $RepoRoot pull --ff-only 2>&1) | Out-String
    [Windows.Forms.MessageBox]::Show($out.Trim(), 'git pull', 'OK', 'Information') | Out-Null
  } catch {
    [Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Erreur', 'OK', 'Error') | Out-Null
  }
  $btnUpdate.Enabled = $true
  $btnUpdate.Text = '🔄 Mettre à jour le code (git pull)'
})
$form.Controls.Add($btnUpdate)

$btnOpenLogs = New-Object Windows.Forms.Button
$btnOpenLogs.Text = '📄 Logs'
$btnOpenLogs.Location = New-Object Drawing.Point(366, 310)
$btnOpenLogs.Size = New-Object Drawing.Size(164, 32)
$btnOpenLogs.Font = New-Object Drawing.Font('Segoe UI', 9)
$btnOpenLogs.Add_Click({ Start-Process explorer.exe $LogDir })
$form.Controls.Add($btnOpenLogs)

# Label de statut de publication auto
$pubStatus = New-Object Windows.Forms.Label
$pubStatus.Text = ''
$pubStatus.Font = New-Object Drawing.Font('Segoe UI', 8)
$pubStatus.ForeColor = [Drawing.Color]::Gray
$pubStatus.Location = New-Object Drawing.Point(20, 350)
$pubStatus.Size = New-Object Drawing.Size(510, 18)
$form.Controls.Add($pubStatus)

# Footer
$footer = New-Object Windows.Forms.Label
$footer.Text = "Ferme cette fenêtre = tout continue de tourner en arrière-plan."
$footer.Font = New-Object Drawing.Font('Segoe UI', 8)
$footer.ForeColor = [Drawing.Color]::Gray
$footer.Location = New-Object Drawing.Point(20, 380)
$footer.Size = New-Object Drawing.Size(520, 20)
$form.Controls.Add($footer)

# ---------- Timer qui met à jour l'UI ----------
function Update-UI {
  # Serveur : détecter via le port (le plus fiable)
  $serverRunning = Test-PortOpen $ServerPort
  $nodeAlive = [bool](Get-Process -Name node -ErrorAction SilentlyContinue)
  if ($serverRunning) {
    $serverStatus.Text = '🟢 En marche'
    $serverStatus.ForeColor = [Drawing.Color]::FromArgb(47, 158, 68)
  } elseif ($nodeAlive) {
    $serverStatus.Text = '🟡 Démarrage…'
    $serverStatus.ForeColor = [Drawing.Color]::FromArgb(245, 159, 0)
  } else {
    $serverStatus.Text = '🔴 Arrêté'
    $serverStatus.ForeColor = [Drawing.Color]::FromArgb(224, 49, 49)
  }

  # Tunnel : détecter via la présence du process cloudflared
  $tunnelAlive = [bool](Get-Process -Name cloudflared -ErrorAction SilentlyContinue)
  if ($tunnelAlive) {
    $url = Read-TunnelUrl
    if ($url) {
      $tunnelStatus.Text = '🟢 En marche'
      $tunnelStatus.ForeColor = [Drawing.Color]::FromArgb(47, 158, 68)
      $tunnelUrl.Text = $url

      # Auto-publish dans Supabase si l'URL a changé
      if ($url -ne $script:lastPublishedUrl) {
        $result = Publish-TunnelUrl $url
        if ($result -eq 'ok') {
          $script:lastPublishedUrl = $url
          $pubStatus.Text = "✅ URL publiée auto dans Supabase à $(Get-Date -Format 'HH:mm:ss')"
          $pubStatus.ForeColor = [Drawing.Color]::FromArgb(47, 158, 68)
        } elseif ($result -like 'skipped:*') {
          $pubStatus.Text = "⚠️  Auto-publish désactivé — ajoute SUPABASE_SERVICE_ROLE_KEY dans .env"
          $pubStatus.ForeColor = [Drawing.Color]::FromArgb(245, 159, 0)
        } else {
          $pubStatus.Text = "❌ Erreur publish : $result"
          $pubStatus.ForeColor = [Drawing.Color]::FromArgb(224, 49, 49)
        }
      }
    } else {
      $tunnelStatus.Text = '🟡 Démarrage…'
      $tunnelStatus.ForeColor = [Drawing.Color]::FromArgb(245, 159, 0)
      $tunnelUrl.Text = 'Attente de l''URL…'
    }
  } else {
    $tunnelStatus.Text = '🔴 Arrêté'
    $tunnelStatus.ForeColor = [Drawing.Color]::FromArgb(224, 49, 49)
    $tunnelUrl.Text = ''
    $script:lastPublishedUrl = $null
    $pubStatus.Text = ''
  }
}

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Update-UI })
$timer.Start()

Update-UI
$form.Add_Shown({ $form.Activate() })
[void]$form.ShowDialog()
$timer.Stop()
