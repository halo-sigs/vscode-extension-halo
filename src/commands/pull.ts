import * as vscode from "vscode";
import HaloService, { type FetchResult } from "../service";
import { getAxiosErrorDetail } from "../utils/axios-error";
import { isHaloApiError } from "../utils/halo-api-error";
import log from "../utils/log";
import SiteStore from "../utils/site-store";

interface HaloPostQuickPickItem extends vscode.QuickPickItem {
  name: string;
}

// 注意：不能在模块顶层创建 SiteStore —— 扩展激活（首次执行任意命令）时就会读取磁盘，
// 若 setup 在激活之后才写入站点，这份内存快照将永远过期，导致 "没有找到该站点"。
// 因此必须在命令执行时创建，与其他命令保持一致。

export default async (args?: unknown) => {
  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());

  // 资源管理器右键菜单：参数是选中的目录 Uri，文章拉取到该目录；
  // 未指定时回退到工作区根目录（旧行为）
  let targetFolder: vscode.Uri | undefined;
  const arg = Array.isArray(args) ? args[0] : args;
  if (arg && typeof arg === "object" && "scheme" in arg) {
    const uri = arg as vscode.Uri;
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type === vscode.FileType.Directory) {
      targetFolder = uri;
    }
  }

  // 先拉取文章列表再弹选择框（旧实现在 QuickPick 中异步加载，列表为空时无法区分
  // "没有文章"与"加载失败"）；失败在这里弹出唯一一条错误提示后中止
  let posts: Awaited<ReturnType<HaloService["getPosts"]>>;
  try {
    posts = await service.getPosts();
  } catch (error) {
    // 错误文案由拦截器统一翻译（403 已带权限标注），此处统一弹出
    const msg = isHaloApiError(error)
      ? error.message
      : vscode.l10n.t("Failed to list posts from the server, please retry");
    log.error(`${msg} (${getAxiosErrorDetail(error) || String(error)})`);
    vscode.window.showErrorMessage(msg);
    return;
  }

  const items = await vscode.window.showQuickPick<HaloPostQuickPickItem>(
    posts.map((item) => {
      return {
        label: item.post.spec.title,
        description: vscode.l10n.t(
          item.post.spec.publish ? "Published" : "Draft",
        ),
        name: item.post.metadata.name,
      };
    }),
    {
      placeHolder: vscode.l10n.t("Please select a post"),
      matchOnDescription: true,
      canPickMany: true,
    },
  );

  if (!items?.length) {
    return;
  }

  // 拉取结果收集：service 层不弹通知，结束后统一汇总
  const results: FetchResult[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("Pulling posts..."),
      cancellable: true,
    },
    async (process) => {
      for (const item of items) {
        process.report({
          message: item.label,
          increment: 100 / items.length,
        });

        results.push(await service.pullPost(item.name, targetFolder));
      }
    },
  );

  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) {
    vscode.window.showInformationMessage(
      vscode.l10n.t("Pull finished: {0} posts pulled", `${items.length}`),
    );
  } else {
    const viewLog: vscode.MessageItem = {
      title: vscode.l10n.t("View log"),
    };
    const pick = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        "Pull finished: {0} succeeded, {1} failed",
        `${items.length - failed.length}`,
        `${failed.length}`,
      ),
      viewLog,
    );
    if (pick === viewLog) {
      log.show();
    }
  }
};
