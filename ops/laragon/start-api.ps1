# Démarre l'API GMAO (waitress) après migrations et contrôle du schéma.
param(
    [string]$EnvFile = '',
    [string]$Python = '',
    [string]$Listen = '127.0.0.1:8081',
    [int]$Threads = 8,
    [double]$WaitMinutes = 15
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

# Après un redémarrage de Windows, MySQL (lancé par Laragon) peut démarrer après cette tâche :
# attendre qu'il accepte les connexions au lieu d'échouer aussitôt.
$dbHost = if ($env:GMAO_DB_HOST) { $env:GMAO_DB_HOST } else { '127.0.0.1' }
$dbPort = if ($env:GMAO_DB_PORT) { [int]$env:GMAO_DB_PORT } else { 3306 }
$deadline = (Get-Date).AddMinutes($WaitMinutes)
while (-not (Test-NetConnection -ComputerName $dbHost -Port $dbPort -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    if ((Get-Date) -gt $deadline) { throw "MySQL ne répond pas sur ${dbHost}:${dbPort} après $WaitMinutes minutes." }
    Write-Host "En attente de MySQL (${dbHost}:${dbPort})..."
    Start-Sleep -Seconds 10
}

# Windows PowerShell 5.1 transforme chaque ligne qu'un programme natif écrit sur stderr (avertissements Django,
# journal de waitress) en erreur fatale quand la préférence vaut 'Stop' : c'est ce qui faisait échouer la tâche
# planifiée. Les échecs réels restent détectés par $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
Set-Location $api
foreach ($command in @('migrate --noinput', 'verify_business_schema', 'purge_login_buckets')) {
    & $Python manage.py $command.Split(' ')
    if ($LASTEXITCODE -ne 0) { throw "manage.py $command a échoué." }
}
& $Python -m waitress "--listen=$Listen" "--threads=$Threads" gmao_backend.wsgi:application
exit $LASTEXITCODE
