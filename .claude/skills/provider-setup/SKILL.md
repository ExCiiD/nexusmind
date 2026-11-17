---
name: provider-setup
description: Checks whether the Gemini CLI is installed and authenticated on this machine before delegating to it. Use before the first delegation in a session, or when a delegation call fails and it's unclear whether the cause is the binary or the credential.
alwaysApply: false
category: delegation-infrastructure
tags:
- setup
- gemini
- authentication
dependencies:
- delegation-core
---

# Provider Setup

Upstream (`conjure`'s own `provider-setup`) ships a Python probe script
(`delegation_setup.py`) plus a cached ledger file across eight providers.
That script and its hooks were deliberately not vendored into this project
(see [[gemini-cli-delegation]] in memory) — only Gemini is actually set up
here, so this skill is trimmed to what's real on this machine.

## Checking readiness

```bash
gemini --version
```

If that fails, the CLI isn't installed — don't attempt the npm global
install yourself; ask the user to run it, same as any other action that
touches global machine state (see the Electron/Terminal-panel lesson in
project memory). Auth is never confirmed by `gemini auth status` — it exits
0 even with a broken credential. Judge auth by whether an actual `gemini -p`
call succeeds, not by that command.

## When NOT to use

- Deciding *whether* to delegate a task — that's `delegation-core`.
- Retrying a delegation that failed for content reasons (bad prompt, model
  overloaded) rather than an auth/install problem.
