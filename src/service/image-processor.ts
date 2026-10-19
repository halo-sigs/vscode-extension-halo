import { File } from "node:buffer";
import * as fs from "node:fs";
import type { Attachment } from "@halo-dev/api-client";
import axios from "axios";
import { fileTypeFromFile } from "file-type";
import * as vscode from "vscode";
import type { HaloClient } from "../api/halo-client";
import { getAxiosErrorDetail } from "../utils/axios-error";
import { isHaloApiError } from "../utils/halo-api-error";
import { getImageStorage } from "../utils/image-storage";
import log from "../utils/log";
import type { ImageOutcome, ImageResult } from "./types";
import path = require("node:path");

/** 图片处理：本地图片上传附件库、外链图片转存、正文链接替换 */
export class ImageProcessor {
  constructor(private readonly client: HaloClient) {}

  /**
   * 处理文档图片（命令入口，带进度提示）：本地图片上传附件库，外链图片按配置转存。
   * 不弹通知：失败明细写日志并通过返回值汇报，由命令层汇总提示
   */
  async uploadImages(uri: vscode.Uri): Promise<ImageResult> {
    const doc = await vscode.workspace.openTextDocument(uri);
    await doc.save();

    let result: ImageResult = { processed: 0, failed: 0, issues: [] };

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Uploading images..."),
        cancellable: false,
      },
      async (process) => {
        result = await this.processImages(doc, (message, increment) => {
          process.report({ message, increment });
        });
      },
    );

    return result;
  }

  /**
   * 上传本地图片到附件库：按配置自动选择路径——
   * 设置了本地存储策略 → Console 接口（需附件管理权限，支持策略/分组）；
   * 未设置 → UC 接口（走服务器默认策略，仅需"管理自己的附件"权限）。
   * 不弹通知：失败原因写日志并随返回值汇报，由命令层汇总提示
   * @param fileLabel 所属文档文件名，用于失败提示定位
   * @returns 成功返回 permalink；失败返回 issue
   */
  async uploadImage(file: string, fileLabel?: string): Promise<ImageOutcome> {
    const { localPolicy: policyName, localGroup: groupName } =
      getImageStorage();

    const fileType = await fileTypeFromFile(file);

    const fileBlob = new File([fs.readFileSync(file)], path.basename(file), {
      type: fileType?.mime,
    });

    try {
      let attachment: Attachment;

      if (policyName) {
        // Console 路径：指定存储策略/分组
        ({ data: attachment } =
          await this.client.consoleAttachmentApi.uploadAttachment(
            {
              file: fileBlob,
              policyName,
              groupName: groupName || undefined,
            },
            { timeout: this.client.uploadTimeoutMs },
          ));
      } else {
        // UC 路径：服务器默认策略
        ({ data: attachment } =
          await this.client.attachmentApi.uploadAttachmentForUc(
            {
              file: fileBlob,
            },
            { timeout: this.client.uploadTimeoutMs },
          ));
      }

      const permalink = attachment.status?.permalink;
      if (permalink) {
        return {
          permalink: permalink.startsWith("http")
            ? permalink
            : this.client.site.url + permalink,
        };
      }
      return {
        issue: `${vscode.l10n.t("Image upload failed")}: ${path.basename(file)}${fileLabel ? ` (${fileLabel})` : ""}`,
      };
    } catch (error) {
      // 错误文案由拦截器统一翻译（403 带权限标注）；此处附加定位信息
      if (isHaloApiError(error)) {
        const hint = policyName
          ? vscode.l10n.t(
              "Run 'Halo: Configure image storage policy' to use the server default policy instead",
            )
          : "";
        const msg = `${vscode.l10n.t("Local image upload failed")}: ${path.basename(file)}${fileLabel ? ` (${fileLabel})` : ""} — ${error.message}${hint ? `. ${hint}` : ""}`;
        log.error(msg);
        return { issue: msg };
      }
      const msg = `${vscode.l10n.t("Image upload failed")}: ${path.basename(file)}${fileLabel ? ` (${fileLabel})` : ""} (${getAxiosErrorDetail(error) || error})`;
      log.error(msg);
      return { issue: msg };
    }
  }

  /**
   * 转存外链图片到附件库：客户端下载后上传（不用服务器的 upload-from-url 抓取——
   * 部分图床如 CSDN 对服务器端请求会返回 200 后中断数据流，Halo 端直接 500；
   * 客户端下载能在本地校验完整性并重试）。
   * 上传路径按转存配置自动选择：设置了策略 → Console（支持策略/分组）；
   * 未设置 → UC（服务器默认策略）。
   * 不弹通知：失败原因写日志并随返回值汇报，由命令层汇总提示
   * @param fileLabel 所属文档文件名，用于失败提示定位
   * @returns 成功返回 permalink；失败返回 issue
   */
  async transferExternalImage(
    url: string,
    fileLabel?: string,
  ): Promise<ImageOutcome> {
    const { transferPolicy: policyName, transferGroup: groupName } =
      getImageStorage();

    // 用标准 URL 解析规范化：自动剥离 # 锚点（如 CSDN 的 #pic_center，
    // 仅 CSDN 编辑器识别，标准 markdown/HTML 中 img src 的 fragment 无任何效果）
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      const msg = `${vscode.l10n.t("Image download failed")}: ${url}`;
      log.error(msg);
      return { issue: msg };
    }

    // 文件名取路径最后一段（URL 解析已天然不含锚点与查询串），无扩展名/为空时兜底
    const filename = path.basename(parsed.pathname) || `image-${Date.now()}`;

    // 客户端下载（带浏览器 UA，避免图床对非浏览器请求断流），失败自动重试一次
    let buffer: ArrayBuffer | undefined;
    let contentType: string | undefined;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2 && !buffer; attempt++) {
      try {
        const res = await axios.get<ArrayBuffer>(parsed.href, {
          responseType: "arraybuffer",
          timeout: this.client.uploadTimeoutMs,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
            Accept: "image/*,*/*;q=0.8",
          },
        });
        buffer = res.data;
        contentType = res.headers["content-type"]?.split(";")[0];
      } catch (error) {
        lastError = error;
      }
    }

    if (!buffer) {
      const msg = `${vscode.l10n.t("Image download failed")}: ${filename}${fileLabel ? ` (${fileLabel})` : ""} (${getAxiosErrorDetail(lastError) || String(lastError)})`;
      log.error(msg);
      return { issue: msg };
    }

    // 扩展名与实际 MIME 不一致时以 MIME 为准修正文件名，
    // 避免服务器"文件类型与扩展名不匹配"拒绝上传（如 URL 尾部带尺寸标记导致坏扩展名）
    let uploadFilename = filename;
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mimeToExt: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/bmp": "bmp",
      "image/avif": "avif",
    };
    if (
      contentType &&
      mimeToExt[contentType] &&
      ext !== mimeToExt[contentType]
    ) {
      uploadFilename = `${path.basename(filename, path.extname(filename))}.${mimeToExt[contentType]}`;
    }

    try {
      const fileBlob = new File([buffer], uploadFilename, {
        type: contentType,
      });

      let attachment: Attachment;

      if (policyName) {
        // Console 路径：指定存储策略/分组
        ({ data: attachment } =
          await this.client.consoleAttachmentApi.uploadAttachment(
            {
              file: fileBlob,
              policyName,
              groupName: groupName || undefined,
            },
            { timeout: this.client.uploadTimeoutMs },
          ));
      } else {
        // UC 路径：服务器默认策略
        ({ data: attachment } =
          await this.client.attachmentApi.uploadAttachmentForUc(
            {
              file: fileBlob,
            },
            { timeout: this.client.uploadTimeoutMs },
          ));
      }

      const permalink = attachment.status?.permalink;
      if (permalink) {
        return {
          permalink: permalink.startsWith("http")
            ? permalink
            : this.client.site.url + permalink,
        };
      }
      return {};
    } catch (error) {
      // 错误文案由拦截器统一翻译（403 带权限标注）；此处附加定位信息
      if (isHaloApiError(error)) {
        const hint = policyName
          ? vscode.l10n.t(
              "Run 'Halo: Configure image storage policy' to use the server default policy instead",
            )
          : "";
        const msg = `${vscode.l10n.t("External image transfer failed")}: ${uploadFilename}${fileLabel ? ` (${fileLabel})` : ""} — ${error.message}${hint ? `. ${hint}` : ""}`;
        log.error(msg);
        return { issue: msg };
      }
      const msg = `${vscode.l10n.t("Image upload failed")}: ${uploadFilename}${fileLabel ? ` (${fileLabel})` : ""} (${getAxiosErrorDetail(error) || String(error)})`;
      log.error(msg);
      return { issue: msg };
    }
  }

  /**
   * 扫描并处理文档中的图片：本地图片上传附件库；外链图片按配置转存（默认关闭）。
   * 直接用匹配偏移量精确替换（旧实现的全文字符串替换在路径重复出现时会误替换）。
   * 不弹通知：失败明细写日志并通过返回值汇报，由命令层汇总提示
   * @param fileLabel 文档文件名，用于日志定位
   * @returns 处理结果（成功数/失败数/失败明细）
   */
  async processImages(
    doc: vscode.TextDocument,
    report?: (message: string, increment?: number) => void,
    fileLabel?: string,
  ): Promise<ImageResult> {
    if (doc.languageId !== "markdown") {
      return { processed: 0, failed: 0, issues: [] };
    }

    const text = doc.getText();
    // 匹配 ![alt](url "title" =500x) 语法：URL 捕获组后允许
    // 可选的 "title"（markdown 标准）与 =WxH 尺寸标记（CSDN 导出格式等私有扩展）
    const imageRegex =
      /!\[.*?\]\(\s*([^"<>\s]+)(?:\s+"[^"]*")?(?:\s*=\d+x\d*)?\s*\)/g;

    // 命令进入时即时读取配置（不缓存）。
    // 注意：未配置存储策略时外链转存照常工作（走服务器默认策略），
    // 策略/分组设置只是决定上传是否指定存储位置
    const transferEnabled = vscode.workspace
      .getConfiguration("halo.image.transfer")
      .get<boolean>("enabled", false);

    type ImageTask = {
      start: number;
      end: number;
      url: string;
      kind: "local" | "external";
      absolutePath?: string;
    };

    const tasks: ImageTask[] = [];
    const issues: string[] = [];

    let match: RegExpExecArray | null;
    // biome-ignore lint: no
    while ((match = imageRegex.exec(text)) !== null) {
      const imageUrl = match[1];

      if (imageUrl.startsWith("http")) {
        // 本站图片（permalink 指向自己站点）无需转存：比较 host，
        // 不做字符串前缀比较——site.url 带不带尾斜杠/端口号都可能误判
        let isOwnSite = false;
        try {
          isOwnSite =
            new URL(imageUrl).host.toLowerCase() ===
            new URL(this.client.site.url).host.toLowerCase();
        } catch {
          isOwnSite = false;
        }
        if (isOwnSite) {
          continue;
        }

        // 外链转存未开启，跳过
        if (!transferEnabled) {
          continue;
        }

        tasks.push({
          // 替换范围覆盖 URL 及其后的尺寸标记/title（=500x 是编辑器私有语法，
          // 替换为 permalink 后不应保留，否则产生 "permalink =500x" 坏链接）
          start: match.index + match[0].indexOf(imageUrl),
          end:
            match.index +
            match[0].indexOf(imageUrl) +
            imageUrl.length +
            (match[0].length -
              match[0].indexOf(imageUrl) -
              imageUrl.length -
              ")".length),
          url: imageUrl,
          kind: "external",
        });
        continue;
      }

      // data: URI 不是文件路径，跳过（旧实现会当本地路径处理导致报错）
      if (imageUrl.startsWith("data:")) {
        continue;
      }

      // 本地相对路径
      const absoluteImagePath = path.resolve(
        path.dirname(doc.uri.fsPath),
        imageUrl,
      );

      if (!fs.existsSync(absoluteImagePath)) {
        const msg = `${vscode.l10n.t("Image file not found")}: ${imageUrl}${fileLabel ? ` (${fileLabel})` : ""}`;
        log.error(msg);
        issues.push(msg);
        continue;
      }

      tasks.push({
        // 同外链：替换范围覆盖 URL 后的尺寸标记
        start: match.index + match[0].indexOf(imageUrl),
        end:
          match.index +
          match[0].indexOf(imageUrl) +
          imageUrl.length +
          (match[0].length -
            match[0].indexOf(imageUrl) -
            imageUrl.length -
            ")".length),
        url: imageUrl,
        kind: "local",
        absolutePath: absoluteImagePath,
      });
    }

    if (tasks.length === 0) {
      return { processed: 0, failed: 0, issues };
    }

    const replacements: { start: number; end: number; newUrl: string }[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      report?.(
        `${i + 1}/${tasks.length} ${path.basename(task.url)}`,
        100 / tasks.length,
      );

      const outcome =
        task.kind === "local"
          ? await this.uploadImage(task.absolutePath as string, fileLabel)
          : await this.transferExternalImage(task.url, fileLabel);

      if (outcome.permalink) {
        replacements.push({
          start: task.start,
          end: task.end,
          newUrl: outcome.permalink,
        });
      } else if (outcome.issue) {
        issues.push(outcome.issue);
      }
    }

    if (replacements.length > 0) {
      // 网络上传耗时可能很长，传入的 doc 引用可能已被 VS Code 卸载
      // （getText/positionAt 抛 "document has been closed"），重新打开（已打开则复用）
      const fresh = await vscode.workspace.openTextDocument(doc.uri);

      // 偏移量按处理前的文本计算；上传期间文档被编辑过则偏移错位，
      // 此时放弃替换（内容未变，重新执行命令即可），不写坏链接
      if (fresh.getText() !== text) {
        const msg = `${vscode.l10n.t("The document was modified while processing images, changes were not applied")}${fileLabel ? ` (${fileLabel})` : ""}`;
        log.error(msg);
        issues.push(msg);
        return { processed: 0, failed: issues.length, issues };
      }

      // 按原始文本偏移量精确替换，一次性应用
      const edit = new vscode.WorkspaceEdit();
      for (const r of replacements) {
        edit.replace(
          fresh.uri,
          new vscode.Range(fresh.positionAt(r.start), fresh.positionAt(r.end)),
          r.newUrl,
        );
      }
      await vscode.workspace.applyEdit(edit);
      // 用文档引用保存：workspace.save(uri) 对未在编辑器打开的文档是空操作
      await fresh.save();
    }

    return { processed: replacements.length, failed: issues.length, issues };
  }
}
