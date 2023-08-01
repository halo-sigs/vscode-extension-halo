import * as vscode from "vscode";
import HaloService from "../service";
import SiteStore from "../utils/site-store";

interface HaloPostQuickPickItem extends vscode.QuickPickItem {
  name: string;
}

const siteStore = new SiteStore();

async function fetchPosts(): Promise<HaloPostQuickPickItem[]> {
  const service = new HaloService(siteStore.getDefaultSite());

  const posts = await service.getPosts();
  return posts.map((item) => {
    return {
      label: item.post.spec.title,
      description: item.post.spec.slug,
      name: item.post.metadata.name,
    };
  });
}

export default async () => {
  const service = new HaloService(siteStore.getDefaultSite());

  const items = await vscode.window.showQuickPick<HaloPostQuickPickItem>(
    fetchPosts(),
    {
      placeHolder: vscode.l10n.t("Please select a post"),
      matchOnDescription: true,
      canPickMany: true,
    }
  );

  if (!items?.length) {
    return;
  }

  items.forEach((item) => {
    service.pullPost(item.name);
  });
};
