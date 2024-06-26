# VSCode 发布插件

用于将 Markdown 文件发布到 [Halo](https://github.com/halo-dev/halo) 的 Visual Studio Code 插件

[English](./README.md)

## 预览

![Preview](./images/preview-zh.png)

## 功能

- 将 Markdown 文件发布到 Halo
- 将 Markdown 文件中引用的本地图片上传到 Halo
- 从 Halo 拉取文章到本地 Markdown 文件

## 先决条件

在使用此插件之前，请确保满足以下先决条件：

- 一个可用的 [Halo](https://github.com/halo-dev/halo) 网站
- 安装 Visual Studio Code：[在此处下载](https://code.visualstudio.com/download)

## 安装

1. 打开 Visual Studio Code
2. 进入扩展页面
3. 搜索 Halo
4. 点击安装按钮
5. 重新加载 Visual Studio Code 以激活插件

## 使用方法

1. 打开命令面板，搜索 Halo 初始化
2. 根据提示填写 Halo 网站的相关信息
   1. 站点地址: Halo 网站的访问地址，示例：`https://example.com`
   2. 个人令牌:

       Halo 网站的个人令牌，需要 `文章管理` 的权限

       ![PAT](./images/pat-zh.png)

       更多关于个人令牌的文档可查阅: [个人令牌](https://docs.halo.run/user-guide/user-center#%E4%B8%AA%E4%BA%BA%E4%BB%A4%E7%89%8C)

3. 打开一个 Markdown 文件，然后打开命令面板，搜索 Halo 发布。选择后，该文件将被发布到 Halo 网站
4. 所有可用的命令：
    - **vscode-extension-halo.setup**：设置 Halo 网站信息
    - **vscode-extension-halo.publish**：将 Markdown 文件发布到 Halo
    - **vscode-extension-halo.pull**：从 Halo 拉取文章到本地 Markdown 文件
    - **vscode-extension-halo.upload-images**：上传 Markdown 文件中引用的本地图片到 Halo
    - **vscode-extension-halo.update**: 从 Halo 更新文章到本地 Markdown 文件
    - **vscode-extension-halo.set-categories**: 设置当前文章的分类
    - **vscode-extension-halo.set-tags**: 设置当前文章的标签

## 贡献

欢迎贡献、报告问题和提出功能请求！请随时查看问题页面。
