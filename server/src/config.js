import 'dotenv/config';
import path from 'node:path';

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing ${name} in server/.env`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  cameraSecret: required('CAMERA_SECRET'),
  mediaDir: path.resolve(required('MEDIA_DIR')),
  /** Login sessions last this long (app and web panel). */
  tokenTtl: '30d',
  /** Largest upload accepted (videos recorded in the app). */
  maxUploadBytes: 500 * 1024 * 1024,
};
