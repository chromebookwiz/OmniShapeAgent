# Instagram Skill

Use Instagram as a normal tool family, not as a special mode.

## Goal

Operate an Instagram Business account with the same discipline used for Discord automation:
- inspect the current state first
- use memory to preserve brand context, posting history, and lessons learned
- only publish or schedule when credentials, image URLs, and captions are actually ready
- record what worked and what underperformed

## Core Tools

- `instagram_get_profile(accessToken)`
- `instagram_get_posts(accessToken, limit?)`
- `instagram_get_insights(accessToken, mediaId)`
- `instagram_post(accessToken, imageUrl, caption)`
- `instagram_schedule_post(accessToken, imageUrl, caption, scheduledTime)`
- `generate_image(...)` for visual creation when needed
- `memory_store`, `memory_search`, `memory_update`, `memory_reject`, `memory_delete` for retaining campaign context and removing fixation-causing junk

## Recommended Workflow

1. Validate prerequisites.
Check that an access token exists and that the account is an Instagram Business account.

2. Inspect before acting.
Use `instagram_get_profile` and `instagram_get_posts` before drafting new content.

3. Analyze what performs.
Use `instagram_get_insights` on strong and weak posts to detect useful patterns.

4. Build the next action from evidence.
Choose one of: publish now, schedule a post, gather missing assets, or report a blocker.

5. Store durable lessons.
Save audience, timing, caption, image, and performance observations into memory with concise tags and trigger keywords.

6. Avoid fixation.
If a stale campaign idea keeps resurfacing without helping, reject or suppress that memory instead of repeating it.

## Posting Rules

- Do not post blindly.
- Do not generate images repeatedly after a successful result.
- If image hosting is missing, stop and report that exact gap.
- Prefer concise captions with a clear call to action.
- If scheduling, confirm the timestamp and intended cadence.

## Good Prompt Pattern

When asked to manage Instagram, do this:

1. inspect profile and recent posts
2. inspect insights if useful
3. decide the next best action
4. execute with tools if the prerequisites are present
5. summarize the result and store the lesson in memory