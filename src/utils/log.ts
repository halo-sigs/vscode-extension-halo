import * as vscode from "vscode";

/**
 * Halo 扩展日志通道：批量发布/图片处理等长流程的详细记录。
 * 通知进度条空间有限，完整过程（每篇文章、每张图片、错误原因）都记录于此。
 */
class HaloLog {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    // log: false 使用普通输出通道——避免 VS Code 自动加的 [Info] 前缀，
    // 自己控制格式（时间戳+级别+缩进），显示更美观
    this.channel = vscode.window.createOutputChannel("Halo", { log: false });
  }

  private timestamp(): string {
    const now = new Date();
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
  }

  public info(message: string): void {
    this.channel.appendLine(`${this.timestamp()} ${message}`);
  }

  public detail(message: string): void {
    // 缩进两格：作为上一条记录的明细（图片进度、服务器返回等）
    this.channel.appendLine(`  ${message}`);
  }

  public error(message: string): void {
    this.channel.appendLine(`${this.timestamp()} ✗ ${message}`);
  }

  public separator(): void {
    this.channel.appendLine("");
  }

  public show(): void {
    this.channel.show(true);
  }
}

export default new HaloLog();
