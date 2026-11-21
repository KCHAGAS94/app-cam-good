import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import {config} from './config.js';
import {migrate} from './db.js';
import {cameraRoutes} from './routes/cameras.js';
import {logRoutes} from './routes/log.js';
import {mediaRoutes} from './routes/media.js';
import {sessionRoutes} from './routes/session.js';
import {userRoutes} from './routes/users.js';

const app = express();
app.set('trust proxy', 'loopback'); // Cloudflare Tunnel connects from localhost
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        // the panel is also opened over plain http on the home network (before the domain/HTTPS)
        upgradeInsecureRequests: null,
      },
    },
  }),
);
app.use(express.json({limit: '1mb'}));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ok: true}));
app.use('/api', sessionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cameras', cameraRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/log', logRoutes);

// web panel (static files)
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

// errors -> JSON, never leak stack traces
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({error: 'Erro interno no servidor.'});
});

fs.mkdirSync(path.join(config.mediaDir, '_incoming'), {recursive: true});
await migrate();
app.listen(config.port, () => {
  console.log(`CamGood server on http://localhost:${config.port}`);
  console.log(`media in ${config.mediaDir}`);
});
