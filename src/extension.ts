import * as vscode from "vscode";
import configImageUpload from "./commands/config-image-upload";
import publish from "./commands/publish";
import publishBatch from "./commands/publish-batch";
import pull from "./commands/pull";
import setCategories from "./commands/set-categories";
import setTags from "./commands/set-tags";
import setup from "./commands/setup";
import update from "./commands/update";
import uploadImages from "./commands/upload-images";
import { initImageStorage } from "./utils/image-storage";

// 扩展激活时注册全部命令（首次执行任意命令时触发）
export function activate(context: vscode.ExtensionContext) {
  // 图片存储配置（策略/分组 id）存 globalState，激活时注入
  initImageStorage(context.globalState);
  const setupCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.setup",
    setup,
  );

  const publishCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.publish",
    publish,
  );

  const pullCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.pull",
    pull,
  );

  const publishBatchCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.publish-batch",
    publishBatch,
  );

  const configImageUploadCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.config-image-upload",
    configImageUpload,
  );

  const uploadImagesCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.upload-images",
    uploadImages,
  );

  const updateCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.update",
    update,
  );

  const setCategoriesCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.set-categories",
    setCategories,
  );

  const setTagsCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.set-tags",
    setTags,
  );

  // 资源管理器右键菜单专用命令：与命令面板命令复用同一处理函数，
  // 仅命令 id 不同（explorer/context 菜单显示的是命令 title，
  // 需要短文案，而命令面板需要带说明的长文案，故拆分为独立命令）
  const explorerCommands = [
    ["vscode-extension-halo.explorer.publish-batch", publishBatch],
    ["vscode-extension-halo.explorer.publish", publish],
    ["vscode-extension-halo.explorer.update", update],
    ["vscode-extension-halo.explorer.upload-images", uploadImages],
    ["vscode-extension-halo.explorer.pull", pull],
  ].map(([id, handler]) =>
    vscode.commands.registerCommand(id as string, handler),
  );

  context.subscriptions.push(setupCommand);
  context.subscriptions.push(publishCommand);
  context.subscriptions.push(pullCommand);
  context.subscriptions.push(publishBatchCommand);
  context.subscriptions.push(configImageUploadCommand);
  context.subscriptions.push(uploadImagesCommand);
  context.subscriptions.push(updateCommand);
  context.subscriptions.push(setCategoriesCommand);
  context.subscriptions.push(setTagsCommand);
  context.subscriptions.push(...explorerCommands);
}

// 扩展停用时调用（当前无需清理，命令已通过 subscriptions 自动释放）
export function deactivate() {}
