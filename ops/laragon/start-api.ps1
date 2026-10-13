# Démarre l'API GMAO (waitress) après migrations et contrôle du schéma.
param(
    [string]$EnvFile = '',
    [string]$Python = '',
    [string]$Listen = '127.0.0.1:8080',
    [int]$Threads = 8
)
$ErrorActionPreference = 'Stop'
$api = (Resolve-Path (Join-Path $PSScriptRoot '..\..\gmao')).Path
if (-not $EnvFile) { $EnvFile = Join-Path $api '.env.laragon' }
if (-not $Python) { $Python = Join-Path $api '.venv-laragon\Scripts\python.exe' }
if (-not (Test-Path $EnvFile)) { throw "Fichier de configuration introuvable : $EnvFile (copier ops\laragon\gmao.env.example)." }
if (-not (Test-Path $Python)) { throw "Python introuvable : $Python (lancer ops\laragon\install-api.ps1)." }

# Chargement du fichier .env : KEY=VALUE, lignes vides et commentaires ignorés.
foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
    $text = $line.Trim()
    if (-not $text -or $text.StartsWith('#') -or -not $text.Contains('=')) { continue }
    $name, $value = $text.Split('=', 2)
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}

Set-Location $api
foreach ($command in @('migrate --noinput', 'verify_business_schema', 'purge_login_buckets')) {
    & $Python manage.py $command.Split(' ')
    if ($LASTEXITCODE -ne 0) { throw "manage.py $command a échoué." }
}
& $Python -m waitress "--listen=$Listen" "--threads=$Threads" gmao_backend.wsgi:application
exit $LASTEXITCODE
