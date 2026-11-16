import type { ServerResponse } from 'node:http';
import { handleOcrPage, type RequestWithOptionalBody } from '../../server/apiApp.ts';

export const maxDuration = 60;

export default async function handler(
  req: RequestWithOptionalBody,
  res: ServerResponse
): Promise<void> {
  await handleOcrPage(req, res);
}
