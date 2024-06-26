# Halo integration for Visual Studio Code

Visual Studio Code extension for publishing Markdown files to [Halo](https://github.com/halo-dev/halo)

[中文文档](./README.zh-CN.md)

## Preview

![Preview](./images/preview-en.png)

## Features

- Publish Markdown files to Halo.
- Upload local images referenced in the Markdown file to Halo.
- Pull post from Halo to local Markdown file.

## Prerequisites

Before using this extension, make sure you have the following prerequisites:

- An available [Halo](https://github.com/halo-dev/halo) site
- Visual Studio Code: [Download here](https://code.visualstudio.com/download)

## Installation

1. Open Visual Studio Code
2. Go to Extensions
3. Search for **Halo**
4. Click the Install button
5. Reload Visual Studio Code to activate the extension

## Usage

1. Open the Command Palette and search for **Halo Setup**.
2. Fill in the relevant information for your Halo site according to the prompts.
   1. Site url: The URL of your Halo site, e.g. `https://example.com`
   2. Personal access token:

       The personal access token of your Halo site, needs `Post Manage` permission.

       ![PAT](./images/pat-en.png)

       More information about personal access token: [Personal Access Token](https://docs.halo.run/user-guide/user-center#%E4%B8%AA%E4%BA%BA%E4%BB%A4%E7%89%8C)

3. Open a Markdown file, then open the command palette and search for **Halo Publish**. Once selected, this document will be published to the Halo site.
4. All available commands:
    - **vscode-extension-halo.setup**: Setup Halo site information.
    - **vscode-extension-halo.publish**: Publish the Markdown file to Halo.
    - **vscode-extension-halo.pull**: Pull post from Halo to local Markdown file.
    - **vscode-extension-halo.upload-images**: Upload local images referenced in the Markdown file to Halo.
    - **vscode-extension-halo.update**: Update post from Halo to local Markdown file.
    - **vscode-extension-halo.set-categories**: Set categories for current post.
    - **vscode-extension-halo.set-tags**: Set tags for current post.

## Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the issues page.
