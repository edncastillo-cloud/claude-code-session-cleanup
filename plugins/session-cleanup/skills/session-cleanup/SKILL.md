---
name: session-cleanup
description: Use when the user wants to reduce Claude Code desktop memory usage, see which sessions are still open, set up automatic archiving of inactive sessions, or close orphan processes left by sessions. Diagnoses memory per session based on the last user request, archives the sessions the user picks, and closes — with confirmation — orphans left by sessions (MCP servers and tool shells). Windows only. Does NOT close development servers or processes unrelated to sessions.
---

# Session cleanup: inactive sessions and orphan processes

Answer in the user's language.

Every unarchived Claude Code desktop session can keep a `claude.exe` process alive (~220 MB) plus its MCP servers. When a session is archived, the app closes that process and its MCP servers.

**Inactivity criterion: days since the user's last request**, not since the last focus. Selecting a session in the sidebar (to archive it, or just to look at it) revives it and resets the app's auto-archive counter even if nothing is asked. That is why the app alone may never archive sessions that have gone unused for days.

An **orphan** is a process a session started (a configured MCP server or a tool shell) whose parent process no longer exists: the session died and the process kept running. A process whose parent is still alive is never an orphan, so MCP servers used by other agents or IDEs are left alone. The diagnosis lists them in `orphans`; those containing a development server are marked `protected` and are never closed.

## Steps

1. **Diagnose.** From this skill's folder run:
   `node assets/diagnose.mjs --json`
   Show a short table: session · days since last request · live MB, and the total. If `metadata` is `false`, say so and use `list_sessions` only to list sessions. Keep `sessionMemoryMb` + `orphanMb` as "before".
2. **Orphans.** If `orphans` is not empty, show them (PID · type · origin · MB · protected) and ask with `AskUserQuestion` (`multiSelect: true`, "Which ones should I close? Unmarked ones stay"). Protected ones appear only in the table, never as an option. Close the selected ones with `node assets/diagnose.mjs --close-orphans=<pid>,<pid> --json`: the script re-checks every PID before closing it and reports `closed`. If there are no orphans, say so in one line and continue.
3. **Current setting.** Read `auto_archive_inactive_days` with `get_settings` and state it in one line (0 = never).
4. **Pick the days.** Ask with `AskUserQuestion`: options 1, 3 and 7, plus the free field (1–365). For each option show candidates and MB from `thresholds`, and how many the app would archive on its own (`appWouldArchive`). For 3 days add: "covers a weekend".
5. **Show what will be archived.** Run `node assets/diagnose.mjs --days=N --json` and list the rows with `candidate: true`. Flag the ones the app would not archive on its own (`appWouldArchive: false`) because they were opened recently.
6. **Apply.** `set_setting` with `auto_archive_inactive_days = N`. Confirm the change in one line.
7. **Summary and selection.** Show the candidates in a table (session · days since last request · MB) with the estimated total. Ask for confirmation letting the user uncheck the ones to keep:
   - If `show_widget` is available: a checklist with every item checked, the MB total recalculated on each change, and an "Archive selected" button that calls `sendPrompt` with the checked `session` ids.
   - Otherwise: `AskUserQuestion` with `multiSelect: true` and "Which ones should I archive? Unmarked ones stay". One option per candidate with its days and MB, up to 4 options per question and up to 4 questions. With more than 16 candidates, show the 16 with the most MB and say so.
   What is checked is the explicit yes: archive only that.
8. **Archive.** `archive_session` for each checked session; it does not open them or reset their counter. If one fails (working, pinned or open on screen), continue with the rest and note why.
9. **Final report.** Run `node assets/diagnose.mjs --json` again and close with:

   | Archived | Orphans closed | Memory before | Memory after | Freed (real) | Estimated |
   |---|---|---|---|---|---|
   | N of M checked | N of M selected | `sessionMemoryMb` + `orphanMb` from step 1 | same, now | before − after | MB of archived sessions + MB of closed orphans |

   List below anything that failed, with its reason. If the real figure is much lower than the estimate, say so: a process may not have closed.

## Rules

- Never close processes or archive without confirmation, and never delete sessions. Orphans are closed only through `--close-orphans`: never with a manual `taskkill`, never processes outside the `orphans` list.
- Keep it short: tables + selection + final report. Do not explain the mechanism unless asked.
- Without the "before" reading from step 1 there is no reduction to report.
- Remind at the end: sessions that are working or have background tasks are never archived; an archived session can be restored from the sidebar; the setting lives in Settings → Claude Code; to archive by hand without reviving others, ask Claude instead of clicking through the sidebar.
- Not verified: how often the app checks inactivity after the setting changes, and whether archiving from the right-click menu counts as focus.
- The session metadata format is internal to the Claude desktop app and undocumented; an app update can change it. If `metadata` is `false`, report only what the script could read.
