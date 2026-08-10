import prisma from '../../prisma.js';

// Lazily initialised so the module can be imported (and report itself
// unconfigured) on a server that has no Firebase credentials.
let messagingPromise = null;

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.error('[notify:fcm] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    return null;
  }
}

export function isConfigured() {
  return serviceAccount() !== null;
}

async function messaging() {
  if (!messagingPromise) {
    messagingPromise = (async () => {
      const credentials = serviceAccount();
      if (!credentials) return null;
      // firebase-admin v13+ dropped the `admin.credential.cert()` namespace in
      // favour of subpath entry points. Importing the root and reaching for
      // `.credential` silently yields undefined, so use the modular API.
      const { initializeApp, cert, getApps, getApp } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      const app = getApps().length ? getApp() : initializeApp({ credential: cert(credentials) });
      return getMessaging(app);
    })().catch((err) => {
      console.error('[notify:fcm] init failed', err.message);
      return null;
    });
  }
  return messagingPromise;
}

// FCM tokens rot constantly — a reinstall or a cleared app invalidates them.
// Deleting them here is what keeps the table from filling with dead rows that
// every subsequent send has to walk.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

async function pruneDeadTokens(tokens, responses) {
  const dead = [];
  responses.forEach((result, index) => {
    if (result.success) return;
    if (DEAD_TOKEN_CODES.has(result.error?.code)) dead.push(tokens[index]);
  });
  if (dead.length === 0) return;
  await prisma.deviceToken
    .deleteMany({ where: { token: { in: dead } } })
    .catch((err) => console.error('[notify:fcm] token prune failed', err.message));
}

/**
 * Sends one notification to many tokens.
 *
 * Returns `{ status, error }` rather than throwing — the dispatcher records the
 * outcome and the caller's request must not be affected either way.
 */
export async function send({ tokens, title, body, data = {} }) {
  const list = [...new Set((tokens || []).filter(Boolean))];
  if (list.length === 0) return { status: 'skipped', error: 'no device tokens' };

  const client = await messaging();
  if (!client) return { status: 'failed', error: 'fcm not initialised' };

  try {
    const response = await client.sendEachForMulticast({
      tokens: list,
      notification: { title, body },
      // Values must be strings; anything else is rejected by the API.
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high' },
    });
    await pruneDeadTokens(list, response.responses);
    if (response.successCount > 0) return { status: 'sent' };
    return {
      status: 'failed',
      error: response.responses[0]?.error?.message || 'all sends failed',
    };
  } catch (err) {
    return { status: 'failed', error: err.message };
  }
}
