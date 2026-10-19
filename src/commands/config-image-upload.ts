import * as vscode from "vscode";
import HaloService from "../service";
import { getAxiosErrorDetail } from "../utils/axios-error";
import { isHaloApiError } from "../utils/halo-api-error";
import { getImageStorage, setImageStorage } from "../utils/image-storage";
import SiteStore from "../utils/site-store";

interface QuickPickItemWithValue<T> extends vscode.QuickPickItem {
  value: T;
}

/** 图片路径类型：本地图片上传 / 外链图片转存 */
type ImageKind = "local" | "transfer";

export default async () => {
  const siteStore = new SiteStore();
  const service = new HaloService(siteStore.getDefaultSite());

  // 第一步：选择要配置的图片类型（描述展示各自当前状态，可查看现状后 Esc 退出）
  const transferEnabled = vscode.workspace
    .getConfiguration("halo.image.transfer")
    .get<boolean>("enabled", false);
  const storage = getImageStorage();

  const kindPick = await vscode.window.showQuickPick<
    QuickPickItemWithValue<ImageKind>
  >(
    [
      {
        label: vscode.l10n.t("Local image upload settings"),
        description: storage.localPolicy
          ? `${vscode.l10n.t("Current")}: ${storage.localPolicy}`
          : vscode.l10n.t("Default"),
        value: "local",
      },
      {
        label: vscode.l10n.t("External image transfer settings"),
        description: transferEnabled
          ? storage.transferPolicy
            ? `${vscode.l10n.t("Current")}: ${storage.transferPolicy}`
            : vscode.l10n.t("Default")
          : vscode.l10n.t("Disabled"),
        value: "transfer",
      },
    ],
    { placeHolder: vscode.l10n.t("Select image settings to configure") },
  );

  if (!kindPick) {
    return;
  }
  const kind = kindPick.value;

  // 第二步：选择存储策略（需要附件管理权限；选默认=不指定策略，走服务器默认）。
  // 列表拉取失败（403 无权限/网络错误等）不中止：仍可选"默认"回退
  // （清空配置是纯本地操作，无需权限与网络）
  let policyName = "";
  let policies: Awaited<ReturnType<HaloService["getPolicies"]>> = [];
  let policiesLoaded = true;
  try {
    policies = await service.getPolicies();
  } catch (error) {
    policiesLoaded = false;
    // 403 文案由拦截器翻译（含权限标注），此处追加可选范围提示
    const msg = isHaloApiError(error)
      ? `${error.message} (${vscode.l10n.t("Only the default policy is available")})`
      : vscode.l10n.t(
          "Failed to load storage policies, only the default policy is available ({0})",
          getAxiosErrorDetail(error) || String(error),
        );
    vscode.window.showWarningMessage(msg);
  }

  const currentPolicy =
    kind === "local" ? storage.localPolicy : storage.transferPolicy;
  const currentGroup =
    kind === "local" ? storage.localGroup : storage.transferGroup;

  // 仅在"列表成功加载且确实为空"时判定无可配置项；
  // 拉取失败导致的空列表继续走选择框（"默认"仍可选）
  if (policiesLoaded && policies.length === 0 && !currentPolicy) {
    vscode.window.showInformationMessage(
      vscode.l10n.t("No storage policies found"),
    );
    return;
  }

  const policyPick = await vscode.window.showQuickPick<
    QuickPickItemWithValue<string>
  >(
    [
      {
        // 选默认：不指定策略，走服务器默认上传
        label: vscode.l10n.t("Default"),
        description: !currentPolicy ? vscode.l10n.t("Current") : "",
        value: "",
      },
      ...policies.map((policy) => ({
        label: policy.spec.displayName || policy.metadata.name,
        description:
          policy.metadata.name === currentPolicy
            ? vscode.l10n.t("Current")
            : policy.metadata.name,
        value: policy.metadata.name,
      })),
    ],
    { placeHolder: vscode.l10n.t("Select storage policy") },
  );

  if (!policyPick) {
    return;
  }
  policyName = policyPick.value;

  // 第三步：选择存储分组（可选，不设置则进默认分组）。
  // 同策略：拉取失败不阻塞，仍可选"不设置分组"
  let groupName = "";
  if (policyName) {
    let groups: Awaited<ReturnType<HaloService["getGroups"]>> = [];
    try {
      groups = await service.getGroups();
    } catch (error) {
      const msg = isHaloApiError(error)
        ? `${error.message} (${vscode.l10n.t("Only the default group is available")})`
        : vscode.l10n.t(
            "Failed to load storage groups, only the default group is available ({0})",
            getAxiosErrorDetail(error) || String(error),
          );
      vscode.window.showWarningMessage(msg);
    }

    const groupPick = await vscode.window.showQuickPick<
      QuickPickItemWithValue<string>
    >(
      [
        {
          label: vscode.l10n.t("No group (use default)"),
          description: !currentGroup ? vscode.l10n.t("Current") : "",
          value: "",
        },
        ...groups.map((group) => ({
          label: group.spec.displayName || group.metadata.name,
          description:
            group.metadata.name === currentGroup
              ? vscode.l10n.t("Current")
              : group.metadata.name,
          value: group.metadata.name,
        })),
      ],
      { placeHolder: vscode.l10n.t("Select storage group") },
    );

    if (!groupPick) {
      return;
    }
    groupName = groupPick.value;
  }

  try {
    // 统一保存，避免中途取消留下半套配置；选默认策略时同步清空分组
    await setImageStorage(
      kind === "local"
        ? {
            localPolicy: policyName,
            localGroup: policyName ? groupName : "",
          }
        : {
            transferPolicy: policyName,
            transferGroup: policyName ? groupName : "",
          },
    );

    // 转存路径顺带提示开关状态（策略设置不自动开启转存，开关独立）
    if (kind === "transfer" && !transferEnabled) {
      vscode.window.showWarningMessage(
        vscode.l10n.t(
          "External image transfer is still disabled, enable it to apply the settings",
        ),
      );
    } else {
      vscode.window.showInformationMessage(
        vscode.l10n.t("Image storage configured"),
      );
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `${vscode.l10n.t("Failed to configure image storage, please try again")} (${getAxiosErrorDetail(error) || String(error)})`,
    );
  }
};
