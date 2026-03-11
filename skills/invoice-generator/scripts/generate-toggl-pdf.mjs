import PDFDocument from 'pdfkit';
import https from 'https';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { createWriteStream } from 'fs';

/**
 * Get Toggl time entries for a project
 */
function getTogglEntries(workspaceId, projectId, since, until) {
  const apiToken = readFileSync('/workspace/extra/credentials/toggl', 'utf8').trim();
  
  const endpoint = `/reports/api/v2/details?workspace_id=${workspaceId}&since=${since}&until=${until}&project_ids=${projectId}`;
  const auth = Buffer.from(`${apiToken}:api_token`).toString('base64');
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.track.toggl.com',
      path: endpoint,
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}` }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.data || []);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Generate a PDF report from Toggl entries
 */
export async function generateTogglPdfReport(invoiceNumber, clientName, projectId, since, until, outputPath) {
  console.log(`   📄 Generating PDF report for ${clientName}...`);
  
  // Get time entries
  const entries = await getTogglEntries('8629306', projectId, since, until);
  
  // Calculate totals
  let totalSeconds = 0;
  const userTotals = {};
  
  for (const entry of entries) {
    totalSeconds += entry.dur || 0;
    const user = entry.user || 'Unknown';
    if (!userTotals[user]) {
      userTotals[user] = { seconds: 0, entries: 0 };
    }
    userTotals[user].seconds += entry.dur || 0;
    userTotals[user].entries += 1;
  }
  
  const totalHours = Math.round(totalSeconds / 3600 * 100) / 100;
  
  // Create PDF
  const doc = new PDFDocument({ margin: 50 });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);
  
  // Header
  doc.fontSize(20).text('Toggl Time Report', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Client: ${clientName}`);
  doc.text(`Invoice: ${invoiceNumber}`);
  doc.text(`Period: ${since} to ${until}`);
  doc.moveDown();
  
  // Summary
  doc.fontSize(14).text('Summary', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Total Hours: ${totalHours}`);
  doc.text(`Total Entries: ${entries.length}`);
  doc.moveDown();
  
  // By User
  doc.fontSize(14).text('By Team Member', { underline: true });
  doc.moveDown(0.5);
  
  for (const [user, data] of Object.entries(userTotals)) {
    const hours = Math.round(data.seconds / 3600 * 100) / 100;
    doc.fontSize(12).text(`${user}: ${hours} hours (${data.entries} entries)`);
  }
  
  doc.moveDown();
  
  // Time Entries
  doc.fontSize(14).text('Time Entries', { underline: true });
  doc.moveDown(0.5);
  
  doc.fontSize(10);
  for (const entry of entries.slice(0, 50)) { // Limit to 50 entries
    const hours = Math.round((entry.dur || 0) / 3600 * 100) / 100;
    const date = entry.start ? entry.start.split('T')[0] : 'N/A';
    doc.text(`${date} - ${entry.user}: ${entry.description || 'No description'} (${hours}h)`);
  }
  
  if (entries.length > 50) {
    doc.text(`... and ${entries.length - 50} more entries`);
  }
  
  // Footer
  doc.moveDown(2);
  doc.fontSize(8).text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
  
  doc.end();
  
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

// Test it
const testPath = '/tmp/toggl-test-report.pdf';
generateTogglPdfReport('INV-0131', 'Work Wranglers', '204851981', '2026-01-01', '2026-01-31', testPath)
  .then(path => console.log('PDF generated:', path))
  .catch(err => console.error('Error:', err));
