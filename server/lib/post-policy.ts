/**
 * Who may write, publish and see a post (Track #2119 U4a).
 *
 * The rules:
 *   - a new post is a draft, stamped with the caller's username; an `author`
 *     in the input is ignored;
 *   - an existing post may only be saved by its author, or by an admin that
 *     holds the `moderate` scope (an unscoped session counts as holding it);
 *   - a save keeps the author, the status, the publishedAt and every other
 *     front-matter key the input does not name;
 *   - a draft is private: only its author and the admins may see it.
 */
import { getPost, postStatus, readFrontMatter, savePost, FrontMatterParseError } from './posts.ts';
import { writeAudit } from './audit-log.ts';
import { scopeDeniedMessage, type TokenScopes } from './token-scope.ts';

/** The refusal a caller gets for a post that is not theirs. */
export const NOT_YOUR_POST = 'Not your post';

/** The refusal a caller gets for a post that does not exist. */
export const POST_NOT_FOUND = 'Post not found';

export interface PostCaller {
    username: string;
    role: string;
    /** Undefined for a JWT or session caller: an unscoped caller holds every scope. */
    scopes?: TokenScopes;
}

/** Whether the caller may save a post that belongs to `author`. */
export function mayWritePost(author: string | undefined, caller: PostCaller): boolean {
    if (author && author === caller.username) return true;
    if (caller.role !== 'admin') return false;
    // An admin may edit anyone's post, but only with the moderation scope.
    return !caller.scopes || caller.scopes.includes('moderate');
}

/**
 * Whether the caller may see the post. A draft is private: its author sees it,
 * and so does an admin that holds the moderation scope — a read-only token
 * never sees a draft that is not its own.
 */
export function maySeePost(
    post: { author?: string; status?: unknown } | null | undefined,
    caller: PostCaller
): boolean {
    if (!post) return false;
    if (postStatus(post) !== 'draft') return true;
    if (post.author && post.author === caller.username) return true;
    if (caller.role !== 'admin') return false;
    return !caller.scopes || caller.scopes.includes('moderate');
}

export interface SavePostInput {
    slug: string;
    title?: string;
    content: string;
    summary?: string;
    date?: string;
    pinned?: boolean;
}

/**
 * The refusal for a post file that cannot be read or whose front matter does
 * not parse, or null when the file is fine. A post that does not exist yet is
 * fine: it has no front matter yet and it may be created.
 *
 * The message names no parser error, no line of the file and nothing of the
 * body: the real error goes to the server log.
 */
function frontMatterRefusal(postsDir: string, slug: string): string | null {
    try {
        readFrontMatter(postsDir, slug);
        return null;
    } catch (error) {
        if (error instanceof FrontMatterParseError) return error.message;
        throw error;
    }
}

export type PostWriteResult =
    | { ok: true; slug: string; created: boolean }
    | { ok: false; error: string };

/**
 * Save a post as the caller. A slug that does not exist yet becomes a draft
 * stamped with the caller's name; an existing post keeps its author, its
 * status and the front-matter keys the input does not name.
 */
export function savePostAsCaller(
    postsDir: string,
    input: SavePostInput,
    caller: PostCaller
): PostWriteResult {
    // A file whose front matter does not parse is never written over: the
    // bytes stay for an operator to inspect and nothing is published from
    // them. The check comes first: the owner of a file that does not parse is
    // unknown, so the own-post rule cannot be applied to it.
    const refusal = frontMatterRefusal(postsDir, input.slug);
    if (refusal) return { ok: false, error: refusal };

    const existing = getPost(postsDir, input.slug);
    if (existing && !mayWritePost(existing.author, caller)) {
        return { ok: false, error: NOT_YOUR_POST };
    }
    const created = !existing;
    savePost(postsDir, {
        slug: input.slug,
        title: input.title,
        content: input.content,
        summary: input.summary,
        date: input.date,
        pinned: input.pinned,
        // The author is stamped by the server: the caller on a new post, the
        // existing author on a post that already exists.
        author: existing ? existing.author : caller.username,
        status: created ? 'draft' : postStatus(existing)
    });
    writeAudit({
        event: 'post',
        action: created ? 'create' : 'update',
        slug: input.slug,
        user: caller.username
    });
    return { ok: true, slug: input.slug, created };
}

/**
 * Publish a post: status becomes published and publishedAt is stamped once.
 * The own-post rule applies — an admin may publish anyone's post only with the
 * moderation scope.
 */
export function publishPostAsCaller(
    postsDir: string,
    slug: string,
    caller: PostCaller
): PostWriteResult {
    // A file whose front matter does not parse is never published and never
    // written over: publishing it would write the parse-error stub body and
    // a published status over the broken bytes.
    const refusal = frontMatterRefusal(postsDir, slug);
    if (refusal) return { ok: false, error: refusal };

    const existing = getPost(postsDir, slug);
    if (!existing) return { ok: false, error: POST_NOT_FOUND };
    if (!mayWritePost(existing.author, caller)) return { ok: false, error: NOT_YOUR_POST };
    const stamped = existing.publishedAt;
    const publishedAt =
        typeof stamped === 'string' && stamped ? stamped : new Date().toISOString();
    savePost(postsDir, {
        slug,
        content: existing.content,
        status: 'published',
        publishedAt
    });
    writeAudit({ event: 'post', action: 'publish', slug, user: caller.username });
    return { ok: true, slug, created: false };
}

/** Unpublish a post: it becomes a draft again. Moderation, so an admin only. */
export function unpublishPostAsCaller(
    postsDir: string,
    slug: string,
    caller: PostCaller
): PostWriteResult {
    if (caller.role !== 'admin') {
        return { ok: false, error: 'Forbidden: admin required' };
    }
    if (caller.scopes && !caller.scopes.includes('moderate')) {
        return { ok: false, error: scopeDeniedMessage('moderate') };
    }
    // A file whose front matter does not parse is never written over, not
    // even to turn it into a draft.
    const refusal = frontMatterRefusal(postsDir, slug);
    if (refusal) return { ok: false, error: refusal };

    const existing = getPost(postsDir, slug);
    if (!existing) return { ok: false, error: POST_NOT_FOUND };
    savePost(postsDir, {
        slug,
        content: existing.content,
        status: 'draft'
    });
    writeAudit({ event: 'post', action: 'unpublish', slug, user: caller.username });
    return { ok: true, slug, created: false };
}
