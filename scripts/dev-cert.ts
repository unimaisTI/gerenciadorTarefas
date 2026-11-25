/**
 * Certificado HTTPS de desenvolvimento para abrir o Hub pelo IP da rede com login do Google.
 * O Google não aceita IP como endereço de retorno; aceita <ip-com-traços>.nip.io, um domínio
 * público que aponta para o próprio IP. Gera .local/certs/dev-key.pem e dev-cert.pem (autoassinado)
 * e mostra o endereço para cadastrar no Google. Rode de novo se o IP da máquina mudar.
 *
 * Uso: npm run cert:dev            (detecta o IP)
 *      npm run cert:dev -- 10.0.0.5  (IP escolhido)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function detectIp(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && PRIVATE.test(addr.address))
        return addr.address;
    }
  }
  return undefined;
}

const ip = process.argv[2] ?? detectIp();
if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
  console.error('Não encontrei o IP da rede local. Informe: npm run cert:dev -- 192.168.0.10');
  process.exit(1);
}

const host = `${ip.replaceAll('.', '-')}.nip.io`;
const dir = resolve(import.meta.dirname, '../.local/certs');
mkdirSync(dir, { recursive: true });
// Configuração mínima própria: o OPENSSL_CONF do sistema pode apontar para um arquivo que não existe.
const config = resolve(dir, 'openssl.cnf');
writeFileSync(config, '[req]\ndistinguished_name = dn\n[dn]\n');

try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '825',
      '-subj',
      '/CN=UniMais Hub (desenvolvimento)',
      '-addext',
      `subjectAltName=DNS:${host},DNS:localhost,IP:${ip},IP:127.0.0.1`,
      '-keyout',
      resolve(dir, 'dev-key.pem'),
      '-out',
      resolve(dir, 'dev-cert.pem'),
    ],
    // MSYS_NO_PATHCONV: o openssl do Git para Windows trataria "/CN=..." como caminho de pasta.
    {
      stdio: 'pipe',
      env: {
        ...process.env,
        OPENSSL_CONF: config,
        MSYS_NO_PATHCONV: '1',
        MSYS2_ARG_CONV_EXCL: '*',
      },
    },
  );
} catch (error) {
  const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
  console.error(
    `Não foi possível gerar o certificado com o openssl (vem com o Git para Windows).\n${stderr}`,
  );
  process.exit(1);
}

const url = `https://${host}:5173`;
console.log(`Certificado criado em .local/certs para ${host}.

No .env:
  DEV_HTTPS=true
  APP_URL=${url}
  GOOGLE_REDIRECT_URI=${url}/api/auth/google/callback

No Google Cloud Console (ID do cliente OAuth):
  Origem JavaScript autorizada:   ${url}
  URI de redirecionamento:        ${url}/api/auth/google/callback

Depois reinicie o npm run dev e abra ${url}
(o navegador avisa que o certificado não é confiável: clique em Avançado > Continuar).`);
