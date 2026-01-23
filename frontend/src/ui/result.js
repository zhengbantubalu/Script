import { BACKEND_BASE_URL } from "../core/config.js";
import { buildDownloadUrl, buildGifViewUrl, resolveFileUrl } from "../core/url.js";

/**
 * 判断文件路径是否为视频格式。
 * @param {string} path
 * @returns {boolean}
 */
const isVideoFile = (path) => {
  if (typeof path !== "string" || path.trim() === "") {
    return false;
  }
  const safePath = path.split("?")[0].split("#")[0].toLowerCase();
  return [
    ".mp4",
    ".mov",
    ".m4v",
    ".webm",
    ".mkv",
    ".avi",
    ".flv"
  ].some((ext) => safePath.endsWith(ext));
};

/**
 * 更新状态提示。
 * @param {HTMLFormElement} form 表单元素
 * @param {"info"|"success"|"error"} type 状态类型
 * @param {string} text 主文案
 * @param {string} [meta] 元信息
 * @returns {void}
 */
export const updateStatus = (form, type, text, meta = "") => {
  const panel = form.querySelector("[data-status-panel]");
  if (!panel) {
    return;
  }
  panel.classList.remove("status--info", "status--success", "status--error");
  panel.classList.add(`status--${type}`);
  panel.hidden = false;
  const textEl = panel.querySelector(".status__text");
  const metaEl = panel.querySelector(".status__meta");
  if (textEl) {
    textEl.textContent = text;
  }
  if (metaEl) {
    metaEl.textContent = meta;
  }
};

/**
 * 重置结果展示区域。
 * @param {HTMLFormElement} form 表单元素
 * @returns {void}
 */
export const resetResult = (form) => {
  const panel = form.querySelector("[data-result-panel]");
  if (!panel) {
    return;
  }
  const titleEl = panel.querySelector("[data-result-title]");
  const metaEl = panel.querySelector("[data-result-meta]");
  const actionsEl = panel.querySelector("[data-result-actions]");
  const previewsEl = panel.querySelector("[data-result-previews]");
  const filesSection = panel.querySelector("[data-result-files]");
  const fileListEl = panel.querySelector("[data-result-file-list]");
  if (titleEl) {
    titleEl.textContent = "处理结果";
  }
  if (metaEl) {
    metaEl.textContent = "";
    metaEl.hidden = true;
  }
  if (actionsEl) {
    actionsEl.innerHTML = "";
  }
  if (previewsEl) {
    previewsEl.hidden = true;
    previewsEl.innerHTML = "";
  }
  if (fileListEl) {
    fileListEl.innerHTML = "";
  }
  if (filesSection) {
    filesSection.hidden = true;
    const detailsEl = filesSection.querySelector("details");
    if (detailsEl) {
      detailsEl.open = false;
    }
  }
  panel.hidden = true;
};

/**
 * 渲染任务执行结果，包括下载链接与预览。
 * @param {HTMLFormElement} form 表单元素
 * @param {{id:string,name:string,tags:Array<{id:string,label:string}>,endpoint?:string}} module 当前模块配置
 * @param {Record<string, unknown>} payload 后端返回数据
 * @returns {void}
 */
export const renderResult = (form, module, payload) => {
  const panel = form.querySelector("[data-result-panel]");
  if (!panel) {
    return;
  }
  const titleEl = panel.querySelector("[data-result-title]");
  const metaEl = panel.querySelector("[data-result-meta]");
  const actionsEl = panel.querySelector("[data-result-actions]");
  const previewsEl = panel.querySelector("[data-result-previews]");
  const filesSection = panel.querySelector("[data-result-files]");
  const fileListEl = panel.querySelector("[data-result-file-list]");

  const titleText =
    typeof payload.message === "string" && payload.message.trim() !== ""
      ? payload.message.trim()
      : `${module.name}任务完成`;
  if (titleEl) {
    titleEl.textContent = titleText;
  }

  if (metaEl) {
    const metaParts = [];
    if (typeof payload.job_id === "string" && payload.job_id.trim() !== "") {
      metaParts.push(`任务编号：${payload.job_id.trim()}`);
    }
    if (typeof payload.total_files === "number" && Number.isFinite(payload.total_files)) {
      metaParts.push(`生成文件：${payload.total_files} 个`);
    } else if (Array.isArray(payload.files)) {
      metaParts.push(`生成文件：${payload.files.length} 个`);
    }
    metaEl.textContent = metaParts.join(" · ");
    metaEl.hidden = metaParts.length === 0;
  }

  if (actionsEl) {
    const actionItems = [];
    if (typeof payload.archive === "string" && payload.archive.trim() !== "") {
      const archiveUrl = buildDownloadUrl(payload.archive);
      actionItems.push(`<a class="button" href="${archiveUrl}">下载压缩包</a>`);
    }

    if (module.id === "url-to-mp4" && Array.isArray(payload.files) && payload.files.length > 0) {
      const firstFile = payload.files[0];
      if (typeof firstFile === "string" && firstFile.trim() !== "") {
        const videoUrl = buildDownloadUrl(firstFile);
        actionItems.push(`<a class="button" href="${videoUrl}">下载视频</a>`);
      }
    }

    if (module.id === "mp4-to-gif" && Array.isArray(payload.files) && payload.files.length > 0) {
      const first = payload.files[0];
      if (typeof first === "string" && first.trim() !== "") {
        const viewUrl = resolveFileUrl(first);
        const downloadUrl = buildDownloadUrl(first);
        const wechatUrl = buildGifViewUrl(first);
        const qrUrl = `${BACKEND_BASE_URL}/api/utils/qrcode?url=${encodeURIComponent(wechatUrl)}`;
        actionItems.push(
          `<a class="button" href="${downloadUrl}">下载 GIF</a>`,
          `<button class="button" type="button" data-copy-gif data-src="${viewUrl}">复制 GIF</button>`,
          `<a class="button" href="${qrUrl}" target="_blank" rel="noopener noreferrer">微信二维码</a>`
        );
      }
    }

    if (actionItems.length === 0 && Array.isArray(payload.files) && payload.files.length > 0) {
      const firstFile = payload.files[0];
      if (typeof firstFile === "string" && firstFile.trim() !== "") {
        const fileUrl = buildDownloadUrl(firstFile);
        const label = module.tags.some((tag) => tag.id === "media") ? "下载文件" : "下载结果";
        actionItems.push(`<a class="button" href="${fileUrl}">${label}</a>`);
      }
    }

    actionsEl.innerHTML =
      actionItems.length > 0
        ? actionItems.join(" ")
        : '<span class="result__empty">暂无可下载内容</span>';
  }

  if (previewsEl) {
    if (module.id === "network-scan" && Array.isArray(payload.groups)) {
      const networks = Array.isArray(payload.networks) ? payload.networks : [];
      const groupsHtml = payload.groups
        .map((group) => {
          const items = Array.isArray(group.devices)
            ? group.devices
                .map((d) => {
                  const name = typeof d.name === "string" && d.name ? d.name : d.ip;
                  const ip = d.ip ?? "";
                  const mac = d.mac ?? "";
                  const hn = d.hostname ?? "";
                  const ports = Array.isArray(d.open_ports) ? d.open_ports.join(", ") : "";
                  return `<li class="result__list-item">
                    <span class="result__device-name">${name}</span>
                    <span class="result__device-meta">IP: ${ip}${
                      mac ? ` · MAC: ${mac}` : ""
                    }${hn ? ` · 主机名: ${hn}` : ""}${ports ? ` · 端口: ${ports}` : ""}</span>
                  </li>`;
                })
                .join("")
            : "";
          return `
            <section class="result__group">
              <header class="result__group-header">
                <h4 class="result__group-title">${group.label ?? group.key}</h4>
                <span class="result__group-count">${group.count ?? 0} 台</span>
              </header>
              <ul class="result__list">${items || '<li class="result__list-item">暂无设备</li>'}</ul>
            </section>
          `;
        })
        .join("");
      const header = `<p class="result__meta">扫描网段：${networks.join(", ") || "未识别"}</p>`;
      previewsEl.innerHTML = `${header}${groupsHtml}`;
      previewsEl.hidden = false;
    } else {
      const blocks = [];
      if (Array.isArray(payload.previews) && payload.previews.length > 0) {
        const isFullPreviewModule = module.id === "images-download";
        const isQrModule =
          module.id === "qrcode-generator" ||
          module.id === "url-to-qrcode" ||
          module.id === "mp3-to-qrcode";
        const previewItems = payload.previews
          .map((previewUrl, index) => {
            if (typeof previewUrl !== "string") {
              return "";
            }
            const fullUrl = resolveFileUrl(previewUrl);
            const downloadUrl = buildDownloadUrl(previewUrl);
            const filename = previewUrl.split("/").pop() || `file-${index + 1}`;
            const copyBtn =
              module.id === "mp4-to-gif"
                ? `<button class="preview-grid__copy" type="button" data-copy-gif data-src="${fullUrl}">复制</button>`
                : "";
            return `
              <figure class="preview-grid__item">
                <button
                  class="preview-grid__image-button"
                  type="button"
                  data-preview-full="${fullUrl}"
                  data-preview-alt="${module.name} 预览图 ${index + 1}"
                >
                  <img class="preview-grid__image" src="${fullUrl}" alt="${module.name} 预览图 ${index + 1}" loading="lazy" />
                </button>
                <figcaption class="preview-grid__caption">
                  <span class="preview-grid__label">预览 ${index + 1}</span>
                  <a class="preview-grid__download" href="${downloadUrl}" download="${filename}">下载</a>
                  ${copyBtn}
                </figcaption>
              </figure>
            `;
          })
          .join("");
        const header = `<p class="result__meta">结果预览（${isFullPreviewModule ? "共" : "展示前"} ${
          payload.previews.length
        } 项）</p>`;
        const gridClass = `preview-grid${isQrModule ? " preview-grid--qrcode" : ""}`;
        blocks.push(`${header}<div class="${gridClass}">${previewItems}</div>`);
      }

      const videoFiles = Array.isArray(payload.files)
        ? payload.files.filter((fileUrl) => typeof fileUrl === "string" && isVideoFile(fileUrl))
        : [];
      if (videoFiles.length > 0) {
        const videoItems = videoFiles
          .map((videoUrl, index) => {
            const fullUrl = resolveFileUrl(videoUrl);
            const downloadUrl = buildDownloadUrl(videoUrl);
            const filename = videoUrl.split("/").pop() || `video-${index + 1}`;
            return `
              <figure class="preview-grid__item">
                <video class="preview-grid__video" src="${fullUrl}" controls preload="metadata" playsinline></video>
                <figcaption class="preview-grid__caption">
                  <span class="preview-grid__label">视频预览 ${index + 1}</span>
                  <a class="preview-grid__download" href="${downloadUrl}" download="${filename}">下载</a>
                </figcaption>
              </figure>
            `;
          })
          .join("");
        const header = `<p class="result__meta">视频预览（共 ${videoFiles.length} 项）</p>`;
        blocks.push(`${header}<div class="preview-grid preview-grid--video">${videoItems}</div>`);
      }

      if (blocks.length > 0) {
        previewsEl.innerHTML = blocks.join("");
        previewsEl.hidden = false;
      } else {
        previewsEl.hidden = true;
        previewsEl.innerHTML = "";
      }
    }
  }

  if (filesSection && fileListEl) {
    if (Array.isArray(payload.files) && payload.files.length > 0) {
      const fileItems = payload.files
        .map((fileUrl, index) => {
          if (typeof fileUrl !== "string") {
            return "";
          }
          const fullUrl = buildDownloadUrl(fileUrl);
          const label = fileUrl.split("/").pop() || `文件 ${index + 1}`;
          return `<li class="result__file-item"><a href="${fullUrl}" download="${label}">${label}</a></li>`;
        })
        .filter(Boolean)
        .join("");
      fileListEl.innerHTML = fileItems;
      filesSection.hidden = false;
      const detailsEl = filesSection.querySelector("details");
      if (detailsEl) {
        detailsEl.open = false;
      }
    } else {
      fileListEl.innerHTML = "";
      filesSection.hidden = true;
    }
  }

  panel.hidden = false;
};

