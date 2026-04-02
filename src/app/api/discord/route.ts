import { NextResponse } from 'next/server';

const BASE = 'https://discord.com/api/v10';

export async function GET() {
  const token = process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.DISCORD_APPLICATION_ID;

  if (!token) {
    return NextResponse.json({
      status: 'offline',
      message: 'DISCORD_BOT_TOKEN not configured',
      inviteUrl: appId
        ? `https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=2048&scope=bot%20applications.commands`
        : null,
    });
  }

  try {
    const res = await fetch(`${BASE}/users/@me`, {
      headers: {
        Authorization: `Bot ${token}`,
        'User-Agent': 'ShapeAgent/1.0',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ status: 'error', message: text }, { status: 502 });
    }
    const me = await res.json() as { username: string; id: string; discriminator: string };
    const id = appId ?? me.id;
    return NextResponse.json({
      status: 'online',
      bot: `${me.username}#${me.discriminator}`,
      botId: me.id,
      inviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${id}&permissions=2048&scope=bot%20applications.commands`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ status: 'error', message: msg }, { status: 500 });
  }
}
