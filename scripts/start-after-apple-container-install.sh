#!/usr/bin/env bash
# Run this after installing Apple Container from github.com/apple/container/releases
set -e

echo "=== NanoClaw: Apple Container Startup ==="
echo ""

# 1. Verify Apple Container is installed
echo "1. Checking Apple Container..."
container --version || { echo "ERROR: Apple Container not found. Install from github.com/apple/container/releases"; exit 1; }

# 2. Start the container system
echo ""
echo "2. Starting Apple Container system..."
container system status 2>/dev/null || container system start
echo "   Container system ready."

# 3. Build the NanoClaw agent image
echo ""
echo "3. Building NanoClaw agent image..."
cd "$(dirname "$0")/.."
./container/build.sh

# 4. Test a basic container run
echo ""
echo "4. Testing container execution..."
echo '{}' | container run -i --entrypoint /bin/echo nanoclaw-agent:latest "Container OK"

# 5. Load and start NanoClaw LaunchAgent
echo ""
echo "5. Starting NanoClaw via launchd..."
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
sleep 3

# 6. Check status
echo ""
echo "6. Status:"
launchctl list | grep nanoclaw

echo ""
echo "=== Done! ==="
echo "Check logs: tail -f ~/nanoclaw/logs/nanoclaw.log"
echo "Error log:  tail -f ~/nanoclaw/logs/nanoclaw.error.log"
