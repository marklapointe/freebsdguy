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
    [key: string]: any;
}

export interface Post extends PostMetadata {
    content: string;
}

export const getPosts = (postsDir: string): PostMetadata[] => {
    if (!fs.existsSync(postsDir)) {
        try {
            fs.mkdirSync(postsDir, { recursive: true });
        } catch (error) {
            console.error(`Error creating posts directory ${postsDir}:`, error);
        }
        return [];
    }

    const files = fs.readdirSync(postsDir);
    const posts = files.filter(f => f.endsWith('.md')).map(filename => {
        const filePath = path.join(postsDir, filename);
        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const { data, content: mdContent } = matter(content);
            return {
                slug: filename.replace('.md', ''),
                title: data.title || filename.replace('.md', ''),
                summary: data.summary || mdContent.substring(0, 150) + '...',
                date: data.date || '',
                ...data
            } as PostMetadata;
        } catch (error) {
            console.error(`Error parsing post ${filename}:`, error);
            return {
                slug: filename.replace('.md', ''),
                title: `Error: ${filename}`,
                summary: 'This post could not be loaded due to a parsing error.',
                date: '',
                author: 'system'
            } as any;
        }
    }).filter((p): p is PostMetadata => p !== null);

    return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const getPost = (postsDir: string, slug: string): Post | null => {
    const filePath = path.join(postsDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    try {
        const parsed = matter(content);
        return {
            title: parsed.data.title || slug,
            slug,
            content: parsed.content,
            summary: parsed.data.summary || parsed.content.substring(0, 150) + '...',
            date: parsed.data.date || '',
            author: parsed.data.author || '',
            ...parsed.data
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

    const cleanTitle = sanitizeHtml(String(post.title || ''), { allowedTags: [], allowedAttributes: {} });
    const cleanSummary = sanitizeHtml(String(post.summary || ''), { allowedTags: [], allowedAttributes: {} });
    const cleanContent = sanitizeHtml(post.content);

    const frontmatter = {
        title: cleanTitle,
        summary: cleanSummary,
        date: String(post.date || new Date().toISOString()),
        author: String(post.author || '')
    };

    // Ensure all values are strings for gray-matter stringify
    const stringifiedData: any = {};
    for (const [key, value] of Object.entries(frontmatter)) {
        stringifiedData[key] = String(value);
    }

    try {
        const fileContent = matter.stringify(cleanContent, stringifiedData);
        fs.writeFileSync(path.join(postsDir, `${post.slug}.md`), fileContent);
    } catch (error) {
        console.error(`Error saving post ${post.slug}:`, error);
        // Fallback to simple manual construction if matter.stringify fails for some reason
        const manualContent = `---\ntitle: "${frontmatter.title.replace(/"/g, '\\"')}"\nsummary: "${frontmatter.summary.replace(/"/g, '\\"')}"\ndate: "${frontmatter.date}"\nauthor: "${frontmatter.author}"\n---\n${cleanContent}`;
        fs.writeFileSync(path.join(postsDir, `${post.slug}.md`), manualContent);
    }
};
