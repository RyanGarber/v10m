import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

export interface Config {
    version: string;
    debug: boolean;
    workers: {
        max: number;
        loopMs: number;
    };
    web: {
        host?: string;
        port?: number;
        path?: string;
        root: string;
    };
}

export type PartialConfig = Partial<{
    debug: boolean;
    workers: Partial<Config['workers']>;
    web: Partial<Config['web']>;
}>;

const defaults: Config = {
    version: 'predev',
    debug: false,
    workers: {
        max: 2,
        loopMs: 1000,
    },
    web: {
        host: undefined,
        port: undefined,
        path: undefined,
        root: '/',
    }
};

function loadFromFile(): PartialConfig {
    const configPaths = [
        path.join(process.cwd(), 'v10m.config.json'),
        path.join(process.cwd(), '.v10mrc'),
        path.join(process.env.HOME || '~', '.v10mrc'),
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

function loadFromEnv(): PartialConfig {
    return {
        debug: process.env.V10M_DEBUG === 'true' ? true : undefined,
        workers: {
            max: process.env.V10M_WORKERS_MAX ? parseInt(process.env.V10M_WORKERS_MAX) : undefined,
            loopMs: process.env.V10M_WORKERS_LOOP_MS ? parseInt(process.env.V10M_WORKERS_LOOP_MS) : undefined,
        },
        web: {
            host: process.env.V10M_WEB_HOST,
            port: process.env.V10M_WEB_PORT ? parseInt(process.env.V10M_WEB_PORT) : undefined,
            path: process.env.V10M_WEB_PATH,
            root: process.env.V10M_WEB_ROOT,
        }
    };
}

function merge(...configs: PartialConfig[]): Config {
    const result: Config = JSON.parse(JSON.stringify(defaults));

    for (const config of configs) {
        if (config.debug !== undefined) result.debug = config.debug;
        if (config.workers) {
            if (config.workers.max !== undefined) result.workers.max = config.workers.max;
            if (config.workers.loopMs !== undefined) result.workers.loopMs = config.workers.loopMs;
        }
        if (config.web) {
            if (config.web.host !== undefined) result.web.host = config.web.host;
            if (config.web.port !== undefined) result.web.port = config.web.port;
            if (config.web.path !== undefined) result.web.path = config.web.path;
            if (config.web.root !== undefined) {
                result.web.root = config.web.root.slice(0, config.web.root.endsWith('/') ? -1 : undefined) || '/';
            }
        }
    }

    return result;
}

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