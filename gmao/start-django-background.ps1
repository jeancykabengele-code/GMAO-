$ErrorActionPreference = 'Stop'
$credentialPath = Join-Path $PSScriptRoot '.runtime\supabase-db-password.xml'
if (-not (Test-Path -LiteralPath $credentialPath)) {
    throw 'Initialisation requise : lancez start-django.ps1 une seule fois pour enregistrer le mot de passe chiffre.'
}

$existing = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Output 'Django est deja actif sur http://localhost:8080'
    exit 0
}

$logDirectory = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stdout = Join-Path $logDirectory 'django.out.log'
$stderr = Join-Path $logDirectory 'django.err.log'
Start-Process -FilePath 'powershell.exe' `
    -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'start-django.ps1') `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr | Out-Null
Write-Output 'Demarrage de Django en arriere-plan...'