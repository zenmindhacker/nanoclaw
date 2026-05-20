import { describe, expect, it, vi } from 'vitest';

import { isTranscribableAudioAttachment, transcribeAudioBuffer } from './transcription.js';

describe('isTranscribableAudioAttachment', () => {
  it('detects Slack and generic audio attachments', () => {
    expect(isTranscribableAudioAttachment({ type: 'voice' })).toBe(true);
    expect(isTranscribableAudioAttachment({ mimeType: 'audio/mp4' })).toBe(true);
    expect(isTranscribableAudioAttachment({ name: 'audio_message.m4a' })).toBe(true);
  });

  it('does not treat arbitrary files as audio', () => {
    expect(isTranscribableAudioAttachment({ mimeType: 'application/pdf', name: 'report.pdf' })).toBe(false);
  });
});

describe('transcribeAudioBuffer', () => {
  it('uses OpenRouter STT JSON payload when an OpenRouter key is configured', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init ?? {}]);
      return new Response(JSON.stringify({ text: 'hello from audio' }));
    });

    const result = await transcribeAudioBuffer(Buffer.from('audio'), {
      filename: 'voice.m4a',
      mimeType: 'audio/mp4',
      openRouterApiKey: 'or-key',
      fetchImpl,
    });

    expect(result).toBe('[Voice message]: hello from audio');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer or-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const body = JSON.parse(calls[0][1].body as string);
    expect(body).toMatchObject({
      model: 'openai/gpt-4o-mini-transcribe',
      input_audio: { format: 'm4a' },
    });
    expect(body.input_audio.data).toBe(Buffer.from('audio').toString('base64'));
  });

  it('returns a clear fallback when no STT key is available', async () => {
    const result = await transcribeAudioBuffer(Buffer.from('audio'), {
      openRouterApiKey: '',
      openAiApiKey: '',
    });

    expect(result).toContain('transcription unavailable');
  });
});
