import {
  sendJson,
  verifyFirebaseIdToken,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../server/biApiCore.js';
import { sendTestPushForUser } from '../../server/pushService.js';

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Método não permitido.' });
    return;
  }

  const authResult = await verifyFirebaseIdToken(req.headers.authorization);
  if (!authResult.ok) {
    sendJson(res, authResult.status, { error: authResult.error });
    return;
  }

  try {
    const result = await sendTestPushForUser(authResult.uid);
    sendJson(res, result.ok ? 200 : 400, result);
  } catch (err) {
    console.error('[Push Test Error]', err instanceof Error ? err.message : err);
    sendJson(res, 500, { error: 'Falha ao disparar notificação push de teste.' });
  }
}
