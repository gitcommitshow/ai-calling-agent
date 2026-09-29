/**
 * Convert between telephony mu-law 8 kHz frames and ElevenLabs session formats.
 * Agents default to PCM 16 kHz; query-string format flags on the signed URL
 * are ignored, so this adapter has to transcode.
 */

export type ElevenLabsAudioFormat =
  | 'ulaw_8000'
  | 'pcm_8000'
  | 'pcm_16000'
  | 'pcm_22050'
  | 'pcm_24000'
  | 'pcm_44100'
  | 'pcm_48000';

const PCM_RATES: Record<string, number> = {
  pcm_8000: 8000,
  pcm_16000: 16000,
  pcm_22050: 22050,
  pcm_24000: 24000,
  pcm_44100: 44100,
  pcm_48000: 48000,
};

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

/** Read the format ElevenLabs reported, falling back to the agent default. */
export function parseElevenLabsAudioFormat(raw: string | undefined): ElevenLabsAudioFormat {
  if (raw === 'ulaw_8000' || (raw && raw in PCM_RATES)) return raw as ElevenLabsAudioFormat;
  return 'pcm_16000';
}

/** Telephony mu-law 8 kHz -> bytes ElevenLabs expects for this session. */
export function toElevenLabs(mulaw8k: Buffer, format: ElevenLabsAudioFormat): Buffer {
  if (format === 'ulaw_8000') return mulaw8k;
  return resamplePcm16(mulawToPcm16(mulaw8k), 8000, PCM_RATES[format] ?? 16000);
}

/** ElevenLabs session bytes -> telephony mu-law 8 kHz. */
export function fromElevenLabs(frame: Buffer, format: ElevenLabsAudioFormat): Buffer {
  if (format === 'ulaw_8000') return frame;
  return pcm16ToMulaw(resamplePcm16(frame, PCM_RATES[format] ?? 16000, 8000));
}

/** ITU-T G.711 mu-law byte to a 16-bit linear PCM sample. */
function decodeMulawSample(uVal: number): number {
  const u = ~uVal & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

/** 16-bit linear PCM sample to an ITU-T G.711 mu-law byte. */
function encodeMulawSample(sample: number): number {
  let sign = 0;
  if (sample < 0) {
    sign = 0x80;
    sample = -sample;
  }
  if (sample > MULAW_CLIP) sample = MULAW_CLIP;
  sample += MULAW_BIAS;
  let exponent = 7;
  let expMask = 0x4000;
  while (exponent > 0 && (sample & expMask) === 0) {
    exponent -= 1;
    expMask >>= 1;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** Expand mu-law bytes to little-endian PCM16. */
function mulawToPcm16(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i += 1) {
    pcm.writeInt16LE(decodeMulawSample(mulaw[i]!), i * 2);
  }
  return pcm;
}

/** Compress little-endian PCM16 to mu-law bytes. */
function pcm16ToMulaw(pcm: Buffer): Buffer {
  const samples = Math.floor(pcm.length / 2);
  const mulaw = Buffer.alloc(samples);
  for (let i = 0; i < samples; i += 1) {
    mulaw[i] = encodeMulawSample(pcm.readInt16LE(i * 2));
  }
  return mulaw;
}

/** Linear-interpolate PCM16 from one sample rate to another. */
function resamplePcm16(pcm: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return pcm;
  const srcSamples = Math.floor(pcm.length / 2);
  if (srcSamples === 0) return Buffer.alloc(0);
  const dstSamples = Math.max(1, Math.round((srcSamples * toRate) / fromRate));
  const out = Buffer.alloc(dstSamples * 2);
  for (let i = 0; i < dstSamples; i += 1) {
    const srcIndex = (i * fromRate) / toRate;
    const i0 = Math.min(Math.floor(srcIndex), srcSamples - 1);
    const i1 = Math.min(i0 + 1, srcSamples - 1);
    const frac = srcIndex - i0;
    const s0 = pcm.readInt16LE(i0 * 2);
    const s1 = pcm.readInt16LE(i1 * 2);
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
  }
  return out;
}
