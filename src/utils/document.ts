import * as vscode from "vscode";

/** 用新内容整体替换文档（内部重新打开文档，避免长网络操作后引用失效） */
export async function replaceDocumentContent(
  uri: vscode.Uri,
  newContent: string,
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)),
    newContent,
  );
  await vscode.workspace.applyEdit(edit);
  // 用文档引用保存：workspace.save(uri) 对未在编辑器打开的文档是空操作，
  // 批量发布未打开的文件时会留下脏文档（tab 显示未保存）
  await doc.save();
}
