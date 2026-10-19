import axios, { type AxiosError, type AxiosInstance } from "axios";
import * as vscode from "vscode";
import { getAxiosErrorDetail } from "./axios-error";
import {
  type HaloPermission,
  PERMISSIONS,
  permissionLabel,
} from "./permissions";

/**
 * Halo API 统一错误：由响应拦截器产出，调用方按 kind 处理业务语义，
 * message 即用户可读文案（含权限标注/服务器原因），无需再拼装
 */
export class HaloApiError extends Error {
  constructor(
    /** 错误类别：403 缺权限 / 404 不存在 / 网络层失败（无响应）/ 其他 HTTP 错误 */
    public readonly kind: "permission" | "notFound" | "network" | "http",
    message: string,
    /** 权限类错误对应的所需权限（kind=permission 时有值） */
    public readonly permission?: HaloPermission,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/** 判断是否为 HaloApiError（命令/服务层按 kind 分支用） */
export function isHaloApiError(error: unknown): error is HaloApiError {
  return error instanceof HaloApiError;
}

/** 请求特征 → 所需权限（对照 Halo 官方 role-template 定义） */
interface PermissionRule {
  /** 请求路径前缀 */
  prefix: string;
  /** HTTP 方法；缺省为全部 */
  method?: string;
  permission: HaloPermission;
}

const PERMISSION_RULES: PermissionRule[] = [
  // 文章 UC 接口（读写自己的文章）
  {
    prefix: "/apis/uc.api.content.halo.run",
    permission: PERMISSIONS.postContributor,
  },
  // 附件 UC 接口（管理自己的附件）
  {
    prefix: "/apis/uc.api.storage.halo.run",
    permission: PERMISSIONS.ucAttachment,
  },
  // 控制台附件上传（管理全部附件，指定策略/分组时使用）
  {
    prefix: "/apis/api.console.halo.run/v1alpha1/attachments",
    permission: PERMISSIONS.consoleAttachment,
  },
  // 存储策略/分组列表（附件管理）
  {
    prefix: "/apis/storage.halo.run",
    permission: PERMISSIONS.consoleAttachment,
  },
  // 分类查看（投稿者包含 view 依赖）
  {
    prefix: "/apis/content.halo.run/v1alpha1/categories",
    method: "get",
    permission: PERMISSIONS.postContributor,
  },
  // 分类创建/更新/删除（分类管理）
  {
    prefix: "/apis/content.halo.run/v1alpha1/categories",
    permission: PERMISSIONS.categoryManager,
  },
  // 标签查看（投稿者包含 view 依赖）
  {
    prefix: "/apis/content.halo.run/v1alpha1/tags",
    method: "get",
    permission: PERMISSIONS.postContributor,
  },
  // 标签创建/更新/删除（标签管理）
  {
    prefix: "/apis/content.halo.run/v1alpha1/tags",
    permission: PERMISSIONS.tagManager,
  },
];

/** 按请求路径与方法推断所需权限（无映射时为 undefined） */
function requiredPermission(
  url: string | undefined,
  method: string | undefined,
): HaloPermission | undefined {
  const m = method?.toLowerCase();
  return PERMISSION_RULES.find(
    (r) => url?.startsWith(r.prefix) && (!r.method || r.method === m),
  )?.permission;
}

/**
 * 为 axios 实例挂响应拦截器，统一翻译错误：
 * - 403 → 带权限标注的 HaloApiError（kind=permission）
 * - 404 → kind=notFound
 * - 无响应（超时/断连/DNS）→ kind=network
 * - 其他 HTTP → kind=http（含服务器返回原因）
 * 之后 service/命令层按 kind 做业务分支，用户文案由 message 直接给出
 */
export function attachHaloInterceptors(instance: AxiosInstance): void {
  instance.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      const url =
        axios.isAxiosError(error) && typeof error.config?.url === "string"
          ? error.config.url
          : undefined;
      const method =
        axios.isAxiosError(error) && typeof error.config?.method === "string"
          ? error.config.method
          : undefined;

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        if (status === 403) {
          const permission = requiredPermission(url, method);
          return Promise.reject(
            new HaloApiError(
              "permission",
              permission
                ? vscode.l10n.t(
                    "The request was denied: the personal access token lacks the permission {0}",
                    permissionLabel(permission),
                  )
                : vscode.l10n.t(
                    "The request was denied: the personal access token lacks the required permission ({0})",
                    getAxiosErrorDetail(error),
                  ),
              permission,
              status,
              error,
            ),
          );
        }

        if (status === 404) {
          return Promise.reject(
            new HaloApiError(
              "notFound",
              vscode.l10n.t("Not found: {0}", getAxiosErrorDetail(error)),
              undefined,
              status,
              error,
            ),
          );
        }

        if (error.response === undefined) {
          return Promise.reject(
            new HaloApiError(
              "network",
              vscode.l10n.t(
                "Network error: {0}",
                getAxiosErrorDetail(error) || String(error),
              ),
              undefined,
              undefined,
              error,
            ),
          );
        }

        return Promise.reject(
          new HaloApiError(
            "http",
            getAxiosErrorDetail(error) || String(error),
            undefined,
            status,
            error,
          ),
        );
      }

      return Promise.reject(
        new HaloApiError("http", String(error), undefined, undefined, error),
      );
    },
  );
}
