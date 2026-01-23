import { formatSeconds } from "../../core/format.js";
import { resolveEndpointUrl } from "../../core/url.js";
import { renderResult, updateStatus } from "../result.js";

/**
 * 渲染抽帧模块专用表单内容。
 * @param {{fields:Array<{id:string,label?:string,accept?:string,placeholder?:string,description?:string}>}} module
 * @returns {string}
 */
export const renderExtractFramesFields = (module) => {
  const findField = (id) => module.fields.find((field) => field.id === id);
  const videoField = findField("video");
  const startField = findField("start_sec");
  const endField = findField("end_sec");
  const fpsField = findField("n_fps");
  const scaleField = findField("scale");

  return `
    <div class="form__group form__group--video">
      <label class="form__label" for="extract-video-input">${
        videoField?.label ?? "视频文件"
      }<sup>*</sup></label>
      <input
        class="input"
        type="file"
        name="video"
        id="extract-video-input"
        accept="${videoField?.accept ?? "video/*"}"
        required
        data-video-input
      />
      ${videoField?.description ? `<p class="form__hint">${videoField.description}</p>` : ""}
    </div>
    <div class="video-preview-container" data-video-preview>
      <div class="video-preview__placeholder" data-video-placeholder>
        <div class="video-preview__placeholder-icon"></div>
        <div class="video-preview__placeholder-text">
          <p class="video-preview__placeholder-title">等待上传视频</p>
          <span class="video-preview__placeholder-desc">请选择或拖入视频文件，便于预览与设置抽帧区间。</span>
        </div>
      </div>
      <div class="video-preview__player-wrapper" hidden data-video-player-wrapper>
        <video class="video-preview__player" controls preload="metadata" playsinline data-video-player></video>
      </div>
      <div class="video-preview__timeline" hidden data-video-timeline>
        <input
          class="video-preview__seek"
          type="range"
          min="0"
          max="0"
          value="0"
          step="0.01"
          disabled
          data-video-seek
        />
        <div class="video-preview__meta">
          <span>当前时间：<strong data-current-display>00.00s</strong></span>
          <span>视频时长：<strong data-duration-display>--</strong></span>
        </div>
        <div class="video-preview__actions">
          <button class="button button--primary" type="button" data-save-frame>
            保存当前帧
          </button>
        </div>
      </div>
      <div class="video-toolbar" hidden data-video-toolbar>
        <div class="time-control">
          <div class="time-control__header">
            <span class="time-control__title">${startField?.label ?? "起始时间（秒）"}</span>
            <button class="button button--ghost time-control__action" type="button" data-set-start>
              使用当前时间
            </button>
          </div>
          <div class="time-control__inputs">
            <input
              class="input input--condensed"
              type="number"
              min="0"
              step="0.01"
              value="0"
              name="start_sec"
              placeholder="${startField?.placeholder ?? ""}"
              data-start-input
            />
            <span class="time-control__meta">已选：<strong data-start-display>0.00s</strong></span>
          </div>
          ${startField?.description ? `<p class="form__hint">${startField.description}</p>` : ""}
        </div>
        <div class="time-control">
          <div class="time-control__header">
            <span class="time-control__title">${endField?.label ?? "结束时间（秒）"}</span>
            <button class="button button--ghost time-control__action" type="button" data-set-end>
              使用当前时间
            </button>
          </div>
          <div class="time-control__inputs">
            <input
              class="input input--condensed"
              type="number"
              min="0"
              step="0.01"
              value=""
              name="end_sec"
              placeholder="${endField?.placeholder ?? ""}"
              data-end-input
            />
            <span class="time-control__meta">已选：<strong data-end-display>--</strong></span>
          </div>
          ${endField?.description ? `<p class="form__hint">${endField.description}</p>` : ""}
        </div>
      </div>
    </div>
    ${
      fpsField
        ? `
    <div class="form__group">
      <label class="form__label" for="extract-fps-input">${fpsField.label ?? "抽帧帧率"}<sup>*</sup></label>
      <div class="fps-control">
        <input class="fps-control__slider" type="range" min="1" max="60" value="5" step="1" data-fps-range />
        <div class="fps-control__value">
          <input class="input input--condensed" type="number" min="1" max="60" step="1" value="5" name="n_fps" id="extract-fps-input" required data-fps-input />
          <span class="fps-control__suffix">fps</span>
        </div>
      </div>
      ${fpsField.description ? `<p class="form__hint">${fpsField.description}</p>` : ""}
    </div>`
        : ""
    }
    ${
      scaleField
        ? `
    <div class="form__group">
      <label class="form__label" for="extract-scale-select">${scaleField.label ?? "分辨率缩放"}</label>
      <select class="select" name="scale" id="extract-scale-select">
        <option value="1">原始（100%）</option>
        <option value="0.75">75%</option>
        <option value="0.5">50%</option>
        <option value="0.33">33%</option>
      </select>
      ${scaleField.description ? `<p class="form__hint">${scaleField.description}</p>` : ""}
    </div>`
        : ""
    }
  `;
};

/**
 * 初始化抽帧模块交互。
 * @param {HTMLFormElement | null} form
 * @returns {void}
 */
export const setupExtractFramesForm = (form) => {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const fileInput = form.querySelector("[data-video-input]");
  const preview = form.querySelector("[data-video-preview]");
  const placeholder = form.querySelector("[data-video-placeholder]");
  const playerWrapper = form.querySelector("[data-video-player-wrapper]");
  const video = form.querySelector("[data-video-player]");
  const timelineSection = form.querySelector("[data-video-timeline]");
  const toolbarSection = form.querySelector("[data-video-toolbar]");
  const seek = form.querySelector("[data-video-seek]");
  const currentDisplay = form.querySelector("[data-current-display]");
  const durationDisplay = form.querySelector("[data-duration-display]");
  const startInput = form.querySelector("[data-start-input]");
  const endInput = form.querySelector("[data-end-input]");
  const startDisplay = form.querySelector("[data-start-display]");
  const endDisplay = form.querySelector("[data-end-display]");
  const startButton = form.querySelector("[data-set-start]");
  const endButton = form.querySelector("[data-set-end]");
  const fpsRange = form.querySelector("[data-fps-range]");
  const fpsInput = form.querySelector("[data-fps-input]");
  const saveFrameButton = form.querySelector("[data-save-frame]");
  const statusPanel = form.querySelector("[data-status-panel]");
  const resultPanel = form.querySelector("[data-result-panel]");

  if (
    !fileInput ||
    !preview ||
    !placeholder ||
    !playerWrapper ||
    !(video instanceof HTMLVideoElement) ||
    !timelineSection ||
    !toolbarSection ||
    !(seek instanceof HTMLInputElement) ||
    !(startInput instanceof HTMLInputElement) ||
    !(endInput instanceof HTMLInputElement)
  ) {
    return;
  }

  let objectUrl = "";
  /** @type {File|null} */
  let lastSelectedFile = null;

  const revokeObjectUrl = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  };

  /**
   * 解析视频错误信息。
   * @param {MediaError|null|undefined} err
   * @returns {{code:number|null,message:string}}
   */
  const getVideoErrorInfo = (err) => {
    const code = typeof err?.code === "number" ? err.code : null;
    const message =
      code === 1
        ? "MEDIA_ERR_ABORTED"
        : code === 2
          ? "MEDIA_ERR_NETWORK"
          : code === 3
            ? "MEDIA_ERR_DECODE"
            : code === 4
              ? "MEDIA_ERR_SRC_NOT_SUPPORTED"
              : "MEDIA_ERR_UNKNOWN";
    return { code, message };
  };

  const togglePreview = (hasVideo) => {
    placeholder.hidden = hasVideo;
    placeholder.classList.toggle("video-preview__placeholder--hidden", hasVideo);
    if (hasVideo) {
      placeholder.setAttribute("aria-hidden", "true");
    } else {
      placeholder.removeAttribute("aria-hidden");
    }
    playerWrapper.hidden = !hasVideo;
    preview.classList.toggle("video-preview--active", hasVideo);
    timelineSection.hidden = !hasVideo;
    toolbarSection.hidden = !hasVideo;
  };

  const updateCurrentDisplay = () => {
    if (currentDisplay) {
      currentDisplay.textContent = formatSeconds(video.currentTime);
    }
  };

  const updateDurationDisplay = () => {
    if (durationDisplay) {
      durationDisplay.textContent = formatSeconds(video.duration);
    }
  };

  const updateStartDisplay = () => {
    if (startDisplay) {
      const value = Number.parseFloat(startInput.value);
      startDisplay.textContent = Number.isFinite(value) ? formatSeconds(value) : "--";
    }
  };

  const updateEndDisplay = () => {
    if (endDisplay) {
      const value = Number.parseFloat(endInput.value);
      endDisplay.textContent = Number.isFinite(value) ? formatSeconds(value) : "--";
    }
  };

  const clampToDuration = (rawValue) => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (!Number.isFinite(rawValue)) {
      return 0;
    }
    if (duration <= 0) {
      return Math.max(rawValue, 0);
    }
    return Math.min(Math.max(rawValue, 0), duration);
  };

  const syncSeekWithVideo = () => {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > 0) {
      seek.max = String(duration);
      seek.disabled = false;
      seek.value = String(video.currentTime);
    } else {
      seek.max = "0";
      seek.value = "0";
      seek.disabled = true;
    }
  };

  const resetSelections = () => {
    startInput.value = "0";
    endInput.value = "";
    updateStartDisplay();
    updateEndDisplay();
  };

  const handleFileChange = () => {
    try {
      revokeObjectUrl();
      const [file] = fileInput.files ?? [];
      lastSelectedFile = file ?? null;
      if (!file) {
        togglePreview(false);
        video.removeAttribute("src");
        video.load();
        resetSelections();
        updateCurrentDisplay();
        updateDurationDisplay();
        syncSeekWithVideo();
        return;
      }

      // 先显示播放器，再绑定 src（部分浏览器在元素不可见时不会触发 metadata 加载）
      togglePreview(true);

      try {
        objectUrl = URL.createObjectURL(file);
        video.src = objectUrl;
        video.load();
      } catch (err) {
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

      resetSelections();
      updateCurrentDisplay();
      updateDurationDisplay();
      syncSeekWithVideo();
    } catch (err) {
      updateStatus(
        form,
        "error",
        "视频预览初始化失败",
        String(err && typeof err === "object" && "message" in err ? err.message : err)
      );
    }
  };

  const handleSeekInput = () => {
    const value = Number.parseFloat(seek.value);
    if (Number.isFinite(value)) {
      video.currentTime = Math.max(value, 0);
    }
  };

  const setStartFromCurrent = () => {
    const value = clampToDuration(video.currentTime);
    startInput.value = value.toFixed(2);
    if (
      Number.isFinite(Number.parseFloat(endInput.value)) &&
      Number.parseFloat(endInput.value) < value
    ) {
      endInput.value = value.toFixed(2);
    }
    updateStartDisplay();
    updateEndDisplay();
  };

  const setEndFromCurrent = () => {
    const value = clampToDuration(video.currentTime);
    endInput.value = value.toFixed(2);
    if (Number.parseFloat(startInput.value) > value) {
      startInput.value = value.toFixed(2);
      updateStartDisplay();
    }
    updateEndDisplay();
  };

  const handleStartInput = () => {
    const value = clampToDuration(Number.parseFloat(startInput.value));
    if (!Number.isNaN(value)) {
      startInput.value = value.toFixed(2);
      const endValue = Number.parseFloat(endInput.value);
      if (Number.isFinite(endValue) && endValue < value) {
        endInput.value = value.toFixed(2);
        updateEndDisplay();
      }
    } else {
      startInput.value = "0";
    }
    updateStartDisplay();
  };

  const handleEndInput = () => {
    if (endInput.value === "") {
      updateEndDisplay();
      return;
    }
    const value = clampToDuration(Number.parseFloat(endInput.value));
    if (!Number.isNaN(value)) {
      const startValue = Number.parseFloat(startInput.value);
      const normalized = startValue > value ? startValue : value;
      endInput.value = normalized.toFixed(2);
    } else {
      endInput.value = "";
    }
    updateEndDisplay();
  };

  const syncFpsValue = (rawValue) => {
    if (!(fpsRange instanceof HTMLInputElement) || !(fpsInput instanceof HTMLInputElement)) {
      return;
    }
    const min = Number(fpsRange.min) || 1;
    const max = Number(fpsRange.max) || 60;
    let value = Number.parseInt(String(rawValue), 10);
    if (!Number.isFinite(value)) {
      value = min;
    }
    value = Math.min(Math.max(value, min), max);
    fpsRange.value = String(value);
    fpsInput.value = String(value);
  };

  // 兼容：部分 WebView/移动端对 file input 只触发 input 不触发 change
  let fileChangeScheduled = false;
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
   * 这里用轮询检测文件签名变化（文件名/大小/最后修改时间），仅在变化时触发一次更新。
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
  seek.addEventListener("input", handleSeekInput);
  video.addEventListener("timeupdate", () => {
    if (!seek.matches(":active")) {
      seek.value = String(video.currentTime);
    }
    updateCurrentDisplay();
  });
  video.addEventListener("error", () => {
    const err = video.error;
    const info = getVideoErrorInfo(err);
    if (statusPanel) {
      const fileType = lastSelectedFile?.type || "未知格式";
      const fileName = lastSelectedFile?.name || "视频文件";
      const detail =
        info.code === 4
          ? `${fileName}（${fileType}）当前浏览器无法解码。请转码为 H.264/AAC 的 MP4 或 WebM 后重试。`
          : `${fileName} 无法播放，请检查文件是否损坏或格式受支持。`;
      updateStatus(form, "error", "视频预览失败", detail);
    }
  });
  video.addEventListener("loadedmetadata", () => {
    updateDurationDisplay();
    syncSeekWithVideo();
  });
  video.addEventListener("ended", () => {
    video.currentTime = video.duration || 0;
    updateCurrentDisplay();
    seek.value = String(video.currentTime);
  });

  startInput.addEventListener("change", handleStartInput);
  startInput.addEventListener("blur", handleStartInput);
  endInput.addEventListener("change", handleEndInput);
  endInput.addEventListener("blur", handleEndInput);

  if (startButton instanceof HTMLButtonElement) {
    startButton.addEventListener("click", setStartFromCurrent);
  }
  if (endButton instanceof HTMLButtonElement) {
    endButton.addEventListener("click", setEndFromCurrent);
  }

  if (fpsRange instanceof HTMLInputElement) {
    fpsRange.addEventListener("input", () => syncFpsValue(fpsRange.value));
  }
  if (fpsInput instanceof HTMLInputElement) {
    fpsInput.addEventListener("change", () => syncFpsValue(fpsInput.value));
    fpsInput.addEventListener("blur", () => syncFpsValue(fpsInput.value));
  }

  form.addEventListener("reset", () => {
    revokeObjectUrl();
    togglePreview(false);
    video.removeAttribute("src");
    video.load();
    seek.value = "0";
    seek.disabled = true;
    if (fpsRange instanceof HTMLInputElement) fpsRange.value = "5";
    if (fpsInput instanceof HTMLInputElement) fpsInput.value = "5";
    currentDisplay && (currentDisplay.textContent = "00.00s");
    durationDisplay && (durationDisplay.textContent = "--");
    resetSelections();
  });

  if (fpsInput instanceof HTMLInputElement) {
    syncFpsValue(fpsInput.value);
  }
  resetSelections();
  togglePreview(false);

  /**
   * 保存当前时刻的单帧图片。
   * @returns {Promise<void>}
   */
  const saveCurrentFrame = async () => {
    const [file] = fileInput.files ?? [];
    if (!file) {
      if (statusPanel) {
        updateStatus(form, "error", "请先上传视频文件", "");
      }
      return;
    }

    const currentTime = clampToDuration(video.currentTime);
    if (!Number.isFinite(currentTime) || currentTime < 0) {
      if (statusPanel) {
        updateStatus(form, "error", "无法获取当前视频时刻", "");
      }
      return;
    }

    if (statusPanel) {
      updateStatus(form, "info", "正在保存当前帧...", `时刻: ${formatSeconds(currentTime)}`);
    }

    try {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("timestamp", String(currentTime.toFixed(2)));
      // 可选：带上裁剪参数（若用户启用并框选了区域）
      const cropX = form.querySelector('input[type="hidden"][name="crop_x"]');
      const cropY = form.querySelector('input[type="hidden"][name="crop_y"]');
      const cropW = form.querySelector('input[type="hidden"][name="crop_w"]');
      const cropH = form.querySelector('input[type="hidden"][name="crop_h"]');
      if (
        cropX instanceof HTMLInputElement &&
        cropY instanceof HTMLInputElement &&
        cropW instanceof HTMLInputElement &&
        cropH instanceof HTMLInputElement
      ) {
        if (cropX.value && cropY.value && cropW.value && cropH.value) {
          formData.append("crop_x", cropX.value);
          formData.append("crop_y", cropY.value);
          formData.append("crop_w", cropW.value);
          formData.append("crop_h", cropH.value);
        }
      }

      const endpoint = resolveEndpointUrl("/api/tasks/extract-single-frame");
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

      const result = await response.json();
      const successMessage =
        typeof result.message === "string" && result.message.trim() !== ""
          ? result.message.trim()
          : "帧图片保存成功";
      const metaText = result.job_id ? `任务编号：${result.job_id}` : "";

      if (statusPanel) {
        updateStatus(form, "success", successMessage, metaText);
      }

      if (resultPanel) {
        renderResult(
          form,
          {
            id: "extract-single-frame",
            name: "单帧提取",
            tags: [{ id: "media", label: "视频处理" }]
          },
          result
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof TypeError
          ? `无法连接后端服务：${error.message}`
          : error instanceof Error
            ? error.message
            : "未知错误";
      if (statusPanel) {
        updateStatus(form, "error", "保存失败", errorMessage);
      }
    }
  };

  if (saveFrameButton instanceof HTMLButtonElement) {
    saveFrameButton.addEventListener("click", () => {
      void saveCurrentFrame();
    });
  }
};

