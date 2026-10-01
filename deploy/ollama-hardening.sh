#!/bin/sh
# Run on monster: ssh -t monster 'sudo sh -s' < deploy/ollama-hardening.sh. Delete the drop-in to roll back.
# Ollama stays reachable from the LAN for other uses; Textus itself only selects OLLAMA_ALLOWED_MODELS
# and sets num_ctx per request, so server defaults are left alone.
set -eu
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/textus-m6.conf <<'CONFIG'
[Service]
Environment="OLLAMA_NO_CLOUD=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_MAX_QUEUE=4"
CONFIG
systemctl daemon-reload
systemctl restart ollama
systemctl is-active ollama
