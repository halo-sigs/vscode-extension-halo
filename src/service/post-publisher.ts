import { createHash, randomUUID } from "node:crypto";
import type { Content, Post } from "@halo-dev/api-client";
import { slugify } from "transliteration";
import * as vscode from "vscode";
import type { HaloClient } from "../api/halo-client";
import { getAxiosErrorDetail } from "../utils/axios-error";
import { replaceDocumentContent } from "../utils/document";
import { isHaloApiError } from "../utils/halo-api-error";
import log from "../utils/log";
import markdownIt from "../utils/markdown";
import { PERMISSIONS, permissionLabel } from "../utils/permissions";
import { mergeMatter, readMatter } from "../utils/yaml";
import type { ImageProcessor } from "./image-processor";
import { type PostReader, postFetchFailureMessage } from "./post-reader";
import type { Taxonomy } from "./taxonomy";
import { CategoryTagPermissionError, type PublishResult } from "./types";
import path = require("node:path");

/** 发布流水线：图片处理 → 元数据准备 → 创建/更新 → 发布动作 → frontmatter 写回 */
export class PostPublisher {
  // 正在发布的文档锁：跨命令实例共享（服务实例是命令级的，锁必须挂在类上）。
  // 防止同一文档并发发布——两次发布都会因读不到 halo.name 走"新建"路径，产生重复文章
  private static readonly publishingUris = new Set<string>();

  constructor(
    private readonly client: HaloClient,
    private readonly reader: PostReader,
    private readonly taxonomy: Taxonomy,
    private readonly images: ImageProcessor,
  ) {}

  /**
   * 发布文档（按 Uri 操作，全程不依赖"当前编辑器"，并发切换焦点不影响发布目标）。
   * 不弹通知：过程问题写日志并汇入 issues，由命令层汇总成唯一一条提示。
   * @param report 可选的进度回调（图片处理阶段透传进度提示）
   * @returns 发布结果：published 成功 / skipped 内容未变更跳过 / failed 失败
   */
  async publishPost(
    uri: vscode.Uri,
    report?: (message: string, increment?: number) => void,
  ): Promise<PublishResult> {
    const lockKey = uri.toString();
    // 文件名用于日志定位，让用户知道是哪篇文档出的问题
    const fileLabel = path.basename(uri.fsPath);

    // 同一文档正在发布中，直接拒绝，避免重复创建文章
    if (PostPublisher.publishingUris.has(lockKey)) {
      const msg = `${vscode.l10n.t("This post is being published, please wait")}: ${fileLabel}`;
      log.error(msg);
      return { status: "failed", issues: [], failureReason: msg };
    }
    PostPublisher.publishingUris.add(lockKey);

    try {
      // 用文档引用保存（TextDocument.save）：workspace.save(uri) 要求文档
      // 已在编辑器中打开，批量发布未打开的文件时会空操作，留下脏文档
      const doc = await vscode.workspace.openTextDocument(uri);
      await doc.save();

      // 先处理图片（本地图片上传附件库、按配置转存外链图片），再发布文章。
      // 附件上传不依赖文章，无需"先发布再传图"
      const imageResult = await this.images.processImages(
        doc,
        report,
        fileLabel,
      );
      const issues = [...imageResult.issues];

      // 图片处理包含大量网络请求，耗时可能很长；期间未在编辑器显示的文档
      // 可能被 VS Code 卸载（旧引用会抛 "document has been closed"），
      // 此处重新打开（已打开则复用），再读最新内容
      const freshDoc = await vscode.workspace.openTextDocument(uri);
      const { content: raw, data: matterData } = readMatter(freshDoc.getText());

      // check site url
      if (
        matterData.halo?.site &&
        matterData.halo.site !== this.client.site.url
      ) {
        const msg = `${vscode.l10n.t("Site url is not matched")}: ${fileLabel}`;
        log.error(msg);
        return { status: "failed", issues, failureReason: msg };
      }

      // 内容未变更预检（零服务器请求）：已发布过且本地记录的正文 hash
      // 与当前正文一致时跳过，避免无谓的快照版本增长与封面插件竞态窗口。
      // hash 存 frontmatter halo 段（发布时被剥离不进正文）；
      // 本地改了正文 → hash 不匹配 → 正常重发。注意：只对比正文，
      // 改 frontmatter 元数据（title/slug/分类等）不会触发重发
      if (matterData.halo?.name && matterData.halo["content-hash"]) {
        const currentHash = this.contentHash(raw);
        if (currentHash === matterData.halo["content-hash"]) {
          return { status: "skipped", issues };
        }
      }

      let params: Post = {
        apiVersion: "content.halo.run/v1alpha1",
        kind: "Post",
        metadata: {
          annotations: {},
          name: "",
        },
        spec: {
          allowComment: true,
          baseSnapshot: "",
          categories: [],
          cover: "",
          deleted: false,
          excerpt: {
            autoGenerate: true,
            raw: "",
          },
          headSnapshot: "",
          htmlMetas: [],
          owner: "",
          pinned: false,
          priority: 0,
          publish: false,
          publishTime: "",
          releaseSnapshot: "",
          slug: "",
          tags: [],
          template: "",
          title: "",
          visible: "PUBLIC",
        },
      };

      let content: Content = {
        rawType: "markdown",
        raw: "",
        content: "",
      };

      // fetch post
      if (matterData.halo?.name) {
        let post: Awaited<ReturnType<PostReader["getPost"]>>;
        try {
          post = await this.reader.getPost(matterData.halo.name);
        } catch (error) {
          // 网络错误时严禁降级为"新建"——否则产生重复文章；明确报错让用户重试。
          // 文案直接取拦截器翻译结果（含权限标注），避免多层包装
          const failureReason = `${postFetchFailureMessage(error)}: ${fileLabel}`;
          log.error(failureReason);
          return { status: "failed", issues, failureReason };
        }

        if (post) {
          params = post.post;
          content = post.content;
        } else {
          // 404：服务器上没有这篇文章（被删除过）。走"新建"并记录问题，
          // 用户应知道旧 name 已失效
          const msg = `${vscode.l10n.t("The linked post no longer exists on the server, it will be re-created")}: ${fileLabel}`;
          log.info(msg);
          issues.push(msg);
        }
      }

      content.raw = raw;
      content.content = markdownIt.render(raw);

      // restore metadata
      if (matterData.title) {
        params.spec.title = matterData.title;
      }

      if (matterData.slug) {
        params.spec.slug = matterData.slug;
      }

      if (matterData.excerpt) {
        params.spec.excerpt.raw = matterData.excerpt;
        params.spec.excerpt.autoGenerate = false;
      }

      if (matterData.cover) {
        params.spec.cover = matterData.cover;
      }

      // 发布时间：frontmatter 的 date（可为空）推送到服务器。
      // YAML 解析出的 date 可能是 Date 对象或字符串，统一转 RFC3339
      if (matterData.date) {
        const dateValue =
          matterData.date instanceof Date
            ? matterData.date
            : new Date(String(matterData.date));
        if (!Number.isNaN(dateValue.getTime())) {
          params.spec.publishTime = dateValue.toISOString();
        }
      }

      if (matterData.categories) {
        const categoryNames = await this.taxonomy.getCategoryNames(
          matterData.categories,
        );
        params.spec.categories = categoryNames;
      }

      if (matterData.tags) {
        const tagNames = await this.taxonomy.getTagNames(matterData.tags);
        params.spec.tags = tagNames;
      }

      // 发布意图：frontmatter 显式指定 > publishByDefault 设置。
      // 单独抽出——失败核实（verifyUncertainPublish）需要判断服务器状态是否符合意图
      const haloMatter = matterData?.halo as
        | Record<string, unknown>
        | undefined;
      const publishIntent =
        "publish" in (haloMatter ?? {})
          ? Boolean(haloMatter?.publish)
          : vscode.workspace
              .getConfiguration("halo.post")
              .get<boolean>("publishByDefault", false);

      try {
        // Update post
        if (params.metadata.name) {
          await this.updatePostContentWithRetry(
            params.metadata.name,
            params,
            content,
          );
        } else {
          // Create a new post
          const fileName = path.basename(doc.fileName).replace(".md", "");
          params.metadata.name = randomUUID();
          params.spec.title = matterData.title || fileName;

          // slug 优先级：frontmatter 中的 slug > 用户配置的生成策略
          if (matterData.slug) {
            params.spec.slug = matterData.slug;
          } else {
            const slugStrategy = vscode.workspace
              .getConfiguration("halo.post")
              .get<"timestamp" | "pinyin">("slugStrategy", "timestamp");

            // 拼音策略走旧行为，其余（timestamp/非法值兜底）都走时间戳：
            // 服务器要求 slug 最小长度为 1，无法留空交给服务器生成
            // （后台的别名生成策略是 Console 前端实现的），
            // 时间戳与 Halo 后台的"时间戳"策略同格式
            if (slugStrategy === "pinyin") {
              params.spec.slug = slugify(fileName, { trim: true });
            } else {
              params.spec.slug = `${Date.now()}`;
            }
          }

          params.metadata.annotations = {
            ...params.metadata.annotations,
            "content.halo.run/content-json": JSON.stringify(content),
          };

          const { data: newPost } = await this.client.postApi.createMyPost({
            post: params,
          });

          params = newPost;
        }

        // frontmatter 显式指定时按其值发布/取消发布；未指定且默认发布开启时发布。
        // 发布动作同样可能被服务器端并发修改（封面插件）乐观锁冲突，带重试
        if ("publish" in (haloMatter ?? {}) || publishIntent) {
          await this.publishActionWithRetry(
            params.metadata.name,
            publishIntent,
          );
        }

        // Fetch new post and content
        const latestPost = await this.reader.getPost(params.metadata.name);

        if (latestPost) {
          params = latestPost.post;
        }
      } catch (error) {
        // 错误文案统一由响应拦截器翻译（403 已带权限标注），此处只做业务分支。
        // 无权限/服务器拒绝：写回 halo.name 保护（文章可能已创建）
        if (isHaloApiError(error)) {
          const failureReason = `${error.message}: ${fileLabel}`;
          log.error(failureReason);

          if (params.metadata.name) {
            try {
              const modifiedContent = mergeMatter(raw, {
                ...matterData,
                halo: {
                  site: this.client.site.url,
                  name: params.metadata.name,
                  publish: params.spec.publish,
                },
              });
              await replaceDocumentContent(uri, modifiedContent);
            } catch {
              // 写回失败时保持原报错，不再叠加噪音
            }
          }
          return { status: "failed", issues, failureReason };
        }

        const detail = getAxiosErrorDetail(error) || String(error);
        const failureReason = `${vscode.l10n.t("Publish failed, please try again")} (${detail}): ${fileLabel}`;
        log.error(failureReason);

        // 网络类失败（无 HTTP 状态：socket hang up / 超时等）结果不确定——
        // 请求可能已在服务器处理完成、仅响应丢失。文章 name 已知时重读服务器
        // 状态核实（幂等读）：正文一致且发布状态符合意图 → 改判"已发布"，
        // 彻底消除"客户端报失败、服务器实际成功"的误报
        const isNetworkError =
          isHaloApiError(error) && error.kind === "network";
        if (isNetworkError && params.metadata.name) {
          const verified = await this.verifyUncertainPublish(
            params.metadata.name,
            raw,
            publishIntent,
          );
          if (verified) {
            const msg = vscode.l10n.t(
              "The connection was interrupted, but the server was verified up to date",
            );
            log.info(`${msg}: ${fileLabel}`);
            issues.push(msg);
            return await this.writeBackPublishedFrontmatter(
              uri,
              raw,
              verified.post,
              issues,
            );
          }
        }

        // 关键：文章已在服务器创建/更新（仅后续步骤失败，如封面图插件
        // 并发改 post 导致的乐观锁冲突），必须把 halo.name 写回文档，
        // 否则下次发布会因读不到 name 再走"新建"路径，产生重复文章
        if (params.metadata.name) {
          try {
            const modifiedContent = mergeMatter(raw, {
              ...matterData,
              halo: {
                site: this.client.site.url,
                name: params.metadata.name,
                publish: params.spec.publish,
              },
            });
            await replaceDocumentContent(uri, modifiedContent);
          } catch {
            // 写回失败时保持原报错，不再叠加噪音
          }
        }

        return { status: "failed", issues, failureReason };
      }

      // 用服务端最新状态重建 frontmatter，并写入当前正文 hash
      // （供下次发布的未变更预检，零服务器请求跳过）
      return await this.writeBackPublishedFrontmatter(uri, raw, params, issues);
    } catch (error) {
      // 分类/标签创建 403：文章本身没问题，是元数据准备阶段缺管理权限。
      // 单独标注（提示创建哪个分类/标签、缺哪个权限），避免笼统的"请重试"
      if (error instanceof CategoryTagPermissionError) {
        const permission =
          error.kind === "tag"
            ? PERMISSIONS.tagManager
            : PERMISSIONS.categoryManager;
        const kindLabel = vscode.l10n.t(
          error.kind === "tag" ? "tag" : "category",
        );
        const msg = vscode.l10n.t(
          "Creating the {0} '{1}' denied: the personal access token lacks the permission {2}. Grant it in Halo Console, or create the {0} manually in the console first",
          kindLabel,
          error.displayName,
          permissionLabel(permission),
        );
        log.error(`${msg}: ${fileLabel}`);
        return {
          status: "failed",
          issues: [],
          failureReason: `${msg}: ${fileLabel}`,
        };
      }

      // 全流程兜底：任何未预料的异常（如 "document has been closed"——
      // 长时间网络操作后文档被 VS Code 卸载）都不向外抛出，避免批量发布
      // 循环被单个文档炸掉；报错带文件名，用户能定位是哪篇出的问题
      const detail = getAxiosErrorDetail(error) || String(error);
      const msg = `${vscode.l10n.t("Publish failed, please try again")}: ${fileLabel} (${detail})`;
      log.error(msg);
      return { status: "failed", issues: [], failureReason: msg };
    } finally {
      PostPublisher.publishingUris.delete(lockKey);
    }
  }

  /**
   * 核实"结果不确定"的网络失败：重读服务器文章状态（幂等读），
   * 正文 hash 一致且发布状态符合意图（不符则补一次发布/取消发布）时视为成功。
   * @returns 服务器最新文章数据（核实通过）；核实不通过（内容不一致/
   *           服务器无此文章/重读自身失败/补发布失败）返回 undefined
   */
  private async verifyUncertainPublish(
    name: string,
    raw: string,
    publishIntent: boolean,
  ): Promise<{ post: Post; content: Content } | undefined> {
    try {
      const post = await this.reader.getPost(name);
      if (!post) {
        return undefined;
      }

      // 正文一致：本次内容已到达服务器（挂起/断连丢的只是响应）
      if (this.contentHash(post.content.raw ?? "") !== this.contentHash(raw)) {
        return undefined;
      }

      // 发布状态与意图不符（发布/取消发布的请求丢了）：补一次幂等操作
      if (post.post.spec.publish !== publishIntent) {
        try {
          if (publishIntent) {
            await this.client.postApi.publishMyPost({ name });
          } else {
            await this.client.postApi.unpublishMyPost({ name });
          }
          // 补操作后重读，拿最新 permalink 等 status
          const refreshed = await this.reader.getPost(name);
          return refreshed ?? post;
        } catch {
          // 补发布失败：不能确认成功，维持失败判定
          return undefined;
        }
      }

      return post;
    } catch {
      // 核实请求本身失败（网络仍不通）：无法确认，维持失败判定
      return undefined;
    }
  }

  /**
   * 用服务端最新状态重建 frontmatter：title/slug/excerpt/cover 从服务器取，
   * 服务端有而文档缺失的字段（title 兜底文件名、slug 生成策略、
   * 封面图插件生成的 cover 等）才能写回文档。
   * 同时写入当前正文 hash，供下次发布的未变更预检（零服务器请求跳过）
   */
  private async writeBackPublishedFrontmatter(
    uri: vscode.Uri,
    raw: string,
    post: Post,
    issues: string[],
  ): Promise<PublishResult> {
    const [postCategories, postTags] = await Promise.all([
      this.taxonomy.getCategoryDisplayNames(post.spec.categories),
      this.taxonomy.getTagDisplayNames(post.spec.tags),
    ]);

    const modifiedContent = mergeMatter(raw, {
      title: post.spec.title,
      slug: post.spec.slug,
      excerpt: post.spec.excerpt.autoGenerate
        ? undefined
        : post.spec.excerpt.raw,
      cover: post.spec.cover || undefined,
      // 发布时间带回 frontmatter（服务器的 publishTime，即真正生效的发布时间）
      date: post.spec.publishTime || undefined,
      categories: postCategories,
      tags: postTags,
      halo: {
        site: this.client.site.url,
        name: post.metadata.name,
        publish: post.spec.publish,
        "content-hash": this.contentHash(raw),
      },
    });

    await replaceDocumentContent(uri, modifiedContent);

    return {
      status: "published",
      issues,
      permalink: post.status?.permalink
        ? `${this.client.site.url}${post.status.permalink}`
        : undefined,
    };
  }

  /**
   * 正文内容 hash（未变更预检用）：归一化（CRLF→LF、去首尾空白）后 SHA-256，
   * 与服务器 patched-raw 的存储形式一致。
   */
  private contentHash(raw: string): string {
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    return createHash("sha256").update(normalized).digest("hex");
  }

  /**
   * 更新文章元数据 + 内容快照（整条链路 409 重试）。
   * 服务器端封面图插件、PostReconciler 会并发修改 post/快照，直接提交旧
   * version 会 409"检测到冲突"；并发写入可持续数秒，重试窗口要足够长。
   * 每次重试前重取服务器最新 version 再提交。
   */
  private async updatePostContentWithRetry(
    name: string,
    post: Post,
    content: Content,
    maxAttempts = 5,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        if (attempt > 1) {
          // 重取最新 metadata（含新 version）替换后再试（首次用调用方传入的）
          const { data: latest } = await this.client.postApi.getMyPost({
            name,
          });
          post.metadata = latest.metadata;
        }

        await this.client.postApi.updateMyPost({ name, post });

        const { data: snapshot } = await this.client.postApi.getMyPostDraft({
          name,
          patched: true,
        });

        snapshot.metadata.annotations = {
          ...snapshot.metadata.annotations,
          "content.halo.run/content-json": JSON.stringify(content),
        };

        await this.client.postApi.updateMyPostDraft({ name, snapshot });
        return;
      } catch (error) {
        // 409（乐观锁冲突）：拦截器已包装为 HaloApiError，从 status 判定
        const isConflict = isHaloApiError(error) && error.status === 409;
        if (!isConflict || attempt >= maxAttempts) {
          throw error;
        }
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  /**
   * 发布/取消发布动作（幂等）的 409 重试：请求只带 name，冲突来自服务器端
   * 并发修改（封面插件等）导致的乐观锁，退避后重发即可
   */
  private async publishActionWithRetry(
    name: string,
    publish: boolean,
    maxAttempts = 5,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        if (publish) {
          await this.client.postApi.publishMyPost({ name });
        } else {
          await this.client.postApi.unpublishMyPost({ name });
        }
        return;
      } catch (error) {
        const isConflict = isHaloApiError(error) && error.status === 409;
        if (!isConflict || attempt >= maxAttempts) {
          throw error;
        }
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }
}
