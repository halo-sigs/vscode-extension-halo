import * as vscode from "vscode";
import HaloService from "../service";
import log from "../utils/log";
import SiteStore from "../utils/site-store";

export default async (args?: unknown) => {
  let uri: vscode.Uri | undefined;

  // 资源管理器右键菜单：参数是选中的 Uri（单选 .md）
  const arg = Array.isArray(args) ? args[0] : args;
  if (arg && typeof arg === "object" && "scheme" in arg) {
    uri = arg as vscode.Uri;
  } else {
    const activeEditor = vscode.window.activeTextEditor;
    // 焦点不在文本编辑器（如停在 Markdown 预览）时明确提示，不再静默返回
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Please open a Markdown file."),
      );
      return;
    }
    // 命令触发瞬间捕获目标文档，发布全程使用该 Uri，
    // 中途切换编辑器焦点不影响发布目标（旧实现的并发冲突根因）
    uri = activeEditor.document.uri;
  }

  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());

  // 进度结束后才弹汇总（在 withProgress 回调内弹会让进度条一直等到用户处理完消息）
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("Publishing..."),
      cancellable: false,
    },
    (process) =>
      // publishPost 内部已包含图片处理（本地上传 + 外链转存），单次发布单次进度
      service.publishPost(uri as vscode.Uri, (message, increment) => {
        // 单篇发布：图片阶段用增量进度条；increment 缺省时仅刷新消息
        process.report(increment ? { message, increment } : { message });
      }),
  );

  // 全流程只在结束时弹一条汇总（service 层不弹通知，过程问题只写日志）：
  // 失败→error（带原因）；成功但有问题→warning；干净→info
  if (result.status === "failed") {
    const viewLog: vscode.MessageItem = {
      title: vscode.l10n.t("View log"),
    };
    const pick = await vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Publish failed: {0}",
        result.failureReason ??
          vscode.l10n.t("Publish failed, please try again"),
      ),
      viewLog,
    );
    if (pick === viewLog) {
      log.show();
    }
  } else if (result.issues.length > 0) {
    const viewLog: vscode.MessageItem = {
      title: vscode.l10n.t("View log"),
    };
    const pick = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        "Publish finished with {0} issue(s), see the log for details",
        `${result.issues.length}`,
      ),
      viewLog,
    );
    if (pick === viewLog) {
      log.show();
    }
  } else if (result.status === "published") {
    const openInBrowser: vscode.MessageItem = {
      title: vscode.l10n.t("Open in browser"),
    };
    const pick = await vscode.window.showInformationMessage(
      vscode.l10n.t("Publish success!"),
      openInBrowser,
    );
    if (pick === openInBrowser && result.permalink) {
      vscode.env.openExternal(vscode.Uri.parse(result.permalink));
    }
  } else {
    vscode.window.showInformationMessage(
      vscode.l10n.t("Post content unchanged, skipped"),
    );
  }
};
