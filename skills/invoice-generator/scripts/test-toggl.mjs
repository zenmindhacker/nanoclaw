import https from 'https';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';

const credPath = '/workspace/extra/credentials/toggl';
const apiToken = readFileSync(credPath, 'utf8').trim();

const workspaceId = '8629306';
const since = '2026-01-01';
const until = '2026-01-31';

const endpoint = `/reports/api/v2/summary?workspace_id=${workspaceId}&since=${since}&until=${until}`;

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

const result = await new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(JSON.parse(data));
      } else {
        reject(new Error(`HTTP ${res.statusCode}: ${data}`));
      }
    });
  });
  req.on('error', reject);
  req.end();
});

console.log('Response keys:', Object.keys(result));
console.log('\nFirst few items:');
for (const item of (result.data || []).slice(0, 5)) {
  console.log(JSON.stringify(item, null, 2));
}
