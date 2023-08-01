import * as vscode from "vscode";
import SiteStore from "../utils/site-store";
import axios from "axios";
import { GroupList, PolicyList } from "@halo-dev/api-client";

interface HaloAttachmentPolicyQuickPickItem extends vscode.QuickPickItem {
  name: string;
}

interface HaloAttachmentGroupQuickPickItem extends vscode.QuickPickItem {
  name: string;
}

export default async () => {
  const siteStore = new SiteStore();

  const url = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Site url"),
    placeHolder: vscode.l10n.t("Please input your site url"),
  });

  if (!url) {
    vscode.window.showErrorMessage(vscode.l10n.t("Please input your site url"));
    return;
  }

  const username = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Username"),
    placeHolder: vscode.l10n.t("Please input your username"),
  });

  if (!username) {
    vscode.window.showErrorMessage(vscode.l10n.t("Please input your username"));
    return;
  }

  const password = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Password"),
    password: true,
    placeHolder: vscode.l10n.t("Please input your password"),
  });

  if (!password) {
    vscode.window.showErrorMessage(vscode.l10n.t("Please input your password"));
    return;
  }

  try {
    const attachmentPolicy =
      await vscode.window.showQuickPick<HaloAttachmentPolicyQuickPickItem>(
        new Promise((resolve) => {
          axios
            .get<PolicyList>(`${url}/apis/storage.halo.run/v1alpha1/policies`, {
              auth: { username, password },
            })
            .then(({ data: policies }) => {
              const items = policies.items.map((item) => {
                return {
                  name: item.metadata.name,
                  label: item.spec.displayName,
                };
              });
              resolve(items);
            });
        }),
        {
          placeHolder: vscode.l10n.t("Please select a attachment policy"),
        }
      );

    if (!attachmentPolicy) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Please select a attachment policy")
      );
      return;
    }

    const attachmentGroup =
      await vscode.window.showQuickPick<HaloAttachmentGroupQuickPickItem>(
        new Promise((resolve) => {
          axios
            .get<GroupList>(`${url}/apis/storage.halo.run/v1alpha1/groups`, {
              params: {
                labelSelector: "!halo.run/hidden",
              },
              auth: { username, password },
            })
            .then(({ data: groups }) => {
              const items = groups.items.map((item) => {
                return {
                  name: item.metadata.name,
                  label: item.spec.displayName,
                };
              });
              resolve([
                {
                  name: "",
                  label: vscode.l10n.t("Ungrouped"),
                },
                ...items,
              ]);
            });
        }),
        {
          placeHolder: vscode.l10n.t("Please select a attachment group"),
        }
      );

    if (!attachmentGroup) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Please select a attachment group")
      );
      return;
    }

    siteStore.registerSite({
      url,
      username,
      password,
      default: true,
      attachment: {
        policy: attachmentPolicy.name,
        group: attachmentGroup.name,
      },
    });

    vscode.window.showInformationMessage(vscode.l10n.t("Setup Success"));
  } catch (e) {
    vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Setup Failed, Please check your site url, username and password"
      )
    );
  }
};
