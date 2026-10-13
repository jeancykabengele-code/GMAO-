# Sonde de disponibilité locale : interface, API et base de données.
# Ajoute une ligne au journal et retourne le code 1 si une vérification échoue (alerte de la tâche planifiée).
param(
    [string]$BaseUrl = 'https://gmao.test',
    [string]$LogFile = 'C:\GMAO\health.log',
    [string]$EnvFile = '',
    [int]$TimeoutSeconds = 10
)
$ErrorActionPreference = 'Stop'
if (-not $EnvFile) { $EnvFile = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..\..\gmao')).Path '.env.laragon' }

$token = $env:GMAO_HEALTH_TOKEN
if (-not $token -and (Test-Path $EnvFile)) {
    $token = ((Get-Content -LiteralPath $EnvFile -Encoding UTF8 | Where-Object { $_ -like 'GMAO_HEALTH_TOKEN=*' }) -split '=', 2)[1]
}

function Test-Endpoint([string]$Name, [string]$Url, [hashtable]$Headers = @{}) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers $Headers -TimeoutSec $TimeoutSeconds -SkipHttpErrorCheck
        $ok = $r.StatusCode -eq 200
        $detail = "HTTP $($r.StatusCode)"
    } catch {
        $ok = $false
        $detail = $_.Exception.Message
    }
    [pscustomobject]@{ Name = $Name; Ok = $ok; Ms = $watch.ElapsedMilliseconds; Detail = $detail }
}

$results = @(
    Test-Endpoint 'interface' "$BaseUrl/"
    Test-Endpoint 'api' "$BaseUrl/health"
)
if ($token) { $results += Test-Endpoint 'base' "$BaseUrl/health/database" @{ Authorization = "Bearer $token" } }

$failed = @($results | Where-Object { -not $_.Ok })
$line = '{0} {1} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $(if ($failed) { 'ECHEC' } else { 'OK   ' }),
    (($results | ForEach-Object { '{0}={1}({2}ms)' -f $_.Name, $(if ($_.Ok) { 'ok' } else { $_.Detail }), $_.Ms }) -join ' ')
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
Write-Host $line
if ($failed) { exit 1 }
