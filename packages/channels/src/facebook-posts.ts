import { MetaRequestError } from './meta.js';
export interface FacebookPost {
  id: string;
  text: string;
  permalink: string;
  media: { title: string; description: string }[];
  fetchedAt: string;
}
export interface FacebookThread {
  post: FacebookPost;
  text: string;
  authorId: string;
  parentText: string;
  createdAt: string;
}
const rec = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const fields = 'id,message,from,permalink_url,attachments{title,description},created_time';
/** All requests stay on Graph; no URLs from webhook bodies are fetched. */
export class FacebookPostsAdapter {
  constructor(
    private readonly version = 'v24.0',
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async request(
    token: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.transport(`https://graph.facebook.com/${this.version}/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
    } catch {
      throw new MetaRequestError('delivery_unknown', true);
    }
    const data = rec(await res.json().catch(() => null));
    if (!res.ok || data.error) {
      const code = rec(data.error).code;
      throw new MetaRequestError(
        code === 190
          ? 'auth_expired'
          : code === 10 || code === 200
            ? 'permission_denied'
            : 'provider_rejected',
        res.status >= 500,
      );
    }
    return data;
  }
  private post(data: Record<string, unknown>, pageId: string): FacebookPost {
    if (!str(data.id).startsWith(`${pageId}_`) || rec(data.from).id !== pageId)
      throw new MetaRequestError('post_not_owned');
    const media = rec(data.attachments).data;
    return {
      id: str(data.id),
      text: str(data.message).slice(0, 12000),
      permalink: str(data.permalink_url).slice(0, 2000),
      media: (Array.isArray(media) ? media : []).slice(0, 10).map((v) => ({
        title: str(rec(v).title).slice(0, 500),
        description: str(rec(v).description).slice(0, 2000),
      })),
      fetchedAt: new Date().toISOString(),
    };
  }
  async list(asset: { externalId: string; token: string }): Promise<FacebookPost[]> {
    const data = await this.request(
      asset.token,
      `${encodeURIComponent(asset.externalId)}/published_posts?fields=${encodeURIComponent(fields)}&limit=50`,
    );
    return (Array.isArray(data.data) ? data.data : []).map((v) =>
      this.post(rec(v), asset.externalId),
    );
  }
  async thread(
    asset: { externalId: string; token: string },
    postId: string,
    commentId: string,
  ): Promise<FacebookThread> {
    if (!postId.startsWith(`${asset.externalId}_`)) throw new MetaRequestError('post_not_owned');
    const post = this.post(
      await this.request(
        asset.token,
        `${encodeURIComponent(postId)}?fields=${encodeURIComponent(fields)}`,
      ),
      asset.externalId,
    );
    if (post.id !== postId) throw new MetaRequestError('post_mismatch');
    const comment = await this.request(
      asset.token,
      `${encodeURIComponent(commentId)}?fields=id,message,from,parent{id,message},object{id},created_time`,
    );
    if (comment.id !== commentId || rec(comment.object).id !== postId)
      throw new MetaRequestError('comment_not_owned');
    const createdAt = str(comment.created_time);
    if (!Number.isFinite(Date.parse(createdAt))) throw new MetaRequestError('invalid_comment_time');
    return {
      post,
      text: str(comment.message).slice(0, 4000),
      authorId: str(rec(comment.from).id),
      parentText: str(rec(comment.parent).message).slice(0, 4000),
      createdAt,
    };
  }
  async act(
    asset: { externalId: string; token: string },
    commentId: string,
    kind: 'public_reply' | 'private_reply' | 'hide' | 'unhide',
    text: string,
  ): Promise<{ externalId: string; recipientId: string | null }> {
    const id = encodeURIComponent(commentId);
    const path =
      kind === 'public_reply'
        ? `${id}/comments`
        : kind === 'private_reply'
          ? `${encodeURIComponent(asset.externalId)}/messages`
          : id;
    const body =
      kind === 'public_reply'
        ? { message: text }
        : kind === 'private_reply'
          ? { recipient: { comment_id: commentId }, message: { text } }
          : { is_hidden: kind === 'hide' };
    const data = await this.request(asset.token, path, body);
    const externalId = str(data.id) || str(data.message_id);
    if (kind.endsWith('reply') ? !externalId : data.success !== true)
      throw new MetaRequestError('delivery_unknown', true);
    return { externalId: externalId || commentId, recipientId: str(data.recipient_id) || null };
  }
}
