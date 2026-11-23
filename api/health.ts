import {
  sendJson,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../server/biApiCore.js';

export default function handler(req: ServerlessRequest, res: ServerlessResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendJson(res, 405, { error: 'Método não permitido.' });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    runtime: 'vercel',
    timestamp: new Date().toISOString(),
  });
}
