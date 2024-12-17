import * as vscode from "vscode";
import HaloService from "../service";
import SiteStore from "../utils/site-store";
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
    activeEditor.document.getText(),
  );

  const currentCategories = matterData.categories || [];
  const allCategories = service.getCategories();

  const selectedCategories = await vscode.window.showQuickPick(
    (await allCategories).map((category) => {
      return {
        label: category.spec.displayName,
        picked: currentCategories.includes(category.spec.displayName),
      };
    }),
    {
      canPickMany: true,
      placeHolder: vscode.l10n.t("Select categories"),
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  if (!selectedCategories) {
    return;
  }

  matterData.categories = selectedCategories.map((category) => category.label);

  const modifiedContent = mergeMatter(raw, matterData);

  await activeEditor.edit((editBuilder) => {
    editBuilder.replace(
      new vscode.Range(
        activeEditor.document.positionAt(0),
        activeEditor.document.positionAt(
          activeEditor.document.getText().length,
        ),
      ),
      modifiedContent,
    );
  });

  await activeEditor.document.save();
};
