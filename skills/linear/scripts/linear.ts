#!/usr/bin/env node
/**
 * Linear CLI - Multi-org Edition
 *
 * Comprehensive Linear management tool with full GraphQL type safety.
 * Designed for both human and AI-driven workflows.
 *
 * Usage: linear.ts --org <org> <command> [options]
 * Orgs: cog (CognitiveTech), ct (CopperTeams), gan (Ganttsy)
 *       Add new orgs to ORG_CONFIGS below.
 */
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { Command } from 'commander';
import { homedir } from 'os';

// ── Org configuration ────────────────────────────────────────────────────────
const ORG_CONFIGS: Record<string, { apiKeyEnv: string; teamKey: string; defaultProject: string }> = {
  cog: { apiKeyEnv: 'LINEAR_API_KEY_COGNITIVE', teamKey: 'COG', defaultProject: 'OpenClaw' },
  ct:  { apiKeyEnv: 'LINEAR_API_KEY_CT',        teamKey: 'KOR', defaultProject: 'Kora Voice Integration' },
  gan: { apiKeyEnv: 'LINEAR_API_KEY_GANTTSY',   teamKey: 'GAN', defaultProject: 'Ganttsy MVP' },
};

const ORG_ALIASES: Record<string, string> = {
  cognitive: 'cog', cognitivetech: 'cog', 'cognitive-tech': 'cog',
  copperteams: 'ct', copper: 'ct',
  ganttsy: 'gan',
};

// Linear API keys are injected via NC container environment

// Pre-parse --org before Commander takes over
function preParseOrg(): string {
  const idx = process.argv.indexOf('--org');
  const raw = idx !== -1 ? process.argv[idx + 1] : (process.env.LINEAR_ORG || '');
  if (!raw) {
    console.error(`\nError: --org <org> is required. Available: ${Object.keys(ORG_CONFIGS).join(', ')}\n`);
    process.exit(1);
  }
  const key = ORG_ALIASES[raw.toLowerCase()] || raw.toLowerCase();
  if (!ORG_CONFIGS[key]) {
    console.error(`\nUnknown org: ${raw}. Available: ${Object.keys(ORG_CONFIGS).join(', ')}\n`);
    process.exit(1);
  }
  return key;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CURRENT_ORG = preParseOrg();
const orgConfig = ORG_CONFIGS[CURRENT_ORG];

const LINEAR_API_KEY = process.env[orgConfig.apiKeyEnv]!;
if (!LINEAR_API_KEY) {
  console.error(`\nMissing env var: ${orgConfig.apiKeyEnv}\n`);
  process.exit(1);
}

const CACHE_DIR = join(process.env.SKILLS_ROOT || '/workspace/extra/skills', 'linear/.cache');
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
const CACHE_FILE = join(CACHE_DIR, `${CURRENT_ORG}.json`);

// Cache structure
interface LinearCache {
  _comment: string;
  lastUpdated: string | null;
  workspace: { id: string | null; name: string | null };
  team: { id: string | null; name: string | null; key: string | null };
  project: { id: string | null; name: string | null };
  currentMilestone: { id: string; name: string; targetDate: string | null } | null;
  users: Array<{ id: string; name: string; email: string }>;
  workflowStates: Array<{ id: string; name: string; type: string }>;
  labels: Array<{ id: string; name: string }>;
}

let cache: LinearCache | null = null;

function loadCache(): LinearCache | null {
  if (cache) return cache;
  
  if (!existsSync(CACHE_FILE)) {
    return null;
  }

  try {
    const data = readFileSync(CACHE_FILE, 'utf-8');
    cache = JSON.parse(data);
    return cache;
  } catch (error) {
    console.error('Failed to load cache:', error);
    return null;
  }
}

function saveCache(data: LinearCache): void {
  cache = data;
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to save cache:', error);
  }
}

function ensureCache(): LinearCache {
  const cached = loadCache();
  if (!cached || !cached.team.id || !cached.project.id) {
    console.error('\n❌ Cache not initialized or incomplete.');
    console.error(`Run: node linear.ts --org ${CURRENT_ORG} init\n`);
    process.exit(1);
  }
  return cached;
}

// ============================================================================
// TypeScript Interfaces for Linear GraphQL API
// ============================================================================

function parsePriority(val: string): number {
  const n = parseInt(val);
  if (!isNaN(n)) return n;
  const map: Record<string, number> = { urgent: 1, high: 2, medium: 3, low: 4, none: 0 };
  return map[val.toLowerCase()] ?? 0;
}

interface LinearResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: any }>;
}

interface Issue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: { name: string; type: string };
  dueDate?: string;
  estimate?: number;
  priority?: number;
  assignee?: { id: string; name: string; email: string };
  labels?: { nodes: Array<{ id: string; name: string }> };
  projectMilestone?: { id: string; name: string };
  parent?: { id: string; identifier: string };
  children?: { nodes: Array<Issue> };
  createdAt?: string;
  url?: string;
}

interface Milestone {
  id: string;
  name: string;
  description?: string;
  targetDate?: string;
  sortOrder?: number;
}

interface Label {
  id: string;
  name: string;
}

interface WorkflowState {
  id: string;
  name: string;
  type: string;
}

interface User {
  id: string;
  name: string;
  email: string;
}

// ============================================================================
// Linear GraphQL Client
// ============================================================================

class LinearClient {
  private cache: LinearCache | null = null;

  constructor(requireCache: boolean = true) {
    if (requireCache) {
      this.cache = ensureCache();
    }
  }

  private get teamId(): string {
    return this.cache?.team.id || process.env.LINEAR_TEAM_ID!;
  }

  private get projectId(): string {
    return this.cache?.project.id || process.env.LINEAR_PROJECT_ID!;
  }

  private get projectName(): string {
    return this.cache?.project.name || process.env.LINEAR_PROJECT_NAME || orgConfig.defaultProject;
  }
  private async query<T>(query: string, variables?: Record<string, any>): Promise<T | null> {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Authorization': LINEAR_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const result: LinearResponse<T> = await response.json() as LinearResponse<T>;

    if (result.errors) {
      console.error('GraphQL errors:', JSON.stringify(result.errors, null, 2));
      return null;
    }

    return result.data || null;
  }

  // ------------------------------------------------------------------------
  // Issue Operations
  // ------------------------------------------------------------------------

  async listIssues(options: {
    status?: string;
    includeBacklog?: boolean;
    limit?: number;
  } = {}): Promise<Issue[]> {
    const { status, includeBacklog = true, limit = 100 } = options;
    
    const filters: string[] = [`project: { id: { eq: "${this.projectId}" } }`];
    
    if (status) {
      filters.push(`state: { name: { eq: "${status}" } }`);
    }
    
    if (!includeBacklog) {
      filters.push(`state: { name: { neq: "Backlog" } }`);
    }

    const query = `
      query ListIssues {
        issues(
          filter: { ${filters.join(', ')} }
          first: ${limit}
          orderBy: createdAt
        ) {
          nodes {
            id
            identifier
            title
            description
            state { name type }
            dueDate
            estimate
            priority
            assignee { id name email }
            labels { nodes { id name } }
            projectMilestone { id name }
            createdAt
            url
          }
        }
      }
    `;

    const data = await this.query<{ issues: { nodes: Issue[] } }>(query);
    return data?.issues.nodes || [];
  }

  async getIssue(identifier: string): Promise<Issue | null> {
    const query = `
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          state { name type }
          dueDate
          estimate
          priority
          assignee { id name email }
          labels { nodes { id name } }
          projectMilestone { id name }
          parent { id identifier }
          children {
            nodes {
              id
              identifier
              title
              state { name }
              estimate
            }
          }
          createdAt
          url
        }
      }
    `;

    const data = await this.query<{ issue: Issue }>(query, { id: identifier });
    return data?.issue || null;
  }

  async createIssue(input: {
    title: string;
    description?: string;
    status?: string;
    dueDate?: string;
    estimate?: number;
    priority?: number;
    labels?: string[];
    milestone?: string | null;
    parent?: string;
    assignee?: string;
    project?: string;
  }): Promise<Issue | null> {
    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
          }
        }
      }
    `;

    // Resolve project name to ID if provided, otherwise use default
    let resolvedProjectId = this.projectId;
    if (input.project) {
      const proj = await this.getProjectByName(input.project);
      if (proj) {
        resolvedProjectId = proj.id;
      } else {
        console.error(`Warning: Project "${input.project}" not found, using default`);
      }
    }

    const issueInput: any = {
      teamId: this.teamId,
      projectId: resolvedProjectId,
      title: input.title,
      priority: input.priority ?? 0,
    };

    if (input.description) issueInput.description = input.description;
    if (input.dueDate) issueInput.dueDate = input.dueDate;
    if (input.estimate) issueInput.estimate = Math.floor(input.estimate);

    // Resolve status to stateId
    if (input.status) {
      issueInput.stateId = await this.getStateId(input.status);
    }

    // Resolve milestone name to ID — default to currentMilestone from cache
    if (input.milestone !== null) {
      const milestoneName = input.milestone || this.cache?.currentMilestone?.name;
      if (milestoneName) {
        const milestone = input.milestone
          ? await this.getMilestoneByName(input.milestone)
          : this.cache?.currentMilestone || null;
        if (milestone) issueInput.projectMilestoneId = milestone.id;
      }
    }

    // Resolve parent identifier to ID
    if (input.parent) {
      const parent = await this.getIssue(input.parent);
      if (parent) issueInput.parentId = parent.id;
    }

    // Resolve assignee email/name to ID
    if (input.assignee) {
      const user = await this.getUserByEmailOrName(input.assignee);
      if (user) issueInput.assigneeId = user.id;
    }

    // Resolve label names to IDs
    if (input.labels && input.labels.length > 0) {
      const labelIds = await this.getOrCreateLabels(input.labels);
      if (labelIds.length > 0) issueInput.labelIds = labelIds;
    }

    const data = await this.query<{ issueCreate: { success: boolean; issue: Issue } }>(
      mutation,
      { input: issueInput }
    );

    return data?.issueCreate.issue || null;
  }

  async updateIssue(identifier: string, updates: {
    title?: string;
    description?: string;
    status?: string;
    dueDate?: string;
    estimate?: number;
    priority?: number;
    labels?: string[];
    milestone?: string;
    parent?: string;
    assignee?: string;
  }): Promise<Issue | null> {
    const issue = await this.getIssue(identifier);
    if (!issue) {
      console.error(`Issue ${identifier} not found`);
      return null;
    }

    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            id
            identifier
            title
            url
          }
        }
      }
    `;

    const issueInput: any = {};

    if (updates.title) issueInput.title = updates.title;
    if (updates.description) issueInput.description = updates.description;
    if (updates.dueDate) issueInput.dueDate = updates.dueDate;
    if (updates.estimate !== undefined) issueInput.estimate = Math.floor(updates.estimate);
    if (updates.priority !== undefined) issueInput.priority = updates.priority;

    if (updates.status) {
      issueInput.stateId = await this.getStateId(updates.status);
    }

    if (updates.milestone) {
      const milestone = await this.getMilestoneByName(updates.milestone);
      if (milestone) issueInput.projectMilestoneId = milestone.id;
    }

    if (updates.parent) {
      const parent = await this.getIssue(updates.parent);
      if (parent) issueInput.parentId = parent.id;
    }

    if (updates.assignee) {
      const user = await this.getUserByEmailOrName(updates.assignee);
      if (user) issueInput.assigneeId = user.id;
    }

    if (updates.labels) {
      const labelIds = await this.getOrCreateLabels(updates.labels);
      if (labelIds.length > 0) issueInput.labelIds = labelIds;
    }

    const data = await this.query<{ issueUpdate: { success: boolean; issue: Issue } }>(
      mutation,
      { id: issue.id, input: issueInput }
    );

    return data?.issueUpdate.issue || null;
  }

  async commentOnIssue(identifier: string, body: string): Promise<boolean> {
    const issue = await this.getIssue(identifier);
    if (!issue) {
      console.error(`Issue ${identifier} not found`);
      return false;
    }

    const mutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }
    `;

    const data = await this.query<{ commentCreate: { success: boolean } }>(
      mutation,
      { input: { issueId: issue.id, body } }
    );

    return data?.commentCreate.success || false;
  }

  async findIssues(searchTerm: string, options: {
    searchIn?: 'title' | 'description' | 'all';
    status?: string;
  } = {}): Promise<Issue[]> {
    const { searchIn = 'all', status } = options;
    const allIssues = await this.listIssues({ limit: 200 });
    const searchLower = searchTerm.toLowerCase();

    return allIssues.filter(issue => {
      // Apply status filter
      if (status && issue.state.name.toLowerCase() !== status.toLowerCase()) {
        return false;
      }

      // Apply search filter
      if (searchIn === 'title') {
        return issue.title.toLowerCase().includes(searchLower);
      } else if (searchIn === 'description') {
        return (issue.description || '').toLowerCase().includes(searchLower);
      } else {
        return issue.title.toLowerCase().includes(searchLower) ||
               (issue.description || '').toLowerCase().includes(searchLower);
      }
    });
  }

  // ------------------------------------------------------------------------
  // Project Operations
  // ------------------------------------------------------------------------

  async getProjectByName(name: string): Promise<{ id: string; name: string } | null> {
    const query = `
      query GetProjects {
        projects {
          nodes {
            id
            name
          }
        }
      }
    `;
    const result = await this.query<{ projects: { nodes: Array<{ id: string; name: string }> } }>(query, {});
    const projects = result?.projects.nodes || [];
    const nameLower = name.toLowerCase();
    return projects.find(p => p.name.toLowerCase() === nameLower) || null;
  }

  // ------------------------------------------------------------------------
  // Milestone Operations
  // ------------------------------------------------------------------------

  async listMilestones(): Promise<Milestone[]> {
    const query = `
      query ListMilestones {
        project(id: "${this.projectId}") {
          projectMilestones {
            nodes {
              id
              name
              description
              targetDate
              sortOrder
            }
          }
        }
      }
    `;

    const data = await this.query<{ project: { projectMilestones: { nodes: Milestone[] } } }>(query);
    return data?.project.projectMilestones.nodes || [];
  }

  async getMilestoneByName(name: string): Promise<Milestone | null> {
    const milestones = await this.listMilestones();
    const nameLower = name.toLowerCase();

    // Exact match first
    const exact = milestones.find(m => m.name.toLowerCase() === nameLower);
    if (exact) return exact;

    // Partial match
    return milestones.find(m => m.name.toLowerCase().includes(nameLower)) || null;
  }

  async createMilestone(input: {
    name: string;
    description?: string;
    targetDate: string;
  }): Promise<Milestone | null> {
    const mutation = `
      mutation CreateMilestone($input: ProjectMilestoneCreateInput!) {
        projectMilestoneCreate(input: $input) {
          success
          projectMilestone {
            id
            name
            targetDate
          }
        }
      }
    `;

    const data = await this.query<{ projectMilestoneCreate: { success: boolean; projectMilestone: Milestone } }>(
      mutation,
      {
        input: {
          name: input.name,
          description: input.description || '',
          targetDate: input.targetDate,
          projectId: this.projectId,
        },
      }
    );

    return data?.projectMilestoneCreate.projectMilestone || null;
  }

  async updateMilestone(milestoneId: string, updates: {
    name?: string;
    description?: string;
    targetDate?: string;
  }): Promise<Milestone | null> {
    const mutation = `
      mutation UpdateMilestone($id: String!, $input: ProjectMilestoneUpdateInput!) {
        projectMilestoneUpdate(id: $id, input: $input) {
          success
          projectMilestone {
            id
            name
            targetDate
          }
        }
      }
    `;

    const input: any = {};
    if (updates.name) input.name = updates.name;
    if (updates.description) input.description = updates.description;
    if (updates.targetDate) input.targetDate = updates.targetDate;

    const data = await this.query<{ projectMilestoneUpdate: { success: boolean; projectMilestone: Milestone } }>(
      mutation,
      { id: milestoneId, input }
    );

    return data?.projectMilestoneUpdate.projectMilestone || null;
  }

  // ------------------------------------------------------------------------
  // Batch Operations
  // ------------------------------------------------------------------------

  async bulkUpdateStatus(options: {
    status: string;
    filterStatus?: string;
    filterTitle?: string;
    filterLabels?: string[];
    dryRun?: boolean;
  }): Promise<{ updated: number; failed: number; issues: string[] }> {
    const { status, filterStatus, filterTitle, filterLabels, dryRun = false } = options;
    
    const allIssues = await this.listIssues({ limit: 200 });
    const toUpdate: Issue[] = [];

    for (const issue of allIssues) {
      // Skip if already in target status
      if (issue.state.name.toLowerCase() === status.toLowerCase()) {
        continue;
      }

      // Apply filters
      if (filterStatus && issue.state.name.toLowerCase() !== filterStatus.toLowerCase()) {
        continue;
      }

      if (filterTitle && !issue.title.toLowerCase().includes(filterTitle.toLowerCase())) {
        continue;
      }

      if (filterLabels && filterLabels.length > 0) {
        const issueLabels = issue.labels?.nodes.map(l => l.name.toLowerCase()) || [];
        const hasAllLabels = filterLabels.every(label => 
          issueLabels.includes(label.toLowerCase())
        );
        if (!hasAllLabels) continue;
      }

      toUpdate.push(issue);
    }

    if (dryRun) {
      return {
        updated: 0,
        failed: 0,
        issues: toUpdate.map(i => i.identifier),
      };
    }

    let updated = 0;
    let failed = 0;

    for (const issue of toUpdate) {
      const result = await this.updateIssue(issue.identifier, { status });
      if (result) {
        updated++;
      } else {
        failed++;
      }
    }

    return {
      updated,
      failed,
      issues: toUpdate.map(i => i.identifier),
    };
  }

  async bulkAddLabels(issueIdentifiers: string[], labels: string[]): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;

    const labelIds = await this.getOrCreateLabels(labels);

    for (const identifier of issueIdentifiers) {
      const issue = await this.getIssue(identifier);
      if (!issue) {
        failed++;
        continue;
      }

      const existingLabelIds = issue.labels?.nodes.map(l => l.id) || [];
      const allLabelIds = [...new Set([...existingLabelIds, ...labelIds])];

      const mutation = `
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
          }
        }
      `;

      const data = await this.query<{ issueUpdate: { success: boolean } }>(
        mutation,
        { id: issue.id, input: { labelIds: allLabelIds } }
      );

      if (data?.issueUpdate.success) {
        updated++;
      } else {
        failed++;
      }
    }

    return { updated, failed };
  }

  async bulkAssign(issueIdentifiers: string[], assignee: string): Promise<{ updated: number; failed: number }> {
    let updated = 0;
    let failed = 0;

    const user = await this.getUserByEmailOrName(assignee);
    if (!user) {
      console.error(`User ${assignee} not found`);
      return { updated: 0, failed: issueIdentifiers.length };
    }

    for (const identifier of issueIdentifiers) {
      const result = await this.updateIssue(identifier, { assignee: user.email });
      if (result) {
        updated++;
      } else {
        failed++;
      }
    }

    return { updated, failed };
  }

  // ------------------------------------------------------------------------
  // Helper Methods
  // ------------------------------------------------------------------------

  private async getStateId(stateName: string): Promise<string> {
    const aliases: Record<string, string[]> = {
      'in progress': ['progress', 'inprogress', 'started', 'wip'],
      'in review': ['review', 'inreview'],
      'todo': ['to do'],
      'done': ['complete', 'completed', 'finished'],
      'canceled': ['cancelled'],
    };
    const normalize = (name: string) => {
      const lower = name.toLowerCase().trim();
      for (const [canonical, alts] of Object.entries(aliases)) {
        if (lower === canonical || alts.includes(lower)) return canonical;
      }
      return lower;
    };
    const target = normalize(stateName);
    const cachedStates = this.cache?.workflowStates || [];
    let state = cachedStates.find((s: any) => normalize(s.name) === target);
    if (state) return state.id;

    const query = `
      query GetStates($teamId: ID!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name }
        }
      }
    `;
    const data = await this.query<{ workflowStates: { nodes: WorkflowState[] } }>(query, { teamId: this.teamId });
    state = data?.workflowStates?.nodes?.find((s: any) => normalize(s.name) === target);
    if (!state) {
      const available = (data?.workflowStates?.nodes || cachedStates).map((s: any) => s.name).join(', ');
      throw new Error(`Unknown status "${stateName}". Available states: ${available}`);
    }
    return state.id;
  }

  private async getOrCreateLabels(labelNames: string[]): Promise<string[]> {
    // Check cache first
    const cachedLabels = this.cache?.labels || [];
    const labelIds: string[] = [];

    const uncachedLabels: string[] = [];
    for (const name of labelNames) {
      const cached = cachedLabels.find(l => l.name.toLowerCase() === name.toLowerCase());
      if (cached) {
        labelIds.push(cached.id);
      } else {
        uncachedLabels.push(name);
      }
    }

    if (uncachedLabels.length === 0) {
      return labelIds;
    }

    const query = `
      query GetLabels($teamId: ID!) {
        issueLabels(filter: { team: { id: { eq: $teamId } } }) {
          nodes {
            id
            name
          }
        }
      }
    `;

    const data = await this.query<{ issueLabels: { nodes: Label[] } }>(
      query,
      { teamId: this.teamId }
    );

    const existingLabels = data?.issueLabels.nodes || [];
    const labelMap = new Map(existingLabels.map(l => [l.name.toLowerCase(), l.id]));

    for (const name of uncachedLabels) {
      const existing = labelMap.get(name.toLowerCase());
      if (existing) {
        labelIds.push(existing);
      } else {
        // Create new label
        const newLabel = await this.createLabel(name);
        if (newLabel) labelIds.push(newLabel.id);
      }
    }

    return labelIds;
  }

  private async createLabel(name: string): Promise<Label | null> {
    const mutation = `
      mutation CreateLabel($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) {
          success
          issueLabel {
            id
            name
          }
        }
      }
    `;

    const data = await this.query<{ issueLabelCreate: { success: boolean; issueLabel: Label } }>(
      mutation,
      { input: { teamId: this.teamId, name } }
    );

    return data?.issueLabelCreate.issueLabel || null;
  }

  private async getUserByEmailOrName(emailOrName: string): Promise<User | null> {
    // Check cache first
    if (this.cache?.users.length) {
      const emailLower = emailOrName.toLowerCase();
      const user = this.cache.users.find(u => 
        u.email.toLowerCase() === emailLower || 
        u.name.toLowerCase() === emailLower
      );
      if (user) return user;
    }

    const query = `
      query GetUsers {
        users {
          nodes {
            id
            name
            email
          }
        }
      }
    `;

    const data = await this.query<{ users: { nodes: User[] } }>(query);
    const users = data?.users.nodes || [];

    const emailLower = emailOrName.toLowerCase();
    return users.find(u => 
      u.email.toLowerCase() === emailLower || 
      u.name.toLowerCase() === emailLower
    ) || null;
  }

  async getProjectStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    totalEstimate: number;
  }> {
    const issues = await this.listIssues({ limit: 200 });
    const byStatus: Record<string, number> = {};
    let totalEstimate = 0;

    for (const issue of issues) {
      byStatus[issue.state.name] = (byStatus[issue.state.name] || 0) + 1;
      totalEstimate += issue.estimate || 0;
    }

    return {
      total: issues.length,
      byStatus,
      totalEstimate,
    };
  }

  async initializeCache(): Promise<LinearCache> {
    console.log('🔄 Initializing Linear cache...\n');

    // Get workspace info
    console.log('📡 Fetching workspace...');
    const workspaceQuery = `
      query GetWorkspace {
        organization {
          id
          name
        }
      }
    `;
    const workspaceData = await this.query<{ organization: { id: string; name: string } }>(workspaceQuery);

    // Get team info from env or search
    console.log('📡 Fetching team...');
    let teamData: { id: string; name: string; key: string } | null = null;
    
    if (process.env.LINEAR_TEAM_ID) {
      const teamQuery = `
        query GetTeam($id: String!) {
          team(id: $id) {
            id
            name
            key
          }
        }
      `;
      const result = await this.query<{ team: { id: string; name: string; key: string } }>(
        teamQuery,
        { id: process.env.LINEAR_TEAM_ID }
      );
      teamData = result?.team || null;
    } else {
      // List all teams and pick first one
      const teamsQuery = `
        query GetTeams {
          teams {
            nodes {
              id
              name
              key
            }
          }
        }
      `;
      const result = await this.query<{ teams: { nodes: Array<{ id: string; name: string; key: string }> } }>(teamsQuery);
      teamData = result?.teams.nodes[0] || null;
    }

    if (!teamData) {
      throw new Error('No team found');
    }

    // Get project info
    console.log('📡 Fetching project...');
    let projectData: { id: string; name: string } | null = null;
    
    if (process.env.LINEAR_PROJECT_ID) {
      const projectQuery = `
        query GetProject($id: String!) {
          project(id: $id) {
            id
            name
          }
        }
      `;
      const result = await this.query<{ project: { id: string; name: string } }>(
        projectQuery,
        { id: process.env.LINEAR_PROJECT_ID }
      );
      projectData = result?.project || null;
    } else {
      // List team projects and pick first one
      const projectsQuery = `
        query GetProjects {
          projects {
            nodes {
              id
              name
            }
          }
        }
      `;
      const result = await this.query<{ projects: { nodes: Array<{ id: string; name: string }> } }>(
        projectsQuery,
        {}
      );
      const allProjects = result?.projects.nodes || [];
      // Try to match by default project name first, fallback to first
      const defaultName = orgConfig.defaultProject?.toLowerCase();
      projectData = allProjects.find(p => p.name.toLowerCase() === defaultName) || allProjects[0] || null;
    }

    if (!projectData) {
      throw new Error('No project found');
    }

    // Get all users
    console.log('📡 Fetching users...');
    const usersQuery = `
      query GetUsers {
        users {
          nodes {
            id
            name
            email
          }
        }
      }
    `;
    const usersData = await this.query<{ users: { nodes: User[] } }>(usersQuery);

    // Get workflow states
    console.log('📡 Fetching workflow states...');
    const statesQuery = `
      query GetStates($teamId: ID!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes {
            id
            name
            type
          }
        }
      }
    `;
    const statesData = await this.query<{ workflowStates: { nodes: WorkflowState[] } }>(
      statesQuery,
      { teamId: teamData.id }
    );

    // Get labels
    console.log('📡 Fetching labels...');
    const labelsQuery = `
      query GetLabels($teamId: ID!) {
        issueLabels(filter: { team: { id: { eq: $teamId } } }) {
          nodes {
            id
            name
          }
        }
      }
    `;
    const labelsData = await this.query<{ issueLabels: { nodes: Label[] } }>(
      labelsQuery,
      { teamId: teamData.id }
    );

    const cacheData: LinearCache = {
      _comment: 'This file is auto-generated. Run \'npm run linear init\' to regenerate.',
      lastUpdated: new Date().toISOString(),
      workspace: {
        id: workspaceData?.organization.id || null,
        name: workspaceData?.organization.name || null,
      },
      team: {
        id: teamData.id,
        name: teamData.name,
        key: teamData.key,
      },
      project: {
        id: projectData.id,
        name: projectData.name,
      },
      users: usersData?.users.nodes || [],
      workflowStates: statesData?.workflowStates.nodes || [],
      labels: labelsData?.issueLabels.nodes || [],
      currentMilestone: null,
    };

    // Detect current milestone: nearest upcoming targetDate, fallback to most recent past
    console.log('📡 Fetching milestones...');
    const milestonesQuery = `
      query GetMilestones($projectId: String!) {
        project(id: $projectId) {
          projectMilestones {
            nodes { id name targetDate }
          }
        }
      }
    `;
    const milestonesData = await this.query<{ project: { projectMilestones: { nodes: Array<{ id: string; name: string; targetDate: string | null }> } } }>(
      milestonesQuery, { projectId: projectData.id }
    );
    const milestones = milestonesData?.project.projectMilestones.nodes || [];
    if (milestones.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = milestones
        .filter(m => m.targetDate && m.targetDate >= today)
        .sort((a, b) => (a.targetDate! < b.targetDate! ? -1 : 1));
      const past = milestones
        .filter(m => m.targetDate && m.targetDate < today)
        .sort((a, b) => (a.targetDate! > b.targetDate! ? -1 : 1));
      const undated = milestones.filter(m => !m.targetDate);
      cacheData.currentMilestone = upcoming[0] || past[0] || undated[0] || null;
    }

    saveCache(cacheData);
    console.log('\n✅ Cache initialized successfully!\n');
    console.log(`Team: ${teamData.name} (${teamData.key})`);
    console.log(`Project: ${projectData.name}`);
    console.log(`Current Milestone: ${cacheData.currentMilestone?.name || '(none)'}`);
    console.log(`Users: ${cacheData.users.length}`);
    console.log(`Workflow States: ${cacheData.workflowStates.length}`);
    console.log(`Labels: ${cacheData.labels.length}`);
    console.log(`\nCache saved to: ${CACHE_FILE}\n`);

    return cacheData;
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

const program = new Command();

program
  .name('linear')
  .description(`Linear CLI (org: ${CURRENT_ORG}) — multi-org project management tool`)
  .version('2.0.0')
  .option('--org <org>', 'Organization key (cog, ct, gan)', CURRENT_ORG);

// ----------------------------------------------------------------------------
// Initialize Cache
// ----------------------------------------------------------------------------

program
  .command('init')
  .description('Initialize Linear cache with team, project, users, and workflow data')
  .option('--force', 'Force re-initialization even if cache exists')
  .action(async (options) => {
    if (existsSync(CACHE_FILE) && !options.force) {
      console.log('\n⚠️  Cache already exists. Use --force to re-initialize.\n');
      process.exit(0);
    }

    const client = new LinearClient(false);
    try {
      await client.initializeCache();
    } catch (error) {
      console.error('\n❌ Failed to initialize cache:', error);
      process.exit(1);
    }
  });

// ----------------------------------------------------------------------------
// List Issues
// ----------------------------------------------------------------------------

program
  .command('list')
  .description('List all issues')
  .option('-s, --status <status>', 'Filter by status')
  .option('--no-backlog', 'Exclude backlog issues')
  .option('-j, --json', 'Output as JSON')
  .option('-l, --limit <limit>', 'Maximum number of issues', '100')
  .action(async (options) => {
    const client = new LinearClient();
    const issues = await client.listIssues({
      status: options.status,
      includeBacklog: options.backlog,
      limit: parseInt(options.limit),
    });

    if (options.json) {
      console.log(JSON.stringify(issues, null, 2));
    } else {
      console.log(`\nFound ${issues.length} issues:\n`);
      for (const issue of issues) {
        const assignee = issue.assignee ? ` [@${issue.assignee.name}]` : '';
        const estimate = issue.estimate ? ` (${issue.estimate}h)` : '';
        console.log(`  ${issue.identifier}: ${issue.title}${estimate}${assignee}`);
        console.log(`    Status: ${issue.state.name}`);
        if (issue.labels && issue.labels.nodes.length > 0) {
          console.log(`    Labels: ${issue.labels.nodes.map(l => l.name).join(', ')}`);
        }
        console.log();
      }
    }
  });

// ----------------------------------------------------------------------------
// Find Issues
// ----------------------------------------------------------------------------

program
  .command('find <search>')
  .description('Search for issues by text')
  .option('--in <where>', 'Search in: title, description, or all', 'all')
  .option('-s, --status <status>', 'Filter by status')
  .option('-j, --json', 'Output as JSON')
  .action(async (search, options) => {
    const client = new LinearClient();
    const issues = await client.findIssues(search, {
      searchIn: options.in as 'title' | 'description' | 'all',
      status: options.status,
    });

    if (options.json) {
      console.log(JSON.stringify(issues, null, 2));
    } else {
      console.log(`\nFound ${issues.length} matching issues:\n`);
      for (const issue of issues) {
        console.log(`  ${issue.identifier}: ${issue.title}`);
        console.log(`    Status: ${issue.state.name}`);
        console.log();
      }
    }
  });

// ----------------------------------------------------------------------------
// Get Issue Details
// ----------------------------------------------------------------------------

program
  .command('get <identifier>')
  .description('Get detailed information about an issue')
  .option('-j, --json', 'Output as JSON')
  .action(async (identifier, options) => {
    const client = new LinearClient();
    const issue = await client.getIssue(identifier);
    
    if (!issue) {
      console.error(`Issue ${identifier} not found`);
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(issue, null, 2));
    } else {
      console.log(`\n${issue.identifier}: ${issue.title}`);
      console.log(`Status: ${issue.state.name}`);
      if (issue.description) console.log(`Description: ${issue.description}`);
      if (issue.assignee) console.log(`Assignee: ${issue.assignee.name}`);
      if (issue.estimate) console.log(`Estimate: ${issue.estimate}h`);
      if (issue.dueDate) console.log(`Due: ${issue.dueDate}`);
      if (issue.projectMilestone) console.log(`Milestone: ${issue.projectMilestone.name}`);
      if (issue.labels && issue.labels.nodes.length > 0) {
        console.log(`Labels: ${issue.labels.nodes.map(l => l.name).join(', ')}`);
      }
      if (issue.children && issue.children.nodes.length > 0) {
        console.log(`\nSub-tasks (${issue.children.nodes.length}):`);
        for (const child of issue.children.nodes) {
          console.log(`  ${child.identifier}: ${child.title} [${child.state.name}]`);
        }
      }
      console.log(`\nURL: ${issue.url}`);
    }
  });

// ----------------------------------------------------------------------------
// Comment on Issue
// ----------------------------------------------------------------------------

program
  .command('comment <identifier> <body>')
  .description('Add a comment to an issue')
  .action(async (identifier: string, body: string) => {
    const client = new LinearClient();
    const success = await client.commentOnIssue(identifier, body);

    if (success) {
      console.log(`✅ Comment added to ${identifier}`);
    } else {
      console.error(`❌ Failed to add comment to ${identifier}`);
      process.exit(1);
    }
  });

// ----------------------------------------------------------------------------
// Create Issue
// ----------------------------------------------------------------------------

program
  .command('create <title>')
  .description('Create a new issue')
  .option('-d, --description <text>', 'Issue description')
  .option('-s, --status <status>', 'Initial status', 'Todo')
  .option('--due <date>', 'Due date (YYYY-MM-DD)')
  .option('-e, --estimate <hours>', 'Time estimate in hours')
  .option('-p, --priority <priority>', 'Priority: urgent/high/medium/low/none or 1-4 (default: none)', '0')
  .option('-l, --labels <labels>', 'Comma-separated labels')
  .option('-m, --milestone <name>', 'Milestone name (defaults to current milestone from cache)')
  .option('--no-milestone', 'Skip default milestone assignment')
  .option('--parent <identifier>', 'Parent issue identifier')
  .option('-a, --assignee <email>', 'Assignee email or name')
  .option('--project <name>', 'Project name (overrides default from cache)')
  .action(async (title, options) => {
    const client = new LinearClient();
    const issue = await client.createIssue({
      title,
      description: options.description,
      status: options.status,
      dueDate: options.due,
      estimate: options.estimate ? parseFloat(options.estimate) : undefined,
      priority: parsePriority(options.priority),
      labels: options.labels ? options.labels.split(',').map((l: string) => l.trim()) : undefined,
      milestone: options.milestone === false ? null : options.milestone,
      parent: options.parent,
      assignee: options.assignee,
      project: options.project,
    });

    if (issue) {
      console.log(`✅ Created ${issue.identifier}: ${issue.title}`);
      console.log(`🔗 ${issue.url}`);
    } else {
      console.error('❌ Failed to create issue');
      process.exit(1);
    }
  });

// ----------------------------------------------------------------------------
// Update Issue
// ----------------------------------------------------------------------------

program
  .command('update <identifier>')
  .description('Update an existing issue')
  .option('-t, --title <text>', 'New title')
  .option('-d, --description <text>', 'New description')
  .option('-s, --status <status>', 'New status')
  .option('--due <date>', 'Due date (YYYY-MM-DD)')
  .option('-e, --estimate <hours>', 'Time estimate in hours')
  .option('-p, --priority <priority>', 'Priority (0-4)')
  .option('-l, --labels <labels>', 'Comma-separated labels (replaces existing)')
  .option('-m, --milestone <name>', 'Milestone name')
  .option('--parent <identifier>', 'Parent issue identifier')
  .option('-a, --assignee <email>', 'Assignee email or name')
  .action(async (identifier, options) => {
    const client = new LinearClient();
    const updates: any = {};
    
    if (options.title) updates.title = options.title;
    if (options.description) updates.description = options.description;
    if (options.status) updates.status = options.status;
    if (options.due) updates.dueDate = options.due;
    if (options.estimate) updates.estimate = parseFloat(options.estimate);
    if (options.priority) updates.priority = parsePriority(options.priority);
    if (options.labels) updates.labels = options.labels.split(',').map((l: string) => l.trim());
    if (options.milestone) updates.milestone = options.milestone;
    if (options.parent) updates.parent = options.parent;
    if (options.assignee) updates.assignee = options.assignee;

    const issue = await client.updateIssue(identifier, updates);

    if (issue) {
      console.log(`✅ Updated ${issue.identifier}: ${issue.title}`);
      console.log(`🔗 ${issue.url}`);
    } else {
      console.error(`❌ Failed to update issue ${identifier}`);
      process.exit(1);
    }
  });

// ----------------------------------------------------------------------------
// Milestone Commands
// ----------------------------------------------------------------------------

const milestones = program.command('milestones').description('Manage milestones');

milestones
  .command('list')
  .description('List all milestones')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    const client = new LinearClient();
    const milestoneList = await client.listMilestones();

    if (options.json) {
      console.log(JSON.stringify(milestoneList, null, 2));
    } else {
      console.log(`\nFound ${milestoneList.length} milestones:\n`);
      for (const m of milestoneList) {
        console.log(`  ${m.name}`);
        if (m.targetDate) console.log(`    Target: ${m.targetDate}`);
        if (m.description) console.log(`    ${m.description}`);
        console.log();
      }
    }
  });

milestones
  .command('create <name>')
  .description('Create a new milestone')
  .requiredOption('--date <date>', 'Target date (YYYY-MM-DD)')
  .option('-d, --description <text>', 'Milestone description')
  .action(async (name, options) => {
    const client = new LinearClient();
    const milestone = await client.createMilestone({
      name,
      description: options.description,
      targetDate: options.date,
    });

    if (milestone) {
      console.log(`✅ Created milestone: ${milestone.name} (${milestone.targetDate})`);
    } else {
      console.error('❌ Failed to create milestone');
      process.exit(1);
    }
  });

milestones
  .command('update <id>')
  .description('Update an existing milestone')
  .option('-n, --name <text>', 'New name')
  .option('--date <date>', 'New target date (YYYY-MM-DD)')
  .option('-d, --description <text>', 'New description')
  .action(async (id, options) => {
    const client = new LinearClient();
    const updates: any = {};
    if (options.name) updates.name = options.name;
    if (options.date) updates.targetDate = options.date;
    if (options.description) updates.description = options.description;

    const milestone = await client.updateMilestone(id, updates);

    if (milestone) {
      console.log(`✅ Updated milestone: ${milestone.name}`);
    } else {
      console.error(`❌ Failed to update milestone ${id}`);
      process.exit(1);
    }
  });

// ----------------------------------------------------------------------------
// Batch Operations
// ----------------------------------------------------------------------------

const batch = program.command('batch').description('Batch operations on multiple issues');

batch
  .command('update-status')
  .description('Bulk update status for filtered issues')
  .requiredOption('-s, --status <status>', 'Target status')
  .option('--filter-status <status>', 'Filter by current status')
  .option('--filter-title <text>', 'Filter by title text')
  .option('--filter-labels <labels>', 'Filter by labels (comma-separated)')
  .option('--dry-run', 'Preview changes without applying')
  .action(async (options) => {
    const client = new LinearClient();
    const result = await client.bulkUpdateStatus({
      status: options.status,
      filterStatus: options.filterStatus,
      filterTitle: options.filterTitle,
      filterLabels: options.filterLabels ? options.filterLabels.split(',') : undefined,
      dryRun: options.dryRun,
    });

    if (options.dryRun) {
      console.log(`\nWould update ${result.issues.length} issues:`);
      for (const id of result.issues.slice(0, 10)) {
        console.log(`  ${id}`);
      }
      if (result.issues.length > 10) {
        console.log(`  ... and ${result.issues.length - 10} more`);
      }
    } else {
      console.log(`\n✅ Updated ${result.updated} issues`);
      if (result.failed > 0) {
        console.log(`❌ Failed to update ${result.failed} issues`);
      }
    }
  });

batch
  .command('add-labels <identifiers>')
  .description('Add labels to multiple issues')
  .requiredOption('-l, --labels <labels>', 'Comma-separated labels to add')
  .action(async (identifiers, options) => {
    const client = new LinearClient();
    const ids = identifiers.split(',').map((id: string) => id.trim());
    const labels = options.labels.split(',').map((l: string) => l.trim());

    const result = await client.bulkAddLabels(ids, labels);

    console.log(`\n✅ Added labels to ${result.updated} issues`);
    if (result.failed > 0) {
      console.log(`❌ Failed to update ${result.failed} issues`);
    }
  });

batch
  .command('assign <identifiers>')
  .description('Assign multiple issues to a user')
  .requiredOption('-a, --assignee <email>', 'Assignee email or name')
  .action(async (identifiers, options) => {
    const client = new LinearClient();
    const ids = identifiers.split(',').map((id: string) => id.trim());

    const result = await client.bulkAssign(ids, options.assignee);

    console.log(`\n✅ Assigned ${result.updated} issues to ${options.assignee}`);
    if (result.failed > 0) {
      console.log(`❌ Failed to assign ${result.failed} issues`);
    }
  });

// ----------------------------------------------------------------------------
// Project Stats
// ----------------------------------------------------------------------------

program
  .command('stats')
  .description('Show project statistics')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    const client = new LinearClient();
    const stats = await client.getProjectStats();

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`\n📊 Project: ${client['projectName']}`);
      console.log(`Total Issues: ${stats.total}`);
      console.log(`Total Estimated: ${stats.totalEstimate}h`);
      console.log(`\nBy Status:`);
      for (const [status, count] of Object.entries(stats.byStatus)) {
        console.log(`  ${status}: ${count}`);
      }
    }
  });

program
  .command('my-issues')
  .description('List all issues assigned to you across all projects in this team')
  .option('-s, --status <status>', 'Filter by status (e.g. "In Progress", "Todo")')
  .option('--no-done', 'Exclude completed/cancelled issues (default: true)')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    const client = new LinearClient();
    const teamKey = orgConfig.teamKey;

    const statusFilter = options.status
      ? `, state: { name: { eq: "${options.status}" } }`
      : '';

    const query = `
      query MyIssues($teamKey: String!) {
        viewer {
          assignedIssues(filter: {
            team: { key: { eq: $teamKey } }
            ${statusFilter}
          }) {
            nodes {
              identifier
              title
              description
              state { name type }
              priority
              dueDate
              estimate
              assignee { id name email }
              project { name }
              projectMilestone { id name }
              labels { nodes { id name } }
              createdAt
              url
            }
          }
        }
      }
    `;

    const result = await client['query']<{
      viewer: { assignedIssues: { nodes: Issue[] } }
    }>(query, { teamKey });

    let issues = result?.viewer?.assignedIssues?.nodes || [];

    // Exclude completed/cancelled by default unless --done is passed
    if (options.done !== false) {
      issues = issues.filter(i => i.state.type !== 'completed' && i.state.type !== 'cancelled');
    }

    if (options.json) {
      console.log(JSON.stringify(issues, null, 2));
      return;
    }

    const PRIORITY_LABEL = (p: number) => ['—', '⚡ Urgent', '⬆ High', '➡ Medium', '⬇ Low'][p] || '—';
    const widths = [8, 10, 12, 18, 52];
    const pad = (s: string, n: number) => String(s).padEnd(n);
    console.log(`\nFound ${issues.length} issue${issues.length !== 1 ? 's' : ''} assigned to you:\n`);
    console.log(['ID','Priority','Status','Project','Title'].map((h,i) => pad(h, widths[i])).join('  '));
    console.log(widths.map(w => '-'.repeat(w)).join('  '));
    for (const issue of issues) {
      const row = [
        issue.identifier,
        PRIORITY_LABEL(issue.priority),
        issue.state.name,
        ((issue as any).project?.name || '—').slice(0, 18),
        issue.title.slice(0, 52),
      ];
      console.log(row.map((c, i) => pad(c, widths[i])).join('  '));
    }
  });

program
  .command('team-issues')
  .description('List open issues for all team members (excluding yourself) across all projects')
  .option('-j, --json', 'Output as JSON')
  .action(async (options) => {
    const client = new LinearClient();
    const teamKey = orgConfig.teamKey;

    // Get viewer email to exclude self
    const viewerData = await client['query']<{ viewer: { email: string } }>(`query { viewer { email } }`, {});
    const myEmail = viewerData?.viewer?.email || '';

    // Get team members
    const teamsData = await client['query']<{
      teams: { nodes: Array<{ members: { nodes: Array<{ id: string; name: string; email: string }> } }> }
    }>(`query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { members { nodes { id name email } } } } }`, { key: teamKey });

    const SKIP = new Set(['a51285d7-b47b-4e26-8c06-8d8f6f22691c@integration.linear.app']);
    const members = (teamsData?.teams?.nodes?.[0]?.members?.nodes || [])
      .filter(m => m.email !== myEmail && !SKIP.has(m.email));

    if (options.json) {
      const result: Record<string, any[]> = {};
      for (const member of members) {
        const data = await client['query']<{ user: { assignedIssues: { nodes: Issue[] } } }>(`
          query($teamKey: String!) {
            user(id: "${member.id}") {
              assignedIssues(filter: { team: { key: { eq: $teamKey } } completedAt: { null: true } }) {
                nodes { identifier title priority state { name type } project { name } createdAt url }
              }
            }
          }`, { teamKey });
        const issues = (data?.user?.assignedIssues?.nodes || [])
          .filter(i => i.state.type !== 'completed' && i.state.type !== 'cancelled');
        result[member.email] = issues;
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const PRIORITY_LABEL = (p: number) => ['—', '⚡ Urgent', '⬆ High', '➡ Medium', '⬇ Low'][p] || '—';
    const widths = [8, 10, 12, 18, 52];
    const pad = (s: string, n: number) => String(s).padEnd(n);
    const header = ['ID','Priority','Status','Project','Title'].map((h,i) => pad(h, widths[i])).join('  ');
    const divider = widths.map(w => '-'.repeat(w)).join('  ');

    for (const member of members) {
      const data = await client['query']<{ user: { assignedIssues: { nodes: Issue[] } } }>(`
        query($teamKey: String!) {
          user(id: "${member.id}") {
            assignedIssues(filter: { team: { key: { eq: $teamKey } } completedAt: { null: true } }) {
              nodes { identifier title priority state { name type } project { name } createdAt url }
            }
          }
        }`, { teamKey });

      const issues = (data?.user?.assignedIssues?.nodes || [])
        .filter((i: any) => i.state.type !== 'completed' && i.state.type !== 'cancelled');

      issues.sort((a: any, b: any) => {
        const pa = a.priority === 0 ? 99 : a.priority;
        const pb = b.priority === 0 ? 99 : b.priority;
        if (pa !== pb) return pa - pb;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      const name = member.name || member.email.split('@')[0];
      console.log(`\n${name}`);
      if (issues.length === 0) { console.log('  (no open issues)'); continue; }
      console.log(header);
      console.log(divider);
      for (const i of issues as any[]) {
        const row = [i.identifier, PRIORITY_LABEL(i.priority), i.state.name, (i.project?.name||'—').slice(0,18), i.title.slice(0,52)];
        console.log(row.map((c: string, idx: number) => pad(c, widths[idx])).join('  '));
      }
    }
  });

// Parse and execute
program.parse();
