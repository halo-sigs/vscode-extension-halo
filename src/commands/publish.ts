import * as vscode from "vscode";
import HaloService from "../service";
import SiteStore from "../utils/site-store";

export default async () => {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    await vscode.commands.executeCommand("vscode-extension-halo.upload-images");

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Publishing..."),
        cancellable: false,
      },
      async () => {
        const siteStore = new SiteStore();
        const service = new HaloService(siteStore.getDefaultSite());
        service.publishPost();
      }
    );
  }
};
