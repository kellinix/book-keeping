import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const fields: string[] = body?.fields ?? [];
    const mapping: Record<string, string> = {};
    for (const f of fields) {
      const lower = f.toLowerCase();
      if (lower.includes('date')) mapping[f] = 'Date';
      else if (lower.includes('desc') || lower.includes('narr')) mapping[f] = 'Description';
      else if (lower.includes('merchant') || lower.includes('payee')) mapping[f] = 'Merchant';
      else if (lower.includes('credit') || lower.includes('money in') || (lower.includes('in') && lower.includes('amount'))) mapping[f] = 'Money In';
      else if (lower.includes('debit') || lower.includes('money out') || (lower.includes('out') && lower.includes('amount'))) mapping[f] = 'Money Out';
      else if (lower.includes('amount')) mapping[f] = 'Amount';
      else if (lower.includes('curr') || lower.includes('currency')) mapping[f] = 'Currency';
      else mapping[f] = '';
    }
    return NextResponse.json({ mapping });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error('Suggest mapping error', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
