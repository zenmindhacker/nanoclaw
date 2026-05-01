/**
 * Slack media handling — voice transcription and image pass-through.
 * Extracted from slack.ts for cleaner upstream merges and separation of concerns.
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';

/**
 * Download a Slack-hosted audio file and transcribe it via OpenAI Whisper.
 * Returns a formatted transcript string or a fallback message.
 */
export async function transcribeSlackAudio(
  fileUrl: string,
): Promise<string | null> {
  const env = readEnvFile(['OPENAI_API_KEY', 'SLACK_BOT_TOKEN']);
  const openaiKey = env.OPENAI_API_KEY;
  const botToken = env.SLACK_BOT_TOKEN;

  if (!openaiKey) {
    logger.warn('OPENAI_API_KEY not set — cannot transcribe voice message');
    return '[Voice message — transcription unavailable: set OPENAI_API_KEY in .env]';
  }

  try {
    // Download the audio file using the bot token for auth
    const downloadRes = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!downloadRes.ok) {
      throw new Error(`Slack download failed: ${downloadRes.status}`);
    }
    const audioBuffer = Buffer.from(await downloadRes.arrayBuffer());

    // Determine a reasonable file extension for Whisper
    // Slack voice memos are typically M4A wrapped in a MP4 container
    const ext = fileUrl.includes('.')
      ? fileUrl.split('.').pop()!.split('?')[0]
      : 'mp4';

    // Send to OpenAI Whisper
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    formData.append('file', blob, `voice.${ext}`);
    formData.append('model', 'whisper-1');

    const whisperRes = await fetch(
      'https://api.openai.com/v1/audio/transcriptions',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: formData,
      },
    );

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      throw new Error(`Whisper API error ${whisperRes.status}: ${errText}`);
    }

    const result = (await whisperRes.json()) as { text: string };
    logger.info({ fileUrl }, 'Voice message transcribed');
    return `[Voice message]: ${result.text}`;
  } catch (err) {
    logger.error({ fileUrl, err }, 'Failed to transcribe voice message');
    return '[Voice message — transcription failed]';
  }
}

/**
 * Download a Slack-hosted image and save it to the IPC directory so the agent can
 * read it via the Read tool (which supports multimodal image content).
 * Returns the container-visible path (e.g. /workspace/ipc/images/foo.jpg) or null on error.
 */
export async function downloadSlackImage(
  fileUrl: string,
  filename: string,
  groupFolder: string,
): Promise<string | null> {
  const env = readEnvFile(['SLACK_BOT_TOKEN']);
  const botToken = env.SLACK_BOT_TOKEN;

  try {
    const downloadRes = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!downloadRes.ok) {
      throw new Error(`Slack image download failed: ${downloadRes.status}`);
    }
    const imageBuffer = Buffer.from(await downloadRes.arrayBuffer());

    // Save to the group's IPC images dir — mounted into the container at /workspace/ipc/
    const imagesDir = path.join(DATA_DIR, 'ipc', groupFolder, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    // Sanitize filename: keep only safe characters
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destFilename = `${Date.now()}-${safe}`;
    const destPath = path.join(imagesDir, destFilename);
    fs.writeFileSync(destPath, imageBuffer);

    logger.info({ fileUrl, destPath }, 'Slack image saved for agent analysis');
    // Return the container-visible path
    return `/workspace/ipc/images/${destFilename}`;
  } catch (err) {
    logger.error({ fileUrl, err }, 'Failed to download Slack image');
    return null;
  }
}

/**
 * Download a generic Slack-hosted file (PDFs, documents, etc.) and save it to the
 * IPC directory so the agent can read it. Returns the container-visible path or null.
 */
export async function downloadSlackFile(
  fileUrl: string,
  filename: string,
  groupFolder: string,
): Promise<string | null> {
  const env = readEnvFile(['SLACK_BOT_TOKEN']);
  const botToken = env.SLACK_BOT_TOKEN;

  try {
    const downloadRes = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    if (!downloadRes.ok) {
      throw new Error(`Slack file download failed: ${downloadRes.status}`);
    }
    const fileBuffer = Buffer.from(await downloadRes.arrayBuffer());

    const filesDir = path.join(DATA_DIR, 'ipc', groupFolder, 'files');
    fs.mkdirSync(filesDir, { recursive: true });

    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destFilename = `${Date.now()}-${safe}`;
    const destPath = path.join(filesDir, destFilename);
    fs.writeFileSync(destPath, fileBuffer);

    logger.info({ fileUrl, destPath }, 'Slack file saved for agent');
    return `/workspace/ipc/files/${destFilename}`;
  } catch (err) {
    logger.error({ fileUrl, err }, 'Failed to download Slack file');
    return null;
  }
}
