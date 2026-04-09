// src/lib/tools/discord.ts
// Discord integration — full server/channel/role/member/webhook/command management.
//
// Prerequisites:
//   DISCORD_BOT_TOKEN       — from Discord Developer Portal > Bot > Token
//   DISCORD_APPLICATION_ID  — from Discord Developer Portal > General Information
//
// The agent can own and operate a complete Discord server:
//   1. discord_create_server()       — spin up a new guild
//   2. discord_setup_agent_server()  — scaffold it with channels, roles, and webhook personas
//   3. discord_create_invite()       — create an invite link
//   4. discord_share_on_moltbook()   — post the invite so other agents can join
//
// Webhook personas let the agent send messages as different named "bots" without
// needing separate Discord applications — each webhook has its own name and avatar.

import * as https from 'https';

const BASE = 'https://discord.com/api/v10';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function botToken(): string {
  const t = process.env.DISCORD_BOT_TOKEN;
  if (!t) throw new Error('DISCORD_BOT_TOKEN not set in environment');
  return t;
}

function appId(): string {
  const id = process.env.DISCORD_APPLICATION_ID;
  if (!id) throw new Error('DISCORD_APPLICATION_ID not set in environment');
  return id;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bot ${botToken()}`,
    'Content-Type': 'application/json',
    'User-Agent': 'ShapeAgent/1.0',
  };
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = { method, headers: authHeaders() };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord ${res.status} ${method} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const get  = (path: string)              => api('GET',    path);
const post = (path: string, b: unknown)  => api('POST',   path, b);
const put  = (path: string, b?: unknown) => api('PUT',    path, b ?? {});
const patch= (path: string, b: unknown)  => api('PATCH',  path, b);
const del  = (path: string)              => api('DELETE',  path);

function fmt(obj: unknown): string {
  return JSON.stringify(obj, null, 2).slice(0, 6000);
}

// ── 1. Status & Identity ──────────────────────────────────────────────────────

/** Check if the bot token is valid; returns bot username, ID, and invite URL. */
export async function discordStatus(): Promise<string> {
  try {
    const me = await get('/users/@me') as { username: string; id: string; discriminator: string };
    const id = process.env.DISCORD_APPLICATION_ID ?? me.id;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${id}&permissions=8&scope=bot%20applications.commands`;
    return `Bot online: ${me.username}#${me.discriminator} (id: ${me.id})\nInvite URL (Administrator): ${inviteUrl}`;
  } catch (e: unknown) {
    return `Discord bot offline or token missing: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Generate the OAuth2 invite URL with Administrator permissions. */
export async function discordInviteUrl(): Promise<string> {
  const id = process.env.DISCORD_APPLICATION_ID;
  if (!id) return 'DISCORD_APPLICATION_ID not set.';
  return `https://discord.com/api/oauth2/authorize?client_id=${id}&permissions=8&scope=bot%20applications.commands`;
}

// ── 2. Server (Guild) Management ─────────────────────────────────────────────

/** List all guilds the bot belongs to. */
export async function discordListServers(): Promise<string> {
  const guilds = await get('/users/@me/guilds') as Array<{ name: string; id: string; owner: boolean }>;
  if (!guilds.length) return 'Bot is not in any servers.';
  return guilds.map(g => `${g.name} (id: ${g.id})${g.owner ? ' [owner]' : ''}`).join('\n');
}

/** Get detailed info about a guild. */
export async function discordGetServer(guildId: string): Promise<string> {
  const g = await get(`/guilds/${guildId}?with_counts=true`) as {
    name: string; id: string; description: string | null;
    approximate_member_count: number; approximate_presence_count: number;
  };
  return `${g.name} (id: ${g.id})\nDescription: ${g.description ?? 'none'}\nMembers: ${g.approximate_member_count} (${g.approximate_presence_count} online)`;
}

/**
 * Create a new Discord server owned by the bot.
 * Note: bots can only create guilds when they are in fewer than 10 guilds.
 */
export async function discordCreateServer(name: string, icon?: string): Promise<string> {
  const body: Record<string, unknown> = { name };
  if (icon) body.icon = icon; // data URI: "data:image/png;base64,..."
  const g = await post('/guilds', body) as { id: string; name: string };
  return `Server created: ${g.name} (id: ${g.id})`;
}

/** Update a guild's name or description. */
export async function discordUpdateServer(guildId: string, name?: string, description?: string): Promise<string> {
  const body: Record<string, string> = {};
  if (name) body.name = name;
  if (description !== undefined) body.description = description;
  const g = await patch(`/guilds/${guildId}`, body) as { id: string; name: string };
  return `Server updated: ${g.name} (id: ${g.id})`;
}

/**
 * Delete a guild. The bot must be the owner.
 * WARNING: irreversible — all channels, messages, and roles are lost.
 */
export async function discordDeleteServer(guildId: string): Promise<string> {
  await del(`/guilds/${guildId}`);
  return `Server ${guildId} deleted.`;
}

// ── 3. Channel Management ─────────────────────────────────────────────────────

/** List all channels in a guild, grouped by type. */
export async function discordListChannels(guildId: string): Promise<string> {
  const channels = await get(`/guilds/${guildId}/channels`) as Array<{
    type: number; name: string; id: string; parent_id: string | null; topic?: string;
  }>;
  const typeNames: Record<number, string> = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 15: 'forum' };
  return channels
    .sort((a, b) => (a.parent_id ?? '').localeCompare(b.parent_id ?? ''))
    .map(c => `[${typeNames[c.type] ?? c.type}] #${c.name} (id: ${c.id})${c.topic ? ' — ' + c.topic : ''}`)
    .join('\n') || 'No channels.';
}

/** Get info about a specific channel. */
export async function discordGetChannel(channelId: string): Promise<string> {
  const c = await get(`/channels/${channelId}`) as { name: string; id: string; type: number; topic?: string };
  return fmt(c);
}

/**
 * Create a text channel (type=0), voice channel (type=2), or category (type=4).
 * Pass categoryId to nest the channel under a category.
 */
export async function discordCreateChannel(
  guildId: string, name: string, type = 0, topic?: string, categoryId?: string, position?: number
): Promise<string> {
  const body: Record<string, unknown> = { name, type };
  if (topic) body.topic = topic;
  if (categoryId) body.parent_id = categoryId;
  if (position !== undefined) body.position = position;
  const c = await post(`/guilds/${guildId}/channels`, body) as { id: string; name: string; type: number };
  return `Channel created: #${c.name} (id: ${c.id}, type: ${c.type})`;
}

/** Update a channel's name, topic, or slowmode. */
export async function discordUpdateChannel(channelId: string, name?: string, topic?: string, slowmode?: number): Promise<string> {
  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  if (topic !== undefined) body.topic = topic;
  if (slowmode !== undefined) body.rate_limit_per_user = slowmode;
  const c = await patch(`/channels/${channelId}`, body) as { id: string; name: string };
  return `Channel updated: #${c.name} (id: ${c.id})`;
}

/** Delete a channel. */
export async function discordDeleteChannel(channelId: string): Promise<string> {
  const c = await del(`/channels/${channelId}`) as { name: string } | null;
  return `Channel deleted: ${c?.name ?? channelId}`;
}

// ── 4. Role Management ────────────────────────────────────────────────────────

/** List all roles in a guild. */
export async function discordListRoles(guildId: string): Promise<string> {
  const roles = await get(`/guilds/${guildId}/roles`) as Array<{ id: string; name: string; color: number; position: number; permissions: string }>;
  return roles
    .sort((a, b) => b.position - a.position)
    .map(r => `${r.name} (id: ${r.id}, color: #${r.color.toString(16).padStart(6, '0')})`)
    .join('\n');
}

/**
 * Create a role. color is a hex integer (e.g. 0x3498db).
 * permissions is a Discord permissions bitfield string (e.g. "8" for admin).
 * hoist=true makes the role appear separately in the member list.
 */
export async function discordCreateRole(
  guildId: string, name: string, color?: number, permissions?: string, mentionable = true, hoist = false
): Promise<string> {
  const body: Record<string, unknown> = { name, mentionable, hoist };
  if (color !== undefined) body.color = color;
  if (permissions) body.permissions = permissions;
  const r = await post(`/guilds/${guildId}/roles`, body) as { id: string; name: string };
  return `Role created: ${r.name} (id: ${r.id})`;
}

/** Update a role's name or color. */
export async function discordUpdateRole(guildId: string, roleId: string, name?: string, color?: number): Promise<string> {
  const body: Record<string, unknown> = {};
  if (name) body.name = name;
  if (color !== undefined) body.color = color;
  const r = await patch(`/guilds/${guildId}/roles/${roleId}`, body) as { id: string; name: string };
  return `Role updated: ${r.name} (id: ${r.id})`;
}

/** Delete a role. */
export async function discordDeleteRole(guildId: string, roleId: string): Promise<string> {
  await del(`/guilds/${guildId}/roles/${roleId}`);
  return `Role ${roleId} deleted.`;
}

/** Assign a role to a member. */
export async function discordAssignRole(guildId: string, userId: string, roleId: string): Promise<string> {
  await put(`/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  return `Role ${roleId} assigned to user ${userId}.`;
}

/** Remove a role from a member. */
export async function discordRemoveRole(guildId: string, userId: string, roleId: string): Promise<string> {
  await del(`/guilds/${guildId}/members/${userId}/roles/${roleId}`);
  return `Role ${roleId} removed from user ${userId}.`;
}

// ── 5. Invite Management ──────────────────────────────────────────────────────

/**
 * Create an invite for a channel.
 * maxAge: seconds until expiry (0 = never). maxUses: 0 = unlimited. temporary: kick on disconnect.
 */
export async function discordCreateInvite(
  channelId: string, maxAge = 0, maxUses = 0, temporary = false
): Promise<string> {
  const inv = await post(`/channels/${channelId}/invites`, { max_age: maxAge, max_uses: maxUses, temporary }) as { code: string; expires_at: string | null };
  return `Invite: https://discord.gg/${inv.code} (expires: ${inv.expires_at ?? 'never'}, uses: ${maxUses || 'unlimited'})`;
}

/** List all active invites for a guild. */
export async function discordListInvites(guildId: string): Promise<string> {
  const invites = await get(`/guilds/${guildId}/invites`) as Array<{
    code: string; uses: number; max_uses: number; inviter?: { username: string }; channel: { name: string };
  }>;
  if (!invites.length) return 'No active invites.';
  return invites
    .map(i => `https://discord.gg/${i.code} — #${i.channel.name} — ${i.uses}/${i.max_uses || '∞'} uses — by ${i.inviter?.username ?? 'unknown'}`)
    .join('\n');
}

/** Delete (revoke) an invite by its code. */
export async function discordDeleteInvite(code: string): Promise<string> {
  await del(`/invites/${code}`);
  return `Invite ${code} revoked.`;
}

// ── 6. Member Management ──────────────────────────────────────────────────────

/** List members in a guild (up to 1000). */
export async function discordListMembers(guildId: string, limit = 50): Promise<string> {
  const n = Math.min(1000, Math.max(1, limit));
  const members = await get(`/guilds/${guildId}/members?limit=${n}`) as Array<{
    user: { username: string; id: string };
    nick: string | null;
    roles: string[];
  }>;
  if (!members.length) return 'No members found.';
  return members
    .map(m => `${m.nick ?? m.user.username} (id: ${m.user.id}, roles: ${m.roles.length})`)
    .join('\n');
}

/** Get a specific member's details. */
export async function discordGetMember(guildId: string, userId: string): Promise<string> {
  const m = await get(`/guilds/${guildId}/members/${userId}`) as {
    user: { username: string; id: string };
    nick: string | null;
    roles: string[];
    joined_at: string;
  };
  return `${m.nick ?? m.user.username} (id: ${m.user.id})\nJoined: ${m.joined_at}\nRoles: ${m.roles.join(', ') || 'none'}`;
}

/** Kick a member from the guild. */
export async function discordKickMember(guildId: string, userId: string, reason?: string): Promise<string> {
  const headers = authHeaders();
  if (reason) (headers as Record<string, string>)['X-Audit-Log-Reason'] = encodeURIComponent(reason);
  const res = await fetch(`${BASE}/guilds/${guildId}/members/${userId}`, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 204) throw new Error(`Kick failed: ${await res.text()}`);
  return `User ${userId} kicked${reason ? ` (reason: ${reason})` : ''}.`;
}

/** Ban a member. deleteMessageSeconds: delete their recent messages (0–604800). */
export async function discordBanMember(
  guildId: string, userId: string, reason?: string, deleteMessageSeconds = 0
): Promise<string> {
  await put(`/guilds/${guildId}/bans/${userId}`, { delete_message_seconds: deleteMessageSeconds });
  return `User ${userId} banned${reason ? ` (reason: ${reason})` : ''}.`;
}

/** Lift a ban. */
export async function discordUnbanMember(guildId: string, userId: string): Promise<string> {
  await del(`/guilds/${guildId}/bans/${userId}`);
  return `User ${userId} unbanned.`;
}

// ── 7. Webhook Bot Personas ───────────────────────────────────────────────────
//
// Webhooks are the primary way to deploy multiple "bots" in a server without
// creating separate Discord applications. Each webhook has its own name and
// avatar and appears as a distinct entity in the channel.

/** Create a webhook (bot persona) in a channel. Returns the webhook URL. */
export async function discordCreateWebhook(channelId: string, name: string, avatarUrl?: string): Promise<string> {
  let avatar: string | undefined;
  if (avatarUrl) {
    // Fetch the image and convert to base64 data URI so Discord accepts it
    try {
      const r = await fetch(avatarUrl);
      const ct = r.headers.get('content-type') ?? 'image/png';
      const buf = await r.arrayBuffer();
      avatar = `data:${ct};base64,${Buffer.from(buf).toString('base64')}`;
    } catch {
      // continue without avatar if fetch fails
    }
  }
  const body: Record<string, unknown> = { name };
  if (avatar) body.avatar = avatar;
  const wh = await post(`/channels/${channelId}/webhooks`, body) as {
    id: string; name: string; token: string; channel_id: string;
  };
  const url = `https://discord.com/api/webhooks/${wh.id}/${wh.token}`;
  return `Webhook created: ${wh.name}\nURL: ${url}\nStore this URL — it is only shown once.`;
}

/** List webhooks in a channel. */
export async function discordListWebhooks(channelId: string): Promise<string> {
  const whs = await get(`/channels/${channelId}/webhooks`) as Array<{ id: string; name: string; token: string }>;
  if (!whs.length) return 'No webhooks in this channel.';
  return whs.map(w => `${w.name} (id: ${w.id}) — URL: https://discord.com/api/webhooks/${w.id}/${w.token}`).join('\n');
}

/** List all webhooks across a guild. */
export async function discordListGuildWebhooks(guildId: string): Promise<string> {
  const whs = await get(`/guilds/${guildId}/webhooks`) as Array<{ id: string; name: string; token: string; channel_id: string }>;
  if (!whs.length) return 'No webhooks in this server.';
  return whs.map(w => `${w.name} (id: ${w.id}, channel: ${w.channel_id}) — https://discord.com/api/webhooks/${w.id}/${w.token}`).join('\n');
}

/** Delete a webhook by its ID (requires bot token). */
export async function discordDeleteWebhook(webhookId: string): Promise<string> {
  await del(`/webhooks/${webhookId}`);
  return `Webhook ${webhookId} deleted.`;
}

/** Send a message through a webhook URL as a named persona. Supports embeds. */
export async function discordSendWebhook(
  webhookUrl: string,
  content: string,
  username?: string,
  avatarUrl?: string,
  embeds?: Array<{ title?: string; description?: string; color?: number; fields?: Array<{ name: string; value: string; inline?: boolean }> }>
): Promise<string> {
  const body: Record<string, unknown> = { content };
  if (username) body.username = username;
  if (avatarUrl) body.avatar_url = avatarUrl;
  if (embeds?.length) body.embeds = embeds;
  const res = await fetch(`${webhookUrl}?wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Webhook error ${res.status}: ${await res.text()}`);
  const msg = await res.json() as { id: string };
  return `Webhook message sent (id: ${msg.id})`;
}

// ── 8. Message Management ─────────────────────────────────────────────────────

/** Send a message to a channel. */
export async function discordSend(channelId: string, content: string): Promise<string> {
  const msg = await post(`/channels/${channelId}/messages`, { content }) as { id: string };
  return `Message sent (id: ${msg.id})`;
}

/** Reply to an existing message. */
export async function discordReply(channelId: string, messageId: string, content: string): Promise<string> {
  const msg = await post(`/channels/${channelId}/messages`, {
    content,
    message_reference: { message_id: messageId },
  }) as { id: string };
  return `Reply sent (id: ${msg.id})`;
}

/** Fetch recent messages from a channel. */
export async function discordGetMessages(channelId: string, limit = 20): Promise<string> {
  const n = Math.min(100, Math.max(1, limit));
  const msgs = await get(`/channels/${channelId}/messages?limit=${n}`) as Array<{
    id: string; author: { username: string; bot?: boolean }; content: string; timestamp: string;
  }>;
  if (!msgs.length) return 'No messages.';
  return msgs
    .reverse()
    .map(m => `[${m.timestamp.slice(0, 16)}] ${m.author.username}${m.author.bot ? ' [bot]' : ''}: ${m.content}`)
    .join('\n');
}

/** Edit a message sent by the bot. */
export async function discordEditMessage(channelId: string, messageId: string, content: string): Promise<string> {
  const msg = await patch(`/channels/${channelId}/messages/${messageId}`, { content }) as { id: string };
  return `Message ${msg.id} edited.`;
}

/** Delete a message. */
export async function discordDeleteMessage(channelId: string, messageId: string): Promise<string> {
  await del(`/channels/${channelId}/messages/${messageId}`);
  return `Message ${messageId} deleted.`;
}

/** Pin a message in a channel. */
export async function discordPinMessage(channelId: string, messageId: string): Promise<string> {
  await put(`/channels/${channelId}/pins/${messageId}`);
  return `Message ${messageId} pinned.`;
}

/** Add a reaction to a message. emoji can be a unicode emoji ("👍") or "name:id" for custom. */
export async function discordAddReaction(channelId: string, messageId: string, emoji: string): Promise<string> {
  const encoded = encodeURIComponent(emoji);
  await put(`/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`);
  return `Reaction ${emoji} added to message ${messageId}.`;
}

/** Send a rich embed message. color is a hex integer (e.g. 0x5865f2 for Discord blurple). */
export async function discordSendEmbed(
  channelId: string,
  title: string,
  description: string,
  color = 0x5865f2,
  fields?: Array<{ name: string; value: string; inline?: boolean }>,
  url?: string,
  footer?: string
): Promise<string> {
  const embed: Record<string, unknown> = { title, description, color };
  if (fields?.length) embed.fields = fields;
  if (url) embed.url = url;
  if (footer) embed.footer = { text: footer };
  const msg = await post(`/channels/${channelId}/messages`, { embeds: [embed] }) as { id: string };
  return `Embed sent (id: ${msg.id})`;
}

// ── 9. Thread Management ──────────────────────────────────────────────────────

/** Create a thread from an existing message. */
export async function discordCreateThread(channelId: string, messageId: string, name: string): Promise<string> {
  const t = await post(`/channels/${channelId}/messages/${messageId}/threads`, {
    name, auto_archive_duration: 1440,
  }) as { id: string; name: string };
  return `Thread created: ${t.name} (id: ${t.id})`;
}

/** Create a standalone thread (not attached to a message). type 11=public, 12=private. */
export async function discordCreateStandaloneThread(channelId: string, name: string, type = 11): Promise<string> {
  const t = await post(`/channels/${channelId}/threads`, {
    name, type, auto_archive_duration: 1440,
  }) as { id: string; name: string };
  return `Thread created: ${t.name} (id: ${t.id})`;
}

/** List all active threads in a guild. */
export async function discordListActiveThreads(guildId: string): Promise<string> {
  const res = await get(`/guilds/${guildId}/threads/active`) as { threads: Array<{ id: string; name: string; parent_id: string }> };
  if (!res.threads.length) return 'No active threads.';
  return res.threads.map(t => `${t.name} (id: ${t.id}, channel: ${t.parent_id})`).join('\n');
}

// ── 10. Slash Commands ────────────────────────────────────────────────────────

/**
 * Register a slash command on the bot.
 * Pass guildId to register it only in that guild (instant); omit for global (up to 1h propagation).
 * options: array of { name, description, type (3=string, 4=int, 5=bool), required? }
 */
export async function discordRegisterCommand(
  name: string,
  description: string,
  options?: Array<{ name: string; description: string; type: number; required?: boolean }>,
  guildId?: string
): Promise<string> {
  const id = appId();
  const path = guildId
    ? `/applications/${id}/guilds/${guildId}/commands`
    : `/applications/${id}/commands`;
  const body: Record<string, unknown> = { name, description };
  if (options?.length) body.options = options;
  const cmd = await post(path, body) as { id: string; name: string };
  return `Command /${cmd.name} registered (id: ${cmd.id})${guildId ? ` in guild ${guildId}` : ' globally'}.`;
}

/** List registered slash commands. Pass guildId for guild-specific commands. */
export async function discordListCommands(guildId?: string): Promise<string> {
  const id = appId();
  const path = guildId
    ? `/applications/${id}/guilds/${guildId}/commands`
    : `/applications/${id}/commands`;
  const cmds = await get(path) as Array<{ id: string; name: string; description: string }>;
  if (!cmds.length) return 'No commands registered.';
  return cmds.map(c => `/${c.name} — ${c.description} (id: ${c.id})`).join('\n');
}

/** Delete a slash command. */
export async function discordDeleteCommand(commandId: string, guildId?: string): Promise<string> {
  const id = appId();
  const path = guildId
    ? `/applications/${id}/guilds/${guildId}/commands/${commandId}`
    : `/applications/${id}/commands/${commandId}`;
  await del(path);
  return `Command ${commandId} deleted.`;
}

// ── 11. Full Agent Server Setup ───────────────────────────────────────────────
//
// Scaffolds a complete agent-operated Discord server in one call:
//   Categories: Info | Community | Agent Workspace | Logs
//   Channels:   #welcome, #announcements, #general, #introductions,
//               #agent-commands, #agent-thoughts, #tool-output, #errors
//   Roles:      Admin, Agent, Human, Visitor
//   Webhooks:   one per agent channel (for persona-based messaging)
//   Returns:    a structured summary with all IDs and a permanent invite link.

export async function discordSetupAgentServer(serverName: string): Promise<string> {
  // 1. Create guild
  const g = await post('/guilds', { name: serverName }) as { id: string; name: string };
  const gId = g.id;

  // Small delay to let Discord propagate the new guild
  await new Promise(r => setTimeout(r, 1500));

  // 2. List existing channels so we know the default ones to clean up / work with
  const existingChannels = await get(`/guilds/${gId}/channels`) as Array<{ id: string; name: string; type: number }>;
  const defaultGeneral = existingChannels.find(c => c.name === 'general' && c.type === 0);

  // 3. Create categories
  const mkCat = async (name: string, pos: number) => {
    const c = await post(`/guilds/${gId}/channels`, { name, type: 4, position: pos }) as { id: string };
    return c.id;
  };
  const catInfo      = await mkCat('📋 Info', 0);
  const catCommunity = await mkCat('💬 Community', 1);
  const catAgent     = await mkCat('🤖 Agent Workspace', 2);
  const catLogs      = await mkCat('📊 Logs', 3);

  // 4. Create channels
  const mkCh = async (name: string, topic: string, catId: string) => {
    const c = await post(`/guilds/${gId}/channels`, { name, type: 0, topic, parent_id: catId }) as { id: string };
    return c.id;
  };

  const chWelcome   = await mkCh('welcome',        'Welcome to the server. Read the rules.',                catInfo);
  const chAnnounce  = await mkCh('announcements',  'Server announcements and updates.',                     catInfo);
  const chGeneral   = await mkCh('general',        'General discussion.',                                   catCommunity);
  const chIntros    = await mkCh('introductions',  'Introduce yourself here.',                              catCommunity);
  const chCmds      = await mkCh('agent-commands', 'Issue commands to the agent.',                          catAgent);
  const chThoughts  = await mkCh('agent-thoughts', 'The agent narrates its reasoning here.',               catAgent);
  const chTools     = await mkCh('tool-output',    'Raw output from tool calls.',                           catLogs);
  const chErrors    = await mkCh('errors',         'Errors and warnings from agent runs.',                  catLogs);

  // Delete the default 'general' if we created our own
  if (defaultGeneral) {
    try { await del(`/channels/${defaultGeneral.id}`); } catch { /* ignore */ }
  }

  // 5. Create roles
  const mkRole = async (name: string, color: number, permissions: string, hoist = false) => {
    const r = await post(`/guilds/${gId}/roles`, { name, color, permissions, hoist, mentionable: true }) as { id: string };
    return r.id;
  };
  const roleAdmin   = await mkRole('Admin',   0xe74c3c, '8',    true);  // Administrator
  const roleAgent   = await mkRole('Agent',   0x9b59b6, '3072', true);  // Send Messages + Read History
  const roleHuman   = await mkRole('Human',   0x3498db, '3072', false);
  const roleVisitor = await mkRole('Visitor', 0x95a5a6, '1024', false); // Read Messages only

  // 6. Create webhook personas for agent channels
  const webhooks: Record<string, string> = {};
  const mkWh = async (channelId: string, name: string): Promise<string> => {
    try {
      const wh = await post(`/channels/${channelId}/webhooks`, { name }) as { id: string; token: string };
      return `https://discord.com/api/webhooks/${wh.id}/${wh.token}`;
    } catch {
      return 'webhook_creation_failed';
    }
  };
  webhooks['agent-thoughts'] = await mkWh(chThoughts, 'ShapeAgent');
  webhooks['tool-output']    = await mkWh(chTools, 'ToolRunner');
  webhooks['errors']         = await mkWh(chErrors, 'ErrorWatcher');
  webhooks['announcements']  = await mkWh(chAnnounce, 'Announcer');

  // 7. Register core slash commands
  try {
    const aid = process.env.DISCORD_APPLICATION_ID;
    if (aid) {
      await post(`/applications/${aid}/guilds/${gId}/commands`, {
        name: 'ask', description: 'Ask the agent a question',
        options: [{ name: 'prompt', description: 'Your question or task', type: 3, required: true }],
      });
      await post(`/applications/${aid}/guilds/${gId}/commands`, {
        name: 'status', description: 'Get agent status and current mode',
      });
    }
  } catch { /* slash commands are optional */ }

  // 8. Create a permanent invite
  const inv = await post(`/channels/${chGeneral}/invites`, { max_age: 0, max_uses: 0 }) as { code: string };
  const inviteUrl = `https://discord.gg/${inv.code}`;

  // 9. Post a welcome embed
  try {
    await post(`/channels/${chWelcome}/messages`, {
      embeds: [{
        title: `Welcome to ${serverName}`,
        description: `This server is operated by **ShapeAgent**, an autonomous AI.\n\nUse <#${chCmds}> to issue commands. Watch <#${chThoughts}> to see the agent reason in real time.`,
        color: 0x9b59b6,
        fields: [
          { name: 'Agent Commands', value: `<#${chCmds}>`, inline: true },
          { name: 'Agent Thoughts', value: `<#${chThoughts}>`, inline: true },
          { name: 'Invite Link', value: inviteUrl, inline: false },
        ],
        footer: { text: 'Powered by ShapeAgent' },
      }],
    });
  } catch { /* welcome embed is optional */ }

  return JSON.stringify({
    guildId: gId,
    name: serverName,
    inviteUrl,
    categories: { catInfo, catCommunity, catAgent, catLogs },
    channels: { chWelcome, chAnnounce, chGeneral, chIntros, chCmds, chThoughts, chTools, chErrors },
    roles: { roleAdmin, roleAgent, roleHuman, roleVisitor },
    webhooks,
    slashCommands: ['/ask', '/status'],
    note: 'Server ready. Share inviteUrl on Moltbook with discord_share_on_moltbook().',
  }, null, 2);
}

// ── 12. Moltbook Integration ──────────────────────────────────────────────────
//
// Post the server invite to Moltbook so other agents browsing the feed can join.

export async function discordShareOnMoltbook(
  inviteUrl: string,
  serverName: string,
  description = 'An agent-operated Discord server. All are welcome.'
): Promise<string> {
  const key = process.env.MOLTBOOK_API_KEY;
  if (!key) return 'MOLTBOOK_API_KEY not set — register on Moltbook first with moltbook_register().';

  const body = JSON.stringify({
    submolt: 'agents',
    title: `Join my Discord: ${serverName}`,
    content: `${description}\n\n**Invite:** ${inviteUrl}`,
    url: inviteUrl,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.moltbook.com',
      path: '/api/v1/posts',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'User-Agent': 'ShapeAgent/1.0',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.success === false
            ? `Moltbook error: ${parsed.error}`
            : `Posted to Moltbook. Invite URL: ${inviteUrl}`
          );
        } catch {
          resolve(`Moltbook response: ${data}`);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Moltbook request timed out')); });
    req.write(body);
    req.end();
  });
}

// ── File & Image Uploads ──────────────────────────────────────────────────────

/**
 * Upload a local file to a Discord channel as an attachment.
 * Supports images, audio, video, text — any file type Discord accepts (max 25MB free, 500MB boosted).
 */
export async function discordUploadFile(channelId: string, filepath: string, content?: string): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  const absPath = path.default.isAbsolute(filepath)
    ? filepath
    : path.default.resolve(/*turbopackIgnore: true*/ process.cwd(), filepath);
  if (!fs.default.existsSync(absPath)) return `File not found: ${filepath}`;
  const fileBuffer = fs.default.readFileSync(absPath);
  const filename = path.default.basename(absPath);
  const token = botToken();

  const formData = new FormData();
  if (content) formData.append('payload_json', JSON.stringify({ content }));
  formData.append('files[0]', new Blob([fileBuffer]), filename);

  const res = await fetch(`${BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'ShapeAgent/1.0' },
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload failed ${res.status}: ${await res.text()}`);
  const msg = await res.json() as { id: string };
  return `✓ File '${filename}' uploaded to channel ${channelId} (message id: ${msg.id})`;
}

/**
 * Generate an image using the local pipeline and post it directly to a Discord channel.
 * Calls the /api/agent endpoint to trigger the generate_image tool, then uploads the result.
 */
export async function discordPostGeneratedImage(
  channelId: string, prompt: string, width = 512, height = 512
): Promise<string> {
  try {
    // Use the agent API to generate the image
    const res = await fetch('http://localhost:3000/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `generate_image("${prompt.replace(/"/g, '\\"')}", ${width}, ${height})`,
        history: [],
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Image gen API error: ${res.status}`);
    const data = await res.json() as { reply?: string };
    const reply = data.reply ?? '';

    // Extract file path from the reply (generate_image returns a path like /tmp/generated_*.png)
    const pathMatch = reply.match(/([^\s"']+\.(png|jpg|jpeg|webp|gif))/i);
    if (pathMatch) {
      return discordUploadFile(channelId, pathMatch[1], `**${prompt}**`);
    }

    // If a base64 data URL is returned, decode and upload
    const b64Match = reply.match(/data:image\/(\w+);base64,([A-Za-z0-9+/=]+)/);
    if (b64Match) {
      const path = await import('path');
      const fs = await import('fs');
      const os = await import('os');
      const ext = b64Match[1];
      const tmpPath = path.default.join(os.default.tmpdir(), `discord_img_${Date.now()}.${ext}`);
      fs.default.writeFileSync(tmpPath, Buffer.from(b64Match[2], 'base64'));
      const result = await discordUploadFile(channelId, tmpPath, `**${prompt}**`);
      fs.default.unlinkSync(tmpPath);
      return result;
    }

    return `Image generated but could not extract file path. Agent reply: ${reply.slice(0, 500)}`;
  } catch (e: unknown) {
    return `Image gen + post error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── YouTube / Archive.org to text channel ────────────────────────────────────

/**
 * Download audio from a YouTube URL and post it to a text channel as an attachment.
 * For voice channel playback, use discord_play_youtube() after discord_join_voice().
 * Requires yt-dlp: pip install yt-dlp
 */
export async function discordPostYoutubeAudio(channelId: string, youtubeUrl: string): Promise<string> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const os = await import('os');
  const path = await import('path');
  const execAsync = promisify(exec);
  const tmpDir = os.default.tmpdir();
  const outTemplate = path.default.join(tmpDir, `discord_yt_%(id)s.%(ext)s`);

  try {
    // Try yt-dlp
    await execAsync('yt-dlp --version');
    const { stdout } = await execAsync(
      `yt-dlp -x --audio-format mp3 --audio-quality 5 -o "${outTemplate}" --print after_move:filepath "${youtubeUrl}"`,
      { timeout: 120000 }
    );
    const filePath = stdout.trim().split('\n').pop() ?? '';
    if (!filePath) return 'yt-dlp ran but no output file path returned.';
    const result = await discordUploadFile(channelId, filePath, `🎵 ${youtubeUrl}`);
    // Cleanup
    try { (await import('fs')).default.unlinkSync(filePath); } catch {}
    return result;
  } catch (ytErr) {
    if (String(ytErr).includes('yt-dlp')) {
      return `yt-dlp not found. Install it with: pip install yt-dlp\nThen call discord_post_youtube_audio() again.`;
    }
    return `YouTube audio download failed: ${ytErr}`;
  }
}

/**
 * Fetch an audio or video file from archive.org and post it to a Discord channel.
 * Pass either a /details/ URL or a direct file URL.
 */
export async function discordPostArchiveMedia(channelId: string, archiveUrl: string): Promise<string> {
  try {
    let directUrl = archiveUrl;
    // Resolve /details/ pages to direct file URL
    if (archiveUrl.includes('/details/')) {
      const id = archiveUrl.split('/details/')[1].split('/')[0].split('?')[0];
      const metaRes = await fetch(`https://archive.org/metadata/${id}`);
      if (!metaRes.ok) return `Could not fetch archive.org metadata for id: ${id}`;
      const meta = await metaRes.json() as { files?: Array<{ name: string; format: string; size?: string }> };
      const preferred = ['VBR MP3', 'MP3', 'Ogg Vorbis', 'FLAC', '128Kbps MP3', '64Kbps MP3'];
      const file = preferred.reduce<{ name: string; format: string; size?: string } | undefined>(
        (found, fmt) => found ?? meta.files?.find(f => f.format === fmt),
        undefined
      ) ?? meta.files?.find(f => /\.(mp3|ogg|flac|wav|mp4|webm)$/i.test(f.name));
      if (!file) return `No audio/video files found for archive.org item: ${id}`;
      directUrl = `https://archive.org/download/${id}/${file.name}`;
    }

    // Download to temp file then upload
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmpPath = path.default.join(os.default.tmpdir(), `archive_${Date.now()}${path.default.extname(directUrl) || '.mp3'}`);
    const res = await fetch(directUrl);
    if (!res.ok || !res.body) return `Failed to download from archive.org: ${res.status}`;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.default.writeFileSync(tmpPath, buf);
    const result = await discordUploadFile(channelId, tmpPath, `📼 ${directUrl}`);
    fs.default.unlinkSync(tmpPath);
    return result;
  } catch (e: unknown) {
    return `Archive.org media post error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Direct Messages ───────────────────────────────────────────────────────────

/** Send a DM to a user by their user ID. */
export async function discordSendDM(userId: string, content: string): Promise<string> {
  // Open DM channel first
  const dm = await post(`/users/@me/channels`, { recipient_id: userId }) as { id: string };
  const msg = await post(`/channels/${dm.id}/messages`, { content }) as { id: string };
  return `✓ DM sent to user ${userId} (message id: ${msg.id})`;
}

// ── Message Moderation ────────────────────────────────────────────────────────

/** Bulk delete up to 100 recent messages from a channel. */
export async function discordBulkDelete(channelId: string, count: number): Promise<string> {
  const n = Math.min(100, Math.max(2, count));
  const msgs = await get(`/channels/${channelId}/messages?limit=${n}`) as Array<{ id: string }>;
  if (msgs.length < 2) return 'Need at least 2 messages to bulk delete.';
  await post(`/channels/${channelId}/messages/bulk-delete`, { messages: msgs.map(m => m.id) });
  return `✓ Bulk deleted ${msgs.length} messages from channel ${channelId}.`;
}

/** Edit a channel's permissions for a role or user. */
export async function discordSetChannelPermission(
  channelId: string, targetId: string, type: 'role' | 'member',
  allow: string, deny: string
): Promise<string> {
  await put(`/channels/${channelId}/permissions/${targetId}`, {
    type: type === 'role' ? 0 : 1, allow, deny,
  });
  return `✓ Permissions set on channel ${channelId} for ${targetId}.`;
}

// ── Server Statistics ─────────────────────────────────────────────────────────

/** Get comprehensive statistics for a guild. */
export async function discordGetServerStats(guildId: string): Promise<string> {
  const [g, channels, roles, emojis] = await Promise.all([
    get(`/guilds/${guildId}?with_counts=true`) as Promise<{
      name: string; id: string; member_count: number; approximate_member_count: number;
      approximate_presence_count: number; description: string | null;
      premium_tier: number; premium_subscription_count: number;
      features: string[]; icon: string | null;
    }>,
    get(`/guilds/${guildId}/channels`) as Promise<Array<{ type: number }>>,
    get(`/guilds/${guildId}/roles`) as Promise<Array<{ id: string }>>,
    get(`/guilds/${guildId}/emojis`) as Promise<Array<{ id: string }>>,
  ]);
  const typeCounts = channels.reduce((acc: Record<number, number>, c) => { acc[c.type] = (acc[c.type] ?? 0) + 1; return acc; }, {});
  return [
    `${g.name} (${g.id})`,
    `Members: ${g.approximate_member_count} (${g.approximate_presence_count} online)`,
    `Channels: ${typeCounts[0] ?? 0} text, ${typeCounts[2] ?? 0} voice, ${typeCounts[4] ?? 0} categories`,
    `Roles: ${roles.length} | Emojis: ${emojis.length}`,
    `Boost Level: ${g.premium_tier} (${g.premium_subscription_count} boosts)`,
    `Description: ${g.description ?? 'none'}`,
    `Features: ${g.features.join(', ') || 'none'}`,
  ].join('\n');
}

/** Search recent messages in a channel for a query string. */
export async function discordSearchMessages(channelId: string, query: string, limit = 20): Promise<string> {
  const msgs = await get(`/channels/${channelId}/messages?limit=100`) as Array<{
    id: string; author: { username: string }; content: string; timestamp: string;
  }>;
  const results = msgs.filter(m => m.content.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
  if (!results.length) return `No messages containing '${query}' found.`;
  return results.map(m => `[${m.timestamp.slice(0, 16)}] ${m.author.username}: ${m.content}`).join('\n');
}

/** Get the audit log for a guild (last 50 entries). */
export async function discordGetAuditLog(guildId: string, limit = 20): Promise<string> {
  const log = await get(`/guilds/${guildId}/audit-logs?limit=${Math.min(50, limit)}`) as {
    audit_log_entries: Array<{ id: string; action_type: number; user_id: string; target_id: string; reason?: string; changes?: unknown[] }>;
    users: Array<{ id: string; username: string }>;
  };
  const userMap = new Map(log.users.map(u => [u.id, u.username]));
  return log.audit_log_entries.map(e =>
    `[${e.action_type}] ${userMap.get(e.user_id) ?? e.user_id} → target: ${e.target_id}${e.reason ? ` | reason: ${e.reason}` : ''}`
  ).join('\n') || 'No audit log entries.';
}
// ── 13. Advanced Moderation ──────────────────────────────────────────────────

/** Timeout a member (prevent them from talking/reacting) for a duration in seconds. */
export async function discordTimeoutMember(guildId: string, userId: string, durationSeconds: number, reason?: string): Promise<string> {
  const communication_disabled_until = new Date(Date.now() + durationSeconds * 1000).toISOString();
  await api('PATCH', `/guilds/${guildId}/members/${userId}`, { communication_disabled_until });
  return `User ${userId} timed out for ${durationSeconds}s${reason ? ` (reason: ${reason})` : ''}.`;
}

/** Remove timeout from a member. */
export async function discordRemoveTimeout(guildId: string, userId: string): Promise<string> {
  await api('PATCH', `/guilds/${guildId}/members/${userId}`, { communication_disabled_until: null });
  return `Timeout removed from user ${userId}.`;
}

/** Lock a channel by denying @everyone SEND_MESSAGES permission. */
export async function discordLockChannel(channelId: string, guildId: string, reason?: string): Promise<string> {
  // @everyone role has same ID as guildId
  await api('PUT', `/channels/${channelId}/permissions/${guildId}`, {
    type: 0,
    allow: '0',
    deny: '2048', // SEND_MESSAGES bit
  });
  return `Channel ${channelId} locked${reason ? ` (reason: ${reason})` : ''}.`;
}

/** Unlock a channel by resetting @everyone SEND_MESSAGES permission. */
export async function discordUnlockChannel(channelId: string, guildId: string): Promise<string> {
  await api('PUT', `/channels/${channelId}/permissions/${guildId}`, {
    type: 0,
    allow: '2048',
    deny: '0',
  });
  return `Channel ${channelId} unlocked.`;
}

// ── 14. Server Utility ────────────────────────────────────────────────────────

/** Create a poll with up to 10 options using reactions. */
export async function discordCreatePoll(channelId: string, question: string, options: string[]): Promise<string> {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  let content = `**POLL: ${question}**\n\n`;
  const pollOptions = options.slice(0, 10);
  pollOptions.forEach((opt, idx) => {
    content += `${emojis[idx]} ${opt}\n`;
  });
  
  const msg = await api('POST', `/channels/${channelId}/messages`, { content }) as { id: string };
  for (let i = 0; i < pollOptions.length; i++) {
    await api('PUT', `/channels/${channelId}/messages/${msg.id}/reactions/${encodeURIComponent(emojis[i])}/@me`);
  }
  return `Poll created (id: ${msg.id})`;
}

/** Get detailed info about a user. */
export async function discordGetUserInfo(userId: string): Promise<string> {
  const u = await api('GET', `/users/${userId}`) as {
    username: string; id: string; discriminator: string; avatar: string | null; bot?: boolean;
    banner?: string; accent_color?: number;
  };
  return [
    `User: ${u.username}#${u.discriminator} (id: ${u.id})`,
    `Bot: ${u.bot ? 'Yes' : 'No'}`,
    `Banner Color: #${u.accent_color?.toString(16).padStart(6, '0') ?? 'none'}`,
    u.avatar ? `Avatar: https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : 'No avatar.',
  ].join('\n');
}

/** Set a role's color. color is a hex integer (e.g. 0xff0000). */
export async function discordSetRoleColor(guildId: string, roleId: string, color: number): Promise<string> {
  await api('PATCH', `/guilds/${guildId}/roles/${roleId}`, { color });
  return `Role ${roleId} color updated to #${color.toString(16).padStart(6, '0')}.`;
}

// ── 15. Engagement & Social ───────────────────────────────────────────────────

// Simulated local stores for XP and Economy
const xpStore: Record<string, number> = {};
const economyStore: Record<string, number> = {};

/** Add XP to a user (local simulation). */
export async function discordAddXP(userId: string, amount: number): Promise<string> {
  xpStore[userId] = (xpStore[userId] || 0) + amount;
  const level = Math.floor(Math.sqrt(xpStore[userId] / 100));
  return `User ${userId} gained ${amount} XP. Total: ${xpStore[userId]} (Level: ${level})`;
}

/** Get the XP leaderboard. */
export async function discordGetLeaderboard(): Promise<string> {
  const sorted = Object.entries(xpStore)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  if (!sorted.length) return 'Leaderboard is empty.';
  return sorted.map(([id, xp], idx) => `${idx + 1}. User ${id} — ${xp} XP`).join('\n');
}

/** Get a user's economy balance. */
export async function discordEconomyBalance(userId: string): Promise<string> {
  const bal = economyStore[userId] || 0;
  return `User ${userId} balance: ${bal} credits.`;
}

/** Transfer credits between users. */
export async function discordEconomyTransfer(fromId: string, toId: string, amount: number): Promise<string> {
  if ((economyStore[fromId] || 0) < amount) return 'Insufficient funds.';
  economyStore[fromId] = (economyStore[fromId] || 0) - amount;
  economyStore[toId] = (economyStore[toId] || 0) + amount;
  return `Transferred ${amount} credits from ${fromId} to ${toId}.`;
}

/** Start a giveaway. */
export async function discordGiveawayStart(channelId: string, prize: string, durationSeconds: number): Promise<string> {
  const endTs = Math.floor((Date.now() + durationSeconds * 1000) / 1000);
  const content = `🎉 **GIVEAWAY START** 🎉\n\nPrize: **${prize}**\nEnds: <t:${endTs}:R>\n\nReact with 🎉 to enter!`;
  const msg = await api('POST', `/channels/${channelId}/messages`, { content }) as { id: string };
  await api('PUT', `/channels/${channelId}/messages/${msg.id}/reactions/🎉/@me`);
  return `Giveaway started (id: ${msg.id})`;
}
