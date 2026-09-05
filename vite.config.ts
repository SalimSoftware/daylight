import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const appUrl = new URL(env.APP_URL || 'http://localhost:5173');
  return {
    plugins: [react()],
    server: {
      port: Number(appUrl.port || (appUrl.protocol === 'https:' ? 443 : 80)),
      strictPort: true,
      // Synced Desktop folders can emit duplicate native change events.
      watch: { usePolling: true, interval: 500 },
      proxy: { '/api': `http://127.0.0.1:${env.PORT || 8787}` },
    },
  };
});
