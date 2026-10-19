import axios from "axios";
import * as vscode from "vscode";
import { getAxiosErrorDetail } from "../utils/axios-error";
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
    const axiosInstance = axios.create({
      baseURL: url,
      headers: {
        Authorization: `Bearer ${pat}`,
      },
    });

    // 读取自己的用户信息校验令牌——该接口属于基础角色（authenticated 的
    // own-user-info 依赖），任何有效 PAT 均可访问；不能用 listMyPosts 校验，
    // 它需要文章查看权限，只授权了附件等权限的令牌会被 403 误判为无效
    await axiosInstance.get("/apis/uc.api.halo.run/v1alpha1/users/-");

    siteStore.registerSite({
      url,
      pat,
      default: true,
    });

    vscode.window.showInformationMessage(vscode.l10n.t("Setup Success"));
  } catch (e) {
    // 区分失败原因：401/403 是地址或令牌问题；其余（超时/断连/DNS）多为网络问题
    const isAuthError =
      axios.isAxiosError(e) &&
      (e.response?.status === 401 || e.response?.status === 403);
    const msg = isAuthError
      ? vscode.l10n.t(
          "Setup failed: the site url or personal access token is incorrect ({0})",
          getAxiosErrorDetail(e),
        )
      : vscode.l10n.t(
          "Setup failed: could not reach the site, please check your network ({0})",
          getAxiosErrorDetail(e) || String(e),
        );
    vscode.window.showErrorMessage(msg);
  }
};
