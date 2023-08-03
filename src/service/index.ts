import {
  ListedPost,
  ListedPostList,
  Policy,
  PostRequest,
} from "@halo-dev/api-client";
import axios, { AxiosInstance } from "axios";
import * as vscode from "vscode";
import { mergeMatter, readMatter } from "../utils/yaml";
import MarkdownIt = require("markdown-it");
import path = require("path");
import { randomUUID } from "crypto";
import { slugify } from "transliteration";
import * as FormData from "form-data";
import * as fs from "fs";
import { Site } from "../utils/site-store";

class HaloService {
  private readonly site: Site;
  private readonly apiClient: AxiosInstance;

  constructor(site?: Site) {
    if (!site) {
      throw new Error(vscode.l10n.t("No site found"));
    }
    this.site = site;
    this.apiClient = axios.create({
      baseURL: site.url,
      auth: {
        username: site.username,
        password: site.password,
      },
    });
  }

  public async getPost(name: string): Promise<PostRequest | undefined> {
    try {
      const post = await this.apiClient.get(
        `/apis/content.halo.run/v1alpha1/posts/${name}`
      );

      const content = await this.apiClient.get(
        `/apis/api.console.halo.run/v1alpha1/posts/${name}/head-content`
      );

      return Promise.resolve({
        post: post.data,
        content: content.data,
      });
    } catch (error) {
      return Promise.resolve(undefined);
    }
  }

  public async publishPost(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }

    let params: PostRequest = {
      post: {
        spec: {
          title: "",
          slug: "",
          template: "",
          cover: "",
          deleted: false,
          publish: false,
          publishTime: undefined,
          pinned: false,
          allowComment: true,
          visible: "PUBLIC",
          priority: 0,
          excerpt: {
            autoGenerate: true,
            raw: "",
          },
          categories: [],
          tags: [],
          htmlMetas: [],
        },
        apiVersion: "content.halo.run/v1alpha1",
        kind: "Post",
        metadata: {
          name: "",
          annotations: {},
        },
      },
      content: {
        raw: "",
        content: "",
        rawType: "markdown",
      },
    };

    const { content: raw, data: matterData } = readMatter(
      activeEditor.document.getText()
    );

    if (matterData.halo?.name) {
      const post = await this.getPost(matterData.halo.name);
      params = post ? post : params;
    }

    params.content.raw = raw;
    params.content.content = new MarkdownIt().render(raw);

    // Save post
    if (params.post.metadata.name) {
      await this.apiClient.put(
        `/apis/api.console.halo.run/v1alpha1/posts/${params.post.metadata.name}/content`,
        params.content
      );
    } else {
      const fileName = path
        .basename(activeEditor.document.fileName)
        .replace(".md", "");
      params.post.metadata.name = randomUUID();
      params.post.spec.title = fileName;
      params.post.spec.slug = slugify(fileName, { trim: true });

      params.post = (
        await this.apiClient.post(
          `/apis/api.console.halo.run/v1alpha1/posts`,
          params
        )
      ).data;
    }

    // Publish post
    if (matterData.halo?.publish) {
      await this.apiClient.put(
        `/apis/api.console.halo.run/v1alpha1/posts/${params.post.metadata.name}/publish`
      );
    } else {
      await this.apiClient.put(
        `/apis/api.console.halo.run/v1alpha1/posts/${params.post.metadata.name}/unpublish`
      );
    }

    params = (await this.getPost(params.post.metadata.name)) || params;

    const modifiedContent = mergeMatter(raw, {
      ...matterData,
      halo: {
        site: this.site.url,
        name: params.post.metadata.name,
        publish: params.post.spec.publish,
      },
    });

    await activeEditor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(
          activeEditor.document.positionAt(0),
          activeEditor.document.positionAt(
            activeEditor.document.getText().length
          )
        ),
        modifiedContent
      );
    });

    await activeEditor.document.save();

    const item: vscode.MessageItem = {
      title: vscode.l10n.t("Open in browser"),
    };

    vscode.window
      .showInformationMessage(vscode.l10n.t("Publish success!"), item)
      .then((selectedItem) => {
        if (selectedItem === item) {
          vscode.env.openExternal(
            vscode.Uri.parse(`${this.site.url}${params.post.status?.permalink}`)
          );
        }
      });
  }

  public async uploadImages(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const document = activeEditor.document;
      if (document.languageId !== "markdown") {
        vscode.window.showWarningMessage(
          vscode.l10n.t("Please open a Markdown file.")
        );
        return;
      }

      const markdownText = document.getText();
      const imageRegex = /!\[.*?\]\((.*?)\)/g;
      let match;

      const matchedImages: { old: string; new: string }[] = [];

      while ((match = imageRegex.exec(markdownText)) !== null) {
        const imagePath = match[1];

        if (imagePath.startsWith("http")) {
          continue;
        }

        const absoluteImagePath = path.resolve(
          path.dirname(document.uri.fsPath),
          imagePath
        );

        const permalink = await this.uploadImage(absoluteImagePath);

        matchedImages.push({
          old: imagePath,
          new: permalink,
        });
      }

      let newMarkdownText = markdownText;
      matchedImages.forEach((item) => {
        newMarkdownText = newMarkdownText.replace(item.old, item.new);
      });

      await activeEditor.edit((editBuilder) => {
        editBuilder.replace(
          new vscode.Range(
            document.positionAt(0),
            document.positionAt(markdownText.length)
          ),
          newMarkdownText
        );
      });

      await activeEditor.document.save();

      vscode.window.showInformationMessage(
        vscode.l10n.t("Upload images success!")
      );
    }
  }

  public async getPosts(): Promise<ListedPost[]> {
    const { data: posts } = await this.apiClient.get<ListedPostList>(
      "/apis/api.console.halo.run/v1alpha1/posts",
      {
        params: {
          labelSelector: "content.halo.run/deleted=false",
        },
      }
    );
    return Promise.resolve(posts.items);
  }

  public async pullPost(name: string): Promise<void> {
    const post = await this.getPost(name);

    if (!post) {
      vscode.window.showErrorMessage(vscode.l10n.t("Post not found"));
      return;
    }

    const folderUri = vscode.workspace.workspaceFolders?.[0].uri;

    if (!folderUri) {
      return;
    }

    const fileName = post.post.spec.title + ".md";
    const fileUri = vscode.Uri.joinPath(folderUri, fileName);

    try {
      const fileExists = await vscode.workspace.fs.stat(fileUri);
      if (fileExists) {
        vscode.window.showErrorMessage(vscode.l10n.t("File already exists"));
        return;
      }
    } catch {}

    const modifiedContent = mergeMatter(post.content.raw + "", {
      halo: {
        site: this.site.url,
        name: name,
        publish: post.post.spec.publish,
      },
    });

    const buffer = Buffer.from(modifiedContent);
    const fileData = new Uint8Array(buffer);
    await vscode.workspace.fs.writeFile(fileUri, fileData);

    const doc = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(doc);
  }

  public async uploadImage(file: string): Promise<string> {
    const imageBuffer = fs.readFileSync(decodeURIComponent(file));

    try {
      const formData = new FormData();
      formData.append("file", imageBuffer, {
        filename: path.basename(decodeURIComponent(file)),
      });
      formData.append("policyName", this.site.attachment.policy);
      formData.append("groupName", this.site.attachment.group);

      const response = await this.apiClient.post(
        "/apis/api.console.halo.run/v1alpha1/attachments/upload",
        formData,
        {
          headers: formData.getHeaders(),
        }
      );

      const permalink = await this.getAttachmentPermalink(
        response.data.metadata.name
      );

      return permalink;
    } catch (error) {
      console.error("Error uploading image:", error);
      return "";
    }
  }

  public async getAttachmentPermalink(name: string): Promise<string> {
    const { data: policy } = await this.apiClient.get<Policy>(
      `/apis/storage.halo.run/v1alpha1/policies/${this.site.attachment.policy}`
    );

    return new Promise((resolve, reject) => {
      const fetchPermalink = () => {
        this.apiClient
          .get(`/apis/storage.halo.run/v1alpha1/attachments/${name}`)
          .then((response) => {
            const permalink = response.data.status.permalink;
            if (permalink) {
              if (policy.spec.templateName === "local") {
                resolve(`${this.site.url}${permalink}`);
              } else {
                resolve(permalink);
              }
            } else {
              setTimeout(fetchPermalink, 1000);
            }
          })
          .catch((error) => reject(error));
      };
      fetchPermalink();
    });
  }
}

export default HaloService;
