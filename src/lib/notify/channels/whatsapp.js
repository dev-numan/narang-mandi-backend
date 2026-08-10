const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

export function isConfigured() {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

/**
 * Numbers are stored as typed — almost always `03001234567`. The Cloud API wants
 * E.164 without the leading `+`, i.e. `923001234567`.
 *
 * Mirrors the client-side logic in `ui/external/ExternalIntents.kt`.
 *
 * @returns the normalised number, or null if it cannot be one.
 */
export function toWhatsAppNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  let national;
  if (digits.startsWith('92')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  // Pakistani mobile numbers are 10 digits after the country code (3xxxxxxxxx).
  if (national.length !== 10 || !national.startsWith('3')) return null;
  return `92${national}`;
}

/**
 * Sends a pre-approved template message. Business-initiated WhatsApp messages
 * cannot be free-form, so `template` must name a template Meta has approved and
 * `params` must match its body placeholders in order.
 */
export async function send({ phone, template, params = [], language = 'ur' }) {
  const to = toWhatsAppNumber(phone);
  if (!to) return { status: 'skipped', error: `unusable phone: ${phone || '(empty)'}` };

  const url = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: language },
          components: params.length
            ? [
                {
                  type: 'body',
                  parameters: params.map((text) => ({ type: 'text', text: String(text) })),
                },
              ]
            : [],
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { status: 'failed', error: `HTTP ${response.status} ${detail.slice(0, 300)}` };
    }

    // "sent" here only means Meta accepted the message. The id is what lets the
    // webhook later say whether it actually reached a handset.
    const body = await response.json().catch(() => null);
    return { status: 'sent', messageId: body?.messages?.[0]?.id || null };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}
