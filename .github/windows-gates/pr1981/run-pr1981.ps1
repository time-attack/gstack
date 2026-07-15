Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\common-windows.ps1')

$caseId = $env:PR1981_CASE
$cases = @{
  'healthy-gbrain-clean' = @{
    role = 'affected-primary'
    mode = 'healthy'
    consumer = 'gbrain'
    repoId = 'garrytan/gbrain@61b79e7c996284574539860145904fa0c0ee835a'
    spaces = $false
    gbrain = $true
    productFixture = $false
  }
  'healthy-gstack-auto-spaces' = @{
    role = 'affected-primary'
    mode = 'healthy'
    consumer = 'gstack-auto'
    repoId = 'loperanger7/gstack-auto@17bf2a025c175b899e7d30be1ab4e658fd4ae04f'
    spaces = $true
    gbrain = $true
    productFixture = $false
  }
  'no-cli-stagehand' = @{
    role = 'control-primary'
    mode = 'no-cli'
    consumer = 'stagehand'
    repoId = 'browserbase/stagehand@2a6e20b068bb724bdbd3c192b6463acd6b9b817c'
    spaces = $false
    gbrain = $false
    productFixture = $false
  }
  'timeout-stagehand' = @{
    role = 'secondary'
    mode = 'timeout'
    consumer = 'stagehand'
    repoId = 'browserbase/stagehand@2a6e20b068bb724bdbd3c192b6463acd6b9b817c'
    spaces = $false
    gbrain = $true
    productFixture = $false
  }
  'missing-version-secondary' = @{
    role = 'secondary'
    mode = 'missing-version'
    consumer = 'stagehand'
    repoId = 'browserbase/stagehand@2a6e20b068bb724bdbd3c192b6463acd6b9b817c'
    spaces = $false
    gbrain = $true
    productFixture = $true
  }
}
if (-not $cases.ContainsKey($caseId)) { throw "rejected PR #1981 case: $caseId" }
$case = $cases[$caseId]

$root = 'C:\gstack-isolated\pr-1981'
if (Test-Path -LiteralPath $root) { throw "refusing to reuse PR #1981 root: $root" }
[IO.Directory]::CreateDirectory($root) | Out-Null
$artifactRoot = Join-Path $env:RUNNER_TEMP "gstack-windows-gates\pr1981\$caseId"
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
[IO.File]::WriteAllText((Join-Path $artifactRoot 'harness-started.txt'), ("startedAt=$([DateTime]::UtcNow.ToString('o'))" + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
$transferSource = Join-Path $env:GITHUB_WORKSPACE '.github\windows-gates\payloads\pr1981-transfer'
$transfer = Join-Path $root 'transfer'
[IO.Directory]::CreateDirectory($transfer) | Out-Null
Get-ChildItem -LiteralPath $transferSource | Copy-Item -Destination $transfer -Recurse

$manifestHash = (Get-FileHash -LiteralPath (Join-Path $transfer 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$validatorHash = (Get-FileHash -LiteralPath (Join-Path $transfer 'validate-payload.sh') -Algorithm SHA256).Hash.ToLowerInvariant()
if ($manifestHash -ne '31a75f09ed5b615eb4079c1fe92fc3a1bb5659dec0bf22508899c9dadbfaa8c8') {
  throw 'PR #1981 transfer manifest hash mismatch'
}
if ($validatorHash -ne '229e4ad28130b6d758f97aad3de40806f24bbb948ab32b29bc24a785d11fdc83') {
  throw 'PR #1981 transfer validator hash mismatch'
}

$bash = 'C:\Program Files\Git\bin\bash.exe'
$bun = (Get-Command bun.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$python3 = (Get-Command python3.exe -ErrorAction Stop).Source
$pythonDirectory = [IO.Path]::GetDirectoryName($python3)
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$toolHome = Join-Path $root 'tool-home'
$toolTemp = Join-Path $root 'tool-temp'
$toolEnvironment = New-SafeWindowsEnvironment -IsolatedHome $toolHome -Temp $toolTemp -AdditionalPath @($pythonDirectory)
Assert-SafeChildEnvironment -Environment $toolEnvironment -EvidencePath (Join-Path $artifactRoot 'tool-child-environment.json')

function Invoke-ToolFact {
  param([string]$Name, [string]$FilePath, [string[]]$Arguments)
  $stdout = Join-Path $artifactRoot "tool-$Name.stdout.log"
  $stderr = Join-Path $artifactRoot "tool-$Name.stderr.log"
  $result = Invoke-LoggedProcess -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $root -StdoutPath $stdout -StderrPath $stderr -Environment $toolEnvironment
  if ($result.ExitCode -ne 0) { throw "tool fact failed: $Name" }
  return [IO.File]::ReadAllText($stdout).Trim()
}

$pythonFacts = Invoke-ToolFact -Name 'python-facts' -FilePath $python3 -Arguments @('-c', 'import os,platform,sys; print("os.name="+os.name); print("platform.system="+platform.system()); print("sys.executable="+sys.executable); print("version="+platform.python_version())')
if ($pythonFacts -notmatch 'os.name=nt' -or $pythonFacts -notmatch 'platform.system=Windows') {
  throw "hosted Python is not native Windows: $pythonFacts"
}
$facts = [ordered]@{
  case = $caseId
  role = $case.role
  os = [Environment]::OSVersion.VersionString
  architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  runnerImage = $env:ImageOS
  runnerImageVersion = $env:ImageVersion
  bashPath = $bash
  bashVersion = (Invoke-ToolFact -Name 'bash-version' -FilePath $bash -Arguments @('--version')).Split([Environment]::NewLine)[0]
  bunPath = $bun
  bunVersion = Invoke-ToolFact -Name 'bun-version' -FilePath $bun -Arguments @('--version')
  nodePath = $node
  nodeVersion = Invoke-ToolFact -Name 'node-version' -FilePath $node -Arguments @('--version')
  python3Path = $python3
  pythonFacts = $pythonFacts -split '\r?\n'
  prRoot = $root
  transferManifestSha256 = $manifestHash
  transferValidatorSha256 = $validatorHash
}
[IO.File]::WriteAllText((Join-Path $artifactRoot 'tool-facts.json'), (($facts | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))

$validatorMsys = Convert-NativeToMsys (Join-Path $transfer 'validate-payload.sh')
$transferMsys = Convert-NativeToMsys $transfer
$validation = Invoke-LoggedProcess -FilePath $bash -Arguments @($validatorMsys, $transferMsys) -WorkingDirectory $transfer -StdoutPath (Join-Path $artifactRoot 'transfer-validation.stdout.log') -StderrPath (Join-Path $artifactRoot 'transfer-validation.stderr.log') -Environment $toolEnvironment
if ($validation.ExitCode -ne 0 -or (Get-Item -LiteralPath $validation.StderrPath).Length -ne 0) {
  throw 'PR #1981 transfer validation failed before unpack'
}

function Expand-PinnedArchive {
  param([string]$Archive, [string]$Destination, [string]$Label)
  if (Test-Path -LiteralPath $Destination) { throw "refusing to overwrite extraction: $Destination" }
  [IO.Directory]::CreateDirectory($Destination) | Out-Null
  $stdout = Join-Path $artifactRoot "extract-$Label.stdout.log"
  $stderr = Join-Path $artifactRoot "extract-$Label.stderr.log"
  $result = Invoke-LoggedProcess -FilePath $tar -Arguments @('-xzf', $Archive, '-C', $Destination) -WorkingDirectory $root -StdoutPath $stdout -StderrPath $stderr -Environment $toolEnvironment
  if ($result.ExitCode -ne 0) { throw "pinned archive extraction failed: $Label" }
}

$phaseResults = @()
foreach ($phase in @('baseline', 'candidate')) {
  $phaseBase = if ($case.spaces) {
    Join-Path $root "path with spaces\$phase"
  } else {
    Join-Path $root $phase
  }
  $repo = Join-Path $phaseBase 'repo'
  $isolatedHome = Join-Path $phaseBase 'home'
  $state = Join-Path $phaseBase 'state'
  $temp = Join-Path $phaseBase 'tmp'
  $evidence = Join-Path $phaseBase 'evidence'
  $phaseArtifacts = Join-Path $artifactRoot $phase
  [IO.Directory]::CreateDirectory($isolatedHome) | Out-Null
  [IO.Directory]::CreateDirectory($state) | Out-Null
  [IO.Directory]::CreateDirectory($temp) | Out-Null
  [IO.Directory]::CreateDirectory($evidence) | Out-Null
  [IO.Directory]::CreateDirectory($phaseArtifacts) | Out-Null
  $archive = if ($phase -eq 'baseline') {
    Join-Path $transfer 'gstack-baseline-a3259400.tar.gz'
  } else {
    Join-Path $transfer 'gstack-test-merge-1981.tar.gz'
  }
  Expand-PinnedArchive -Archive $archive -Destination $repo -Label "gstack-$phase"
  if ($case.productFixture) {
    Copy-Item -LiteralPath (Join-Path $transfer 'probes\missing-version-detector.sh') -Destination (Join-Path $repo 'bin\gstack-gbrain-detect') -Force
  }

  $gbrainRoot = $null
  $gbrainBin = $null
  if ($case.gbrain) {
    $gbrainRoot = Join-Path $phaseBase 'official-gbrain'
    $gbrainBin = Join-Path $phaseBase 'gbrain-bin'
    Expand-PinnedArchive -Archive (Join-Path $transfer 'gbrain-0.35.8.0-61b79e7c.tar.gz') -Destination $gbrainRoot -Label "gbrain-$phase"
    [IO.Directory]::CreateDirectory($gbrainBin) | Out-Null
    $gbrainInstallHome = Join-Path $phaseBase 'gbrain-install-home'
    $gbrainInstallTemp = Join-Path $phaseBase 'gbrain-install-temp'
    $gbrainInstallEnvironment = New-SafeWindowsEnvironment -IsolatedHome $gbrainInstallHome -Temp $gbrainInstallTemp -AdditionalPath @($pythonDirectory, $gbrainBin) -Additional @{
      BUN_INSTALL_CACHE_DIR = (Join-Path $gbrainInstallHome '.bun\install\cache')
    }
    Assert-SafeChildEnvironment -Environment $gbrainInstallEnvironment -EvidencePath (Join-Path $phaseArtifacts 'gbrain-install-child-environment.json')
    $gbrainInstall = Invoke-LoggedProcess -FilePath $bun -Arguments @('install', '--frozen-lockfile', '--ignore-scripts') -WorkingDirectory $gbrainRoot -StdoutPath (Join-Path $phaseArtifacts 'gbrain-bun-install.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'gbrain-bun-install.stderr.log') -Environment $gbrainInstallEnvironment
    if ($gbrainInstall.ExitCode -ne 0) { throw "official gbrain frozen dependency install failed for $phase" }
    # Bun-compiled Windows executables currently resolve PGlite's embedded
    # data file through B:\~BUN\root and fail before the CLI can initialize.
    # A normal Windows package install exposes a .cmd launcher, so mirror that
    # shape while running the exact pinned official TypeScript source with the
    # exact pinned Bun runtime. Cache only --version to stay inside gstack's
    # two-second discovery preflight; every behavioral command reaches the
    # official CLI.
    $gbrainLauncher = Join-Path $gbrainBin 'gbrain.cmd'
    $gbrainBashLauncher = Join-Path $gbrainBin 'gbrain'
    $gbrainEntry = Join-Path $gbrainRoot 'src\cli.ts'
    $launcherText = @"
@echo off
if "%~1"=="--version" (
  echo 0.35.8.0
  exit /b 0
)
"$bun" run "$gbrainEntry" %*
"@
    [IO.File]::WriteAllText($gbrainLauncher, ($launcherText.TrimStart() + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    $bunMsys = Convert-NativeToMsys $bun
    $gbrainEntryMsys = Convert-NativeToMsys $gbrainEntry
    $bashLauncherText = @'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--version" ]; then
  printf '0.35.8.0\n'
  exit 0
fi
exec "__BUN__" run "__ENTRY__" "$@"
'@
    $bashLauncherText = $bashLauncherText.Replace('__BUN__', $bunMsys).Replace('__ENTRY__', $gbrainEntryMsys)
    [IO.File]::WriteAllText($gbrainBashLauncher, ($bashLauncherText.TrimStart() + "`n"), [Text.UTF8Encoding]::new($false))
    $gbrainBashLauncherMsys = Convert-NativeToMsys $gbrainBashLauncher
    $chmod = Invoke-LoggedProcess -FilePath $bash -Arguments @('-c', 'chmod +x -- "$1"', 'gstack-chmod', $gbrainBashLauncherMsys) -WorkingDirectory $gbrainRoot -StdoutPath (Join-Path $phaseArtifacts 'gbrain-launcher-chmod.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'gbrain-launcher-chmod.stderr.log') -Environment $gbrainInstallEnvironment
    if ($chmod.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $gbrainLauncher) -or -not (Test-Path -LiteralPath $gbrainBashLauncher)) { throw "official gbrain Windows launcher creation failed for $phase" }
    [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'gbrain-launcher.sha256'), ((Get-FileHash -LiteralPath $gbrainLauncher -Algorithm SHA256).Hash.ToLowerInvariant() + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'gbrain-bash-launcher.sha256'), ((Get-FileHash -LiteralPath $gbrainBashLauncher -Algorithm SHA256).Hash.ToLowerInvariant() + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'gbrain-launcher-mode.txt'), ('pinned-official-source-via-windows-cmd-and-git-bash' + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  }

  $consumerRoot = Join-Path $phaseBase 'consumer'
  if ($case.consumer -eq 'gbrain') {
    $consumerRoot = $gbrainRoot
  } elseif ($case.consumer -eq 'gstack-auto') {
    Expand-PinnedArchive -Archive (Join-Path $transfer 'gstack-auto-17bf2a02.tar.gz') -Destination $consumerRoot -Label "gstack-auto-$phase"
  } else {
    Expand-PinnedArchive -Archive (Join-Path $transfer 'stagehand-2a6e20b0.tar.gz') -Destination $consumerRoot -Label "stagehand-$phase"
  }

  $pathAdditions = if ($case.gbrain) { @($pythonDirectory, $gbrainBin) } else { @($pythonDirectory) }
  $homeMsys = Convert-NativeToMsys $isolatedHome
  $stateMsys = Convert-NativeToMsys $state
  $repoMsys = Convert-NativeToMsys $repo
  $evidenceMsys = Convert-NativeToMsys $evidence
  $probeEnvironment = New-SafeWindowsEnvironment -IsolatedHome $isolatedHome -Temp $temp -AdditionalPath $pathAdditions -Additional @{
    HOME = $homeMsys
    USERPROFILE = $isolatedHome
    GSTACK_PR_TEST_PHASE = $phase
    GSTACK_PR_TEST_REPO = $case.repoId
    GSTACK_UNDER_TEST = $repoMsys
    GSTACK_STATE_ROOT = $stateMsys
    GSTACK_HOME = $stateMsys
    WINDOWS_PROBE_MODE = $case.mode
    WINDOWS_EVIDENCE_DIR = $evidenceMsys
    GSTACK_SKIP_COREUTILS = '1'
    GSTACK_SKIP_FONTS = '1'
    GSTACK_SKIP_GBRAIN_REGEN = '1'
    GSTACK_DETECT_NO_CACHE = '1'
  }
  Assert-SafeChildEnvironment -Environment $probeEnvironment -EvidencePath (Join-Path $phaseArtifacts 'tested-child-environment.json')

  $fixedCommand = 'bash "/c/gstack-isolated/pr-1981/probes/windows-git-bash-probe.sh"'
  $fixedCommandHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($fixedCommand))).ToLowerInvariant()
  if ($fixedCommandHash -notmatch '^[0-9a-f]{64}$' -or $fixedCommandHash -ne '3468b951bfb21d68751872e9f8f96b9abcdcd6d6dd3fb0f1af39c90f28d36b8e') {
    throw 'PR #1981 fixed command hash mismatch'
  }
  $productCommand = 'gstack-config gbrain-refresh'
  $productCommandHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($productCommand))).ToLowerInvariant()
  if ($productCommandHash -ne 'c7dca8c1854c743a068054b3da932185cf9fbca95cb4743bcf719b7cad176849') {
    throw 'PR #1981 product command hash mismatch'
  }
  $probeDirectory = Join-Path $root 'probes'
  [IO.Directory]::CreateDirectory($probeDirectory) | Out-Null
  Copy-Item -LiteralPath (Join-Path $transfer 'probes\windows-git-bash-probe.sh') -Destination (Join-Path $probeDirectory 'windows-git-bash-probe.sh') -Force
  [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'fixed-command.txt'), ($fixedCommand + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'fixed-command.sha256'), ($fixedCommandHash + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  $networkEvidence = Join-Path $phaseArtifacts 'network'
  $lockdown = Enter-TestNetworkLockdown -EvidenceDirectory $networkEvidence
  try {
    if ($case.gbrain) {
      $initScript = Convert-NativeToMsys (Join-Path $PSScriptRoot 'init-gbrain.sh')
      $init = Invoke-LoggedProcess -FilePath $bash -Arguments @($initScript) -WorkingDirectory $consumerRoot -StdoutPath (Join-Path $phaseArtifacts 'gbrain-init-and-sources.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'gbrain-init-and-sources.stderr.log') -Environment $probeEnvironment
      if ($init.ExitCode -ne 0) { throw "official gbrain initialization failed for $caseId/$phase" }
    }
    $probe = Invoke-LoggedProcess -FilePath $bash -Arguments @('/c/gstack-isolated/pr-1981/probes/windows-git-bash-probe.sh') -WorkingDirectory $consumerRoot -StdoutPath (Join-Path $phaseArtifacts 'probe.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'probe.stderr.log') -Environment $probeEnvironment
  } finally {
    Exit-TestNetworkLockdown -RuleName $lockdown -EvidenceDirectory $networkEvidence
  }
  Copy-Item -LiteralPath $evidence -Destination (Join-Path $phaseArtifacts 'probe-evidence') -Recurse
  Write-Host "===== PR1981 $caseId $phase stdout ====="
  Get-Content -LiteralPath $probe.StdoutPath
  Write-Host "===== PR1981 $caseId $phase stderr ====="
  Get-Content -LiteralPath $probe.StderrPath
  $phaseResults += [ordered]@{
    phase = $phase
    source = if ($phase -eq 'baseline') { 'a3259400a366593e0c909dd9ac3e59752efd2488' } else { 'test-merge-tree:1dd2815729520058a59f52d2aad8e60c9660c02c' }
    exitCode = $probe.ExitCode
    durationMs = $probe.DurationMs
    stdoutSha256 = $probe.StdoutSha256
    stderrSha256 = $probe.StderrSha256
    repo = $repo
    consumer = $consumerRoot
    home = $isolatedHome
    state = $state
    evidence = $evidence
  }
}

$baselineExit = ($phaseResults | Where-Object phase -eq 'baseline').exitCode
$candidateExit = ($phaseResults | Where-Object phase -eq 'candidate').exitCode
$expectationMet = ($baselineExit -eq 43 -and $candidateExit -eq 0)
$summary = [ordered]@{
  schemaVersion = 1
  pr = 1981
  case = $caseId
  role = $case.role
  mode = $case.mode
  baselineSha = 'a3259400a366593e0c909dd9ac3e59752efd2488'
  candidateHeadSha = '0778432976a384ce37f007c4a6e27000f61657cf'
  candidateTestMergeTree = '1dd2815729520058a59f52d2aad8e60c9660c02c'
  fixedCommand = 'bash "/c/gstack-isolated/pr-1981/probes/windows-git-bash-probe.sh"'
  fixedCommandSha256 = $fixedCommandHash
  productCommand = 'gstack-config gbrain-refresh'
  productCommandSha256 = $productCommandHash
  expected = 'baseline-43-candidate-0'
  expectationMet = $expectationMet
  defaultMsysConversion = $true
  forbiddenVariablesSet = @()
  transferManifestSha256 = $manifestHash
  transferValidatorSha256 = $validatorHash
  phases = $phaseResults
}
[IO.File]::WriteAllText((Join-Path $artifactRoot 'result.json'), (($summary | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
Write-ArtifactHashManifest -ArtifactRoot $artifactRoot -OutputPath (Join-Path $artifactRoot 'artifact-manifest.json')
if (-not $expectationMet) { throw "PR #1981 expectation failed for $($caseId): baseline=$baselineExit candidate=$candidateExit" }
