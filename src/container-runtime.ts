/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

import { logger } from './logger.js';

/** Fixed host IP used by Apple Container VMs. The subnet is always 192.168.64.0/24. */
const APPLE_CONTAINER_HOST_IP = '192.168.64.1';

/**
 * Detect the container runtime.
 * Apple Container (`container` CLI) on macOS, Docker everywhere else.
 */
function detectRuntime(): { bin: string; type: 'apple' | 'docker' } {
  if (os.platform() === 'darwin') {
    try {
      execSync('which container', { stdio: 'ignore' });
      return { bin: 'container', type: 'apple' };
    } catch {
      /* fall through to docker */
    }
  }
  return { bin: 'docker', type: 'docker' };
}

const runtime = detectRuntime();

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = runtime.bin;
export const usingAppleContainer = runtime.type === 'apple';

/** Hostname/IP containers use to reach the host machine. */
export const CONTAINER_HOST_GATEWAY = usingAppleContainer
  ? APPLE_CONTAINER_HOST_IP
  : 'host.docker.internal';

/**
 * Address the credential proxy binds to.
 * Apple Container: bind to 0.0.0.0 so the proxy is reachable on the
 *   192.168.64.1 bridge even when the VM starts after NanoClaw does.
 * Docker Desktop (macOS): 127.0.0.1 — the VM routes host.docker.internal to loopback.
 * Docker (Linux): bind to the docker0 bridge IP.
 */
export const PROXY_BIND_HOST =
  process.env.CREDENTIAL_PROXY_HOST || detectProxyBindHost();

function detectProxyBindHost(): string {
  if (usingAppleContainer) return '0.0.0.0';
  if (os.platform() === 'darwin') return '127.0.0.1';
  if (fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) return '127.0.0.1';
  const ifaces = os.networkInterfaces();
  const docker0 = ifaces['docker0'];
  if (docker0) {
    const ipv4 = docker0.find((a) => a.family === 'IPv4');
    if (ipv4) return ipv4.address;
  }
  return '0.0.0.0';
}

/** CLI args needed for the container to resolve the host gateway. */
export function hostGatewayArgs(): string[] {
  // Apple Container: host is reachable by IP directly, no extra args needed.
  if (usingAppleContainer) return [];
  // Docker on Linux: host.docker.internal isn't built-in — add it explicitly.
  if (os.platform() === 'linux') {
    return ['--add-host=host.docker.internal:host-gateway'];
  }
  return [];
}

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(
  hostPath: string,
  containerPath: string,
): string[] {
  return [
    '--mount',
    `type=bind,source=${hostPath},target=${containerPath},readonly`,
  ];
}

/** Stop a container by name. Uses execFileSync to avoid shell injection. */
export function stopContainer(name: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid container name: ${name}`);
  }
  execSync(`${CONTAINER_RUNTIME_BIN} stop -t 1 ${name}`, { stdio: 'pipe' });
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  // Docker daemon is managed by systemd — no need to start it ourselves.
  if (!usingAppleContainer) {
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 10000 });
      logger.debug('Docker daemon running');
    } catch (err) {
      logger.error({ err }, 'Docker daemon not running');
      throw new Error(
        'Docker daemon is not running. Start it with: sudo systemctl start docker',
      );
    }
    return;
  }

  try {
    execSync(`${CONTAINER_RUNTIME_BIN} system status`, { stdio: 'pipe' });
    logger.debug('Container runtime already running');
  } catch {
    logger.info('Starting container runtime...');
    try {
      execSync(`${CONTAINER_RUNTIME_BIN} system start`, {
        stdio: 'pipe',
        timeout: 30000,
      });
      logger.info('Container runtime started');
    } catch (err) {
      logger.error({ err }, 'Failed to start container runtime');
      throw new Error('Container runtime is required but failed to start');
    }
  }
}

/** Kill orphaned NanoClaw containers from previous runs. */
export function cleanupOrphans(): void {
  try {
    let orphans: string[];

    if (usingAppleContainer) {
      // Apple Container: `container ls --format json` returns [{status, configuration: {id}}]
      const output = execSync(`${CONTAINER_RUNTIME_BIN} ls --format json`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf-8',
      });
      const containers: { status: string; configuration: { id: string } }[] =
        JSON.parse(output || '[]');
      orphans = containers
        .filter(
          (c) =>
            c.status === 'running' &&
            c.configuration.id.startsWith('nanoclaw-'),
        )
        .map((c) => c.configuration.id);
    } else {
      // Docker: `docker ps --format '{{.Names}}'` returns one name per line
      const output = execSync(
        `docker ps --filter "name=nanoclaw-" --format "{{.Names}}"`,
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
      );
      orphans = output
        .trim()
        .split('\n')
        .filter((n) => n.length > 0);
    }

    for (const name of orphans) {
      try {
        stopContainer(name);
      } catch {
        /* already stopped */
      }
    }
    if (orphans.length > 0) {
      logger.info(
        { count: orphans.length, names: orphans },
        'Stopped orphaned containers',
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
