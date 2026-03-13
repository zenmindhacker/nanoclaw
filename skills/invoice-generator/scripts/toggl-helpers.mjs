/**
 * Toggl API Helpers
 * Fetches time entries from Toggl Reports API v2
 */

import https from 'https';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const DEFAULT_CONFIG = {
  api_url: 'https://api.track.toggl.com/reports/api/v2',
  credentials_file: '/workspace/extra/credentials/toggl'
};

/**
 * Load Toggl API token from credentials file
 */
export function getTogglCredentials() {
  const credPath = resolve(homedir(), '.openclaw/credentials/toggl');
  return readFileSync(credPath, 'utf8').trim();
}

/**
 * Make authenticated GET request to Toggl API
 */
function togglRequest(endpoint, apiToken) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${apiToken}:api_token`).toString('base64');
    
    const options = {
      hostname: 'api.track.toggl.com',
      path: endpoint,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`Toggl API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Get summary report for a specific project and date range
 * @param {string} workspaceId - Toggl workspace ID
 * @param {string} projectId - Toggl project ID
 * @param {string} since - Start date (YYYY-MM-DD)
 * @param {string} until - End date (YYYY-MM-DD)
 */
export async function getProjectHours(workspaceId, projectId, since, until) {
  const apiToken = getTogglCredentials();
  
  const endpoint = `/reports/api/v2/summary?workspace_id=${workspaceId}&since=${since}&until=${until}`;
  
  const response = await togglRequest(endpoint, apiToken);
  
  // Find the specific project in the data
  // Response structure: { data: [ { id: 204851981, title: { project: "Name", client: "Client" }, time: ms }, ... ] }
  if (!response.data || !Array.isArray(response.data)) {
    return { totalSeconds: 0, projectFound: false };
  }
  
  const projectData = response.data.find(item => 
    item.id === parseInt(projectId)
  );
  
  if (!projectData) {
    return { totalSeconds: 0, projectFound: false };
  }
  
  return {
    totalSeconds: Math.round((projectData.time || 0) / 1000),
    projectFound: true,
    projectName: projectData.title?.project
  };
}

/**
 * Get hours breakdown by user for a specific project
 * @param {string} workspaceId - Toggl workspace ID
 * @param {string} projectId - Toggl project ID
 * @param {string} since - Start date (YYYY-MM-DD)
 * @param {string} until - End date (YYYY-MM-DD)
 */
export async function getProjectHoursByUser(workspaceId, projectId, since, until) {
  const apiToken = getTogglCredentials();
  
  // The summary endpoint doesn't give user breakdown, we need detailed report
  // Using the detailed endpoint with project_ids filter
  const endpoint = `/reports/api/v2/details?workspace_id=${workspaceId}&since=${since}&until=${until}&project_ids=${projectId}`;
  
  const response = await togglRequest(endpoint, apiToken);
  
  if (!response.data || !Array.isArray(response.data)) {
    return [];
  }
  
  // Group by user
  const userHours = {};
  
  for (const entry of response.data) {
    const userName = entry.user || 'Unknown';
    const duration = entry.dur || 0;
    
    if (!userHours[userName]) {
      userHours[userName] = 0;
    }
    userHours[userName] += duration;
  }
  
  // Convert to array
  return Object.entries(userHours).map(([user, totalMs]) => ({
    user,
    totalSeconds: Math.round(totalMs / 1000),
    totalHours: Math.round(totalMs / 1000 / 3600 * 100) / 100
  }));
}

/**
 * Get hours for Work Wranglers broken down by person and task.
 * Cian's hours are split into regular (CTO Consulting @ $175) and
 * discounted (Management/Sales Consulting @ $125) buckets.
 * @param {string} since - Start date (YYYY-MM-DD)
 * @param {string} until - End date (YYYY-MM-DD)
 */
export async function getWorkWranglersHours(since, until) {
  const workspaceId = '8629306';
  const projectId = '204851981'; // WW: Consulting
  const apiToken = getTogglCredentials();

  const endpoint = `/reports/api/v2/details?workspace_id=${workspaceId}&since=${since}&until=${until}&project_ids=${projectId}`;
  const response = await togglRequest(endpoint, apiToken);
  const entries = response.data || [];

  const DISCOUNTED_TASKS = ['Management Consulting', 'Sales Consulting'];

  const result = {
    cian: 0,             // CTO Consulting seconds
    cianDiscounted: 0,   // Management + Sales Consulting seconds
    rustam: 0,
    total: 0,
    breakdown: entries
  };

  for (const entry of entries) {
    const userLower = (entry.user || '').toLowerCase();
    const task = entry.task || '';
    const dur = Math.round((entry.dur || 0) / 1000); // ms → seconds

    if (userLower.includes('cian') || userLower.includes('kenshin')) {
      if (DISCOUNTED_TASKS.includes(task)) {
        result.cianDiscounted += dur;
      } else {
        result.cian += dur;
      }
    } else if (userLower.includes('rustam') || userLower.includes('rustom')) {
      result.rustam += dur;
    }

    result.total += dur;
  }

  return result;
}

/**
 * Get total hours for a project, optionally filtered to specific users.
 * @param {string} projectId - Toggl project ID
 * @param {string} since - Start date (YYYY-MM-DD)
 * @param {string} until - End date (YYYY-MM-DD)
 * @param {string[]} [billableUsers] - If provided, only count hours for these users (case-insensitive partial match)
 */
export async function getTotalProjectHours(projectId, since, until, billableUsers) {
  const workspaceId = '8629306';

  if (!billableUsers || billableUsers.length === 0) {
    // No user filter — use the fast summary endpoint
    const result = await getProjectHours(workspaceId, projectId, since, until);
    return {
      totalHours: Math.round(result.totalSeconds / 3600 * 100) / 100,
      totalSeconds: result.totalSeconds,
      projectFound: result.projectFound
    };
  }

  // User filter — need detailed entries to filter by person
  const apiToken = getTogglCredentials();
  const endpoint = `/reports/api/v2/details?workspace_id=${workspaceId}&since=${since}&until=${until}&project_ids=${projectId}`;
  const response = await togglRequest(endpoint, apiToken);
  const entries = response.data || [];

  const filters = billableUsers.map(u => u.toLowerCase());
  let totalMs = 0;

  for (const entry of entries) {
    const user = (entry.user || '').toLowerCase();
    if (filters.some(f => user.includes(f))) {
      totalMs += entry.dur || 0;
    }
  }

  const totalSeconds = Math.round(totalMs / 1000);
  return {
    totalHours: Math.round(totalSeconds / 3600 * 100) / 100,
    totalSeconds,
    projectFound: entries.length > 0
  };
}

/**
 * Convert seconds to hours (rounded to 2 decimal places)
 */
export function secondsToHours(seconds) {
  return Math.round(seconds / 3600 * 100) / 100;
}
