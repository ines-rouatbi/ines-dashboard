# Deploiement LOCAL d'ATOM Wind sur ines-pc : http://127.0.0.1:8787/
#   powershell -ExecutionPolicy Bypass -File dev\lancer-local.ps1
# 1. relais IPv4 vers le tunnel (ines-pc n'a pas de route IPv6 : sans lui, workerd reste bloque) ;
# 2. le Worker en local (wrangler dev), qui sert ATOM Wind et relaie /api via le relais.
# La cle d'API du service n'est pas injectee en local : si le service la demande, la page affiche
# un champ « Clé d'API » (gardee dans le navigateur).
$ici = Split-Path -Parent $PSScriptRoot
$wrangler = Join-Path $ici "..\local\node_modules\.bin\wrangler.cmd"
Get-CimInstance Win32_Process -Filter "Name='node.exe' or Name='workerd.exe'" |
  Where-Object { $_.CommandLine -match 'wrangler|workerd' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if (-not (Get-NetTCPConnection -LocalPort 8771 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -WindowStyle Hidden python -ArgumentList (Join-Path $ici "dev\relais_ipv4.py")
}
Set-Location $ici
& $wrangler dev --local --ip 127.0.0.1 --port 8787 --var ORIGIN:http://127.0.0.1:8771
