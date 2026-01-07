import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

/**
 * v10m configuration
 */
export interface Config {
  debug: boolean;
  workers: {
    max: number;
    loopMs: number;
    cleanupMs: number;
  };
  web: {
    url: string;
    host: string;
    port: number;
    path: string;
    maxUploadSizeMb: number;
    targetSizeListMb: number[];
    defaultDownloadFilename: string;
  };
}

/**
 * Partial configuration for overrides
 */
export type PartialConfig = Partial<{
  debug: boolean;
  workers: Partial<Config['workers']>;
  web: Partial<Config['web']>;
}>;

/**
 * Default configuration
 */
const defaults: Config = {
  debug: false,
  workers: {
    max: 2,
    loopMs: 1000,
    cleanupMs: 300000,
  },
  web: {
    url: 'http://127.0.0.1:8080',
    host: '127.0.0.1',
    port: 8080,
    path: '/',
    maxUploadSizeMb: 500,
    targetSizeListMb: [10, 25, 50],
    defaultDownloadFilename: 'video-download',
  },
};

/**
 * Load configuration from files
 * @returns configuration overrides
 */
function loadFromFile(): PartialConfig {
  const configPaths = [
    path.join(process.cwd(), 'v10m.config.json'),
    path.join(process.env.HOME ?? '~', '.v10m.config.json'),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      } catch (err) {
        console.warn(`Failed to parse config file ${configPath}:`, err);
      }
    }
  }

  return {};
}

/**
 * Load configuration from environment variables
 * @returns configuration overrides
 */
function loadFromEnv(): PartialConfig {
  return {
    debug: process.env.V10M_DEBUG === 'true' ? true : undefined,
    workers: {
      max: process.env.V10M_WORKERS_MAX ? parseInt(process.env.V10M_WORKERS_MAX, 10) : undefined,
      loopMs: process.env.V10M_WORKERS_LOOP_MS
        ? parseInt(process.env.V10M_WORKERS_LOOP_MS, 10)
        : undefined,
      cleanupMs: process.env.V10M_WORKERS_CLEANUP_MS
        ? parseInt(process.env.V10M_WORKERS_CLEANUP_MS, 10)
        : undefined,
    },
    web: {
      url: process.env.V10M_WEB_URL,
      host: process.env.V10M_WEB_HOST,
      port: process.env.V10M_WEB_PORT ? parseInt(process.env.V10M_WEB_PORT, 10) : undefined,
      path: process.env.V10M_WEB_PATH,
      maxUploadSizeMb: process.env.V10M_WEB_MAX_UPLOAD_SIZE_MB
        ? parseInt(process.env.V10M_WEB_MAX_UPLOAD_SIZE_MB, 10)
        : undefined,
      targetSizeListMb: process.env.V10M_WEB_TARGET_SIZE_LIST_MB
        ? process.env.V10M_WEB_TARGET_SIZE_LIST_MB.split(',').map((s) => parseInt(s, 10))
        : undefined,
      defaultDownloadFilename: process.env.V10M_WEB_DEFAULT_DOWNLOAD_FILENAME,
    },
  };
}

/**
 * Merges all configurations and defaults
 * @param configs list of overrides
 * @returns final configuration
 */
function merge(...configs: PartialConfig[]): Config {
  const result: Config = { ...defaults };

  for (const config of configs) {
    if (config.debug !== undefined) {
      result.debug = config.debug;
    }
    if (config.workers) {
      if (config.workers.max !== undefined) {
        result.workers.max = config.workers.max;
      }
      if (config.workers.loopMs !== undefined) {
        result.workers.loopMs = config.workers.loopMs;
      }
      if (config.workers.cleanupMs !== undefined) {
        result.workers.cleanupMs = config.workers.cleanupMs;
      }
    }
    if (config.web) {
      if (config.web.url !== undefined) {
        result.web.url = config.web.url.slice(0, config.web.url.endsWith('/') ? -1 : undefined);
      }
      if (config.web.host !== undefined) {
        result.web.host = config.web.host;
      }
      if (config.web.port !== undefined) {
        result.web.port = config.web.port;
      }
      if (config.web.path !== undefined) {
        result.web.path =
          '/' +
          config.web.path.slice(
            config.web.path.startsWith('/') ? 1 : 0,
            config.web.path.endsWith('/') ? -1 : undefined
          );
      }
      if (config.web.maxUploadSizeMb !== undefined) {
        result.web.maxUploadSizeMb = config.web.maxUploadSizeMb;
      }
      if (config.web.targetSizeListMb !== undefined) {
        result.web.targetSizeListMb = config.web.targetSizeListMb;
      }
      if (config.web.defaultDownloadFilename !== undefined) {
        result.web.defaultDownloadFilename = config.web.defaultDownloadFilename;
      }
    }
  }

  return result;
}

/**
 * Configuration manager
 */
export class ConfigManager {
  private _config: Config;

  constructor(overrides: PartialConfig = {}) {
    const fileConfig = loadFromFile();
    const envConfig = loadFromEnv();

    this._config = merge(fileConfig, envConfig, overrides);
  }

  get config(): Readonly<Config> {
    return this._config;
  }

  update(overrides: PartialConfig): void {
    this._config = merge(this._config, overrides);
  }
}
