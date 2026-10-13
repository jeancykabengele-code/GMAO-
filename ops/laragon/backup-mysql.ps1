# Sauvegarde complète de la base GMAO (mysqldump compressé) avec rotation.
# Le mot de passe du compte de sauvegarde est lu dans la variable GMAO_BACKUP_DB_PASSWORD si elle existe,
# sinon dans le fichier protégé des secrets MySQL (jamais en argument de commande).
param(
    [string]$Database = 'gmao',
    [string]$DbUser = 'gmao_backup',
    [string]$DbHost = '127.0.0.1',
    [string]$OutDir = 'C:\GMAO\backups',
    [int]$KeepDays = 30,
    [string]$MysqlBin = 'C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin',
    [string]$SecretsFile = 'C:\GMAO\.secrets\mysql.txt',
    [string]$CopyTo = ''
)
$ErrorActionPreference = 'Stop'
$password = $env:GMAO_BACKUP_DB_PASSWORD
if (-not $password -and (Test-Path $SecretsFile)) {
    $password = ((Get-Content -LiteralPath $SecretsFile | Where-Object { $_ -like 'MYSQL_GMAO_BACKUP_PASSWORD=*' }) -split '=', 2)[1]
}
if (-not $password) { throw "Mot de passe de sauvegarde introuvable (variable GMAO_BACKUP_DB_PASSWORD ou $SecretsFile)." }
$dump = Join-Path $MysqlBin 'mysqldump.exe'
if (-not (Test-Path $dump)) { throw "mysqldump introuvable : $dump" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$sql = Join-Path $OutDir "gmao-$stamp.sql"
$zip = Join-Path $OutDir "gmao-$stamp.zip"
$cnf = Join-Path ([IO.Path]::GetTempPath()) "gmao-backup-$([guid]::NewGuid().ToString('N')).cnf"
try {
    Set-Content -LiteralPath $cnf -Encoding ASCII -Value "[client]`nuser=$DbUser`npassword=`"$password`"`nhost=$DbHost"
    & $dump "--defaults-extra-file=$cnf" --single-transaction --routines --no-tablespaces --default-character-set=utf8mb4 "--result-file=$sql" $Database
    if ($LASTEXITCODE -ne 0) { throw "mysqldump a échoué (code $LASTEXITCODE)." }
    if ((Get-Item $sql).Length -lt 1024) { throw 'Sauvegarde anormalement petite : vérifier la base.' }
    Compress-Archive -LiteralPath $sql -DestinationPath $zip
} finally {
    Remove-Item -LiteralPath $cnf -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sql -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -LiteralPath $OutDir -Filter 'gmao-*.zip' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
    Remove-Item -Force
Write-Host "Sauvegarde créée : $zip"

# Copie vers un second emplacement (autre disque, disque externe, partage réseau).
if ($CopyTo) {
    try {
        New-Item -ItemType Directory -Force -Path $CopyTo | Out-Null
        $copy = Join-Path $CopyTo (Split-Path $zip -Leaf)
        Copy-Item -LiteralPath $zip -Destination $copy -Force
        if ((Get-Item -LiteralPath $copy).Length -ne (Get-Item -LiteralPath $zip).Length) { throw 'Taille différente après copie.' }
        Get-ChildItem -LiteralPath $CopyTo -Filter 'gmao-*.zip' |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
            Remove-Item -Force
        Write-Host "Copie vérifiée : $copy"
    } catch {
        # La sauvegarde principale existe : l'échec de la copie est signalé par le code de sortie.
        Write-Error "Copie vers $CopyTo impossible : $($_.Exception.Message)"
        exit 2
    }
}
