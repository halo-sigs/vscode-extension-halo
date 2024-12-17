import { File } from "node:buffer";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import {
  type Category,
  type CategoryList,
  type Content,
  type ListedPost,
  type Post,
  type Tag,
  type TagList,
  UcApiContentHaloRunV1alpha1AttachmentApi,
  UcApiContentHaloRunV1alpha1PostApi,
} from "@halo-dev/api-client";
import axios, { type AxiosInstance } from "axios";
import { fileTypeFromFile } from "file-type";
import { slugify } from "transliteration";
import * as vscode from "vscode";
import markdownIt from "../utils/markdown";
import type { Site } from "../utils/site-store";
import { mergeMatter, readMatter } from "../utils/yaml";
import path = require("node:path");

class HaloService {
  private readonly site: Site;
  private readonly apiClient: AxiosInstance;
  private readonly postApi: UcApiContentHaloRunV1alpha1PostApi;
  private readonly attachmentApi: UcApiContentHaloRunV1alpha1AttachmentApi;

  constructor(site?: Site) {
    if (!site) {
      throw new Error(vscode.l10n.t("No site found"));
    }
    this.site = site;
    const axiosInstance = axios.create({
      baseURL: site.url,
      headers: {
        Authorization: `Bearer ${site.pat}`,
      },
    });
    this.apiClient = axiosInstance;
    this.postApi = new UcApiContentHaloRunV1alpha1PostApi(
      undefined,
      site.url,
      axiosInstance,
    );
    this.attachmentApi = new UcApiContentHaloRunV1alpha1AttachmentApi(
      undefined,
      site.url,
      axiosInstance,
    );
  }

  public async getPost(
    name: string,
  ): Promise<{ post: Post; content: Content } | undefined> {
    try {
      const { data: post } = await this.postApi.getMyPost({ name });

      const { data: snapshot } = await this.postApi.getMyPostDraft({
        name,
        patched: true,
      });

      const {
        "content.halo.run/patched-content": patchedContent,
        "content.halo.run/patched-raw": patchedRaw,
      } = snapshot.metadata.annotations || {};

      const { rawType } = snapshot.spec || {};

      const content: Content = {
        content: patchedContent,
        raw: patchedRaw,
        rawType,
      };

      return Promise.resolve({
        post: post,
        content: content,
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

    let params: Post = {
      apiVersion: "content.halo.run/v1alpha1",
      kind: "Post",
      metadata: {
        annotations: {},
        name: "",
      },
      spec: {
        allowComment: true,
        baseSnapshot: "",
        categories: [],
        cover: "",
        deleted: false,
        excerpt: {
          autoGenerate: true,
          raw: "",
        },
        headSnapshot: "",
        htmlMetas: [],
        owner: "",
        pinned: false,
        priority: 0,
        publish: false,
        publishTime: "",
        releaseSnapshot: "",
        slug: "",
        tags: [],
        template: "",
        title: "",
        visible: "PUBLIC",
      },
    };

    let content: Content = {
      rawType: "markdown",
      raw: "",
      content: "",
    };

    const { content: raw, data: matterData } = readMatter(
      activeEditor.document.getText(),
    );

    // check site url
    if (matterData.halo?.site && matterData.halo.site !== this.site.url) {
      vscode.window.showErrorMessage(vscode.l10n.t("Site url is not matched"));
      return;
    }

    // fetch post
    if (matterData.halo?.name) {
      const post = await this.getPost(matterData.halo.name);

      if (post) {
        params = post.post;
        content = post.content;
      }
    }

    content.raw = raw;
    content.content = markdownIt.render(raw);

    // restore metadata
    if (matterData.title) {
      params.spec.title = matterData.title;
    }

    if (matterData.slug) {
      params.spec.slug = matterData.slug;
    }

    if (matterData.excerpt) {
      params.spec.excerpt.raw = matterData.excerpt;
      params.spec.excerpt.autoGenerate = false;
    }

    if (matterData.cover) {
      params.spec.cover = matterData.cover;
    }

    if (matterData.categories) {
      const categoryNames = await this.getCategoryNames(matterData.categories);
      params.spec.categories = categoryNames;
    }

    if (matterData.tags) {
      const tagNames = await this.getTagNames(matterData.tags);
      params.spec.tags = tagNames;
    }

    try {
      // Update post
      if (params.metadata.name) {
        const { name } = params.metadata;

        await this.postApi.updateMyPost({ name: name, post: params });

        const { data: snapshot } = await this.postApi.getMyPostDraft({
          name,
          patched: true,
        });

        snapshot.metadata.annotations = {
          ...snapshot.metadata.annotations,
          "content.halo.run/content-json": JSON.stringify(content),
        };

        await this.postApi.updateMyPostDraft({
          name,
          snapshot,
        });
      } else {
        // Create a new post
        const fileName = path
          .basename(activeEditor.document.fileName)
          .replace(".md", "");
        params.metadata.name = randomUUID();
        params.spec.title = matterData.title || fileName;
        params.spec.slug = matterData.slug || slugify(fileName, { trim: true });

        params.metadata.annotations = {
          ...params.metadata.annotations,
          "content.halo.run/content-json": JSON.stringify(content),
        };

        const { data: newPost } = await this.postApi.createMyPost({
          post: params,
        });

        params = newPost;
      }

      // biome-ignore lint: no
      if (matterData?.halo?.hasOwnProperty("publish")) {
        // Publish post
        if (matterData.halo?.publish) {
          await this.postApi.publishMyPost({ name: params.metadata.name });
        } else {
          await this.postApi.unpublishMyPost({ name: params.metadata.name });
        }
      } else {
        const postConfiguration =
          vscode.workspace.getConfiguration("halo.post");

        if (postConfiguration.get<boolean>("publishByDefault")) {
          await this.postApi.publishMyPost({ name: params.metadata.name });
        }
      }

      // Fetch new post and content
      const latestPost = await this.getPost(params.metadata.name);

      if (latestPost) {
        params = latestPost.post;
        content = latestPost.content;
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("Publish failed, please try again"),
      );
      return;
    }

    const modifiedContent = mergeMatter(raw, {
      ...matterData,
      halo: {
        site: this.site.url,
        name: params.metadata.name,
        publish: params.spec.publish,
      },
    });

    await activeEditor.edit((editBuilder) => {
      editBuilder.replace(
        new vscode.Range(
          activeEditor.document.positionAt(0),
          activeEditor.document.positionAt(
            activeEditor.document.getText().length,
          ),
        ),
        modifiedContent,
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
            vscode.Uri.parse(`${this.site.url}${params.status?.permalink}`),
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
        vscode.l10n.t("Please publish the post first"),
      );
      return;
    }

    const post = await this.getPost(matterData.halo.name);

    if (!post) {
      vscode.window.showErrorMessage(vscode.l10n.t("Post not found"));
      return;
    }

    const postCategories = await this.getCategoryDisplayNames(
      post.post.spec.categories,
    );
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    const modifiedContent = mergeMatter(`${post.content.raw}`, {
      title: post.post.spec.title,
      slug: post.post.spec.slug,
      excerpt: post.post.spec.excerpt.autoGenerate
        ? undefined
        : post.post.spec.excerpt.raw,
      cover: post.post.spec.cover || undefined,
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
            activeEditor.document.getText().length,
          ),
        ),
        modifiedContent,
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
          vscode.l10n.t("Please open a Markdown file."),
        );
        return;
      }

      await activeEditor.document.save();

      const { data: matterData } = readMatter(activeEditor.document.getText());

      // We need publish post first, then we can upload images
      if (!matterData.halo?.name) {
        await this.publishPost();
      }

      const markdownText = document.getText();
      const imageRegex = /!\[.*?\]\((.*?)\)/g;

      let match: RegExpExecArray | null;

      const imagePaths: { path: string; absolutePath: string }[] = [];
      const matchedImages: { old: string; new: string }[] = [];

      // biome-ignore lint: no
      while ((match = imageRegex.exec(markdownText)) !== null) {
        const imagePath = match[1];

        if (imagePath.startsWith("http")) {
          continue;
        }

        const absoluteImagePath = path.resolve(
          path.dirname(document.uri.fsPath),
          imagePath,
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

            const permalink = await this.uploadImage(
              imagePath.absolutePath,
              matterData.halo.name,
            );

            matchedImages.push({
              old: imagePath.path,
              new: permalink,
            });
          }

          let newMarkdownText = markdownText;

          for (const item of matchedImages) {
            newMarkdownText = newMarkdownText.replace(item.old, item.new);
          }

          await activeEditor.edit((editBuilder) => {
            editBuilder.replace(
              new vscode.Range(
                document.positionAt(0),
                document.positionAt(markdownText.length),
              ),
              newMarkdownText,
            );
          });

          await activeEditor.document.save();

          if (matchedImages.length > 0) {
            vscode.window.showInformationMessage(
              vscode.l10n.t("Upload images success!"),
            );
          }
        },
      );
    }
  }

  public async getPosts(): Promise<ListedPost[]> {
    const { data: posts } = await this.postApi.listMyPosts({
      labelSelector: [ "content.halo.run/deleted=false" ],
    });
    return Promise.resolve(posts.items);
  }

  public async getCategories(): Promise<Category[]> {
    const { data: categories } = await this.apiClient.get<CategoryList>(
      "/apis/content.halo.run/v1alpha1/categories",
    );
    return Promise.resolve(categories.items);
  }

  public async getTags(): Promise<Tag[]> {
    const { data: tags } = await this.apiClient.get<TagList>(
      "/apis/content.halo.run/v1alpha1/tags",
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

    const fileName = `${post.post.spec.title}.md`;
    const fileUri = vscode.Uri.joinPath(folderUri, fileName);

    try {
      const fileExists = await vscode.workspace.fs.stat(fileUri);
      if (fileExists) {
        vscode.window.showErrorMessage(vscode.l10n.t("File already exists"));
        return;
      }
    } catch {}

    const postCategories = await this.getCategoryDisplayNames(
      post.post.spec.categories,
    );
    const postTags = await this.getTagDisplayNames(post.post.spec.tags);

    const modifiedContent = mergeMatter(`${post.content.raw}`, {
      title: post.post.spec.title,
      slug: post.post.spec.slug,
      excerpt: post.post.spec.excerpt.autoGenerate
        ? undefined
        : post.post.spec.excerpt.raw,
      cover: post.post.spec.cover || undefined,
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

  public async uploadImage(file: string, postName: string): Promise<string> {
    const fileType = await fileTypeFromFile(file);

    const fileBlob = new File(
      [ fs.readFileSync(decodeURIComponent(file)) ],
      path.basename(file),
      {
        type: fileType?.mime,
      },
    );

    try {
      const { data: attachment } =
        await this.attachmentApi.createAttachmentForPost({
          file: fileBlob,
          postName,
          waitForPermalink: true,
        });

      if (attachment.status?.permalink?.startsWith("http")) {
        return attachment.status?.permalink;
      }

      return this.site.url + attachment.status?.permalink || file;
    } catch (error) {
      console.error("Error uploading image:", error);
      return file;
    }
  }

  public async getCategoryNames(displayNames: string[]): Promise<string[]> {
    const allCategories = await this.getCategories();

    const notExistDisplayNames = displayNames.filter(
      (name) => !allCategories.find((item) => item.spec.displayName === name),
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
        },
      ),
    );

    const newCategories = await Promise.all(promises);

    const existNames = displayNames
      .map((name) => {
        const found = allCategories.find(
          (item) => item.spec.displayName === name,
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
      (name) => !allTags.find((item) => item.spec.displayName === name),
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
      }),
    );

    const newTags = await Promise.all(promises);

    const existNames = displayNames
      .map((name) => {
        const found = allTags.find((item) => item.spec.displayName === name);
        return found ? found.metadata.name : undefined;
      })
      .filter(Boolean) as string[];

    return [ ...existNames, ...newTags.map((item) => item.data.metadata.name) ];
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
