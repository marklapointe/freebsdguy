import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_NAME = 'mdweb';

const getBaseConfigDir = () => {
    if (process.env.CONFIG_DIR) return process.env.CONFIG_DIR;

    const platforms = [
        { name: 'freebsd', path: `/usr/local/etc/${APP_NAME}` },
        { name: 'linux', path: `/etc/${APP_NAME}` },
        { name: 'fallback', path: path.join(os.homedir(), '.local', 'etc', APP_NAME) }
    ];

    // Priority based on platform
    let orderedPlatforms = [];
    if (process.platform === 'freebsd') {
        orderedPlatforms = [platforms[0], platforms[1], platforms[2]];
    } else if (process.platform === 'linux') {
        orderedPlatforms = [platforms[1], platforms[0], platforms[2]];
    } else {
        orderedPlatforms = [platforms[2], platforms[0], platforms[1]];
    }

    for (const p of orderedPlatforms) {
        try {
            // Check if directory exists and is writable, or if parent is writable so we can create it
            if (fs.existsSync(p.path)) {
                fs.accessSync(p.path, fs.constants.W_OK);
                return p.path;
            } else {
                const parent = path.dirname(p.path);
                if (fs.existsSync(parent)) {
                    fs.accessSync(parent, fs.constants.W_OK);
                    return p.path;
                }
            }
        } catch (e) {
            continue;
        }
    }

    // Ultimate fallback to bundled config if all else fails (mostly for dev)
    return path.join(__dirname, '..', 'config');
};

const baseConfigDir = getBaseConfigDir();

export const configPath = () => process.env.CONFIG_PATH || path.join(baseConfigDir, 'config.json');
export const usersPath = () => process.env.USERS_PATH || path.join(baseConfigDir, 'users.json');

export interface User {
    username: string;
    passwordHash: string;
    role: string;
    theme?: string;
}

export interface UsersConfig {
    admin: User;
    users: User[];
}

export interface ServiceConfig {
    port?: number;
}

export interface Config {
    postsDir: string;
    themeDir: string;
    currentTheme: string;
    siteName?: string;
    pagination?: number;
    sortBy?: 'date' | 'title' | 'author';
    sortOrder?: 'asc' | 'desc';
    searchPlacement?: 'top' | 'bottom' | 'left' | 'right' | 'none';
    aiConfig?: AIConfig;
    service?: ServiceConfig;
}

export interface AIConfig {
    enabled: boolean;
    provider: 'ollama' | 'openai';
    baseUrl: string;
    apiKey: string;
    modelId: string;
}

const ensureDirectoryExists = (filePath: string) => {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

const migrateIfNeeded = (targetPath: string, fileName: string) => {
    if (!fs.existsSync(targetPath)) {
        const bundledPath = path.join(__dirname, '..', 'config', fileName);
        if (fs.existsSync(bundledPath)) {
            ensureDirectoryExists(targetPath);
            fs.copyFileSync(bundledPath, targetPath);
        }
    }
};

export const loadConfig = (customPath?: string): Config => {
    const targetPath = customPath || configPath();
    if (!customPath) {
        migrateIfNeeded(targetPath, 'config.json');
    }
    
    if (!fs.existsSync(targetPath)) {
        // Return a default config if neither exists
        return {
            postsDir: './posts',
            themeDir: './themes',
            currentTheme: 'dark',
            siteName: 'MDWeb'
        };
    }
    try {
        return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    } catch (e) {
        return {
            postsDir: './posts',
            themeDir: './themes',
            currentTheme: 'dark',
            siteName: 'MDWeb'
        };
    }
};

export const loadAIConfig = (customPath?: string): AIConfig | null => {
    const config = loadConfig(customPath);
    return config.aiConfig || null;
};

export const saveConfig = (config: Config, customPath?: string) => {
    const targetPath = customPath || configPath();
    ensureDirectoryExists(targetPath);
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2));
};

export const isConfigWritable = (customPath?: string): boolean => {
    const targetPath = customPath || configPath();
    try {
        if (fs.existsSync(targetPath)) {
            fs.accessSync(targetPath, fs.constants.W_OK);
            return true;
        } else {
            const dir = path.dirname(targetPath);
            if (fs.existsSync(dir)) {
                fs.accessSync(dir, fs.constants.W_OK);
                return true;
            }
        }
    } catch (e) {
        return false;
    }
    return false;
};

export const loadUsers = (customPath?: string): UsersConfig => {
    const targetPath = customPath || usersPath();
    if (!customPath) {
        migrateIfNeeded(targetPath, 'users.json');
    }

    if (!fs.existsSync(targetPath)) {
        // Provide a default admin if file doesn't exist
        const defaultConfig: UsersConfig = {
            admin: {
                username: 'admin',
                passwordHash: '$2b$10$O9wR/Y6O6Wc7.pS/YF4p/O7.pS/YF4p/O7.pS/YF4p/O7.pS/YF4p/', // admin
                role: 'admin'
            },
            users: []
        };
        
        ensureDirectoryExists(targetPath);
        // Save the default config to disk
        fs.writeFileSync(targetPath, JSON.stringify(defaultConfig, null, 2));
        return defaultConfig;
    }
    try {
        return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    } catch (e) {
        return {
            admin: {
                username: 'admin',
                passwordHash: '$2b$10$O9wR/Y6O6Wc7.pS/YF4p/O7.pS/YF4p/O7.pS/YF4p/O7.pS/YF4p/',
                role: 'admin'
            },
            users: []
        };
    }
};

export const saveUsers = (users: UsersConfig, customPath?: string) => {
    const targetPath = customPath || usersPath();
    ensureDirectoryExists(targetPath);
    fs.writeFileSync(targetPath, JSON.stringify(users, null, 2));
};
