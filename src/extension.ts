// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import publish from "./commands/publish";
import pull from "./commands/pull";
import uploadImages from "./commands/upload-images";
import setup from "./commands/setup";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const setupCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.setup",
    setup
  );

  const publishCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.publish",
    publish
  );

  const pullCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.pull",
    pull
  );

  const uploadImagesCommand = vscode.commands.registerCommand(
    "vscode-extension-halo.upload-images",
    uploadImages
  );

  context.subscriptions.push(setupCommand);
  context.subscriptions.push(publishCommand);
  context.subscriptions.push(pullCommand);
  context.subscriptions.push(uploadImagesCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
