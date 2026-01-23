import { PostV1alpha1UcApi } from "@halo-dev/api-client";
import axios from "axios";
import * as vscode from "vscode";
import SiteStore from "../utils/site-store";

export default async () => {
  const siteStore = new SiteStore();

  const url = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Site url"),
    placeHolder: "https://",
    validateInput(value) {
      if (!value) {
        return vscode.l10n.t("Please input your site url");
      }
      if (!/^https?:\/\/.+$/.test(value)) {
        return vscode.l10n.t("Please input a valid url");
      }
      return null;
    },
  });

  const pat = await vscode.window.showInputBox({
    prompt: vscode.l10n.t("Personal Access Token"),
    password: true,
    placeHolder: vscode.l10n.t("Please input your personal access token"),
    validateInput(value) {
      if (!value) {
        return vscode.l10n.t("Please input your personal access token");
      }
      return null;
    },
  });

  if (!url || !pat) {
    return;
  }

  try {
    const postApi = new PostV1alpha1UcApi(
      undefined,
      url,
      axios.create({
        baseURL: url,
        headers: {
          Authorization: `Bearer ${pat}`,
        },
      }),
    );

    // Check if the pat is valid
    await postApi.listMyPosts();

    siteStore.registerSite({
      url,
      pat,
      default: true,
    });

    vscode.window.showInformationMessage(vscode.l10n.t("Setup Success"));
  } catch (e) {
    vscode.window.showErrorMessage(
      vscode.l10n.t(
        "Setup Failed, Please check your site url and personal access token",
      ),
    );
  }
};
