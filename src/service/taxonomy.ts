import type {
  Category,
  CategoryList,
  Tag,
  TagList,
} from "@halo-dev/api-client";
import { slugify } from "transliteration";
import type { HaloClient } from "../api/halo-client";
import { isHaloApiError } from "../utils/halo-api-error";
import { CategoryTagPermissionError } from "./types";

/**
 * 分类/标签：列表查询（带实例级缓存）、显示名与服务器标识互转、
 * 缺失项自动创建（需管理权限，403 时抛出带标注的错误）
 */
export class Taxonomy {
  /**
   * 分类/标签列表缓存（同一服务实例内复用，批量发布避免逐篇重复拉取）。
   * 创建新分类/标签后置空失效
   */
  private categoriesCache?: Category[];
  private tagsCache?: Tag[];

  constructor(private readonly client: HaloClient) {}

  async getCategories(): Promise<Category[]> {
    if (this.categoriesCache) {
      return this.categoriesCache;
    }
    const { data: categories } = await this.client.apiClient.get<CategoryList>(
      "/apis/content.halo.run/v1alpha1/categories",
    );
    this.categoriesCache = categories.items;
    return categories.items;
  }

  async getTags(): Promise<Tag[]> {
    if (this.tagsCache) {
      return this.tagsCache;
    }
    const { data: tags } = await this.client.apiClient.get<TagList>(
      "/apis/content.halo.run/v1alpha1/tags",
    );
    this.tagsCache = tags.items;
    return tags.items;
  }

  /**
   * 分类显示名 → 服务器分类标识（发布时写 spec.categories 用）。
   * 本地有而服务器没有的分类自动创建（需分类管理权限，403 时抛出带标注的错误）
   */
  async getCategoryNames(displayNames: string[]): Promise<string[]> {
    const allCategories = await this.getCategories();

    const notExistDisplayNames = displayNames.filter(
      (name) => !allCategories.find((item) => item.spec.displayName === name),
    );

    const promises = notExistDisplayNames.map(async (name, index) => {
      try {
        return await this.client.apiClient.post<Category>(
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
        );
      } catch (error) {
        throw this.decorateCategoryTagError(error, "category", name);
      }
    });

    const newCategories = await Promise.all(promises);
    this.categoriesCache = undefined;

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

  async getCategoryDisplayNames(names?: string[]): Promise<string[]> {
    const categories = await this.getCategories();
    return names
      ?.map((name) => {
        const found = categories.find((item) => item.metadata.name === name);
        return found ? found.spec.displayName : undefined;
      })
      .filter(Boolean) as string[];
  }

  /**
   * 标签显示名 → 服务器标签标识（发布时写 spec.tags 用）。
   * 本地有而服务器没有的标签自动创建（需标签管理权限，403 时抛出带标注的错误）
   */
  async getTagNames(displayNames: string[]): Promise<string[]> {
    const allTags = await this.getTags();

    const notExistDisplayNames = displayNames.filter(
      (name) => !allTags.find((item) => item.spec.displayName === name),
    );

    const promises = notExistDisplayNames.map(async (name) => {
      try {
        return await this.client.apiClient.post<Tag>(
          "/apis/content.halo.run/v1alpha1/tags",
          {
            spec: {
              displayName: name,
              slug: slugify(name, { trim: true }),
              color: "#ffffff",
              cover: "",
            },
            apiVersion: "content.halo.run/v1alpha1",
            kind: "Tag",
            metadata: { name: "", generateName: "tag-" },
          },
        );
      } catch (error) {
        throw this.decorateCategoryTagError(error, "tag", name);
      }
    });

    const newTags = await Promise.all(promises);
    this.tagsCache = undefined;

    const existNames = displayNames
      .map((name) => {
        const found = allTags.find((item) => item.spec.displayName === name);
        return found ? found.metadata.name : undefined;
      })
      .filter(Boolean) as string[];

    return [...existNames, ...newTags.map((item) => item.data.metadata.name)];
  }

  async getTagDisplayNames(names?: string[]): Promise<string[]> {
    const tags = await this.getTags();
    return names
      ?.map((name) => {
        const found = tags.find((item) => item.metadata.name === name);
        return found ? found.spec.displayName : undefined;
      })
      .filter(Boolean) as string[];
  }

  /**
   * 分类/标签创建错误的 403 包装：补充"创建哪个分类/标签"的定位信息
   * （拦截器文案已含权限标注），由 publishPost 兜底 catch 识别
   */
  private decorateCategoryTagError(
    error: unknown,
    kind: "category" | "tag",
    displayName: string,
  ): unknown {
    if (isHaloApiError(error) && error.kind === "permission") {
      return new CategoryTagPermissionError(kind, displayName, error);
    }
    return error;
  }
}
