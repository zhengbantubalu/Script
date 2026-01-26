import { getLocalScannerBaseUrl } from "../core/config.js";
import { downloadTextFile } from "../core/download.js";
import { buildLocalScannerCommand, buildLocalScannerScript } from "../core/localScanner.js";
import { handleSubmit } from "../api/submit.js";
import { handleExtractFramesSubmit } from "../ui/forms/extractFrames.js";
import { showImagePreview } from "../ui/imagePreview.js";
import { updateStatus } from "../ui/result.js";

/**
 * 绑定全局事件。
 * @returns {void}
 */
export const bindEvents = () => {
  document.body.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const navigateId = target.getAttribute("data-navigate");
    if (navigateId) {
      event.preventDefault();
      window.location.hash = `#/module/${navigateId}`;
      return;
    }

    const link = target.getAttribute("data-link");
    if (link === "home") {
      event.preventDefault();
      window.location.hash = "";
    }

    // 本地扫描助手交互（当前 UI 未默认暴露按钮，保留以便未来扩展）
    if (target.matches("[data-check-local-scanner]")) {
      event.preventDefault();
      const form = target.closest("form");
      if (form instanceof HTMLFormElement) {
        updateStatus(form, "info", "检测本地扫描助手...", getLocalScannerBaseUrl());
      }
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000);
      fetch(`${getLocalScannerBaseUrl()}/health`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`状态码 ${res.status}`))))
        .then((json) => {
          if (form instanceof HTMLFormElement) {
            updateStatus(form, "success", "本地扫描助手已就绪", JSON.stringify(json));
          }
        })
        .catch((err) => {
          if (form instanceof HTMLFormElement) {
            updateStatus(
              form,
              "error",
              "未检测到本地扫描助手",
              String(err && err.message ? err.message : err)
            );
          }
        })
        .finally(() => clearTimeout(id));
      return;
    }

    if (target.matches("[data-copy-local-command]")) {
      event.preventDefault();
      const cmd = buildLocalScannerCommand();
      navigator.clipboard.writeText(cmd).then(
        () => {
          const form = target.closest("form");
          if (form instanceof HTMLFormElement) {
            updateStatus(form, "success", "已复制运行命令", "请在本机终端粘贴执行；macOS/Linux 建议加 sudo");
          }
        },
        (err) => {
          const form = target.closest("form");
          if (form instanceof HTMLFormElement) {
            updateStatus(form, "error", "复制命令失败", String(err && err.message ? err.message : err));
          }
        }
      );
      return;
    }

    if (target.matches("[data-download-local-script]")) {
      event.preventDefault();
      const { filename, content, mime } = buildLocalScannerScript();
      downloadTextFile(filename, content, mime);
      const form = target.closest("form");
      if (form instanceof HTMLFormElement) {
        updateStatus(form, "success", "已下载启动脚本", "macOS: 赋予执行权限并运行；Windows: 双击运行 .bat");
      }
      return;
    }

    // 复制 GIF 到系统剪贴板
    if (target.matches("[data-copy-gif]")) {
      event.preventDefault();
      const form = target.closest("form");
      const src = target.getAttribute("data-src") || "";
      if (!(form instanceof HTMLFormElement) || !src) {
        return;
      }
      const copyGifToClipboard = async (url) => {
        try {
          if (navigator.clipboard && typeof window.ClipboardItem === "function") {
            const res = await fetch(url, { mode: "cors" });
            if (!res.ok) throw new Error(`获取 GIF 失败：HTTP ${res.status}`);
            const blob = await res.blob();
            const item = new window.ClipboardItem({ "image/gif": blob });
            await navigator.clipboard.write([item]);
            updateStatus(form, "success", "已复制 GIF 到剪贴板", "可直接在聊天/文档中粘贴图片");
            return;
          }
          await navigator.clipboard.writeText(url);
          updateStatus(form, "success", "已复制 GIF 链接", url);
        } catch (err) {
          try {
            if (navigator.clipboard) {
              await navigator.clipboard.writeText(url);
              updateStatus(form, "success", "已复制 GIF 链接", url);
            } else {
              updateStatus(form, "error", "复制失败", String(err && err.message ? err.message : err));
            }
          } catch (e) {
            updateStatus(form, "error", "复制失败", String(e && e.message ? e.message : e));
          }
        }
      };
      updateStatus(form, "info", "正在复制 GIF...", "");
      void copyGifToClipboard(src);
      return;
    }

    const previewTrigger = target.closest("[data-preview-full]");
    if (previewTrigger) {
      event.preventDefault();
      const src = previewTrigger.getAttribute("data-preview-full") ?? "";
      if (src !== "") {
        const alt = previewTrigger.getAttribute("data-preview-alt") ?? "";
        showImagePreview(src, alt);
      }
    }
  });

  document.body.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLFormElement) {
      const form = event.target;
      const moduleId = form.getAttribute("data-module-form");
      // 视频抽帧模块使用独立的提交逻辑
      // 为了先实现 MVP 阶段的功能，先使用独立的提交逻辑
      if (moduleId === "extract-frames") {
        void handleExtractFramesSubmit(event);
      } else {
        // 其他模块使用统一的提交逻辑
        void handleSubmit(event);
      }
    }
  });
};

