import { MODULES } from "../data/modules.js";
import { resolveEndpointUrl } from "../core/url.js";
import { renderResult, resetResult, updateStatus } from "../ui/result.js";

/**
 * 序列化表单数据。
 * @param {HTMLFormElement} form
 * @returns {FormData}
 */
export const serializeForm = (form) => {
  const formData = new FormData();
  const elements = Array.from(form.elements);
  elements.forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }
    const name = element.getAttribute("name");
    if (!name) {
      return;
    }

    if (element instanceof HTMLInputElement && element.type === "file") {
      Array.from(element.files ?? []).forEach((file) => {
        formData.append(name, file);
      });
    } else if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      if (element.value !== "") {
        formData.append(name, element.value);
      }
    }
  });
  return formData;
};

/**
 * 处理表单提交。
 * @param {SubmitEvent} event
 * @returns {Promise<void>}
 */
export const handleSubmit = async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  const moduleId = form.getAttribute("data-module-form");
  const module = MODULES.find((item) => item.id === moduleId);
  if (!module) {
    return;
  }

  resetResult(form);
  updateStatus(form, "info", "任务提交中...", "请稍候，正在处理");

  try {
    const formData = serializeForm(form);
    let endpoint = resolveEndpointUrl(module.endpoint);
    if (module.id === "qrcode-generator") {
      const modeEl = form.querySelector('[name="mode"]');
      const mode =
        modeEl && modeEl.value === "mp3" ? "mp3" : modeEl && modeEl.value === "video" ? "video" : "url";
      if (mode === "mp3") {
        endpoint = resolveEndpointUrl("/api/tasks/mp3-to-qrcode");
      } else if (mode === "video") {
        endpoint = resolveEndpointUrl("/api/tasks/video-to-qrcode");
      } else {
        endpoint = resolveEndpointUrl("/api/tasks/url-to-qrcode");
      }
    }
    const response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      let detail = `请求失败，状态码 ${response.status}`;
      try {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (data && typeof data.detail === "string" && data.detail.trim() !== "") {
            detail = data.detail.trim();
          } else if (typeof data.message === "string" && data.message.trim() !== "") {
            detail = data.message.trim();
          }
        } else {
          const text = await response.text();
          if (text && text.trim() !== "") detail = text.trim();
        }
      } catch (_e) {
        // ignore
      }
      throw new Error(detail);
    }

    const result = await response.json().catch(() => ({ message: "提交成功" }));
    const successMessage =
      typeof result.message === "string" && result.message.trim() !== ""
        ? result.message.trim()
        : `${module.name}任务已提交`;
    const metaText = result.job_id ? `任务编号：${result.job_id}` : "任务已排队";
    updateStatus(form, "success", successMessage, metaText);
    renderResult(form, module, result);
  } catch (error) {
    const errorMessage =
      error instanceof TypeError
        ? `无法连接后端服务：${error.message}`
        : error instanceof Error
          ? error.message
          : "未知错误";
    updateStatus(form, "error", "提交失败", errorMessage);
  }
};

