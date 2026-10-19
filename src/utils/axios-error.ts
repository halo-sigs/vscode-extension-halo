import axios from "axios";
import { isHaloApiError } from "./halo-api-error";

/** 提取 axios 错误中服务器返回的具体原因 */
export function getAxiosErrorDetail(error: unknown): string {
  // 拦截器包装的 HaloApiError：透传 cause 取底层 axios 错误的原始原因
  if (isHaloApiError(error)) {
    return getAxiosErrorDetail(error.cause);
  }
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { detail?: string; title?: string }
      | undefined;
    return data?.detail || data?.title || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "";
}
