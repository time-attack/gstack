Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\common-windows.ps1')

$caseId = $env:PR1743_CASE
$cases = @{
  'gstack-auto' = @{
    cohort = 'affected'
    sha = '17bf2a025c175b899e7d30be1ab4e658fd4ae04f'
    archive = 'pr1981-transfer\gstack-auto-17bf2a02.tar.gz'
    archiveSha256 = '59aca501ab7f7313726b72dd4ecabe10b21b999e3a29804326d838d1c00b82c7'
  }
  'zotero-arxiv-daily' = @{
    cohort = 'affected'
    sha = '05b20ec5c14ef82f8634c21a0876acd40e02c2b2'
    archive = 'pr1743-consumers\zotero-arxiv-daily-05b20ec5.tar.gz'
    archiveSha256 = 'fcfed1a8722f1ef50765b1a3e8389ca6877119d11a368c87333dc6e9f606fa3d'
  }
  'stagehand' = @{
    cohort = 'control'
    sha = '2a6e20b068bb724bdbd3c192b6463acd6b9b817c'
    archive = 'pr1981-transfer\stagehand-2a6e20b0.tar.gz'
    archiveSha256 = '5ade9648729f6a914f578d661d091b06098a4a0006f6cdf06bb366da5a933bdf'
  }
}
if (-not $cases.ContainsKey($caseId)) { throw "rejected PR #1743 case: $caseId" }
$case = $cases[$caseId]
$baselineSha = 'a3259400a366593e0c909dd9ac3e59752efd2488'
$candidateSha = '33143ad9239b78c1b79a2bf235ac202ecfe2e61b'
$bundle = Join-Path $env:GITHUB_WORKSPACE '.github\windows-gates\payloads\gstack-exact-windows-refs.bundle'
$probeRoot = Join-Path $env:GITHUB_WORKSPACE '.github\windows-gates\pr1743'
$consumerArchive = Join-Path $env:GITHUB_WORKSPACE (Join-Path '.github\windows-gates\payloads' $case.archive)
if ((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne '7b7c543417e066c8a5da6eeb8b179e1cc4bb16e7da0237441457c421531c08ef') {
  throw 'exact-ref bundle hash mismatch'
}
$expectedProbeHash = '5f17807b7e9a1ef3231e3101ac3c629d1d4152a54562d488e794a86cf19f94d5'
$probe = Join-Path $probeRoot 'windows\run-pr1743-windows-probe.ps1'
if ((Get-FileHash -LiteralPath $probe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedProbeHash) {
  throw 'reviewed PR #1743 probe hash mismatch'
}
$reviewedProbeFiles = @{
  'windows\create-dpapi-cookie-fixture.ts' = '7691e0498bd0cc123bb44cb12e0640653b55cddf414c6241e8ab37d5e9435000'
  'windows\protect-dpapi-key.ps1' = 'abf5c48a32fd23a5fa3bdac32b2a5e037c80cb53ca14cfc6d38abef86c4a57ff'
  'windows\dpapi-core-probe.ts' = '0218988f4e06ffe2552ec64ecf727e095d3a1814de48c9bf4c32f4cfa2b21c53'
  'probe\node-spawn-matrix.mjs' = 'c5a27d7414c9687fc819a5f2fd154fb373db90bf0293b711bb076f0e4fa0663e'
}
foreach ($relativePath in $reviewedProbeFiles.Keys) {
  $reviewedPath = Join-Path $probeRoot $relativePath
  if ((Get-FileHash -LiteralPath $reviewedPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $reviewedProbeFiles[$relativePath]) {
    throw "reviewed PR #1743 child probe hash mismatch: $relativePath"
  }
}
if ((Get-FileHash -LiteralPath $consumerArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $case.archiveSha256) {
  throw "pinned PR #1743 consumer archive hash mismatch for $caseId"
}
$fixedCommand = 'pwsh -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $env:GSTACK_PR1743_PROBE_ROOT\windows\run-pr1743-windows-probe.ps1'
$fixedCommandHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($fixedCommand))).ToLowerInvariant()
if ($fixedCommandHash -ne '2f2be4a7afc849e231ba284fc4177ec2bfe1ffa2d85275d81775473a30abe35b') {
  throw 'PR #1743 fixed command hash mismatch'
}

$root = "C:\gstack-isolated\pr-1743\$caseId"
if (Test-Path -LiteralPath $root) { throw "refusing to reuse PR #1743 root: $root" }
[IO.Directory]::CreateDirectory($root) | Out-Null
$artifactRoot = Join-Path $env:RUNNER_TEMP "gstack-windows-gates\pr1743\$caseId"
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
[IO.File]::WriteAllText((Join-Path $artifactRoot 'harness-started.txt'), ("startedAt=$([DateTime]::UtcNow.ToString('o'))" + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$bun = (Get-Command bun.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$git = (Get-Command git.exe -ErrorAction Stop).Source
$bash = 'C:\Program Files\Git\bin\bash.exe'
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$factsEnvironment = New-SafeWindowsEnvironment -IsolatedHome (Join-Path $root 'tool-facts-home') -Temp (Join-Path $root 'tool-facts-temp')
Assert-SafeChildEnvironment -Environment $factsEnvironment -EvidencePath (Join-Path $artifactRoot 'tool-facts-child-environment.json')
function Invoke-ToolFact {
  param([string]$Name, [string]$FilePath, [string[]]$Arguments)
  $stdout = Join-Path $artifactRoot "tool-$Name.stdout.log"
  $stderr = Join-Path $artifactRoot "tool-$Name.stderr.log"
  $result = Invoke-LoggedProcess -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $root -StdoutPath $stdout -StderrPath $stderr -Environment $factsEnvironment
  if ($result.ExitCode -ne 0) { throw "tool fact failed: $Name" }
  return [IO.File]::ReadAllText($stdout).Trim()
}
$toolFacts = [ordered]@{
  os = [Environment]::OSVersion.VersionString
  architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  runnerImage = $env:ImageOS
  runnerImageVersion = $env:ImageVersion
  powershellSource = 'GitHub-hosted Windows runner image'
  powershellPath = $pwsh
  powershellVersion = Invoke-ToolFact -Name 'powershell-version' -FilePath $pwsh -Arguments @('--version')
  gitBashSource = 'Git for Windows from GitHub-hosted runner image'
  gitBashPath = $bash
  gitBashVersion = (Invoke-ToolFact -Name 'bash-version' -FilePath $bash -Arguments @('--version')).Split([Environment]::NewLine)[0]
  bunSource = 'oven-sh/setup-bun pinned action; Bun 1.3.14'
  bunPath = $bun
  bunVersion = Invoke-ToolFact -Name 'bun-version' -FilePath $bun -Arguments @('--version')
  nodeSource = 'actions/setup-node pinned action; Node 24.16.0'
  nodePath = $node
  nodeVersion = Invoke-ToolFact -Name 'node-version' -FilePath $node -Arguments @('--version')
  gitSource = 'Git for Windows from GitHub-hosted runner image'
  gitPath = $git
  gitVersion = Invoke-ToolFact -Name 'git-version' -FilePath $git -Arguments @('--version')
}
[IO.File]::WriteAllText((Join-Path $artifactRoot 'tool-facts.json'), (($toolFacts | ConvertTo-Json -Depth 5) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))

$phaseResults = @()
foreach ($phase in @('baseline', 'candidate')) {
  $sha = if ($phase -eq 'baseline') { $baselineSha } else { $candidateSha }
  $phaseRoot = Join-Path $root $phase
  $repo = Join-Path $phaseRoot 'repo'
  $isolatedHome = Join-Path $phaseRoot 'home'
  $state = Join-Path $phaseRoot 'state'
  $temp = Join-Path $phaseRoot 'tmp'
  $phaseArtifacts = Join-Path $artifactRoot $phase
  [IO.Directory]::CreateDirectory($isolatedHome) | Out-Null
  [IO.Directory]::CreateDirectory($state) | Out-Null
  [IO.Directory]::CreateDirectory($temp) | Out-Null
  [IO.Directory]::CreateDirectory($phaseArtifacts) | Out-Null
  $consumer = Join-Path $phaseRoot 'consumer'
  $consumerEvidence = Join-Path $phaseArtifacts 'consumer-source'
  [IO.Directory]::CreateDirectory($consumer) | Out-Null
  [IO.Directory]::CreateDirectory($consumerEvidence) | Out-Null
  $consumerEnvironment = New-SafeWindowsEnvironment -IsolatedHome (Join-Path $consumerEvidence 'tool-home') -Temp (Join-Path $consumerEvidence 'tool-temp')
  Assert-SafeChildEnvironment -Environment $consumerEnvironment -EvidencePath (Join-Path $consumerEvidence 'child-environment.json')
  $extract = Invoke-LoggedProcess -FilePath $tar -Arguments @('-xzf', $consumerArchive, '-C', $consumer) -WorkingDirectory $phaseRoot -StdoutPath (Join-Path $consumerEvidence 'extract.stdout.log') -StderrPath (Join-Path $consumerEvidence 'extract.stderr.log') -Environment $consumerEnvironment
  if ($extract.ExitCode -ne 0) { throw "consumer extraction failed for $caseId/$phase" }
  $probeArtifactRoot = Join-Path $phaseArtifacts 'probe-output'
  [IO.Directory]::CreateDirectory($probeArtifactRoot) | Out-Null
  $sourceRecord = Materialize-ExactSource -Bundle $bundle -Sha $sha -Destination $repo -EvidenceDirectory (Join-Path $phaseArtifacts 'source')
  $environment = New-SafeWindowsEnvironment -IsolatedHome $isolatedHome -Temp $temp -Additional @{
    GSTACK_HOME = $state
    BUN_INSTALL_CACHE_DIR = (Join-Path $isolatedHome '.bun\install\cache')
    GSTACK_SKIP_COREUTILS = '1'
    GSTACK_SKIP_FONTS = '1'
    GSTACK_SKIP_GBRAIN_REGEN = '1'
  }
  $install = Invoke-LoggedProcess -FilePath $bun -Arguments @('install', '--frozen-lockfile', '--ignore-scripts') -WorkingDirectory $repo -StdoutPath (Join-Path $phaseArtifacts 'bun-install.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'bun-install.stderr.log') -Environment $environment
  if ($install.ExitCode -ne 0) { throw "PR #1743 dependency install failed for $caseId/$phase" }
  $environment['GSTACK_PR1743_PROBE_ROOT'] = $probeRoot
  $environment['GSTACK_UNDER_TEST'] = $repo
  $environment['GSTACK_PR_TEST_CONSUMER'] = $consumer
  $environment['GSTACK_PR_TEST_HOME'] = $isolatedHome
  $environment['GSTACK_PR_TEST_STATE'] = $state
  $environment['GSTACK_PR_TEST_ARTIFACT_ROOT'] = $probeArtifactRoot
  $environment['GSTACK_PR_TEST_REPO'] = $caseId
  $environment['GSTACK_PR_TEST_PHASE'] = $phase
  [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'fixed-command.txt'), ($fixedCommand + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'fixed-command.sha256'), ($fixedCommandHash + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  Assert-SafeChildEnvironment -Environment $environment -EvidencePath (Join-Path $phaseArtifacts 'tested-child-environment.json')
  $networkEvidence = Join-Path $phaseArtifacts 'network'
  $lockdown = Enter-TestNetworkLockdown -EvidenceDirectory $networkEvidence
  try {
    $run = Invoke-LoggedProcess -FilePath $pwsh -Arguments @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $probe) -WorkingDirectory $consumer -StdoutPath (Join-Path $phaseArtifacts 'probe.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'probe.stderr.log') -Environment $environment
  } finally {
    Exit-TestNetworkLockdown -RuleName $lockdown -EvidenceDirectory $networkEvidence
  }
  $leakPattern = 'GSTACK_PR1743_WINDOWS_DPAPI_SENTINEL_d4f531ce6a|GSTACK_PR1743_SENTINEL_8d919dc9a143_DO_NOT_LOG'
  $leaks = @(Select-String -LiteralPath $run.StdoutPath, $run.StderrPath -Pattern $leakPattern)
  if ($leaks.Count -ne 0) { throw "PR #1743 sentinel leaked for $caseId/$phase" }
  Write-Host "===== PR1743 $caseId $phase stdout ====="
  Get-Content -LiteralPath $run.StdoutPath
  Write-Host "===== PR1743 $caseId $phase stderr ====="
  Get-Content -LiteralPath $run.StderrPath
  $phaseResults += [ordered]@{
    phase = $phase
    expectedSha = $sha
    actualSha = $sourceRecord.actualSha
    exitCode = $run.ExitCode
    stdoutSha256 = $run.StdoutSha256
    stderrSha256 = $run.StderrSha256
    durationMs = $run.DurationMs
    repo = $repo
    consumer = $consumer
    home = $isolatedHome
    state = $state
    consumerRevision = $case.sha
    consumerArchiveSha256 = $case.archiveSha256
    probeArtifactRoot = $probeArtifactRoot
  }
}

$baselineExit = ($phaseResults | Where-Object phase -eq 'baseline').exitCode
$candidateExit = ($phaseResults | Where-Object phase -eq 'candidate').exitCode
$expectationMet = if ($case.cohort -eq 'affected') {
  ($baselineExit -ne 0 -and $candidateExit -eq 0)
} else {
  ($baselineExit -eq 0 -and $candidateExit -eq 0)
}
$summary = [ordered]@{
  schemaVersion = 1
  pr = 1743
  case = $caseId
  cohort = $case.cohort
  baselineSha = $baselineSha
  candidateSha = $candidateSha
  consumerSha = $case.sha
  consumerArchive = $consumerArchive
  consumerArchiveSha256 = $case.archiveSha256
  consumerMaterialization = 'offline-pinned-archive'
  fixedCommandSha256 = $fixedCommandHash
  expectationMet = $expectationMet
  phases = $phaseResults
}
[IO.File]::WriteAllText((Join-Path $artifactRoot 'result.json'), (($summary | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
Write-ArtifactHashManifest -ArtifactRoot $artifactRoot -OutputPath (Join-Path $artifactRoot 'artifact-manifest.json')
if (-not $expectationMet) { throw "PR #1743 expectation failed for $($caseId): baseline=$baselineExit candidate=$candidateExit" }
