import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import sanitizeHtml from 'sanitize-html';

export interface PostMetadata {
    slug: string;
    title: string;
    summary: string;
    date: string;
    author: string;
    pinned?: boolean;
    /** 'draft' or 'published'. A post without the key is published. */
    status?: PostStatus;
    [key: string]: any;
}

/** A post is a draft until it is published; a post without the key is published. */
export type PostStatus = 'draft' | 'published';

/**
 * The status of a post. Front matter without `status` means published, so every
 * post that predates the drafts feature stays visible to the public.
 */
export function postStatus(post: { status?: unknown } | null | undefined): PostStatus {
    return post && post.status === 'draft' ? 'draft' : 'published';
}

/**
 * Parse the front matter of a post.
 *
 * gray-matter caches a file *before* it parses it: when the YAML is broken
 * the first call throws, but every later call for the same content hands out
 * the half-parsed file instead — the whole file comes back as the body, with
 * no front matter at all, so the post looks published and the draft body is
 * served to every reader. Passing options bypasses that cache, so a front
 * matter that does not parse fails every time and the caller always sees the
 * parse-error stub (a draft, never published).
 */
function parseFrontMatter(content: string): matter.GrayMatterFile<string> {
    return matter(content, {});
}

export interface Post extends PostMetadata {
    content: string;
}

export interface GetPostsOptions {
    sortBy?: 'title' | 'date' | 'author';
    sortOrder?: 'asc' | 'desc';
}

export const getPosts = (postsDir: string, options?: GetPostsOptions): PostMetadata[] => {
    if (!fs.existsSync(postsDir)) {
        try {
            fs.mkdirSync(postsDir, { recursive: true });
        } catch (error) {
            console.error(`Error creating posts directory ${postsDir}:`, error);
        }
        return [];
    }

    const sortBy = options?.sortBy || 'date';
    const sortOrder = options?.sortOrder || 'desc';

    const files = fs.readdirSync(postsDir);
    const posts = files.filter(f => f.endsWith('.md')).map(filename => {
        const filePath = path.join(postsDir, filename);
        try {
            /* v8 ignore next */
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const { data, content: mdContent } = parseFrontMatter(content);
            const pinned = data.pinned === true || data.pinned === 'true';
            return {
                slug: filename.replace(/\.md$/, ''),
                title: data.title || filename.replace(/\.md$/, ''),
                summary: data.summary || mdContent.substring(0, 150) + '...',
                date: data.date || '',
                author: data.author || '',
                ...data,
                pinned,
                status: postStatus(data)
            } as PostMetadata;
        } catch (error) {
            console.error(`Error parsing post ${filename}:`, error);
            // A post that does not parse is not published: fail closed. The
            // stub is a draft, so the public reads never show it, and it
            // carries nothing of the file that failed to parse.
            return {
                slug: filename.replace('.md', ''),
                title: `Error: ${filename}`,
                summary: 'This post could not be loaded due to a parsing error.',
                date: '',
                author: 'system',
                status: 'draft'
            } as PostMetadata;
        }
    }).filter((p): p is PostMetadata => p !== null);

    return posts.sort((a, b) => {
        // Pinned posts always first
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;

        // Then sort by configured field
        let aVal: string | number = '';
        let bVal: string | number = '';

        switch (sortBy) {
            case 'title':
                aVal = a.title.toLowerCase();
                bVal = b.title.toLowerCase();
                break;
            case 'author':
                aVal = a.author.toLowerCase();
                bVal = b.author.toLowerCase();
                break;
            case 'date':
            default:
                aVal = new Date(a.date).getTime();
                bVal = new Date(b.date).getTime();
                break;
        }

        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
        return 0;
    });
};

export const getPost = (postsDir: string, slug: string): Post | null => {
    const filePath = path.join(postsDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    try {
        const parsed = parseFrontMatter(content);
        const pinned = parsed.data.pinned === true || parsed.data.pinned === 'true';
        // Body must come from gray-matter `content` (after frontmatter), never from
        // list metadata or frontmatter keys — spread data first, then set body fields.
        const body = typeof parsed.content === 'string' ? parsed.content : '';
        const summary =
            typeof parsed.data.summary === 'string' && parsed.data.summary
                ? parsed.data.summary
                : body.substring(0, 150) + (body.length > 150 ? '...' : '');
        return {
            ...parsed.data,
            title: parsed.data.title || slug,
            slug,
            content: body,
            summary,
            date: parsed.data.date || '',
            author: parsed.data.author || '',
            pinned,
            status: postStatus(parsed.data)
        };
    } catch (error) {
        console.error(`Error parsing post ${slug}:`, error);
        // A post that does not parse is not published: fail closed. The stub
        // is a draft, and it quotes no parser error and no line of the file —
        // the real error goes to the server log, not to a reader.
        return {
            title: `Error: ${slug}`,
            slug,
            content: 'This post could not be loaded due to a parsing error.',
            summary: 'This post could not be loaded due to a parsing error.',
            date: '',
            author: 'system',
            status: 'draft'
        };
    }
};

/** The keys savePost writes itself; every other key of the input is merged as it is. */
const SAVE_OWNED_KEYS = new Set(['slug', 'content', 'title', 'summary', 'date', 'author', 'pinned']);

/** The same keys, for the manual fallback that writes the front matter by hand. */
const CORE_FRONTMATTER_KEYS = ['title', 'summary', 'date', 'author', 'pinned', 'status'];

/**
 * The front matter of a post file, exactly as it is on disk ({} when the post
 * does not exist). A save merges over this, so keys the save does not know
 * (aliases, publishedAt, ...) survive a save.
 */
export function readFrontMatter(postsDir: string, slug: string): Record<string, unknown> {
    const filePath = path.join(postsDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
        return {};
    }
    try {
        const parsed = parseFrontMatter(fs.readFileSync(filePath, 'utf8'));
        return { ...(parsed.data as Record<string, unknown>) };
    } catch (error) {
        console.error(`Error reading front matter of ${slug}:`, error);
        return {};
    }
}

/**
 * The date of a post as it is written. gray-matter parses an unquoted YAML
 * date as UTC midnight, so the calendar day is read back in UTC: writing the
 * local midnight instead would move a post to the day before.
 */
function dateText(value: unknown): string {
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return '';
        const y = value.getUTCFullYear();
        const m = String(value.getUTCMonth() + 1).padStart(2, '0');
        const d = String(value.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const text = String(value ?? '').trim();
    return text || new Date().toISOString();
}

/**
 * Write a post. The existing front matter is merged first and the input is
 * merged over it, so a save may only change the keys the input names: the
 * author, the status and the other keys of an existing post survive.
 */
export const savePost = (postsDir: string, post: Partial<Post> & { slug: string; content: string }): void => {
    if (!fs.existsSync(postsDir)) {
        fs.mkdirSync(postsDir, { recursive: true });
    }

    // Existing front matter first: a save must not drop keys it does not know
    // (aliases, publishedAt, ...), only the keys the input names may change.
    const merged: Record<string, unknown> = { ...readFrontMatter(postsDir, post.slug) };
    for (const [key, value] of Object.entries(post)) {
        if (SAVE_OWNED_KEYS.has(key)) continue;
        if (value === undefined) continue;
        merged[key] = value;
    }

    // Metadata only is HTML-stripped; body stays Markdown (authors are authenticated).
    const cleanTitle = sanitizeHtml(String(post.title ?? ''), { allowedTags: [], allowedAttributes: {} });
    const cleanSummary = sanitizeHtml(String(post.summary ?? ''), { allowedTags: [], allowedAttributes: {} });
    const content = String(post.content ?? '');

    const frontmatter: Record<string, unknown> = {
        ...merged,
        title: post.title !== undefined ? cleanTitle : String(merged.title ?? ''),
        summary: post.summary !== undefined ? cleanSummary : String(merged.summary ?? ''),
        date: dateText(post.date ?? merged.date),
        author: String(post.author ?? merged.author ?? ''),
        pinned:
            post.pinned !== undefined
                ? post.pinned === true
                : merged.pinned === true || merged.pinned === 'true',
        status: postStatus(merged)
    };

    try {
        const fileContent = matter.stringify(content, frontmatter);
        fs.writeFileSync(path.join(postsDir, `${post.slug}.md`), fileContent);
    } catch (error) {
        console.error(`Error saving post ${post.slug}:`, error);
        // Fallback to simple manual construction if matter.stringify fails for some reason
        const core = CORE_FRONTMATTER_KEYS.map(
            (key) => `${key}: ${JSON.stringify(frontmatter[key] ?? '')}`
        ).join('\n');
        const extra = Object.entries(frontmatter)
            .filter(([key]) => !CORE_FRONTMATTER_KEYS.includes(key))
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join('\n');
        const manualContent = `---\n${core}\n${extra ? `${extra}\n` : ''}---\n${content}`;
        fs.writeFileSync(path.join(postsDir, `${post.slug}.md`), manualContent);
    }
};

const SLUG_RE = /^[A-Za-z0-9_-]{1,120}$/;
let aliasCache: { dir: string; sig: string; map: Map<string, string> } | null = null;

function aliasSignature(postsDir: string, files: string[]): string {
    return files.map((f) => {
        try {
            return `${f}:${fs.statSync(path.join(postsDir, f)).mtimeMs}`;
        } catch {
            return `${f}:gone`; // renamed or deleted mid-scan: never fail the request
        }
    }).join('|');
}

/**
 * Track #1682: a renamed post lists its old slugs in front matter `aliases`
 * (a string or a list). Returns the current slug for an old one, or null.
 * The alias map is built once and rebuilt only when a post file is added,
 * removed or changed (a stat per file, no parsing, on a cache hit). Callers
 * check getPost first, so a real post with that slug always wins.
 */
export const findPostByAlias = (postsDir: string, slug: string): string | null => {
    if (!SLUG_RE.test(slug) || !fs.existsSync(postsDir)) return null;
    const files = fs.readdirSync(postsDir).filter((f) => f.endsWith('.md')).sort();
    const sig = aliasSignature(postsDir, files);
    if (!aliasCache || aliasCache.dir !== postsDir || aliasCache.sig !== sig) {
        const map = new Map<string, string>();
        for (const f of files) {
            try {
                const { data } = parseFrontMatter(fs.readFileSync(path.join(postsDir, f), 'utf8'));
                // A draft is private: an old link must not lead to it.
                if (postStatus(data) === 'draft') continue;
                const raw = data.aliases;
                const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
                for (const a of list) if (typeof a === 'string' && SLUG_RE.test(a) && !map.has(a)) map.set(a, f.replace(/\.md$/, ''));
            } catch (error) {
                console.warn(`[WARN] aliases in ${f} not read: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        aliasCache = { dir: postsDir, sig, map };
    }
    return aliasCache.map.get(slug) ?? null;
};
