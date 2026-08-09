---
name: gstack
description: >-
  Compatibility alias for the retired /gstack router. The six installed skills self-route from their own descriptions; no catalog module exists anymore.
metadata:
  internal: true
---

# Compatibility alias: /gstack

The keyword-catalog router is retired: host-native skill discovery and the dispatchers' own mode tables now do its job.

Tell the user, then act on their task directly: name the task plainly and the matching skill self-routes, or invoke a dispatcher explicitly — `$plan`, `$qa`, `$debug`, `$review`, `$ship`, or `/make-pdf`.

Do not reproduce the retired catalog here. If no gstack dispatcher is installed, tell the user to install them with `npx skills add time-attack/gstack/skills`.
