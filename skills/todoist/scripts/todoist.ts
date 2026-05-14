#!/usr/bin/env node
// todoist.ts — Todoist API v1 CLI
// Usage: node --experimental-strip-types todoist.ts <command> [options]

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Credential Loading ────────────────────────────────────────────────────

function loadToken(): string {
  const locations = [
    process.env.TODOIST_API_KEY,
    tryRead('/workspace/extra/credentials/todoist'),
    tryRead(join(__dirname, '..', 'credentials')),
  ];
  const token = locations.find(Boolean);
  if (!token) {
    console.error('Error: No Todoist API token found.\nSet TODOIST_API_KEY or place token in /workspace/extra/skills/todoist/credentials');
    process.exit(1);
  }
  return token!.trim();
}

function tryRead(path: string): string | undefined {
  try { return readFileSync(path, 'utf8').trim() || undefined; }
  catch { return undefined; }
}

// ─── API Client ────────────────────────────────────────────────────────────

const BASE = 'https://api.todoist.com/api/v1';

async function api(method: string, path: string, body?: object): Promise<any> {
  const token = loadToken();
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (res.status === 204 || res.status === 200 && res.headers.get('content-length') === '0') return null;
  const text = await res.text();
  if (!res.ok) {
    console.error(`API error ${res.status}: ${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : null;
}

// Fetch all pages of a paginated endpoint
async function apiAll(path: string, pageLimit = 200): Promise<any[]> {
  const results: any[] = [];
  let cursor: string | null = null;
  const sep = path.includes('?') ? '&' : '?';
  do {
    const url = cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}&limit=${pageLimit}` : `${path}${sep}limit=${pageLimit}`;
    const data = await api('GET', url);
    results.push(...(data?.results ?? []));
    cursor = data?.next_cursor ?? null;
  } while (cursor);
  return results;
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  content: string;
  description?: string;
  project_id: string;
  section_id?: string;
  parent_id?: string;
  labels: string[];
  priority: number; // 1=normal(p4), 2=medium(p3), 3=high(p2), 4=urgent(p1)
  due?: { date: string; string: string; is_recurring: boolean };
  checked: boolean;
  added_at: string;
  note_count: number;
}

interface Project {
  id: string;
  name: string;
  color: string;
  parent_id?: string;
  is_shared: boolean;
  is_favorite: boolean;
  inbox_project?: boolean;
}

interface Section {
  id: string;
  project_id: string;
  name: string;
  section_order: number;
}

interface Comment {
  id: string;
  task_id?: string;
  project_id?: string;
  posted_at: string;
  content: string;
}

// ─── Formatting ────────────────────────────────────────────────────────────

const PRIORITY_DISPLAY: Record<number, string> = {
  4: '🔴 p1',
  3: '🟠 p2',
  2: '🟡 p3',
  1: '  p4',
};

function fmtTask(t: Task, extras?: string): string {
  const pri = PRIORITY_DISPLAY[t.priority] ?? '  --';
  const due = t.due ? ` 📅 ${t.due.string || t.due.date}` : '';
  const labels = t.labels.length ? ` [${t.labels.join(', ')}]` : '';
  const ext = extras ? ` (${extras})` : '';
  return `${pri}  ${t.content}${due}${labels}${ext}  #${t.id}`;
}

function fmtProject(p: Project): string {
  const fav = p.is_favorite ? ' ⭐' : '';
  const shared = p.is_shared ? ' 👥' : '';
  return `${p.name}${fav}${shared}  [${p.id}]`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-CA', {
    timeZone: 'America/Costa_Rica',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

// ─── Arg Parsing ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cmd: string; args: string[]; flags: Record<string, string | boolean> } {
  const [cmd, ...rest] = argv;
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < rest.length) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
        flags[key] = rest[i + 1];
        i += 2;
      } else {
        flags[key] = true;
        i++;
      }
    } else {
      args.push(rest[i]);
      i++;
    }
  }
  return { cmd: cmd || 'help', args, flags };
}

// ─── Project Cache ─────────────────────────────────────────────────────────

let _projectCache: Project[] | null = null;

async function getProjects(): Promise<Project[]> {
  if (!_projectCache) _projectCache = await apiAll('/projects');
  return _projectCache!;
}

async function findProject(name: string): Promise<Project | undefined> {
  const projects = await getProjects();
  const lower = name.toLowerCase();
  return projects.find(p => p.name.toLowerCase().includes(lower));
}

async function getProjectName(id: string): Promise<string> {
  const projects = await getProjects();
  return projects.find(p => p.id === id)?.name ?? id;
}

// ─── Commands ──────────────────────────────────────────────────────────────

async function cmdList(args: string[], flags: Record<string, string | boolean>) {
  const params = new URLSearchParams();

  if (flags.project) {
    const proj = await findProject(flags.project as string);
    if (!proj) { console.error(`Project not found: ${flags.project}`); process.exit(1); }
    params.set('project_id', proj.id);
  }
  if (flags.label) params.set('label', flags.label as string);
  if (flags.filter) params.set('filter', flags.filter as string);
  if (flags.section) params.set('section_id', flags.section as string);
  if (flags.today) params.set('filter', 'today | overdue');
  if (flags.overdue) params.set('filter', 'overdue');
  if (flags.inbox) {
    const projects = await getProjects();
    const inbox = projects.find(p => p.inbox_project);
    if (inbox) params.set('project_id', inbox.id);
  }

  const query = params.toString();
  const tasks: Task[] = await apiAll(`/tasks${query ? '?' + query : ''}`);

  if (!tasks.length) {
    console.log('No tasks found.');
    return;
  }

  if (flags.json) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  // Sort by priority desc, then due date
  const sorted = [...tasks].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if (a.due && b.due) return a.due.date.localeCompare(b.due.date);
    if (a.due) return -1;
    if (b.due) return 1;
    return 0;
  });

  const projects = await getProjects();
  const projMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  const showProject = !flags.project;
  if (showProject) {
    const byProject: Record<string, Task[]> = {};
    for (const t of sorted) (byProject[t.project_id] ??= []).push(t);
    for (const [projId, ptasks] of Object.entries(byProject)) {
      console.log(`\n📁 ${projMap[projId] ?? projId}`);
      for (const t of ptasks) console.log('  ' + fmtTask(t));
    }
  } else {
    for (const t of sorted) console.log(fmtTask(t));
  }

  console.log(`\n${tasks.length} task${tasks.length !== 1 ? 's' : ''}`);
}

async function cmdGet(args: string[], flags: Record<string, string | boolean>) {
  const id = args[0];
  if (!id) { console.error('Usage: get <task-id>'); process.exit(1); }

  const task: Task = await api('GET', `/tasks/${id}`);
  if (flags.json) { console.log(JSON.stringify(task, null, 2)); return; }

  const projName = await getProjectName(task.project_id);
  console.log(`\n📋 ${task.content}`);
  if (task.description) console.log(`\n   ${task.description}\n`);
  console.log(`   Priority: ${PRIORITY_DISPLAY[task.priority] ?? 'none'}`);
  console.log(`   Project:  ${projName}`);
  if (task.due) console.log(`   Due:      ${task.due.string || task.due.date}${task.due.is_recurring ? ' (recurring)' : ''}`);
  if (task.labels.length) console.log(`   Labels:   ${task.labels.join(', ')}`);
  console.log(`   ID:       ${task.id}`);
  console.log(`   Added:    ${fmtDate(task.added_at)}`);
  if (task.note_count) console.log(`   Comments: ${task.note_count}`);
}

async function cmdCreate(args: string[], flags: Record<string, string | boolean>) {
  const content = args.join(' ') || flags.title as string;
  if (!content) {
    console.error('Usage: create <task title> [--project X] [--due "tomorrow"] [--priority p1] [--label X] [--desc X]');
    process.exit(1);
  }

  const body: Record<string, any> = { content };

  if (flags.project) {
    const proj = await findProject(flags.project as string);
    body.project_id = proj?.id ?? flags.project;
  }
  if (flags.due) body.due_string = flags.due;
  if (flags.desc || flags.description) body.description = (flags.desc || flags.description) as string;
  if (flags.label) body.labels = (flags.label as string).split(',').map((s: string) => s.trim());
  if (flags.priority) {
    const priMap: Record<string, number> = { p1: 4, p2: 3, p3: 2, p4: 1, urgent: 4, high: 3, medium: 2, low: 1 };
    body.priority = priMap[flags.priority as string] ?? parseInt(flags.priority as string, 10);
  }
  if (flags.parent) body.parent_id = flags.parent;
  if (flags.section) body.section_id = flags.section;

  const task: Task = await api('POST', '/tasks', body);

  if (flags.json) { console.log(JSON.stringify(task, null, 2)); return; }
  console.log(`✅ Created: ${task.content}  #${task.id}`);
  if (task.due) console.log(`   Due: ${task.due.string || task.due.date}`);
}

async function cmdUpdate(args: string[], flags: Record<string, string | boolean>) {
  const id = args[0];
  if (!id) { console.error('Usage: update <task-id> [--title X] [--due X] [--priority p1] [--label X] [--desc X]'); process.exit(1); }

  const body: Record<string, any> = {};
  if (flags.title || flags.content) body.content = (flags.title || flags.content) as string;
  if (flags.due) body.due_string = flags.due;
  if (flags.desc || flags.description) body.description = (flags.desc || flags.description) as string;
  if (flags.label) body.labels = (flags.label as string).split(',').map((s: string) => s.trim());
  if (flags.priority) {
    const priMap: Record<string, number> = { p1: 4, p2: 3, p3: 2, p4: 1, urgent: 4, high: 3, medium: 2, low: 1 };
    body.priority = priMap[flags.priority as string] ?? parseInt(flags.priority as string, 10);
  }

  if (!Object.keys(body).length) { console.error('No fields to update.'); process.exit(1); }

  const task: Task = await api('POST', `/tasks/${id}`, body);
  if (flags.json) { console.log(JSON.stringify(task, null, 2)); return; }
  console.log(`✅ Updated: ${task.content}  #${task.id}`);
}

async function cmdComplete(args: string[], flags: Record<string, string | boolean>) {
  const ids = args.length ? args : (flags.id as string)?.split(',') ?? [];
  if (!ids.length) { console.error('Usage: complete <task-id> [<task-id> ...]'); process.exit(1); }
  for (const id of ids) {
    await api('POST', `/tasks/${id}/close`);
    console.log(`✅ Completed #${id}`);
  }
}

async function cmdDelete(args: string[], flags: Record<string, string | boolean>) {
  const id = args[0];
  if (!id) { console.error('Usage: delete <task-id>'); process.exit(1); }
  await api('DELETE', `/tasks/${id}`);
  console.log(`🗑️  Deleted #${id}`);
}

async function cmdProjects(args: string[], flags: Record<string, string | boolean>) {
  const projects: Project[] = await getProjects();
  if (flags.json) { console.log(JSON.stringify(projects, null, 2)); return; }

  const roots = projects.filter(p => !p.parent_id);
  const children = projects.filter(p => p.parent_id);

  for (const p of roots) {
    console.log(fmtProject(p));
    for (const s of children.filter(c => c.parent_id === p.id)) {
      console.log('  └─ ' + fmtProject(s));
    }
  }
  console.log(`\n${projects.length} projects`);
}

async function cmdAddProject(args: string[], flags: Record<string, string | boolean>) {
  const name = args.join(' ') || flags.name as string;
  if (!name) { console.error('Usage: add-project <name> [--color X] [--parent X]'); process.exit(1); }

  const body: Record<string, any> = { name };
  if (flags.color) body.color = flags.color;
  if (flags.parent) {
    const p = await findProject(flags.parent as string);
    body.parent_id = p?.id ?? flags.parent;
  }

  const project: Project = await api('POST', '/projects', body);
  if (flags.json) { console.log(JSON.stringify(project, null, 2)); return; }
  console.log(`✅ Created project: ${project.name}  [${project.id}]`);
}

async function cmdSections(args: string[], flags: Record<string, string | boolean>) {
  const projectArg = args[0] || flags.project as string;
  let path = '/sections';
  if (projectArg) {
    const proj = await findProject(projectArg);
    const projId = proj?.id ?? projectArg;
    path += `?project_id=${projId}`;
  }
  const sections: Section[] = await apiAll(path);
  if (flags.json) { console.log(JSON.stringify(sections, null, 2)); return; }
  if (!sections.length) { console.log('No sections found.'); return; }
  for (const s of sections.sort((a, b) => a.section_order - b.section_order)) {
    console.log(`${s.name}  [${s.id}]`);
  }
}

async function cmdComments(args: string[], flags: Record<string, string | boolean>) {
  const taskId = args[0] || flags.task as string;
  if (!taskId) { console.error('Usage: comments <task-id>'); process.exit(1); }
  const comments: Comment[] = await apiAll(`/comments?task_id=${taskId}`);
  if (flags.json) { console.log(JSON.stringify(comments, null, 2)); return; }
  if (!comments.length) { console.log('No comments.'); return; }
  for (const c of comments) {
    console.log(`[${fmtDate(c.posted_at)}] ${c.content}`);
  }
}

async function cmdAddComment(args: string[], flags: Record<string, string | boolean>) {
  const taskId = args[0];
  const content = args.slice(1).join(' ') || flags.content as string;
  if (!taskId || !content) { console.error('Usage: add-comment <task-id> <content>'); process.exit(1); }
  const comment: Comment = await api('POST', '/comments', { task_id: taskId, content });
  if (flags.json) { console.log(JSON.stringify(comment, null, 2)); return; }
  console.log(`💬 Added comment to #${taskId}`);
}

async function cmdToday(args: string[], flags: Record<string, string | boolean>) {
  return cmdList(args, { ...flags, filter: 'today | overdue' });
}

function cmdHelp() {
  console.log(`
Todoist CLI — API v1

Commands:
  list        List active tasks (grouped by project by default)
              --project <name>    Filter by project (partial match)
              --label <name>      Filter by label
              --filter <str>      Todoist filter string
              --today             Today + overdue
              --overdue           Overdue only
              --inbox             Inbox only

  today       Alias: list --today

  get <id>         Get full task detail
  create <title>   Create a task
    --project <name>   Project (partial name match)
    --due <str>        Due date string (e.g. "tomorrow", "next Friday")
    --priority <p1-p4> p1=urgent, p2=high, p3=medium, p4=low
    --label <x,y>      Comma-separated labels
    --desc <text>      Description

  update <id>      Update a task (same flags as create)
  complete <id> [<id>...]   Mark done
  delete <id>               Delete

  projects              List all projects
  add-project <name>    Create project (--parent <name>)
  sections [project]    List sections
  comments <task-id>    List comments
  add-comment <id> <text>

Global:
  --json    Raw JSON output
`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h') {
    cmdHelp();
    return;
  }

  const { cmd, args, flags } = parseArgs(argv);

  const commands: Record<string, (a: string[], f: Record<string, string | boolean>) => Promise<void>> = {
    list: cmdList, ls: cmdList,
    today: cmdToday,
    get: cmdGet,
    create: cmdCreate, add: cmdCreate,
    update: cmdUpdate, edit: cmdUpdate,
    complete: cmdComplete, close: cmdComplete, done: cmdComplete,
    delete: cmdDelete, remove: cmdDelete,
    projects: cmdProjects,
    'add-project': cmdAddProject,
    sections: cmdSections,
    comments: cmdComments,
    'add-comment': cmdAddComment, comment: cmdAddComment,
    help: async () => cmdHelp(),
  };

  const handler = commands[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}\nRun with --help for usage.`);
    process.exit(1);
  }

  await handler(args, flags);
}

main().catch(err => {
  console.error(err.message ?? err);
  process.exit(1);
});
