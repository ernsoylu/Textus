#!/bin/sh
# Run only from a root-owned installation at /usr/local/sbin/textus-ollama-hardening.
set -eu
firewall() {
  # Keep established connections; new Ollama connections are local or from app102 only.
  iptables -N TEXTUS_OLLAMA 2>/dev/null || true
  iptables -F TEXTUS_OLLAMA
  iptables -A TEXTUS_OLLAMA -i lo -j ACCEPT
  iptables -A TEXTUS_OLLAMA -s 192.168.1.102/32 -j ACCEPT
  iptables -A TEXTUS_OLLAMA -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -A TEXTUS_OLLAMA -j REJECT
  iptables -C INPUT -p tcp --dport 11434 -j TEXTUS_OLLAMA 2>/dev/null || iptables -I INPUT 1 -p tcp --dport 11434 -j TEXTUS_OLLAMA
  ip6tables -N TEXTUS_OLLAMA 2>/dev/null || true
  ip6tables -F TEXTUS_OLLAMA
  ip6tables -A TEXTUS_OLLAMA -i lo -j ACCEPT
  ip6tables -A TEXTUS_OLLAMA -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  ip6tables -A TEXTUS_OLLAMA -j REJECT
  ip6tables -C INPUT -p tcp --dport 11434 -j TEXTUS_OLLAMA 2>/dev/null || ip6tables -I INPUT 1 -p tcp --dport 11434 -j TEXTUS_OLLAMA
}
if [ "${1:-}" = firewall ]; then firewall; exit; fi
[ "$#" = 0 ] || exit 2
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/textus-m6.conf <<'CONFIG'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_NO_CLOUD=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_CONTEXT_LENGTH=4096"
Environment="OLLAMA_ORIGINS=http://localhost,http://127.0.0.1"
ExecStartPre=+/usr/local/sbin/textus-ollama-hardening firewall
CONFIG
firewall
systemctl daemon-reload
systemctl restart ollama
systemctl is-active ollama
