import 'server-only';
import { createSupabaseServiceClient } from './supabase-server';
import { serverEnv } from './env';
import crypto from 'node:crypto';

/**
 * Storage for the LinkedIn `li_at` session cookie — the most sensitive asset in
 * the system (spec §1). The plaintext cookie is NEVER stored in a plain column,
 * NEVER returned to the browser, and NEVER logged.
 *
 * Primary path: Supabase Vault (`vault.create_secret` / `vault.decrypted_secrets`),
 * accessed only with the service role. We persist just the returned secret id
 * (`li_secret_id`) on `linkedin_accounts`.
 *
 * The functions below wrap Postgres RPCs defined in the migrations
 * (`app_create_li_secret`, `app_read_li_secret`, `app_delete_li_secret`) which
 * encapsulate Vault access so the service role surface stays small.
 */

export async function storeCookie(userId: string, liAt: string): Promise<string> {
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.rpc('app_create_li_secret', {
    p_user_id: userId,
    p_secret: liAt,
  });
  if (error) throw new Error(`Vault store failed: ${error.message}`);
  return data as string; // secret id (uuid)
}

export async function readCookie(secretId: string): Promise<string> {
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.rpc('app_read_li_secret', { p_secret_id: secretId });
  if (error) throw new Error(`Vault read failed: ${error.message}`);
  if (!data) throw new Error('Vault secret not found or empty');
  return data as string;
}

export async function deleteCookie(secretId: string): Promise<void> {
  const svc = createSupabaseServiceClient();
  const { error } = await svc.rpc('app_delete_li_secret', { p_secret_id: secretId });
  if (error) throw new Error(`Vault delete failed: ${error.message}`);
}

/**
 * Fallback app-level AES-256-GCM, used only if Vault is unavailable in an
 * environment. COOKIE_ENC_KEY must be a 32-byte key, base64-encoded.
 * Format: base64(iv).base64(authTag).base64(ciphertext)
 *
 * TODO(confirm): default deployment uses Supabase Vault; this is here as a
 * documented fallback only and is not wired into the connect route.
 */
export function aesEncrypt(plaintext: string): string {
  const key = Buffer.from(serverEnv.cookieEncKey(), 'base64');
  if (key.length !== 32) throw new Error('COOKIE_ENC_KEY must be 32 bytes (base64)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function aesDecrypt(payload: string): string {
  const key = Buffer.from(serverEnv.cookieEncKey(), 'base64');
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
