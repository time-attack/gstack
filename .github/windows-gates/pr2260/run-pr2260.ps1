Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\common-windows.ps1')

$caseId = $env:PR2260_CASE
$kind = $env:PR2260_KIND
$pathMode = $env:PR2260_PATH_MODE
$cases = @{
  onemancompany = @{
    kind = 'affected'
    pathMode = 'plain'
    revision = '8f880c03b2014e866b374c039333a1f201c971e0'
    archive = 'pr2260-consumers\onemancompany-8f880c03.tar.gz'
    archiveSha256 = '13e82dde4a01d81a7dfa4273278d9ba9cccd1fca5b3c77522b83b18391cda669'
  }
  gbrain = @{
    kind = 'affected'
    pathMode = 'spaces'
    revision = '5008b287e47bf791132eedfebf66bdef11e9398c'
    archive = 'pr1981-transfer\gbrain-0.42.59.0-5008b287-fallback.tar.gz'
    archiveSha256 = '0750d2ddf15d25bf9234322d4f605b85b0845d96e2bd9bc31069e7c041006135'
  }
  plane = @{
    kind = 'control'
    pathMode = 'plain'
    revision = 'bed58d9b17dbc8b221af9cde0cec9cec299d183b'
    archive = 'pr2260-consumers\plane-bed58d9b.tar.gz'
    archiveSha256 = 'bfb210ccb64e94aec22c1840b358df7f4f323eafde5932d7fc5b957370774530'
  }
}
if (-not $cases.ContainsKey($caseId)) { throw "rejected PR #2260 case: $caseId" }
if ($kind -ne $cases[$caseId].kind -or $pathMode -ne $cases[$caseId].pathMode) {
  throw "PR #2260 matrix metadata mismatch for $caseId"
}

$baselineSha = 'a3259400a366593e0c909dd9ac3e59752efd2488'
$candidateSha = 'b9fbe4dea9b192d5d6fe6814bc558f89ef41dde7'
$bundle = Join-Path $env:GITHUB_WORKSPACE '.github\windows-gates\payloads\gstack-exact-windows-refs.bundle'
$consumerArchive = Join-Path $env:GITHUB_WORKSPACE (Join-Path '.github\windows-gates\payloads' $cases[$caseId].archive)
$bash = 'C:\Program Files\Git\bin\bash.exe'
$bun = (Get-Command bun.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$git = (Get-Command git.exe -ErrorAction Stop).Source
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $bash)) { throw "Git Bash missing at fixed path: $bash" }
if ((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant() -ne '7b7c543417e066c8a5da6eeb8b179e1cc4bb16e7da0237441457c421531c08ef') {
  throw 'exact-ref bundle hash mismatch'
}
if ((Get-FileHash -LiteralPath $consumerArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $cases[$caseId].archiveSha256) {
  throw "pinned consumer archive hash mismatch for $caseId"
}

$gateRoot = 'C:\gstack-isolated\pr-2260'
$caseFolder = if ($pathMode -eq 'spaces') { "$caseId path with spaces" } else { $caseId }
$caseRoot = Assert-IsolatedPath -Path (Join-Path $gateRoot $caseFolder) -AllowedRoot $gateRoot
if (Test-Path -LiteralPath $caseRoot) { throw "refusing to reuse PR #2260 root: $caseRoot" }
[IO.Directory]::CreateDirectory($caseRoot) | Out-Null
$artifactRoot = Join-Path $env:RUNNER_TEMP "gstack-windows-gates\pr2260\$caseId"
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
[IO.File]::WriteAllText((Join-Path $artifactRoot 'harness-started.txt'), ("startedAt=$([DateTime]::UtcNow.ToString('o'))" + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
$fixtureRoot = $PSScriptRoot
$probeScript = Join-Path $PSScriptRoot 'windows-build-runtime.sh'
$controlScript = Join-Path $PSScriptRoot 'control-probe.sh'
$fixedWrapper = Join-Path $PSScriptRoot 'run-pr2260-fixed.sh'

$factsHome = Join-Path $caseRoot 'tool-facts-home'
$factsTemp = Join-Path $caseRoot 'tool-facts-temp'
$factsEnvironment = New-SafeWindowsEnvironment -IsolatedHome $factsHome -Temp $factsTemp
Assert-SafeChildEnvironment -Environment $factsEnvironment -EvidencePath (Join-Path $artifactRoot 'tool-facts-child-environment.json')
function Invoke-ToolFact {
  param([string]$Name, [string]$FilePath, [string[]]$Arguments)
  $stdout = Join-Path $artifactRoot "tool-$Name.stdout.log"
  $stderr = Join-Path $artifactRoot "tool-$Name.stderr.log"
  $result = Invoke-LoggedProcess -FilePath $FilePath -Arguments $Arguments -WorkingDirectory $caseRoot -StdoutPath $stdout -StderrPath $stderr -Environment $factsEnvironment
  if ($result.ExitCode -ne 0) { throw "tool fact failed: $Name" }
  return [IO.File]::ReadAllText($stdout).Trim()
}
$toolFacts = [ordered]@{
  case = $caseId
  cohort = $kind
  pathMode = $pathMode
  os = [Environment]::OSVersion.VersionString
  architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
  runnerImage = $env:ImageOS
  runnerImageVersion = $env:ImageVersion
  bashPath = $bash
  bashVersion = (Invoke-ToolFact -Name 'bash-version' -FilePath $bash -Arguments @('--version')).Split([Environment]::NewLine)[0]
  bunPath = $bun
  bunVersion = Invoke-ToolFact -Name 'bun-version' -FilePath $bun -Arguments @('--version')
  bunRevision = Invoke-ToolFact -Name 'bun-revision' -FilePath $bun -Arguments @('--revision')
  nodePath = $node
  nodeVersion = Invoke-ToolFact -Name 'node-version' -FilePath $node -Arguments @('--version')
  gitVersion = Invoke-ToolFact -Name 'git-version' -FilePath $git -Arguments @('--version')
  bundleSha256 = (Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash.ToLowerInvariant()
  consumerArchive = $consumerArchive
  consumerArchiveSha256 = $cases[$caseId].archiveSha256
  consumerRevision = $cases[$caseId].revision
}
[IO.File]::WriteAllText((Join-Path $artifactRoot 'tool-facts.json'), (($toolFacts | ConvertTo-Json -Depth 5) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))

$phaseResults = @()
foreach ($phase in @('baseline', 'candidate')) {
  $sha = if ($phase -eq 'baseline') { $baselineSha } else { $candidateSha }
  $phaseRoot = Assert-IsolatedPath -Path (Join-Path $caseRoot $phase) -AllowedRoot $gateRoot
  $repo = Join-Path $phaseRoot 'repo'
  $consumer = Join-Path $phaseRoot 'consumer'
  $isolatedHome = Join-Path $phaseRoot 'home'
  $state = Join-Path $phaseRoot 'state'
  $temp = Join-Path $phaseRoot 'tmp'
  $browserRoot = Join-Path $phaseRoot 'playwright'
  $evidence = Join-Path $phaseRoot 'evidence'
  $phaseArtifacts = Join-Path $artifactRoot $phase
  [IO.Directory]::CreateDirectory($isolatedHome) | Out-Null
  [IO.Directory]::CreateDirectory($state) | Out-Null
  [IO.Directory]::CreateDirectory($temp) | Out-Null
  [IO.Directory]::CreateDirectory($browserRoot) | Out-Null
  [IO.Directory]::CreateDirectory($evidence) | Out-Null
  [IO.Directory]::CreateDirectory($phaseArtifacts) | Out-Null

  $sourceRecord = Materialize-ExactSource -Bundle $bundle -Sha $sha -Destination $repo -EvidenceDirectory (Join-Path $phaseArtifacts 'source')
  [IO.Directory]::CreateDirectory($consumer) | Out-Null
  $baseEnvironment = New-SafeWindowsEnvironment -IsolatedHome $isolatedHome -Temp $temp
  $extract = Invoke-LoggedProcess -FilePath $tar -Arguments @('-xzf', $consumerArchive, '-C', $consumer) -WorkingDirectory $phaseRoot -StdoutPath (Join-Path $phaseArtifacts 'consumer-extract.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'consumer-extract.stderr.log') -Environment $baseEnvironment
  if ($extract.ExitCode -ne 0) { throw "consumer extraction failed for $caseId/$phase" }
  $processEnvironment = New-SafeWindowsEnvironment -IsolatedHome $isolatedHome -Temp $temp -Additional @{
    HOME = (Convert-NativeToMsys $isolatedHome)
    USERPROFILE = $isolatedHome
    GSTACK_HOME = $state
    GSTACK_UNDER_TEST = $repo
    GSTACK_PR_TEST_REPO = $caseId
    GSTACK_PR_TEST_PHASE = $phase
    GSTACK_SKIP_COREUTILS = '1'
    GSTACK_SKIP_FONTS = '1'
    GSTACK_SKIP_GBRAIN_REGEN = '1'
    BUN_INSTALL_CACHE_DIR = (Join-Path $isolatedHome '.bun\install\cache')
    PLAYWRIGHT_BROWSERS_PATH = $browserRoot
    PR2260_PLAYWRIGHT_ROOT = $browserRoot
    PR2260_FIXTURE_ROOT = $fixtureRoot
    PR2260_EVIDENCE_DIR = $evidence
    PR2260_PROBE_SCRIPT = $probeScript
    PR2260_CONTROL_SCRIPT = $controlScript
    PR2260_FIXED_WRAPPER = $fixedWrapper
    PR2260_CONSUMER_ROOT = $consumer
    PR2260_CONSUMER_REVISION = $cases[$caseId].revision
    PR2260_KIND = $kind
    MSYS_NO_PATHCONV = '1'
  }
  Assert-SafeChildEnvironment -Environment $processEnvironment -EvidencePath (Join-Path $phaseArtifacts 'tested-child-environment.json')

  $install = Invoke-LoggedProcess -FilePath $bun -Arguments @('install', '--frozen-lockfile', '--ignore-scripts') -WorkingDirectory $repo -StdoutPath (Join-Path $phaseArtifacts 'bun-install.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'bun-install.stderr.log') -Environment $processEnvironment
  if ($install.ExitCode -ne 0) { throw "PR #2260 dependency install failed for $caseId/$phase" }

  $serverBuildEnvironment = $processEnvironment.Clone()
  $serverBuildEnvironment.Remove('MSYS_NO_PATHCONV') | Out-Null
  $serverBuildScript = Convert-NativeToMsys (Join-Path $repo 'browse\scripts\build-node-server.sh')
  $serverBuild = Invoke-LoggedProcess -FilePath $bash -Arguments @($serverBuildScript) -WorkingDirectory $repo -StdoutPath (Join-Path $phaseArtifacts 'build-node-server.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'build-node-server.stderr.log') -Environment $serverBuildEnvironment
  if ($serverBuild.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $repo 'browse\dist\server-node.mjs'))) {
    throw "PR #2260 Windows server bundle setup failed for $caseId/$phase"
  }

  if ($kind -eq 'affected') {
    $playwrightCli = Join-Path $repo 'node_modules\playwright\cli.js'
    if (-not (Test-Path -LiteralPath $playwrightCli)) { throw "pinned Playwright CLI missing for $caseId/$phase" }
    $browserInstall = Invoke-LoggedProcess -FilePath $bun -Arguments @($playwrightCli, 'install', 'chromium') -WorkingDirectory $repo -StdoutPath (Join-Path $phaseArtifacts 'playwright-install.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'playwright-install.stderr.log') -Environment $processEnvironment
    if ($browserInstall.ExitCode -ne 0) { throw "PR #2260 Chromium install failed for $caseId/$phase" }
    Copy-Item -LiteralPath (Join-Path $repo 'node_modules\playwright\package.json') -Destination (Join-Path $phaseArtifacts 'playwright-package.json')
    Copy-Item -LiteralPath (Join-Path $repo 'node_modules\playwright-core\browsers.json') -Destination (Join-Path $phaseArtifacts 'playwright-browsers.json')
  }
  $fixedCommand = 'bash "$(cygpath -u "$PR2260_FIXED_WRAPPER")"'
  [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'fixed-command.txt'), ($fixedCommand + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  $fixedCommandHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($fixedCommand))).ToLowerInvariant()
  if ($fixedCommandHash -ne 'cc3e5749348a7c0feb70fbf83d7be8fb9ab0d26750da369be85982eb1bb0d5ce') {
    throw 'PR #2260 outer fixed command hash mismatch'
  }
  [IO.File]::WriteAllText((Join-Path $phaseArtifacts 'fixed-command.sha256'), ($fixedCommandHash + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  $networkEvidence = Join-Path $phaseArtifacts 'network'
  $lockdown = Enter-TestNetworkLockdown -EvidenceDirectory $networkEvidence
  try {
    $probe = Invoke-LoggedProcess -FilePath $bash -Arguments @('-lc', $fixedCommand) -WorkingDirectory $consumer -StdoutPath (Join-Path $phaseArtifacts 'probe.stdout.log') -StderrPath (Join-Path $phaseArtifacts 'probe.stderr.log') -Environment $processEnvironment
  } finally {
    Exit-TestNetworkLockdown -RuleName $lockdown -EvidenceDirectory $networkEvidence
  }
  Copy-Item -LiteralPath $evidence -Destination (Join-Path $phaseArtifacts 'probe-evidence') -Recurse
  Write-Host "===== PR2260 $caseId $phase stdout ====="
  Get-Content -LiteralPath $probe.StdoutPath
  Write-Host "===== PR2260 $caseId $phase stderr ====="
  Get-Content -LiteralPath $probe.StderrPath
  $phaseResults += [ordered]@{
    phase = $phase
    expectedSha = $sha
    actualSha = $sourceRecord.actualSha
    exitCode = $probe.ExitCode
    durationMs = $probe.DurationMs
    stdoutSha256 = $probe.StdoutSha256
    stderrSha256 = $probe.StderrSha256
    fixedCommand = $fixedCommand
    fixedCommandSha256 = $fixedCommandHash
    repo = $repo
    consumer = $consumer
    consumerRevision = $cases[$caseId].revision
    consumerArchiveSha256 = $cases[$caseId].archiveSha256
    home = $isolatedHome
    state = $state
    evidence = $evidence
  }
}

$baselineExit = ($phaseResults | Where-Object phase -eq 'baseline').exitCode
$candidateExit = ($phaseResults | Where-Object phase -eq 'candidate').exitCode
$expectationMet = if ($kind -eq 'affected') {
  ($baselineExit -ne 0 -and $candidateExit -eq 0)
} else {
  ($baselineExit -eq 0 -and $candidateExit -eq 0)
}
$summary = [ordered]@{
  schemaVersion = 1
  pr = 2260
  case = $caseId
  cohort = $kind
  baselineSha = $baselineSha
  candidateSha = $candidateSha
  expected = if ($kind -eq 'affected') { 'baseline-nonzero-candidate-zero' } else { 'baseline-zero-candidate-zero' }
  expectationMet = $expectationMet
  phases = $phaseResults
}
[IO.File]::WriteAllText((Join-Path $artifactRoot 'result.json'), (($summary | ConvertTo-Json -Depth 8) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
Write-ArtifactHashManifest -ArtifactRoot $artifactRoot -OutputPath (Join-Path $artifactRoot 'artifact-manifest.json')
if (-not $expectationMet) { throw "PR #2260 expectation failed for $($caseId): baseline=$baselineExit candidate=$candidateExit" }
