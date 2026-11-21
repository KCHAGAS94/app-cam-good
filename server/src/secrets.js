import crypto from 'node:crypto';
import {config} from './config.js';

/**
 * Camera passwords must be readable again (the app needs them to log into the camera),
 * so they are encrypted (AES-256-GCM), not hashed. The key comes from CAMERA_SECRET in .env.
 */
const key = crypto.createHash('sha256').update(config.cameraSecret).digest();

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}

export function decrypt(stored) {
  const [iv, tag, data] = stored.split('.').map(s => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
