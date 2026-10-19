import type * as vscode from "vscode";

/**
 * 图片存储配置（本地/转存各自的策略与分组）。
 * 值是「配置图片存储策略」命令从服务器拉取的 id，属于扩展内部状态而非
 * 用户设置项（配置键若不注册进 package.json 则无法用 config.update 写入），
 * 因此存 globalState；激活时通过 initImageStorage 注入
 */
export interface ImageStorageConfig {
  localPolicy: string;
  localGroup: string;
  transferPolicy: string;
  transferGroup: string;
}

const STORAGE_KEY = "halo.image.storage";
const EMPTY: ImageStorageConfig = {
  localPolicy: "",
  localGroup: "",
  transferPolicy: "",
  transferGroup: "",
};

let memento: vscode.Memento | undefined;

/** 激活时注入 globalState（extension.ts 调用） */
export function initImageStorage(m: vscode.Memento): void {
  memento = m;
}

/** 读取当前图片存储配置（未配置的策略/分组为空串 = 走服务器默认） */
export function getImageStorage(): ImageStorageConfig {
  return memento?.get<ImageStorageConfig>(STORAGE_KEY) ?? EMPTY;
}

/** 更新图片存储配置（局部更新，与现有值合并） */
export async function setImageStorage(
  patch: Partial<ImageStorageConfig>,
): Promise<void> {
  await memento?.update(STORAGE_KEY, { ...getImageStorage(), ...patch });
}
