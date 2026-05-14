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

// Try the reports API v3 which might have PDF
const endpoint = `/reports/api/v3/${workspaceId}/pdf?since=${since}&until=${until}&project_ids[]=${projectId}`;

const auth = Buffer.from(`${apiToken}:api_token`).toString('base64');

const options = {
  hostname: 'api.track.toggl.com',
  path: endpoint,
  method: 'GET',
  headers: {
    'Authorization': `Basic ${auth}`,
    'Accept': 'application/pdf'
  }
};

console.log('Testing Toggl PDF export v3...');
console.log('Endpoint:', endpoint);

const result = await new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', res.headers);
    
    let data = [];
    res.on('data', chunk => data.push(chunk));
    res.on('end', () => {
      const buffer = Buffer.concat(data);
      console.log('Data length:', buffer.length);
      if (buffer.length < 1000) {
        console.log('Response:', buffer.toString());
      }
    });
  });
  req.on('error', reject);
  req.end();
});
