/**
 * 存一段文本成文件。
 *
 * 下载这件事在导出那三个按钮里各写了一遍（Blob → URL → a.click →
 * revokeObjectURL），抽出来一处维护。批量导出也要用。
 *
 * revoke 紧跟在 click 后面是安全的：浏览器已经把数据接过去了，此时
 * 回收 URL 不影响正在进行的下载。
 */
export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
