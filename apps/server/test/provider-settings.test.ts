/**
 * Org settings for the model and provider choice. No live third-party services.
 */
import { expect } from 'chai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOrgSettingsInput } from '../src/api/validate.ts';
import { writeJsonAtomic } from '../src/storage/atomic.ts';
import { JsonStore } from '../src/storage/json-store.ts';
import { defaultOrgSettings } from '../src/storage/settings.ts';

function settingsBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { updatedAt, ...body } = defaultOrgSettings('2026-09-27T10:00:00.000Z');
  return { ...body, ...overrides };
}

describe('provider settings', () => {
  it('accepts an extraction model and the voice and telephony providers', () => {
    const parsed = parseOrgSettingsInput(
      settingsBody({
        extraction: { provider: 'openai', model: 'gpt-4o-mini' },
        voiceProvider: 'fake',
        telephonyProvider: 'fake',
      }),
    );

    expect(parsed.extraction).to.deep.equal({ provider: 'openai', model: 'gpt-4o-mini' });
    expect(parsed.voiceProvider).to.equal('fake');
    expect(parsed.telephonyProvider).to.equal('fake');
  });

  it('rejects an extraction provider that is not a slug', () => {
    expect(() =>
      parseOrgSettingsInput(
        settingsBody({ extraction: { provider: 'OpenAI', model: 'gpt-4o-mini' } }),
      ),
    ).to.throw(/extraction.provider/);
  });

  it('uses seeds when an older settings file omitted the choice, and keeps a later save', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'calling-agent-providers-'));
    try {
      await writeJsonAtomic(join(dataDir, 'settings.json'), {
        masterPrompts: {
          'pre-event': 'pre',
          'post-event': 'post',
        },
        contextFields: ['event.name'],
        testNumber: null,
        updatedAt: '2026-09-27T10:00:00.000Z',
      });
      const store = new JsonStore(dataDir, {
        extraction: { provider: 'openai', model: 'gpt-4o-mini' },
        voiceProvider: 'fake',
        telephonyProvider: 'fake',
      });

      const loaded = await store.getSettings();
      expect(loaded.agentPersonality).to.equal(defaultOrgSettings().agentPersonality);
      expect(loaded.extraction).to.deep.equal({ provider: 'openai', model: 'gpt-4o-mini' });
      expect(loaded.voiceProvider).to.equal('fake');
      expect(loaded.telephonyProvider).to.equal('fake');

      await store.putSettings({
        ...loaded,
        extraction: { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
        voiceProvider: 'elevenlabs',
        telephonyProvider: 'plivo',
      });
      const saved = await store.getSettings();
      expect(saved.extraction).to.deep.equal({
        provider: 'anthropic',
        model: 'claude-3-5-haiku-latest',
      });
      expect(saved.voiceProvider).to.equal('elevenlabs');
      expect(saved.telephonyProvider).to.equal('plivo');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
