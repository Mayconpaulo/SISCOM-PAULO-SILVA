import {
  sendJson,
  verifyFirebaseIdToken,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../server/biApiCore.js';
import { getBiAiProviderStatus } from '../../server/biExtractionService.js';

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Método não permitido.' });
    return;
  }

  const authResult = await verifyFirebaseIdToken(req.headers.authorization);
  if (!authResult.ok) {
    sendJson(res, authResult.status, { error: authResult.error });
    return;
  }

  sendJson(res, 200, getBiAiProviderStatus());
}
