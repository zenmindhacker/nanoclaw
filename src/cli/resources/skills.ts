/**
 * `ncl skills audit` — deterministic skill health report.
 * No LLM calls; reads from disk + central DB activation logs.
 */
import { getAllAgentGroups } from '../../db/agent-groups.js';
import { auditGroupSkills } from '../../modules/skills/audit.js';
import { register } from '../registry.js';

register({
  name: 'skills-audit',
  description: 'Audit agent-created skills for near-duplicates, thin bodies, stale usage, and cap headroom.',
  access: 'open',
  resource: 'skills',
  parseArgs: (raw) => ({
    folder: (raw.folder as string) || undefined,
    groupId: (raw.id as string) || undefined,
  }),
  handler: async (args) => {
    const groups = getAllAgentGroups();
    const targets = groups.filter((g) => {
      if (args.groupId) return g.id === args.groupId;
      if (args.folder) return g.folder === args.folder;
      return true;
    });

    if (targets.length === 0) {
      return { error: 'No matching agent groups found.' };
    }

    const results = targets.map((g) => auditGroupSkills(g.id, g.folder));

    const summary = results.map((r) => ({
      group: r.folder,
      totalSkills: r.totalSkills,
      agentCreated: r.agentCreatedCount,
      issues: r.issues.length,
      details: r.issues.map(
        (i) => `  ${i.severity.toUpperCase()}  ${i.skill}: ${i.issue}${i.detail ? ` (${i.detail})` : ''}`,
      ),
    }));

    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

    return { summary, totalIssues };
  },
});
