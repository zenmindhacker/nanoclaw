#!/usr/bin/env node
/**
 * cleanup-linear.js — Delete old closed issues in OpenClaw project
 * 
 * Usage: node cleanup-linear.js [--dry-run]
 * 
 * Deletes issues that have been in Done/Canceled state for >7 days
 * Use --dry-run to see what would be deleted without actually deleting
 */

const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

// Load API key
const env = []; // Linear API keys from NC container environment
let API_KEY = '';
env.forEach(l => { if (l.startsWith('LINEAR_API_KEY_COGNITIVE=')) API_KEY = l.split('=')[1].trim(); });

const PROJECT_ID = '55c7660a-5b98-4553-91d3-a0ea78f098c2';
const TEAM_ID = 'bd7e5308-84ee-4aaf-b67a-03c2e7a149d6';

const DRY_RUN = process.argv.includes('--dry-run');

if (DRY_RUN) {
  console.log('=== DRY RUN - No changes will be made ===\n');
}

function gql(q, vars = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: q, variables: vars });
    const req = https.request('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Authorization': API_KEY, 'Content-Type': 'application/json', 'Content-Length': postData.length },
    }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(JSON.parse(b))); });
    req.on('error', reject); req.write(postData); req.end();
  });
}

async function main() {
  // Get states
  const stateData = await gql(`{ team(id: "${TEAM_ID}") { states { nodes { id name } } } }`);
  const states = stateData.data.team.states.nodes;
  
  const doneState = states.find(s => s.name === 'Done')?.id;
  const cancelledState = states.find(s => s.name === 'Canceled')?.id;
  
  console.log(`States - Done: ${doneState?.substring(0, 8)}, Canceled: ${cancelledState?.substring(0, 8)}`);
  console.log('');
  console.log('=== Finding old closed issues in OpenClaw project ===\n');
  
  // Get closed issues
  const q = `{ issues(filter: { project: { id: { eq: "${PROJECT_ID}" } }, state: { id: { in: ["${doneState}", "${cancelledState}"] } } }, first: 50) { nodes { id identifier title completedAt state { name } } } }`;
  const result = await gql(q);
  
  const issues = result.data.issues.nodes;
  console.log(`Found ${issues.length} closed issues\n`);
  
  if (issues.length === 0) {
    console.log('No issues to clean up');
    return;
  }
  
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  
  let deleted = 0;
  let skipped = 0;
  
  for (const issue of issues) {
    const completed = issue.completedAt ? new Date(issue.completedAt).getTime() : 0;
    const daysOld = completed ? Math.floor((now - completed) / (1000 * 60 * 60 * 24)) : -1;
    
    const line = `${issue.identifier} | ${issue.state.name} | ${daysOld >= 0 ? daysOld + ' days' : 'unknown'} | ${issue.title.substring(0, 40)}`;
    
    if (daysOld >= 7) {
      console.log(`OLD: ${line}`);
      
      if (!DRY_RUN) {
        console.log(`  → Deleting ${issue.identifier}...`);
        try {
          const delResult = await gql(`mutation { issueDelete(id: "${issue.identifier}") { success } }`);
          if (delResult.data?.issueDelete?.success) {
            console.log(`  → Deleted ${issue.identifier}`);
            deleted++;
          } else {
            console.log(`  → Failed to delete ${issue.identifier}`);
          }
        } catch (e) {
          console.log(`  → Error: ${e.message}`);
        }
      } else {
        console.log(`  → Would delete ${issue.identifier}`);
        deleted++;
      }
    } else {
      console.log(`Skip: ${line}`);
      skipped++;
    }
  }
  
  console.log('');
  if (DRY_RUN) {
    console.log(`=== DRY RUN: Would delete ${deleted} issues, skip ${skipped} ===`);
    console.log('Run without --dry-run to actually delete');
  } else {
    console.log(`=== Cleanup complete: Deleted ${deleted}, skipped ${skipped} ===`);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});