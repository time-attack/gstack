param(
  [Parameter(Mandatory=$true)][string]$IsolatedHome
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$keyPath = Join-Path $IsolatedHome 'fixture-aes-key.b64'
$localStatePath = Join-Path $IsolatedHome 'AppData\Local\Google\Chrome\User Data\Local State'
$key = [Convert]::FromBase64String([IO.File]::ReadAllText($keyPath).Trim())

try {
  $protected = [Security.Cryptography.ProtectedData]::Protect(
    $key,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $roundTrip = [Security.Cryptography.ProtectedData]::Unprotect(
    $protected,
    $null,
    [Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  if (-not [Linq.Enumerable]::SequenceEqual([byte[]]$key, [byte[]]$roundTrip)) {
    throw 'DPAPI CurrentUser round trip did not recover the AES key'
  }

  [byte[]]$prefix = [Text.Encoding]::ASCII.GetBytes('DPAPI')
  [byte[]]$stored = New-Object byte[] ($prefix.Length + $protected.Length)
  [Array]::Copy($prefix, 0, $stored, 0, $prefix.Length)
  [Array]::Copy($protected, 0, $stored, $prefix.Length, $protected.Length)
  $state = @{ os_crypt = @{ encrypted_key = [Convert]::ToBase64String($stored) } } | ConvertTo-Json -Depth 4 -Compress
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($localStatePath)) | Out-Null
  [IO.File]::WriteAllText($localStatePath, $state, [Text.UTF8Encoding]::new($false))

  Write-Output 'dpapi_roundtrip=true'
  Write-Output "scope=CurrentUser"
  Write-Output "local_state=$localStatePath"
  Write-Output "protected_bytes=$($protected.Length)"
  Write-Output 'plaintext_logged=false'
} finally {
  Remove-Item -LiteralPath $keyPath -Force -ErrorAction SilentlyContinue
}
