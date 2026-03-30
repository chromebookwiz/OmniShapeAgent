// src/lib/tools/config.ts
import fs from 'fs';
import path from 'path';

const ENV_PATH = path.join(process.cwd(), '.env.local');

/**
 * Surgically updates or adds a key-value pair in .env.local
 */
export function setEnvKey(key: string, value: string): string {
  try {
    let content = '';
    if (fs.existsSync(ENV_PATH)) {
      content = fs.readFileSync(ENV_PATH, 'utf8');
    }

    const regex = new RegExp(`^${key}=.*`, 'm');
    const newLine = `${key}=${value}`;

    if (regex.test(content)) {
      content = content.replace(regex, newLine);
    } else {
      content += `\n${newLine}`;
    }

    fs.writeFileSync(ENV_PATH, content.trim() + '\n', 'utf8');
    // Also update process.env for the current session
    process.env[key] = value;
    
    return `Successfully updated ${key} in .env.local`;
  } catch (err: any) {
    return `Error setting environment key: ${err.message}`;
  }
}

/**
 * Registers the Telegram Webhook and verifies the token.
 */
export async function telegramProvision(token: string, domain: string): Promise<string> {
  if (!token || !domain) return "Error: Token and Domain are required.";

  // First, save the token
  setEnvKey('TELEGRAM_BOT_TOKEN', token);

  const webhookUrl = `${domain.replace(/\/$/, '')}/api/telegram`;
  const registerUrl = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

  try {
    const res = await fetch(registerUrl);
    const data = await res.json();

    if (data.ok) {
      // If valid, also try to get bot info to get chat ID or just confirm
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const meData = await meRes.json();
      const botName = meData.ok ? meData.result.first_name : 'Unknown Bot';

      return `Telegram Provisioning Success!\n- Bot: ${botName}\n- Webhook: ${webhookUrl}\n- Configuration: Updated .env.local`;
    } else {
      return `Telegram API Error: ${data.description}`;
    }
  } catch (err: any) {
    return `Provisioning failed: ${err.message}`;
  }
}
