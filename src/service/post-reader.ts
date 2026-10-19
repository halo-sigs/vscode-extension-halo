import type { Content, ListedPost, Post } from "@halo-dev/api-client";
import * as vscode from "vscode";
import type { HaloClient } from "../api/halo-client";
import { getAxiosErrorDetail } from "../utils/axios-error";
import { replaceDocumentContent } from "../utils/document";
import { isHaloApiError } from "../utils/halo-api-error";
import log from "../utils/log";
import { mergeMatter, readMatter } from "../utils/yaml";
import type { Taxonomy } from "./taxonomy";
import type { FetchResult } from "./types";

/** getPost 的网络/服务器错误（区别于 404 文章不存在），调用方应中止而非降级新建 */
export class PostFetchError extends Error {
  /** 底层错误（多为拦截器翻译后的 HaloApiError），用户文案从这里取 */
  public readonly cause: unknown;

  constructor(
    public readonly postName: string,
    detail: string,
    cause?: unknown,
  ) {
    super(`Failed to fetch post ${postName}: ${detail}`);
    this.cause = cause;
  }
}

/** getPost 失败的用户文案：底层为 HaloApiError 时直接用其翻译文案（含权限标注），避免多层包装 */
export function postFetchFailureMessage(error: unknown): string {
  const cause = error instanceof PostFetchError ? error.cause : error;
  if (isHaloApiError(cause)) {
    return cause.message;
  }
  return `${vscode.l10n.t("Failed to fetch the post from the server, please retry")} (${getAxiosErrorDetail(error) || String(error)})`;
}

/** 文章读取：拉取文章与内容快照、按服务器状态刷新/落地本地文档 */
export class PostReader {
  constructor(
    private readonly client: HaloClient,
    private readonly taxonomy: Taxonomy,
  ) {}

  /**
   * 获取文章（Post + 内容快照）。
   * @returns 文章数据；文章不存在（404）返回 undefined；
   * 其他错误（网络/5xx/超时）抛出 PostFetchError——调用方必须中止发布，
   * 严禁降级为"新建"，否则一次网络抖动就会产生重复文章
   */
  async getPost(
    name: string,
  ): Promise<{ post: Post; content: Content } | undefined> {
    try {
      const { data: post } = await this.client.postApi.getMyPost({ name });

      const { data: snapshot } = await this.client.postApi.getMyPostDraft({
        name,
        patched: true,
      });

      const {
        "content.halo.run/patched-content": patchedContent,
        "content.halo.run/patched-raw": patchedRaw,
      } = snapshot.metadata.annotations || {};

      const { rawType } = snapshot.spec || {};

      const content: Content = {
        content: patchedContent,
        raw: patchedRaw,
        rawType,
      };

      return Promise.resolve({
        post: post,
        content: content,
      });
    } catch (error) {
      if (isHaloApiError(error) && error.kind === "notFound") {
        // 文章确实不存在（如服务器端被删除），返回 undefined 让调用方决策
        return undefined;
      }
      // 权限/网络/服务器错误：抛出，由调用方中止流程。
      // message 已含权限标注或服务器原因（拦截器翻译）
      throw new PostFetchError(
        name,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
  }

  async getPosts(): Promise<ListedPost[]> {
    const { data: posts } = await this.client.postApi.listMyPosts({
      labelSelector: ["content.halo.run/deleted=false"],
    });
    return posts.items;
  }

  /**
   * 从服务器拉取文章最新元数据并刷新文档 frontmatter（按 Uri 操作）。
   * 不弹通知：失败原因写日志并通过返回值汇报，由命令层汇总提示
   */
  async updatePost(uri: vscode.Uri): Promise<FetchResult> {
    const doc = await vscode.workspace.openTextDocument(uri);
    await doc.save();

    const { data: matterData } = readMatter(doc.getText());

    if (!matterData.halo?.name) {
      const msg = vscode.l10n.t("Please publish the post first");
      log.error(msg);
      return { ok: false, issue: msg };
    }

    let post: Awaited<ReturnType<PostReader["getPost"]>>;
    try {
      post = await this.getPost(matterData.halo.name);
    } catch (error) {
      const msg = postFetchFailureMessage(error);
      log.error(msg);
      return { ok: false, issue: msg };
    }

    if (!post) {
      const msg = vscode.l10n.t("Post not found");
      log.error(msg);
      return { ok: false, issue: msg };
    }

    const postCategories = await this.taxonomy.getCategoryDisplayNames(
      post.post.spec.categories,
    );
    const postTags = await this.taxonomy.getTagDisplayNames(
      post.post.spec.tags,
    );

    const modifiedContent = mergeMatter(`${post.content.raw}`, {
      title: post.post.spec.title,
      slug: post.post.spec.slug,
      excerpt: post.post.spec.excerpt.autoGenerate
        ? undefined
        : post.post.spec.excerpt.raw,
      cover: post.post.spec.cover || undefined,
      // 发布时间拉取到 frontmatter（服务器的 publishTime）
      date: post.post.spec.publishTime || undefined,
      categories: postCategories,
      tags: postTags,
      halo: {
        site: this.client.site.url,
        name: post.post.metadata.name,
        publish: post.post.spec.publish,
      },
    });

    await replaceDocumentContent(uri, modifiedContent);
    return { ok: true };
  }

  /**
   * 拉取文章到本地（优先调用方指定的目录，否则工作区根目录）。
   * 不弹通知：失败原因写日志并通过返回值汇报，由命令层汇总提示
   */
  async pullPost(
    name: string,
    targetFolder?: vscode.Uri,
  ): Promise<FetchResult> {
    let post: Awaited<ReturnType<PostReader["getPost"]>>;
    try {
      post = await this.getPost(name);
    } catch (error) {
      const msg = postFetchFailureMessage(error);
      log.error(msg);
      return { ok: false, issue: msg };
    }

    if (!post) {
      const msg = vscode.l10n.t("Post not found");
      log.error(msg);
      return { ok: false, issue: msg };
    }

    // 优先使用调用方指定的目录（资源管理器右键），否则工作区根目录
    const folderUri =
      targetFolder ?? vscode.workspace.workspaceFolders?.[0].uri;

    if (!folderUri) {
      const msg = vscode.l10n.t("No workspace folder found");
      log.error(msg);
      return { ok: false, issue: msg };
    }

    const fileName = `${post.post.spec.title}.md`;
    const fileUri = vscode.Uri.joinPath(folderUri, fileName);

    try {
      const fileExists = await vscode.workspace.fs.stat(fileUri);
      if (fileExists) {
        const msg = `${vscode.l10n.t("File already exists")}: ${fileName}`;
        log.error(msg);
        return { ok: false, issue: msg };
      }
    } catch {}

    const postCategories = await this.taxonomy.getCategoryDisplayNames(
      post.post.spec.categories,
    );
    const postTags = await this.taxonomy.getTagDisplayNames(
      post.post.spec.tags,
    );

    const modifiedContent = mergeMatter(`${post.content.raw}`, {
      title: post.post.spec.title,
      slug: post.post.spec.slug,
      excerpt: post.post.spec.excerpt.autoGenerate
        ? undefined
        : post.post.spec.excerpt.raw,
      cover: post.post.spec.cover || undefined,
      // 发布时间拉取到 frontmatter（服务器的 publishTime）
      date: post.post.spec.publishTime || undefined,
      categories: postCategories,
      tags: postTags,
      halo: {
        site: this.client.site.url,
        name: name,
        publish: post.post.spec.publish,
      },
    });

    const buffer = Buffer.from(modifiedContent);
    const fileData = new Uint8Array(buffer);
    await vscode.workspace.fs.writeFile(fileUri, fileData);

    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc);
    return { ok: true };
  }
}
