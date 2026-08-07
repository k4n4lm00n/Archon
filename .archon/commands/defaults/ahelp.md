---
rewrite: /help
description: Alias for /help (short) — shows the Archon help message
---

# /ahelp

Alias for `/help`. Some chat clients (e.g. Zulip's web client) intercept `/help`
before it reaches Archon, so `/ahelp` provides an unswallowed name for the same
built-in help. All arguments are forwarded verbatim to `/help`.
