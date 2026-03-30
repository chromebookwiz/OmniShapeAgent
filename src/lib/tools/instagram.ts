// src/lib/tools/instagram.ts
// Instagram Graph API tools using only Node.js built-in https module.

import * as https from 'https';

const GRAPH_API_BASE = 'graph.facebook.com';
const GRAPH_API_VERSION = 'v20.0';

// ---------------------------------------------------------------------------
// Internal HTTPS helpers
// ---------------------------------------------------------------------------

function httpsGet(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: GRAPH_API_BASE, path, headers: { 'User-Agent': 'e8-agent/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function httpsPost(path: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, 'utf8');
    const options = {
      hostname: GRAPH_API_BASE,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': bodyBuf.length,
        'User-Agent': 'e8-agent/1.0',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyBuf);
    req.end();
  });
}

function buildQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

// ---------------------------------------------------------------------------
// Get the Instagram Business Account ID linked to the access token
// ---------------------------------------------------------------------------
async function getInstagramAccountId(accessToken: string): Promise<string> {
  const qs = buildQuery({ access_token: accessToken, fields: 'instagram_business_account' });
  const raw = await httpsGet(`/${GRAPH_API_VERSION}/me/accounts?${qs}`);
  const data = JSON.parse(raw) as {
    data?: Array<{ instagram_business_account?: { id: string } }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(`Graph API error: ${data.error.message}`);
  const account = data.data?.[0]?.instagram_business_account;
  if (!account) throw new Error('No Instagram Business Account linked to this token.');
  return account.id;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Creates a media container and publishes it to Instagram.
 */
export async function instagramPost(
  accessToken: string,
  imageUrl: string,
  caption: string
): Promise<string> {
  const igUserId = await getInstagramAccountId(accessToken);

  // Step 1: Create media container
  const createBody = JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken });
  const createRaw = await httpsPost(`/${GRAPH_API_VERSION}/${igUserId}/media`, createBody);
  const createData = JSON.parse(createRaw) as { id?: string; error?: { message: string } };
  if (createData.error) throw new Error(`Failed to create media container: ${createData.error.message}`);
  const creationId = createData.id;
  if (!creationId) throw new Error('No creation ID returned from media container step.');

  // Step 2: Publish
  const publishBody = JSON.stringify({ creation_id: creationId, access_token: accessToken });
  const publishRaw = await httpsPost(`/${GRAPH_API_VERSION}/${igUserId}/media_publish`, publishBody);
  const publishData = JSON.parse(publishRaw) as { id?: string; error?: { message: string } };
  if (publishData.error) throw new Error(`Failed to publish media: ${publishData.error.message}`);

  return JSON.stringify({
    success: true,
    mediaId: publishData.id,
    message: 'Post published successfully.',
  });
}

/**
 * Gets account profile info: username, followers, post count.
 */
export async function instagramGetProfile(accessToken: string): Promise<string> {
  const igUserId = await getInstagramAccountId(accessToken);
  const fields = 'username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website';
  const qs = buildQuery({ fields, access_token: accessToken });
  const raw = await httpsGet(`/${GRAPH_API_VERSION}/${igUserId}?${qs}`);
  const data = JSON.parse(raw) as {
    username?: string;
    name?: string;
    biography?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    profile_picture_url?: string;
    website?: string;
    error?: { message: string };
  };
  if (data.error) throw new Error(`Graph API error: ${data.error.message}`);
  return JSON.stringify(data);
}

/**
 * Gets recent posts with engagement metrics.
 */
export async function instagramGetPosts(accessToken: string, limit = 10): Promise<string> {
  const igUserId = await getInstagramAccountId(accessToken);
  const fields = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
  const qs = buildQuery({ fields, limit, access_token: accessToken });
  const raw = await httpsGet(`/${GRAPH_API_VERSION}/${igUserId}/media?${qs}`);
  const data = JSON.parse(raw) as {
    data?: unknown[];
    paging?: unknown;
    error?: { message: string };
  };
  if (data.error) throw new Error(`Graph API error: ${data.error.message}`);
  return JSON.stringify({ posts: data.data, paging: data.paging });
}

/**
 * Gets insights (likes, comments, reach, impressions) for a specific post.
 */
export async function instagramGetInsights(accessToken: string, mediaId: string): Promise<string> {
  const metric = 'likes,comments,reach,impressions,saved,video_views';
  const qs = buildQuery({ metric, period: 'lifetime', access_token: accessToken });
  const raw = await httpsGet(`/${GRAPH_API_VERSION}/${mediaId}/insights?${qs}`);
  const data = JSON.parse(raw) as {
    data?: Array<{ name: string; period: string; values: unknown[]; title: string; id: string }>;
    error?: { message: string };
  };
  if (data.error) throw new Error(`Graph API error: ${data.error.message}`);

  const insights: Record<string, unknown> = {};
  for (const item of data.data ?? []) {
    insights[item.name] = item.values?.[0] ?? null;
  }
  return JSON.stringify({ mediaId, insights });
}

/**
 * Schedules a post for future publishing.
 * scheduledTime: Unix timestamp (seconds) — must be between 15 min and 75 days from now.
 */
export async function instagramSchedulePost(
  accessToken: string,
  imageUrl: string,
  caption: string,
  scheduledTime: number
): Promise<string> {
  const igUserId = await getInstagramAccountId(accessToken);

  const createBody = JSON.stringify({
    image_url: imageUrl,
    caption,
    published: false,
    scheduled_publish_time: scheduledTime,
    access_token: accessToken,
  });

  const createRaw = await httpsPost(`/${GRAPH_API_VERSION}/${igUserId}/media`, createBody);
  const createData = JSON.parse(createRaw) as { id?: string; error?: { message: string } };
  if (createData.error) throw new Error(`Failed to schedule post: ${createData.error.message}`);

  return JSON.stringify({
    success: true,
    creationId: createData.id,
    scheduledTime: new Date(scheduledTime * 1000).toISOString(),
    message: 'Post scheduled successfully.',
  });
}
