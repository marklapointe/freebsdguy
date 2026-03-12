import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

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
        return [];
    }

    const files = fs.readdirSync(postsDir);
    const posts = files.filter(f => f.endsWith('.md')).map(filename => {
        const content = fs.readFileSync(path.join(postsDir, filename), 'utf8');
        const { data, content: mdContent } = matter(content);
        return {
            slug: filename.replace('.md', ''),
            title: data.title || filename.replace('.md', ''),
            summary: data.summary || mdContent.substring(0, 150) + '...',
            date: data.date || '',
            ...data
        } as PostMetadata;
    });

    return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

export const getPost = (postsDir: string, slug: string): Post | null => {
    const filePath = path.join(postsDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) {
        return null;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const { data, content: mdContent } = matter(content);
    return {
        title: data.title || slug,
        slug,
        content: mdContent,
        summary: data.summary || mdContent.substring(0, 150) + '...',
        date: data.date || '',
        author: data.author || '',
        ...data
    };
};

export const savePost = (postsDir: string, post: Partial<Post> & { slug: string; content: string; author: string }): void => {
    if (!fs.existsSync(postsDir)) {
        fs.mkdirSync(postsDir, { recursive: true });
    }

    const frontmatter = {
        title: post.title || '',
        summary: post.summary || '',
        date: post.date || new Date().toISOString(),
        author: post.author || ''
    };

    const fileContent = matter.stringify(post.content, frontmatter);
    fs.writeFileSync(path.join(postsDir, `${post.slug}.md`), fileContent);
};
