import { resolve } from 'node:path';
import { createServer } from './createServer.js';

const app = createServer(resolve('../web/dist'));
const port = Number(process.env.PORT ?? 3000);
app.listen(port, process.env.HOST ?? '127.0.0.1', () =>
  console.log(`HomePing backend and web caller: http://localhost:${port}`),
);
