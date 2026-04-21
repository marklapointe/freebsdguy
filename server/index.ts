import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { loadConfig, saveConfig, configPath, loadUsers, saveUsers, loadAIConfig } from './lib/config.ts';
import { getPosts, getPost, savePost } from './lib/posts.ts';

import dotenv from 'dotenv';
dotenv.config();

import multer from 'multer';

const app = express();
const PORT = process.env.PORT || 3001;
const SECRET = process.env.JWT_SECRET || 'freebsd_guy_secret_key';

// Configure Multer for image uploads
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        const config = loadConfig();
        const configDir = path.dirname(configPath());
        const postsDir = path.resolve(configDir, config.postsDir);
        const imagesDir = path.join(postsDir, 'images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }
        cb(null, imagesDir);
    },
    filename: (_req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());

// Extend Request to include user and file
interface AuthenticatedRequest extends Request {
    user?: any;
    file?: any;
}

// Routes

// Auth middleware
const authenticate = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });

    jwt.verify(token, SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ message: 'Failed to authenticate token' });
        req.user = decoded;
        next();
    });
};

// Login
app.post('/api/login', async (req: Request, res: Response) => {
    const { username, password } = req.body;
    const usersConfig = loadUsers();

    console.log(`[AUTH] Login attempt for user: ${username}`);

    // Check admin
    if (username === usersConfig.admin.username) {
        const match = await bcrypt.compare(password, usersConfig.admin.passwordHash);
        if (match) {
            console.log(`[AUTH] Admin login successful: ${username}`);
            const token = jwt.sign({ username: usersConfig.admin.username, role: usersConfig.admin.role }, SECRET, { expiresIn: '1h' });
            return res.json({ token, role: usersConfig.admin.role });
        }
    }

    // Check other users
    const user = usersConfig.users.find(u => u.username === username);
    if (user) {
        const match = await bcrypt.compare(password, user.passwordHash);
        if (match) {
            console.log(`[AUTH] User login successful: ${username}`);
            const token = jwt.sign({ username: user.username, role: user.role }, SECRET, { expiresIn: '1h' });
            return res.json({ token, role: user.role });
        }
    }

    console.warn(`[AUTH] Login failed for user: ${username}`);
    res.status(401).json({ message: 'Invalid credentials' });
});

// Admin: Get all users
app.get('/api/admin/users', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const usersConfig = loadUsers();
    const users = [
        { username: usersConfig.admin.username, role: usersConfig.admin.role },
        ...usersConfig.users.map(u => ({ username: u.username, role: u.role }))
    ];
    res.json(users);
});

// Admin: Create user
app.post('/api/admin/users', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });

    const { username, password, role } = req.body;
    const usersConfig = loadUsers();

    if (usersConfig.users.find(u => u.username === username) || usersConfig.admin.username === username) {
        return res.status(400).json({ message: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    usersConfig.users.push({ username, passwordHash, role });
    saveUsers(usersConfig);

    console.log(`[INFO] New user created: ${username} with role ${role}`);
    res.json({ message: 'User created' });
});

// Admin: Delete user
app.delete('/api/admin/users/:username', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const username = req.params.username;
    const usersConfig = loadUsers();

    if (username === usersConfig.admin.username) {
        return res.status(400).json({ message: 'Cannot delete primary admin' });
    }

    const initialLen = usersConfig.users.length;
    usersConfig.users = usersConfig.users.filter(u => u.username !== username);

    if (usersConfig.users.length === initialLen) {
        return res.status(404).json({ message: 'User not found' });
    }

    saveUsers(usersConfig);
    console.log(`[INFO] User deleted: ${username}`);
    res.json({ message: 'User deleted' });
});

// Get posts
app.get('/api/posts', (_req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const posts = getPosts(postsDir);
    res.json(posts);
});

// AI: Summarize post content
app.post('/api/ai/summarize', authenticate, async (req: AuthenticatedRequest, res: Response) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ message: 'No content provided' });

    const aiConfig = loadAIConfig();
    if (!aiConfig) {
        return res.status(503).json({ message: 'AI configuration not found' });
    }

    try {
        const response = await axios.post(`${aiConfig.baseUrl}/chat/completions`, {
            model: aiConfig.modelId,
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that summarizes blog posts. Provide a concise summary (1-3 sentences) of the following content.'
                },
                {
                    role: 'user',
                    content: content
                }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${aiConfig.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        const summary = response.data.choices[0].message.content.trim();
        res.json({ summary });
    } catch (error) {
        console.error('AI Summarization failed:', error);
        res.status(500).json({ message: 'Failed to summarize content' });
    }
});

// Get single post
app.get('/api/posts/:slug', (req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const slug = req.params.slug as string;
    const post = getPost(postsDir, slug);
    
    if (!post) {
        return res.status(404).json({ message: 'Post not found' });
    }

    res.json(post);
});

// Create/Update post (Contributor or Admin)
app.post('/api/posts', authenticate, (req: AuthenticatedRequest, res: Response) => {
    const { slug, title, content, summary, date } = req.body;
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    
    savePost(postsDir, {
        slug,
        title,
        content,
        summary,
        date,
        author: req.user.username
    });

    res.json({ message: 'Post saved' });
});

// Serve images
app.get('/api/images/:filename', (req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');
    const filename = req.params.filename as string;
    res.sendFile(path.join(imagesDir, filename));
});

// Serve static frontend files in production
const distPath = path.resolve(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/^\/(?!api).*/, (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// Get site config
app.get('/api/config', (_req: Request, res: Response) => {
    const config = loadConfig();
    res.json({
        siteName: config.siteName || 'Generic Blog',
        currentTheme: config.currentTheme,
        pagination: config.pagination || 10,
        sortBy: config.sortBy || 'date',
        sortOrder: config.sortOrder || 'desc',
        searchPlacement: config.searchPlacement || 'top'
    });
});

// Admin: Update site config
app.post('/api/admin/config', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const config = loadConfig();
    const { siteName, currentTheme, pagination, sortBy, sortOrder, searchPlacement } = req.body;

    if (siteName) config.siteName = siteName;
    if (currentTheme) config.currentTheme = currentTheme;
    if (pagination !== undefined) config.pagination = Number(pagination);
    if (sortBy) config.sortBy = sortBy;
    if (sortOrder) config.sortOrder = sortOrder;
    if (searchPlacement) config.searchPlacement = searchPlacement;

    saveConfig(config);
    
    // Also update the theme if it changed
    if (currentTheme) {
        const configDir = path.dirname(configPath());
        const themeDir = path.resolve(configDir, config.themeDir);
        const themePath = path.join(themeDir, `${currentTheme}.json`);
        if (!fs.existsSync(themePath)) {
            // Create default theme if it doesn't exist
            if (!fs.existsSync(themeDir)) fs.mkdirSync(themeDir, { recursive: true });
            fs.writeFileSync(themePath, JSON.stringify({
                "--primary": "#1a202c",
                "--secondary": "#2d3748",
                "--accent": "#4a5568",
                "--text": "#ffffff",
                "--bg": "#f7fafc"
            }, null, 2));
        }
    }

    res.json({ message: 'Configuration updated' });
});

// Admin: Get all themes
app.get('/api/admin/themes', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const themeDir = path.resolve(configDir, config.themeDir);
    
    let themes = ['default'];
    if (fs.existsSync(themeDir)) {
        const files = fs.readdirSync(themeDir).filter(f => f.endsWith('.json'));
        themes = Array.from(new Set(['default', ...files.map(f => f.replace('.json', ''))]));
    }
    res.json(themes);
});

// Admin: Create/Update theme
app.post('/api/admin/themes/:name', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const name = req.params.name;
    const colors = req.body;
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const themeDir = path.resolve(configDir, config.themeDir);

    if (!fs.existsSync(themeDir)) {
        fs.mkdirSync(themeDir, { recursive: true });
    }

    fs.writeFileSync(path.join(themeDir, `${name}.json`), JSON.stringify(colors, null, 2));
    res.json({ message: `Theme ${name} saved` });
});

// Admin: Delete post
app.delete('/api/posts/:slug', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'contributor') return res.status(403).json({ message: 'Forbidden' });
    const slug = req.params.slug;
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const postPath = path.join(postsDir, `${slug}.md`);

    if (fs.existsSync(postPath)) {
        fs.unlinkSync(postPath);
        res.json({ message: 'Post deleted' });
    } else {
        res.status(404).json({ message: 'Post not found' });
    }
});

// Image upload
app.post('/api/admin/upload', authenticate, upload.single('image'), (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    res.json({ filename: req.file.filename, url: `/api/images/${req.file.filename}` });
});

// Get all images
app.get('/api/admin/images', authenticate, (req: AuthenticatedRequest, res: Response) => {
    if (req.user.role !== 'admin' && req.user.role !== 'contributor') return res.status(403).json({ message: 'Forbidden' });
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const postsDir = path.resolve(configDir, config.postsDir);
    const imagesDir = path.join(postsDir, 'images');

    if (!fs.existsSync(imagesDir)) return res.json([]);
    const files = fs.readdirSync(imagesDir);
    res.json(files);
});

// Theme support (just returns css variables)
app.get('/api/theme', (_req: Request, res: Response) => {
    const config = loadConfig();
    const configDir = path.dirname(configPath());
    const themeDir = path.resolve(configDir, config.themeDir);
    const themePath = path.join(themeDir, `${config.currentTheme}.json`);
    
    if (fs.existsSync(themePath)) {
        res.json(JSON.parse(fs.readFileSync(themePath, 'utf8')));
    } else {
        res.json({
            "--primary": "#1a202c",
            "--secondary": "#2d3748",
            "--accent": "#4a5568",
            "--text": "#ffffff",
            "--bg": "#f7fafc"
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
