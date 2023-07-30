import * as vscode from "vscode";
import HaloService from "../service";
import SiteStore from "../utils/site-store";

export default async () => {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t("Uploading images..."),
      cancellable: false,
    },
    async () => {
      const siteStore = new SiteStore();
      const service = new HaloService(siteStore.getDefaultSite());
      service.uploadImages();
    }
  );
};
