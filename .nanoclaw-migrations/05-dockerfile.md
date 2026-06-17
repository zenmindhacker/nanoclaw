# Dockerfile Fork Deltas

Tracks every layer added to `container/Dockerfile` beyond what upstream ships.
Update this file whenever `container/Dockerfile` changes for fork-specific reasons.

## Format

Each entry should include:
- The Dockerfile block (verbatim)
- Where it goes (after which existing block)
- Why it's needed

---

## Layers added

### mnemon binary (implemented)

Inserted before the Bun runtime block, after the pnpm global CLI install block.

```dockerfile
# ---- mnemon — persistent agent memory ----------------------------------------
ARG MNEMON_VERSION=0.1.14
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/mnemon-dev/mnemon/releases/download/v${MNEMON_VERSION}/mnemon_${MNEMON_VERSION}_linux_${ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin mnemon && \
    chmod +x /usr/local/bin/mnemon

ENV MNEMON_DATA_DIR=/home/node/.claude/mnemon
```

_Note: `MNEMON_DATA_DIR` must point into the existing `.claude` RW mount
(`data/v2-sessions/<agent_group_id>/.claude-shared/`). No new volume mounts needed._

---

## Notes for upstream merges

When `container/Dockerfile` conflicts during an upstream merge:
1. Accept all upstream changes (new CLI tools, version bumps, etc.)
2. Re-insert the fork layers from this file at the documented positions
3. Update this file if upstream changes the surrounding blocks
