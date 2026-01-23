(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))i(a);new MutationObserver(a=>{for(const s of a)if(s.type==="childList")for(const r of s.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&i(r)}).observe(document,{childList:!0,subtree:!0});function n(a){const s={};return a.integrity&&(s.integrity=a.integrity),a.referrerPolicy&&(s.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?s.credentials="include":a.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function i(a){if(a.ep)return;a.ep=!0;const s=n(a);fetch(a.href,s)}})();const xe="current-year",Se=8e3,Me=47832,ce="image-preview-overlay",ke=()=>{const e=typeof window.APP_CONFIG=="object"&&window.APP_CONFIG!==null?window.APP_CONFIG:null;if(e&&typeof e.backendBaseUrl=="string"&&e.backendBaseUrl.trim()!=="")return e.backendBaseUrl.trim();try{const i=window.localStorage.getItem("backendBaseUrl");if(typeof i=="string"&&i.trim()!=="")return i.trim()}catch(i){console.warn("读取本地后端地址失败：",i)}const{protocol:t,hostname:n}=window.location;return`${t}//${n}:${Se}`},R=ke(),de=()=>`http://127.0.0.1:${Me}`,Te=(e,t,n="text/plain")=>{const i=new Blob([t],{type:n}),a=URL.createObjectURL(i),s=document.createElement("a");s.href=a,s.download=e,document.body.appendChild(s),s.click(),document.body.removeChild(s),URL.revokeObjectURL(a)},_e=()=>{const e=window.navigator.userAgent.toLowerCase();return e.includes("win")?"win":e.includes("mac")?"mac":"linux"},ne=()=>String.raw`from __future__ import annotations

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
    main()`,qe=()=>{const e=_e(),t=e==="win"?"python":"python3";return e==="win"?['powershell -NoProfile -ExecutionPolicy Bypass -Command "','$venv=\\"$env:USERPROFILE\\\\.lan-scan-venv\\";',`if(!(Test-Path $venv)){ ${t} -m venv $venv };`,'& \\"$venv\\\\Scripts\\\\Activate.ps1\\";',"pip install --upgrade pip;",'pip install fastapi "uvicorn[standard]" scapy netifaces;',"$code=@'",ne().replace(/'/g,"''"),"'@;",'Set-Content -Path \\"$env:TEMP\\\\lan_scanner.py\\" -Value $code;',`${t} \\"$env:TEMP\\\\lan_scanner.py\\""`].join(" "):["bash -c 'set -e;",`PY=${t}; VENV=\\"$HOME/.lan-scan-venv\\";`,'if [ ! -d "$VENV" ]; then $PY -m venv "$VENV"; fi;','source "$VENV/bin/activate";',"pip install --upgrade pip;",'pip install fastapi "uvicorn[standard]" scapy netifaces;',`cat > "$TMPDIR/lan_scanner.py" <<\\'PY'`,ne().replace(/\\/g,"\\\\").replace(/\$/g,"\\$"),"PY",`$PY "$TMPDIR/lan_scanner.py"'`].join(" ")},Ie=()=>_e()==="win"?{filename:"run_local_scanner.bat",content:["@echo off","setlocal enabledelayedexpansion","set VENV=%USERPROFILE%\\.lan-scan-venv","where python >nul 2>nul","if %errorlevel% neq 0 (","  echo 未找到 Python，请先安装 https://www.python.org/downloads/","  pause","  exit /b 1",")",'if not exist "%VENV%" (','  python -m venv "%VENV%"',")",'call "%VENV%\\Scripts\\activate.bat"',"pip install --upgrade pip",'pip install fastapi "uvicorn[standard]" scapy netifaces',"set CODE_FILE=%TEMP%\\lan_scanner.py",">%CODE_FILE% echo "+ne().split(`
`).map(i=>i.replace(/"/g,'""')).map(i=>`"${i}"`).join(" & echo "),'python "%CODE_FILE%"',"pause"].join(`\r
`),mime:"application/octet-stream"}:{filename:"run_local_scanner.sh",content:["#!/usr/bin/env bash","set -e","PY=${PYTHON:-python3}",'VENV="$HOME/.lan-scan-venv"','if [ ! -d "$VENV" ]; then $PY -m venv "$VENV"; fi','source "$VENV/bin/activate"',"pip install --upgrade pip",'pip install fastapi "uvicorn[standard]" scapy netifaces','CODE_FILE="$TMPDIR/lan_scanner.py"',`cat > "$CODE_FILE" <<'PY'`,ne(),"PY",'$PY "$CODE_FILE"'].join(`
`),mime:"text/x-shellscript"},N=[{id:"extract-frames",name:"视频抽帧",summary:"截取指定时间范围的视频帧，支持自定义帧率输出。",description:"上传视频后，可设置起止时间与目标帧率，后台将调用 `extract_frames.py` 把关键帧导出为图片。",endpoint:"/api/tasks/extract-frames",tags:[{id:"media",label:"视频处理"},{id:"opencv",label:"OpenCV"}],fields:[{id:"video",type:"file",label:"视频文件",accept:"video/*",required:!0,description:"支持 mp4、mov 等常见格式，单次最大 1GB（以后台限制为准）。"},{id:"start_sec",type:"number",label:"起始时间（秒）",placeholder:"例如 0",description:"默认为 0，建议小于结束时间。"},{id:"end_sec",type:"number",label:"结束时间（秒）",placeholder:"留空表示处理到视频末尾"},{id:"n_fps",type:"number",label:"抽帧帧率",placeholder:"例如 5",required:!0,description:"单位为帧/秒，推荐 1-30。"},{id:"output_dir",type:"text",label:"输出文件夹",placeholder:"例如 frames",description:"后台会在作业目录下创建该文件夹存放结果图片。"}],guide:{title:"使用建议",tips:["长视频抽帧请合理设置时间段，避免生成过多图片。","如需保证时间戳，请确保上传的视频 FPS 信息正确。","输出目录名仅支持英文字母、数字和下划线。"]}},{id:"mp4-to-gif",name:"MP4 转 GIF",summary:"截取视频片段并导出为 GIF 动图。",description:"上传 MP4/MOV 等常见视频格式，设置起止时间与目标帧率，后台将调用 `mp42gif.py` 输出 GIF 文件。",endpoint:"/api/tasks/mp4-to-gif",tags:[{id:"media",label:"视频处理"},{id:"tool",label:"格式转换"}],fields:[{id:"video",type:"file",label:"视频文件",accept:"video/*",required:!0,description:"支持 mp4、mov 等常见格式。"},{id:"start_sec",type:"number",label:"起始时间（秒）",placeholder:"例如 0",description:"默认为 0，建议小于结束时间。"},{id:"end_sec",type:"number",label:"结束时间（秒）",placeholder:"留空表示处理到视频末尾"},{id:"scale",type:"select",label:"分辨率缩放",options:["原始（100%）","75%","50%","33%"],description:"用于减小 GIF 体积（仅缩小，不放大）。"}],guide:{title:"导出建议",tips:["GIF 文件体积与时长、分辨率、帧率相关，必要时缩短区间或降低帧率。","若需更小文件，可在导出后使用压缩工具进一步处理。"]}},{id:"images-download",name:"网页图片批量下载",summary:"解析网页内容并批量下载图片资源。",description:"提供目标网址与存储目录后，后台脚本 `images_download.py` 会抓取页面上的图片。",endpoint:"/api/tasks/images-download",tags:[{id:"crawler",label:"网络采集"},{id:"automation",label:"自动化"}],fields:[{id:"page_url",type:"text",label:"网页地址",placeholder:"https://example.com",required:!0}],guide:{title:"注意事项",tips:["仅用于合法授权的网站采集，请勿抓取受版权保护的内容。","如页面图片为懒加载，建议先在本地浏览器滚动加载后复制最终地址。"]}},{id:"qrcode-generator",name:"二维码生成",summary:"在一个模块内生成网址/音频的二维码。",description:"支持两种输入模态：网址链接（生成访问二维码）或 MP3 文件（生成美化播放页二维码）。",endpoint:"/api/tasks/url-to-qrcode",tags:[{id:"tool",label:"工具"},{id:"qrcode",label:"二维码"},{id:"audio",label:"音频"}],fields:[{id:"mode",type:"select",label:"输入类型",options:["url","mp3"]},{id:"target_url",type:"text",label:"网址链接",placeholder:"https://example.com"},{id:"audio",type:"file",label:"MP3 文件",accept:"audio/mpeg,.mp3,audio/*"}],guide:{title:"使用提示",tips:["选择“网址链接”时，填写完整的 http/https 链接。","选择“MP3 文件”时，上传 .mp3，二维码将指向美化播放页。"]}},{id:"mp4-to-live-photo",name:"Live Photo 生成",summary:"将短视频转换为 iOS 实况照片格式。",description:"上传短视频并设置时长与封面帧，后台脚本 `mp42mov.py` 会输出 `.mov` 和 `.jpg`。",endpoint:"/api/tasks/mp4-to-live-photo",tags:[{id:"media",label:"视频处理"},{id:"live-photo",label:"Live Photo"}],fields:[{id:"video",type:"file",label:"视频文件",accept:"video/*",required:!0},{id:"output_prefix",type:"text",label:"输出前缀",placeholder:"如 live/photo_001",required:!0},{id:"duration",type:"number",label:"目标时长（秒）",placeholder:"默认 3",description:"超出原视频长度时会自动截断。"},{id:"keyframe_time",type:"number",label:"封面时间点（秒）",placeholder:"默认 1.0",description:"建议介于 0.1 与时长-0.1 之间。"}],guide:{title:"导出说明",tips:["建议上传 3-5 秒的短视频以保证动效流畅。","导出的 JPG 为封面图，可配合 MOV 直接导入 iOS 相册。"]}},{id:"network-scan",name:"局域网设备扫描",summary:"按指定网段（CIDR）扫描在线设备。",description:"请输入要扫描的局域网网段（CIDR），例如 192.168.1.0/24。本功能仅根据用户输入的网段执行扫描，不再尝试自动识别或访问“用户所在的网段”。",endpoint:"/api/tasks/network-scan",tags:[{id:"network",label:"网络"},{id:"scapy",label:"Scapy"}],fields:[{id:"network_range",type:"text",label:"扫描网段（CIDR）",placeholder:"如 192.168.1.0/24 或 10.0.0.0/24",required:!0,description:"可输入多个网段，使用逗号或空格分隔；仅扫描你填写的网段。"}],guide:{title:"安全提示",tips:["仅在授权的内网环境中使用，避免对他人网络造成干扰。","部分设备可能关闭 ARP 响应，如需更全列表可多次扫描。"]}},{id:"folder-split",name:"批量文件分拣",summary:"将同类文件平均分配到多个子文件夹。",description:"`split-files.py` 支持按扩展名对目录内文件均分，适合分发标注任务。",endpoint:"/api/tasks/folder-split",tags:[{id:"file",label:"文件管理"},{id:"automation",label:"自动化"}],fields:[{id:"source_dir",type:"text",label:"源目录",placeholder:"如 datasets/images",required:!0},{id:"file_extension",type:"text",label:"文件后缀",placeholder:".jpg",required:!0},{id:"num_folders",type:"number",label:"分组数量",placeholder:"例如 5",required:!0}],guide:{title:"使用小技巧",tips:["执行前请确认源目录中仅包含目标文件类型，避免误分拣。","分组完成后，脚本会在源目录内生成 `Folder_1...` 子目录。"]}},{id:"url-to-mp4",name:"在线视频下载",summary:"支持 YouTube、bilibili 及其他由 yt-dlp 支持的视频链接下载（尝试兼容咪咕等国内平台）。",description:"调用 `URL2mp4.py`，输入视频链接后将自动下载最佳质量的 mp4 文件。实际可支持站点范围取决于后端使用的 yt-dlp 版本，对咪咕等平台为“尽力支持”，如检测到 Unsupported URL 或需登录/DRM，下载会失败。",endpoint:"/api/tasks/url-to-mp4",tags:[{id:"media",label:"视频"},{id:"download",label:"下载"}],fields:[{id:"video_url",type:"text",label:"视频链接",placeholder:"https://...",required:!0}],guide:{title:"版权声明",tips:["仅下载有权限的公开视频，遵守平台使用条款。","部分站点需额外登录或 Cookie，暂不支持。"]}},{id:"yolo-json-to-txt",name:"YOLO 标注转换",summary:"批量将 LabelMe JSON 转为 YOLO 标签。",description:"借助 `yolo/json_to_yolo.py`，上传 JSON 数据集并指定类别即可自动生成 YOLO 标签文件。",endpoint:"/api/tasks/yolo-json-to-txt",tags:[{id:"cv",label:"计算机视觉"},{id:"dataset",label:"数据集工具"}],fields:[{id:"json_archive",type:"file",label:"JSON 数据压缩包",accept:".zip,.tar,.tar.gz",description:"请将 `Annotations` 文件夹打包上传。"},{id:"classes",type:"text",label:"类别列表",placeholder:"如 person,hat,reflective_clothes",required:!0,description:"多个类别用英文逗号分隔。"}],guide:{title:"转换流程",tips:["后台会按原有 JSON 文件名在 `labels/` 目录中生成同名 txt。","若存在矩形标注外的形状，需要先在本地转换为矩形框。"]}},{id:"yolo-label-vis",name:"YOLO 标注可视化",summary:"渲染 YOLO 标注框，批量导出叠加图片。",description:"脚本 `yolo/label_vis.py` 会读取标签文件与原图，输出带框的调试图像。",endpoint:"/api/tasks/yolo-label-vis",tags:[{id:"cv",label:"计算机视觉"},{id:"debug",label:"数据检查"}],fields:[{id:"annotations_archive",type:"file",label:"标注压缩包",accept:".zip,.tar,.tar.gz",description:"包含 YOLO txt 标签的压缩包。"},{id:"images_archive",type:"file",label:"图像压缩包",accept:".zip,.tar,.tar.gz",description:"与标注对应的原始图片。"},{id:"output_dir",type:"text",label:"输出目录",placeholder:"默认 label_output"},{id:"suffix",type:"text",label:"文件后缀",placeholder:"默认 _annotated"},{id:"class_names",type:"text",label:"类别名称",placeholder:"空格分隔，如 car truck person",description:"若留空则使用标签文件中的 ID。"}],guide:{title:"结果说明",tips:["输出文件名为原图名加后缀，可在结果页面下载。","颜色按类别区分，若类别超过 6 种会自动生成随机色。"]}},{id:"yolo-write-img-path",name:"YOLO 数据集路径生成",summary:"批量生成训练集/验证集图片路径清单。",description:"`yolo/write_img_path.py` 根据 `ImageSets/Main` 与配置生成 `train/val/test` 路径文件。",endpoint:"/api/tasks/yolo-write-img-path",tags:[{id:"dataset",label:"数据集工具"},{id:"automation",label:"自动化"}],fields:[{id:"images_root",type:"text",label:"图片根目录",placeholder:"如 /data/images",required:!0},{id:"image_sets_archive",type:"file",label:"ImageSets 压缩包",description:"包含 `ImageSets/Main/*.txt` 的压缩包。"},{id:"class_name",type:"text",label:"类别名称",placeholder:"默认 weed"}],guide:{title:"生成内容",tips:["会在 `dataSet_path/` 下输出 train/val/test 三个列表。","脚本默认类别配置如需修改，请在提交参数中同步更新。"]}},{id:"yolo-split-dataset",name:"YOLO 数据集划分",summary:"按比例拆分标注文件为 train/val/test。",description:"脚本 `yolo/split_train_val.py` 支持自定义 XML 目录并生成 `ImageSets/Main` 划分文件。",endpoint:"/api/tasks/yolo-split-dataset",tags:[{id:"dataset",label:"数据集工具"},{id:"automation",label:"自动化"}],fields:[{id:"xml_archive",type:"file",label:"XML 标签压缩包",accept:".zip,.tar,.tar.gz",description:"请上传 `Annotations` 目录压缩包。"},{id:"trainval_ratio",type:"number",label:"训练+验证占比",placeholder:"0.9",description:"与脚本默认一致，可覆盖。"},{id:"train_ratio",type:"number",label:"训练集占比",placeholder:"0.9",description:"仅作用在训练+验证子集内。"}],guide:{title:"输出文件",tips:["最终会生成 train.txt、val.txt、trainval.txt、test.txt。","若需固定随机种子，请联系管理员在后端扩展。"]}},{id:"scholar-search",name:"学术搜索",summary:"聚合检索 OpenAlex + Crossref + arXiv，让科研更高效。",description:"ScholarSearch 是一个强大的学术文献搜索平台，支持多数据源检索和智能推荐。",tags:[{id:"search",label:"学术搜索"},{id:"research",label:"科研工具"}],externalUrl:"http://47.93.189.31:3000/"}],Q=e=>{if(typeof e!="string"||e.trim()==="")throw new Error("模块未配置有效的接口地址");try{return new URL(e,R).toString()}catch(t){throw new Error(`无法解析接口地址：${t instanceof Error?t.message:String(t)}`)}},pe=e=>{if(typeof e!="string"||e.trim()==="")return e;try{return new URL(e,R).toString()}catch{return e}},G=e=>{if(typeof e!="string"||e.trim()==="")return e;let t="";try{if(e.startsWith("http://")||e.startsWith("https://"))t=new URL(e).pathname||"";else try{t=decodeURIComponent(e)}catch{t=e}t.includes("/files/")?t=t.slice(t.indexOf("/files/")):t.startsWith("/files/")||(t=`/files/${t}`)}catch{try{t=decodeURIComponent(e),t.startsWith("/files/")||(t=`/files/${t}`)}catch{t=e.startsWith("/files/")?e:`/files/${e}`}}const n=new URL("/api/download",R);return n.searchParams.set("path",t),n.toString()},Fe=e=>{if(typeof e!="string"||e.trim()==="")return e;let t="";try{const a=new URL(e,R).pathname||"";t=a.includes("/files/")?a.slice(a.indexOf("/files/")):a}catch{t=e}const n=new URL("/gif",R);return n.searchParams.set("file",t),n.toString()},$=(e,t,n,i="")=>{const a=e.querySelector("[data-status-panel]");if(!a)return;a.classList.remove("status--info","status--success","status--error"),a.classList.add(`status--${t}`),a.hidden=!1;const s=a.querySelector(".status__text"),r=a.querySelector(".status__meta");s&&(s.textContent=n),r&&(r.textContent=i)},He=e=>{const t=e.querySelector("[data-result-panel]");if(!t)return;const n=t.querySelector("[data-result-title]"),i=t.querySelector("[data-result-meta]"),a=t.querySelector("[data-result-actions]"),s=t.querySelector("[data-result-previews]"),r=t.querySelector("[data-result-files]"),p=t.querySelector("[data-result-file-list]");if(n&&(n.textContent="处理结果"),i&&(i.textContent="",i.hidden=!0),a&&(a.innerHTML=""),s&&(s.hidden=!0,s.innerHTML=""),p&&(p.innerHTML=""),r){r.hidden=!0;const c=r.querySelector("details");c&&(c.open=!1)}t.hidden=!0},ge=(e,t,n)=>{const i=e.querySelector("[data-result-panel]");if(!i)return;const a=i.querySelector("[data-result-title]"),s=i.querySelector("[data-result-meta]"),r=i.querySelector("[data-result-actions]"),p=i.querySelector("[data-result-previews]"),c=i.querySelector("[data-result-files]"),m=i.querySelector("[data-result-file-list]"),u=typeof n.message=="string"&&n.message.trim()!==""?n.message.trim():`${t.name}任务完成`;if(a&&(a.textContent=u),s){const o=[];typeof n.job_id=="string"&&n.job_id.trim()!==""&&o.push(`任务编号：${n.job_id.trim()}`),typeof n.total_files=="number"&&Number.isFinite(n.total_files)?o.push(`生成文件：${n.total_files} 个`):Array.isArray(n.files)&&o.push(`生成文件：${n.files.length} 个`),s.textContent=o.join(" · "),s.hidden=o.length===0}if(r){const o=[];if(typeof n.archive=="string"&&n.archive.trim()!==""){const l=G(n.archive);o.push(`<a class="button" href="${l}">下载压缩包</a>`)}if(t.id==="url-to-mp4"&&Array.isArray(n.files)&&n.files.length>0){const l=n.files[0];if(typeof l=="string"&&l.trim()!==""){const f=G(l);o.push(`<a class="button" href="${f}">下载视频</a>`)}}if(t.id==="mp4-to-gif"&&Array.isArray(n.files)&&n.files.length>0){const l=n.files[0];if(typeof l=="string"&&l.trim()!==""){const f=pe(l),g=G(l),x=Fe(l),w=`${R}/api/utils/qrcode?url=${encodeURIComponent(x)}`;o.push(`<a class="button" href="${g}">下载 GIF</a>`,`<button class="button" type="button" data-copy-gif data-src="${f}">复制 GIF</button>`,`<a class="button" href="${w}" target="_blank" rel="noopener noreferrer">微信二维码</a>`)}}if(o.length===0&&Array.isArray(n.files)&&n.files.length>0){const l=n.files[0];if(typeof l=="string"&&l.trim()!==""){const f=G(l),g=t.tags.some(x=>x.id==="media")?"下载文件":"下载结果";o.push(`<a class="button" href="${f}">${g}</a>`)}}r.innerHTML=o.length>0?o.join(" "):'<span class="result__empty">暂无可下载内容</span>'}if(p)if(t.id==="network-scan"&&Array.isArray(n.groups)){const o=Array.isArray(n.networks)?n.networks:[],l=n.groups.map(g=>{const x=Array.isArray(g.devices)?g.devices.map(w=>{const _=typeof w.name=="string"&&w.name?w.name:w.ip,E=w.ip??"",k=w.mac??"",S=w.hostname??"",I=Array.isArray(w.open_ports)?w.open_ports.join(", "):"";return`<li class="result__list-item">
                    <span class="result__device-name">${_}</span>
                    <span class="result__device-meta">IP: ${E}${k?` · MAC: ${k}`:""}${S?` · 主机名: ${S}`:""}${I?` · 端口: ${I}`:""}</span>
                  </li>`}).join(""):"";return`
            <section class="result__group">
              <header class="result__group-header">
                <h4 class="result__group-title">${g.label??g.key}</h4>
                <span class="result__group-count">${g.count??0} 台</span>
              </header>
              <ul class="result__list">${x||'<li class="result__list-item">暂无设备</li>'}</ul>
            </section>
          `}).join(""),f=`<p class="result__meta">扫描网段：${o.join(", ")||"未识别"}</p>`;p.innerHTML=`${f}${l}`,p.hidden=!1}else if(Array.isArray(n.previews)&&n.previews.length>0){const o=t.id==="images-download",l=t.id==="qrcode-generator"||t.id==="url-to-qrcode"||t.id==="mp3-to-qrcode",f=n.previews.map((w,_)=>{if(typeof w!="string")return"";const E=pe(w),k=G(w),S=w.split("/").pop()||`file-${_+1}`,I=t.id==="mp4-to-gif"?`<button class="preview-grid__copy" type="button" data-copy-gif data-src="${E}">复制</button>`:"";return`
            <figure class="preview-grid__item">
              <button
                class="preview-grid__image-button"
                type="button"
                data-preview-full="${E}"
                data-preview-alt="${t.name} 预览图 ${_+1}"
              >
                <img class="preview-grid__image" src="${E}" alt="${t.name} 预览图 ${_+1}" loading="lazy" />
              </button>
              <figcaption class="preview-grid__caption">
                <span class="preview-grid__label">预览 ${_+1}</span>
                <a class="preview-grid__download" href="${k}" download="${S}">下载</a>
                ${I}
              </figcaption>
            </figure>
          `}).join(""),g=`<p class="result__meta">结果预览（${o?"共":"展示前"} ${n.previews.length} 项）</p>`,x=`preview-grid${l?" preview-grid--qrcode":""}`;p.innerHTML=`${g}<div class="${x}">${f}</div>`,p.hidden=!1}else p.hidden=!0,p.innerHTML="";if(c&&m)if(Array.isArray(n.files)&&n.files.length>0){const o=n.files.map((f,g)=>{if(typeof f!="string")return"";const x=G(f),w=f.split("/").pop()||`文件 ${g+1}`;return`<li class="result__file-item"><a href="${x}" download="${w}">${w}</a></li>`}).filter(Boolean).join("");m.innerHTML=o,c.hidden=!1;const l=c.querySelector("details");l&&(l.open=!1)}else m.innerHTML="",c.hidden=!0;i.hidden=!1},Pe=e=>{const t=new FormData;return Array.from(e.elements).forEach(i=>{if(!(i instanceof HTMLElement))return;const a=i.getAttribute("name");a&&(i instanceof HTMLInputElement&&i.type==="file"?Array.from(i.files??[]).forEach(s=>{t.append(a,s)}):(i instanceof HTMLInputElement||i instanceof HTMLTextAreaElement||i instanceof HTMLSelectElement)&&i.value!==""&&t.append(a,i.value))}),t},Ae=async e=>{e.preventDefault();const t=e.target;if(!(t instanceof HTMLFormElement))return;const n=t.getAttribute("data-module-form"),i=N.find(a=>a.id===n);if(i){He(t),$(t,"info","任务提交中...","请稍候，正在处理");try{const a=Pe(t);let s=Q(i.endpoint);if(i.id==="qrcode-generator"){const u=t.querySelector('[name="mode"]'),o=u&&u.value==="mp3"?"mp3":u&&u.value==="video"?"video":"url";o==="mp3"?s=Q("/api/tasks/mp3-to-qrcode"):o==="video"?s=Q("/api/tasks/video-to-qrcode"):s=Q("/api/tasks/url-to-qrcode")}const r=await fetch(s,{method:"POST",body:a});if(!r.ok){let u=`请求失败，状态码 ${r.status}`;try{if((r.headers.get("content-type")||"").includes("application/json")){const l=await r.json();l&&typeof l.detail=="string"&&l.detail.trim()!==""?u=l.detail.trim():typeof l.message=="string"&&l.message.trim()!==""&&(u=l.message.trim())}else{const l=await r.text();l&&l.trim()!==""&&(u=l.trim())}}catch{}throw new Error(u)}const p=await r.json().catch(()=>({message:"提交成功"})),c=typeof p.message=="string"&&p.message.trim()!==""?p.message.trim():`${i.name}任务已提交`,m=p.job_id?`任务编号：${p.job_id}`:"任务已排队";$(t,"success",c,m),ge(t,i,p)}catch(a){const s=a instanceof TypeError?`无法连接后端服务：${a.message}`:a instanceof Error?a.message:"未知错误";$(t,"error","提交失败",s)}}};let C=null,W=null;const he=()=>{C instanceof HTMLDivElement&&(C.classList.remove("image-preview--visible"),document.body.classList.remove("image-preview--locked"))},ye=()=>{if(C instanceof HTMLDivElement&&W instanceof HTMLImageElement)return;const e=document.getElementById(ce);if(e instanceof HTMLDivElement){C=e,W=e.querySelector("img");return}const t=document.createElement("div");t.id=ce,t.className="image-preview",t.innerHTML=`
    <div class="image-preview__backdrop" data-preview-dismiss></div>
    <div class="image-preview__content" role="dialog" aria-modal="true">
      <button class="image-preview__close" type="button" data-preview-dismiss aria-label="关闭预览">
        &times;
      </button>
      <img class="image-preview__image" src="" alt="" />
    </div>
  `,document.body.appendChild(t),C=t,W=t.querySelector(".image-preview__image"),t.querySelectorAll("[data-preview-dismiss]").forEach(i=>{i.addEventListener("click",()=>{he()})})},Oe=(e,t)=>{ye(),!(!(C instanceof HTMLDivElement)||!(W instanceof HTMLImageElement))&&(W.src=e,W.alt=t||"图片预览",C.classList.add("image-preview--visible"),document.body.classList.add("image-preview--locked"))},Ne=()=>{document.addEventListener("keydown",e=>{e.key==="Escape"&&he()})},Ce=()=>{document.body.addEventListener("click",e=>{const t=e.target;if(!(t instanceof HTMLElement))return;const n=t.getAttribute("data-navigate");if(n){e.preventDefault(),window.location.hash=`#/module/${n}`;return}if(t.getAttribute("data-link")==="home"&&(e.preventDefault(),window.location.hash=""),t.matches("[data-check-local-scanner]")){e.preventDefault();const s=t.closest("form");s instanceof HTMLFormElement&&$(s,"info","检测本地扫描助手...",de());const r=new AbortController,p=setTimeout(()=>r.abort(),4e3);fetch(`${de()}/health`,{signal:r.signal}).then(c=>c.ok?c.json():Promise.reject(new Error(`状态码 ${c.status}`))).then(c=>{s instanceof HTMLFormElement&&$(s,"success","本地扫描助手已就绪",JSON.stringify(c))}).catch(c=>{s instanceof HTMLFormElement&&$(s,"error","未检测到本地扫描助手",String(c&&c.message?c.message:c))}).finally(()=>clearTimeout(p));return}if(t.matches("[data-copy-local-command]")){e.preventDefault();const s=qe();navigator.clipboard.writeText(s).then(()=>{const r=t.closest("form");r instanceof HTMLFormElement&&$(r,"success","已复制运行命令","请在本机终端粘贴执行；macOS/Linux 建议加 sudo")},r=>{const p=t.closest("form");p instanceof HTMLFormElement&&$(p,"error","复制命令失败",String(r&&r.message?r.message:r))});return}if(t.matches("[data-download-local-script]")){e.preventDefault();const{filename:s,content:r,mime:p}=Ie();Te(s,r,p);const c=t.closest("form");c instanceof HTMLFormElement&&$(c,"success","已下载启动脚本","macOS: 赋予执行权限并运行；Windows: 双击运行 .bat");return}if(t.matches("[data-copy-gif]")){e.preventDefault();const s=t.closest("form"),r=t.getAttribute("data-src")||"";if(!(s instanceof HTMLFormElement)||!r)return;const p=async c=>{try{if(navigator.clipboard&&typeof window.ClipboardItem=="function"){const m=await fetch(c,{mode:"cors"});if(!m.ok)throw new Error(`获取 GIF 失败：HTTP ${m.status}`);const u=await m.blob(),o=new window.ClipboardItem({"image/gif":u});await navigator.clipboard.write([o]),$(s,"success","已复制 GIF 到剪贴板","可直接在聊天/文档中粘贴图片");return}await navigator.clipboard.writeText(c),$(s,"success","已复制 GIF 链接",c)}catch(m){try{navigator.clipboard?(await navigator.clipboard.writeText(c),$(s,"success","已复制 GIF 链接",c)):$(s,"error","复制失败",String(m&&m.message?m.message:m))}catch(u){$(s,"error","复制失败",String(u&&u.message?u.message:u))}}};$(s,"info","正在复制 GIF...",""),p(r);return}const a=t.closest("[data-preview-full]");if(a){e.preventDefault();const s=a.getAttribute("data-preview-full")??"";if(s!==""){const r=a.getAttribute("data-preview-alt")??"";Oe(s,r)}}}),document.body.addEventListener("submit",e=>{e.target instanceof HTMLFormElement&&Ae(e)})},ue="view-root",Re=()=>{const e=document.getElementById(ue);if(!e)throw new Error(`未找到视图容器 #${ue}`);return e},le=e=>{Re().innerHTML=e},De=()=>{const e=N.length,t=N.filter(i=>i.tags.some(a=>a.id==="media")).length,n=N.filter(i=>i.tags.some(a=>a.id==="automation")).length;return{total:e,media:t,automation:n}},je=()=>{const{total:e,media:t,automation:n}=De(),i=N.map(a=>{const s=a.externalUrl,r=s?`<a class="button" href="${a.externalUrl}" target="_blank" rel="noopener noreferrer">立即使用 →</a>`:`<button class="button" data-navigate="${a.id}">立即使用 →</button>`,p=s?"<span>外部链接</span>":`<span>脚本：${a.id.replace(/-/g,"_")}.py</span>`;return`
      <article class="module-card" data-module="${a.id}">
        <div class="module-card__header">
          <h3 class="module-card__title">${a.name}</h3>
          <p class="module-card__summary">${a.summary}</p>
          <div class="module-card__tags">
            ${a.tags.map(c=>`<span class="tag">${c.label}</span>`).join("")}
          </div>
        </div>
        <div class="module-card__meta">
          ${p}
        </div>
        <div class="module-card__actions">
          ${r}
        </div>
      </article>
    `}).join("");le(`
    <section class="hero">
      <div>
        <h2>脚本服务概览</h2>
        <p>根据当前仓库脚本自动生成的前端界面，点击即可进入具体操作。</p>
      </div>
      <div class="hero__summary">
        <div class="hero__chip">
          <span class="hero__chip-title">总计脚本</span>
          <span class="hero__chip-value">${e}</span>
        </div>
        <div class="hero__chip">
          <span class="hero__chip-title">媒体处理</span>
          <span class="hero__chip-value">${t}</span>
        </div>
        <div class="hero__chip">
          <span class="hero__chip-title">自动化工具</span>
          <span class="hero__chip-value">${n}</span>
        </div>
      </div>
    </section>
    <section class="section">
      <h2 class="section__title">脚本模块</h2>
      <div class="module-grid">${i}</div>
    </section>
  `)},K=e=>!Number.isFinite(e)||e<0?"--":`${e.toFixed(2)}s`,Ue=e=>{const t=p=>e.fields.find(c=>c.id===p),n=t("video"),i=t("start_sec"),a=t("end_sec"),s=t("n_fps"),r=t("scale");return`
    <div class="form__group form__group--video">
      <label class="form__label" for="extract-video-input">${(n==null?void 0:n.label)??"视频文件"}<sup>*</sup></label>
      <input
        class="input"
        type="file"
        name="video"
        id="extract-video-input"
        accept="${(n==null?void 0:n.accept)??"video/*"}"
        required
        data-video-input
      />
      ${n!=null&&n.description?`<p class="form__hint">${n.description}</p>`:""}
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
            <span class="time-control__title">${(i==null?void 0:i.label)??"起始时间（秒）"}</span>
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
              placeholder="${(i==null?void 0:i.placeholder)??""}"
              data-start-input
            />
            <span class="time-control__meta">已选：<strong data-start-display>0.00s</strong></span>
          </div>
          ${i!=null&&i.description?`<p class="form__hint">${i.description}</p>`:""}
        </div>
        <div class="time-control">
          <div class="time-control__header">
            <span class="time-control__title">${(a==null?void 0:a.label)??"结束时间（秒）"}</span>
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
              placeholder="${(a==null?void 0:a.placeholder)??""}"
              data-end-input
            />
            <span class="time-control__meta">已选：<strong data-end-display>--</strong></span>
          </div>
          ${a!=null&&a.description?`<p class="form__hint">${a.description}</p>`:""}
        </div>
      </div>
    </div>
    ${s?`
    <div class="form__group">
      <label class="form__label" for="extract-fps-input">${s.label??"抽帧帧率"}<sup>*</sup></label>
      <div class="fps-control">
        <input class="fps-control__slider" type="range" min="1" max="60" value="5" step="1" data-fps-range />
        <div class="fps-control__value">
          <input class="input input--condensed" type="number" min="1" max="60" step="1" value="5" name="n_fps" id="extract-fps-input" required data-fps-input />
          <span class="fps-control__suffix">fps</span>
        </div>
      </div>
      ${s.description?`<p class="form__hint">${s.description}</p>`:""}
    </div>`:""}
    ${r?`
    <div class="form__group">
      <label class="form__label" for="extract-scale-select">${r.label??"分辨率缩放"}</label>
      <select class="select" name="scale" id="extract-scale-select">
        <option value="1">原始（100%）</option>
        <option value="0.75">75%</option>
        <option value="0.5">50%</option>
        <option value="0.33">33%</option>
      </select>
      ${r.description?`<p class="form__hint">${r.description}</p>`:""}
    </div>`:""}
  `},Ve=e=>{if(!(e instanceof HTMLFormElement))return;const t=e.querySelector("[data-video-input]"),n=e.querySelector("[data-video-preview]"),i=e.querySelector("[data-video-placeholder]"),a=e.querySelector("[data-video-player-wrapper]"),s=e.querySelector("[data-video-player]"),r=e.querySelector("[data-video-timeline]"),p=e.querySelector("[data-video-toolbar]"),c=e.querySelector("[data-video-seek]"),m=e.querySelector("[data-current-display]"),u=e.querySelector("[data-duration-display]"),o=e.querySelector("[data-start-input]"),l=e.querySelector("[data-end-input]"),f=e.querySelector("[data-start-display]"),g=e.querySelector("[data-end-display]"),x=e.querySelector("[data-set-start]"),w=e.querySelector("[data-set-end]"),_=e.querySelector("[data-fps-range]"),E=e.querySelector("[data-fps-input]"),k=e.querySelector("[data-save-frame]"),S=e.querySelector("[data-status-panel]"),I=e.querySelector("[data-result-panel]");if(!t||!n||!i||!a||!(s instanceof HTMLVideoElement)||!r||!p||!(c instanceof HTMLInputElement)||!(o instanceof HTMLInputElement)||!(l instanceof HTMLInputElement))return;let H="";const D=()=>{H&&(URL.revokeObjectURL(H),H="")},F=d=>{i.hidden=d,i.classList.toggle("video-preview__placeholder--hidden",d),d?i.setAttribute("aria-hidden","true"):i.removeAttribute("aria-hidden"),a.hidden=!d,n.classList.toggle("video-preview--active",d),r.hidden=!d,p.hidden=!d},j=()=>{m&&(m.textContent=K(s.currentTime))},z=()=>{u&&(u.textContent=K(s.duration))},U=()=>{if(f){const d=Number.parseFloat(o.value);f.textContent=Number.isFinite(d)?K(d):"--"}},P=()=>{if(g){const d=Number.parseFloat(l.value);g.textContent=Number.isFinite(d)?K(d):"--"}},h=d=>{const L=Number.isFinite(s.duration)?s.duration:0;return Number.isFinite(d)?L<=0?Math.max(d,0):Math.min(Math.max(d,0),L):0},v=()=>{const d=Number.isFinite(s.duration)?s.duration:0;d>0?(c.max=String(d),c.disabled=!1,c.value=String(s.currentTime)):(c.max="0",c.value="0",c.disabled=!0)},b=()=>{o.value="0",l.value="",U(),P()},O=()=>{try{D();const[d]=t.files??[];if(!d){F(!1),s.removeAttribute("src"),s.load(),b(),j(),z(),v();return}F(!0);try{H=URL.createObjectURL(d),s.src=H,s.load()}catch{const y=new FileReader;y.onload=()=>{const M=y.result;typeof M=="string"&&(s.src=M,s.load())},y.readAsDataURL(d)}b(),j(),z(),v()}catch(d){$(e,"error","视频预览初始化失败",String(d&&typeof d=="object"&&"message"in d?d.message:d))}},X=()=>{const d=Number.parseFloat(c.value);Number.isFinite(d)&&(s.currentTime=Math.max(d,0))},A=()=>{const d=h(s.currentTime);o.value=d.toFixed(2),Number.isFinite(Number.parseFloat(l.value))&&Number.parseFloat(l.value)<d&&(l.value=d.toFixed(2)),U(),P()},q=()=>{const d=h(s.currentTime);l.value=d.toFixed(2),Number.parseFloat(o.value)>d&&(o.value=d.toFixed(2),U()),P()},V=()=>{const d=h(Number.parseFloat(o.value));if(Number.isNaN(d))o.value="0";else{o.value=d.toFixed(2);const L=Number.parseFloat(l.value);Number.isFinite(L)&&L<d&&(l.value=d.toFixed(2),P())}U()},J=()=>{if(l.value===""){P();return}const d=h(Number.parseFloat(l.value));if(Number.isNaN(d))l.value="";else{const L=Number.parseFloat(o.value),y=L>d?L:d;l.value=y.toFixed(2)}P()},Z=d=>{if(!(_ instanceof HTMLInputElement)||!(E instanceof HTMLInputElement))return;const L=Number(_.min)||1,y=Number(_.max)||60;let M=Number.parseInt(String(d),10);Number.isFinite(M)||(M=L),M=Math.min(Math.max(M,L),y),_.value=String(M),E.value=String(M)};let ie=!1;const se=()=>{ie||(ie=!0,queueMicrotask(()=>{ie=!1,O()}))};t.addEventListener("change",se),t.addEventListener("input",se),(()=>{const d=()=>{const y=t.files&&t.files.length>0?t.files[0]:null;return y?`${y.name}|${y.size}|${y.lastModified}`:""};let L=d();window.setInterval(()=>{const y=d();y!==L&&(L=y,se())},300)})(),c.addEventListener("input",X),s.addEventListener("timeupdate",()=>{c.matches(":active")||(c.value=String(s.currentTime)),j()}),s.addEventListener("loadedmetadata",()=>{z(),v()}),s.addEventListener("ended",()=>{s.currentTime=s.duration||0,j(),c.value=String(s.currentTime)}),o.addEventListener("change",V),o.addEventListener("blur",V),l.addEventListener("change",J),l.addEventListener("blur",J),x instanceof HTMLButtonElement&&x.addEventListener("click",A),w instanceof HTMLButtonElement&&w.addEventListener("click",q),_ instanceof HTMLInputElement&&_.addEventListener("input",()=>Z(_.value)),E instanceof HTMLInputElement&&(E.addEventListener("change",()=>Z(E.value)),E.addEventListener("blur",()=>Z(E.value))),e.addEventListener("reset",()=>{D(),F(!1),s.removeAttribute("src"),s.load(),c.value="0",c.disabled=!0,_ instanceof HTMLInputElement&&(_.value="5"),E instanceof HTMLInputElement&&(E.value="5"),m&&(m.textContent="00.00s"),u&&(u.textContent="--"),b()}),E instanceof HTMLInputElement&&Z(E.value),b(),F(!1);const be=async()=>{const[d]=t.files??[];if(!d){S&&$(e,"error","请先上传视频文件","");return}const L=h(s.currentTime);if(!Number.isFinite(L)||L<0){S&&$(e,"error","无法获取当前视频时刻","");return}S&&$(e,"info","正在保存当前帧...",`时刻: ${K(L)}`);try{const y=new FormData;y.append("video",d),y.append("timestamp",String(L.toFixed(2)));const M=e.querySelector('input[type="hidden"][name="crop_x"]'),ae=e.querySelector('input[type="hidden"][name="crop_y"]'),re=e.querySelector('input[type="hidden"][name="crop_w"]'),oe=e.querySelector('input[type="hidden"][name="crop_h"]');M instanceof HTMLInputElement&&ae instanceof HTMLInputElement&&re instanceof HTMLInputElement&&oe instanceof HTMLInputElement&&M.value&&ae.value&&re.value&&oe.value&&(y.append("crop_x",M.value),y.append("crop_y",ae.value),y.append("crop_w",re.value),y.append("crop_h",oe.value));const we=Q("/api/tasks/extract-single-frame"),B=await fetch(we,{method:"POST",body:y});if(!B.ok){let ee=`请求失败，状态码 ${B.status}`;try{if((B.headers.get("content-type")||"").includes("application/json")){const T=await B.json();T&&typeof T.detail=="string"&&T.detail.trim()!==""?ee=T.detail.trim():typeof T.message=="string"&&T.message.trim()!==""&&(ee=T.message.trim())}else{const T=await B.text();T&&T.trim()!==""&&(ee=T.trim())}}catch{}throw new Error(ee)}const Y=await B.json(),Ee=typeof Y.message=="string"&&Y.message.trim()!==""?Y.message.trim():"帧图片保存成功",$e=Y.job_id?`任务编号：${Y.job_id}`:"";S&&$(e,"success",Ee,$e),I&&ge(e,{id:"extract-single-frame",name:"单帧提取",tags:[{id:"media",label:"视频处理"}]},Y)}catch(y){const M=y instanceof TypeError?`无法连接后端服务：${y.message}`:y instanceof Error?y.message:"未知错误";S&&$(e,"error","保存失败",M)}};k instanceof HTMLButtonElement&&k.addEventListener("click",()=>{be()})},Be=()=>`
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
  `,Ye=e=>{if(!(e instanceof HTMLFormElement))return;const t=e.querySelector("[data-qrcode-mode]"),n=e.querySelector("[data-qrcode-toggle]"),i=e.querySelector("[data-url-group]"),a=e.querySelector("[data-audio-group]"),s=e.querySelector("[data-video-group]");if(!(t instanceof HTMLInputElement)||!n||!i||!a||!s)return;const r=()=>{const p=t.value==="mp3"?"mp3":t.value==="video"?"video":"url",c=p==="mp3",m=p==="video";i.hidden=c||m,a.hidden=!c,s.hidden=!m;const u=i.querySelector("input[name='target_url']"),o=a.querySelector("input[name='audio']"),l=s.querySelector("input[name='video']");u instanceof HTMLInputElement&&(u.disabled=c||m,(c||m)&&(u.value="")),o instanceof HTMLInputElement&&(o.disabled=!c,c||(o.value="")),l instanceof HTMLInputElement&&(l.disabled=!m,m||(l.value=""))};n.addEventListener("click",p=>{const c=p.target;if(!(c instanceof HTMLElement))return;const m=c.closest("[data-mode]");if(!m)return;const u=m.getAttribute("data-mode"),o=u==="mp3"?"mp3":u==="video"?"video":"url";t.value=o,n.querySelectorAll(".segmented__item").forEach(f=>{f.classList.toggle("is-active",f===m),f.setAttribute("aria-selected",f===m?"true":"false")}),r()}),t.value="url",r()},me="data-video-cropper-mounted",Ge=e=>{const t=Array.from(e.querySelectorAll('input[type="file"]'));for(const n of t){if(!(n instanceof HTMLInputElement))continue;const i=(n.getAttribute("accept")||"").toLowerCase(),a=(n.getAttribute("name")||"").toLowerCase();if(i.includes("video/")||a==="video")return n}return null},te=(e,t)=>{const n=e.querySelector(`input[type="hidden"][name="${t}"]`);if(n instanceof HTMLInputElement)return n;const i=document.createElement("input");return i.type="hidden",i.name=t,i.value="",e.appendChild(i),i},fe=(e,t)=>{const n=t.getBoundingClientRect(),i=Math.min(Math.max(e.clientX-n.left,0),n.width),a=Math.min(Math.max(e.clientY-n.top,0),n.height);return{x:i,y:a,w:n.width,h:n.height}},We=(e,t,n,i)=>{const a=Math.min(e,n),s=Math.min(t,i),r=Math.abs(n-e),p=Math.abs(i-t);return{x:a,y:s,w:r,h:p}},ze=(e,t,n)=>{const i=Number(t.videoWidth)||0,a=Number(t.videoHeight)||0;if(!i||!a||!n.stageW||!n.stageH)return null;const s=i/n.stageW,r=a/n.stageH,p=Math.round(e.x*s),c=Math.round(e.y*r),m=Math.round(e.w*s),u=Math.round(e.h*r);return{x:p,y:c,w:m,h:u}},Xe=e=>{if(!(e instanceof HTMLFormElement)||e.hasAttribute(me))return;const t=Ge(e);if(!(t instanceof HTMLInputElement))return;const n=te(e,"crop_x"),i=te(e,"crop_y"),a=te(e,"crop_w"),s=te(e,"crop_h");let r=null;const p=e.querySelector("video");p instanceof HTMLVideoElement&&(r=p);let c="";const m=()=>{c&&(URL.revokeObjectURL(c),c="")};let u=null,o=null,l=null,f=null,g=null,x=null;const w=()=>{if(f&&u&&o&&l&&r&&g&&x)return;const h=e.querySelector(".video-preview__player-wrapper");if(h instanceof HTMLElement&&r instanceof HTMLVideoElement)h.classList.add("video-cropper__stage"),u=(h instanceof HTMLDivElement,h);else{const v=t.closest(".form__group")||t.parentElement||e,b=document.createElement("div");b.className="video-cropper__container",b.innerHTML=`
        <div class="video-cropper__stage">
          <video class="video-cropper__video" controls preload="metadata" playsinline></video>
          <div class="video-cropper__overlay" data-crop-overlay>
            <div class="video-cropper__rect" data-crop-rect></div>
          </div>
        </div>
      `,v.insertAdjacentElement("afterend",b);const O=b.querySelector("video");O instanceof HTMLVideoElement&&(r=O),u=b.querySelector(".video-cropper__stage")}if(u&&!(u.querySelector(".video-cropper__overlay")instanceof HTMLElement)){const v=document.createElement("div");v.className="video-cropper__overlay",v.setAttribute("data-crop-overlay",""),v.innerHTML='<div class="video-cropper__rect" data-crop-rect></div>',u.appendChild(v)}if(o=u?u.querySelector("[data-crop-overlay]"):null,l=u?u.querySelector("[data-crop-rect]"):null,!(e.querySelector("[data-video-cropper-panel]")instanceof HTMLElement)){const v=document.createElement("div");v.className="video-cropper__panel",v.setAttribute("data-video-cropper-panel",""),v.innerHTML=`
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
      `;const b=e.querySelector("[data-video-preview]");b instanceof HTMLElement?b.appendChild(v):u?u.insertAdjacentElement("afterend",v):e.appendChild(v)}f=e.querySelector("[data-video-cropper-panel]"),g=f?f.querySelector("[data-crop-enable]"):null,x=f?f.querySelector("[data-crop-value]"):null,f&&(f.hidden=!0)};let _=null,E=!1,k={x:0,y:0};const S=()=>{_=null,n.value="",i.value="",a.value="",s.value="",l&&(l.style.display="none"),x&&(x.textContent="未选择区域")},I=()=>{if(!_||!r||!o||!x)return;const h=o.getBoundingClientRect(),v=ze(_,r,{stageW:h.width,stageH:h.height});if(!v)return;const b=Math.max(1,v.w),O=Math.max(1,v.h);n.value=String(Math.max(0,v.x)),i.value=String(Math.max(0,v.y)),a.value=String(b),s.value=String(O),x.textContent=`已选区域：x=${n.value}, y=${i.value}, w=${a.value}, h=${s.value}`},H=()=>{!_||!l||(l.style.display="block",l.style.left=`${_.x}px`,l.style.top=`${_.y}px`,l.style.width=`${_.w}px`,l.style.height=`${_.h}px`)},D=()=>{w();const h=t.files&&t.files.length>0||r&&!!r.src;f&&(f.hidden=!h),h||(g&&(g.checked=!1),S()),o&&(o.hidden=!h||!F(),o.style.pointerEvents=o.hidden?"none":"auto")},F=()=>!!(g&&g.checked),j=()=>{if(!o||!l)return;o.style.touchAction="none",o.hidden=!F(),o.style.pointerEvents=o.hidden?"none":"auto",o.addEventListener("pointerdown",v=>{if(!F()||!(v instanceof PointerEvent))return;E=!0,o.setPointerCapture(v.pointerId);const b=fe(v,o);k={x:b.x,y:b.y},_={x:b.x,y:b.y,w:0,h:0},H()}),o.addEventListener("pointermove",v=>{if(!F()||!E||!(v instanceof PointerEvent))return;const b=fe(v,o);_=We(k.x,k.y,b.x,b.y),H()});const h=()=>{if(E&&(E=!1,!!_)){if(_.w<2||_.h<2){S();return}I()}};o.addEventListener("pointerup",h),o.addEventListener("pointercancel",h),o.addEventListener("lostpointercapture",h)},z=()=>{if(!f)return;const h=f.querySelector("[data-crop-clear]");h instanceof HTMLButtonElement&&h.addEventListener("click",()=>{S()}),g instanceof HTMLInputElement&&g.addEventListener("change",()=>{o&&(o.hidden=!g.checked,o.style.pointerEvents=g.checked?"auto":"none"),g.checked||S()})},U=()=>{r instanceof HTMLVideoElement&&r.addEventListener("loadedmetadata",()=>{_&&I()})},P=()=>{let h=!1;const v=()=>{if(w(),r&&r.classList.contains("video-cropper__video")){m();const[A]=t.files??[];if(A&&r)try{c=URL.createObjectURL(A),r.src=c,r.load()}catch{const V=new FileReader;V.onload=()=>{const J=V.result;typeof J=="string"&&(r.src=J,r.load())},V.readAsDataURL(A)}else r&&(r.removeAttribute("src"),r.load())}S(),D()},b=()=>{h||(h=!0,queueMicrotask(()=>{h=!1,v()}))};t.addEventListener("change",b),t.addEventListener("input",b),(()=>{const X=()=>{const q=t.files&&t.files.length>0?t.files[0]:null;return q?`${q.name}|${q.size}|${q.lastModified}`:""};let A=X();window.setInterval(()=>{const q=X();q!==A&&(A=q,b())},300)})(),e.addEventListener("reset",()=>{m(),S(),g&&(g.checked=!1),D()})};e.setAttribute(me,"true"),w(),j(),z(),U(),P(),D()},Je=e=>`
  <nav class="breadcrumbs">
    <a class="breadcrumbs__item" href="#" data-link="home">首页</a>
    <span class="breadcrumbs__item">${e.name}</span>
  </nav>
`,Ke=e=>`
  <div class="module-detail__meta">
    ${e.tags.map(t=>`<span class="module-detail__meta-item">${t.label}</span>`).join("")}
    <span class="module-detail__meta-item">API: ${e.endpoint}</span>
    <span class="module-detail__meta-item">后端: ${R}</span>
  </div>
`,Qe=e=>{const t=`name="${e.id}" id="${e.id}" ${e.required?"required":""}`,n=e.description?`<p class="form__hint">${e.description}</p>`:"";switch(e.type){case"textarea":return`
        <div class="form__group">
          <label class="form__label" for="${e.id}">${e.label}${e.required?"<sup>*</sup>":""}</label>
          <textarea class="textarea" ${t} placeholder="${e.placeholder??""}"></textarea>
          ${n}
        </div>
      `;case"select":return`
        <div class="form__group">
          <label class="form__label" for="${e.id}">${e.label}${e.required?"<sup>*</sup>":""}</label>
          <select class="select" ${t}>
            ${(e.options??[]).map(i=>`<option value="${i}">${i}</option>`).join("")}
          </select>
          ${n}
        </div>
      `;case"file":return`
        <div class="form__group">
          <label class="form__label" for="${e.id}">${e.label}${e.required?"<sup>*</sup>":""}</label>
          <input class="input" type="file" ${t} ${e.accept?`accept="${e.accept}"`:""} />
          ${n}
        </div>
      `;default:return`
        <div class="form__group">
          <label class="form__label" for="${e.id}">${e.label}${e.required?"<sup>*</sup>":""}</label>
          <input class="input" type="${e.type}" ${t} placeholder="${e.placeholder??""}" />
          ${n}
        </div>
      `}},Ze=e=>{const t=N.find(a=>a.id===e);if(!t){le(`<div class="empty">
        <p>未找到对应模块。</p>
        <button class="button button--ghost" data-link="home">返回首页</button>
      </div>`);return}const n=t.id==="extract-frames"||t.id==="mp4-to-gif"?Ue(t):t.id==="qrcode-generator"?Be():t.fields.map(Qe).join("");if(le(`
    ${Je(t)}
    <section class="module-detail">
      <header class="module-detail__header">
        <h2 class="module-detail__title">${t.name}</h2>
        <p class="module-detail__desc">${t.description}</p>
        ${Ke(t)}
      </header>
      <div class="module-detail__body">
        <form class="form form-card" data-module-form="${t.id}" autocomplete="off">
          ${n}
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
  `),t.id==="extract-frames"||t.id==="mp4-to-gif"){const a=document.querySelector(`[data-module-form="${t.id}"]`);Ve(a)}else if(t.id==="qrcode-generator"){const a=document.querySelector(`[data-module-form="${t.id}"]`);Ye(a)}const i=document.querySelector(`[data-module-form="${t.id}"]`);Xe(i)},ve=()=>{const e=window.location.hash;if(e.startsWith("#/module/")){const t=e.replace("#/module/",""),n=N.find(i=>i.id===t);if(n!=null&&n.externalUrl){window.location.href=n.externalUrl;return}Ze(t)}else je()},et=()=>{Ce(),ve(),window.addEventListener("hashchange",ve);const e=document.getElementById(xe);e&&(e.textContent=String(new Date().getFullYear())),ye(),Ne()};et();
