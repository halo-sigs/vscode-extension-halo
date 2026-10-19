/**
 * 命令层统一汇报约定：service 层不弹通知，只写日志并通过返回值汇报；
 * 命令层在流程结束后弹唯一一条汇总通知（干净→info，有问题→warning，失败→error）
 */

/**
 * 发布结果：status 主状态；issues 过程问题（文章状态不受影响，如图片失败）；
 * failureReason 失败原因（仅 status=failed，与 issues 分离避免批量汇总重复计数）
 */
export interface PublishResult {
  status: "published" | "skipped" | "failed";
  issues: string[];
  failureReason?: string;
  /** 发布成功后文章的访问链接（供「在浏览器打开」） */
  permalink?: string;
}

/** 图片处理结果：processed 成功替换数；failed 失败数；issues 失败明细 */
export interface ImageResult {
  processed: number;
  failed: number;
  issues: string[];
}

/** 单篇文章拉取/更新结果：ok 是否成功；issue 失败原因（已记日志） */
export interface FetchResult {
  ok: boolean;
  issue?: string;
}

/** 单张图片上传/转存结果：成功时 permalink 有值，失败时 issue 有值 */
export interface ImageOutcome {
  permalink?: string;
  issue?: string;
}

/**
 * 分类/标签创建的 403：本地 frontmatter 有而服务器没有的分类/标签需要创建，
 * 该操作需要分类/标签管理权限（投稿者只含查看依赖）。
 * 包装后由 publishPost 兜底 catch 识别，以带权限标注的文案提示
 */
export class CategoryTagPermissionError extends Error {
  constructor(
    public readonly kind: "category" | "tag",
    public readonly displayName: string,
    public readonly cause: unknown,
  ) {
    super(`Permission denied creating ${kind} '${displayName}'`);
  }
}
