/**
 * Settings API for the browser. Forwards to the server; the body is validated
 * again there before anything is written.
 */
import { NextResponse } from 'next/server';
import type { OrgSettings } from '../../../domain/settings';
import { getSettings, ServerApiError, updateSettings } from '../../../lib/server-api';

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Omit<OrgSettings, 'updatedAt'>;
    const settings = await updateSettings(body);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
