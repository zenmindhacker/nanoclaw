import { readEnvFile } from './env.js';
import { log } from './log.js';

const AUDIO_EXTENSIONS = new Set(['m4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'ogg', 'oga', 'wav', 'webm']);

interface TranscriptionKeys {
  openRouterApiKey?: string;
  openAiApiKey?: string;
}

interface TranscribeAudioOptions extends TranscriptionKeys {
  filename?: string;
  mimeType?: string;
  fetchImpl?: typeof fetch;
}

interface AudioAttachmentLike {
  type?: unknown;
  name?: unknown;
  filename?: unknown;
  mimeType?: unknown;
}

function extensionFromName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1]?.toLowerCase();
}

function formatFromAttachment(filename: string | undefined, mimeType: string | undefined): string {
  const ext = extensionFromName(filename);
  if (ext) return ext;
  const subtype = mimeType?.split('/')[1]?.split(';')[0]?.trim().toLowerCase();
  return subtype || 'm4a';
}

export function isTranscribableAudioAttachment(att: AudioAttachmentLike): boolean {
  const type = typeof att.type === 'string' ? att.type.toLowerCase() : '';
  const mimeType = typeof att.mimeType === 'string' ? att.mimeType.toLowerCase() : '';
  const name = typeof att.name === 'string' ? att.name : typeof att.filename === 'string' ? att.filename : undefined;
  const ext = extensionFromName(name);

  return (
    type === 'voice' ||
    type === 'audio' ||
    mimeType.startsWith('audio/') ||
    (mimeType === 'video/mp4' && (ext === 'm4a' || type === 'voice' || type === 'audio')) ||
    (ext !== undefined && AUDIO_EXTENSIONS.has(ext))
  );
}

function readTranscriptionKeys(): TranscriptionKeys {
  const env = readEnvFile(['OPENROUTER_API_KEY', 'OPENAI_API_KEY']);
  return {
    openRouterApiKey: process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY || env.OPENAI_API_KEY,
  };
}

export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  options: TranscribeAudioOptions = {},
): Promise<string> {
  const keys = {
    openRouterApiKey: options.openRouterApiKey,
    openAiApiKey: options.openAiApiKey,
  };
  if (options.openRouterApiKey === undefined && options.openAiApiKey === undefined) {
    Object.assign(keys, readTranscriptionKeys());
  }

  const apiKey = keys.openRouterApiKey || keys.openAiApiKey;
  if (!apiKey) {
    log.warn('No transcription key set; set OPENROUTER_API_KEY or OPENAI_API_KEY in .env');
    return '[Voice message - transcription unavailable: missing OPENROUTER_API_KEY or OPENAI_API_KEY]';
  }

  const useOpenRouter = !!keys.openRouterApiKey;
  const fetcher = options.fetchImpl || fetch;
  const format = formatFromAttachment(options.filename, options.mimeType);

  try {
    const response = useOpenRouter
      ? await fetcher('https://openrouter.ai/api/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'openai/gpt-4o-mini-transcribe',
            input_audio: {
              data: audioBuffer.toString('base64'),
              format,
            },
          }),
        })
      : await transcribeWithOpenAi(fetcher, apiKey, audioBuffer, format, options.mimeType);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`STT API error ${response.status}: ${body}`);
    }

    const result = (await response.json()) as { text?: unknown };
    const transcript = typeof result.text === 'string' ? result.text.trim() : '';
    if (!transcript) throw new Error('STT API returned an empty transcript');

    log.info('Voice message transcribed', { provider: useOpenRouter ? 'openrouter' : 'openai', format });
    return `[Voice message]: ${transcript}`;
  } catch (err) {
    log.error('Failed to transcribe voice message', { err, provider: useOpenRouter ? 'openrouter' : 'openai' });
    return '[Voice message - transcription failed]';
  }
}

async function transcribeWithOpenAi(
  fetcher: typeof fetch,
  apiKey: string,
  audioBuffer: Buffer,
  format: string,
  mimeType: string | undefined,
): Promise<Response> {
  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType || 'audio/mpeg' });
  formData.append('file', blob, `voice.${format}`);
  formData.append('model', 'whisper-1');

  return fetcher('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
}
