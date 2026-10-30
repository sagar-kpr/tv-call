const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');

// Only this public value enters the APK. Never expose the server's Admin keys.
module.exports = ({ config }) => {
  const envFile = path.resolve(__dirname, '../../.env');
  const local = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  const value = (process.env.HOMEPING_BACKEND_URL ?? local.HOMEPING_BACKEND_URL ?? '').trim();
  let backendUrl = '';
  if (value) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new Error('HOMEPING_BACKEND_URL must be a public HTTPS URL without credentials, query, or fragment.');
    backendUrl = value.replace(/\/+$/, '');
  }
  return { ...config, extra: { ...config.extra, homepingBackendUrl: backendUrl } };
};
