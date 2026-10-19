import * as path from "node:path";
import * as vscode from "vscode";
import HaloService from "../service";
import log from "../utils/log";
import SiteStore from "../utils/site-store";
import { readMatter } from "../utils/yaml";

interface PublishFileQuickPickItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
}

/** 批量发布汇总文案：有问题时带问题数（问题数为 0 时用普通模板，不带冗余尾巴） */
function buildSummary(
  succeeded: number,
  failed: number,
  skipped: number,
  issuesCount: number,
): string {
  return issuesCount > 0
    ? vscode.l10n.t(
        "Batch publish finished with issues: {0} succeeded, {1} failed, {2} skipped, {3} issue(s) need attention",
        `${succeeded}`,
        `${failed}`,
        `${skipped}`,
        `${issuesCount}`,
      )
    : vscode.l10n.t(
        "Batch publish finished: {0} succeeded, {1} failed, {2} skipped",
        `${succeeded}`,
        `${failed}`,
        `${skipped}`,
      );
}

/**
 * 规范化命令入参：资源管理器右键多选时 VS Code 传入
 * (uri | Uri[], ...uris)；命令面板调用时为 undefined
 */
function extractSelectedUris(args: unknown): vscode.Uri[] | undefined {
  if (!Array.isArray(args) || args.length === 0) {
    const single = args as vscode.Uri | undefined;
    if (single?.scheme) {
      return [single];
    }
    return undefined;
  }

  const uris: vscode.Uri[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const u of a) {
        if (u?.scheme) uris.push(u);
      }
    } else if (a?.scheme) {
      uris.push(a);
    }
  }
  return uris.length > 0 ? uris : undefined;
}

/** 收集给定 Uri（文件或目录）下的全部 Markdown 文件 */
async function collectMarkdownFiles(uris: vscode.Uri[]): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  const seen = new Set<string>();

  for (const uri of uris) {
    // 多选里同一文件可能重复出现
    if (seen.has(uri.toString())) {
      continue;
    }
    seen.add(uri.toString());

    const stat = await vscode.workspace.fs.stat(uri);

    if (stat.type === vscode.FileType.Directory) {
      // 目录：递归收集 .md（排除常见构建目录）；
      // 同时选中父子目录时 findFiles 会返回重复项，按路径去重
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(uri, "**/*.md"),
        "**/{node_modules,.git,out,dist}/**",
      );
      for (const f of found) {
        if (!seen.has(f.toString())) {
          seen.add(f.toString());
          files.push(f);
        }
      }
    } else if (
      uri.path.toLowerCase().endsWith(".md") &&
      uri.scheme === "file"
    ) {
      files.push(uri);
    }
  }

  return files;
}

export default async (args?: unknown) => {
  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());

  // 资源管理器右键：直接用选中项（目录展开为其内全部 .md）
  const selected = extractSelectedUris(args);
  let uris: vscode.Uri[];

  if (selected) {
    uris = await collectMarkdownFiles(selected);
    if (uris.length === 0) {
      vscode.window.showInformationMessage(
        vscode.l10n.t("No Markdown files found in selection"),
      );
      return;
    }
  } else {
    // 命令面板：扫描工作区全部 Markdown 文件，QuickPick 多选
    uris = await vscode.workspace.findFiles(
      "**/*.md",
      "**/{node_modules,.git,out,dist}/**",
    );

    if (uris.length === 0) {
      vscode.window.showInformationMessage(
        vscode.l10n.t("No Markdown files found in workspace"),
      );
      return;
    }
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const workspaceRootPath = workspaceRoot?.fsPath;

  // 读取 frontmatter 标注哪些文件已关联 Halo 文章
  const items: PublishFileQuickPickItem[] = [];
  for (const uri of uris) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const { data } = readMatter(doc.getText());
    const relativePath = workspaceRootPath
      ? path.relative(workspaceRootPath, uri.fsPath)
      : path.basename(uri.fsPath);

    items.push({
      label: relativePath,
      description: data.halo?.name
        ? vscode.l10n.t("Linked")
        : vscode.l10n.t("New post"),
      uri,
    });
  }

  let picked: PublishFileQuickPickItem[];

  if (selected) {
    // 资源管理器右键来的选中即最终选择（左匹配：选中什么发什么），不再弹选择框
    picked = items;
  } else {
    const pickResult =
      await vscode.window.showQuickPick<PublishFileQuickPickItem>(items, {
        placeHolder: vscode.l10n.t("Select files to publish"),
        canPickMany: true,
        matchOnDescription: true,
      });
    if (!pickResult?.length) {
      return;
    }
    picked = pickResult;
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  // 过程问题总数（图片上传/转存失败等）：文章状态正常但有需要注意的问题
  let issuesCount = 0;
  const failedFiles: string[] = [];

  await vscode.window.withProgress(
    {
      // Window 位置：标题栏下方，标题与消息分行显示，比 Notification 单行更美观
      location: vscode.ProgressLocation.Window,
      title: vscode.l10n.t("Batch publishing..."),
      cancellable: true,
    },
    async (process, token) => {
      log.separator();
      log.info(
        `${vscode.l10n.t("Batch publishing...")} — ${picked.length} ${vscode.l10n.t("file(s)")}`,
      );

      for (let i = 0; i < picked.length; i++) {
        const item = picked[i];
        // 用户取消后停止后续文件
        if (token.isCancellationRequested) {
          log.info("Canceled.");
          return;
        }

        const prefix = `${i + 1}/${picked.length}`;

        // 外层进度：文章进度（短消息：序号+文件名）；完整路径与明细写日志
        process.report({ message: `${prefix} ${path.basename(item.label)}` });
        log.info(`[${prefix}] ${item.label}`);

        // 内层进度：该文档的图片处理进度（上传/转存逐张），透传到同一进度
        const result = await service.publishPost(item.uri, (message) => {
          process.report({
            message: `${prefix} ${path.basename(item.label)} — ${message}`,
          });
          log.detail(message);
        });

        if (result.status === "published") {
          succeeded++;
          log.detail("✓ published");
        } else if (result.status === "skipped") {
          skipped++;
          log.detail("→ skipped (content unchanged)");
        } else {
          failed++;
          failedFiles.push(item.label);
          // 失败原因已由 service 层记录（带文件名），此处只标结果避免重复
          log.detail("✗ failed");
        }
        // 过程问题（图片失败、断连后核实成功等）计入汇总——文章状态正常但需要注意。
        // 失败原因不计入（已由"失败 n 篇"体现，避免同一问题计两遍）
        issuesCount += result.issues.length;
        for (const issue of result.issues) {
          log.detail(`  ⚠ ${issue}`);
        }
      }
    },
  );

  log.separator();
  const summary = buildSummary(succeeded, failed, skipped, issuesCount);
  log.info(summary);
  if (failedFiles.length > 0) {
    log.error(`${vscode.l10n.t("Failed files")}:`);
    for (const f of failedFiles) {
      log.detail(f);
    }
  }

  // 汇总通知（唯一一条）：有失败或有问题→warning（可查看日志），全部干净→info。
  // 问题数为 0 时用普通模板（有失败也不带"另有 0 个问题"的冗余尾巴）
  const viewLogItem: vscode.MessageItem = {
    title: vscode.l10n.t("View log"),
  };
  if (failed > 0 || issuesCount > 0) {
    const pick = await vscode.window.showWarningMessage(summary, viewLogItem);
    if (pick === viewLogItem) {
      log.show();
    }
  } else {
    vscode.window.showInformationMessage(summary);
  }
};
