import HaloService from "../service";
import SiteStore from "../utils/site-store";
import * as vscode from "vscode";
import { mergeMatter, readMatter } from "../utils/yaml";

export default async () => {
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }

  await activeEditor.document.save();

  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());

  const { content: raw, data: matterData } = readMatter(
    activeEditor.document.getText()
  );

  const currentTags = matterData.tags || [];
  const allTags = service.getTags();

  const selectedTags = await vscode.window.showQuickPick(
    (
      await allTags
    ).map((tag) => {
      return {
        label: tag.spec.displayName,
        picked: currentTags.includes(tag.spec.displayName),
      };
    }),
    {
      canPickMany: true,
      placeHolder: vscode.l10n.t("Select tags"),
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );

  if (!selectedTags) {
    return;
  }

  matterData.tags = selectedTags.map((tag) => tag.label);

  const modifiedContent = mergeMatter(raw, matterData);

  await activeEditor.edit((editBuilder) => {
    editBuilder.replace(
      new vscode.Range(
        activeEditor.document.positionAt(0),
        activeEditor.document.positionAt(activeEditor.document.getText().length)
      ),
      modifiedContent
    );
  });

  await activeEditor.document.save();
};
