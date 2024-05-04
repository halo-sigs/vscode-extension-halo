import HaloService from "../service";
import SiteStore from "../utils/site-store";
import * as vscode from "vscode";

export default async () => {
  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());
  await service.updatePost();
  vscode.window.showInformationMessage(vscode.l10n.t("Post updated"));
};
