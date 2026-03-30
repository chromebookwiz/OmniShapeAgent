import { URLSearchParams } from 'url';

const DEFAULT_FROM = process.env.AGENT_EMAIL_FROM || 'agent@shapeagent.local';

export async function sendEmail(to: string, subject: string, text: string, from?: string) {
  const fromAddress = (from || DEFAULT_FROM).trim();

  if (!to || !subject || !text) {
    return 'send_email tool requires to, subject, and text args.';
  }

  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
    // Not configured; simulate.
    return `send_email not configured. Set MAILGUN_API_KEY and MAILGUN_DOMAIN in environment. Attempted payload: from=${fromAddress}, to=${to}, subject=${subject}`;
  }

  const url = `https://api.mailgun.net/v3/${process.env.MAILGUN_DOMAIN}/messages`;
  const body = new URLSearchParams();
  body.append('from', fromAddress);
  body.append('to', to);
  body.append('subject', subject);
  body.append('text', text);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const errText = await response.text();
    return `Mailgun send failed: ${response.status} ${response.statusText} ${errText}`;
  }

  return `Email sent via Mailgun from ${fromAddress} to ${to}`;
}
