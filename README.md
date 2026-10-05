# Bridge

Desktop app for working on several projects with coding agents. Each project has
**Tasks**, **Notes** (markdown) and **Forks**: a fork is a git worktree with its own
branch where a Claude Code agent works, next to the project in `<project>_worktrees/`.

Inside a fork: chat with the agent (attach tasks and notes as context), the changes it
made, an explorer/editor, real terminals and git (commit, push, pull, history).

## Data

Everything Bridge keeps (tasks, notes, forks, chats, terminals, settings) is in one
SQLite file: `~/Library/Application Support/Bridge/bridge.db`. Projects themselves are
only touched through git worktrees.

## Accounts

Claude accounts are config folders. Bridge finds `~/.claude-<name>` folders (the usual
`CLAUDE_CONFIG_DIR` setup) and `~/.claude`. Agents run as
`claude -p … --output-format stream-json` with `CLAUDE_CONFIG_DIR` of the project's
account (or the default one). The assistant (bottom left, ⌘J) uses the same account
with `--model haiku --tools ""` and falls back to a small offline parser.

## Develop

```sh
npm install          # also rebuilds better-sqlite3 and node-pty for Electron
npm run dev          # app with hot reload
npm run typecheck
npm run test:unit    # vitest, runs under Electron's Node
npm run test:e2e     # builds, then drives the app with Playwright
npm run dist:mac     # release/Bridge-<version>-arm64.dmg (unsigned)
npm run test:packaged  # smoke test of the built .app
```

Tests never call the real Claude CLI: `tests/fixtures/fake-claude.cjs` speaks the same
flags and stream format.
