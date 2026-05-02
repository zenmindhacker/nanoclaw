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
  const env = readEnvFile([
    'OPENROUTER_API_KEY',
    'OPENAI_API_KEY',
    'SLACK_BOT_TOKEN',
  ]);
  const botToken = env.SLACK_BOT_TOKEN;

  // Prefer OpenRouter (shared quota, no per-key billing limits).
  // Fall back to direct OpenAI if OR key is absent.
  const useOpenRouter = !!env.OPENROUTER_API_KEY;
  const apiKey = env.OPENROUTER_API_KEY || env.OPENAI_API_KEY;
  const whisperEndpoint = useOpenRouter
    ? 'https://openrouter.ai/api/v1/audio/transcriptions'
    : 'https://api.openai.com/v1/audio/transcriptions';
  const model = useOpenRouter ? 'openai/gpt-4o-mini-transcribe' : 'whisper-1';

  if (!apiKey) {
    logger.warn(
      'No transcription key set — set OPENROUTER_API_KEY or OPENAI_API_KEY in .env',
    );
    return '[Voice message — transcription unavailable: set OPENROUTER_API_KEY in .env]';
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

    // Determine audio format from URL for OpenRouter's input_audio.format field
    const ext = fileUrl.includes('.')
      ? fileUrl.split('.').pop()!.split('?')[0]
      : 'mp4';

    let whisperRes: Response;
    if (useOpenRouter) {
      // OpenRouter STT uses JSON + base64, not multipart/form-data
      const base64Audio = audioBuffer.toString('base64');
      whisperRes = await fetch(whisperEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          input_audio: { data: base64Audio, format: ext },
        }),
      });
    } else {
      // OpenAI direct: standard multipart/form-data
      const formData = new FormData();
      const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });
      formData.append('file', blob, `voice.${ext}`);
      formData.append('model', model);
      whisperRes = await fetch(whisperEndpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
    }

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      throw new Error(`Whisper API error ${whisperRes.status}: ${errText}`);
    }

    const result = (await whisperRes.json()) as { text: string };
    logger.info({ fileUrl, useOpenRouter }, 'Voice message transcribed');
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
