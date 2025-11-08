const YEAR_ELEMENT_ID = "current-year";

/**
 * 默认后端服务端口。
 * @type {number}
 */
const DEFAULT_BACKEND_PORT = 8000;

/**
 * 获取后端基础地址。
 * 优先级：全局配置 → 本地存储 → 当前协议与主机的默认端口。
 * @returns {string}
 */
const getBackendBaseUrl = () => {
  const globalConfig =
    typeof window.APP_CONFIG === "object" && window.APP_CONFIG !== null
      ? window.APP_CONFIG
      : null;
  if (
    globalConfig &&
    typeof globalConfig.backendBaseUrl === "string" &&
    globalConfig.backendBaseUrl.trim() !== ""
  ) {
    return globalConfig.backendBaseUrl.trim();
  }

  try {
    const stored = window.localStorage.getItem("backendBaseUrl");
    if (typeof stored === "string" && stored.trim() !== "") {
      return stored.trim();
    }
  } catch (error) {
    console.warn("读取本地后端地址失败：", error);
  }

  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
};

/**
 * 后端基础地址。
 * @type {string}
 */
const BACKEND_BASE_URL = getBackendBaseUrl();

/**
 * 解析模块配置中的 endpoint，得到完整的请求 URL。
 * @param {string} endpoint 相对或绝对地址
 * @returns {string}
 */
const resolveEndpointUrl = (endpoint) => {
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    throw new Error("模块未配置有效的接口地址");
  }
  try {
    return new URL(endpoint, BACKEND_BASE_URL).toString();
  } catch (error) {
    throw new Error(`无法解析接口地址：${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * 将秒数格式化为字符串。
 * @param {number} value 秒数
 * @returns {string}
 */
const formatSeconds = (value) => {
  if (!Number.isFinite(value) || value < 0) {
    return "--";
  }
  return `${value.toFixed(2)}s`;
};

/**
 * 渲染抽帧模块专用表单内容。
 * @param {Module} module 模块配置
 * @returns {string}
 */
const renderExtractFramesFields = (module) => {
  const findField = (id) => module.fields.find((field) => field.id === id);
  const videoField = findField("video");
  const startField = findField("start_sec");
  const endField = findField("end_sec");
  const fpsField = findField("n_fps");

  return `
    <div class="form__group form__group--video">
      <label class="form__label" for="extract-video-input">${videoField?.label ?? "视频文件"}<sup>*</sup></label>
      <input
        class="input"
        type="file"
        name="video"
        id="extract-video-input"
        accept="${videoField?.accept ?? "video/*"}"
        required
        data-video-input
      />
      ${
        videoField?.description
          ? `<p class="form__hint">${videoField.description}</p>`
          : ""
      }
    </div>
    <div class="video-preview" data-video-preview>
      <div class="video-preview__placeholder" data-video-placeholder>
        <div class="video-preview__placeholder-icon"></div>
        <div class="video-preview__placeholder-text">
          <p class="video-preview__placeholder-title">等待上传视频</p>
          <span class="video-preview__placeholder-desc">请选择或拖入视频文件，便于预览与设置抽帧区间。</span>
        </div>
      </div>
      <div class="video-preview__player-wrapper" hidden data-video-player-wrapper>
        <video class="video-preview__player" controls preload="metadata" data-video-player></video>
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
          ${
            startField?.description
              ? `<p class="form__hint">${startField.description}</p>`
              : ""
          }
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
          ${
            endField?.description
              ? `<p class="form__hint">${endField.description}</p>`
              : ""
          }
        </div>
      </div>
    </div>
    <div class="form__group">
      <label class="form__label" for="extract-fps-input">${fpsField?.label ?? "抽帧帧率"}<sup>*</sup></label>
      <div class="fps-control">
        <input
          class="fps-control__slider"
          type="range"
          min="1"
          max="60"
          value="5"
          step="1"
          data-fps-range
        />
        <div class="fps-control__value">
          <input
            class="input input--condensed"
            type="number"
            min="1"
            max="60"
            step="1"
            value="5"
            name="n_fps"
            id="extract-fps-input"
            required
            data-fps-input
          />
          <span class="fps-control__suffix">fps</span>
        </div>
      </div>
      ${
        fpsField?.description
          ? `<p class="form__hint">${fpsField.description}</p>`
          : ""
      }
    </div>
  `;
};

/**
 * 初始化抽帧模块交互。
 * @param {HTMLFormElement | null} form 表单元素
 * @returns {void}
 */
const setupExtractFramesForm = (form) => {
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
    !(endInput instanceof HTMLInputElement) ||
    !(fpsRange instanceof HTMLInputElement) ||
    !(fpsInput instanceof HTMLInputElement)
  ) {
    return;
  }

  let objectUrl = "";

  const revokeObjectUrl = () => {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
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
    revokeObjectUrl();
    const [file] = fileInput.files ?? [];
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
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    togglePreview(true);
    video.load();
    resetSelections();
    updateCurrentDisplay();
    updateDurationDisplay();
    syncSeekWithVideo();
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
    if (Number.isFinite(Number.parseFloat(endInput.value)) && Number.parseFloat(endInput.value) < value) {
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

  fileInput.addEventListener("change", handleFileChange);
  seek.addEventListener("input", handleSeekInput);
  video.addEventListener("timeupdate", () => {
    if (!seek.matches(":active")) {
      seek.value = String(video.currentTime);
    }
    updateCurrentDisplay();
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

  fpsRange.addEventListener("input", () => syncFpsValue(fpsRange.value));
  fpsInput.addEventListener("change", () => syncFpsValue(fpsInput.value));
  fpsInput.addEventListener("blur", () => syncFpsValue(fpsInput.value));

  form.addEventListener("reset", () => {
    revokeObjectUrl();
    togglePreview(false);
    video.removeAttribute("src");
    video.load();
    seek.value = "0";
    seek.disabled = true;
    fpsRange.value = "5";
    fpsInput.value = "5";
    currentDisplay && (currentDisplay.textContent = "00.00s");
    durationDisplay && (durationDisplay.textContent = "--");
    resetSelections();
  });

  syncFpsValue(fpsInput.value);
  resetSelections();
  togglePreview(false);
};

/**
 * 将后端返回的文件路径解析为完整可访问的 URL。
 * @param {string} path 后端响应中的文件路径
 * @returns {string}
 */
const resolveFileUrl = (path) => {
  if (typeof path !== "string" || path.trim() === "") {
    return path;
  }
  try {
    return new URL(path, BACKEND_BASE_URL).toString();
  } catch (_error) {
    return path;
  }
};

/**
 * @typedef {Object} ModuleTag
 * @property {string} id 唯一标识
 * @property {string} label 展示文本
 */

/**
 * @typedef {Object} ModuleField
 * @property {string} id 字段标识
 * @property {"text"|"number"|"textarea"|"file"|"select"} type 字段类型
 * @property {string} label 字段标签
 * @property {boolean} [required] 是否必填
 * @property {string} [placeholder] 占位提示
 * @property {string} [description] 字段辅助说明
 * @property {string[]} [options] 选项列表（下拉）
 * @property {string} [accept] 上传文件类型约束
 */

/**
 * @typedef {Object} ModuleGuide
 * @property {string} title 标题
 * @property {string[]} tips 指导要点
 */

/**
 * @typedef {Object} Module
 * @property {string} id 模块 ID
 * @property {string} name 模块名称
 * @property {string} summary 精简说明
 * @property {string} description 详细描述
 * @property {ModuleTag[]} tags 标签
 * @property {string} endpoint 提交 API
 * @property {ModuleField[]} fields 表单字段
 * @property {ModuleGuide} guide 使用提示
 */

/**
 * 模块信息集合，涵盖当前目录下的 Python 脚本。
 * @type {Module[]}
 */
const MODULES = [
  {
    id: "extract-frames",
    name: "视频抽帧",
    summary: "截取指定时间范围的视频帧，支持自定义帧率输出。",
    description:
      "上传视频后，可设置起止时间与目标帧率，后台将调用 `extract_frames.py` 把关键帧导出为图片。",
    endpoint: "/api/tasks/extract-frames",
    tags: [
      { id: "media", label: "视频处理" },
      { id: "opencv", label: "OpenCV" }
    ],
    fields: [
      {
        id: "video",
        type: "file",
        label: "视频文件",
        accept: "video/*",
        required: true,
        description: "支持 mp4、mov 等常见格式，单次最大 1GB（以后台限制为准）。"
      },
      {
        id: "start_sec",
        type: "number",
        label: "起始时间（秒）",
        placeholder: "例如 0",
        description: "默认为 0，建议小于结束时间。"
      },
      {
        id: "end_sec",
        type: "number",
        label: "结束时间（秒）",
        placeholder: "留空表示处理到视频末尾"
      },
      {
        id: "n_fps",
        type: "number",
        label: "抽帧帧率",
        placeholder: "例如 5",
        required: true,
        description: "单位为帧/秒，推荐 1-30。"
      },
      {
        id: "output_dir",
        type: "text",
        label: "输出文件夹",
        placeholder: "例如 frames",
        description: "后台会在作业目录下创建该文件夹存放结果图片。"
      }
    ],
    guide: {
      title: "使用建议",
      tips: [
        "长视频抽帧请合理设置时间段，避免生成过多图片。",
        "如需保证时间戳，请确保上传的视频 FPS 信息正确。",
        "输出目录名仅支持英文字母、数字和下划线。"
      ]
    }
  },
  {
    id: "images-download",
    name: "网页图片批量下载",
    summary: "解析网页内容并批量下载图片资源。",
    description:
      "提供目标网址与存储目录后，后台脚本 `images_download.py` 会抓取页面上的图片。",
    endpoint: "/api/tasks/images-download",
    tags: [
      { id: "crawler", label: "网络采集" },
      { id: "automation", label: "自动化" }
    ],
    fields: [
      {
        id: "page_url",
        type: "text",
        label: "网页地址",
        placeholder: "https://example.com",
        required: true
      }
    ],
    guide: {
      title: "注意事项",
      tips: [
        "仅用于合法授权的网站采集，请勿抓取受版权保护的内容。",
        "如页面图片为懒加载，建议先在本地浏览器滚动加载后复制最终地址。"
      ]
    }
  },
  {
    id: "mp4-to-live-photo",
    name: "Live Photo 生成",
    summary: "将短视频转换为 iOS 实况照片格式。",
    description:
      "上传短视频并设置时长与封面帧，后台脚本 `mp42mov.py` 会输出 `.mov` 和 `.jpg`。",
    endpoint: "/api/tasks/mp4-to-live-photo",
    tags: [
      { id: "media", label: "视频处理" },
      { id: "live-photo", label: "Live Photo" }
    ],
    fields: [
      {
        id: "video",
        type: "file",
        label: "视频文件",
        accept: "video/*",
        required: true
      },
      {
        id: "output_prefix",
        type: "text",
        label: "输出前缀",
        placeholder: "如 live/photo_001",
        required: true
      },
      {
        id: "duration",
        type: "number",
        label: "目标时长（秒）",
        placeholder: "默认 3",
        description: "超出原视频长度时会自动截断。"
      },
      {
        id: "keyframe_time",
        type: "number",
        label: "封面时间点（秒）",
        placeholder: "默认 1.0",
        description: "建议介于 0.1 与时长-0.1 之间。"
      }
    ],
    guide: {
      title: "导出说明",
      tips: [
        "建议上传 3-5 秒的短视频以保证动效流畅。",
        "导出的 JPG 为封面图，可配合 MOV 直接导入 iOS 相册。"
      ]
    }
  },
  {
    id: "network-scan",
    name: "局域网设备扫描",
    summary: "快速查看当前网段在线设备列表。",
    description:
      "使用 `scan.py` 通过 ARP 探测局域网设备，默认扫描本机所在子网。",
    endpoint: "/api/tasks/network-scan",
    tags: [
      { id: "network", label: "网络" },
      { id: "scapy", label: "Scapy" }
    ],
    fields: [
      {
        id: "network_range",
        type: "text",
        label: "扫描网段",
        placeholder: "默认自动识别，如 192.168.1.1/24",
        description: "可自定义扫描范围，格式遵循 CIDR。"
      }
    ],
    guide: {
      title: "安全提示",
      tips: [
        "仅在授权的内网环境中使用，避免对他人网络造成干扰。",
        "部分设备可能关闭 ARP 响应，如需更全列表可多次扫描。"
      ]
    }
  },
  {
    id: "folder-split",
    name: "批量文件分拣",
    summary: "将同类文件平均分配到多个子文件夹。",
    description:
      "`split-files.py` 支持按扩展名对目录内文件均分，适合分发标注任务。",
    endpoint: "/api/tasks/folder-split",
    tags: [
      { id: "file", label: "文件管理" },
      { id: "automation", label: "自动化" }
    ],
    fields: [
      {
        id: "source_dir",
        type: "text",
        label: "源目录",
        placeholder: "如 datasets/images",
        required: true
      },
      {
        id: "file_extension",
        type: "text",
        label: "文件后缀",
        placeholder: ".jpg",
        required: true
      },
      {
        id: "num_folders",
        type: "number",
        label: "分组数量",
        placeholder: "例如 5",
        required: true
      }
    ],
    guide: {
      title: "使用小技巧",
      tips: [
        "执行前请确认源目录中仅包含目标文件类型，避免误分拣。",
        "分组完成后，脚本会在源目录内生成 `Folder_1...` 子目录。"
      ]
    }
  },
  {
    id: "url-to-mp4",
    name: "在线视频下载",
    summary: "支持 YouTube 与 bilibili 链接下载。",
    description:
      "调用 `URL2mp4.py`，输入视频链接后将自动下载最佳质量的 mp4 文件。",
    endpoint: "/api/tasks/url-to-mp4",
    tags: [
      { id: "media", label: "视频" },
      { id: "download", label: "下载" }
    ],
    fields: [
      {
        id: "video_url",
        type: "text",
        label: "视频链接",
        placeholder: "https://...",
        required: true
      }
    ],
    guide: {
      title: "版权声明",
      tips: [
        "仅下载有权限的公开视频，遵守平台使用条款。",
        "部分站点需额外登录或 Cookie，暂不支持。"
      ]
    }
  },
  {
    id: "yolo-json-to-txt",
    name: "YOLO 标注转换",
    summary: "批量将 LabelMe JSON 转为 YOLO 标签。",
    description:
      "借助 `yolo/json_to_yolo.py`，上传 JSON 数据集并指定类别即可自动生成 YOLO 标签文件。",
    endpoint: "/api/tasks/yolo-json-to-txt",
    tags: [
      { id: "cv", label: "计算机视觉" },
      { id: "dataset", label: "数据集工具" }
    ],
    fields: [
      {
        id: "json_archive",
        type: "file",
        label: "JSON 数据压缩包",
        accept: ".zip,.tar,.tar.gz",
        description: "请将 `Annotations` 文件夹打包上传。"
      },
      {
        id: "classes",
        type: "text",
        label: "类别列表",
        placeholder: "如 person,hat,reflective_clothes",
        required: true,
        description: "多个类别用英文逗号分隔。"
      }
    ],
    guide: {
      title: "转换流程",
      tips: [
        "后台会按原有 JSON 文件名在 `labels/` 目录中生成同名 txt。",
        "若存在矩形标注外的形状，需要先在本地转换为矩形框。"
      ]
    }
  },
  {
    id: "yolo-label-vis",
    name: "YOLO 标注可视化",
    summary: "渲染 YOLO 标注框，批量导出叠加图片。",
    description:
      "脚本 `yolo/label_vis.py` 会读取标签文件与原图，输出带框的调试图像。",
    endpoint: "/api/tasks/yolo-label-vis",
    tags: [
      { id: "cv", label: "计算机视觉" },
      { id: "debug", label: "数据检查" }
    ],
    fields: [
      {
        id: "annotations_archive",
        type: "file",
        label: "标注压缩包",
        accept: ".zip,.tar,.tar.gz",
        description: "包含 YOLO txt 标签的压缩包。"
      },
      {
        id: "images_archive",
        type: "file",
        label: "图像压缩包",
        accept: ".zip,.tar,.tar.gz",
        description: "与标注对应的原始图片。"
      },
      {
        id: "output_dir",
        type: "text",
        label: "输出目录",
        placeholder: "默认 label_output"
      },
      {
        id: "suffix",
        type: "text",
        label: "文件后缀",
        placeholder: "默认 _annotated"
      },
      {
        id: "class_names",
        type: "text",
        label: "类别名称",
        placeholder: "空格分隔，如 car truck person",
        description: "若留空则使用标签文件中的 ID。"
      }
    ],
    guide: {
      title: "结果说明",
      tips: [
        "输出文件名为原图名加后缀，可在结果页面下载。",
        "颜色按类别区分，若类别超过 6 种会自动生成随机色。"
      ]
    }
  },
  {
    id: "yolo-write-img-path",
    name: "YOLO 数据集路径生成",
    summary: "批量生成训练集/验证集图片路径清单。",
    description:
      "`yolo/write_img_path.py` 根据 `ImageSets/Main` 与配置生成 `train/val/test` 路径文件。",
    endpoint: "/api/tasks/yolo-write-img-path",
    tags: [
      { id: "dataset", label: "数据集工具" },
      { id: "automation", label: "自动化" }
    ],
    fields: [
      {
        id: "images_root",
        type: "text",
        label: "图片根目录",
        placeholder: "如 /data/images",
        required: true
      },
      {
        id: "image_sets_archive",
        type: "file",
        label: "ImageSets 压缩包",
        description: "包含 `ImageSets/Main/*.txt` 的压缩包。"
      },
      {
        id: "class_name",
        type: "text",
        label: "类别名称",
        placeholder: "默认 weed"
      }
    ],
    guide: {
      title: "生成内容",
      tips: [
        "会在 `dataSet_path/` 下输出 train/val/test 三个列表。",
        "脚本默认类别配置如需修改，请在提交参数中同步更新。"
      ]
    }
  },
  {
    id: "yolo-split-dataset",
    name: "YOLO 数据集划分",
    summary: "按比例拆分标注文件为 train/val/test。",
    description:
      "脚本 `yolo/split_train_val.py` 支持自定义 XML 目录并生成 `ImageSets/Main` 划分文件。",
    endpoint: "/api/tasks/yolo-split-dataset",
    tags: [
      { id: "dataset", label: "数据集工具" },
      { id: "automation", label: "自动化" }
    ],
    fields: [
      {
        id: "xml_archive",
        type: "file",
        label: "XML 标签压缩包",
        accept: ".zip,.tar,.tar.gz",
        description: "请上传 `Annotations` 目录压缩包。"
      },
      {
        id: "trainval_ratio",
        type: "number",
        label: "训练+验证占比",
        placeholder: "0.9",
        description: "与脚本默认一致，可覆盖。"
      },
      {
        id: "train_ratio",
        type: "number",
        label: "训练集占比",
        placeholder: "0.9",
        description: "仅作用在训练+验证子集内。"
      }
    ],
    guide: {
      title: "输出文件",
      tips: [
        "最终会生成 train.txt、val.txt、trainval.txt、test.txt。",
        "若需固定随机种子，请联系管理员在后端扩展。"
      ]
    }
  }
];

const appRoot = document.getElementById("view-root");

/**
 * 渲染指定的 HTML 字符串。
 * @param {string} html 目标 HTML
 * @returns {void}
 */
const render = (html) => {
  appRoot.innerHTML = html;
};

/**
 * 格式化统计数据。
 * @returns {{total:number,media:number,automation:number}}
 */
const buildStats = () => {
  const total = MODULES.length;
  const media = MODULES.filter((item) =>
    item.tags.some((tag) => tag.id === "media")
  ).length;
  const automation = MODULES.filter((item) =>
    item.tags.some((tag) => tag.id === "automation")
  ).length;
  return { total, media, automation };
};

/**
 * 渲染首页卡片视图。
 * @returns {void}
 */
const renderHome = () => {
  const { total, media, automation } = buildStats();
  const cards = MODULES.map(
    (module) => `
      <article class="module-card" data-module="${module.id}">
        <div class="module-card__header">
          <h3 class="module-card__title">${module.name}</h3>
          <p class="module-card__summary">${module.summary}</p>
          <div class="module-card__tags">
            ${module.tags
              .map((tag) => `<span class="tag">${tag.label}</span>`)
              .join("")}
          </div>
        </div>
        <div class="module-card__meta">
          <span>脚本：${module.id.replace(/-/g, "_")}.py</span>
        </div>
        <div class="module-card__actions">
          <button class="button" data-navigate="${module.id}">立即使用 →</button>
        </div>
      </article>
    `
  ).join("");

  render(`
    <section class="hero">
      <div>
        <h2>脚本服务概览</h2>
        <p>根据当前仓库脚本自动生成的前端界面，点击即可进入具体操作。</p>
      </div>
      <div class="hero__summary">
        <div class="hero__chip">
          <span class="hero__chip-title">总计脚本</span>
          <span class="hero__chip-value">${total}</span>
        </div>
        <div class="hero__chip">
          <span class="hero__chip-title">媒体处理</span>
          <span class="hero__chip-value">${media}</span>
        </div>
        <div class="hero__chip">
          <span class="hero__chip-title">自动化工具</span>
          <span class="hero__chip-value">${automation}</span>
        </div>
      </div>
    </section>
    <section class="section">
      <h2 class="section__title">脚本模块</h2>
      <div class="module-grid">${cards}</div>
    </section>
  `);
};

/**
 * 生成面包屑导航。
 * @param {Module} module 当前模块
 * @returns {string}
 */
const renderBreadcrumbs = (module) => `
  <nav class="breadcrumbs">
    <a class="breadcrumbs__item" href="#" data-link="home">首页</a>
    <span class="breadcrumbs__item">${module.name}</span>
  </nav>
`;

/**
 * 生成标签区块。
 * @param {Module} module 当前模块
 * @returns {string}
 */
const renderMeta = (module) => `
  <div class="module-detail__meta">
    ${module.tags
      .map((tag) => `<span class="module-detail__meta-item">${tag.label}</span>`)
      .join("")}
    <span class="module-detail__meta-item">API: ${module.endpoint}</span>
  </div>
`;

/**
 * 生成字段输入控件。
 * @param {ModuleField} field 字段定义
 * @returns {string}
 */
const renderField = (field) => {
  const baseAttributes = `name="${field.id}" id="${field.id}" ${
    field.required ? "required" : ""
  }`;
  const hint = field.description
    ? `<p class="form__hint">${field.description}</p>`
    : "";

  switch (field.type) {
    case "textarea":
      return `
        <div class="form__group">
          <label class="form__label" for="${field.id}">${field.label}${
            field.required ? "<sup>*</sup>" : ""
          }</label>
          <textarea class="textarea" ${baseAttributes} placeholder="${
        field.placeholder ?? ""
      }"></textarea>
          ${hint}
        </div>
      `;
    case "select":
      return `
        <div class="form__group">
          <label class="form__label" for="${field.id}">${field.label}${
            field.required ? "<sup>*</sup>" : ""
          }</label>
          <select class="select" ${baseAttributes}>
            ${(field.options ?? [])
              .map((option) => `<option value="${option}">${option}</option>`)
              .join("")}
          </select>
          ${hint}
        </div>
      `;
    case "file":
      return `
        <div class="form__group">
          <label class="form__label" for="${field.id}">${field.label}${
            field.required ? "<sup>*</sup>" : ""
          }</label>
          <input class="input" type="file" ${baseAttributes} ${
        field.accept ? `accept="${field.accept}"` : ""
      } />
          ${hint}
        </div>
      `;
    default:
      return `
        <div class="form__group">
          <label class="form__label" for="${field.id}">${field.label}${
            field.required ? "<sup>*</sup>" : ""
          }</label>
          <input class="input" type="${field.type}" ${baseAttributes} placeholder="${
        field.placeholder ?? ""
      }" />
          ${hint}
        </div>
      `;
  }
};

/**
 * 渲染模块页面。
 * @param {string} moduleId 模块标识
 * @returns {void}
 */
const renderModule = (moduleId) => {
  const target = MODULES.find((item) => item.id === moduleId);
  if (!target) {
    render(
      `<div class="empty">
        <p>未找到对应模块。</p>
        <button class="button button--ghost" data-link="home">返回首页</button>
      </div>`
    );
    return;
  }

  const fields =
    target.id === "extract-frames"
      ? renderExtractFramesFields(target)
      : target.fields.map(renderField).join("");
  render(`
    ${renderBreadcrumbs(target)}
    <section class="module-detail">
      <header class="module-detail__header">
        <h2 class="module-detail__title">${target.name}</h2>
        <p class="module-detail__desc">${target.description}</p>
        ${renderMeta(target)}
      </header>
      <div class="module-detail__body">
        <form class="form form-card" data-module-form="${target.id}" autocomplete="off">
          ${fields}
          <div class="form__actions">
            <button class="button" type="submit">提交任务</button>
            <button class="button button--ghost" type="button" data-link="home">取消</button>
          </div>
          <div class="status status--info" hidden data-status-panel>
            <span class="status__text">等待提交</span>
            <span class="status__meta"></span>
          </div>
          <div class="result" hidden data-result-panel>
            <h3 class="result__title" data-result-title>处理结果</h3>
            <p class="result__meta" data-result-meta></p>
            <div class="result__actions" data-result-actions></div>
            <div class="result__previews" hidden data-result-previews></div>
            <div class="result__files" hidden data-result-files>
              <details>
                <summary class="result__files-summary">查看生成文件</summary>
                <ul class="result__file-list" data-result-file-list></ul>
              </details>
            </div>
          </div>
        </form>
      </div>
    </section>
  `);

  if (target.id === "extract-frames") {
    const formEl = document.querySelector(`[data-module-form="${target.id}"]`);
    setupExtractFramesForm(formEl);
  }
};

/**
 * 更新状态提示。
 * @param {HTMLFormElement} form 表单元素
 * @param {"info"|"success"|"error"} type 状态类型
 * @param {string} text 主文案
 * @param {string} [meta] 元信息
 * @returns {void}
 */
const updateStatus = (form, type, text, meta = "") => {
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
const resetResult = (form) => {
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
 * @param {Module} module 当前模块配置
 * @param {Record<string, unknown>} payload 后端返回数据
 * @returns {void}
 */
const renderResult = (form, module, payload) => {
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
      const archiveUrl = resolveFileUrl(payload.archive);
      actionItems.push(
        `<a class="button" href="${archiveUrl}" target="_blank" rel="noopener noreferrer">下载压缩包</a>`
      );
    }
    actionsEl.innerHTML =
      actionItems.length > 0 ? actionItems.join(" ") : '<span class="result__empty">暂无可下载内容</span>';
  }

  if (previewsEl) {
    if (Array.isArray(payload.previews) && payload.previews.length > 0) {
      const isFullPreviewModule = module.id === "images-download";
      const previewItems = payload.previews
        .map((previewUrl, index) => {
          if (typeof previewUrl !== "string") {
            return "";
          }
          const fullUrl = resolveFileUrl(previewUrl);
          const filename = previewUrl.split("/").pop() || `file-${index + 1}`;
          return `
            <figure class="preview-grid__item">
              <a class="preview-grid__link" href="${fullUrl}" target="_blank" rel="noopener noreferrer">
                <img class="preview-grid__image" src="${fullUrl}" alt="${module.name} 预览图 ${index + 1}" loading="lazy" />
              </a>
              <figcaption class="preview-grid__caption">
                <span>预览 ${index + 1}</span>
                <a class="preview-grid__download" href="${fullUrl}" download="${filename}">下载</a>
              </figcaption>
            </figure>
          `;
        })
        .join("");
      const header = `<p class="result__meta">结果预览（${isFullPreviewModule ? "共" : "展示前"} ${
        payload.previews.length
      } 项）</p>`;
      previewsEl.innerHTML = `${header}<div class="preview-grid">${previewItems}</div>`;
      previewsEl.hidden = false;
    } else {
      previewsEl.hidden = true;
      previewsEl.innerHTML = "";
    }
  }

  if (filesSection && fileListEl) {
    if (Array.isArray(payload.files) && payload.files.length > 0) {
      const fileItems = payload.files
        .map((fileUrl, index) => {
          if (typeof fileUrl !== "string") {
            return "";
          }
          const fullUrl = resolveFileUrl(fileUrl);
          const label = fileUrl.split("/").pop() || `文件 ${index + 1}`;
          return `<li class="result__file-item"><a href="${fullUrl}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
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

/**
 * 序列化表单数据。
 * @param {HTMLFormElement} form 表单
 * @returns {FormData}
 */
const serializeForm = (form) => {
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
 * @param {SubmitEvent} event 事件对象
 * @returns {Promise<void>}
 */
const handleSubmit = async (event) => {
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
  updateStatus(form, "info", "任务提交中...", "请稍候，正在上传数据");

  try {
    const formData = serializeForm(form);
    const endpoint = resolveEndpointUrl(module.endpoint);
    const response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`请求失败，状态码 ${response.status}`);
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
    updateStatus(
      form,
      "error",
      "提交失败",
      errorMessage
    );
  }
};

/**
 * 绑定全局事件。
 * @returns {void}
 */
const bindEvents = () => {
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
  });

  document.body.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLFormElement) {
      void handleSubmit(event);
    }
  });
};

/**
 * 路由解析并渲染对应视图。
 * @returns {void}
 */
const resolveRoute = () => {
  const hash = window.location.hash;
  if (hash.startsWith("#/module/")) {
    const moduleId = hash.replace("#/module/", "");
    renderModule(moduleId);
  } else {
    renderHome();
  }
};

/**
 * 初始化应用。
 * @returns {void}
 */
const bootstrap = () => {
  bindEvents();
  resolveRoute();
  window.addEventListener("hashchange", resolveRoute);
  const yearEl = document.getElementById(YEAR_ELEMENT_ID);
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
};

bootstrap();

