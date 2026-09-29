/**
 * Server entry point. Builds the JSON store and the provider adapters, serves
 * the API the web app talks to, and owns the telephony callbacks and the call
 * audio socket.
 */
import { createServer } from 'node:http';
import { createRequestListener, createUpgradeListener } from './api/routes.ts';
import { loadConfig, missingCallConfig } from './config.ts';
import { buildCallServices } from './services.ts';
import { JsonStore } from './storage/json-store.ts';

const config = loadConfig();
const storage = new JsonStore(config.dataDir);
const { telephony, voice, extraction, runner } = buildCallServices(config, storage);

const services = {
  runner,
  telephony,
  missingConfig: () => missingCallConfig(config),
};

const server = createServer(createRequestListener(storage, services));
server.on('upgrade', createUpgradeListener(services));

// A restart kills every live call, so nothing may still look in flight.
await runner.reconcileOnStartup();

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[server] ${config.host}:${config.port} is already in use`);
    process.exit(1);
  }
  throw error;
});

server.listen(config.port, config.host, () => {
  console.log(`[server] listening on http://${config.host}:${config.port}`);
  console.log(`[server] data folder: ${config.dataDir}`);
  console.log(`[server] telephony: ${telephony.provider}, voice: ${voice.backend}`);
  console.log(`[server] extraction: ${extraction.provider}`);

  const missing = missingCallConfig(config);
  if (missing.length > 0) {
    console.log(`[server] calling is disabled until these are set: ${missing.join(', ')}`);
  } else {
    console.log(`[server] callbacks expected on ${config.publicBaseUrl}`);
  }
});

/** Releases the port and exits. A hung connection must not keep the process alive. */
function shutdown(signal: string): void {
  console.log(`[server] ${signal} received, closing`);
  const finish = () => process.exit(0);
  setTimeout(finish, 500).unref();
  void telephony.close().catch(() => undefined);
  server.closeAllConnections();
  server.close(finish);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
