import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import enquirer from 'enquirer';
import { loadConfig, saveConfig, configPath, loadUsers } from './config.ts';
import { INSECURE_DEFAULT_JWT_SECRET, isInsecureJwtSecret } from './jwt-secret.ts';
import { resolvePostsDir, resolveImagesDir } from './safe-path.ts';

export interface PreflightIssue {
    id: string;
    description: string;
    critical: boolean;
    fixable: boolean;
    fixed?: boolean;
}

export const generateSecret = () => {
    return crypto.randomBytes(32).toString('hex');
};

export const runPreflight = async (interactive: boolean = false): Promise<PreflightIssue[]> => {
    const issues: PreflightIssue[] = [];
    const config = loadConfig();
    const users = loadUsers();
    const configDir = path.dirname(configPath());

    // 1. Check directories — auto-create in non-interactive mode so production restarts survive
    const postsDir = resolvePostsDir(configDir, config.postsDir);
    const imagesDir = resolveImagesDir(configDir, config.postsDir);

    if (!fs.existsSync(postsDir)) {
        if (!interactive) {
            try {
                fs.mkdirSync(postsDir, { recursive: true });
                if (!process.env.VITEST) console.log(`[INFO] Created posts directory: ${postsDir}`);
            } catch (e) {
                issues.push({
                    id: 'DIR_POSTS_MISSING',
                    description: `Posts directory missing and could not be created: ${postsDir} (${e})`,
                    critical: true,
                    fixable: false
                });
            }
        } else {
            issues.push({
                id: 'DIR_POSTS_MISSING',
                description: `Posts directory missing: ${postsDir}`,
                critical: true,
                fixable: true
            });
        }
    }

    if (!fs.existsSync(imagesDir) && fs.existsSync(postsDir)) {
        if (!interactive) {
            try {
                fs.mkdirSync(imagesDir, { recursive: true });
                if (!process.env.VITEST) console.log(`[INFO] Created images directory: ${imagesDir}`);
            } catch (e) {
                issues.push({
                    id: 'DIR_IMAGES_MISSING',
                    description: `Images directory missing and could not be created: ${imagesDir} (${e})`,
                    critical: true,
                    fixable: false
                });
            }
        } else {
            issues.push({
                id: 'DIR_IMAGES_MISSING',
                description: `Images directory missing: ${imagesDir}`,
                critical: true,
                fixable: true
            });
        }
    } else if (!fs.existsSync(imagesDir)) {
        issues.push({
            id: 'DIR_IMAGES_MISSING',
            description: `Images directory missing: ${imagesDir}`,
            critical: true,
            fixable: true
        });
    }

    // 2. Check JWT Secret (INV-SEC-2)
    const SECRET = process.env.JWT_SECRET || config.jwtSecret || INSECURE_DEFAULT_JWT_SECRET;
    if (isInsecureJwtSecret(SECRET)) {
        issues.push({
            id: 'JWT_SECRET_DEFAULT',
            description: 'JWT secret is missing, too short, or using the default insecure value.',
            critical: process.env.NODE_ENV === 'production',
            fixable: true
        });
    }

    // 3. Check Admin User
    if (!users.admin || !users.admin.username) {
        issues.push({
            id: 'ADMIN_USER_MISSING',
            description: 'No admin user configured.',
            critical: true,
            fixable: false
        });
    }

    if (issues.length > 0) {
        if (!process.env.VITEST) {
            console.log('\n--- Pre-flight Check ---');
            for (const issue of issues) {
                console.log(`${issue.critical ? '[CRITICAL]' : '[WARNING]'} ${issue.description}`);
            }
        }

        if (interactive) {
            const fixableIssues = issues.filter(i => i.fixable);
            if (fixableIssues.length > 0) {
                const { fix } = await (enquirer as any).prompt({
                    type: 'confirm',
                    name: 'fix',
                    message: 'Attempt to automatically fix fixable issues?',
                    initial: true
                }) as any;

                if (fix) {
                    for (const issue of issues) {
                        if (issue.fixable) {
                            const success = await fixIssue(issue);
                            if (success) {
                                issue.fixed = true;
                            }
                        }
                    }
                }
            }

            if (issues.some(i => i.critical && !i.fixed)) {
                console.log('\n[ERROR] Some critical issues could not be fixed. Please run "npm run setup" to configure the application.');
            }
        }
    } else if (!process.env.VITEST) {
        console.log('[INFO] Pre-flight check passed.');
    }

    return issues;
};

const fixIssue = async (issue: PreflightIssue): Promise<boolean> => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());

    try {
        switch (issue.id) {
            case 'DIR_POSTS_MISSING': {
                const postsDir = resolvePostsDir(configDir, config.postsDir);
                fs.mkdirSync(postsDir, { recursive: true });
                console.log(`✔ Created posts directory: ${postsDir}`);
                return true;
            }
            case 'DIR_IMAGES_MISSING': {
                const iDir = resolveImagesDir(configDir, config.postsDir);
                fs.mkdirSync(iDir, { recursive: true });
                console.log(`✔ Created images directory: ${iDir}`);
                return true;
            }
            case 'JWT_SECRET_DEFAULT': {
                const newSecret = generateSecret();
                config.jwtSecret = newSecret;
                saveConfig(config);
                console.log('✔ Generated and saved a new random JWT secret to config.json');
                return true;
            }
        }
    /* v8 ignore start */
    } catch (e) {
        console.error(`Failed to fix ${issue.id}:`, e);
    }
    /* v8 ignore stop */
    return false;
};
