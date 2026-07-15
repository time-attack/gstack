Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\common-windows.ps1')

$root = Join-Path ([IO.Path]::GetTempPath()) "gstack-model-overlay-identity-$([Guid]::NewGuid().ToString('N'))"
$phaseRoot = Join-Path $root 'baseline'
[IO.Directory]::CreateDirectory($phaseRoot) | Out-Null
[IO.File]::WriteAllText((Join-Path $phaseRoot 'test-windows.stdout.log'), ("(fail) exact known test [12ms]" + [Environment]::NewLine + "0 fail" + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $phaseRoot 'test-windows.stderr.log'), ("error: exact known identity" + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
$actualOrderedPhaseObject = [ordered]@{
  phase = 'baseline'
  repo = (Join-Path $root 'baseline\repo')
}
$identity = Get-ModelOverlayFailureIdentity -PhaseResult $actualOrderedPhaseObject -ArtifactRoot $root
if ($identity.count -ne 2) { throw "ordered phase self-test count mismatch: $($identity.count)" }
if ($identity.lines[0] -ne '(fail) exact known test [duration]') { throw 'duration normalization self-test failed' }
if ($identity.lines[1] -ne 'error: exact known identity') { throw 'failure line self-test failed' }
if ($identity.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'failure identity hash self-test failed' }
Write-Output "MODEL_OVERLAY_FAILURE_IDENTITY_SELF_TEST_OK sha256=$($identity.sha256)"
