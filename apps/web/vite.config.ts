import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const certDir = fileURLToPath(new URL('../../.local/certs/', import.meta.url));

/**
 * HTTPS opcional (DEV_HTTPS=true no .env), com o certificado do `npm run cert:dev`.
 * Serve para abrir pelo IP da rede via <ip>.nip.io e usar o login do Google.
 */
function devHttps(enabled: boolean) {
  const key = `${certDir}dev-key.pem`;
  const cert = `${certDir}dev-cert.pem`;
  if (!enabled) return undefined;
  if (!existsSync(key) || !existsSync(cert)) {
    console.warn('DEV_HTTPS=true, mas o certificado não existe. Rode: npm run cert:dev');
    return undefined;
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      host: true,
      port: 5173,
      https: devHttps(env.DEV_HTTPS === 'true'),
      // Nomes que apontam para o IP da máquina (o Google exige domínio, não IP).
      allowedHosts: ['.nip.io', '.sslip.io'],
      proxy: { '/api': 'http://127.0.0.1:3001' },
    },
  };
});
