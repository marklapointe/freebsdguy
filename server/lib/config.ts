import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const configPath = () => process.env.CONFIG_PATH || path.join(__dirname, '..', 'config', 'config.json');
export const usersPath = () => process.env.USERS_PATH || path.join(__dirname, '..', 'config', 'users.json');

export interface User {
    username: string;
    passwordHash: string;
    role: string;
}

export interface UsersConfig {
    admin: User;
    users: User[];
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
}

export const loadConfig = (customPath?: string): Config => {
    return JSON.parse(fs.readFileSync(customPath || configPath(), 'utf8'));
};

export const saveConfig = (config: Config, customPath?: string) => {
    fs.writeFileSync(customPath || configPath(), JSON.stringify(config, null, 2));
};

export const loadUsers = (customPath?: string): UsersConfig => {
    const targetPath = customPath || usersPath();
    if (!fs.existsSync(targetPath)) {
        // Provide a default admin if file doesn't exist
        const defaultConfig: UsersConfig = {
            admin: {
                username: 'admin',
                passwordHash: '$2b$10$x7o/dvu7/KBaupXvvkmhQuvqMhonmzGO.Al4EAazaPFbDusbhhdXi', // admin123
                role: 'admin'
            },
            users: []
        };
        // Ensure the directory exists
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Save the default config to disk
        fs.writeFileSync(targetPath, JSON.stringify(defaultConfig, null, 2));
        return defaultConfig;
    }
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
};

export const saveUsers = (users: UsersConfig, customPath?: string) => {
    fs.writeFileSync(customPath || usersPath(), JSON.stringify(users, null, 2));
};
