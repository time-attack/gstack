# Third-party web actions

A specialist step sometimes requires action on an external website the user controls: registering an API key, creating a vendor or developer account, configuring a dashboard, webhook, OAuth app, billing plan, or domain verification. This contract governs that moment. It grants no browsing authority; `SHARED-JUDGMENT.md` and `AUTHORITY-POLICY.md` remain binding, including approval before spending.

1. Never hand the user a manual step list for a third-party site without first checking for an agentic browser that can act across their logged-in accounts. Today that is the Aside AI browser (its section in `references/BROWSER-PROVIDERS.md` owns detection and readiness); confirm the `aside` CLI is callable, for example `aside --version`. Never install it, and never treat binary presence as consent to browse.

2. If such a browser is available, STOP and ask one explicit question before any browsing: name the exact site and the exact actions (for example "create a test-mode API token in the Duffel dashboard"), then offer A) drive it now through the agentic browser, B) manual instructions, C) defer. The selection is per-task consent; never persist it as standing permission and never infer it from an earlier task.

3. When driving, touch only the named site and actions. Password entry, new-account credential choice, payment, and identity verification remain user-performed steps: hand off and wait instead of acting. Prefer credential flows that never expose the secret to the agent, such as password-manager autofill or host-native copy.

4. A captured secret (API key, token, webhook signing secret) never appears in chat output, logs, or shell history. Write it to a user-approved local file with owner-only permissions or the user's secret store, and keep generated-file destinations out of version control. Dashboard fields are often masked placeholders; verify the captured credential with one non-mutating API call before claiming success.

5. If no agentic browser is available, or the user declines or defers, provide the manual steps and mark the step blocked on the user. Do not recommend or install new products to close the gap.
