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
    [key: string]: any;
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
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const { data, content: mdContent } = matter(content);
            const pinned = data.pinned === true || data.pinned === 'true';
            return {
                slug: filename.replace('.md', ''),
                title: data.title || filename.replace('.md', ''),
                summary: data.summary || mdContent.substring(0, 150) + '...',
                date: data.date || '',
                author: data.author || '',
                ...data,
                pinned
            } as PostMetadata;
        } catch (error) {
            console.error(`Error parsing post ${filename}:`, error);
            return {
                slug: filename.replace('.md', ''),
                title: `Error: ${filename}`,
                summary: 'This post could not be loaded due to a parsing error.',
                date: '',
                author: 'system'
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
        const parsed = matter(content);
        const pinned = parsed.data.pinned === true || parsed.data.pinned === 'true';
        return {
            title: parsed.data.title || slug,
            slug,
            content: parsed.content,
            summary: parsed.data.summary || parsed.content.substring(0, 150) + '...',
            date: parsed.data.date || '',
            author: parsed.data.author || '',
            ...parsed.data,
            pinned
        };
    } catch (error) {
        console.error(`Error parsing post ${slug}:`, error);
        return {
            title: `Error: ${slug}`,
            slug,
            content: `This post could not be loaded due to a parsing error: ${error instanceof Error ? error.message : String(error)}`,
            summary: 'Parsing error',
            date: '',
            author: 'system'
        };
    }
};

export const savePost = (postsDir: string, post: Partial<Post> & { slug: string; content: string; author: string }): void => {
    if (!fs.existsSync(postsDir)) {
        fs.mkdirSync(postsDir, { recursive: true });
    }

    // Metadata only is HTML-stripped; body stays Markdown (authors are authenticated).
    const cleanTitle = sanitizeHtml(String(post.title || ''), { allowedTags: [], allowedAttributes: {} });
    const cleanSummary = sanitizeHtml(String(post.summary || ''), { allowedTags: [], allowedAttributes: {} });
    const content = String(post.content ?? '');

    const frontmatter = {
        title: cleanTitle,
        summary: cleanSummary,
        date: String(post.date || new Date().toISOString()),
        author: String(post.author || ''),
        pinned: post.pinned === true
    };

    try {
        const fileContent = matter.stringify(content, frontmatter);
        fs.writeFileSync(path.join(postsDir, `${post.slug}.md`), fileContent);
    } catch (error) {
        console.error(`Error saving post ${post.slug}:`, error);
        // Fallback to simple manual construction if matter.stringify fails for some reason
        const manualContent = `---\ntitle: "${frontmatter.title.replace(/"/g, '\\"')}"\nsummary: "${frontmatter.summary.replace(/"/g, '\\"')}"\ndate: "${frontmatter.date}"\nauthor: "${frontmatter.author}"\npinned: ${frontmatter.pinned}\n---\n${content}`;
        fs.writeFileSync(path.join(postsDir, `${post.slug}.md`), manualContent);
    }
};
