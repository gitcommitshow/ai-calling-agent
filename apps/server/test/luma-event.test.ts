/**
 * Luma page import. No live Luma requests: the HTML is a fixture, and the
 * duplicate check uses a temporary store.
 */
import { rejects } from 'node:assert/strict';
import { expect } from 'chai';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importLumaEvent, parseLumaHtml, refreshLumaEvent } from '../src/luma/page.ts';
import { JsonStore } from '../src/storage/json-store.ts';

const HTML = `<!doctype html>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"initialData":{"data":{
  "event": {
    "api_id": "evt-abc",
    "name": "Design dinner",
    "start_at": "2026-10-10T13:30:00.000Z",
    "end_at": "2026-10-10T16:30:00.000Z",
    "timezone": "Asia/Kolkata",
    "location_type": "offline",
    "geo_address_info": {"full_address": "Studio 4, Bandra"},
    "description": ""
  },
  "description_mirror": {
    "type": "doc",
    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A dinner for the design team."}]}]
  }
}}}}}
</script>`;

describe('luma event page', () => {
  it('reads the name, time, description, and place from the page', () => {
    const draft = parseLumaHtml(HTML);
    expect(draft.name).to.equal('Design dinner');
    expect(draft.startsAt).to.equal('2026-10-10T13:30:00.000Z');
    expect(draft.endsAt).to.equal('2026-10-10T16:30:00.000Z');
    expect(draft.timezone).to.equal('Asia/Kolkata');
    expect(draft.brief.about).to.equal('A dinner for the design team.');
    expect(draft.brief.where).to.equal('Studio 4, Bandra');
  });

  it('refuses a link that is not a Luma page', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'calling-agent-luma-'));
    try {
      const store = new JsonStore(dataDir);
      await rejects(
        () => importLumaEvent(store, 'https://example.com/design-dinner', async () => HTML),
        { message: 'That link is not a Luma event page.' },
      );
      expect(await store.listEvents()).to.have.length(0);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('opens the existing event for the same link, and a later check updates the name', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'calling-agent-luma-'));
    let fetches = 0;
    const load = async () => {
      fetches += 1;
      return HTML;
    };
    try {
      const store = new JsonStore(dataDir);
      const first = await importLumaEvent(store, 'https://lu.ma/design-dinner?utm=1', load);
      const second = await importLumaEvent(store, 'https://www.luma.com/design-dinner/', load);

      expect(first.created).to.equal(true);
      expect(second.created).to.equal(false);
      expect(second.event.id).to.equal(first.event.id);
      expect(fetches).to.equal(1);
      expect(await store.listEvents()).to.have.length(1);

      const saved = await store.getEvent(first.event.id);
      if (!saved) throw new Error('imported event was not stored');
      await store.putEvent({
        ...saved,
        brief: { ...saved.brief, notes: 'VIP guests use the side door.' },
      });

      const updated = HTML.replace('Design dinner', 'Design supper');
      const refreshed = await refreshLumaEvent(store, first.event.id, async () => updated);
      expect(refreshed.name).to.equal('Design supper');
      expect(refreshed.brief.about).to.equal('A dinner for the design team.');
      expect(refreshed.brief.notes).to.equal('VIP guests use the side door.');
      expect(refreshed.id).to.equal(first.event.id);
      expect((await store.listEvents())[0]?.name).to.equal('Design supper');
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
