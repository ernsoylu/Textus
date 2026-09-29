import { z } from 'zod';

// Figma "signup": "Use at least 12 characters." Sign-in itself never enforces a length, so an older,
// shorter password still works.
export const MIN_PASSWORD_LENGTH = 12;
export const newPasswordSchema = z.string().min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
