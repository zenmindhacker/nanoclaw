#!/usr/bin/env node
'use strict';

/**
 * parse-resumes.cjs
 * Node replacement for parse-resumes.sh.
 * Converts PDF/DOCX files in RAW_DIR to markdown in MD_DIR,
 * extracts basic candidate info to JSON sidecar files.
 * Prints NEW_PARSED=N to stdout.
 */

const fs = require('fs');
const path = require('path');

const RAW_DIR = process.env.RAW_DIR || '/workspace/group/ganttsy-resume/candidates/raw';
const MD_DIR  = process.env.MD_DIR  || '/workspace/group/ganttsy-resume/candidates/md';

fs.mkdirSync(MD_DIR, { recursive: true });

if (!fs.existsSync(RAW_DIR)) {
  process.stderr.write(`Raw dir not found: ${RAW_DIR}\n`);
  process.exit(1);
}

async function convertPdf(filePath) {
  const pdfParse = require('pdf-parse');
  const buf = fs.readFileSync(filePath);
  const data = await pdfParse(buf);
  return data.text || '';
}

async function convertDocx(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value || '';
}

function extractInfo(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Email
  const emailMatch = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  const email = emailMatch ? emailMatch[0] : '';

  // Name — first short line that looks like two words, not the email line
  let name = '';
  for (const l of lines.slice(0, 10)) {
    if (email && l.includes(email)) continue;
    if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(l) && l.length < 60) {
      name = l;
      break;
    }
  }

  // Experience
  let experience = '';
  const expMatch = text.match(/(?:experience|work experience)\s*[:\n]+([\s\S]{0,600})/i);
  if (expMatch) {
    experience = expMatch[1].trim().split('\n').slice(0, 5).join(' ');
  } else {
    const yrsMatch = text.match(/(\d+\+?\s*years?)/i);
    experience = yrsMatch ? yrsMatch[1] : '';
  }

  // Skills
  let skills = [];
  const skMatch = text.match(/skills\s*[:\n]+([\s\S]{0,400})/i);
  if (skMatch) {
    const line = skMatch[1].trim().split('\n')[0];
    skills = line.split(/[,;/]/).map(s => s.trim()).filter(Boolean);
  }

  return { name, email, experience, skills };
}

async function main() {
  let files;
  try {
    files = fs.readdirSync(RAW_DIR);
  } catch (err) {
    process.stderr.write(`Cannot read RAW_DIR: ${err.message}\n`);
    process.exit(1);
  }

  let newCount = 0;

  for (const base of files) {
    const filePath = path.join(RAW_DIR, base);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
    } catch {
      continue;
    }

    const ext  = path.extname(base).toLowerCase().slice(1);
    const stem = path.basename(base, path.extname(base));
    const mdOut = path.join(MD_DIR, `${stem}.md`);

    if (fs.existsSync(mdOut)) continue;

    let text = '';
    try {
      if (ext === 'pdf') {
        text = await convertPdf(filePath);
      } else if (ext === 'docx' || ext === 'doc') {
        text = await convertDocx(filePath);
      } else {
        continue;
      }
    } catch (err) {
      process.stderr.write(`Failed to convert ${base}: ${err.message}\n`);
      continue;
    }

    if (!text.trim()) continue;

    fs.writeFileSync(mdOut, `# ${stem}\n\n${text}`);
    fs.writeFileSync(
      path.join(MD_DIR, `${stem}.json`),
      JSON.stringify(extractInfo(text), null, 2),
    );

    newCount++;
  }

  console.log(`NEW_PARSED=${newCount}`);
}

main().catch(err => {
  process.stderr.write(`parse-resumes fatal: ${err.message}\n`);
  process.exit(1);
});
