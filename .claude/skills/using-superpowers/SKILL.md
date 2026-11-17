---
name: using-superpowers
description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
Check for a clearly-matching skill before acting. But in THIS project, "clearly matching" means picking the single best skill per concern, not every skill whose description brushes against the task — this repo vendors 35+ skills from a dozen different sources with real overlap between them, and invoking several for one task burns tokens for no benefit. See "Avoiding redundant invocation" below before invoking anything from the design or delegation clusters.
</EXTREMELY-IMPORTANT>

## The Rule

**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it. Don't invoke a skill reflexively for routine edits this session already knows how to do correctly (a typed i18n key, a small component tweak, a migration following this project's existing pattern) — skills earn their token cost on things genuinely likely to go wrong without them (new UI design direction, debugging a non-obvious failure, a large multi-file plan).

**Before entering plan mode:** if you haven't already brainstormed, invoke the brainstorming skill first — for anything non-trivial, not for a one-line fix.

Then announce "Using [skill] to [purpose]" and follow the skill exactly. If it has a checklist, create a todo per item.

## Skill Priority

When multiple skills apply, process skills come first — they set the approach, then implementation skills (frontend-design, etc.) carry it out. Brainstorming and systematic-debugging are Superpowers' most common process skills, but the rule holds for any of them.

- "Let's build X" → superpowers:brainstorming first, then implementation skills.
- "Fix this bug" → superpowers:systematic-debugging first, then domain skills.

## Avoiding redundant invocation (this project specifically)

Several vendored skills cover the same ground. Invoke **at most one** per
cluster, the most specific match for the actual task — never stack them:

**Design/UI cluster** (`frontend-design`, `web-design-guidelines`,
`ui-ux-pro-max`, `impeccable`, `design`, `design-system`, `ui-styling`,
`banner-design`, `brand`, `slides`):
- Aesthetic direction on new/reshaped UI ("make this not look templated") → `frontend-design`.
- Auditing existing UI code against accessibility/best-practice guidelines → `web-design-guidelines`.
- Picking a concrete style/palette/font/chart/stack-specific implementation from a large reference set → `ui-ux-pro-max`.
- An explicit `/polish`, `/critique`, `/colorize`, `/animate` command → `impeccable` (command-invoked, so it rarely collides with the others).
- A social/ad banner asset specifically → `banner-design`. A slide deck → `slides`. Brand voice/copy → `brand`. Design tokens/component specs outside ui-ux-pro-max's scope → `design-system`.
Do not run `frontend-design` + `ui-ux-pro-max` + `design` on the same request — pick one.

**Delegation cluster** (`delegation-core`, `gemini-delegation`,
`provider-setup`, `authentication-patterns`, `service-registry`,
`error-patterns`): only Gemini is wired up on this machine. Use
`delegation-core` to decide *whether* a sub-task is worth delegating,
`gemini-delegation` for the actual call, `provider-setup` only when a
delegation call fails and the cause is unclear. The other six provider
skills this framework upstream ships (qwen/minimax/glm/muse/codex/opencode)
were deliberately not vendored — don't invoke or recreate them.

## Red Flags

These thoughts mean STOP—you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |

## Platform Adaptation

If your harness appears here, read its reference file for special instructions:

- Claude Code: `references/claude-code-tools.md`
- Codex: `references/codex-tools.md`
- Pi: `references/pi-tools.md`
- Antigravity: `references/antigravity-tools.md`
- Hermes Agent: `references/hermes-tools.md`
- Muse: `references/muse-tools.md`

## User Instructions

User instructions (CLAUDE.md, AGENTS.md, GEMINI.md, etc, direct requests) take precedence over skills, which in turn override default behavior. Only skip skill workflows or instructions when your human partner has explicitly told you to.
