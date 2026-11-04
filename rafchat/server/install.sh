#!/usr/bin/env bash
# Установка RafChat Relay на VPS (Ubuntu/Debian). Запуск от root:
#   curl -fsSL https://raw.githubusercontent.com/sharapovrafail-bot/modelview/claude/adoring-edison-95p0fr/rafchat/server/install.sh | sudo bash
# Повторный запуск обновляет сервер. Ваш VPN и другие службы не затрагиваются.
set -euo pipefail

PORT="${RAFCHAT_RELAY_PORT:-47888}"
BRANCH="${RAFCHAT_BRANCH:-claude/adoring-edison-95p0fr}"
SRC="https://raw.githubusercontent.com/sharapovrafail-bot/modelview/${BRANCH}/rafchat/server/rafchat_relay.py"

echo "== RafChat Relay: порт ${PORT}"
if ! command -v python3 >/dev/null 2>&1; then
  echo "== ставлю python3"
  (apt-get update -qq && apt-get install -y -qq python3) || (yum install -y python3) || (dnf install -y python3)
fi

id rafchat >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin rafchat
mkdir -p /opt/rafchat /var/lib/rafchat
curl -fsSL "$SRC" -o /opt/rafchat/rafchat_relay.py
chown -R rafchat:rafchat /var/lib/rafchat

cat > /etc/systemd/system/rafchat-relay.service <<EOF
[Unit]
Description=RafChat Relay (ретранслятор чата RafChat)
After=network-online.target
Wants=network-online.target

[Service]
User=rafchat
ExecStart=/usr/bin/env python3 /opt/rafchat/rafchat_relay.py --port ${PORT} --data /var/lib/rafchat
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/rafchat
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now rafchat-relay
systemctl restart rafchat-relay

# брандмауэр: открыть порт, если включён ufw (iptables/облачный брандмауэр — см. подсказку ниже)
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null && echo "== ufw: порт ${PORT}/tcp открыт"
fi

sleep 1
if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null; then
  IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  echo
  echo "== Готово. RafChat Relay работает."
  echo "   В RafChat на каждом устройстве: ⚙ → «Профиль и сеть» → «Сервер (через интернет)»:"
  echo "       ${IP}:${PORT}"
  echo "   Если устройства не подключаются — откройте TCP-порт ${PORT} в панели хостинга (облачный брандмауэр)."
else
  echo "!! Сервер не ответил. Журнал: journalctl -u rafchat-relay -n 50"
  exit 1
fi
