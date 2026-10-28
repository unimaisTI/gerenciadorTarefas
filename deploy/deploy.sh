#!/usr/bin/env bash
# Deploy na VPS (RNF-H5). Rodar no servidor, dentro do clone do repositório:
#   ./deploy/deploy.sh
# Pré-requisitos: Node 22+, PM2 (npm i -g pm2), Nginx configurado (deploy/nginx.conf)
# e o .env de produção na raiz (veja .env.example e o README).
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Atualizando código"
git pull --ff-only

echo "==> Instalando dependências"
npm ci

echo "==> Verificando qualidade"
npm run lint
npm run typecheck

echo "==> Aplicando migrations"
npm run db:migrate

echo "==> Build"
npm run build

echo "==> Reiniciando API e worker"
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

echo "==> Recarregando Nginx"
sudo nginx -t && sudo systemctl reload nginx

echo "Deploy concluído."
