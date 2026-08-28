#!/bin/bash
# LOSFOG 跨境女装运营工作台 - 云服务器一键启动脚本（Ubuntu/Debian）
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "== 未检测到 Node.js，开始安装 =="
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "== 正在安装 pm2 进程守护 =="
  sudo npm install -g pm2
fi

echo "== 启动服务 =="
pm2 start ecosystem.config.js
pm2 save
pm2 startup

echo "=========================================="
echo "部署完成。"
echo "访问地址：http://服务器公网IP:3000"
echo "请到云服务器控制台（安全组/防火墙）放行 TCP 3000 端口。"
echo "详细步骤见《部署到云服务器指南.txt》。"
echo "=========================================="
