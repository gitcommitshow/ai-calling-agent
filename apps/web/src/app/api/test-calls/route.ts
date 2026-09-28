/**
 * Pipeline test list and start for the browser. Forwards to the server; a POST
 * may carry a phone number, which guest-call routes never do.
 */
import { NextResponse } from 'next/server';
import {
  listTestCalls,
  ServerApiError,
  startTestCall,
  type TestCallPromptSourceInput,
} from '../../../lib/server-api';

export async function GET(request: Request) {
  try {
    const eventId = new URL(request.url).searchParams.get('eventId') ?? undefined;
    const testCalls = await listTestCalls(eventId);
    return NextResponse.json({ testCalls });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      eventId?: string;
      to?: string;
      promptSource?: TestCallPromptSourceInput;
    };
    const testCall = await startTestCall(body);
    return NextResponse.json({ testCall }, { status: 202 });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
