import {
  sendJson,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../server/biApiCore.js';
import { runPushReminderSweep, verifyCronAuthorization } from '../../server/pushService.js';

export default async function handler(
  req: ServerlessRequest,
  res: ServerlessResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    sendJson(res, 405, { error: 'Método não permitido.' });
    return;
  }

  if (!verifyCronAuthorization(req.headers.authorization)) {
    sendJson(res, 401, { error: 'Acesso não autorizado ao agendador de notificações.' });
    return;
  }

  try {
    const result = await runPushReminderSweep();
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error('[Push Cron Error]', err instanceof Error ? err.message : err);
    sendJson(res, 500, { error: 'Erro ao executar varredura de notificações.' });
  }
}
