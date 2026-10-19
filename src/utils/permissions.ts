/**
 * Halo 权限元数据：403 提示时引用，集中维护不硬编码在提示文案里。
 * 标识名来自 Halo 官方 role-template 定义
 * （application/src/main/resources/extensions/role-template-*.yaml）
 */
export interface HaloPermission {
  /** 角色模板标识（后台 PAT 权限列表里的技术名） */
  readonly template: string;
  /** 后台显示名 */
  readonly displayName: string;
}

export const PERMISSIONS = {
  /** UC 文章读写（查看/创建/更新自己的文章，含分类/标签查看依赖） */
  postContributor: {
    template: "role-template-post-contributor",
    displayName: "Post Contributor (投稿者)",
  } satisfies HaloPermission,
  /** 发布/取消发布自己的文章 */
  postPublisher: {
    template: "role-template-post-publisher",
    displayName: "Post Publisher",
  } satisfies HaloPermission,
  /** UC 附件上传（管理自己的附件） */
  ucAttachment: {
    template: "role-template-uc-attachment-manager",
    displayName: "UC Attachment Manager (允许管理自己的附件)",
  } satisfies HaloPermission,
  /** 控制台附件管理（聚合：查看+管理全部附件） */
  consoleAttachment: {
    template: "role-template-manage-attachments",
    displayName: "Manage Attachments (附件管理)",
  } satisfies HaloPermission,
  /** 标签管理（聚合：查看+创建/更新/删除标签）。发布时创建新标签需要 */
  tagManager: {
    template: "role-template-manage-tags",
    displayName: "Manage Tags (标签管理)",
  } satisfies HaloPermission,
  /** 分类管理（聚合：查看+创建/更新/删除分类）。发布时创建新分类需要 */
  categoryManager: {
    template: "role-template-manage-categories",
    displayName: "Manage Categories (分类管理)",
  } satisfies HaloPermission,
} as const;

/** 拼接权限标注（用于 403 提示） */
export function permissionLabel(p: HaloPermission): string {
  return `[${p.template}] ${p.displayName}`;
}
