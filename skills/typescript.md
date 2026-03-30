# TypeScript Skill

## Project Context

This is a **Next.js 16** App Router project with TypeScript strict mode.

```
src/
  app/           # Next.js routes and pages
    api/         # Server-side API routes (route.ts files)
    page.tsx     # Home page
    layout.tsx   # Root layout
  components/    # React client components ("use client")
  lib/           # Shared logic
    agent.ts     # Core agent loop
    vector-store.ts
    knowledge-graph.ts
    embeddings.ts
    scheduler.ts
    tools/       # Tool implementations
```

## Common Patterns in This Codebase

### API Route (server-side)
```typescript
// src/app/api/example/route.ts
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const param = url.searchParams.get('id');
  return NextResponse.json({ data: param });
}

export async function POST(req: Request) {
  const body = await req.json();
  return NextResponse.json({ received: body });
}
```

### Client Component
```typescript
// src/components/Example.tsx
"use client";
import { useState, useEffect } from 'react';

export default function Example() {
  const [data, setData] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/example').then(r => r.json()).then(d => setData(d.data));
  }, []);

  return <div>{data.map((item, i) => <p key={i}>{item}</p>)}</div>;
}
```

### Type-safe fetch pattern
```typescript
async function fetchData<T>(url: string): Promise<T | null> {
  try {
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) return null;
    return resp.json() as Promise<T>;
  } catch {
    return null;
  }
}
```

## TypeScript Tips

**Discriminated unions for tool results:**
```typescript
type ToolResult = { ok: true; data: string } | { ok: false; error: string };
```

**Readonly for config:**
```typescript
const CONFIG = { temperature: 0.7, maxLoops: 100 } as const;
```

**Async generator for streaming:**
```typescript
async function* streamTokens(text: string) {
  for (const word of text.split(' ')) {
    yield word + ' ';
    await new Promise(r => setTimeout(r, 50));
  }
}
```

## Checking Types
```
run_terminal_command("npx tsc --noEmit 2>&1")
run_terminal_command("npx tsc --noEmit --strict 2>&1")
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `TS2307: Cannot find module` | Wrong import path or missing types | Check path, add `@types/x` |
| `TS2339: Property does not exist` | Wrong property access | Add to interface or use `?.` |
| `TS2345: Argument of type X not assignable` | Type mismatch | Cast with `as` or fix the type |
| `TS1005: Expected ','` | Syntax error | Check brackets/braces |
