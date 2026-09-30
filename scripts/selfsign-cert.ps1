<#
Creates a self-signed code signing certificate for LOCAL testing only.
A self-signed cert does NOT remove SmartScreen warnings. Only a
certificate issued by a trusted CA does that (and even a fresh CA cert
needs to build reputation, unless it is EV).

Usage:
  powershell -File scripts/selfsign-cert.ps1
Then either build with the thumbprint it prints:
  $env:WINDOWS_CERT_THUMBPRINT = "<thumbprint>"
  npm run tauri -- build
#>

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Quest Rig (test only)" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(2)

Write-Output "created test certificate, thumbprint:"
Write-Output $cert.Thumbprint
Write-Output ""
Write-Output "to sign a local build:"
Write-Output '  $env:WINDOWS_CERT_THUMBPRINT = "'$cert.Thumbprint'"'
Write-Output '  npm run tauri -- build'
