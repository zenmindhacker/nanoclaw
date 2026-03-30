#!/usr/bin/env node
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

const SKILLS_ROOT = process.env.SKILLS_ROOT || '/workspace/extra/skills';
const ROUTER = join(SKILLS_ROOT, 'linear/scripts/linear-router.sh');
const OPENROUTER_KEY_PATH = process.env.OPENROUTER_KEY_PATH || '/workspace/extra/credentials/openrouter';

interface ActionItem {
  title: string;
  context: string;
  assignee: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  project: string;
}

interface MeetingMeta {
  title: string;
  date: string; // YYYY-MM-DD
  source: string;
  lineageTag: string; // "meeting:<title>|date:<YYYY-MM-DD>"
}

interface ExtractionResult {
  actions: ActionItem[];
}

interface OrgInfo {
  org: string;
  sourceRel: string;
}

const TEAM_ROSTERS: Record<string, Record<string, string>> = {
  ganttsy: {
    'cian': 'cian@ganttsy.com',
    'bart': 'bart@ganttsy.com',
    'rustam': 'rustam@ganttsy.com',
    'vergel': 'vergel@ganttsy.com',
    'aby': 'aby@ganttsy.com',
  },
  ct: {
    'cian': 'cian@copperteams.ai',
    'rustam': 'rustam@copperteams.ai',
    'greg': 'greg@copperteams.ai',
    'irica': 'irica@copperteams.ai',
    'julianna': 'julianna@copperteams.ai',
  },
  ctci: {
    'cian': 'cian@cognitivetech.net',
    'rustam': 'rustam.akimov@newvaluegroup.com',
  },
};

const PROJECT_ROUTING: Record<string, { projects: string[]; rules: string }> = {
  ganttsy: {
    projects: ['Ganttsy MVP', 'Ganttsy Admin'],
    rules: `Project routing rules:
- "Ganttsy Admin": hiring, ops, admin, HR, team socials, strategy, investor, funding, business development, OR if meeting is only between Bart and Cian
- "Ganttsy MVP": product, feature, tech, development, bugs, UI/UX, everything else`,
  },
  ct: {
    projects: ['Kora Voice Integration'],
    rules: `Project routing: Always use "Kora Voice Integration"`,
  },
  ctci: {
    projects: ['Cognitive Tech'],
    rules: `Project routing: Always use "Cognitive Tech"`,
  },
};

function log(msg: string): void {
  console.log(`[tasks-llm] ${msg}`);
}

function extractMeetingMeta(transcriptContent: string, transcriptPath: string): MeetingMeta {
  // Parse metadata from transcript header
  // Format: # Title\n- started: 2026-02-23T...\n
  const lines = transcriptContent.split('\n');
  
  let title = basename(transcriptPath).replace(/\.md$/, '');
  let date = new Date().toISOString().split('T')[0];
  let source = '';
  
  for (const line of lines.slice(0, 20)) {
    if (line.startsWith('# ')) {
      title = line.slice(2).trim();
    } else if (line.startsWith('- started:')) {
      const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) date = dateMatch[1];
    } else if (line.startsWith('- source:')) {
      source = line.split(':').slice(1).join(':').trim();
    }
  }
  
  // Create a unique lineage tag for this meeting
  const lineageTag = `meeting:${title.slice(0, 50)}|date:${date}`;
  
  return { title, date, source, lineageTag };
}

function searchExistingTickets(org: string, lineageTag: string): string[] {
  // Search Linear for tickets containing this lineage tag
  try {
    const cmd = [
      ROUTER,
      org,
      'search',
      lineageTag,
    ];
    const cmdStr = cmd.map(s => `"${s.replace(/"/g, '\\"')}"`).join(' ');
    const result = execSync(cmdStr, { encoding: 'utf-8', stdio: 'pipe', timeout: 30000 });
    
    // Parse issue IDs from result (format varies by router implementation)
    const issueIds: string[] = [];
    const idMatches = result.matchAll(/([A-Z]+-\d+)/g);
    for (const match of idMatches) {
      issueIds.push(match[1]);
    }
    return issueIds;
  } catch {
    // Search not supported or failed, continue without dedup
    return [];
  }
}

function detectOrgFromContent(transcriptPath: string): string | null {
  // When path-based detection fails, infer org from transcript title/content
  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const firstLines = content.slice(0, 2000).toLowerCase();
    // Check title and source metadata
    if (firstLines.includes('ganttsy') || firstLines.includes('source: ganttsy_workspace')) return 'ganttsy';
    if (firstLines.includes('copperteams') || firstLines.includes('copper teams') || firstLines.includes('kora')) return 'ct';
    // Check attendee emails in the file
    if (firstLines.includes('@ganttsy.com')) return 'ganttsy';
    if (firstLines.includes('@copperteams.ai')) return 'ct';
    if (firstLines.includes('@newvaluegroup.com')) return 'ctci';
  } catch { /* ignore */ }
  return null;
}

function detectOrgAndSource(transcriptPath: string): OrgInfo {
  const p = transcriptPath;

  if (p.includes('/copperteams/ct-docs/')) {
    const rel = p.split('/copperteams/ct-docs/')[1];
    return { org: 'ct', sourceRel: `ct-docs/${rel}` };
  }
  if (p.includes('/ganttsy/ganttsy-docs/')) {
    const rel = p.split('/ganttsy/ganttsy-docs/')[1];
    return { org: 'ganttsy', sourceRel: `ganttsy-docs/${rel}` };
  }
  if (p.includes('/ganttsy/ganttsy-strategy/')) {
    const rel = p.split('/ganttsy/ganttsy-strategy/')[1];
    return { org: 'ganttsy', sourceRel: `ganttsy-strategy/${rel}` };
  }
  if (p.includes('/cognitivetech/')) {
    const rel = p.split('/cognitivetech/')[1];
    return { org: 'ctci', sourceRel: rel };
  }

  // Path didn't match — try to infer org from transcript content
  const contentOrg = detectOrgFromContent(p);
  if (contentOrg) {
    return { org: contentOrg, sourceRel: basename(transcriptPath) };
  }

  return { org: 'ctci', sourceRel: basename(transcriptPath) };
}

async function extractActionsWithLLM(transcript: string, org: string): Promise<ActionItem[]> {
  const roster = TEAM_ROSTERS[org] || TEAM_ROSTERS['ctci'];
  const rosterStr = Object.entries(roster).map(([name, email]) => `- ${name}: ${email}`).join('\n');
  
  const projectConfig = PROJECT_ROUTING[org] || PROJECT_ROUTING['ctci'];
  const projectsStr = projectConfig.projects.map(p => `"${p}"`).join(', ');
  
  // minimax-m2.5 has 196k token context (~785k chars), so we can send full transcripts
  // Limit to 100k chars (~25k tokens) to leave room for prompt + response
  const sample = transcript.slice(0, 100000);
  
  const prompt = `Extract action items from this meeting transcript. Focus on commitments, tasks, and follow-ups.

## Team Roster (for assignee resolution)
${rosterStr}

## Available Projects
${projectsStr}

## ${projectConfig.rules}

## Transcript
${sample}

## Instructions
- Extract concrete action items with clear owners
- Assign to the person who committed to do it (use email from roster)
- Default assignee is cian if unclear
- Pick the correct project based on the routing rules above
- Priority: urgent (blocking/ASAP), high (this week), medium (default), low (eventually)
- Title should be concise and actionable (5-10 words)
- Context MUST include the conversation that led to the action (what problem/need was discussed) AND what success looks like. Include relevant quotes from the transcript. Aim for 3-5 sentences that give full context to someone who wasn't in the meeting.

## Output Format
Return ONLY valid JSON, no markdown:
{"actions":[{"title":"...","context":"...","assignee":"email@...","priority":"medium","project":"..."}]}

If no action items found, return: {"actions":[]}`;

  try {
    // Use OpenRouter API directly via fetch to avoid shell escaping issues
    const openrouterKey = readFileSync(OPENROUTER_KEY_PATH, 'utf-8').trim();
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openrouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'minimax/minimax-m2.5',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    
    if (!response.ok) {
      log(`OpenRouter API error: ${response.status} ${response.statusText}`);
      return [];
    }
    
    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      log('No content in OpenRouter response');
      return [];
    }
    
    // Extract JSON from LLM response
    const jsonMatch = content.match(/\{[\s\S]*"actions"[\s\S]*\}/);
    if (!jsonMatch) {
      log('No JSON found in LLM response');
      return [];
    }
    
    // Sanitize control characters inside JSON strings
    const sanitized = jsonMatch[0]
      .replace(/[\x00-\x1F\x7F]/g, (char) => {
        if (char === '\n') return '\\n';
        if (char === '\r') return '\\r';
        if (char === '\t') return '\\t';
        return '';
      });
    
    const parsed: ExtractionResult = JSON.parse(sanitized);
    return parsed.actions || [];
  } catch (error: any) {
    log(`LLM extraction failed: ${error.message}`);
    return [];
  }
}

function createIssue(
  org: string,
  title: string,
  description: string,
  sourceRel: string,
  assignee: string,
  priority: string,
  project: string,
  mode: string,
  meetingMeta: MeetingMeta
): { stdout: string; stderr: string; status: number } {
  const lineageInfo = `Based on transcript from "${meetingMeta.title}" on ${meetingMeta.date}`;
  const fullDescription = `${description}\n\n---\n${lineageInfo}\nSource: ${sourceRel}\nLineage: ${meetingMeta.lineageTag}`;
  
  const cmd = [
    ROUTER,
    org,
    'create-smart',
    title,
    fullDescription,
    '--state', 'backlog',
    '--priority', priority,
    '--project', project,
    '--labels', 'OpenClaw',
    '--assignee', assignee,
    '--no-milestone',
  ];
  
  if (mode === 'auto') {
    cmd.push('--yes');
  }
  
  const cmdStr = cmd.map(s => `"${s.replace(/"/g, '\\"')}"`).join(' ');
  
  try {
    const stdout = execSync(cmdStr, { encoding: 'utf-8', stdio: 'pipe' });
    return { stdout, stderr: '', status: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      status: error.status || 1,
    };
  }
}

interface Args {
  transcript: string;
  mode: string;
  maxItems: number;
}

function parseArgs(): Args {
  const args: Args = {
    transcript: '',
    mode: 'auto',
    maxItems: 6,
  };

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    if (arg.startsWith('-')) {
      if (arg === '--mode') {
        args.mode = process.argv[++i];
      } else if (arg === '--max-items') {
        args.maxItems = parseInt(process.argv[++i], 10);
      }
    } else if (!args.transcript) {
      args.transcript = arg;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs();

  if (!args.transcript || !existsSync(args.transcript)) {
    throw new Error(`Missing transcript: ${args.transcript}`);
  }

  const { org, sourceRel } = detectOrgAndSource(args.transcript);
  
  if (args.mode === 'off') {
    log(`off: ${args.transcript}`);
    return;
  }

  const text = readFileSync(args.transcript, 'utf-8');
  const meetingMeta = extractMeetingMeta(text, args.transcript);

  // Check for existing tickets from this meeting
  const existingTickets = searchExistingTickets(org, meetingMeta.lineageTag);
  if (existingTickets.length > 0) {
    log(`Skipping ${basename(args.transcript)} - ${existingTickets.length} ticket(s) already exist from this meeting: ${existingTickets.join(', ')}`);
    return;
  }

  log(`Extracting actions from ${basename(args.transcript)} (org=${org}, meeting=${meetingMeta.title.slice(0, 30)}...)`)
  const actions = await extractActionsWithLLM(text, org);

  if (actions.length === 0) {
    log(`No action items found in ${basename(args.transcript)}`);
    return;
  }

  log(`Found ${actions.length} action item(s)`);

  const toCreate = actions.slice(0, args.maxItems);

  // Apply hard routing rules to each action
  for (const a of toCreate) {
    if (!a.project) a.project = PROJECT_ROUTING[org]?.projects[0] || 'Cognitive Tech';
    if (sourceRel.includes('ganttsy-strategy')) a.project = 'Ganttsy Admin';
    if (a.project === 'Ganttsy Admin') a.assignee = 'cian@ganttsy.com';
  }

  // extract-only mode: output JSON for the caller (no issue creation)
  if (args.mode === 'extract-only') {
    const result = { org, sourceRel, meetingMeta, actions: toCreate };
    // Write to stdout as clean JSON (no log prefix)
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }

  for (let i = 0; i < toCreate.length; i++) {
    const a = toCreate[i];
    const desc = `${a.context}\n\nSource: ${sourceRel}`;

    const res = createIssue(org, a.title, desc, sourceRel, a.assignee, a.priority, a.project, args.mode, meetingMeta);

    log(`  ${i + 1}. ${a.title} → ${a.assignee} [${a.project}] (${a.priority})`);

    if (res.stdout.trim()) {
      const lines = res.stdout.trim().split('\n');
      for (const line of lines) {
        log(`     ${line}`);
      }
    }

    if (res.status !== 0 && res.stderr.trim()) {
      const lines = res.stderr.trim().split('\n');
      for (const line of lines) {
        log(`     ERR: ${line}`);
      }
    }
  }
}

main().catch(err => {
  console.error('[tasks-llm] Error:', err.message);
  process.exit(1);
});
