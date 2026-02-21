import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const hashEmail  = (email: string)    => createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
export const hashFile   = (filePath: string) => createHash('sha256').update(readFileSync(filePath)).digest('hex');
export const hashString = (input: string)    => createHash('sha256').update(input).digest('hex');
