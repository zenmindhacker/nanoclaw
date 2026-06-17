import { spawn, spawnSync, type ChildProcess } from 'child_process';
import fs from 'fs';

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk';

import { registerProvider } from './provider-registry.js';
import type { AgentProvider, AgentQuery, ProviderEvent, ProviderOptions, QueryInput } from './types.js';
import { mcpServersToOpenCodeConfig } from './mcp-to-opencode.js';

function log(msg: string): void {
  console.error(`[opencode-provider] ${msg}`);
}

const SESSION_STATUS_RETRY_ERROR_AFTER = 3;

/** Stale / dead OpenCode session heuristics (complement Claude-centric host patterns). */
const STALE_SESSION_RE =
  /no conversation found|ENOENT.*\.jsonl|session.*not found|NotFoundError|connection reset|ECONNRESET|404|event timeout/i;

function killProcessTree(proc: ChildProcess): void {
  if (!proc.pid) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

function spawnOpencodeServer(config: Record<string, unknown>, timeoutMs = 10_000): Promise<{ url: string; proc: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const hostname = '127.0.0.1';
    const port = 4096;
    const proc = spawn('opencode', ['serve', `--hostname=${hostname}`, `--port=${port}`], {
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
      detached: true,
    });

    const id = setTimeout(() => {
      killProcessTree(proc);
      reject(new Error(`Timeout waiting for OpenCode server to start after ${timeoutMs}ms`));
    }, timeoutMs);

    let output = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      for (const line of output.split('\n')) {
        if (line.startsWith('opencode server listening')) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (match) {
            clearTimeout(id);
            resolve({ url: match[1], proc });
          }
        }
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.on('exit', (code) => {
      clearTimeout(id);
      let msg = `OpenCode server exited with code ${code}`;
      if (output.trim()) msg += `\nServer output: ${output}`;
      reject(new Error(msg));
    });
    proc.on('error', (err) => {
      clearTimeout(id);
      reject(err);
    });
  });
}

// Maximum bytes of mnemon recall output included in the system block.
const MNEMON_RECALL_CAP = 2048;

// Number of skills to inline at full body when scoring against the query.
const SKILLS_TOP_K = Number(process.env.SKILLS_CATALOG_TOP_K) || 3;
const COMPACT_MODE_THRESHOLD = 20;
const SKILLS_ROOT = '/workspace/agent/skills';

// Inline guide injected when MNEMON_DATA_DIR is set but guide.md hasn't been
// written yet (e.g. first container start before mnemon setup finishes).
const MNEMON_INLINE_GUIDE = `You have access to a persistent knowledge graph via the \`mnemon\` CLI tool.
- Before tasks that benefit from past context: run \`mnemon recall "<brief query>"\` to surface relevant facts.
- After any substantive decision, learned fact, or user preference: run \`mnemon remember "<compact entry>"\`.
- For relationships between entities: \`mnemon link\`.
- To inspect memory state: \`mnemon status\`.
Keep entries short and factual. Do not duplicate what is already in CLAUDE.local.md.`;

/**
 * Read mnemon context to prepend to the system block under OpenCode.
 *
 * Claude Code hooks (PreToolUse / Stop) fire mnemon automatically for the
 * claude provider. OpenCode spawns its own process and never invokes the
 * `claude` CLI, so hooks never fire. This function compensates by:
 *   1. Injecting the mnemon behavioral guide (from guide.md or inline fallback).
 *   2. Running `mnemon recall` on the incoming prompt text so relevant past
 *      facts are surfaced in the first turn (synchronous, 5s timeout, 2KB cap).
 *
 * Returns undefined when mnemon is not installed or MNEMON_DATA_DIR is unset.
 */
function readMnemonContext(promptText: string): string | undefined {
  const dataDir = process.env.MNEMON_DATA_DIR;
  if (!dataDir) return undefined;

  // Try to read the guide written by `mnemon setup --target claude-code`.
  const guidePath = `${dataDir}/prompt/guide.md`;
  let guide = '';
  try {
    guide = fs.readFileSync(guidePath, 'utf8').trim();
  } catch {
    guide = MNEMON_INLINE_GUIDE;
  }

  // Run recall synchronously — fast lookup against local SQLite graph.
  // Truncate query to 200 chars and cap output at MNEMON_RECALL_CAP bytes.
  let recallResult = '';
  try {
    const query = promptText.slice(0, 200);
    const result = spawnSync('mnemon', ['recall', query], {
      timeout: 5000,
      encoding: 'utf8',
      env: process.env,
    });
    if (result.status === 0 && result.stdout) {
      const raw = result.stdout.trim();
      if (raw && raw !== '{}' && raw !== 'null' && raw !== '[]') {
        recallResult = raw.slice(0, MNEMON_RECALL_CAP);
      }
    }
  } catch {
    /* best-effort; never block the prompt on recall failure */
  }

  const parts = [guide];
  if (recallResult) {
    parts.push(`Recalled memories:\n${recallResult}`);
  }
  return parts.join('\n\n');
}

interface SkillMeta {
  name: string;
  description: string;
  source: string;
  skillPath: string;
}

function parseFrontmatter(text: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(text);
  if (!match) return meta;
  for (const line of match[1].split('\n')) {
    const kv = /^(\w[\w_-]*):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return meta;
}

function tokenizeForCatalog(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccardSim(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}

/**
 * Read agent-created skills from /workspace/agent/skills/ and build a
 * query-aware catalog block for inclusion in the system prompt.
 * Returns empty string if no skills exist or directory is absent.
 */
function readAgentSkillsCatalog(promptText: string): string {
  if (!fs.existsSync(SKILLS_ROOT)) return '';

  const skills: SkillMeta[] = [];
  try {
    for (const entry of fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const skillMdPath = `${SKILLS_ROOT}/${entry.name}/SKILL.md`;
      if (!fs.existsSync(skillMdPath)) continue;
      const text = fs.readFileSync(skillMdPath, 'utf8');
      const meta = parseFrontmatter(text);
      skills.push({
        name: meta.name || entry.name,
        description: meta.description || '',
        source: meta.source || 'agent-created',
        skillPath: skillMdPath,
      });
    }
  } catch {
    return '';
  }

  if (skills.length === 0) return '';

  const query = promptText.slice(0, 300);
  if (query.trim().length < 5) {
    // No meaningful query — compact list only.
    const lines = skills.slice(0, COMPACT_MODE_THRESHOLD).map((s) => `- **${s.name}**: ${s.description}`);
    return `## Agent Skills\n\n${lines.join('\n')}\n`;
  }

  const queryTokens = tokenizeForCatalog(query);
  const scored = skills
    .map((s) => ({ s, score: jaccardSim(queryTokens, tokenizeForCatalog(`${s.name} ${s.description}`)) }))
    .sort((a, b) => b.score - a.score);

  const hot = scored.filter((x) => x.score > 0).slice(0, SKILLS_TOP_K);
  const cold = scored.filter((x) => !hot.includes(x)).slice(0, COMPACT_MODE_THRESHOLD);

  const parts: string[] = [];

  if (hot.length > 0) {
    parts.push('## Relevant Agent Skills (full context)\n');
    for (const { s } of hot) {
      parts.push(`### ${s.name}`);
      if (s.description) parts.push(`> ${s.description}`);
      try {
        const raw = fs.readFileSync(s.skillPath, 'utf8');
        const bodyStart = raw.indexOf('---', 3);
        const body = (bodyStart > -1 ? raw.slice(bodyStart + 3) : raw).trim().slice(0, 3000);
        if (body) parts.push('\n' + body);
      } catch {
        /* ignore */
      }
      parts.push('');
    }
  }

  if (cold.length > 0) {
    parts.push(hot.length > 0 ? '## Other Agent Skills' : '## Agent Skills');
    parts.push('');
    for (const { s } of cold) {
      parts.push(`- **${s.name}**: ${s.description}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

function wrapPromptWithContext(text: string, systemInstructions?: string): string {
  const mnemonCtx = readMnemonContext(text);
  const skillsCatalog = readAgentSkillsCatalog(text);

  const systemParts: string[] = [];
  if (systemInstructions) systemParts.push(systemInstructions);
  if (mnemonCtx) systemParts.push(mnemonCtx);
  if (skillsCatalog) systemParts.push(skillsCatalog);

  let out = text;
  if (systemParts.length > 0) {
    out = `<system>\n${systemParts.join('\n\n---\n\n')}\n</system>\n\n${out}`;
  }
  return out;
}

function buildOpenCodeConfig(options: ProviderOptions): Record<string, unknown> {
  const provider = process.env.OPENCODE_PROVIDER || 'anthropic';
  const model = process.env.OPENCODE_MODEL;
  const smallModel = process.env.OPENCODE_SMALL_MODEL;
  const proxyUrl = process.env.ANTHROPIC_BASE_URL;
  const proxyApiKey = process.env.OPENCODE_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? provider;

  const providerModelId = model ? model.replace(new RegExp(`^${provider}/`), '') : undefined;
  const providerSmallModelId = smallModel ? smallModel.replace(new RegExp(`^${provider}/`), '') : undefined;
  const modelsToRegister = [providerModelId, providerSmallModelId]
    .filter(Boolean)
    .filter((mid, i, a) => a.indexOf(mid as string) === i);

  const providerOptions: Record<string, unknown> =
    provider === 'anthropic'
      ? {}
      : {
          [provider]: {
            options: { apiKey: proxyApiKey, baseURL: proxyUrl },
            ...(modelsToRegister.length > 0
              ? {
                  models: Object.fromEntries(
                    modelsToRegister.map((mid) => [mid, { id: mid, name: mid, tool_call: true }]),
                  ),
                }
              : {}),
          },
        };

  const mcp = mcpServersToOpenCodeConfig(options.mcpServers);

  // Load shared base + optional global persona/memory + fragments + per-group
  // memory through OpenCode's native instructions pipeline. Files are read raw;
  // `@./...` includes are NOT expanded by OpenCode, so point at concrete files.
  const instructions = ['/app/CLAUDE.md'];
  if (fs.existsSync('/workspace/global/CLAUDE.md')) {
    instructions.push('/workspace/global/CLAUDE.md');
  }
  instructions.push('/workspace/agent/.claude-fragments/*.md', '/workspace/agent/CLAUDE.local.md');

  return {
    ...(model ? { model } : {}),
    ...(smallModel ? { small_model: smallModel } : {}),
    enabled_providers: [provider],
    permission: 'allow',
    autoupdate: false,
    snapshot: false,
    provider: providerOptions,
    instructions,
    mcp,
  };
}

type SharedRuntime = {
  proc: ChildProcess;
  client: OpencodeClient;
  stream: AsyncGenerator<{ type: string; properties: Record<string, unknown> }, void, void>;
  streamRelease: () => void;
};

let sharedRuntime: SharedRuntime | null = null;
let sharedConfigKey: string | null = null;
let sharedInit: Promise<SharedRuntime> | null = null;

function runtimeConfigKey(options: ProviderOptions): string {
  return JSON.stringify({
    mcp: mcpServersToOpenCodeConfig(options.mcpServers),
    model: process.env.OPENCODE_MODEL,
    small: process.env.OPENCODE_SMALL_MODEL,
    op: process.env.OPENCODE_PROVIDER,
  });
}

async function ensureSharedRuntime(options: ProviderOptions): Promise<SharedRuntime> {
  const key = runtimeConfigKey(options);
  if (sharedRuntime && sharedConfigKey === key) return sharedRuntime;

  if (sharedInit) return sharedInit;

  sharedInit = (async () => {
    if (sharedRuntime) {
      destroySharedRuntime();
    }
    const config = buildOpenCodeConfig(options);
    const { url, proc } = await spawnOpencodeServer(config);
    const client = createOpencodeClient({ baseUrl: url });
    const sub = await client.event.subscribe();
    const stream = sub.stream as AsyncGenerator<{ type: string; properties: Record<string, unknown> }, void, void>;
    sharedRuntime = {
      proc,
      client,
      stream,
      streamRelease: () => {
        void stream.return?.(undefined);
      },
    };
    sharedConfigKey = key;
    sharedInit = null;
    return sharedRuntime;
  })();

  return sharedInit;
}

export function destroySharedRuntime(): void {
  if (sharedRuntime) {
    try {
      sharedRuntime.streamRelease();
    } catch {
      /* ignore */
    }
    killProcessTree(sharedRuntime.proc);
    sharedRuntime = null;
    sharedConfigKey = null;
  }
  sharedInit = null;
}

function sessionErrorMessage(props: { error?: unknown }): string {
  const err = props.error as { data?: { message?: string } } | undefined;
  if (err && typeof err === 'object' && err.data && typeof err.data.message === 'string') {
    return err.data.message;
  }
  return JSON.stringify(props.error) || 'OpenCode session error';
}

export class OpenCodeProvider implements AgentProvider {
  readonly supportsNativeSlashCommands = false;

  private readonly options: ProviderOptions;
  private activeSessionId: string | undefined;

  constructor(options: ProviderOptions = {}) {
    this.options = options;
  }

  isSessionInvalid(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return STALE_SESSION_RE.test(msg);
  }

  query(input: QueryInput): AgentQuery {
    if (input.continuation) {
      this.activeSessionId = input.continuation;
    } else {
      this.activeSessionId = undefined;
    }

    const pending: string[] = [];
    let waiting: (() => void) | null = null;
    let ended = false;
    let aborted = false;

    const systemInstructions = input.systemContext?.instructions;
    pending.push(wrapPromptWithContext(input.prompt, systemInstructions));

    const kick = (): void => {
      waiting?.();
    };

    const self = this;
    const IDLE_TIMEOUT_MS = Number(process.env.OPENCODE_IDLE_TIMEOUT_MS) || 300_000;

    async function* gen(): AsyncGenerator<ProviderEvent> {
      let initYielded = false;
      const rt = await ensureSharedRuntime(self.options);
      const { client, stream } = rt;

      while (!aborted) {
        while (pending.length === 0 && !ended && !aborted) {
          await new Promise<void>((resolve) => {
            waiting = resolve;
          });
          waiting = null;
        }

        if (aborted) return;
        if (pending.length === 0 && ended) return;

        const text = pending.shift()!;
        let sessionId = self.activeSessionId;

        if (!sessionId) {
          const created = await client.session.create();
          if (created.error) {
            throw new Error(`OpenCode: failed to create session: ${JSON.stringify(created.error)}`);
          }
          sessionId = created.data?.id;
          if (!sessionId) throw new Error('OpenCode: failed to create session (no id)');
          self.activeSessionId = sessionId;
        }

        if (!initYielded) {
          yield { type: 'init', continuation: sessionId };
          initYielded = true;
        }

        const promptRes = await client.session.promptAsync({
          path: { id: sessionId },
          body: { parts: [{ type: 'text', text }] },
        });
        if (promptRes.error) {
          self.activeSessionId = undefined;
          throw new Error(`OpenCode promptAsync: ${JSON.stringify(promptRes.error)}`);
        }

        const partTextByMessageId = new Map<string, string>();
        const roleByMessageId = new Map<string, string>();
        let lastEventAt = Date.now();
        let eventTimedOut = false;
        const timeoutCheck = setInterval(() => {
          if (Date.now() - lastEventAt > IDLE_TIMEOUT_MS) {
            log(`OpenCode event timeout (${IDLE_TIMEOUT_MS}ms) — clearing session ${sessionId}`);
            eventTimedOut = true;
            self.activeSessionId = undefined;
            destroySharedRuntime();
            kick();
          }
        }, 5000);

        try {
          turn: while (true) {
            if (aborted) return;
            if (eventTimedOut) {
              throw new Error(`OpenCode event timeout (${IDLE_TIMEOUT_MS}ms)`);
            }

            const { value: ev, done } = await stream.next();
            if (done) {
              throw new Error('OpenCode SSE stream ended unexpectedly');
            }

            if (!ev?.type || ev.type === 'server.connected' || ev.type === 'server.heartbeat') continue;

            lastEventAt = Date.now();
            yield { type: 'activity' };

            switch (ev.type) {
              case 'message.updated': {
                const info = ev.properties.info as { id?: string; role?: string } | undefined;
                if (info?.id && info?.role) {
                  roleByMessageId.set(info.id, info.role);
                }
                break;
              }
              case 'message.part.updated': {
                const part = ev.properties.part as { type?: string; messageID?: string; text?: string } | undefined;
                if (part?.type === 'text' && part.messageID && part.text) {
                  partTextByMessageId.set(part.messageID, part.text);
                }
                break;
              }
              case 'permission.updated': {
                const perm = ev.properties as { id?: string; sessionID?: string };
                if (perm.sessionID === sessionId && perm.id) {
                  try {
                    await client.postSessionIdPermissionsPermissionId({
                      path: { id: sessionId, permissionID: perm.id },
                      body: { response: 'always' },
                    });
                  } catch (err) {
                    log(`Failed to auto-reply permission: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }
                break;
              }
              case 'session.status': {
                const props = ev.properties as {
                  sessionID?: string;
                  status?: { type?: string; attempt?: number; message?: string };
                };
                if (props.sessionID !== sessionId) break;
                const st = props.status;
                if (
                  st?.type === 'retry' &&
                  typeof st.attempt === 'number' &&
                  st.attempt >= SESSION_STATUS_RETRY_ERROR_AFTER &&
                  st.message
                ) {
                  self.activeSessionId = undefined;
                  throw new Error(`OpenCode retry limit (${st.attempt}): ${st.message}`);
                }
                break;
              }
              case 'session.error': {
                const props = ev.properties as { sessionID?: string; error?: unknown };
                if (props.sessionID === sessionId || props.sessionID === undefined) {
                  self.activeSessionId = undefined;
                  throw new Error(sessionErrorMessage(props));
                }
                break;
              }
              case 'session.idle': {
                const sid = (ev.properties as { sessionID?: string }).sessionID;
                if (sid === sessionId) {
                  break turn;
                }
                break;
              }
              default:
                break;
            }
          }
        } finally {
          clearInterval(timeoutCheck);
        }

        let resultText = '';
        for (const [msgId, role] of roleByMessageId) {
          if (role === 'assistant') {
            resultText = partTextByMessageId.get(msgId) ?? resultText;
          }
        }
        yield { type: 'result', text: resultText || null };
      }
    }

    return {
      push: (message: string) => {
        pending.push(wrapPromptWithContext(message, systemInstructions));
        kick();
      },
      end: () => {
        ended = true;
        kick();
      },
      events: gen(),
      abort: () => {
        aborted = true;
        this.activeSessionId = undefined;
        kick();
        destroySharedRuntime();
      },
    };
  }
}

registerProvider('opencode', (opts) => new OpenCodeProvider(opts));
