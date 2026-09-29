/**
 * Telephony mu-law to ElevenLabs PCM conversion. No live API.
 */
import { expect } from 'chai';
import {
  fromElevenLabs,
  parseElevenLabsAudioFormat,
  toElevenLabs,
} from '../src/voice/audio.ts';

describe('ElevenLabs audio conversion', () => {
  it('passes mu-law through when the session is already ulaw_8000', () => {
    const frame = Buffer.from([0xff, 0x7f, 0x00]);
    expect(toElevenLabs(frame, 'ulaw_8000')).to.equal(frame);
    expect(fromElevenLabs(frame, 'ulaw_8000')).to.equal(frame);
  });

  it('up-samples mu-law 8 kHz to the default PCM 16 kHz session format', () => {
    expect(parseElevenLabsAudioFormat(undefined)).to.equal('pcm_16000');
    const mulaw = Buffer.alloc(80, 0xff);
    const pcm = toElevenLabs(mulaw, 'pcm_16000');
    expect(pcm.length).to.equal(320);
  });

  it('round-trips silence through PCM 16 kHz back to mu-law', () => {
    const silence = Buffer.alloc(80, 0xff);
    const back = fromElevenLabs(toElevenLabs(silence, 'pcm_16000'), 'pcm_16000');
    expect(back.length).to.equal(80);
    expect(back.every((byte) => byte === 0xff)).to.equal(true);
  });
});
