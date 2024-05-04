import * as vscode from "vscode";
import HaloService from "../service";
import SiteStore from "../utils/site-store";

export default async () => {
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const siteStore = new SiteStore();
    const service = new HaloService(siteStore.getDefaultSite());

    await service.uploadImages();

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t("Publishing..."),
        cancellable: false,
      },
      async () => {
        await service.publishPost();
      }
    );
  }
};
