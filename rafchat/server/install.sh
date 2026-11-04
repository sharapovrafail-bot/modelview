#!/usr/bin/env bash
# Установка RafChat Relay на VPS (Ubuntu/Debian). Обычно его запускает сама программа RafChat на ПК
# (⚙ → «Установить сервер на VPS…»). Вручную, от root:
#   curl -fsSL https://raw.githubusercontent.com/sharapovrafail-bot/modelview/claude/adoring-edison-95p0fr/rafchat/server/install.sh | sudo bash
# Повторный запуск обновляет сервер. Ваш VPN и другие службы не затрагиваются.
set -euo pipefail

PORT="${RAFCHAT_RELAY_PORT:-47888}"
# Запасные «веб-порты»: мобильные операторы часто режут нестандартные порты, а 443/80/8080 пропускают.
# Берём только свободные (если 443 занят VPN — его не трогаем).
EXTRA_PORTS=""
for p in ${RAFCHAT_EXTRA_PORTS:-443 80 8080}; do
  if ss -tln 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${p}\$"; then
    if ! systemctl is-active --quiet rafchat-relay || ! ss -tlnp 2>/dev/null | grep -E "[:.]${p} " | grep -q python3; then
      echo "== порт ${p} занят другой программой — пропускаю"
      continue
    fi
  fi
  EXTRA_PORTS="${EXTRA_PORTS} ${p}"
done
PORT_ARGS="--port ${PORT}"
for p in ${EXTRA_PORTS}; do PORT_ARGS="${PORT_ARGS} --port ${p}"; done
# Порт с шифрованием TLS — мобильные операторы вырезают незашифрованный HTTP к зарубежным серверам.
TLS_PORT=""
for p in ${RAFCHAT_TLS_PORTS:-2053 2083 2087 9443}; do
  if ss -tln 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${p}\$"; then
    if ss -tlnp 2>/dev/null | grep -E "[:.]${p} " | grep -q python3; then TLS_PORT="$p"; break; fi
    continue
  fi
  TLS_PORT="$p"; break
done
BRANCH="${RAFCHAT_BRANCH:-claude/adoring-edison-95p0fr}"
SRC="https://raw.githubusercontent.com/sharapovrafail-bot/modelview/${BRANCH}/rafchat/server/rafchat_relay.py"

echo "== RafChat Relay: порт ${PORT}"
if ! command -v python3 >/dev/null 2>&1; then
  echo "== ставлю python3"
  (apt-get update -qq && apt-get install -y -qq python3) || (yum install -y python3) || (dnf install -y python3)
fi

if ! command -v curl >/dev/null 2>&1; then
  (apt-get update -qq && apt-get install -y -qq curl) || (yum install -y curl) || (dnf install -y curl)
fi

id rafchat >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin rafchat
mkdir -p /opt/rafchat /var/lib/rafchat
if [ -n "${RAFCHAT_RELAY_SRC:-}" ] && [ -f "$RAFCHAT_RELAY_SRC" ]; then
  cp "$RAFCHAT_RELAY_SRC" /opt/rafchat/rafchat_relay.py          # привезла программа RafChat с ПК
else
  curl -fsSL "$SRC" -o /opt/rafchat/rafchat_relay.py
fi
if [ -n "${TLS_PORT}" ] && [ ! -f /var/lib/rafchat/tls.crt ]; then
  command -v openssl >/dev/null 2>&1 || (apt-get install -y -qq openssl) || (yum install -y openssl) || true
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=rafchat" \
    -keyout /var/lib/rafchat/tls.key -out /var/lib/rafchat/tls.crt >/dev/null 2>&1 || TLS_PORT=""
fi
[ -f /var/lib/rafchat/tls.crt ] || TLS_PORT=""
[ -n "${TLS_PORT}" ] && PORT_ARGS="${PORT_ARGS} --tls-port ${TLS_PORT} --cert /var/lib/rafchat/tls.crt --key /var/lib/rafchat/tls.key"
chown -R rafchat:rafchat /var/lib/rafchat

cat > /etc/systemd/system/rafchat-relay.service <<EOF
[Unit]
Description=RafChat Relay (ретранслятор чата RafChat)
After=network-online.target
Wants=network-online.target

[Service]
User=rafchat
ExecStart=/usr/bin/env python3 /opt/rafchat/rafchat_relay.py ${PORT_ARGS} --data /var/lib/rafchat
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
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
for P in ${PORT} ${EXTRA_PORTS} ${TLS_PORT}; do
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow "${P}/tcp" >/dev/null && echo "== ufw: порт ${P}/tcp открыт"
  fi
  if command -v iptables >/dev/null 2>&1; then
    iptables -C INPUT -p tcp --dport "${P}" -j ACCEPT 2>/dev/null || \
      { iptables -I INPUT -p tcp --dport "${P}" -j ACCEPT && echo "== iptables: порт ${P}/tcp открыт"; }
  fi
done
command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true

sleep 1
if curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null; then
  IP=$(curl -fsS https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
  echo
  echo "== Готово. RafChat Relay работает."
  echo "   В RafChat на каждом устройстве: ⚙ → «Профиль и сеть» → «Сервер (через интернет)»:"
  echo "       ${IP}:${PORT}"
  echo "RAFCHAT_ADDRESS=${IP}:${PORT}"
  echo "   Запасные порты (для мобильного интернета):${EXTRA_PORTS:- нет}"
  for P in ${EXTRA_PORTS}; do curl -fsS -m 3 "http://127.0.0.1:${P}/" >/dev/null && echo "   порт ${P}: работает"; done
  [ -n "${TLS_PORT}" ] && curl -fsSk -m 3 "https://127.0.0.1:${TLS_PORT}/" >/dev/null && echo "   шифрованный порт ${TLS_PORT} (TLS): работает"
  echo "   Если устройства не подключаются — откройте TCP-порт ${PORT} в панели хостинга (облачный брандмауэр)."
else
  echo "!! Сервер не ответил. Журнал: journalctl -u rafchat-relay -n 50"
  exit 1
fi
