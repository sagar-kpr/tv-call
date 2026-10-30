import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, '../..'), 'HOMEPING_');
  return {
    plugins: [react()],
    define: { 'import.meta.env.VITE_HOMEPING_API_URL': JSON.stringify(env.HOMEPING_BACKEND_URL || '') },
    server: { proxy: { '/api': 'http://127.0.0.1:3000' } },
  };
});
