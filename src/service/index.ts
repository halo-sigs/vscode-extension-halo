import {
  Category,
  CategoryList,
  ListedPost,
  ListedPostList,
  Policy,
  PostRequest,
  Tag,
  TagList,
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

    await activeEditor.document.save();

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

    // check site url
    if (matterData.halo?.site && matterData.halo.site !== this.site.url) {
      vscode.window.showErrorMessage(vscode.l10n.t("Site url is not matched"));
      return;
    }

    if (matterData.halo?.name) {
      const post = await this.getPost(matterData.halo.name);
      params = post ? post : params;
    }

    params.content.raw = raw;
    params.content.content = new MarkdownIt().render(raw);

    // restore metadata
    if (matterData.title) {
      params.post.spec.title = matterData.title;
    }

    if (matterData.categories) {
      const categoryNames = await this.getCategoryNames(matterData.categories);
      params.post.spec.categories = categoryNames;
    }

    if (matterData.tags) {
      const tagNames = await this.getTagNames(matterData.tags);
      params.post.spec.tags = tagNames;
    }

    // Save post
    try {
      if (params.post.metadata.name) {
        const { name } = params.post.metadata;
        await this.apiClient.put(
          `/apis/content.halo.run/v1alpha1/posts/${name}`,
          params.post
        );
        await this.apiClient.put(
          `/apis/api.console.halo.run/v1alpha1/posts/${name}/content`,
          params.content
        );
      } else {
        const fileName = path
          .basename(activeEditor.document.fileName)
          .replace(".md", "");
        params.post.metadata.name = randomUUID();
        params.post.spec.title = matterData.title || fileName;
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
    } catch (error) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Publish failed, please try again")
      );
      return;
    }

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

    await this.updatePost();

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

  public async updatePost(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }

    await activeEditor.document.save();

    const { data: matterData } = readMatter(activeEditor.document.getText());

    if (!matterData.halo?.name) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Please publish the post first")
      );
      return;
    }

    const post = await this.getPost(matterData.halo.name);

    if (!post) {
      vscode.window.showErrorMessage(vscode.l10n.t("Post not found"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(
      post.post.spec.categories
    );
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    const modifiedContent = mergeMatter(post.content.raw + "", {
      title: post.post.spec.title,
      categories: postCategories,
      tags: postTags,
      halo: {
        site: this.site.url,
        name: post.post.metadata.name,
        publish: post.post.spec.publish,
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

      await activeEditor.document.save();

      const markdownText = document.getText();
      const imageRegex = /!\[.*?\]\((.*?)\)/g;

      let match;

      const imagePaths: { path: string; absolutePath: string }[] = [];
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

        imagePaths.push({
          path: imagePath,
          absolutePath: absoluteImagePath,
        });
      }

      if (imagePaths.length === 0) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t("Uploading images..."),
          cancellable: false,
        },
        async (process) => {
          for (let i = 0; i < imagePaths.length; i++) {
            const imagePath = imagePaths[i];
            process.report({
              message: `${i + 1}/${imagePaths.length} ${imagePath.path}`,
              increment: (100 / imagePaths.length) * (i + 1),
            });

            const permalink = await this.uploadImage(imagePath.absolutePath);

            matchedImages.push({
              old: imagePath.path,
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

          if (matchedImages.length > 0) {
            vscode.window.showInformationMessage(
              vscode.l10n.t("Upload images success!")
            );
          }
        }
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

  public async getCategories(): Promise<Category[]> {
    const { data: categories } = await this.apiClient.get<CategoryList>(
      "/apis/content.halo.run/v1alpha1/categories"
    );
    return Promise.resolve(categories.items);
  }

  public async getTags(): Promise<Tag[]> {
    const { data: tags } = await this.apiClient.get<TagList>(
      "/apis/content.halo.run/v1alpha1/tags"
    );
    return Promise.resolve(tags.items);
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

    const postCategories = await this.getCategoryDisplayNames(
      post.post.spec.categories
    );
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    const modifiedContent = mergeMatter(post.content.raw + "", {
      title: post.post.spec.title,
      categories: postCategories,
      tags: postTags,
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

  public async getCategoryNames(displayNames: string[]): Promise<string[]> {
    const allCategories = await this.getCategories();

    const notExistDisplayNames = displayNames.filter(
      (name) => !allCategories.find((item) => item.spec.displayName === name)
    );

    const promises = notExistDisplayNames.map((name, index) =>
      this.apiClient.post<Category>(
        "/apis/content.halo.run/v1alpha1/categories",
        {
          spec: {
            displayName: name,
            slug: slugify(name, { trim: true }),
            description: "",
            cover: "",
            template: "",
            priority: allCategories.length + index,
            children: [],
          },
          apiVersion: "content.halo.run/v1alpha1",
          kind: "Category",
          metadata: { name: "", generateName: "category-" },
        }
      )
    );

    const newCategories = await Promise.all(promises);

    const existNames = displayNames
      .map((name) => {
        const found = allCategories.find(
          (item) => item.spec.displayName === name
        );
        return found ? found.metadata.name : undefined;
      })
      .filter(Boolean) as string[];

    return [
      ...existNames,
      ...newCategories.map((item) => item.data.metadata.name),
    ];
  }

  public async getCategoryDisplayNames(names?: string[]): Promise<string[]> {
    const categories = await this.getCategories();
    return names
      ?.map((name) => {
        const found = categories.find((item) => item.metadata.name === name);
        return found ? found.spec.displayName : undefined;
      })
      .filter(Boolean) as string[];
  }

  public async getTagNames(displayNames: string[]): Promise<string[]> {
    const allTags = await this.getTags();

    const notExistDisplayNames = displayNames.filter(
      (name) => !allTags.find((item) => item.spec.displayName === name)
    );

    const promises = notExistDisplayNames.map((name) =>
      this.apiClient.post<Tag>("/apis/content.halo.run/v1alpha1/tags", {
        spec: {
          displayName: name,
          slug: slugify(name, { trim: true }),
          color: "#ffffff",
          cover: "",
        },
        apiVersion: "content.halo.run/v1alpha1",
        kind: "Tag",
        metadata: { name: "", generateName: "tag-" },
      })
    );

    const newTags = await Promise.all(promises);

    const existNames = displayNames
      .map((name) => {
        const found = allTags.find((item) => item.spec.displayName === name);
        return found ? found.metadata.name : undefined;
      })
      .filter(Boolean) as string[];

    return [...existNames, ...newTags.map((item) => item.data.metadata.name)];
  }

  public async getTagDisplayNames(names?: string[]): Promise<string[]> {
    const tags = await this.getTags();
    return names
      ?.map((name) => {
        const found = tags.find((item) => item.metadata.name === name);
        return found ? found.spec.displayName : undefined;
      })
      .filter(Boolean) as string[];
  }
}

export default HaloService;
