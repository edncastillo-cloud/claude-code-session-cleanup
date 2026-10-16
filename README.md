# Claude Code plugins by Edwin Castillo

Author: Edwin Castillo · [Leer en español](README.es.md)

A Claude Code plugin marketplace. Install it once and pick the plugins you want.

```
/plugin marketplace add edncastillo-cloud/claude-plugins
/plugin install session-cleanup@edwin-castillo
```

## session-cleanup

Claude Code desktop keeps a `claude.exe` process (~220 MB) plus its MCP servers alive for every session you have not archived. A dozen idle sessions can easily hold 3–4 GB. `session-cleanup` shows where that memory goes and frees it, always asking first.

**What it does**

- **Diagnoses memory per session**: days since your last request, MB of each session's process tree, and how much each auto-archive threshold would free.
- **Measures inactivity by your last request, not by focus.** Clicking a session in the sidebar revives its process and resets the app's auto-archive counter, so the built-in setting alone can keep idle sessions alive for weeks. The skill shows which ones the app would never archive on its own.
- **Archives the sessions you check** (via `archive_session`, which does not reopen them) and sets `auto_archive_inactive_days` to the number of days you choose.
- **Closes orphan processes**: MCP servers and tool shells whose session already died. It recognises them from your configured MCP servers (`~/.claude.json`, project `.mcp.json`, desktop config, plugins) and from Claude Code's shell snapshots. Anything containing a development server (`ng serve`, `vite`, `webpack`, `esbuild`, `next dev`, `dotnet watch`, `nodemon`) is protected and never closed.
- **Reports the real memory freed** against the estimate.

**Use it**: ask Claude Code something like *"free memory from my Claude sessions"*, or run `/session-cleanup:session-cleanup`.

**Requirements**: Windows, Claude Code desktop app, Node.js.

**Limits**

- It reads the desktop app's session metadata (`%APPDATA%\Claude\claude-code-sessions`), an internal, undocumented format. An app update can change it; if it can no longer be read, the skill says so and reports only process memory.
- Windows only: it uses `Win32_Process` and `taskkill`.
- Nothing is archived or closed without your confirmation, and sessions are never deleted.

## License

MIT
