import type { ServerResponse } from 'node:http';
import { handleOmmlPreview, type RequestWithOptionalBody } from '../../server/apiApp.ts';

export const maxDuration = 30;

export default async function handler(
  req: RequestWithOptionalBody,
  res: ServerResponse
): Promise<void> {
  await handleOmmlPreview(req, res);
}
