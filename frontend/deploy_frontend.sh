#!/bin/bash
# Menghentikan script jika ada perintah yang error
set -e

echo "🚀 Memulai Deployment frontend..."

production_server="192.168.169.26"
ssh_user="ham" 

    read -s -p "🔑 Masukkan password SSH untuk $ssh_user@$production_server: " SSHPASS
    echo ""
    export SSHPASS

echo "📦 1. Membangun frontend..."
pnpm run build

echo "🎨 2. Mentransfer data ke server .$production_server..."

  sshpass -e rsync -rlz --no-owner --no-group --progress \
    -e "ssh -o StrictHostKeyChecking=no" \
    ./build/client/ \
    $ssh_user@$production_server:/var/www/html/client

echo "✅ Deployment frontend selesai!"