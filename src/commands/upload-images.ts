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

    if (!activeEditor) {
      vscode.window.showWarningMessage(
        vscode.l10n.t("Please open a Markdown file."),
      );
      return;
    }
    uri = activeEditor.document.uri;
  }

  // 预检：非 Markdown 文档直接提示（原在 service 内，前置到命令层）
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== "markdown") {
    vscode.window.showWarningMessage(
      vscode.l10n.t("Please open a Markdown file."),
    );
    return;
  }

  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());

  // service 层不弹通知：结果统一在结束时弹一条（失败→warning 带数量）
  const result = await service.uploadImages(uri);

  if (result.failed > 0) {
    const viewLog: vscode.MessageItem = {
      title: vscode.l10n.t("View log"),
    };
    const pick = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        "Upload images finished: {0} succeeded, {1} failed",
        `${result.processed}`,
        `${result.failed}`,
      ),
      viewLog,
    );
    if (pick === viewLog) {
      log.show();
    }
  } else if (result.processed > 0) {
    vscode.window.showInformationMessage(
      vscode.l10n.t("Upload images success!"),
    );
  } else {
    vscode.window.showInformationMessage(vscode.l10n.t("No images to process"));
  }
};
