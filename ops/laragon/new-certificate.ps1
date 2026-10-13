# Génère le certificat HTTPS de GMAO pour un nom d'hôte précis (auto-signé, SAN explicite).
# Le certificat joker de Laragon (*.test) est refusé par Windows : le nom doit être listé tel quel.
# Après génération : importer le .crt dans « Autorités de certification racines de confiance »
# (PowerShell administrateur) sur chaque poste, puis recharger Nginx.
param(
    [string]$HostName = 'gmao.test',
    [string]$OutDir = 'C:\GMAO\ssl',
    [int]$Days = 825,
    [string]$OpenSsl = ''
)
$ErrorActionPreference = 'Stop'
if (-not $OpenSsl) {
    $candidates = @('C:\laragon\bin\git\usr\bin\openssl.exe', 'C:\Program Files\Git\usr\bin\openssl.exe')
    $OpenSsl = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $OpenSsl -or -not (Test-Path $OpenSsl)) { throw 'openssl.exe introuvable (indiquer -OpenSsl <chemin>).' }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$crt = Join-Path $OutDir "$HostName.crt"
$key = Join-Path $OutDir "$HostName.key"
if ((Test-Path $crt) -or (Test-Path $key)) { throw "Certificat déjà présent dans $OutDir : le supprimer pour le régénérer." }

$san = "subjectAltName=DNS:$HostName,DNS:localhost,IP:127.0.0.1"
& $OpenSsl req -x509 -newkey rsa:2048 -nodes -sha256 -days $Days `
    -keyout $key -out $crt -subj "/CN=$HostName/O=GMAO" `
    -addext $san -addext 'basicConstraints=CA:FALSE' `
    -addext 'keyUsage=digitalSignature,keyEncipherment' -addext 'extendedKeyUsage=serverAuth' 2>$null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $crt)) { throw 'La génération du certificat a échoué.' }

# La clé privée n'est lisible que par le compte courant, SYSTEM et les administrateurs.
# Identifiants système (SID) : les noms de groupes dépendent de la langue de Windows.
icacls $OutDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $crt
Write-Host "Certificat : $crt"
Write-Host "Clé privée : $key"
Write-Host "Valable jusqu'au : $($cert.NotAfter.ToString('yyyy-MM-dd'))"
Write-Host "Empreinte : $($cert.Thumbprint)"
Write-Host ''
Write-Host 'Étape suivante (PowerShell administrateur) :'
Write-Host "  Import-Certificate -FilePath '$crt' -CertStoreLocation Cert:\LocalMachine\Root"
