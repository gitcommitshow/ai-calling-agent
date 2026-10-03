/**
 * Agent hangup for the browser. Forwards to the server, which reads and writes
 * the ElevenLabs End call tool. The body is validated again there.
 */
import { NextResponse } from 'next/server';
import { ServerApiError, updateVoiceHangup } from '../../../../lib/server-api';

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { enabled: boolean; description: string };
    const voiceHangup = await updateVoiceHangup(body);
    return NextResponse.json({ voiceHangup });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
