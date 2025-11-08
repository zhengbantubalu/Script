# 脚本工具箱 Web 平台说明文档

## 项目概览

脚本工具箱是一个将个人脚本资产统一封装为图形化与 API 服务的平台。项目通过 FastAPI 后端调用已有的 Python 脚本，提供统一的任务调度、文件上传与结果归档能力，并配套一个纯静态前端，便于在浏览器中直观地提交任务、查看进度与下载结果。

平台适合以下场景：

- 对既有脚本进行集中托管，降低命令行使用门槛。
- 在局域网内共享媒体处理、数据集工具等个人高频脚本。
- 快速扩展新的自动化脚本，复用统一的作业目录与文件服务。

## 目录结构

```
backend/         FastAPI 服务端代码与通用工具
frontend/        纯静态前端（HTML/CSS/JavaScript）
scripts/         可复用的功能脚本集合
```

- `backend/storage/`：所有任务的临时产出、可下载文件均存放于此目录，前端通过 `/files/...` 静态路径访问。
- `scripts/`：平台核心能力来源，后端会直接导入并调用这些脚本。

## 功能模块一览

| 模块 ID | 前端名称 | 对应脚本 | 核心功能 |
| --- | --- | --- | --- |
| `extract-frames` | 视频抽帧 | `scripts/extract_frames.py` | 按起止时间与帧率导出视频帧图像，并生成压缩包。 |
| `images-download` | 网页图片批量下载 | `scripts/images_download.py` | 抓取网页内的图片资源并统一打包。 |
| `mp4-to-live-photo` | Live Photo 生成 | `scripts/mp42mov.py` | 将短视频转换为 iOS 兼容的 `.mov+.jpg` 搭配。 |
| `network-scan` | 局域网设备扫描 | `scripts/scan.py` | 基于 ARP 的网段设备扫描，列出在线主机。 |
| `folder-split` | 批量文件分拣 | `scripts/split-files.py` | 按扩展名均匀拆分文件到多个子目录。 |
| `url-to-mp4` | 在线视频下载 | `scripts/URL2mp4.py` | 下载 YouTube、Bilibili 等平台的视频源文件。 |
| `yolo-json-to-txt` | YOLO 标注转换 | `scripts/yolo/json_to_yolo.py` | 将 LabelMe JSON 标注批量转换为 YOLO txt。 |
| `yolo-label-vis` | YOLO 标注可视化 | `scripts/yolo/label_vis.py` | 叠加绘制检测框，方便快速巡检标注质量。 |
| `yolo-write-img-path` | YOLO 数据集路径生成 | `scripts/yolo/write_img_path.py` | 依据 ImageSets/Main 列表生成图片绝对路径。 |
| `yolo-split-dataset` | YOLO 数据集划分 | `scripts/yolo/split_train_val.py` | 按比例拆分 VOC XML 标注，生成训练/验证集索引。 |

所有模块均遵循统一的提交与返回结构，前端会展示状态提示、结果预览、文件下载与任务编号，方便定位产物。

## 环境准备

### 基础要求

- Python 3.10+（推荐 3.11）
- 推荐使用虚拟环境（`python -m venv .venv`）
- macOS/Linux/Windows 均可，某些脚本需额外依赖（例如 ffmpeg、网络扫描权限）

### 后端依赖安装

```bash
cd /Volumes/KIOXIA/Scripts/web/backend
python -m venv .venv
source .venv/bin/activate   # Windows 使用 .\.venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt
```

关键依赖说明：

- `fastapi`、`uvicorn`：Web 服务框架与 ASGI 服务器。
- `python-multipart`：上传文件处理。
- `opencv-python`、`moviepy`、`Pillow`：媒体处理脚本依赖。
- `yt-dlp`：在线视频下载。
- `scapy`：网络扫描，需要管理员权限或 root 权限运行。

## 运行后端服务

```bash
cd /Volumes/KIOXIA/Scripts/web
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

- 启动后，接口根路径为 `http://<server>:8000`。
- 健康检查地址：`GET /api/health`。
- 静态文件路径：`/files/...` 映射到 `backend/storage/`。

### 作业目录与文件存储

- 每次任务提交后，会在 `backend/storage/<module>/<job_id>/` 下创建作业空间。
- 上传文件、解压后的原始数据、处理结果以及生成的压缩包均保存在该目录。
- 清理策略：默认不自动清除，请定期手动删除历史作业目录或编写计划任务。

## 本地局域网扫描助手（推荐）

出于浏览器安全限制，网页无法直接对用户设备所在局域网执行 ARP/端口探测。因此平台新增了“本地扫描助手”，让扫描在用户本机进行，结果直接回传给前端展示；若未运行助手，则回退为在服务器侧扫描（即扫描服务器所在局域网）。

### 启动本地扫描助手

```bash
cd /Volumes/KIOXIA/Scripts/web
python -m venv .venv
source .venv/bin/activate   # Windows 使用 .\.venv\Scripts\activate
pip install --upgrade pip
pip install -r backend/requirements.txt

# macOS/Linux 如需原生 ARP 扫描，建议以管理员权限运行
python scripts/local_scanner_server.py
# 服务器默认监听 http://127.0.0.1:47832
```

- 前端在提交“局域网设备扫描”时，会优先尝试请求 `http://127.0.0.1:47832/scan`；
- 如果无法连接本地助手，则自动回退调用后端 `/api/tasks/network-scan`（扫描服务器所在网段）；
- `scapy` 在不同系统上可能需要管理员/root 权限或额外授权（macOS 会弹出本地网络访问授权）。

## 前端站点

前端位于 `frontend/` 目录，可通过任意静态服务器或直接浏览器打开：

```bash
cd /Volumes/KIOXIA/Scripts/web/frontend
python -m http.server 4173
# 浏览器访问 http://localhost:4173
```

### 后端地址配置

前端默认假设后端运行在与当前页面同域的 `:8000` 端口，可通过以下方式覆盖：

1. 在浏览器控制台执行：

   ```javascript
   localStorage.setItem("backendBaseUrl", "http://your-server:8000");
   ```

2. 或在页面挂载前定义全局配置：

   ```html
   <script>
     window.APP_CONFIG = { backendBaseUrl: "http://your-server:8000" };
   </script>
   <script type="module" src="./app.js"></script>
   ```

## API 接口概览

后端统一采用 `POST /api/tasks/<module>` 形式，部分重要接口如下（字段与说明简写，可在前端源码 `frontend/app.js` 中查看完整表单定义）：

| 接口 | 关键参数 | 成功响应字段 |
| --- | --- | --- |
| `/api/tasks/extract-frames` | `video`、`n_fps`、`start_sec`、`end_sec` | `message`、`job_id`、`archive`、`previews`、`files` |
| `/api/tasks/images-download` | `page_url`、`save_path` | `archive`、`files` |
| `/api/tasks/mp4-to-live-photo` | `video`、`output_prefix`、`duration`、`keyframe_time` | `files` (`.mov`/`.jpg`) |
| `/api/tasks/network-scan` | `network_range`（可选） | `devices`（列表，含 IP、MAC 等） |
| `/api/tasks/folder-split` | `source_dir`、`file_extension`、`num_folders` | `source_dir` |
| `/api/tasks/url-to-mp4` | `video_url` | `archive`、`files` |
| `/api/tasks/yolo-json-to-txt` | `classes`、`json_archive` | `archive`、`files` |
| `/api/tasks/yolo-label-vis` | `annotations_archive`、`images_archive`、`class_names` | `archive`、`files` |
| `/api/tasks/yolo-write-img-path` | `images_root`、`image_sets_archive`、`image_ext` | `archive`、`files` |
| `/api/tasks/yolo-split-dataset` | `xml_archive`、`trainval_ratio`、`train_ratio` | `archive`、`files` |

所有响应均遵循 JSON 结构，包含 `message` 字段描述执行结果，若生成文件则附带可下载的相对路径，前端会自动补全为可访问 URL。

## 常用命令与调试建议

- **查看日志**：直接在启动 `uvicorn` 的终端窗口查看。捕获到的异常会被 FastAPI 记录。
- **权限问题**：`network-scan` 模块依赖 Scapy，macOS/Unix 环境需要 `sudo` 运行或提前配置权限。
- **ffmpeg 依赖**：`mp4-to-live-photo` 与 `URL2mp4` 均依赖外部 `ffmpeg`，需要自行安装并确保在系统 PATH 中。
- **资源清理**：如果磁盘空间有限，可定期清空 `backend/storage/*` 下旧作业，或为作业目录增加定时清理脚本。

## 扩展新脚本的流程

1. **编写或引入脚本**：放入 `scripts/` 目录，确保入口函数参数明确且可被调用。
2. **在后端注册接口**：
   - 在 `backend/main.py` 中导入脚本并新增 FastAPI 路由。
   - 使用 `create_job_dir()`、`save_upload_file()`、`make_zip()` 等工具复用统一的作业方式。
3. **更新前端模块配置**：
   - 在 `frontend/app.js` 中向 `MODULES` 数组追加配置，定义表单字段、说明与标签。
4. **测试回归**：启动后端、刷新前端页面，确认新模块可以提交任务并得到预期结果。

为保持一致性，建议：

- 尽量使用 POST 表单提交，多文件上传使用 `UploadFile`。
- 返回值包含 `message`、`job_id`、`archive` 以及 `files` 等常用字段。
- 若脚本需要较长时间执行，可考虑加入任务队列或后台进程，目前实现为同步执行。

## 安全与部署注意事项

- 当前版本未做鉴权，默认信任同网段用户。如需公网部署，请增加认证与访问控制。
- 上传文件未做严格类型校验，需信任使用者或在脚本内部自行校验。
- 建议在防火墙或反向代理层限制允许访问的来源 IP。

## 变更记录

- **v1.0.0**：建立 FastAPI 服务端，整合 10 个常用脚本，提供前端操作界面与统一文件服务。

如需进一步完善文档或新增用例，请更新本文件并同步维护 `frontend/app.js` 中的模块说明。


