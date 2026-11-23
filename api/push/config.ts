import {
  sendJson,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../server/biApiCore.js';
import { getPublicPushConfig } from '../../server/pushService.js';

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    sendJson(res, 405, { error: 'Método não permitido.' });
    return;
  }
  sendJson(res, 200, getPublicPushConfig());
}
