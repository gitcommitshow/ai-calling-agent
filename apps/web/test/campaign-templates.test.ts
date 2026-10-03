/**
 * Unit tests for org defaults flowing into new campaign templates.
 */
import { expect } from 'chai';
import { campaignTemplates } from '../src/domain/campaign-templates';
import type { OrgSettings } from '../src/domain/settings';

const settings: Pick<OrgSettings, 'callingWindow' | 'retryCap'> = {
  callingWindow: { start: '09:00', end: '18:00', timezone: 'Asia/Kolkata' },
  retryCap: 3,
};

describe('campaignTemplates', () => {
  it('copies org calling hours and retry cap onto both default campaigns', () => {
    const [pre, post] = campaignTemplates(settings);
    expect(pre?.callingWindow).to.deep.equal(settings.callingWindow);
    expect(post?.callingWindow).to.deep.equal(settings.callingWindow);
    expect(pre?.retryCap).to.equal(3);
    expect(post?.retryCap).to.equal(3);
  });

  it('falls back to 10:00-20:00 and one attempt when settings are missing', () => {
    const [pre] = campaignTemplates();
    expect(pre?.callingWindow).to.deep.equal({
      start: '10:00',
      end: '20:00',
      timezone: 'Asia/Kolkata',
    });
    expect(pre?.retryCap).to.equal(1);
  });
});
