import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import enquirer from 'enquirer';

import { 
    loadConfig, 
    saveConfig, 
    loadUsers, 
    saveUsers, 
    configPath, 
    usersPath
} from '../lib/config.ts';
import { generateSecret } from '../lib/preflight.ts';

export const setupSite = async () => {
    console.log('\n--- MDWeb Site Configuration ---');
    const config = loadConfig();
    
    const response = await (enquirer as any).prompt([
        {
            type: 'input',
            name: 'siteName',
            message: 'Site Name:',
            initial: config.siteName || 'MDWeb'
        },
        {
            type: 'input',
            name: 'siteLogo',
            message: 'Site Logo Filename (optional):',
            initial: config.siteLogo || ''
        },
        {
            type: 'input',
            name: 'port',
            message: 'Port:',
            initial: config.service?.port?.toString() || '5173'
        }
    ]) as any;

    config.siteName = response.siteName;
    config.siteLogo = response.siteLogo || undefined;
    config.service = { ...config.service, port: parseInt(response.port, 10) };
    
    saveConfig(config);
    console.log('✔ Site configuration saved.');
    return config;
};

export const setupAdmin = async () => {
    console.log('\n--- Admin User Configuration ---');
    const users = loadUsers();
    
    const response = await (enquirer as any).prompt([
        {
            type: 'input',
            name: 'username',
            message: 'Admin Username:',
            initial: users.admin?.username || 'admin'
        },
        {
            type: 'password',
            name: 'password',
            message: 'Admin Password (leave blank to keep current):'
        }
    ]) as any;

    if (response.password) {
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(response.password, salt);
        users.admin = {
            username: response.username,
            passwordHash: hash,
            role: 'admin'
        };
        saveUsers(users);
        console.log('✔ Admin password updated.');
    } else if (response.username !== users.admin.username) {
        users.admin.username = response.username;
        saveUsers(users);
        console.log('✔ Admin username updated.');
    } else {
        console.log('No changes made to admin user.');
    }
};

export const setupJWT = async () => {
    console.log('\n--- JWT Security Configuration ---');
    const config = loadConfig();
    let currentSecret = config.jwtSecret;

    const { action } = await (enquirer as any).prompt({
        type: 'select',
        name: 'action',
        message: 'JWT Secret Management:',
        choices: [
            { name: 'random', message: 'Generate a random secret' },
            { name: 'manual', message: 'Enter secret manually' },
            { name: 'keep', message: `Keep current secret ${currentSecret ? '(already set)' : '(NOT SET)'}` }
        ]
    }) as any;

    let newSecret = currentSecret;
    if (action === 'random') {
        newSecret = generateSecret();
        console.log(`Generated secret: ${newSecret}`);
    } else if (action === 'manual') {
        const { secret } = await (enquirer as any).prompt({
            type: 'input',
            name: 'secret',
            message: 'Enter JWT Secret:'
        }) as any;
        newSecret = secret;
    }

    if (action !== 'keep' && newSecret) {
        config.jwtSecret = newSecret;
        saveConfig(config);
        console.log('✔ JWT Secret saved to config file.');
    }
};

export const ensureDirectories = async () => {
    console.log('\n--- Directory Verification ---');
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');

    const dirs = [
        { name: 'Config Directory', path: configDir },
        { name: 'Posts Directory', path: postsDir },
        { name: 'Images Directory', path: imagesDir }
    ];

    for (const dir of dirs) {
        if (!fs.existsSync(dir.path)) {
            const { create } = await (enquirer as any).prompt({
                type: 'confirm',
                name: 'create',
                message: `${dir.name} does not exist (${dir.path}). Create it?`,
                initial: true
            }) as any;
            
            if (create) {
                fs.mkdirSync(dir.path, { recursive: true });
                console.log(`✔ Created ${dir.name}.`);
            }
        } else {
            console.log(`✔ ${dir.name} already exists.`);
        }
    }
};

const mainMenu = async () => {
    while (true) {
        console.log('\n=== MDWeb Console Management ===');
        const { choice } = await (enquirer as any).prompt({
            type: 'select',
            name: 'choice',
            message: 'Select an action:',
            choices: [
                { name: 'status', message: 'Check Current Status' },
                { name: 'setup_site', message: 'Configure Site Details' },
                { name: 'setup_admin', message: 'Set Admin Password' },
                { name: 'setup_jwt', message: 'Configure JWT Secret' },
                { name: 'directories', message: 'Verify/Create Directories' },
                { name: 'exit', message: 'Exit' }
            ]
        }) as any;

        try {
            switch (choice) {
                case 'status': await showStatus(); break;
                case 'setup_site': await setupSite(); break;
                case 'setup_admin': await setupAdmin(); break;
                case 'setup_jwt': await setupJWT(); break;
                case 'directories': await ensureDirectories(); break;
                case 'exit': process.exit(0);
            }
        } catch (e) {
            console.error('An error occurred:', e);
        }
    }
};

const showStatus = async () => {
    console.log('\n--- MDWeb Current Status ---');
    const config = loadConfig();
    const users = loadUsers();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');

    console.log(`Config File: ${configPath()}`);
    console.log(`Users File: ${usersPath()}`);
    console.log(`Site Name: ${config.siteName || 'Not set'}`);
    console.log(`Port: ${config.service?.port || 'Default (5173)'}`);
    console.log(`Admin User: ${users.admin?.username || 'Not set'}`);
    console.log(`JWT Secret: ${process.env.JWT_SECRET ? 'Set (masked)' : 'NOT SET'}`);
    console.log(`Posts Directory: ${postsDir} (${fs.existsSync(postsDir) ? 'Exists' : 'MISSING'})`);
    console.log(`Images Directory: ${imagesDir} (${fs.existsSync(imagesDir) ? 'Exists' : 'MISSING'})`);
};

// Run if not in a test environment
if (!process.env.VITEST) {
    // Check if running in a TTY
    if (!process.stdout.isTTY) {
        console.error('Error: This TUI must be run in an interactive terminal.');
        process.exit(1);
    }

    mainMenu().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
