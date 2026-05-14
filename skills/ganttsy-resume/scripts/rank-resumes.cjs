#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const githubRoot = process.env.GITHUB_ROOT || '/workspace/extra/github';
const workDir = process.env.WORK_DIR || '/workspace/group/ganttsy-resume';
const candidatesDir = process.env.MD_DIR || path.join(workDir, 'candidates', 'md');
const stateDir = process.env.STATE_DIR || path.join(workDir, '.state');
const targetDir = process.env.TARGET_DIR || path.join(githubRoot, 'ganttsy/ganttsy-strategy/team/designer-resumes');
const jobPostingPath = process.env.JOB_POSTING || path.join(targetDir, 'JOB-POSTING-Product-Designer.md');
const evalGridPath = process.env.EVAL_GRID || path.join(targetDir, 'EVALUATION-GRID.md');
let apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  const credPath = '/workspace/extra/credentials/openrouter';
  if (fs.existsSync(credPath)) {
    apiKey = fs.readFileSync(credPath, 'utf8').trim();
  }
}

if (!fs.existsSync(jobPostingPath)) {
  console.error(`Job posting not found: ${jobPostingPath}`);
  process.exit(1);
}
if (!fs.existsSync(candidatesDir)) {
  console.error(`Candidates dir not found: ${candidatesDir}`);
  process.exit(1);
}
if (!apiKey) {
  console.error('OPENROUTER_API_KEY is required (set env var or create /workspace/extra/credentials/openrouter)');
  process.exit(1);
}
fs.mkdirSync(stateDir, { recursive: true });

const jobText = fs.readFileSync(jobPostingPath, 'utf8');

function loadCandidate(file) {
  const mdPath = path.join(candidatesDir, file);
  const jsonPath = mdPath.replace(/\.md$/i, '.json');
  const text = fs.readFileSync(mdPath, 'utf8');
  let meta = { name: '', email: '', experience: '', skills: [], rate: '' };
  if (fs.existsSync(jsonPath)) {
    try { meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch {}
  }
  
  // Get file creation date for submission timestamp
  let submitted = null;
  try {
    const stats = fs.statSync(mdPath);
    // Use birthtime (creation time) if available, otherwise use mtime
    const date = stats.birthtime || stats.mtime;
    submitted = date.toISOString().slice(5, 10).replace('-', '/'); // MM/DD format
  } catch (e) {
    // Fallback to current date if we can't get file stats
    submitted = new Date().toISOString().slice(5, 10).replace('-', '/');
  }
  
  return { file, mdPath, text, meta, submitted };
}

function extractJSON(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in response');
  return JSON.parse(match[0]);
}

function clampScore(score) {
  if (Number.isNaN(score)) return 1;
  return Math.max(1, Math.min(5, score));
}

// Map 1-5 score to emoji rating
function getEmojiRating(score) {
  if (score >= 4) return '✅';
  if (score >= 2.5) return '⚠️';
  return '❌';
}

// Escape control characters from candidate names for safe markdown
function sanitizeName(name) {
  if (!name) return 'Unknown';
  // Filter out pipe and other control characters
  return name.replace(/[|\x00-\x1F\x7F]/g, '').trim();
}

// Check if email is from Ganttsy (filter out internal emails)
function isInternalEmail(email) {
  if (!email) return false;
  return email.toLowerCase().includes('@ganttsy.com');
}

// Get GitHub URL for a candidate file
function getCandidateLink(file, isNoAttachment, name) {
  // For NO_ATTACHMENT files, don't create a clickable link
  if (isNoAttachment) {
    return name || file.replace(/\.md$/i, '');
  }
  // Full GitHub URL - use name, fallback to filename if no name
  const displayName = name || file.replace(/\.md$/i, '');
  return `[${displayName}](https://github.com/Ganttsy/ganttsy-strategy/blob/main/team/designer-resumes/candidates/md/${file})`;
}

// Weight definitions
const WEIGHTS = {
  'Design Craft': 0.25,
  'Systems Thinking': 0.20,
  'AI Products': 0.15,
  'Collaboration': 0.15,
  'Portfolio Quality': 0.15,
  'Rate Fit': 0.10
};

async function scoreCandidate(candidate) {
  const prompt = `You are an expert product design hiring evaluator.\n\nEvaluate the candidate against the job posting. Focus on evidence of relevant product design work, UX/UI craft, research, systems thinking, collaboration, and impact.\n\nReturn ONLY valid JSON with this schema (all scores 1-5):\n{\n  "skills": {\n    "UX/UI Craft": { "score": number, "reasoning": "string" },\n    "Design Systems": { "score": number, "reasoning": "string" },\n    "User Research": { "score": number, "reasoning": "string" },\n    "Prototyping": { "score": number, "reasoning": "string" },\n    "AI/ML Products": { "score": number, "reasoning": "string" },\n    "Collaboration": { "score": number, "reasoning": "string" }\n  },\n  "portfolio_quality": { "score": number, "reasoning": "string" },\n  "rate_fit": { "score": number, "reasoning": "string" },\n  "overall_reasoning": "string",\n  "strengths": ["string"],\n  "gaps": ["string"],\n  "notes": "string"\n}\n\nJob posting:\n${jobText}\n\nCandidate resume (markdown):\n${candidate.text.slice(12000)}\n\nCandidate metadata (if available):\n${JSON.stringify(candidate.meta)}`;

  const body = {
    model: 'google/gemini-2.5-flash-lite',
    messages: [
      { role: 'system', content: 'You are a precise evaluator who follows the JSON-only response requirement.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2
  };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim() || '';
  const parsed = extractJSON(content);
  
  // Clamp all scores
  const clampAll = (obj) => {
    if (typeof obj === 'number') return clampScore(obj);
    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = clampAll(v);
      }
      return result;
    }
    return obj;
  };
  
  const clamped = clampAll(parsed);
  
  return {
    skills: clamped.skills || {},
    portfolio_quality: clamped.portfolio_quality || { score: 3, reasoning: 'Not assessed' },
    rate_fit: clamped.rate_fit || { score: 3, reasoning: 'Not assessed' },
    overall_reasoning: String(clamped.overall_reasoning || ''),
    strengths: Array.isArray(clamped.strengths) ? clamped.strengths : [],
    gaps: Array.isArray(clamped.gaps) ? clamped.gaps : [],
    notes: String(clamped.notes || '')
  };
}

function calculateWeightedTotal(candidate) {
  let total = 0;
  total += (candidate.skills['UX/UI Craft']?.score || 3) * WEIGHTS['Design Craft'];
  total += (candidate.skills['Design Systems']?.score || candidate.skills['User Research']?.score || 3) * WEIGHTS['Systems Thinking'];
  total += (candidate.skills['AI/ML Products']?.score || 3) * WEIGHTS['AI Products'];
  total += (candidate.skills['Collaboration']?.score || 3) * WEIGHTS['Collaboration'];
  total += (candidate.portfolio_quality?.score || 3) * WEIGHTS['Portfolio Quality'];
  total += (candidate.rate_fit?.score || 3) * WEIGHTS['Rate Fit'];
  return total.toFixed(1);
}

async function main() {
  const candidates = fs.readdirSync(candidatesDir)
    .filter(f => f.toLowerCase().endsWith('.md'))
    .map(loadCandidate);

  const scored = [];
  for (const candidate of candidates) {
    // Skip internal Ganttsy emails (Cian and team)
    const candidateEmail = candidate.meta.email || '';
    if (isInternalEmail(candidateEmail)) {
      console.log(`Skipping internal email: ${candidateEmail}`);
      continue;
    }

    // Portfolio-only submissions need manual review
    if (candidate.file.includes('_PORTFOLIO')) {
      const fromMatch = candidate.text.match(/\*\*From:\*\* (.+)/);
      const urlMatches = candidate.text.match(/https?:\/\/[^\s]+/g);
      // Show ALL URLs found in the email - even truncated ones
      // User wants to see raw URLs to manually review them
      const portfolioUrls = urlMatches || [];
      
      scored.push({
        name: sanitizeName(candidate.meta.name || (fromMatch ? fromMatch[1] : 'Portfolio Only')),
        email: candidate.meta.email || '',
        rate: candidate.meta.rate || '',
        experience: 'Portfolio-only - Manual review needed',
        skills: {},
        portfolio_quality: { score: 5, reasoning: 'Portfolio link available - manual review required' },
        rate_fit: { score: 3, reasoning: 'Rate not specified' },
        overall_reasoning: 'Portfolio-only submission. Manual review required.',
        strengths: ['Has portfolio links - manual review needed'],
        gaps: ['No attached resume to score automatically'],
        notes: `Portfolio URLs:\n${portfolioUrls.join('\n')}`,
        portfolioUrls: portfolioUrls, // Store for easy access
        file: candidate.file,
        isPortfolioOnly: true,
        submitted: candidate.submitted
      });
      continue;
    }

    // Auto-fail candidates with no attachment
    if (candidate.file.includes('NO_ATTACHMENT')) {
      const fromMatch = candidate.text.match(/\*\*From:\*\* (.+)/);
      const subjectMatch = candidate.text.match(/\*\*Subject:\*\* (.+)/);
      scored.push({
        name: fromMatch ? fromMatch[1] : 'No Attachment',
        email: '',
        rate: '',
        experience: subjectMatch ? subjectMatch[1] : 'No resume attached',
        skills: {},
        portfolio_quality: { score: 1, reasoning: 'No attachment' },
        rate_fit: { score: 1, reasoning: 'No attachment' },
        overall_reasoning: 'Auto-failed: No resume attachment found in email',
        strengths: [],
        gaps: ['No resume attached'],
        notes: 'Auto-rejected: No resume',
        file: candidate.file,
        isPortfolioOnly: false,
        submitted: candidate.submitted
      });
      continue;
    }

    try {
      const llm = await scoreCandidate(candidate);
      scored.push({
        name: sanitizeName(candidate.meta.name || candidate.file.replace(/\.md$/i,'')),
        email: candidate.meta.email || '',
        rate: candidate.meta.rate || '',
        experience: candidate.meta.experience || '',
        skills: llm.skills,
        portfolio_quality: llm.portfolio_quality,
        rate_fit: llm.rate_fit,
        overall_reasoning: llm.overall_reasoning,
        strengths: llm.strengths,
        gaps: llm.gaps,
        notes: llm.notes,
        file: candidate.file,
        isPortfolioOnly: false,
        submitted: candidate.submitted
      });
      await new Promise(r => setTimeout(r, 250));
    } catch (err) {
      console.error(`Failed to score ${candidate.file}: ${err.message}`);
      scored.push({
        name: sanitizeName(candidate.meta.name || candidate.file.replace(/\.md$/i,'')),
        email: candidate.meta.email || '',
        rate: candidate.meta.rate || '',
        experience: candidate.meta.experience || '',
        skills: {},
        portfolio_quality: { score: 1, reasoning: 'Scoring failed' },
        rate_fit: { score: 1, reasoning: 'Scoring failed' },
        overall_reasoning: 'Scoring failed; see logs.',
        strengths: [],
        gaps: [],
        notes: `Error: ${err.message}`,
        file: candidate.file,
        isPortfolioOnly: false,
        submitted: candidate.submitted
      });
    }
  }

  // Separate portfolio-only candidates
  const portfolioOnly = scored.filter(c => c.isPortfolioOnly);
  const regularScored = scored.filter(c => !c.isPortfolioOnly);
  
  // Sort by weighted total
  regularScored.sort((a, b) => {
    const totalA = parseFloat(calculateWeightedTotal(a));
    const totalB = parseFloat(calculateWeightedTotal(b));
    return totalB - totalA;
  });

  const date = new Date().toISOString().slice(0,10);
  const roleMatch = jobText.match(/#{1,2}\s*Role[:\s]*([^\n]+)/i) || jobText.match(/\*\*Role\*\*[:\s]*([^\n]+)/i);
  const role = roleMatch ? roleMatch[1].trim() : 'Product Designer';
  
  // Get priority from job posting
  const priorityMatch = jobText.match(/Priority[:\s]*([^\n]+)/i) || jobText.match(/focus[:\s]*([^\n]+)/i);
  const priority = priorityMatch ? priorityMatch[1].trim() : 'Design craft + systems thinking > AI hype';

  // Build Quick Comparison table - no Rate column, names are clickable links
  const quickCompRows = regularScored.map(c => {
    const designCraft = Math.max(
      c.skills['UX/UI Craft']?.score || 3,
      c.skills['Prototyping']?.score || 3
    );
    const systemsThinking = Math.max(
      c.skills['Design Systems']?.score || 3,
      c.skills['User Research']?.score || 3
    );
    const aiExp = c.skills['AI/ML Products']?.score || 3;
    const portfolio = c.portfolio_quality?.score || 3;
    // Sanitize name and check for NO_ATTACHMENT
    const safeName = sanitizeName(c.name);
    const isNoAttachment = c.file.includes('_NO_ATTACHMENT');
    const candidateLink = getCandidateLink(c.file, isNoAttachment, safeName);
    const submitted = c.submitted || 'N/A';
    
    return `| **${candidateLink}** | ${submitted} | ${getEmojiRating(designCraft)} | ${getEmojiRating(systemsThinking)} | ${getEmojiRating(aiExp)} | ${getEmojiRating(portfolio)} |`;
  });

  // Build Skills Evaluation Grid - REMOVED
  // Build Scoring Summary - REMOVED
  // Build Notes section - REMOVED

  // Build Portfolio-Only section with clickable links (no fetching)
  const portfolioOnlySection = portfolioOnly.length > 0 ? `## Portfolio-Only Submissions (Manual Review)

These candidates submitted portfolio links only. Click candidate names to view submission files:

${portfolioOnly.map(c => {
  // Show URLs as plain text (not markdown links) since they may be truncated
  const links = c.portfolioUrls && c.portfolioUrls.length > 0 
    ? c.portfolioUrls.map(url => `- ${url}`).join('\n')
    : '*No portfolio links found in submission*';
  const safeName = sanitizeName(c.name);
  const candidateLink = getCandidateLink(c.file, false, safeName); // portfolio files always have links
  return `### ${candidateLink}

Submitted: ${c.submitted || 'N/A'}
${links}
`;
}).join('\n---\n\n')}

` : '';

  // Generate full markdown (simplified)
  const gridMarkdown = `# Product Designer Candidate Evaluation Grid — ${date}

**Role**: ${role}
**Priority**: ${priority}
**Baseline**: ${regularScored.length > 0 ? `Evaluated ${regularScored.length} candidate(s)` : 'None'}

---

## Quick Comparison (${regularScored.length} Candidate${regularScored.length !== 1 ? 's' : ''})

| Candidate | Submitted | Design Craft | Systems Thinking | AI Experience | Portfolio |
|-----------|-----------|--------------|------------------|---------------|-----------|
${quickCompRows.join('\n')}

${portfolioOnlySection}
`;

  // Write the evaluation grid
  fs.writeFileSync(evalGridPath, gridMarkdown);

  // Auto-commit to GitHub
  try {
    // Find git repo (could be in targetDir or parent)
    let gitDir = targetDir;
    while (gitDir !== '/' && !fs.existsSync(path.join(gitDir, '.git'))) {
      gitDir = path.dirname(gitDir);
    }
    
    if (fs.existsSync(path.join(gitDir, '.git'))) {
      process.chdir(gitDir);
      
      // Add any new/updated files in the designer-resumes directory
      const relativeTarget = path.relative(gitDir, targetDir);
      execSync(`git add ${relativeTarget}/candidates/ ${relativeTarget}/EVALUATION-GRID.md`, { stdio: 'inherit' });
      
      // Try to commit - will fail if nothing to commit
      try {
        execSync('git commit -m "Updated evaluation grid"', { stdio: 'inherit' });
        execSync('git push', { stdio: 'inherit' });
        console.log('Committed and pushed evaluation grid to GitHub');
      } catch (commitErr) {
        // No changes to commit - that's fine
        if (commitErr.message.includes('nothing to commit')) {
          console.log('No changes to commit');
        } else {
          throw commitErr;
        }
      }
    } else {
      console.log('Not a git repository, skipping commit');
    }
  } catch (err) {
    console.error('Git auto-commit failed:', err.message);
    // Don't fail the whole script if git fails
  }

  const report = {
    date,
    totalCandidates: scored.length,
    portfolioOnlyCount: portfolioOnly.length,
    top3: regularScored.slice(0, 3).map(c => ({
      name: c.name,
      weightedTotal: calculateWeightedTotal(c)
    }))
  };
  fs.writeFileSync(path.join(stateDir, 'last_report.json'), JSON.stringify(report, null, 2));

  console.log(`TOTAL_CANDIDATES=${scored.length}`);
  console.log(`PORTFOLIO_ONLY=${portfolioOnly.length}`);
  console.log(`TOP3=${JSON.stringify(report.top3)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});