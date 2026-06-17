#!/usr/bin/env node
/**
 * spawn-linear.js — Create Linear issue and auto-cleanup old ones
 * 
 * Usage: node spawn-linear.js "<title>" "<task>"
 * 
 * Uses: /workspace/extra/skills/linear/scripts/linear.ts
 * Auto-purges Done/Canceled issues older than 7 days
 */

const { execSync } = require('child_process');
const fs = require('fs');

// Load env
const env = []; // Linear API keys from NC container environment
env.forEach(l => { if (l.includes('=')) process.env[l.split('=')[0]] = l.split('=')[1]; });

const LINEAR = `node /workspace/extra/skills/linear/scripts/linear.ts --org cog`;

function run(cmd) {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

async function main() {
  // ============== AUTO CLEANUP ==============
  console.log('=== Auto-cleanup: Checking for old closed issues ===');
  
  try {
    const listOutput = run(`${LINEAR} list --json --limit 100`);
    const issues = JSON.parse(listOutput);
    
    const now = Date.now();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    let deleted = 0;
    
    for (const issue of issues) {
      const labels = issue.labels?.nodes?.map(l => l.name) || [];
      const stateName = issue.state?.name;
      
      if (labels.includes('OpenClaw') && (stateName === 'Done' || stateName === 'Canceled')) {
        const createdAt = new Date(issue.createdAt).getTime();
        const daysOld = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
        
        if (daysOld >= 7) {
          console.log(`  Purging: ${issue.identifier} (${stateName}, ${daysOld}d old)`);
          try {
            run(`${LINEAR} update ${issue.identifier} --status Canceled`);
            deleted++;
          } catch (e) {
            console.log(`  → Failed: ${e.message}`);
          }
        }
      }
    }
    
    if (deleted > 0) {
      console.log(`  → Purged ${deleted} old issues`);
    } else {
      console.log('  → No old issues to purge');
    }
  } catch (e) {
    console.log('  → Could not check cleanup:', e.message);
  }
  
  console.log('');
  
  // ============== CREATE NEW ISSUE ==============
  const title = process.argv[2];
  const task = process.argv[3];
  
  if (!title || !task) {
    console.error('Usage: node spawn-linear.js "<title>" "<task>"');
    process.exit(1);
  }
  
  console.log(`Creating: ${title}`);
  const result = run(`${LINEAR} create "${title}" -d "${task}" -l OpenClaw`);
  console.log(result);
  
  const issueId = result.match(/COG-\d+/)?.[0];
  
  console.log('=== NEXT STEPS ===');
  console.log('1. Spawn agent: openclaw sessions spawn --agent-id <agent> --task "<task>" --thinking <level>');
  console.log('');
  console.log(`2. When done: bash close-linear.sh ${issueId || '<ISSUE_ID>'} <success|failure> "<notes>"`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});