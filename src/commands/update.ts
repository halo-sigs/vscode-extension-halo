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

    // 焦点不在文本编辑器时明确提示，避免静默失败后误报“文章已更新”
    if (!activeEditor) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Please open a Markdown file."),
      );
      return;
    }
    uri = activeEditor.document.uri;
  }

  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());

  // service 层不弹通知：结果统一在结束时弹一条（成功→info；失败→error 带原因）
  const result = await service.updatePost(uri);

  if (result.ok) {
    vscode.window.showInformationMessage(vscode.l10n.t("Post updated"));
  } else {
    const viewLog: vscode.MessageItem = {
      title: vscode.l10n.t("View log"),
    };
    const pick = await vscode.window.showErrorMessage(
      result.issue ?? vscode.l10n.t("Post not found"),
      viewLog,
    );
    if (pick === viewLog) {
      log.show();
    }
  }
};
