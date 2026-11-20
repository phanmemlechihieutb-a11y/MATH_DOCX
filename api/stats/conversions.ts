import type { ServerResponse } from 'node:http';
import { handleConversionStats, type RequestWithOptionalBody } from '../../server/apiApp.ts';

export const maxDuration = 15;

export default async function handler(
  req: RequestWithOptionalBody,
  res: ServerResponse
): Promise<void> {
  await handleConversionStats(req, res);
}
