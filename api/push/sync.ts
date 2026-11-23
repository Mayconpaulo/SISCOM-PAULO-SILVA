import {
  readJsonBody,
  sendJson,
  verifyFirebaseIdToken,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../server/biApiCore.js';
import { syncUserPushState } from '../../server/pushService.js';

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

  const bodyResult = await readJsonBody(req, 512_000);
  if (!bodyResult.ok) {
    sendJson(res, bodyResult.status, { error: bodyResult.error });
    return;
  }

  const body = (bodyResult.body && typeof bodyResult.body === 'object'
    ? bodyResult.body
    : {}) as Record<string, unknown>;

  try {
    const result = await syncUserPushState({
      uid: authResult.uid,
      subscription: body.subscription,
      removeEndpoint: typeof body.removeEndpoint === 'string' ? body.removeEndpoint : undefined,
      demandas: body.demandas,
      tzOffsetMinutes: body.tzOffsetMinutes,
      notifiedKeys: body.notifiedKeys,
    });
    sendJson(res, 200, result);
  } catch (err) {
    console.error('[Push Sync Error]', err instanceof Error ? err.message : err);
    sendJson(res, 500, { error: 'Não foi possível sincronizar as notificações em segundo plano.' });
  }
}
