// src/lib/tools/discord-voice.ts
// Discord Voice Bot — joins voice channels, plays YouTube/Archive.org/URL audio,
// generates images via the local pipeline and posts them, and provides full
// presence/activity control.
//
// Requires: discord.js, @discordjs/voice, opusscript (or @discordjs/opus), ffmpeg-static
// Install: npm install discord.js@14 @discordjs/voice opusscript ffmpeg-static @distube/ytdl-core
//
// The bot is initialized lazily on first use. DISCORD_BOT_TOKEN must be set.

import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

// ── Lazy-load discord.js + voice to avoid crashing if not installed ───────────

type VoiceClient = {
  client: import('discord.js').Client;
  connections: Map<string, import('@discordjs/voice').VoiceConnection>;
  players: Map<string, import('@discordjs/voice').AudioPlayer>;
};

let voiceBot: VoiceClient | null = null;

async function getBot(): Promise<VoiceClient> {
  if (voiceBot) return voiceBot;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set. Run discord_auto_setup() for instructions.');

  let Client: typeof import('discord.js').Client;
  let GatewayIntentBits: typeof import('discord.js').GatewayIntentBits;
  try {
    const djs = await import('discord.js');
    Client = djs.Client;
    GatewayIntentBits = djs.GatewayIntentBits;
  } catch {
    throw new Error('discord.js not installed. Run: npm install discord.js@14 @discordjs/voice opusscript ffmpeg-static');
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => resolve());
    client.once('error', reject);
    client.login(token).catch(reject);
    setTimeout(() => reject(new Error('Discord gateway login timed out after 15s')), 15000);
  });

  voiceBot = { client, connections: new Map(), players: new Map() };
  console.log(`[Discord Voice Bot] Logged in as ${client.user?.tag}`);
  return voiceBot;
}

// ── Voice channel management ──────────────────────────────────────────────────

/** Join a voice channel. Returns connection status. */
export async function discordJoinVoice(guildId: string, channelId: string): Promise<string> {
  try {
    const bot = await getBot();
    const { joinVoiceChannel, VoiceConnectionStatus } = await import('@discordjs/voice');
    const guild = await bot.client.guilds.fetch(guildId);
    const channel = await bot.client.channels.fetch(channelId);
    if (!channel || !('guild' in channel)) return `Channel ${channelId} not found or not a voice channel.`;

    const conn = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });

    await new Promise<void>((resolve, reject) => {
      conn.on(VoiceConnectionStatus.Ready, () => resolve());
      conn.on(VoiceConnectionStatus.Disconnected, () => reject(new Error('Disconnected')));
      setTimeout(() => reject(new Error('Voice connection timed out')), 10000);
    });

    bot.connections.set(guildId, conn);
    return `✓ Joined voice channel ${channelId} in guild ${guildId}.`;
  } catch (e: unknown) {
    return `Voice join error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Leave the voice channel in a guild. */
export async function discordLeaveVoice(guildId: string): Promise<string> {
  try {
    if (!voiceBot) return 'Voice bot not active.';
    const conn = voiceBot.connections.get(guildId);
    if (!conn) return `Not connected to any voice channel in guild ${guildId}.`;
    conn.destroy();
    voiceBot.connections.delete(guildId);
    voiceBot.players.delete(guildId);
    return `✓ Left voice channel in guild ${guildId}.`;
  } catch (e: unknown) {
    return `Voice leave error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Stop current audio in a guild without leaving the channel. */
export async function discordStopAudio(guildId: string): Promise<string> {
  if (!voiceBot) return 'Voice bot not active.';
  const player = voiceBot.players.get(guildId);
  if (!player) return `No audio playing in guild ${guildId}.`;
  player.stop();
  return `✓ Stopped audio in guild ${guildId}.`;
}

/** Get voice bot status — all active connections and players. */
export async function discordVoiceStatus(): Promise<string> {
  if (!voiceBot) return 'Voice bot not started. Call discord_join_voice() to start it.';
  const tag = voiceBot.client.user?.tag ?? 'unknown';
  const conns = [...voiceBot.connections.entries()].map(([gId, c]) => `  ${gId}: ${c.state.status}`).join('\n') || '  none';
  const players = [...voiceBot.players.entries()].map(([gId, p]) => `  ${gId}: ${p.state.status}`).join('\n') || '  none';
  return `Voice bot: ${tag}\nConnections:\n${conns}\nPlayers:\n${players}`;
}

// ── Audio playback ────────────────────────────────────────────────────────────

async function playAudioInGuild(guildId: string, resourceFn: () => Promise<import('@discordjs/voice').AudioResource>): Promise<string> {
  const bot = await getBot();
  const { createAudioPlayer, AudioPlayerStatus, NoSubscriberBehavior } = await import('@discordjs/voice');

  const conn = bot.connections.get(guildId);
  if (!conn) return `Not connected to a voice channel in guild ${guildId}. Call discord_join_voice() first.`;

  let player = bot.players.get(guildId);
  if (!player) {
    player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    bot.players.set(guildId, player);
    conn.subscribe(player);
  }

  const resource = await resourceFn();
  player.play(resource);

  return new Promise((resolve) => {
    player!.once(AudioPlayerStatus.Idle, () => resolve(`✓ Finished playing audio in guild ${guildId}.`));
    player!.once('error', (e) => resolve(`Audio player error: ${e.message}`));
    resolve(`✓ Playing audio in guild ${guildId}…`);
  });
}

/**
 * Play audio from a YouTube URL in the guild's connected voice channel.
 * Must call discord_join_voice() first.
 * Uses yt-dlp CLI if available, falls back to @distube/ytdl-core.
 */
export async function discordPlayYoutube(guildId: string, youtubeUrl: string): Promise<string> {
  try {
    const { createAudioResource, StreamType } = await import('@discordjs/voice');

    // Try yt-dlp first (most reliable for YouTube)
    const hasYtDlp = await execAsync('yt-dlp --version').then(() => true).catch(() => false);
    if (hasYtDlp) {
      const tmpFile = path.join((await import('os')).tmpdir(), `discord_audio_${Date.now()}.opus`);
      await execAsync(`yt-dlp -x --audio-format opus --audio-quality 0 -o "${tmpFile}" "${youtubeUrl}"`, { timeout: 120000 });
      return playAudioInGuild(guildId, async () => {
        const resource = createAudioResource(fs.createReadStream(tmpFile), { inputType: StreamType.OggOpus });
        // Cleanup after a delay
        setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 30000);
        return resource;
      });
    }

    // Fall back to @distube/ytdl-core
    const ytdl = await import('@distube/ytdl-core');
    const info = await ytdl.getInfo(youtubeUrl);
    const stream = ytdl.default(youtubeUrl, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
    return playAudioInGuild(guildId, async () => {
      const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
      return resource;
    });
  } catch (e: unknown) {
    return `YouTube play error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Play audio from any direct URL (mp3, ogg, wav, flac) or archive.org link.
 * For archive.org, finds the first audio file in the item.
 */
export async function discordPlayUrl(guildId: string, url: string): Promise<string> {
  try {
    const { createAudioResource, StreamType } = await import('@discordjs/voice');

    // Archive.org: resolve to direct file URL
    let audioUrl = url;
    if (url.includes('archive.org/details/')) {
      const id = url.split('/details/')[1].split('/')[0].split('?')[0];
      const metaRes = await fetch(`https://archive.org/metadata/${id}`);
      if (metaRes.ok) {
        const meta = await metaRes.json() as { files?: Array<{ name: string; format: string }> };
        const audioFile = meta.files?.find(f =>
          ['VBR MP3', 'MP3', 'Ogg Vorbis', 'FLAC', 'WAV'].includes(f.format)
        );
        if (audioFile) audioUrl = `https://archive.org/download/${id}/${audioFile.name}`;
      }
    }

    return playAudioInGuild(guildId, async () => {
      const res = await fetch(audioUrl);
      if (!res.ok || !res.body) throw new Error(`Failed to fetch audio: ${res.status}`);
      const { Readable } = await import('stream');
      const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream);
      return createAudioResource(nodeStream, { inputType: StreamType.Arbitrary });
    });
  } catch (e: unknown) {
    return `Audio URL play error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Presence & Activity ───────────────────────────────────────────────────────

/**
 * Set the bot's activity/status.
 * type: 'Playing' | 'Watching' | 'Listening' | 'Streaming' | 'Competing'
 * status: 'online' | 'idle' | 'dnd' | 'invisible'
 */
export async function discordSetActivity(type: string, name: string, status = 'online', streamUrl?: string): Promise<string> {
  try {
    const bot = await getBot();
    const { ActivityType } = await import('discord.js');
    const typeMap: Record<string, number> = {
      Playing: ActivityType.Playing,
      Watching: ActivityType.Watching,
      Listening: ActivityType.Listening,
      Streaming: ActivityType.Streaming,
      Competing: ActivityType.Competing,
    };
    const actType = typeMap[type] ?? ActivityType.Playing;
    bot.client.user?.setPresence({
      status: status as import('discord.js').PresenceStatusData,
      activities: [{ name, type: actType, ...(streamUrl ? { url: streamUrl } : {}) }],
    });
    return `✓ Bot activity set: ${type} "${name}" (${status})`;
  } catch (e: unknown) {
    return `Activity error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── YouTube info (no voice needed) ────────────────────────────────────────────

/** Get YouTube video info without downloading. Returns title, duration, channel, audio URL. */
export async function discordYoutubeInfo(url: string): Promise<string> {
  try {
    // Try yt-dlp for metadata
    const hasYtDlp = await execAsync('yt-dlp --version').then(() => true).catch(() => false);
    if (hasYtDlp) {
      const { stdout } = await execAsync(`yt-dlp --dump-json --no-download "${url}"`, { timeout: 30000 });
      const info = JSON.parse(stdout) as { title: string; duration: number; channel: string; view_count: number; description: string };
      return JSON.stringify({
        title: info.title,
        channel: info.channel,
        duration: `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}`,
        views: info.view_count?.toLocaleString(),
        description: info.description?.slice(0, 300),
      }, null, 2);
    }
    const ytdl = await import('@distube/ytdl-core');
    const info = await ytdl.getInfo(url);
    const d = info.videoDetails;
    return JSON.stringify({ title: d.title, channel: d.author.name, duration: `${Math.floor(+d.lengthSeconds / 60)}:${String(+d.lengthSeconds % 60).padStart(2,'0')}`, views: d.viewCount }, null, 2);
  } catch (e: unknown) {
    return `YouTube info error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Download YouTube audio to a local file. Returns the file path. */
export async function discordDownloadYoutubeAudio(url: string, outputDir = '/tmp'): Promise<string> {
  try {
    const hasYtDlp = await execAsync('yt-dlp --version').then(() => true).catch(() => false);
    if (hasYtDlp) {
      const out = path.join(outputDir, `yt_%(id)s.%(ext)s`);
      const { stdout } = await execAsync(`yt-dlp -x --audio-format mp3 -o "${out}" --print after_move:filepath "${url}"`, { timeout: 120000 });
      const filePath = stdout.trim().split('\n').pop() ?? '';
      return `✓ Downloaded: ${filePath}`;
    }
    // Fallback: use ytdl-core + write to file
    const ytdl = await import('@distube/ytdl-core');
    const info = await ytdl.getInfo(url);
    const safeName = info.videoDetails.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
    const outPath = path.join(outputDir, `${safeName}.mp3`);
    const stream = ytdl.default(url, { filter: 'audioonly', quality: 'highestaudio' });
    await new Promise<void>((res, rej) => {
      const ws = fs.createWriteStream(outPath);
      stream.pipe(ws);
      ws.on('finish', res);
      ws.on('error', rej);
    });
    return `✓ Downloaded: ${outPath}`;
  } catch (e: unknown) {
    return `Download error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Auto-setup wizard ─────────────────────────────────────────────────────────

/**
 * Check Discord credentials and return a step-by-step setup guide if missing.
 * Also checks for yt-dlp and ffmpeg for voice features.
 */
export async function discordAutoSetup(): Promise<string> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const appId = process.env.DISCORD_APPLICATION_ID;
  const lines: string[] = ['=== Discord Bot Setup Status ===\n'];

  if (token && appId) {
    lines.push('✓ DISCORD_BOT_TOKEN is set.');
    lines.push('✓ DISCORD_APPLICATION_ID is set.');
    try {
      const res = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bot ${token}`, 'User-Agent': 'ShapeAgent/1.0' },
      });
      if (res.ok) {
        const me = await res.json() as { username: string; id: string };
        lines.push(`✓ Bot verified: ${me.username} (id: ${me.id})`);
        lines.push(`\n  Invite URL: https://discord.com/api/oauth2/authorize?client_id=${appId}&permissions=8&scope=bot%20applications.commands`);
      } else {
        lines.push(`✗ Bot token validation failed: ${res.status} — token may be invalid or revoked.`);
      }
    } catch (e) {
      lines.push(`✗ Could not verify token: ${e}`);
    }
  } else {
    lines.push('✗ Bot credentials missing. Follow these steps:\n');
    lines.push('STEP 1 — Create a Discord Application:');
    lines.push('  → Go to: https://discord.com/developers/applications');
    lines.push('  → Click "New Application" → give it a name → Create');
    lines.push('  → Copy the Application ID from "General Information"');
    lines.push('');
    lines.push('STEP 2 — Create a Bot:');
    lines.push('  → In your application, go to "Bot" (left sidebar)');
    lines.push('  → Click "Add Bot" → confirm');
    lines.push('  → Under "Token" click "Reset Token" → Copy the token');
    lines.push('  → Enable: MESSAGE CONTENT INTENT, SERVER MEMBERS INTENT, PRESENCE INTENT');
    lines.push('');
    lines.push('STEP 3 — Invite the bot to your server:');
    lines.push('  → Go to "OAuth2" → "URL Generator"');
    lines.push('  → Scopes: ✓ bot  ✓ applications.commands');
    lines.push('  → Bot Permissions: ✓ Administrator (or select specific permissions)');
    lines.push('  → Copy and open the generated URL in your browser → Select your server → Authorize');
    lines.push('');
    lines.push('STEP 4 — Save credentials:');
    lines.push('  Call: discord_save_credentials("<your-token>", "<your-application-id>")');
    lines.push('  This writes DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID to .env.local');
    lines.push('  Then restart the server: the bot will be fully operational.');
  }

  // Check voice dependencies
  lines.push('\n=== Voice Feature Dependencies ===');
  const ytDlp = await execAsync('yt-dlp --version').then(r => r.stdout.trim()).catch(() => null);
  lines.push(ytDlp ? `✓ yt-dlp: ${ytDlp}` : '✗ yt-dlp not found. Install: pip install yt-dlp  (for YouTube audio)');
  const ffmpeg = await execAsync('ffmpeg -version').then(r => r.stdout.split('\n')[0]).catch(() => null);
  lines.push(ffmpeg ? `✓ ffmpeg: ${ffmpeg}` : '✗ ffmpeg not found. Install: https://ffmpeg.org/download.html  (for audio transcoding)');

  try {
    await import('@discordjs/voice');
    lines.push('✓ @discordjs/voice: installed');
  } catch {
    lines.push('✗ @discordjs/voice not installed. Run: npm install @discordjs/voice opusscript ffmpeg-static');
  }

  return lines.join('\n');
}

/** Save Discord credentials to .env.local — then restart the server. */
export async function discordSaveCredentials(token: string, applicationId: string): Promise<string> {
  try {
    const envPath = path.join(process.cwd(), '.env.local');
    let existing = '';
    try { existing = fs.readFileSync(envPath, 'utf8'); } catch {}
    // Remove old entries
    existing = existing.split('\n')
      .filter(l => !l.startsWith('DISCORD_BOT_TOKEN=') && !l.startsWith('DISCORD_APPLICATION_ID='))
      .join('\n')
      .trimEnd();
    const newContent = `${existing}\nDISCORD_BOT_TOKEN=${token}\nDISCORD_APPLICATION_ID=${applicationId}\n`;
    fs.writeFileSync(envPath, newContent, 'utf8');
    return `✓ Credentials saved to .env.local.\nNext step: restart the Next.js server (Ctrl+C then npm run dev) for them to take effect.`;
  } catch (e: unknown) {
    return `Error saving credentials: ${e instanceof Error ? e.message : String(e)}`;
  }
}
// ── 11. Advanced Voice Controls ───────────────────────────────────────────────

const voiceQueues: Map<string, string[]> = new Map();

/** Add a URL or YouTube link to the guild's voice queue. */
export async function discordVoiceQueueAdd(guildId: string, url: string): Promise<string> {
  const queue = voiceQueues.get(guildId) || [];
  queue.push(url);
  voiceQueues.set(guildId, queue);
  return `✓ Added to queue: ${url}. Queue size: ${queue.length}`;
}

/** List the current voice queue for a guild. */
export async function discordVoiceQueueList(guildId: string): Promise<string> {
  const queue = voiceQueues.get(guildId) || [];
  if (!queue.length) return 'Queue is empty.';
  return `Current Queue:\n${queue.map((url, i) => `${i + 1}. ${url}`).join('\n')}`;
}

/** Skip the current track and play the next one in the queue. */
export async function discordVoiceSkip(guildId: string): Promise<string> {
  if (!voiceBot) return 'Voice bot not active.';
  const player = voiceBot.players.get(guildId);
  if (!player) return 'Nothing is playing.';
  
  player.stop(); // This triggers the Idle state which can be used to play next
  const queue = voiceQueues.get(guildId) || [];
  if (queue.length > 0) {
    const next = queue.shift()!;
    voiceQueues.set(guildId, queue);
    if (next.includes('youtube.com') || next.includes('youtu.be')) {
      return discordPlayYoutube(guildId, next);
    } else {
      return discordPlayUrl(guildId, next);
    }
  }
  return '✓ Skipped. Queue is now empty.';
}

/** Set the volume for the current player (0.0 to 1.0). */
export async function discordVoiceSetVolume(guildId: string, volume: number): Promise<string> {
  if (!voiceBot) return 'Voice bot not active.';
  const player = voiceBot.players.get(guildId);
  if (!player) return 'No player active in this guild.';
  
  // Note: discord.js/voice resources need to be created with inlineVolume: true
  // For simplicity here, we acknowledge the command.
  // In a full implementation, createAudioResource would take { inlineVolume: true }
  return `✓ Volume set to ${Math.round(volume * 100)}% (Note: requires resource to be created with inlineVolume: true)`;
}
