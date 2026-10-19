import {
  AttachmentV1alpha1ConsoleApi,
  AttachmentV1alpha1UcApi,
  type Group,
  type Policy,
  PostV1alpha1UcApi,
} from "@halo-dev/api-client";
import axios, { type AxiosInstance } from "axios";
import * as vscode from "vscode";
import { attachHaloInterceptors } from "../utils/halo-api-error";
import type { Site } from "../utils/site-store";

/**
 * Halo API 客户端：统一构建 axios 实例（认证、超时、错误翻译拦截器）
 * 与各 API 封装，供 service 层各模块共享
 */
export class HaloClient {
  readonly apiClient: AxiosInstance;
  readonly postApi: PostV1alpha1UcApi;
  readonly attachmentApi: AttachmentV1alpha1UcApi;
  readonly consoleAttachmentApi: AttachmentV1alpha1ConsoleApi;
  /** 图片上传/下载超时（毫秒）——比普通请求宽（单张大图可能耗时较长） */
  readonly uploadTimeoutMs: number;

  constructor(readonly site: Site) {
    // 实例级超时覆盖所有普通请求（文章 CRUD 等），
    // 避免对端或中间代理断连慢时请求无限挂起
    const requestTimeoutSec = vscode.workspace
      .getConfiguration("halo.network")
      .get<number>("requestTimeout", 60);
    this.uploadTimeoutMs =
      vscode.workspace
        .getConfiguration("halo.network")
        .get<number>("uploadTimeout", 120) * 1000;

    const axiosInstance = axios.create({
      baseURL: site.url,
      timeout: requestTimeoutSec * 1000,
      headers: {
        Authorization: `Bearer ${site.pat}`,
      },
    });
    // 响应拦截器统一翻译错误（403 带权限标注/404/网络/HTTP），
    // 调用方按 HaloApiError.kind 做业务分支，文案由 message 直接给出
    attachHaloInterceptors(axiosInstance);
    this.apiClient = axiosInstance;
    this.postApi = new PostV1alpha1UcApi(undefined, site.url, axiosInstance);
    this.attachmentApi = new AttachmentV1alpha1UcApi(
      undefined,
      site.url,
      axiosInstance,
    );
    this.consoleAttachmentApi = new AttachmentV1alpha1ConsoleApi(
      undefined,
      site.url,
      axiosInstance,
    );
  }

  /** 存储策略列表（配置图片存储策略用，需要附件管理权限） */
  async getPolicies(): Promise<Policy[]> {
    const { data } = await this.apiClient.get<{ items: Policy[] }>(
      "/apis/storage.halo.run/v1alpha1/policies",
    );
    return data.items;
  }

  /** 存储分组列表（配置图片存储策略用，需要附件管理权限） */
  async getGroups(): Promise<Group[]> {
    const { data } = await this.apiClient.get<{ items: Group[] }>(
      "/apis/storage.halo.run/v1alpha1/groups",
    );
    return data.items;
  }
}
