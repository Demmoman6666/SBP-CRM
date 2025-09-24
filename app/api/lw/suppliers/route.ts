import { NextResponse } from 'next/server';
import { getLW } from '@/lib/linnworks';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { token, host } = await getLW();
  const r = await fetch(`https://${host}/api/Inventory/GetSuppliers`, {
    headers: { Authorization: token },
  });
  return NextResponse.json(await r.json());
}
