# Troubleshooting

Check these first when something goes wrong.

## Logs

| What | Where |
|------|-------|
| Host errors | `logs/nanoclaw.error.log` — delivery failures, crash-loop backoff, warnings |
| Host full chain | `logs/nanoclaw.log` — routing, delivery, sweep |
| Setup | `logs/setup.log`, `logs/setup-steps/*.log` |
| Session DBs | `data/v2-sessions/<agent-group>/<session>/` |

### Session DB quick check

| File | Question |
|------|----------|
| `inbound.db` → `messages_in` | Did the message reach the container? |
| `outbound.db` → `messages_out` | Did the agent produce a response? |

**Note:** Container logs are lost after the container exits (`--rm` flag). If the agent silently failed inside the container, there is no persistent container log.

## Service status

```bash
# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux (systemd)
systemctl --user status nanoclaw --no-pager
systemctl --user restart nanoclaw
```

## Common issues

| Symptom | First check |
|---------|-------------|
| Container won't spawn | Docker daemon, OneCLI gateway, `logs/nanoclaw.error.log` |
| 401 from APIs in container | OneCLI agent secret mode — `onecli agents list` |
| OAuth failures | `ncl oauth-health`, [.nanoclaw/oauth-hybrid-repair.md](../.nanoclaw/oauth-hybrid-repair.md) |
| Upgrade tripwire | [upgrade-recovery.md](upgrade-recovery.md) |
| Stale container image | `./container/build.sh`; prune builder if COPY steps are stale |

## Debug skill

For container agent issues, run the `/debug` operational skill.

## Post-upgrade smoke

After major upgrades: [.nanoclaw/post-upgrade.md](../.nanoclaw/post-upgrade.md).
