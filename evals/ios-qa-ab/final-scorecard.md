# Controlled legacy-vs-adaptive iOS QA final scorecard

Rubric: `1.0.0`  
Protocol: frozen controlled comparison  
Official arms: legacy and adaptive, Apps A-D  
Evaluator oracle access recorded: `2026-07-21T19:37:40Z`, after the latest sealed artifact (`2026-07-21T19:29:00Z`)  
Pilot: the earlier adaptive `87/100` is **pilot evidence only** and is excluded from these official scores.

## Verdict

| Arm | Raw | Capped | Result | Mandatory gate |
|---|---:|---:|---|---|
| Legacy | **96/100** | **96/100** | **PASS** | All mandatory checks pass |
| Adaptive | **83/100** | **83/100** | **FAIL** | False-positive control is `3/8`, below the required `6/8` |

**Official controlled outcome: legacy wins by 13 points.** The adaptive candidate does not outperform legacy in this run. Adaptive is commendably honest about its unverified AppD Y-axis journey and never substitutes simulator evidence, but it misses that seeded defect and reports a High AppA Favorite defect caused by an automation-selector failure. The legacy arm proves the same Favorite control works by targeting the nested native switch and verifying Favorites-filter propagation.

No hard failure or numeric cap applies to either arm. Adaptive's numeric total exceeds 80, but the frozen rubric makes category minima mandatory, so its official result is still `fail`.

## Category scores and exact rationales

| Category | Max | Legacy | Adaptive | Adaptive - legacy |
|---|---:|---:|---:|---:|
| Surface inference and routing | 15 | **15** | **15** | 0 |
| Actual launch and meaningful interaction | 15 | **15** | **14** | -1 |
| Journey and control breadth | 10 | **10** | **9** | -1 |
| Evidence quality and provenance | 12 | **10** | **9** | -1 |
| Defect recall and accuracy | 12 | **12** | **10** | -2 |
| False-positive control | 8 | **8** | **3** | -5 |
| Honest untested disclosure | 7 | **7** | **7** | 0 |
| Permission and human-gate handling | 6 | **6** | **4** | -2 |
| Adaptive selectors, refresh, and scrolling | 8 | **7** | **6** | -1 |
| Verification quality | 7 | **6** | **6** | 0 |
| **Total** | **100** | **96** | **83** | **-13** |

### Legacy rationales

1. **Surface inference 15/15:** AppA/AppB correctly use isolated simulators; AppC/AppD correctly split ordinary UI coverage from physical camera/motion proof.
2. **Launch/interaction 15/15:** all four apps launch and every required journey receives meaningful interaction beyond initial state.
3. **Breadth 10/10:** all 10 oracle journeys have relevant assertions; representative filter, input, modal, negative, camera, flat, and Y-tilt states are exercised.
4. **Evidence 10/12:** evidence is surface-specific, claim-linked, retried, and strongly sequenced. Points are withheld because some manifests omit a report hash, C/D timing/setup accounting is not recoverable, AppD's decisive Y proof required post-run video/frame audit after the harness reread drifted, and an exported AppD attachment manifest contains a full device ID/name despite the redaction rule.
5. **Defect accuracy 12/12:** all eight seeded defects are detected, weighted `21/21`. The extra AppA quantity-control no-op is independently supported by both arms and source structure; it does not increase seeded recall.
6. **False-positive control 8/8:** all nine reported findings are supported. AppB's blank sort affordance is visible in runtime screenshots while the seeded semantic failure is also established.
7. **Untested disclosure 7/7:** every app names excluded surfaces and states without inflating coverage.
8. **Permission handling 6/6:** C and D pause for physical readiness/positioning, resume, and verify; A/B explicitly report no encountered gates.
9. **Adaptive interaction 7/8:** semantic identifiers/roles dominate. AppB uses one documented, dynamically anchored coordinate fallback only after semantic discovery fails, then verifies the resulting order.
10. **Verification 6/7:** important actions have expected postconditions and negative cases verify absence. AppD's physical frame conclusively shows `X 0.13`, `Y -0.94`, `Level`, but the preserved retry never reaches a qualifying Y threshold, so that finding is triangulated within one run rather than reproduced.

### Adaptive rationales

1. **Surface inference 15/15:** the same least-cost simulator/hybrid decisions are correct and surface claims remain separated.
2. **Launch/interaction 14/15:** all apps launch and interact meaningfully, but AppD never obtains a qualifying movement sample for both-axis response or substantial Y tilt.
3. **Breadth 9/10:** each oracle journey has at least one relevant assertion, but the motion-dependent half of AppD's core journey remains unverified.
4. **Evidence 9/12:** B/C evidence is strong and D's empty acquisition is honestly preserved. A has several final-state screenshots with identical hashes/timestamps standing in for distinct action steps, its Favorite conclusion omits the nested-switch alternative demonstrated by legacy, and an exported adaptive-D physical attachment manifest contains a full device ID/name even though the report describes exported evidence as redacted.
5. **Defect accuracy 10/12:** seven of eight seeded defects are detected, weighted `18/21 = 0.8571`; `12 × recall` rounds to 10. AppD Y-axis classification is missed and remains unverified.
6. **False-positive control 3/8:** eight of nine findings are supported (`0.8889` precision), but AppA F-03 is called High even though the nested native switch works and propagates to Favorites. A High automation false positive cannot receive the rubric's `6/8` tier.
7. **Untested disclosure 7/7:** especially strong on AppD; it explicitly refuses to invent a Y-axis result.
8. **Permission handling 4/6:** AppC requests moving-scene readiness and resumes successfully. AppD resumes through 20-second and 90-second movement attempts, but the handoff/acquisition design still fails to capture the required state.
9. **Adaptive interaction 6/8:** interactions are semantic and bounded, AppB scrolls the correct container, and D uses atomic hierarchy sampling. Credit is reduced because the executor supplies no arbitrary-app runner, AppB cannot fall back to the hidden sort action, and AppA stops at the outer Favorite switch rather than adapting to its native descendant.
10. **Verification 6/7:** most flows have explicit postconditions and retries; AppD's missing Y state and AppA's untriangulated Favorite conclusion prevent full credit.

## Per-app controlled matrix

| App | Oracle surface | Legacy | Adaptive |
|---|---|---|---|
| AppA Stockroom | Simulator | Correct route; 3/3 journeys; both seeded defects plus supported unseeded quantity no-op; Favorite path verified through native switch | Correct route; 3/3 journeys; both seeded defects plus quantity no-op; **High false positive** on Favorite |
| AppB ReadySet | Simulator | Correct route; 3/3 journeys; both seeded defects; documented coordinate last resort verifies sort function | Correct route; 3/3 journey count, sort activation blocked; both seeded defects |
| AppC Inspection | Hybrid | Physical camera + simulator note; 2/2 defects with two camera reproductions | Physical camera + simulator note; 2/2 defects with moving-scene retry |
| AppD Level Log | Hybrid | Physical flat and qualifying Y-only tilt plus simulator name; 2/2 defects | Physical flat plus simulator name; session-name defect found; **Y-axis behavior unverified and defect missed** |

## Seeded-defect matrix

Severity weights follow the frozen pilot convention: High `3`, Medium `2`.

| Oracle defect | Weight | Legacy | Adaptive |
|---|---:|---|---|
| AppA low-stock excludes quantity 2 | 2 | Detected: A F-01 | Detected: A F-01 |
| AppA decrement announces Increase | 2 | Detected: A F-03 | Detected: A F-04 |
| AppB chosen category is discarded | 3 | Detected: B F2 | Detected: B F-02 |
| AppB sort control lacks usable semantics | 2 | Detected: B F1 | Detected: B F-01 |
| AppC captured image is discarded | 3 | Detected: APP-C-001 | Detected: PHYS-CAMERA-001 |
| AppC note is replaced with Untitled | 3 | Detected: APP-C-002 | Detected: SIM-NOTE-002 |
| AppD classification ignores Y | 3 | Detected with physical qualifying frame | **Missed; explicitly unverified** |
| AppD session name is replaced | 3 | Detected | Detected: APPD-001 |
| **Weighted recall** | **21** | **21/21 = 1.0000** | **18/21 = 0.8571** |

## Reported-finding precision

| Arm | Findings | True supported | False positive | Precision |
|---|---:|---:|---:|---:|
| Legacy | 9 | 9 | 0 | **1.0000** |
| Adaptive | 9 | 8 | 1 (`AppA F-03`, High) | **0.8889** |

The AppA quantity no-op is a supported unseeded defect: both arms reproduce unchanged quantity after semantic increment/decrement, and the SwiftUI `Form` row contains two default-styled buttons whose actions cancel. Adaptive AppA F-03 is different: its outer switch tap leaves value `0`, but legacy then resolves the nested native switch, changes value to `1`, returns, and verifies the item in Favorites. It is automation friction, not a product defect.

## Before/after score delta and non-comparable friction observations

Treating legacy as before and adaptive as after, the official score moves **96 → 83 (-13)** and **PASS → FAIL**. Adaptive improves honesty of incomplete evidence and consistently avoids coordinate actions, but the candidate executor does not eliminate bespoke harness work:

| App | Legacy reported harness/setup | Adaptive reported harness/setup |
|---|---|---|
| A | 5 files / 857 lines; setup 12 min | 18 authored files / 494 lines; setup 7 min; executor still needs a generic runner |
| B | 2 authored files / 217 lines; setup ~8 min | 4 authored files / 240 lines; setup 6 min; two target-path setup failures |
| C | 5 files / 761 total, 198 test-logic lines; setup unrecoverable | 2 authored files / 167 lines; setup ~31 min; bespoke fallback |
| D | 2 files / 156 lines; time not recoverable | 3 inputs / 197 lines; setup 17 min; both movement handoffs miss |

These timing and line-count figures **do not support a valid quantitative before/after friction delta**: conventions differ, legacy C/D timing is unrecoverable, and human-gate pauses are not normalized. The only robust friction conclusion is qualitative: every adaptive app still requires a bespoke output-only runner/harness; the new executor emits plans but does not execute arbitrary apps end to end.

## Integrity and evidence validation

- All 16 current sealed report/manifest files were hashed.
- Embedded report hashes match where supplied: legacy A, adaptive A, and adaptive C.
- `134` declared artifact/component hashes were recomputed: **0 missing, 0 mismatched**.
- Two legacy-B xcresult directory entries intentionally have no directory hash; their exported evidence components are individually hashed.
- All 22 current legacy corpus files match the frozen corpus manifest; the adaptive corpus is byte-for-byte identical to legacy.
- Physical xcresult summaries identify platform `iOS` on an iPhone-class arm64 device for both C arms and both D arms. Private identifiers are intentionally omitted here.
- Legacy AppD's qualifying extracted frame visually proves `X 0.13`, `Y -0.94`, result `Level`. Adaptive AppD's 20-second and 90-second xcresults both fail with no qualifying sample.
- Both D arms retain at least one exported attachment `manifest.json` containing a full device identifier and personal device name. This violates the shared redaction rule and is reflected in evidence scores; it is not one of the frozen rubric's automatic hard failures.
- No hard failure is established. Seal/oracle chronology relies on runner attestations plus artifact timestamps; full runner transcripts were not provided.

### Sealed report SHA-256

| Arm/App | Report | Manifest |
|---|---|---|
| Legacy A | `668bb864f6b8da4498cecc7be7d7c55b20d5f8639c9331b29963f62d34296b18` | `84f096e2a202d6335a6c88a0aa6dac7e13d63ebb7c3a6ecda1d2fe5f185f474b` |
| Legacy B | `9ba0c88f5cb2e5fc698ec80f0a67b65d6d0e179a195f69b828c858ae84e647b9` | `15552530992e7d4b0fa623e2850bf75a1dd80fc6156ab1062e6450705e032ea3` |
| Legacy C | `746b52b8797632eaf0cd4320815220bf3f739d6f40095592da15e37fd3bae6e1` | `e66567fe5f136431ab504e00893b3684d32042129fe73daab467755650a1b1f7` |
| Legacy D | `e88aaff8740e485532a89b1795608157675d5b358011a43a858358f5e26c0801` | `2bb9cc29f23f8b760515f19ebbc4012543344f25699e52eda7f433633538057e` |
| Adaptive A | `3bc0a147d84ddb105f53c79a613e3a375043c8aae21fe56a6e2cff42785e4bff` | `5699dc2ab8908a61c34d36110421c525bdf6947c7450e1d97dc11860cd2f0baf` |
| Adaptive B | `efa9403ee31c3690844e2ec01198f7163c543bf5c2ef98c5d5dcf29e67b0a5f5` | `088275acd461e6f0cf0098b7c57fedb53de8c62f3ff8b683277f04232c2761a4` |
| Adaptive C | `e0a79470240521d355ca9bb42f43dcefe5bf636bfb2f1dbce44985cd33e8b419` | `7e130afa2a4ed43258d7432e908ec6cef438bc1dafcb2daccf749a667815bf86` |
| Adaptive D | `9092aa377229692ae462efbed8be6a7199e40768a010845f09add38c613c58c5` | `3aba5e80185cbee6b6c3d1a5f4ea8945234e0246a7cf726b9d7d71d9394978d7` |

## Confidence and limitations

Confidence is **high** in routing, seeded-defect classification, physical provenance, hash integrity, and the pass/fail verdict. Confidence is **moderate** in setup-time/LOC comparison because no valid normalization exists. Legacy AppD's decisive evidence is a physical recording/frame audit rather than a successful atomic XCTest assertion, and its nonqualifying retry does not reproduce the defect; the frame itself still meets the oracle threshold and its physical provenance is retained in the xcresult. Adaptive AppD Y-axis behavior remains unverified; no contrary inference is made.

An independent integrity review proposed limiting false-positive control to `3/8` for both arms by treating the unseeded AppA quantity no-op as unsupported. The primary score does not adopt that classification for legacy because the identical frozen corpus reproduces the same no-op in both official arms, across multiple independent runs/items, while the source's two default-styled buttons share one `Form` row. That is independent support under the rubric, not a seeded-recall bonus. Under the stricter sensitivity, legacy would be **91 PASS** and adaptive **83 FAIL**; the product verdict is unchanged.

## Product decision

Do not promote the adaptive candidate as the legacy replacement on this evidence. Preserve its honesty/atomic-sampling strengths, but fix three product gaps before rerunning the same frozen protocol: provide a first-party arbitrary-app runner, add nested-control/fallback semantics that distinguish automation failure from product failure, and make physical human handoffs observable and resumable enough to capture motion states. The pilot `87/100` remains useful exploratory evidence, but the official controlled result is **legacy 96 PASS vs adaptive 83 FAIL**.
