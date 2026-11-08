# session-hud

A Claude Code mod that adds a session HUD to the chat panel.

- **Wide window:** a sidebar with the context window bar, the current goal, a numbered todo list that checks itself off, and plan usage bars (5-hour session, weekly).
- **Narrow window:** a compact two-line block above the prompt with the goal, context and usage bars.

Claude fills the goal and todo list by calling the mod's `plan` tool. Context and usage come from the session's own usage figures.

Requires Claude Code 2.1.299 or later (VS Code extension or terminal).

## Install

In a terminal session:

```
/plugin install session-hud --marketplace Hunter-Jisha/claude-hud-mod
```

Answer `y` to add the marketplace, then pick a scope.

From the VS Code extension: type `/plugins`, open the **Marketplaces** tab, add `Hunter-Jisha/claude-hud-mod`, then install `session-hud` from the **Plugins** tab.

From a shell:

```
claude plugin marketplace add Hunter-Jisha/claude-hud-mod
claude plugin install session-hud@session-hud --scope user
```

## Commands

| Command | What it does |
| --- | --- |
| `/hud` | Opens the sidebar |
| `/hud context` | Shows or hides the context window bar |
| `/hud goal` | Shows or hides the goal |
| `/hud todo` | Shows or hides the todo list (sidebar only) |
| `/hud usage` | Shows or hides plan usage |

Choices are saved across sessions.
