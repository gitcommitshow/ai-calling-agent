/**
 * One real outbound call, end to end: dial, conversation, transcript,
 * extraction, persisted attempt. This talks to live providers and costs money,
 * so it never runs in CI. It skips itself unless E2E_TEST_NUMBER is set along
 * with the provider credentials.
 *
 * Run with: npm run test:e2e --workspace apps/server
 *
 * The server must already be reachable at PUBLIC_BASE_URL, because Plivo
 * delivers the callbacks and the audio socket to that origin.
 */
import { expect } from 'chai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, missingCallConfig } from '../src/config.ts';
import { buildCallServices } from '../src/services.ts';
import { JsonStore } from '../src/storage/json-store.ts';
import { guestIdFor, newCampaignId, newEventId } from '../src/storage/ids.ts';
import type { CampaignRecord, EventRecord, GuestRecord } from '../src/storage/types.ts';

const testNumber = process.env.E2E_TEST_NUMBER?.trim();

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

describe('one live outbound call', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'calling-agent-e2e-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('dials a test number and stores a transcript and captured fields', async function () {
    const config = { ...loadConfig(), dataDir };
    const missing = missingCallConfig(config);
    if (!testNumber || missing.length > 0) {
      console.log(`[e2e] skipped: set E2E_TEST_NUMBER and ${missing.join(', ') || 'nothing else'}`);
      this.skip();
    }

    const storage = new JsonStore(dataDir);
    const { runner, telephony } = buildCallServices(config, storage);

    const event: EventRecord = {
      id: newEventId('E2E live call'),
      name: 'E2E live call',
      startsAt: hoursFromNow(48),
      endsAt: hoursFromNow(52),
      timezone: 'Asia/Kolkata',
      lastImport: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const guest: GuestRecord = {
      id: guestIdFor({ sourceId: 'e2e-1', phone: testNumber! }),
      sourceId: 'e2e-1',
      name: 'E2E Tester',
      email: null,
      phone: testNumber!,
      approvalStatus: 'approved',
      ticketName: 'General',
      checkedInAt: null,
      registeredAt: null,
      attributes: {},
    };
    const campaign: CampaignRecord = {
      id: newCampaignId('pre-event'),
      eventId: event.id,
      type: 'pre-event',
      name: 'E2E pre-event check',
      prompt:
        'You are calling {{guest.firstName}} about {{event.name}}. Ask in one question whether they plan to attend, then thank them and end the call.',
      useMasterPrompt: false,
      language: 'en',
      fields: [
        { key: 'will_attend', label: 'Will they attend?', kind: 'enum', options: ['yes', 'no'] },
      ],
      // Wide open, because the test runs whenever the operator runs it.
      callingWindow: { start: '00:00', end: '23:59', timezone: 'Asia/Kolkata' },
      retryCap: 1,
      voiceBackendOrder: ['elevenlabs'],
      queue: [guest.id],
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };

    await storage.putEvent(event);
    await storage.replaceGuests(event.id, [guest]);
    await storage.putCampaign(campaign);

    const run = await runner.startRun(campaign, { kind: 'single', guestIds: [guest.id] });
    for (let waited = 0; waited < 150; waited += 1) {
      const latest = await storage.getRun(event.id, run.id);
      if (latest && latest.status !== 'running' && latest.status !== 'stopping') break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await telephony.close();

    const [attempt] = await storage.listAttempts(event.id);
    expect(attempt, 'the call produced no attempt').to.not.equal(undefined);
    expect(attempt!.status).to.equal('done');
    expect(attempt!.outcome).to.equal('answered');
    expect(attempt!.transcript.length, 'the call produced no transcript').to.be.greaterThan(0);
    expect(Object.keys(attempt!.capturedFields)).to.deep.equal(['will_attend']);
  });
});
