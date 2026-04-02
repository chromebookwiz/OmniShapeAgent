import { NextResponse } from 'next/server';
import { runAgentLoop } from '@/lib/agent';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const {
      message, history, model, systemPrompt, temperature, synergyMode, companionModel,
      openrouterApiKey, disabledToolGroups, imagePipeline, imageModel, autoApproveTerminal,
      contextWindow, attachedImages, attachedMediaUrls,
      // Per-request URL overrides — forwarded from CLI config or web app settings
      ollamaUrl, vllmUrl,
      stream = true,
    } = await req.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    const options = {
      model,
      systemPrompt,
      temperature,
      synergyMode: (synergyMode as any) || 'off',
      companionModel,
      openrouterApiKey,
      disabledToolGroups: Array.isArray(disabledToolGroups) ? disabledToolGroups : [],
      imagePipeline: imagePipeline || undefined,
      imageModel: imageModel || undefined,
      autoApproveTerminal: autoApproveTerminal ?? false,
      contextWindow: contextWindow ? Number(contextWindow) : undefined,
      attachedImages: Array.isArray(attachedImages) ? attachedImages : undefined,
      attachedMediaUrls: Array.isArray(attachedMediaUrls) ? attachedMediaUrls : undefined,
      ollamaUrl: typeof ollamaUrl === 'string' && ollamaUrl ? ollamaUrl : undefined,
      vllmUrl:   typeof vllmUrl   === 'string' && vllmUrl   ? vllmUrl   : undefined,
    };

    if (!stream) {
      let reply = "";
      const gen = runAgentLoop(message, history || [], options);
      for await (const chunk of gen) {
        if (chunk.type === 'text') reply += chunk.content;
        else if (chunk.type === 'done') reply = chunk.content || reply;
      }
      return NextResponse.json({ reply });
    }

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        const send = (obj: object) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
        try {
          const gen = runAgentLoop(message, history || [], options);
          for await (const chunk of gen) {
            send(chunk);
          }
          controller.close();
        } catch (e: any) {
          console.error('[API Stream Error]', e);
          try {
            send({ type: 'error', content: e.message || 'Stream error' });
            controller.close();
          } catch { controller.error(e); }
        }
      }
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('API Route Error:', error);
    return NextResponse.json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
