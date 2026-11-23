import {
  checkBiExtractRateLimit,
  getClientIpFromRequest,
  readJsonBody,
  sendJson,
  validateAndNormalizeBiExtractBody,
  verifyFirebaseIdToken,
  type ServerlessRequest,
  type ServerlessResponse,
} from '../../server/biApiCore.js';
import { extractAlterationsFromBulletin } from '../../server/biExtractionService.js';

export const config = {
  maxDuration: 60,
};

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

  const rateResult = checkBiExtractRateLimit(getClientIpFromRequest(req));
  if (!rateResult.ok) {
    sendJson(res, rateResult.status, { error: rateResult.error });
    return;
  }

  const bodyResult = await readJsonBody(req, 4_500_000);
  if (!bodyResult.ok) {
    sendJson(res, bodyResult.status, { error: bodyResult.error });
    return;
  }

  const validationResult = validateAndNormalizeBiExtractBody(bodyResult.body);
  if (!validationResult.ok) {
    sendJson(res, validationResult.status, { error: validationResult.error });
    return;
  }

  try {
    const result = await extractAlterationsFromBulletin(validationResult.payload);
    sendJson(res, 200, result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Erro inesperado ao processar o Boletim Interno.';
    console.error('[BI Extract Vercel Error]', message);
    sendJson(res, 502, { error: message });
  }
}
