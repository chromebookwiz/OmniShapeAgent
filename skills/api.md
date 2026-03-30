# API Design & HTTP Skill

## ShapeAgent API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent` | Run the agent loop |
| GET | `/api/models` | Discover Ollama + vLLM models |
| GET/POST/DELETE | `/api/chats` | Chat persistence |
| GET | `/api/memory` | Memory/graph stats |
| POST | `/api/telegram` | Telegram webhook |
| POST | `/api/email` | Email webhook |

## Using http_request

```
# GET request
http_request("https://api.example.com/data", "GET")

# POST with JSON body
http_request(
  "https://api.example.com/items",
  "POST",
  '{"Content-Type":"application/json","Authorization":"Bearer sk-xxx"}',
  '{"name":"item","value":42}'
)

# PUT with custom headers
http_request(
  "https://api.example.com/items/123",
  "PUT",
  '{"Authorization":"Bearer sk-xxx","X-Custom":"header"}',
  '{"name":"updated"}'
)

# DELETE
http_request("https://api.example.com/items/123", "DELETE")
```

## Adding New API Routes

```typescript
// src/app/api/newroute/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  return NextResponse.json({ status: 'ok' });
}

export async function POST(req: Request) {
  const body = await req.json();
  // process body...
  return NextResponse.json({ result: 'done' });
}
```

## Webhook Integration

### Telegram
```
telegram_provision("BOT_TOKEN", "https://your-domain.com")
```

### Email (Mailgun)
Configure in `.env.local`:
```
MAILGUN_API_KEY=key-xxx
MAILGUN_DOMAIN=mg.yourdomain.com
AGENT_EMAIL_FROM=agent@yourdomain.com
```

Then configure Mailgun's inbound webhook to point to:
`https://your-domain.com/api/email`

## REST Design Principles

1. **Use HTTP methods correctly**: GET=read, POST=create, PUT=replace, PATCH=update, DELETE=remove
2. **Return appropriate status codes**: 200=ok, 201=created, 400=bad request, 404=not found, 500=server error
3. **Always validate input** at API boundaries
4. **Return consistent shapes** — always include error field on failure

## Testing API Endpoints

```
# Test ShapeAgent's own APIs
http_request("http://localhost:3000/api/models", "GET")
http_request("http://localhost:3000/api/memory", "GET")

# Test agent endpoint
http_request(
  "http://localhost:3000/api/agent",
  "POST",
  '{"Content-Type":"application/json"}',
  '{"message":"hello","model":"ollama:llama3","history":[]}'
)
```
