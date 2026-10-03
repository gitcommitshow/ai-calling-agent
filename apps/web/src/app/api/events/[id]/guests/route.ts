/**
 * Add one guest by hand. The server checks the phone against the list and
 * refuses a number that is already stored.
 */
import { NextResponse } from 'next/server';
import { addGuest, ServerApiError } from '../../../../../lib/server-api';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { name?: unknown; phone?: unknown };
    const guest = await addGuest(id, {
      name: typeof body.name === 'string' ? body.name : '',
      phone: typeof body.phone === 'string' ? body.phone : '',
    });
    return NextResponse.json({ guest }, { status: 201 });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
