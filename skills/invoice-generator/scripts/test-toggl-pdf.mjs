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
const projectId = '204851981'; // WW: Consulting

// Try the PDF export endpoint
const endpoint = `/api/v2/details?workspace_id=${workspaceId}&since=${since}&until=${until}&project_ids=${projectId}`;

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

console.log('Testing Toggl PDF export...');
console.log('Endpoint:', endpoint);

// Make request
const result = await new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', res.headers['content-type']);
    
    if (res.statusCode >= 200 && res.statusCode < 300 && res.headers['content-type']?.includes('pdf')) {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(data);
        resolve({ success: true, data: buffer, contentType: res.headers['content-type'] });
      });
    } else {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ success: false, data: data, statusCode: res.statusCode });
      });
    }
  });
  req.on('error', reject);
  req.end();
});

if (result.success) {
  console.log('PDF received! Size:', result.data.length, 'bytes');
  // Save to file
  writeFileSync('/tmp/toggl-report-test.pdf', result.data);
  console.log('Saved to /tmp/toggl-report-test.pdf');
} else {
  console.log('Response:', result.data.substring(0, 500));
}
