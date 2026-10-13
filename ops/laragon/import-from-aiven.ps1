# Copie la base GMAO d'Aiven MySQL vers le MySQL local de Laragon, puis compare les volumes table par table.
# Aiven n'est jamais modifié : seul un export en lecture est effectué. La base locale est REMPLACÉE.
# Les mots de passe sont demandés à l'écran ; ils ne sont écrits que dans des fichiers temporaires supprimés ensuite.
param(
    [Parameter(Mandatory)][string]$SourceHost,
    [Parameter(Mandatory)][int]$SourcePort,
    [string]$SourceUser = 'avnadmin',
    [string]$SourceDatabase = 'defaultdb',
    [string]$CaFile = 'C:\GMAO\aiven-ca.pem',
    [ValidateSet('VERIFY_CA', 'DISABLED')][string]$SourceSsl = 'VERIFY_CA',
    [string]$TargetDatabase = 'gmao',
    [string]$WorkDir = 'C:\GMAO',
    [string]$MysqlBin = 'C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin',
    [string]$SecretsFile = 'C:\GMAO\.secrets\mysql.txt',
    [int]$ApiPort = 8081,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false

function Read-Secret([string]$Prompt) {
    $secure = Read-Host -Prompt $Prompt -AsSecureString
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
function New-ClientFile([string]$User, [string]$Password, [string]$DbHost, [int]$Port) {
    $path = Join-Path $WorkDir ("client-{0}.cnf" -f [guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($path, "[client]`nuser=$User`npassword=`"$Password`"`nhost=$DbHost`nport=$Port`n", $utf8)
    $path
}
function Get-RowCounts([string]$ClientFile, [string]$Database, [string[]]$ExtraArgs) {
    $tables = & "$MysqlBin\mysql.exe" "--defaults-extra-file=$ClientFile" @ExtraArgs -N -B -e 'SHOW TABLES' $Database
    if ($LASTEXITCODE -ne 0) { throw "Lecture des tables impossible dans $Database." }
    $counts = @{}
    foreach ($table in $tables) {
        $n = & "$MysqlBin\mysql.exe" "--defaults-extra-file=$ClientFile" @ExtraArgs -N -B -e ('SELECT COUNT(*) FROM `{0}`' -f $table) $Database
        $counts[$table] = [int64]$n
    }
    $counts
}

if (-not (Test-Path "$MysqlBin\mysqldump.exe")) { throw "mysqldump introuvable dans $MysqlBin" }
if ($SourceSsl -eq 'VERIFY_CA' -and -not (Test-Path $CaFile)) { throw "Certificat CA d'Aiven introuvable : $CaFile" }
if (-not (Test-Path $SecretsFile)) { throw "Fichier des secrets MySQL introuvable : $SecretsFile" }
if (Get-NetTCPConnection -State Listen -LocalPort $ApiPort -ErrorAction SilentlyContinue) {
    throw "L'API écoute encore sur le port $ApiPort : l'arrêter avant l'import (les tables vont être remplacées)."
}
$rootPassword = ((Get-Content $SecretsFile | Where-Object { $_ -like 'MYSQL_ROOT_PASSWORD=*' }) -split '=', 2)[1]
if (-not $rootPassword) { throw 'MYSQL_ROOT_PASSWORD absent du fichier des secrets.' }

Write-Host "Source : $SourceUser@$SourceHost`:$SourcePort/$SourceDatabase (lecture seule)"
Write-Host "Cible  : MySQL local, base '$TargetDatabase' (REMPLACÉE)"
if (-not $Yes -and (Read-Host "Tapez OUI pour continuer") -cne 'OUI') { throw 'Import annulé.' }

# La variable GMAO_IMPORT_SOURCE_PASSWORD permet d'automatiser ; sinon le mot de passe est saisi à l'écran.
$sourcePassword = if ($env:GMAO_IMPORT_SOURCE_PASSWORD) { $env:GMAO_IMPORT_SOURCE_PASSWORD } else { Read-Secret "Mot de passe Aiven de $SourceUser" }
$sourceFile = New-ClientFile $SourceUser $sourcePassword $SourceHost $SourcePort
$targetFile = New-ClientFile 'root' $rootPassword '127.0.0.1' 3306
[string[]]$sourceSslArgs = if ($SourceSsl -eq 'VERIFY_CA') { @('--ssl-mode=VERIFY_CA', "--ssl-ca=$CaFile") } else { @('--ssl-mode=DISABLED') }
$dump = Join-Path $WorkDir 'aiven.sql'
try {
    Write-Host '1/4 Export de la base source...'
    & "$MysqlBin\mysqldump.exe" "--defaults-extra-file=$sourceFile" @sourceSslArgs --single-transaction --no-tablespaces `
        --set-gtid-purged=OFF --routines --triggers --default-character-set=utf8mb4 "--result-file=$dump" $SourceDatabase
    if ($LASTEXITCODE -ne 0) { throw "mysqldump a échoué (code $LASTEXITCODE)." }
    if ((Get-Item $dump).Length -lt 2048) { throw 'Export anormalement petit : vérifier la base source.' }

    Write-Host '2/4 Retrait des DEFINER (utilisateur Aiven absent en local)...'
    $sql = [IO.File]::ReadAllText($dump, $utf8)
    $sql = [regex]::Replace($sql, '/\*!50017 DEFINER=`[^`]+`@`[^`]*`\*/', '')
    $sql = [regex]::Replace($sql, 'DEFINER=`[^`]+`@`[^`]*`\s*', '')
    [IO.File]::WriteAllText($dump, $sql, $utf8)

    Write-Host "3/4 Import dans '$TargetDatabase'..."
    & "$MysqlBin\mysql.exe" "--defaults-extra-file=$targetFile" -e "CREATE DATABASE IF NOT EXISTS ``$TargetDatabase`` CHARACTER SET utf8mb4;"
    if ($LASTEXITCODE -ne 0) { throw 'Création de la base cible impossible.' }
    cmd /c "`"$MysqlBin\mysql.exe`" --defaults-extra-file=`"$targetFile`" --default-character-set=utf8mb4 $TargetDatabase < `"$dump`""
    if ($LASTEXITCODE -ne 0) { throw "Import échoué (code $LASTEXITCODE)." }

    Write-Host '4/4 Comparaison des volumes table par table...'
    $src = Get-RowCounts $sourceFile $SourceDatabase $sourceSslArgs
    $dst = Get-RowCounts $targetFile $TargetDatabase @()
    $rows = foreach ($table in ($src.Keys + $dst.Keys | Sort-Object -Unique)) {
        $a = $src[$table]; $b = $dst[$table]
        [pscustomobject]@{ Table = $table; Source = $a; Local = $b; Etat = $(if ($a -eq $b) { 'OK' } else { 'DIFFÉRENT' }) }
    }
    $rows | Format-Table -AutoSize
    $bad = @($rows | Where-Object Etat -ne 'OK')
    if ($bad.Count) { throw "$($bad.Count) table(s) différente(s) : ne pas basculer avant d'avoir compris l'écart." }
    Write-Host "Import vérifié : $($rows.Count) tables identiques." -ForegroundColor Green
    Write-Host "Étape suivante : démarrer l'API (ops\laragon\start-api.ps1) ; elle appliquera les migrations manquantes."
}
finally {
    foreach ($f in @($sourceFile, $targetFile, $dump)) { if ($f -and (Test-Path $f)) { [IO.File]::Delete($f) } }
    $sourcePassword = $null
}
