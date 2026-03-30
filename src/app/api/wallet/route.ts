import { NextRequest, NextResponse } from 'next/server';
import { generateWallet, unlockWallet, checkBalance, getPrice, listWallets } from '../../../lib/tools/crypto-wallet';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { action, coin, password, address, name } = await req.json();
  try {
    if (action === 'generate') return NextResponse.json({ result: await generateWallet(coin, password, name) });
    if (action === 'unlock') return NextResponse.json({ result: await unlockWallet(coin, password, name) });
    if (action === 'balance') return NextResponse.json({ result: await checkBalance(coin, address) });
    if (action === 'price') return NextResponse.json({ result: await getPrice(coin) });
    if (action === 'list') return NextResponse.json({ result: listWallets() });
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
