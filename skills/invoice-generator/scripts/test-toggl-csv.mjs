import https from 'https';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { writeFileSync } from 'fs';

const credPath = '/workspace/extra/credentials/toggl';
const apiToken = readFileSync(credPath, 'utf8').trim();

const workspaceId = '8629306';
const since = '2026-01-01';
const until = '2026-01-31';
const projectId = '204851981';

// Try CSV export
const endpoint = `/reports/api/v2/details?workspace_id=${workspaceId}&since=${since}&until=${until}&project_ids=${projectId}&format=csv`;

const auth = Buffer.from(`${apiToken}:api_token`).toString('base64');

const options = {
  hostname: 'api.track.toggl.com',
  path: endpoint,
  method: 'GET',
  headers: {
    'Authorization': `Basic ${auth}`,
  }
};

console.log('Testing Toggl CSV export...');

const result = await new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    console.log('Status:', res.statusCode);
    console.log('Content-Type:', res.headers['content-type']);
    
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Data length:', data.length);
      console.log('First 500 chars:', data.substring(0, 500));
      resolve(data);
    });
  });
  req.on('error', reject);
  req.end();
});
