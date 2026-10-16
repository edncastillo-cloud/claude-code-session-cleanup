// Memory diagnosis for Claude Code desktop sessions (Windows).
//
// Joins the app's session metadata (%APPDATA%\Claude\claude-code-sessions\**\local_*.json: title,
// archived flag, last request, last focus, cliSessionId) with live processes (claude.exe running
// with --output-format stream-json and --resume=<cliSessionId>, plus all their descendants).
//
// Inactivity = days since the user's last request (latestUserFrameAt; lastActivityAt if missing).
// Opening or selecting a session does not count.
//
// Output: unarchived sessions with days since last request, MB of their process tree and, with
// --days=N, whether each one is a candidate (no request for >= N days) and whether the app's own
// auto-archive would archive it (it also requires >= N days without focus). Candidates and MB per
// threshold (1, 3, 7 and N). --json prints the same content as JSON.
//
// Orphans: processes started by a session that no longer have any live claude.exe among their
// ancestors. They are recognised by command line:
//   mcp    stdio MCP servers configured in ~/.claude.json (user and per project), in each
//          project's .mcp.json, in %APPDATA%\Claude\claude_desktop_config.json and in the
//          .mcp.json files under ~/.claude/plugins.
//   shell  Claude Code tool shells (~/.claude/shell-snapshots).
// Each orphan tree is reported by its root, with the MB of the whole tree. A tree that contains a
// development server (ng serve, vite, webpack, esbuild, next dev, dotnet watch, nodemon) is marked
// protected and is never closed.
//
// Usage: node diagnose.mjs [--days=N] [--json] [--close-orphans=pid,pid]
// Without --close-orphans it only reads. With it, it closes (taskkill /T /F) only the given PIDs
// that, at that same moment, are still the root of a non-protected orphan; anything else is skipped.
// The app metadata format is internal and undocumented: if it cannot be read, `metadata` is false
// and only process memory is reported.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'win32') {
  console.error('session-cleanup only supports Windows (it reads Win32_Process and uses taskkill).');
  process.exit(1);
}

const args = process.argv.slice(2);
const days = Number((args.find((a) => a.startsWith('--days=')) || '--days=0').split('=')[1]) || null;
const asJson = args.includes('--json');
const toClose = new Set(((args.find((a) => a.startsWith('--close-orphans=')) || '=').split('=')[1])
  .split(',').map(Number).filter((n) => n > 0));
const DAY = 86400000;
const now = Date.now();

// Session metadata for the account in use, one per sessionId (the newest file wins).
function readSessions() {
  const root = join(process.env.APPDATA || '', 'Claude', 'claude-code-sessions');
  if (!existsSync(root)) return null;
  const byId = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/^local_.*\.json$/.test(e.name)) {
        try {
          const o = JSON.parse(readFileSync(path, 'utf8'));
          const mtime = statSync(path).mtimeMs;
          const prev = byId.get(o.sessionId);
          if (!prev || prev.mtime < mtime) byId.set(o.sessionId, { ...o, mtime });
        } catch { /* file being written: skipped */ }
      }
    }
  };
  // Only the account in use: the top-level folder holding the most recent file.
  let account = null;
  let newest = 0;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const before = byId.size;
    walk(join(root, e.name));
    if (byId.size === before) continue;
    const max = Math.max(...[...byId.values()].filter((s) => s.account === undefined).map((s) => s.mtime));
    for (const s of byId.values()) if (s.account === undefined) s.account = e.name;
    if (max > newest) { newest = max; account = e.name; }
  }
  return [...byId.values()].filter((s) => s.account === account);
}

// Live processes: [{pid, ppid, name, started(ms), mb, cmd}].
function readProcesses() {
  const out = execFileSync('powershell', [
    '-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,WorkingSetSize,CommandLine | ConvertTo-Json -Compress',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(out.replace(/^﻿/, '')).map((p) => ({
    pid: p.ProcessId,
    ppid: p.ParentProcessId,
    name: p.Name || '',
    started: Number(String(p.CreationDate).match(/\d+/)?.[0] ?? 0),
    mb: Math.round((p.WorkingSetSize || 0) / 1048576),
    cmd: p.CommandLine || '',
  }));
}

// MB of a process and all its descendants (ignores PIDs reused by processes older than the parent).
function treeMb(processes, root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    total += p.mb;
    for (const c of processes) if (c.ppid === p.pid && c.started >= p.started) stack.push(c);
  }
  return total;
}

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const norm = (s) => String(s).toLowerCase().replace(/\//g, '\\');
const RUNTIME = /^(node|npx|npm|python3?|py|uv|uvx|bun|bunx|deno|cmd|powershell|pwsh)(\.exe|\.cmd)?$/i;
const DEV_SERVER = /\bng serve\b|@angular[\\/]cli|\bvite\b|webpack|esbuild|next dev|dotnet watch|nodemon/i;

// Signatures of the configured stdio MCP servers: [{ server, token }]. The token is the argument
// that identifies the server (script path or package); if there is none, the command itself,
// unless it is a generic runtime such as node or python.
function mcpSignatures() {
  const sources = [];
  const claudeJson = readJson(join(homedir(), '.claude.json')) || {};
  sources.push(claudeJson.mcpServers);
  for (const [path, project] of Object.entries(claudeJson.projects || {})) {
    sources.push(project.mcpServers, readJson(join(path, '.mcp.json'))?.mcpServers);
  }
  sources.push(readJson(join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'))?.mcpServers);
  const findMcp = (dir, depth) => {
    if (depth > 6 || !existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'node_modules') findMcp(join(dir, e.name), depth + 1);
      else if (e.name === '.mcp.json') { const j = readJson(join(dir, e.name)); sources.push(j?.mcpServers || j); }
    }
  };
  findMcp(join(homedir(), '.claude', 'plugins'), 0);
  const signatures = [];
  for (const servers of sources) {
    for (const [server, def] of Object.entries(servers || {})) {
      if (!def || typeof def !== 'object' || !def.command) continue;
      const tokens = (def.args || []).filter((a) => typeof a === 'string' && !a.startsWith('-') && /[\\/@.]/.test(a) && a.length > 3);
      if (tokens.length) signatures.push({ server, token: norm(tokens[0]) });
      else if (!RUNTIME.test(String(def.command).split(/[\\/]/).pop())) signatures.push({ server, token: norm(def.command) });
    }
  }
  return signatures;
}

// Session orphans: roots of trees started by a session with no live claude.exe above them.
function findOrphans(processes) {
  const byPid = new Map(processes.map((p) => [p.pid, p]));
  const parent = (p) => { const q = byPid.get(p.ppid); return q && q.started <= p.started ? q : null; };
  const underClaude = (p) => {
    const seen = new Set();
    for (let q = parent(p); q && !seen.has(q.pid); q = parent(q)) { seen.add(q.pid); if (/^claude\.exe$/i.test(q.name)) return true; }
    return false;
  };
  const signatures = mcpSignatures();
  const kind = (p) => {
    const cmd = norm(p.cmd);
    const s = signatures.find((x) => cmd.includes(x.token));
    if (s) return { type: 'mcp', origin: s.server };
    if (/\.claude[\\/]shell-snapshots/i.test(p.cmd)) return { type: 'shell', origin: 'Claude Code tool' };
    return null;
  };
  const tree = (root) => {
    const out = [];
    const stack = [root];
    while (stack.length) { const p = stack.pop(); out.push(p); for (const c of processes) if (c.ppid === p.pid && c.started >= p.started) stack.push(c); }
    return out;
  };
  const candidates = processes.filter((p) => kind(p) && !underClaude(p));
  const candidateIds = new Set(candidates.map((p) => p.pid));
  return candidates
    .filter((p) => { for (let q = parent(p); q; q = parent(q)) if (candidateIds.has(q.pid)) return false; return true; })
    .map((p) => {
      const nodes = tree(p);
      const dev = nodes.find((n) => DEV_SERVER.test(n.cmd));
      return {
        pid: p.pid,
        name: p.name,
        ...kind(p),
        started: new Date(p.started).toISOString(),
        processes: nodes.length,
        mb: nodes.reduce((s, n) => s + n.mb, 0),
        protected: dev ? `development server: ${dev.cmd.replace(/\s+/g, ' ').slice(0, 80)}` : null,
        cmd: p.cmd.replace(/\s+/g, ' ').slice(0, 160),
      };
    });
}

const sessions = readSessions();
let processes = readProcesses();

// Close on request: only roots that, in this same reading, are still non-protected orphans.
const closed = [];
if (toClose.size) {
  const current = new Map(findOrphans(processes).map((o) => [o.pid, o]));
  for (const pid of toClose) {
    const o = current.get(pid);
    if (!o) { closed.push({ pid, ok: false, reason: 'no longer a session orphan' }); continue; }
    if (o.protected) { closed.push({ pid, ok: false, reason: `protected, ${o.protected}` }); continue; }
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 15000 });
      closed.push({ pid, ok: true, mb: o.mb, origin: o.origin });
    } catch {
      closed.push({ pid, ok: false, reason: 'taskkill failed' });
    }
  }
  processes = readProcesses();
}
const orphans = findOrphans(processes);

const clis = processes.filter((p) => /claude\.exe.*--output-format stream-json/i.test(p.cmd));
const memByCli = new Map();
for (const p of clis) {
  const id = p.cmd.match(/--resume[= ]([0-9a-f-]{36})/i)?.[1];
  memByCli.set(id || `pid:${p.pid}`, treeMb(processes, p));
}

const rows = (sessions || [])
  .filter((s) => !s.isArchived)
  .map((s) => {
    const request = s.latestUserFrameAt || s.lastActivityAt || 0;
    const focus = Math.max(request, s.lastFocusedAt || 0);
    const mb = memByCli.get(s.cliSessionId) ?? 0;
    memByCli.delete(s.cliSessionId);
    return {
      title: s.title || '(untitled)',
      session: s.sessionId,
      lastRequest: new Date(request).toISOString(),
      daysSinceRequest: Math.floor((now - request) / DAY),
      daysSinceFocus: Math.floor((now - focus) / DAY),
      processAlive: mb > 0,
      mb,
    };
  })
  .sort((a, b) => b.daysSinceRequest - a.daysSinceRequest);

// Session processes with no matching metadata (new sessions without --resume yet, or another account).
const unmappedMb = [...memByCli.values()].reduce((s, mb) => s + mb, 0);

const thresholds = [...new Set([1, 3, 7, ...(days ? [days] : [])])].sort((a, b) => a - b).map((n) => {
  const candidates = rows.filter((r) => r.daysSinceRequest >= n);
  return {
    days: n,
    candidates: candidates.length,
    freedMb: candidates.reduce((s, r) => s + r.mb, 0),
    appWouldArchive: candidates.filter((r) => r.daysSinceFocus >= n).length,
  };
});

const result = {
  metadata: sessions !== null,
  criterion: 'days since the user last sent a request',
  unarchivedSessions: rows.length,
  sessionMemoryMb: rows.reduce((s, r) => s + r.mb, 0) + unmappedMb,
  unmappedMb,
  thresholds,
  orphans,
  orphanMb: orphans.filter((o) => !o.protected).reduce((s, o) => s + o.mb, 0),
  ...(toClose.size ? { closed } : {}),
  rows: rows.map((r) => (days
    ? { ...r, candidate: r.daysSinceRequest >= days, appWouldArchive: r.daysSinceRequest >= days && r.daysSinceFocus >= days }
    : r)),
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  if (!result.metadata) console.log('App session metadata not found; only process memory is reported.\n');
  console.log(`Unarchived sessions: ${rows.length} · session process memory: ${result.sessionMemoryMb} MB` +
    (unmappedMb ? ` (${unmappedMb} MB with no matching session)` : ''));
  console.log('');
  console.log(`${'Days idle'.padStart(9)}  ${'MB'.padStart(5)}  ${days ? 'Candidate  App alone  ' : ''}Session`);
  for (const r of result.rows) {
    const mark = days ? `${(r.candidate ? 'yes' : 'no').padEnd(11)}${(r.appWouldArchive ? 'yes' : 'no').padEnd(11)}` : '';
    console.log(`${String(r.daysSinceRequest).padStart(9)}  ${String(r.mb || '-').padStart(5)}  ${mark}${r.title.slice(0, 60)}`);
  }
  console.log('\nCandidates per threshold (no request for >= N days):');
  for (const t of thresholds) console.log(`  ${String(t.days).padStart(3)} day(s): ${t.candidates} sessions, ${t.freedMb} MB · app alone would archive ${t.appWouldArchive}`);
  console.log(`\nSession orphan processes: ${orphans.length} (${result.orphanMb} MB closable)`);
  for (const o of orphans) {
    console.log(`  ${String(o.pid).padStart(6)}  ${String(o.mb).padStart(5)} MB  ${o.type.padEnd(5)}  ${o.origin}${o.protected ? `  · PROTECTED (${o.protected})` : ''}`);
  }
  for (const c of closed) console.log(`  close ${c.pid}: ${c.ok ? `closed (${c.mb} MB)` : c.reason}`);
}
