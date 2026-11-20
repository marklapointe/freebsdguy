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
 *   - a draft is private: only its author and the admins may see it;
 *   - a contributor may delete only an own draft that was never published: an
 *     unpublished post keeps `publishedAt` (rollback needs it) and is not the
 *     author's to destroy;
 *   - a post the caller may not see is answered as if it did not exist, so a
 *     delete cannot be used to probe which draft slugs exist.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPost, postStatus, readFrontMatter, savePost, FrontMatterParseError, UnsafePostPathError, isSafePostFile, type PostMetadata, type PostStatus } from './posts.ts';
import { writeAudit } from './audit-log.ts';
import { validatePostContent } from './post-content.ts';
import { scopeDeniedMessage, type TokenScopes } from './token-scope.ts';
import type { AuditFields, AuthVia } from './audit-context.ts';

/** The refusal a caller gets for a post that is not theirs. */
export const NOT_YOUR_POST = 'Not your post';

/** The refusal a caller gets for a post that does not exist. */
export const POST_NOT_FOUND = 'Post not found';

/** The refusal a caller gets when they are not allowed to delete a post. */
export const NOT_ALLOWED_TO_DELETE = 'Not allowed to delete this post';

export interface PostCaller {
    username: string;
    role: string;
    /** Undefined for a JWT or session caller: an unscoped caller holds every scope. */
    scopes?: TokenScopes;
    /** The id of the personal access token that authenticated the caller. */
    tokenId?: string;
    /** How the caller authenticated. */
    via?: AuthVia;
    /** The address the caller came from. */
    ip?: string;
    /** The site this server serves. */
    site?: string;
}

/** The audit fields of a caller: who acted, how, and from where. */
function auditFields(caller: PostCaller): AuditFields {
    const fields: AuditFields = {};
    if (caller.tokenId) fields.tokenId = caller.tokenId;
    if (caller.via) fields.via = caller.via;
    if (caller.ip) fields.ip = caller.ip;
    if (caller.site) fields.site = caller.site;
    return fields;
}

/**
 * The sha256 of the bytes of a post file, or null when there is no file.
 * The hash says which bytes are on disk; the post itself never reaches the
 * audit log.
 */
export function postFileSha256(postsDir: string, slug: string): string | null {
    try {
        const filePath = path.join(postsDir, `${slug}.md`);
        if (!fs.existsSync(filePath)) return null;
        return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    } catch {
        return null;
    }
}

/**
 * Whether the post has ever been published. Publishing stamps `publishedAt`
 * once and a later unpublish keeps it, so a draft that carries the stamp was
 * published before: it is kept for rollback, not deleted.
 */
export function everPublished(post: PostMetadata | null | undefined): boolean {
    const stamped = post?.publishedAt;
    if (stamped instanceof Date) return !Number.isNaN(stamped.getTime());
    return typeof stamped === 'string' && stamped.trim() !== '';
}

/**
 * Whether the caller may delete a post. A contributor may delete only their own
 * draft that was never published. An admin may delete their own posts or any
 * post when they hold the moderation scope; an unscoped JWT/session admin
 * counts as holding it.
 */
export function mayDeletePost(
    author: string | undefined,
    status: PostStatus,
    wasPublished: boolean,
    caller: PostCaller
): boolean {
    const isOwn: boolean = author !== undefined && author !== '' && author === caller.username;
    if (caller.role === 'contributor') {
        return isOwn && status === 'draft' && !wasPublished;
    }
    // Any role that is not an admin fails closed.
    if (caller.role !== 'admin') return false;
    // Admin: own post, or any post with the moderation scope.
    return isOwn || !caller.scopes || caller.scopes.includes('moderate');
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
        // A symlink, or a path that leaves the posts directory (P0 C1).
        if (error instanceof UnsafePostPathError) return error.message;
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
    // Dangerous URL schemes and raw HTML are refused at write time (P0 D1/D2).
    const content = validatePostContent(input);
    if (!content.ok) return { ok: false, error: content.error };
    const created = !existing;
    const beforeSha256 = postFileSha256(postsDir, input.slug);
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
        user: caller.username,
        beforeSha256,
        afterSha256: postFileSha256(postsDir, input.slug),
        ...auditFields(caller)
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
    // A post is public once published: it must pass the same content rules (P0 D1/D2).
    const content = validatePostContent(existing);
    if (!content.ok) return { ok: false, error: content.error };
    const stamped = existing.publishedAt;
    const publishedAt =
        typeof stamped === 'string' && stamped ? stamped : new Date().toISOString();
    const beforeSha256 = postFileSha256(postsDir, slug);
    savePost(postsDir, {
        slug,
        content: existing.content,
        status: 'published',
        publishedAt
    });
    writeAudit({
        event: 'post',
        action: 'publish',
        slug,
        user: caller.username,
        beforeSha256,
        afterSha256: postFileSha256(postsDir, slug),
        ...auditFields(caller)
    });
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
    const beforeSha256 = postFileSha256(postsDir, slug);
    savePost(postsDir, {
        slug,
        content: existing.content,
        status: 'draft'
    });
    writeAudit({
        event: 'post',
        action: 'unpublish',
        slug,
        user: caller.username,
        beforeSha256,
        afterSha256: postFileSha256(postsDir, slug),
        ...auditFields(caller)
    });
    return { ok: true, slug, created: false };
}

/**
 * Delete a post. The row names the bytes that were on disk before the delete
 * and says that nothing is there any more.
 *
 * A contributor may delete only their own draft that was never published. An
 * admin may delete any post only when it is their own or when they hold the
 * moderation scope. A missing or unparseable post is never deleted by a
 * contributor (and an unparseable post is refused for everyone, since its
 * owner cannot be determined).
 *
 * A post the caller may not see is answered exactly like a missing one: the
 * delete must not become a probe for the slugs of other authors' drafts. The
 * refusal is still audited. An admin without the moderation scope is a trusted
 * operator and keeps the plain 403: hiding drafts from an admin is not what
 * the existence rule is for, and its rule is unchanged.
 */
export function deletePostAsCaller(
    postsDir: string,
    slug: string,
    caller: PostCaller
): PostWriteResult {
    const filePath = path.join(postsDir, `${slug}.md`);
    // A symlink (or a path behind one) is never deleted through, and it is
    // answered as a missing post (P0 C1).
    if (!isSafePostFile(postsDir, slug)) {
        writeAudit({
            event: 'post',
            action: 'delete',
            slug,
            user: caller.username,
            outcome: 'denied',
            reason: 'unsafe_path',
            beforeSha256: null,
            afterSha256: null,
            ...auditFields(caller)
        });
        return { ok: false, error: POST_NOT_FOUND };
    }
    if (!fs.existsSync(filePath)) {
        writeAudit({
            event: 'post',
            action: 'delete',
            slug,
            user: caller.username,
            outcome: 'denied',
            reason: 'not_found',
            beforeSha256: null,
            afterSha256: null,
            ...auditFields(caller)
        });
        return { ok: false, error: POST_NOT_FOUND };
    }

    // A file whose front matter does not parse is never deleted: the owner is
    // unknown and the broken bytes stay for an operator to inspect.
    const refusal = frontMatterRefusal(postsDir, slug);
    if (refusal) {
        writeAudit({
            event: 'post',
            action: 'delete',
            slug,
            user: caller.username,
            outcome: 'denied',
            reason: 'parse_error',
            beforeSha256: postFileSha256(postsDir, slug),
            afterSha256: postFileSha256(postsDir, slug),
            ...auditFields(caller)
        });
        return { ok: false, error: refusal };
    }

    const existing = getPost(postsDir, slug);
    if (!existing) {
        writeAudit({
            event: 'post',
            action: 'delete',
            slug,
            user: caller.username,
            outcome: 'denied',
            reason: 'not_found',
            beforeSha256: postFileSha256(postsDir, slug),
            afterSha256: null,
            ...auditFields(caller)
        });
        return { ok: false, error: POST_NOT_FOUND };
    }

    // A post this caller may not see must look missing, not forbidden: a 403
    // would tell a contributor which draft slugs exist. The audit row keeps the
    // truth. Admins keep the 403 (their rule is unchanged).
    if (caller.role !== 'admin' && !maySeePost(existing, caller)) {
        writeAudit({
            event: 'post',
            action: 'delete',
            slug,
            user: caller.username,
            outcome: 'denied',
            reason: 'not_owner',
            beforeSha256: postFileSha256(postsDir, slug),
            afterSha256: postFileSha256(postsDir, slug),
            ...auditFields(caller)
        });
        return { ok: false, error: POST_NOT_FOUND };
    }

    const status = postStatus(existing);
    const wasPublished = everPublished(existing);
    if (!mayDeletePost(existing.author, status, wasPublished, caller)) {
        // A published post is refused as published; a draft that was published
        // once is refused as was_published (it is kept for rollback); any other
        // refusal is an ownership one.
        const reason =
            status !== 'draft' ? 'published' : wasPublished ? 'was_published' : 'not_owner';
        writeAudit({
            event: 'post',
            action: 'delete',
            slug,
            user: caller.username,
            outcome: 'denied',
            reason,
            beforeSha256: postFileSha256(postsDir, slug),
            afterSha256: postFileSha256(postsDir, slug),
            ...auditFields(caller)
        });
        return { ok: false, error: NOT_ALLOWED_TO_DELETE };
    }

    const beforeSha256 = postFileSha256(postsDir, slug);
    fs.unlinkSync(filePath);
    writeAudit({
        event: 'post',
        action: 'delete',
        slug,
        user: caller.username,
        beforeSha256,
        afterSha256: null,
        ...auditFields(caller)
    });
    return { ok: true, slug, created: false };
}
