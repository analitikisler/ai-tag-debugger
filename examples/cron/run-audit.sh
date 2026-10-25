#!/bin/sh
# Runs a scheduled tracking audit on your own server and keeps its history in $DATA_DIR,
# so each report's "Changed since last run" section compares it with the previous run.
#
# Setup, once:
#   npm install -g @analitikisler/ai-tag-debugger@0.19.0
#   npx playwright install --with-deps chromium
#   mkdir -p /opt/aitd && cp ai-tag-debugger.config.json /opt/aitd/
#   echo 'ANTHROPIC_API_KEY=...' > /etc/aitd.env && chmod 600 /etc/aitd.env
#
# Then add a line to your crontab (crontab -e), see crontab.example.
# The exit code is 1 when findings reach --fail-on, so cron can mail you on failure.
set -eu

cd /opt/aitd
. /etc/aitd.env
export ANTHROPIC_API_KEY

DATA_DIR="${DATA_DIR:-/opt/aitd/tracking-data}"

aitd run --config ai-tag-debugger.config.json --data-dir "$DATA_DIR" --fail-on broken
