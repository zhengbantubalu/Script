/**
 * 通用“视频框选裁剪”组件：
 * - 自动在包含视频上传 input 的表单中挂载
 * - 允许用户在视频上拖拽框选区域
 * - 将裁剪参数写入隐藏字段：crop_x/crop_y/crop_w/crop_h（像素，基于原始分辨率）
 *
 * 说明：
 * - 若表单已存在视频预览（如抽帧模块），会复用已有 <video> 并叠加框选层
 * - 若表单没有预览，则自动插入一个预览播放器用于框选
 */

const CROPPER_MOUNT_ATTR = "data-video-cropper-mounted";

/**
 * @typedef {Object} CropRect
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * 找到表单中的视频文件输入框。
 * @param {HTMLFormElement} form
 * @returns {HTMLInputElement|null}
 */
const findVideoFileInput = (form) => {
  const candidates = Array.from(form.querySelectorAll('input[type="file"]'));
  for (const el of candidates) {
    if (!(el instanceof HTMLInputElement)) continue;
    const accept = (el.getAttribute("accept") || "").toLowerCase();
    const name = (el.getAttribute("name") || "").toLowerCase();
    if (accept.includes("video/") || name === "video") {
      return el;
    }
  }
  return null;
};

/**
 * 确保表单中存在指定 name 的隐藏字段。
 * @param {HTMLFormElement} form
 * @param {string} name
 * @returns {HTMLInputElement}
 */
const ensureHiddenInput = (form, name) => {
  const existing = form.querySelector(`input[type="hidden"][name="${name}"]`);
  if (existing instanceof HTMLInputElement) {
    return existing;
  }
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = name;
  input.value = "";
  form.appendChild(input);
  return input;
};

/**
 * 计算元素内的相对坐标（0..width/height）。
 * @param {PointerEvent} ev
 * @param {HTMLElement} el
 * @returns {{x:number,y:number,w:number,h:number}}
 */
const getLocalPoint = (ev, el) => {
  const rect = el.getBoundingClientRect();
  const x = Math.min(Math.max(ev.clientX - rect.left, 0), rect.width);
  const y = Math.min(Math.max(ev.clientY - rect.top, 0), rect.height);
  return { x, y, w: rect.width, h: rect.height };
};

/**
 * 规范化为左上角 + 宽高。
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {CropRect}
 */
const normalizeRect = (x1, y1, x2, y2) => {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  return { x, y, w, h };
};

/**
 * 将显示坐标映射到视频原始分辨率坐标。
 * @param {CropRect} displayRect
 * @param {HTMLVideoElement} video
 * @param {{stageW:number,stageH:number}} stageSize
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
const mapToVideoPixels = (displayRect, video, stageSize) => {
  const vw = Number(video.videoWidth) || 0;
  const vh = Number(video.videoHeight) || 0;
  if (!vw || !vh || !stageSize.stageW || !stageSize.stageH) return null;
  const scaleX = vw / stageSize.stageW;
  const scaleY = vh / stageSize.stageH;
  const x = Math.round(displayRect.x * scaleX);
  const y = Math.round(displayRect.y * scaleY);
  const w = Math.round(displayRect.w * scaleX);
  const h = Math.round(displayRect.h * scaleY);
  return { x, y, w, h };
};

/**
 * 挂载视频裁剪框选 UI（如果表单存在视频输入）。
 * @param {HTMLFormElement|null} form
 * @returns {void}
 */
export const setupVideoCropperForForm = (form) => {
  if (!(form instanceof HTMLFormElement)) return;
  if (form.hasAttribute(CROPPER_MOUNT_ATTR)) return;

  const fileInput = findVideoFileInput(form);
  if (!(fileInput instanceof HTMLInputElement)) return;

  // 隐藏字段：只有在用户启用并完成框选后才会写入数值
  const cropX = ensureHiddenInput(form, "crop_x");
  const cropY = ensureHiddenInput(form, "crop_y");
  const cropW = ensureHiddenInput(form, "crop_w");
  const cropH = ensureHiddenInput(form, "crop_h");

  // 尝试复用已有预览 video（抽帧模块等）
  /** @type {HTMLVideoElement|null} */
  let video = null;
  /** @type {File|null} */
  let lastSelectedFile = null;
  const existingVideo = form.querySelector("video");
  if (existingVideo instanceof HTMLVideoElement) {
    video = existingVideo;
  }

  // 若没有预览，则插入一个最小可用预览区
  let injectedObjectUrl = "";
  const revokeInjectedUrl = () => {
    if (injectedObjectUrl) {
      URL.revokeObjectURL(injectedObjectUrl);
      injectedObjectUrl = "";
    }
  };

  /** @type {HTMLDivElement|null} */
  let stage = null;
  /** @type {HTMLDivElement|null} */
  let overlay = null;
  /** @type {HTMLDivElement|null} */
  let rectEl = null;
  /** @type {HTMLDivElement|null} */
  let panel = null;
  /** @type {HTMLInputElement|null} */
  let enableEl = null;
  /** @type {HTMLElement|null} */
  let valueEl = null;

  const ensureUi = () => {
    if (panel && stage && overlay && rectEl && video && enableEl && valueEl) return;

    // 尝试找到一个合适的“舞台容器”，优先复用抽帧模块的 wrapper
    const existingWrapper = form.querySelector(".video-preview__player-wrapper");
    if (existingWrapper instanceof HTMLElement && video instanceof HTMLVideoElement) {
      existingWrapper.classList.add("video-cropper__stage");
      stage = existingWrapper instanceof HTMLDivElement ? existingWrapper : /** @type {HTMLDivElement} */ (existingWrapper);
    } else {
      // 注入预览区
      const group = fileInput.closest(".form__group") || fileInput.parentElement || form;
      const wrapper = document.createElement("div");
      wrapper.className = "video-cropper__container";
      wrapper.innerHTML = `
        <div class="video-cropper__stage">
          <video class="video-cropper__video" controls preload="metadata" playsinline></video>
          <div class="video-cropper__overlay" data-crop-overlay>
            <div class="video-cropper__rect" data-crop-rect></div>
          </div>
        </div>
      `;
      // 插到上传控件下方
      group.insertAdjacentElement("afterend", wrapper);
      const injectedVideo = wrapper.querySelector("video");
      if (injectedVideo instanceof HTMLVideoElement) {
        video = injectedVideo;
      }
      stage = wrapper.querySelector(".video-cropper__stage");
    }

    // 叠加层：若复用现有 wrapper，则需要手动插入 overlay
    if (stage && !(stage.querySelector(".video-cropper__overlay") instanceof HTMLElement)) {
      const o = document.createElement("div");
      o.className = "video-cropper__overlay";
      o.setAttribute("data-crop-overlay", "");
      o.innerHTML = `<div class="video-cropper__rect" data-crop-rect></div>`;
      stage.appendChild(o);
    }

    overlay = stage ? stage.querySelector("[data-crop-overlay]") : null;
    rectEl = stage ? stage.querySelector("[data-crop-rect]") : null;

    // 控制面板（放在舞台后面，尽量不干扰原布局）
    if (!(form.querySelector("[data-video-cropper-panel]") instanceof HTMLElement)) {
      const p = document.createElement("div");
      p.className = "video-cropper__panel";
      p.setAttribute("data-video-cropper-panel", "");
      p.innerHTML = `
        <div class="video-cropper__panel-row">
          <label class="video-cropper__toggle">
            <input type="checkbox" data-crop-enable />
            <span>启用裁剪（拖拽框选目标区域）</span>
          </label>
          <div class="video-cropper__buttons">
            <button class="button button--ghost" type="button" data-crop-clear>清除</button>
          </div>
        </div>
        <div class="video-cropper__panel-row video-cropper__panel-row--meta">
          <span class="video-cropper__meta" data-crop-value>未选择区域</span>
        </div>
        <p class="form__hint">裁剪坐标以原始分辨率像素为准；不启用时将使用全画面处理。</p>
      `;
      // 若抽帧模块存在 timeline/toolbars，放在预览容器里更自然；否则放在视频下方
      const previewContainer = form.querySelector("[data-video-preview]");
      if (previewContainer instanceof HTMLElement) {
        previewContainer.appendChild(p);
      } else if (stage) {
        stage.insertAdjacentElement("afterend", p);
      } else {
        form.appendChild(p);
      }
    }

    panel = /** @type {HTMLDivElement|null} */ (form.querySelector("[data-video-cropper-panel]"));
    enableEl = panel ? panel.querySelector("[data-crop-enable]") : null;
    valueEl = panel ? panel.querySelector("[data-crop-value]") : null;

    // 默认隐藏：只有选了文件才显示（复用抽帧预览时由抽帧逻辑控制，但不影响这里额外再控制）
    if (panel) {
      panel.hidden = true;
    }
  };

  /** @type {CropRect|null} */
  let currentDisplayRect = null;
  let pointerDown = false;
  let startPoint = { x: 0, y: 0 };

  const clearSelection = () => {
    currentDisplayRect = null;
    cropX.value = "";
    cropY.value = "";
    cropW.value = "";
    cropH.value = "";
    if (rectEl) rectEl.style.display = "none";
    if (valueEl) valueEl.textContent = "未选择区域";
  };

  /**
   * 根据当前 displayRect 写入 hidden inputs（基于原始像素）。
   * @returns {void}
   */
  const syncHiddenInputs = () => {
    if (!currentDisplayRect || !video || !overlay || !valueEl) return;
    const stageRect = overlay.getBoundingClientRect();
    const mapped = mapToVideoPixels(currentDisplayRect, video, { stageW: stageRect.width, stageH: stageRect.height });
    if (!mapped) return;
    // 最小尺寸保护
    const w = Math.max(1, mapped.w);
    const h = Math.max(1, mapped.h);
    cropX.value = String(Math.max(0, mapped.x));
    cropY.value = String(Math.max(0, mapped.y));
    cropW.value = String(w);
    cropH.value = String(h);
    valueEl.textContent = `已选区域：x=${cropX.value}, y=${cropY.value}, w=${cropW.value}, h=${cropH.value}`;
  };

  /**
   * 画出 display rect。
   * @returns {void}
   */
  const drawRect = () => {
    if (!currentDisplayRect || !rectEl) return;
    rectEl.style.display = "block";
    rectEl.style.left = `${currentDisplayRect.x}px`;
    rectEl.style.top = `${currentDisplayRect.y}px`;
    rectEl.style.width = `${currentDisplayRect.w}px`;
    rectEl.style.height = `${currentDisplayRect.h}px`;
  };

  const updateVisibility = () => {
    ensureUi();
    const hasFile = (fileInput.files && fileInput.files.length > 0) || (video && !!video.src);
    if (panel) panel.hidden = !hasFile;
    // 没文件时清空选择，避免误用上一次框选
    if (!hasFile) {
      if (enableEl) enableEl.checked = false;
      clearSelection();
    }
    // 默认不影响视频播放：未启用裁剪时直接隐藏 overlay
    if (overlay) {
      overlay.hidden = !hasFile || !isEnabled();
      overlay.style.pointerEvents = overlay.hidden ? "none" : "auto";
    }
  };

  /**
   * 是否启用裁剪。
   * @returns {boolean}
   */
  const isEnabled = () => !!(enableEl && enableEl.checked);

  const bindOverlayEvents = () => {
    if (!overlay || !rectEl) return;
    overlay.style.touchAction = "none";
    // 默认不拦截视频交互：未启用裁剪时隐藏 overlay（并禁用指针事件）
    overlay.hidden = !isEnabled();
    overlay.style.pointerEvents = overlay.hidden ? "none" : "auto";

    overlay.addEventListener("pointerdown", (ev) => {
      if (!isEnabled()) return;
      if (!(ev instanceof PointerEvent)) return;
      pointerDown = true;
      overlay.setPointerCapture(ev.pointerId);
      const p = getLocalPoint(ev, overlay);
      startPoint = { x: p.x, y: p.y };
      currentDisplayRect = { x: p.x, y: p.y, w: 0, h: 0 };
      drawRect();
    });

    overlay.addEventListener("pointermove", (ev) => {
      if (!isEnabled()) return;
      if (!pointerDown) return;
      if (!(ev instanceof PointerEvent)) return;
      const p = getLocalPoint(ev, overlay);
      currentDisplayRect = normalizeRect(startPoint.x, startPoint.y, p.x, p.y);
      drawRect();
    });

    const finish = () => {
      if (!pointerDown) return;
      pointerDown = false;
      if (!currentDisplayRect) return;
      // 过小则视作无效
      if (currentDisplayRect.w < 2 || currentDisplayRect.h < 2) {
        clearSelection();
        return;
      }
      syncHiddenInputs();
    };

    overlay.addEventListener("pointerup", finish);
    overlay.addEventListener("pointercancel", finish);
    overlay.addEventListener("lostpointercapture", finish);
  };

  const bindPanelEvents = () => {
    if (!panel) return;
    const clearBtn = panel.querySelector("[data-crop-clear]");
    if (clearBtn instanceof HTMLButtonElement) {
      clearBtn.addEventListener("click", () => {
        clearSelection();
      });
    }
    if (enableEl instanceof HTMLInputElement) {
      enableEl.addEventListener("change", () => {
        if (overlay) {
          overlay.hidden = !enableEl.checked;
          overlay.style.pointerEvents = enableEl.checked ? "auto" : "none";
        }
        // 关闭时清空，避免后台误裁剪
        if (!enableEl.checked) {
          clearSelection();
        }
      });
    }
  };

  const bindVideoEvents = () => {
    if (!(video instanceof HTMLVideoElement)) return;
    video.addEventListener("loadedmetadata", () => {
      // 元数据就绪后，若已有框选需要重新映射（窗口变化也会触发用户重新框选）
      if (currentDisplayRect) {
        syncHiddenInputs();
      }
    });
    video.addEventListener("error", () => {
      // no-op
    });
  };

  const bindFileInputEvents = () => {
    // 兼容：部分 WebView/移动端对 file input 只触发 input 不触发 change
    let fileChangeScheduled = false;
    /**
     * 回退显示：确保已有的抽帧预览容器可见。
     * @param {boolean} hasFile
     * @returns {void}
     */
    const syncPreviewVisibility = (hasFile) => {
      const placeholder = form.querySelector("[data-video-placeholder]");
      const playerWrapper = form.querySelector("[data-video-player-wrapper]");
      const timeline = form.querySelector("[data-video-timeline]");
      const toolbar = form.querySelector("[data-video-toolbar]");
      if (placeholder instanceof HTMLElement) {
        placeholder.hidden = hasFile;
        placeholder.classList.toggle("video-preview__placeholder--hidden", hasFile);
        if (hasFile) {
          placeholder.setAttribute("aria-hidden", "true");
        } else {
          placeholder.removeAttribute("aria-hidden");
        }
      }
      if (playerWrapper instanceof HTMLElement) {
        playerWrapper.hidden = !hasFile;
      }
      if (timeline instanceof HTMLElement) {
        timeline.hidden = !hasFile;
      }
      if (toolbar instanceof HTMLElement) {
        toolbar.hidden = !hasFile;
      }
    };

    /**
     * 兜底：当抽帧模块未能挂载预览时，仍尝试设置预览视频。
     * @param {File|null} file
     * @returns {void}
     */
    const ensurePreviewVideoSource = (file) => {
      if (!(video instanceof HTMLVideoElement)) return;
      if (!file) {
        if (!video.src) return;
        video.removeAttribute("src");
        video.load();
        return;
      }
      if (video.src) return;
      try {
        injectedObjectUrl = URL.createObjectURL(file);
        video.src = injectedObjectUrl;
        video.load();
      } catch (_err) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result;
          if (typeof result === "string") {
            video.src = result;
            video.load();
          }
        };
        reader.readAsDataURL(file);
      }
    };

    const handleFileChange = () => {
      ensureUi();
      // 若是我们注入的 video 预览，则在这里设置 src
      const isInjectedVideo = video && video.classList.contains("video-cropper__video");
      if (isInjectedVideo) {
        revokeInjectedUrl();
        const [file] = fileInput.files ?? [];
        lastSelectedFile = file ?? null;
        if (file && video) {
          try {
            injectedObjectUrl = URL.createObjectURL(file);
            video.src = injectedObjectUrl;
            video.load();
          } catch (_err) {
            // 兜底：某些环境可能禁止 blob URL，此时退化为 dataURL
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result;
              if (typeof result === "string") {
                video.src = result;
                video.load();
              }
            };
            reader.readAsDataURL(file);
          }
        } else if (video) {
          video.removeAttribute("src");
          video.load();
        }
      }
      const [file] = fileInput.files ?? [];
      syncPreviewVisibility(!!file);
      ensurePreviewVideoSource(file ?? null);
      // 文件变更时清空旧选择
      clearSelection();
      updateVisibility();
    };
    const scheduleFileChange = () => {
      if (fileChangeScheduled) return;
      fileChangeScheduled = true;
      queueMicrotask(() => {
        fileChangeScheduled = false;
        handleFileChange();
      });
    };
    fileInput.addEventListener("change", scheduleFileChange);
    fileInput.addEventListener("input", scheduleFileChange);

    /**
     * 兜底：某些 WebView 既不触发 change 也不触发 input。
     * 轮询检测文件签名变化（文件名/大小/最后修改时间），仅在变化时触发一次更新。
     * @returns {void}
     */
    const installFileInputWatcher = () => {
      /**
       * @returns {string}
       */
      const getFileSignature = () => {
        const f = fileInput.files && fileInput.files.length > 0 ? fileInput.files[0] : null;
        if (!f) return "";
        return `${f.name}|${f.size}|${f.lastModified}`;
      };
      let lastSig = getFileSignature();
      window.setInterval(() => {
        const nextSig = getFileSignature();
        if (nextSig !== lastSig) {
          lastSig = nextSig;
          scheduleFileChange();
        }
      }, 300);
    };
    installFileInputWatcher();

    form.addEventListener("reset", () => {
      revokeInjectedUrl();
      clearSelection();
      if (enableEl) enableEl.checked = false;
      updateVisibility();
    });
  };

  // 初始化挂载
  form.setAttribute(CROPPER_MOUNT_ATTR, "true");
  ensureUi();
  bindOverlayEvents();
  bindPanelEvents();
  bindVideoEvents();
  bindFileInputEvents();
  updateVisibility();
};

