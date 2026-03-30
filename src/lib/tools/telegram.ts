// src/lib/tools/telegram.ts
// Simple Telegram Bot API wrapper for the agent.

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendTelegramMessage(message: string, chatId?: string): Promise<string> {
  if (!TELEGRAM_BOT_TOKEN) return "Error: TELEGRAM_BOT_TOKEN not configured in .env.local";
  
  const targetChatId = chatId || TELEGRAM_CHAT_ID;
  if (!targetChatId) return "Error: No target Chat ID provided or configured.";

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    const data = await res.json();
    if (data.ok) {
      return `Telegram message sent successfully to ${targetChatId}.`;
    } else {
      return `Telegram error: ${data.description}`;
    }
  } catch (err: any) {
    return `Failed to send Telegram: ${err.message}`;
  }
}

export async function getTelegramUpdates(): Promise<string> {
  if (!TELEGRAM_BOT_TOKEN) return "Error: TELEGRAM_BOT_TOKEN not configured.";

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?limit=5&offset=-1`);
    const data = await res.json();
    
    if (data.ok && data.result.length > 0) {
      const messages = data.result.map((u: any) => {
        const msg = u.message || u.edited_message;
        if (!msg) return null;
        return `[${msg.from.first_name || 'User'}] (${msg.chat.id}): ${msg.text}`;
      }).filter(Boolean);
      
      return `Latest Telegram Messages:\n${messages.join('\n')}`;
    } else {
      return "No new Telegram messages found.";
    }
  } catch (err: any) {
    return `Failed to get Telegram updates: ${err.message}`;
  }
}
