Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common-windows.ps1')

$pr = $env:MODEL_OVERLAY_PR
$requestedHead = $env:MODEL_OVERLAY_HEAD
$heads = @{
  '2243' = 'f1fc59aa98a38cc8115c0ba9b0d1cae06895c08d'
  '2245' = 'c506e7aa6412d5fd053875b61f22ab3bed8cc954'
  '2246' = '2f19b03b9b1df3351010883d7f2627721d251863'
  '2247' = '1ad60f617d387c80ae6084b1dde569a83f1f59ec'
}
if (-not $heads.ContainsKey($pr)) { throw "rejected model-overlay PR: $pr" }
if ($requestedHead -ne $heads[$pr]) { throw "model-overlay head mismatch for PR #$pr" }

$baselineSha = 'a3259400a366593e0c909dd9ac3e59752efd2488'
$bundle = Join-Path $env:GITHUB_WORKSPACE '.github\windows-gates\payloads\gstack-exact-windows-refs.bundle'
if ((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne '7b7c543417e066c8a5da6eeb8b179e1cc4bb16e7da0237441457c421531c08ef') {
  throw 'exact-ref bundle hash mismatch'
}
$bun = (Get-Command bun.exe -ErrorAction Stop).Source
$fixedCommand = 'bun run test:windows'
$fixedCommandHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($fixedCommand))).ToLowerInvariant()
if ($fixedCommandHash -ne '516baff1792e323331c4d2bf1a5298d8ee24b20bcfeaf7bb1e77360ac77d42ef') {
  throw 'model-overlay fixed command hash mismatch'
}
$root = "C:\gstack-isolated\model-overlays\pr-$pr"
if (Test-Path -LiteralPath $root) { throw "refusing to reuse model-overlay root: $root" }
[IO.Directory]::CreateDirectory($root) | Out-Null
$artifactRoot = Join-Path $env:RUNNER_TEMP "gstack-windows-gates\model-overlays\pr-$pr"
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
$phaseResults = @()

foreach ($phase in @('baseline', 'candidate')) {
  $sha = if ($phase -eq 'baseline') { $baselineSha } else { $heads[$pr] }
  $phaseRoot = Join-Path $root $phase
  $repo = Join-Path $phaseRoot 'repo'
  $home = Join-Path $phaseRoot 'home'
  $state = Join-Path $phaseRoot 'state'
  $temp = Join-Path $phaseRoot 'tmp'
  $phaseArtifacts = Join-Path $artifactRoot $phase
  [IO.Directory]::CreateDirectory($home) | Out-Null
  [IO.Directory]::CreateDirectory($state) | Out-Null
  [IO.Directory]::CreateDirectory($temp) | Out-Null
  [IO.Directory]::CreateDirectory($phaseArtifacts) | Out-Null
  $sourceRecord = Materialize-ExactSource -Bundle $bundle -Sha $sha -Destination $repo -EvidenceDirectory (Join-Path $phaseArtifacts 'source')
  $environment = New-SafeWindowsEnvironment -Home $home -Temp $temp -Additional @{
    GSTACK_HOME = $state
    BUN_INSTALL_CACHE_DIR = (Join-Path $home '.bun\install\cache')
    GSTACK_SKIP_COREUTILS = '1'
    GSTACK_SKIP_FONTS = '1'
    GSTACK_SKIP_GBRAIN_REGEN = '1'
  }
  Assert-SafeChildEnvironment -Environment $environment -EvidencePath (Join-Path $phaseArtifacts 'tested-child-environment.json')
  $install = Invoke-LoggedProcess -FilePath $bun -Arguments @('install', '--frozen-lockfile', '--ignore-scripts') -WorkingDirectory $repo -StdoutPath (Join-Path $phaseArtifacts 'bun-install.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'bun-install.stderr.log') -Environment $environment
  if ($install.ExitCode -ne 0) { throw "frozen dependency install failed for PR #$pr/$phase" }
  [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'command.txt'), ($fixedCommand + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'command.sha256'), ($fixedCommandHash + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  $networkEvidence = Join-Path $phaseArtifacts 'network'
  $lockdown = Enter-TestNetworkLockdown -EvidenceDirectory $networkEvidence
  try {
    $test = Invoke-LoggedProcess -FilePath $bun -Arguments @('run', 'test:windows') -WorkingDirectory $repo -StdoutPath (Join-Path $phaseArtifacts 'test-windows.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'test-windows.stderr.log') -Environment $environment
  } finally {
    Exit-TestNetworkLockdown -RuleName $lockdown -EvidenceDirectory $networkEvidence
  }
  Write-Host "===== model overlay PR #$pr $phase stdout ====="
  Get-Content -LiteralPath $test.StdoutPath
  Write-Host "===== model overlay PR #$pr $phase stderr ====="
  Get-Content -LiteralPath $test.StderrPath
  $phaseResults += [ordered]@{
    phase = $phase
    expectedSha = $sha
    actualSha = $sourceRecord.actualSha
    installExitCode = $install.ExitCode
    testExitCode = $test.ExitCode
    testDurationMs = $test.DurationMs
    stdoutSha256 = $test.StdoutSha256
    stderrSha256 = $test.StderrSha256
    command = $fixedCommand
    commandSha256 = $fixedCommandHash
    repo = $repo
    home = $home
    state = $state
  }
}

$baselineExit = ($phaseResults | Where-Object phase -eq 'baseline').testExitCode
$candidateExit = ($phaseResults | Where-Object phase -eq 'candidate').testExitCode
$baselineResult = $phaseResults | Where-Object phase -eq 'baseline'
$candidateResult = $phaseResults | Where-Object phase -eq 'candidate'
$baselineFailure = Get-ModelOverlayFailureIdentity -PhaseResult $baselineResult -ArtifactRoot $artifactRoot
$candidateFailure = Get-ModelOverlayFailureIdentity -PhaseResult $candidateResult -ArtifactRoot $artifactRoot
$expectation = if ($pr -eq '2245') { 'source-approved-raw-exit-and-failure-identity-parity-secondary-not-green' } else { 'baseline-zero-candidate-zero' }
$expectationMet = if ($pr -eq '2245') {
  $sameExit = ($baselineExit -eq $candidateExit)
  if ($baselineExit -eq 0) {
    $sameExit
  } else {
    $sameExit -and $baselineFailure.count -gt 0 -and $baselineFailure.count -eq $candidateFailure.count -and $baselineFailure.sha256 -eq $candidateFailure.sha256
  }
} else {
  $baselineExit -eq 0 -and $candidateExit -eq 0
}
$summary = [ordered]@{
  schemaVersion = 1
  role = 'secondary-only'
  pr = [int]$pr
  baselineSha = $baselineSha
  candidateSha = $heads[$pr]
  fixedCommand = $fixedCommand
  fixedCommandSha256 = $fixedCommandHash
  expectation = $expectation
  expectationMet = $expectationMet
  baselineExitCode = $baselineExit
  candidateExitCode = $candidateExit
  rawExitParity = ($baselineExit -eq $candidateExit)
  baselineFailureIdentity = $baselineFailure
  candidateFailureIdentity = $candidateFailure
  phases = $phaseResults
}
[IO.File]::WriteAllText((Join-Path $artifactRoot 'result.json'), (($summary | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
Write-ArtifactHashManifest -ArtifactRoot $artifactRoot -OutputPath (Join-Path $artifactRoot 'artifact-manifest.json')
if (-not $expectationMet) { throw "model-overlay expectation failed for PR #$($pr): baseline=$baselineExit candidate=$candidateExit" }
