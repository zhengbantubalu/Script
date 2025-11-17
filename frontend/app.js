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
 * 本地扫描助手默认端口。
 * @type {number}
 */
const LOCAL_SCANNER_PORT = 47832;

/**
 * 获取本地扫描助手基础地址。
 * @returns {string}
 */
const getLocalScannerBaseUrl = () => `http://127.0.0.1:${LOCAL_SCANNER_PORT}`;

/**
 * 识别操作系统。
 * @returns {"mac"|"win"|"linux"}
 */
const detectOS = () => {
  const ua = window.navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "win";
  if (ua.includes("mac")) return "mac";
  return "linux";
};

/**
 * 生成“本地扫描助手”内联 Python 代码（自包含，独立运行）。
 * @returns {string}
 */
const buildEmbeddedLocalScannerPython = () => {
  // 注意：尽量保持为单文件，便于通过 heredoc/bat 直接运行
  return String.raw`from __future__ import annotations

import socket
import ipaddress
from typing import Dict, List, Optional, Set, Tuple

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    import scapy.all as scapy  # type: ignore
except Exception as exc:
    raise SystemExit("未安装 scapy，请检查依赖安装是否成功") from exc

try:
    import netifaces as ni  # type: ignore
except Exception:
    ni = None  # 允许缺少 netifaces，回退方案继续工作


def get_my_ip() -> Optional[str]:
    if ni is not None:
        try:
            gateway = ni.gateways().get("default", {})
            gw_v4 = gateway.get(ni.AF_INET)
            if gw_v4:
                gateway_interface = gw_v4[1]
                my_ip = ni.ifaddresses(gateway_interface)[ni.AF_INET][0]["addr"]
                return my_ip
        except Exception:
            pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return None


def _cidr_from_addr_mask(addr: str, netmask: str) -> Optional[str]:
    try:
        network = ipaddress.IPv4Network(f"{addr}/{netmask}", strict=False)
        if network.prefixlen >= 32:
            return None
        if network.network_address.is_loopback or network.network_address.is_link_local:
            return None
        return str(network)
    except Exception:
        return None


def get_all_networks() -> List[str]:
    cidrs: Set[str] = set()
    if ni is not None:
        try:
            for iface in ni.interfaces():
                addrs = ni.ifaddresses(iface).get(ni.AF_INET, [])
                for item in addrs:
                    addr = item.get("addr")
                    mask = item.get("netmask")
                    if addr and mask:
                        cidr = _cidr_from_addr_mask(addr, mask)
                        if cidr:
                            cidrs.add(cidr)
        except Exception:
            pass
    if not cidrs:
        my_ip = get_my_ip()
        if my_ip:
            ip_parts = my_ip.split(".")
            cidrs.add(f"{ip_parts[0]}.{ip_parts[1]}.{ip_parts[2]}.1/24")
    return sorted(cidrs)


def scan_network(network_range: str) -> List[Dict[str, str]]:
    try:
        arp_request = scapy.ARP(pdst=network_range)
        broadcast = scapy.Ether(dst="ff:ff:ff:ff:ff:ff")
        arp_request_broadcast = broadcast / arp_request
        answered_list = scapy.srp(arp_request_broadcast, timeout=1.2, verbose=False)[0]
        devices: List[Dict[str, str]] = []
        for _sent, received in answered_list:
            devices.append({"ip": received.psrc, "mac": received.hwsrc})
        return devices
    except Exception:
        return []


def _resolve_hostname(ip: str) -> Optional[str]:
    try:
        hostname, _, _ = socket.gethostbyaddr(ip)
        return hostname
    except Exception:
        return None


def _check_tcp_port(ip: str, port: int, timeout: float = 0.3) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            result = sock.connect_ex((ip, port))
            return result == 0
    except Exception:
        return False


_PORTS_PROFILE: Tuple[int, ...] = (22, 80, 443, 554, 8000, 8080, 139, 445, 9100, 1883, 8883)


def _classify_device(hostname: Optional[str], open_ports: List[int]) -> str:
    hn = (hostname or "").lower()
    ports = set(open_ports)
    if 554 in ports or 8000 in ports or "cam" in hn or "ipcam" in hn or "hik" in hn or "dahua" in hn:
        return "camera"
    if 9100 in ports or "printer" in hn or "hp" in hn or "canon" in hn or "epson" in hn:
        return "printer"
    if 445 in ports or 139 in ports or 22 in ports or "mac" in hn or "win" in hn or "desktop" in hn or "laptop" in hn:
        return "computer"
    if (80 in ports or 443 in ports or 8080 in ports) and (1883 in ports or 8883 in ports or "iot" in hn):
        return "iot"
    if (80 in ports or 443 in ports or 8080 in ports) and not (22 in ports or 445 in ports or 139 in ports):
        if "router" in hn or "switch" in hn or "gw" in hn or "ap" in hn:
            return "network"
    return "unknown"


def scan_lan_devices() -> Dict[str, object]:
    networks = get_all_networks()
    seen_ips: Set[str] = set()
    devices_enriched: List[Dict[str, object]] = []
    for cidr in networks:
        for dev in scan_network(cidr):
            ip = dev.get("ip")
            mac = dev.get("mac")
            if not ip or ip in seen_ips:
                continue
            seen_ips.add(ip)
            hostname = _resolve_hostname(ip)
            open_ports = [p for p in _PORTS_PROFILE if _check_tcp_port(ip, p)]
            category = _classify_device(hostname, open_ports)
            name = hostname or ip
            devices_enriched.append({
                "ip": ip, "mac": mac, "hostname": hostname,
                "open_ports": open_ports, "category": category, "name": name
            })
    groups: Dict[str, List[Dict[str, object]]] = {
        "camera": [], "computer": [], "printer": [], "network": [], "iot": [], "unknown": [],
    }
    for d in devices_enriched:
        groups.setdefault(d["category"], []).append(d)
    return {
        "networks": networks,
        "devices": devices_enriched,
        "groups": {
            "camera": groups.get("camera", []),
            "computer": groups.get("computer", []),
            "printer": groups.get("printer", []),
            "network": groups.get("network", []),
            "iot": groups.get("iot", []),
            "unknown": groups.get("unknown", []),
        },
    }


def create_app() -> FastAPI:
    app = FastAPI(title="本地局域网扫描助手", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/scan")
    def scan():
        result = scan_lan_devices()
        devices = result.get("devices", [])
        networks = result.get("networks", [])
        groups = result.get("groups", {})
        label_map = {
            "camera": "摄像头",
            "computer": "计算机/服务器",
            "printer": "打印机",
            "network": "网络设备",
            "iot": "物联网设备",
            "unknown": "未知设备",
        }
        grouped = []
        for key, items in groups.items():
            grouped.append({
                "key": key, "label": label_map.get(key, key),
                "count": len(items),
                "devices": [{
                    "name": item.get("name"), "ip": item.get("ip"), "mac": item.get("mac"),
                    "hostname": item.get("hostname"), "open_ports": item.get("open_ports", []),
                } for item in items],
            })
        return {
            "message": f"本地扫描完成，发现 {len(devices)} 台设备（{', '.join(networks) or '未知网段'}）",
            "networks": networks,
            "devices": devices,
            "groups": grouped,
        }

    return app


def main():
    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=47832, reload=False)


if __name__ == "__main__":
    main()`;
};

/**
 * 构建“一键运行”命令（复制到剪贴板用）。
 * @returns {string}
 */
const buildLocalScannerCommand = () => {
  const os = detectOS();
  const py = os === "win" ? "python" : "python3";
  if (os === "win") {
    return [
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "',
      '$venv=\\\"$env:USERPROFILE\\\\.lan-scan-venv\\\";',
      `if(!(Test-Path $venv)){ ${py} -m venv $venv };`,
      `& \\\"$venv\\\\Scripts\\\\Activate.ps1\\\";`,
      "pip install --upgrade pip;",
      "pip install fastapi \"uvicorn[standard]\" scapy netifaces;",
      "$code=@'",
      buildEmbeddedLocalScannerPython().replace(/'/g, "''"),
      "'@;",
      `Set-Content -Path \\\"$env:TEMP\\\\lan_scanner.py\\\" -Value $code;`,
      `${py} \\\"$env:TEMP\\\\lan_scanner.py\\\""`,
    ].join(" ");
  }
  // macOS/Linux
  return [
    "bash -c 'set -e;",
    `PY=${py}; VENV=\\\"$HOME/.lan-scan-venv\\\";`,
    "if [ ! -d \"$VENV\" ]; then $PY -m venv \"$VENV\"; fi;",
    "source \"$VENV/bin/activate\";",
    "pip install --upgrade pip;",
    "pip install fastapi \"uvicorn[standard]\" scapy netifaces;",
    "cat > \"$TMPDIR/lan_scanner.py\" <<\\'PY'",
    buildEmbeddedLocalScannerPython().replace(/\\/g, "\\\\").replace(/\$/g, "\\$"),
    "PY",
    "$PY \"$TMPDIR/lan_scanner.py\"'",
  ].join(" ");
};

/**
 * 生成可下载的启动脚本文件名与内容。
 * @returns {{filename:string, content:string, mime:string}}
 */
const buildLocalScannerScript = () => {
  const os = detectOS();
  if (os === "win") {
    const content = [
      "@echo off",
      "setlocal enabledelayedexpansion",
      "set VENV=%USERPROFILE%\\.lan-scan-venv",
      "where python >nul 2>nul",
      "if %errorlevel% neq 0 (",
      "  echo 未找到 Python，请先安装 https://www.python.org/downloads/",
      "  pause",
      "  exit /b 1",
      ")",
      "if not exist \"%VENV%\" (",
      "  python -m venv \"%VENV%\"",
      ")",
      "call \"%VENV%\\Scripts\\activate.bat\"",
      "pip install --upgrade pip",
      "pip install fastapi \"uvicorn[standard]\" scapy netifaces",
      "set CODE_FILE=%TEMP%\\lan_scanner.py",
      ">" + "%CODE_FILE% echo " + buildEmbeddedLocalScannerPython().split("\n").map((l) => l.replace(/"/g, '""')).map((l) => `"${l}"`).join(" & echo "),
      "python \"%CODE_FILE%\"",
      "pause",
    ].join("\r\n");
    return { filename: "run_local_scanner.bat", content, mime: "application/octet-stream" };
  }
  // macOS/Linux
  const content = [
    "#!/usr/bin/env bash",
    "set -e",
    "PY=${PYTHON:-python3}",
    "VENV=\"$HOME/.lan-scan-venv\"",
    "if [ ! -d \"$VENV\" ]; then $PY -m venv \"$VENV\"; fi",
    "source \"$VENV/bin/activate\"",
    "pip install --upgrade pip",
    "pip install fastapi \"uvicorn[standard]\" scapy netifaces",
    "CODE_FILE=\"$TMPDIR/lan_scanner.py\"",
    "cat > \"$CODE_FILE\" <<'PY'",
    buildEmbeddedLocalScannerPython(),
    "PY",
    "$PY \"$CODE_FILE\"",
  ].join("\n");
  return { filename: "run_local_scanner.sh", content, mime: "text/x-shellscript" };
};

/**
 * 触发文本内容下载。
 * @param {string} filename
 * @param {string} content
 * @param {string} mime
 * @returns {void}
 */
const downloadTextFile = (filename, content, mime = "text/plain") => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const IMAGE_PREVIEW_OVERLAY_ID = "image-preview-overlay";

let imagePreviewOverlayRef = null;
let imagePreviewImageRef = null;

/**
 * 确保图片预览浮层已创建。
 * @returns {void}
 */
const ensureImagePreviewer = () => {
  if (
    imagePreviewOverlayRef instanceof HTMLDivElement &&
    imagePreviewImageRef instanceof HTMLImageElement
  ) {
    return;
  }

  const existing = document.getElementById(IMAGE_PREVIEW_OVERLAY_ID);
  if (existing instanceof HTMLDivElement) {
    imagePreviewOverlayRef = existing;
    imagePreviewImageRef = existing.querySelector("img");
    return;
  }

  const overlay = document.createElement("div");
  overlay.id = IMAGE_PREVIEW_OVERLAY_ID;
  overlay.className = "image-preview";
  overlay.innerHTML = `
    <div class="image-preview__backdrop" data-preview-dismiss></div>
    <div class="image-preview__content" role="dialog" aria-modal="true">
      <button class="image-preview__close" type="button" data-preview-dismiss aria-label="关闭预览">
        &times;
      </button>
      <img class="image-preview__image" src="" alt="" />
    </div>
  `;
  document.body.appendChild(overlay);

  imagePreviewOverlayRef = overlay;
  imagePreviewImageRef = overlay.querySelector(".image-preview__image");

  const dismissElements = overlay.querySelectorAll("[data-preview-dismiss]");
  dismissElements.forEach((element) => {
    element.addEventListener("click", () => {
      hideImagePreview();
    });
  });
};

/**
 * 显示图片预览。
 * @param {string} src 图片地址
 * @param {string} alt 图片描述
 * @returns {void}
 */
const showImagePreview = (src, alt) => {
  ensureImagePreviewer();
  if (
    !(imagePreviewOverlayRef instanceof HTMLDivElement) ||
    !(imagePreviewImageRef instanceof HTMLImageElement)
  ) {
    return;
  }

  imagePreviewImageRef.src = src;
  imagePreviewImageRef.alt = alt || "图片预览";
  imagePreviewOverlayRef.classList.add("image-preview--visible");
  document.body.classList.add("image-preview--locked");
};

/**
 * 隐藏图片预览。
 * @returns {void}
 */
const hideImagePreview = () => {
  if (!(imagePreviewOverlayRef instanceof HTMLDivElement)) {
    return;
  }
  imagePreviewOverlayRef.classList.remove("image-preview--visible");
  document.body.classList.remove("image-preview--locked");
};

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideImagePreview();
  }
});

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
  const scaleField = findField("scale");

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
 * 渲染“二维码生成”模块（支持 URL/MP3 两种输入模态）。
 * @param {Module} module 模块配置
 * @returns {string}
 */
const renderQrcodeFields = (_module) => {
  return `
    <div class="segmented" role="tablist" aria-label="输入类型" data-qrcode-toggle>
      <button class="segmented__item is-active" type="button" role="tab" aria-selected="true" data-mode="url">网站</button>
      <button class="segmented__item" type="button" role="tab" aria-selected="false" data-mode="mp3">MP3</button>
      <button class="segmented__item" type="button" role="tab" aria-selected="false" data-mode="video">视频</button>
    </div>
    <input type="hidden" name="mode" value="url" data-qrcode-mode />

    <div class="form__group" data-url-group>
      <label class="form__label" for="qrcode-target-url">网址链接<sup>*</sup></label>
      <input class="input" type="text" name="target_url" id="qrcode-target-url" placeholder="https://example.com" />
      <p class="form__hint">请输入完整链接（含 http/https），生成网页访问二维码。</p>
    </div>

    <div class="form__group" data-audio-group hidden>
      <label class="form__label" for="qrcode-audio">MP3 文件<sup>*</sup></label>
      <input class="input" type="file" name="audio" id="qrcode-audio" accept="audio/mpeg,.mp3,audio/*" />
      <p class="form__hint">上传 .mp3 后将生成“美化播放页”的二维码，扫码后直接播放。</p>
    </div>

    <div class="form__group" data-video-group hidden>
      <label class="form__label" for="qrcode-video">视频文件<sup>*</sup></label>
      <input class="input" type="file" name="video" id="qrcode-video" accept="video/*" />
      <p class="form__hint">支持常见视频格式（如 mp4/mov/webm），将生成“美化观看页”的二维码。</p>
    </div>
  `;
};

/**
 * 初始化“二维码生成”模块交互。
 * @param {HTMLFormElement | null} form 表单元素
 * @returns {void}
 */
const setupQrcodeForm = (form) => {
  if (!(form instanceof HTMLFormElement)) {
    return;
  }
  const hiddenMode = form.querySelector("[data-qrcode-mode]");
  const toggle = form.querySelector("[data-qrcode-toggle]");
  const urlGroup = form.querySelector("[data-url-group]");
  const audioGroup = form.querySelector("[data-audio-group]");
  const videoGroup = form.querySelector("[data-video-group]");
  if (!(hiddenMode instanceof HTMLInputElement) || !toggle || !urlGroup || !audioGroup || !videoGroup) {
    return;
  }
  const updateVisibility = () => {
    const mode = hiddenMode.value === "mp3" ? "mp3" : hiddenMode.value === "video" ? "video" : "url";
    const isMp3 = mode === "mp3";
    const isVideo = mode === "video";
    urlGroup.hidden = isMp3 || isVideo;
    audioGroup.hidden = !isMp3;
    videoGroup.hidden = !isVideo;
    // 启用/禁用非当前模态输入，避免视觉或校验干扰
    const urlInput = urlGroup.querySelector("input[name='target_url']");
    const audioInput = audioGroup.querySelector("input[name='audio']");
    const videoInput = videoGroup.querySelector("input[name='video']");
    if (urlInput instanceof HTMLInputElement) {
      urlInput.disabled = isMp3 || isVideo;
      if (isMp3 || isVideo) urlInput.value = "";
    }
    if (audioInput instanceof HTMLInputElement) {
      audioInput.disabled = !isMp3;
      if (!isMp3) audioInput.value = "";
    }
    if (videoInput instanceof HTMLInputElement) {
      videoInput.disabled = !isVideo;
      if (!isVideo) videoInput.value = "";
    }
  };

  toggle.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest("[data-mode]");
    if (!btn) return;
    const attr = btn.getAttribute("data-mode");
    const mode = attr === "mp3" ? "mp3" : attr === "video" ? "video" : "url";
    hiddenMode.value = mode;
    // 选中态
    const items = toggle.querySelectorAll(".segmented__item");
    items.forEach((el) => {
      el.classList.toggle("is-active", el === btn);
      el.setAttribute("aria-selected", el === btn ? "true" : "false");
    });
    updateVisibility();
  });

  // 初始状态
  hiddenMode.value = "url";
  updateVisibility();
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
    !(endInput instanceof HTMLInputElement)
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
 * 构造强制下载地址（后端以附件形式返回），避免浏览器内联预览。
 * @param {string} path /files/... 形式或绝对 URL
 * @returns {string}
 */
const buildDownloadUrl = (path) => {
  if (typeof path !== "string" || path.trim() === "") {
    return path;
  }
  let filesPath = "";
  try {
    const u = new URL(path, BACKEND_BASE_URL);
    const pn = u.pathname || "";
    filesPath = pn.includes("/files/") ? pn.slice(pn.indexOf("/files/")) : pn;
  } catch (_e) {
    filesPath = path;
  }
  const url = new URL("/api/download", BACKEND_BASE_URL);
  url.searchParams.set("path", filesPath);
  return url.toString();
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
    id: "mp4-to-gif",
    name: "MP4 转 GIF",
    summary: "截取视频片段并导出为 GIF 动图。",
    description:
      "上传 MP4/MOV 等常见视频格式，设置起止时间与目标帧率，后台将调用 `mp42gif.py` 输出 GIF 文件。",
    endpoint: "/api/tasks/mp4-to-gif",
    tags: [
      { id: "media", label: "视频处理" },
      { id: "tool", label: "格式转换" }
    ],
    fields: [
      {
        id: "video",
        type: "file",
        label: "视频文件",
        accept: "video/*",
        required: true,
        description: "支持 mp4、mov 等常见格式。"
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
      // 保持源视频帧率，不提供 n_fps
      {
        id: "scale",
        type: "select",
        label: "分辨率缩放",
        options: ["原始（100%）", "75%", "50%", "33%"],
        description: "用于减小 GIF 体积（仅缩小，不放大）。"
      }
    ],
    guide: {
      title: "导出建议",
      tips: [
        "GIF 文件体积与时长、分辨率、帧率相关，必要时缩短区间或降低帧率。",
        "若需更小文件，可在导出后使用压缩工具进一步处理。"
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
    id: "qrcode-generator",
    name: "二维码生成",
    summary: "在一个模块内生成网址/音频的二维码。",
    description:
      "支持两种输入模态：网址链接（生成访问二维码）或 MP3 文件（生成美化播放页二维码）。",
    endpoint: "/api/tasks/url-to-qrcode", // 默认占位，实际按模态切换
    tags: [
      { id: "tool", label: "工具" },
      { id: "qrcode", label: "二维码" },
      { id: "audio", label: "音频" }
    ],
    fields: [
      { id: "mode", type: "select", label: "输入类型", options: ["url", "mp3"] },
      { id: "target_url", type: "text", label: "网址链接", placeholder: "https://example.com" },
      { id: "audio", type: "file", label: "MP3 文件", accept: "audio/mpeg,.mp3,audio/*" }
    ],
    guide: {
      title: "使用提示",
      tips: [
        "选择“网址链接”时，填写完整的 http/https 链接。",
        "选择“MP3 文件”时，上传 .mp3，二维码将指向美化播放页。"
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
      "优先通过“本地扫描助手”在用户设备侧进行 ARP 扫描，自动识别活跃网段；未检测到助手时回退服务器侧扫描。",
    endpoint: "/api/tasks/network-scan",
    tags: [
      { id: "network", label: "网络" },
      { id: "scapy", label: "Scapy" }
    ],
    fields: [],
    guide: {
      title: "安全提示",
      tips: [
        "仅在授权的内网环境中使用，避免对他人网络造成干扰。",
        "部分设备可能关闭 ARP 响应，如需更全列表可多次扫描。",
        "要扫描“用户所在局域网”，请先在本机运行：python -m scripts.local_scanner_server（必要时加 sudo，默认端口 47832）。"
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
    summary: "支持 YouTube、bilibili 及其他由 yt-dlp 支持的视频链接下载（尝试兼容咪咕等国内平台）。",
    description:
      "调用 `URL2mp4.py`，输入视频链接后将自动下载最佳质量的 mp4 文件。实际可支持站点范围取决于后端使用的 yt-dlp 版本，对咪咕等平台为“尽力支持”，如检测到 Unsupported URL 或需登录/DRM，下载会失败。",
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
    target.id === "extract-frames" || target.id === "mp4-to-gif"
      ? renderExtractFramesFields(target)
      : target.id === "qrcode-generator"
        ? renderQrcodeFields(target)
        : target.fields.map(renderField).join("");

  const localHelper =
    target.id === "network-scan"
      ? `
      <aside class="helper helper--local-scanner">
        <h3 class="helper__title">本地扫描助手</h3>
        <p class="helper__desc">
          为确保扫描“用户所在局域网”，需在本机启动本地扫描助手。
          你可以一键检测助手状态、复制运行命令，或下载启动脚本。
        </p>
        <div class="helper__actions">
          <button class="button" type="button" data-check-local-scanner>检测助手状态</button>
          <button class="button" type="button" data-copy-local-command>复制运行命令</button>
          <button class="button button--ghost" type="button" data-download-local-script>下载启动脚本</button>
        </div>
        <p class="helper__meta">默认监听：<code>${getLocalScannerBaseUrl()}</code></p>
      </aside>`
      : "";
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
          ${localHelper}
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

  if (target.id === "extract-frames" || target.id === "mp4-to-gif") {
    const formEl = document.querySelector(`[data-module-form="${target.id}"]`);
    setupExtractFramesForm(formEl);
  } else if (target.id === "qrcode-generator") {
    const formEl = document.querySelector(`[data-module-form="${target.id}"]`);
    setupQrcodeForm(formEl);
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
    // 通用：如果后端提供压缩包，则优先给出“下载压缩包”入口
    if (typeof payload.archive === "string" && payload.archive.trim() !== "") {
      const archiveUrl = buildDownloadUrl(payload.archive);
      actionItems.push(
        `<a class="button" href="${archiveUrl}">下载压缩包</a>`
      );
    }

    // 特例：在线视频下载模块（url-to-mp4）不再返回压缩包，直接提供视频文件下载入口
    if (
      module.id === "url-to-mp4" &&
      Array.isArray(payload.files) &&
      payload.files.length > 0
    ) {
      const firstFile = payload.files[0];
      if (typeof firstFile === "string" && firstFile.trim() !== "") {
        const videoUrl = buildDownloadUrl(firstFile);
        actionItems.push(
          `<a class="button" href="${videoUrl}">下载视频</a>`
        );
      }
    }

    // 兜底：如果没有压缩包按钮，但返回了文件列表，则提供一个“直接下载”按钮
    if (actionItems.length === 0 && Array.isArray(payload.files) && payload.files.length > 0) {
      const firstFile = payload.files[0];
      if (typeof firstFile === "string" && firstFile.trim() !== "") {
        const fileUrl = buildDownloadUrl(firstFile);
        const label = module.tags.some((tag) => tag.id === "media") ? "下载文件" : "下载结果";
        actionItems.push(
          `<a class="button" href="${fileUrl}">${label}</a>`
        );
      }
    }

    actionsEl.innerHTML =
      actionItems.length > 0 ? actionItems.join(" ") : '<span class="result__empty">暂无可下载内容</span>';
  }

  if (previewsEl) {
    // 特例：网络扫描结果的分组展示
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
                    <span class="result__device-meta">IP: ${ip}${mac ? ` · MAC: ${mac}` : ""}${hn ? ` · 主机名: ${hn}` : ""}${ports ? ` · 端口: ${ports}` : ""}</span>
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
    } else if (Array.isArray(payload.previews) && payload.previews.length > 0) {
      const isFullPreviewModule = module.id === "images-download";
      const isQrModule = module.id === "qrcode-generator" || module.id === "url-to-qrcode" || module.id === "mp3-to-qrcode";
      const previewItems = payload.previews
        .map((previewUrl, index) => {
          if (typeof previewUrl !== "string") {
            return "";
          }
          const fullUrl = resolveFileUrl(previewUrl);
          const downloadUrl = buildDownloadUrl(previewUrl);
          const filename = previewUrl.split("/").pop() || `file-${index + 1}`;
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
              </figcaption>
            </figure>
          `;
        })
        .join("");
      const header = `<p class="result__meta">结果预览（${isFullPreviewModule ? "共" : "展示前"} ${
        payload.previews.length
      } 项）</p>`;
      const gridClass = `preview-grid${isQrModule ? " preview-grid--qrcode" : ""}`;
      previewsEl.innerHTML = `${header}<div class="${gridClass}">${previewItems}</div>`;
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
  updateStatus(form, "info", "任务提交中...", "请稍候，正在处理");

  try {
    // 特例：局域网设备扫描优先尝试本地扫描助手
    if (module.id === "network-scan") {
      /**
       * 使用 fetch+超时尝试访问本地扫描助手。
       * @param {string} url 目标 URL
       * @param {number} timeoutMs 超时时间（毫秒）
       * @returns {Promise<Response>}
       */
      const fetchWithTimeout = (url, timeoutMs = 4000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        return fetch(url, { method: "GET", signal: controller.signal })
          .finally(() => clearTimeout(id));
      };

      try {
        updateStatus(form, "info", "尝试在本机扫描...", "本地扫描进行中，预计 5-20 秒");
        const localUrl = `${getLocalScannerBaseUrl()}/scan?fast=1`;
        const res = await fetchWithTimeout(localUrl, 20000);
        if (res.ok) {
          const payload = await res.json();
          updateStatus(form, "success", "本地扫描完成", `共发现 ${Array.isArray(payload.devices) ? payload.devices.length : 0} 台设备`);
          renderResult(form, module, payload);
          return;
        }
        // 非 2xx 状态时，回退服务器扫描
        updateStatus(form, "info", "未检测到本地扫描助手，改为服务器扫描...", "如需扫描本机局域网，请先运行本地助手");
      } catch (_err) {
        // 网络/超时等错误，回退服务器扫描
        updateStatus(form, "info", "未检测到本地扫描助手，改为服务器扫描...", "如需扫描本机局域网，请先运行本地助手");
      }
    }

    // 默认：调用后端接口
    {
      const formData = serializeForm(form);
      // 特例：二维码生成模块根据模态切换不同后端接口
      let endpoint = resolveEndpointUrl(module.endpoint);
      if (module.id === "qrcode-generator") {
        const modeEl = form.querySelector('[name="mode"]');
        const mode = modeEl && modeEl.value === "mp3" ? "mp3" : modeEl && modeEl.value === "video" ? "video" : "url";
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
        // 优先解析后端返回的 JSON/文本错误详情
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
          // 忽略解析错误，保留默认 detail
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
    }
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

    // 本地扫描助手交互
    if (target.matches("[data-check-local-scanner]")) {
      event.preventDefault();
      const form = target.closest("form");
      if (form instanceof HTMLFormElement) {
        updateStatus(form, "info", "检测本地扫描助手...", getLocalScannerBaseUrl());
      }
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4000);
      fetch(`${getLocalScannerBaseUrl()}/health`, { signal: controller.signal })
        .then((res) => res.ok ? res.json() : Promise.reject(new Error(`状态码 ${res.status}`)))
        .then((json) => {
          if (form instanceof HTMLFormElement) {
            updateStatus(form, "success", "本地扫描助手已就绪", JSON.stringify(json));
          }
        })
        .catch((err) => {
          if (form instanceof HTMLFormElement) {
            updateStatus(form, "error", "未检测到本地扫描助手", String(err && err.message ? err.message : err));
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
  ensureImagePreviewer();
};

bootstrap();

