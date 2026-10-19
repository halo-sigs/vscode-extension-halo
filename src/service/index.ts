import * as vscode from "vscode";
import { HaloClient } from "../api/halo-client";
import type { Site } from "../utils/site-store";
import { ImageProcessor } from "./image-processor";
import { PostPublisher } from "./post-publisher";
import { PostReader } from "./post-reader";
import { Taxonomy } from "./taxonomy";

export { CategoryTagPermissionError } from "./types";
export type {
  FetchResult,
  ImageOutcome,
  ImageResult,
  PublishResult,
} from "./types";

/**
 * 门面：组合各 service 模块（发布/读取/图片/分类标签），命令层只依赖本类；
 * 各模块共享同一 HaloClient（同源认证、超时与错误翻译）
 */
class HaloService {
  private readonly client: HaloClient;
  private readonly publisher: PostPublisher;
  private readonly reader: PostReader;
  private readonly images: ImageProcessor;
  private readonly taxonomy: Taxonomy;

  constructor(site?: Site) {
    if (!site) {
      throw new Error(vscode.l10n.t("No site found"));
    }
    this.client = new HaloClient(site);
    this.taxonomy = new Taxonomy(this.client);
    this.reader = new PostReader(this.client, this.taxonomy);
    this.images = new ImageProcessor(this.client);
    this.publisher = new PostPublisher(
      this.client,
      this.reader,
      this.taxonomy,
      this.images,
    );
  }

  publishPost(
    uri: vscode.Uri,
    report?: (message: string, increment?: number) => void,
  ) {
    return this.publisher.publishPost(uri, report);
  }

  updatePost(uri: vscode.Uri) {
    return this.reader.updatePost(uri);
  }

  uploadImages(uri: vscode.Uri) {
    return this.images.uploadImages(uri);
  }

  getPosts() {
    return this.reader.getPosts();
  }

  pullPost(name: string, targetFolder?: vscode.Uri) {
    return this.reader.pullPost(name, targetFolder);
  }

  getCategories() {
    return this.taxonomy.getCategories();
  }

  getTags() {
    return this.taxonomy.getTags();
  }

  getPolicies() {
    return this.client.getPolicies();
  }

  getGroups() {
    return this.client.getGroups();
  }
}

export default HaloService;
