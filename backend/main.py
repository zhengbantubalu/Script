"""脚本工具箱后端服务。"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import List, Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    JSONResponse,
    HTMLResponse,
    FileResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from urllib.parse import quote, unquote

from .utils import (
    BASE_DIR,
    STORAGE_DIR,
    build_file_url,
    create_job_dir,
    extract_archive,
    iter_files,
    make_zip,
    save_upload_file,
    maybe_prepare_cropped_video,
)
from .job_meta import load_job_meta, save_job_meta, update_job_progress

# 将项目根目录加入路径，方便导入现有脚本
if str(BASE_DIR) not in sys.path:
    sys.path.append(str(BASE_DIR))

SCRIPTS_DIR = BASE_DIR / "scripts"

from scripts.extract_frames import extract_frames  # noqa: E402
from scripts.images_download import download_images_from_url  # noqa: E402

try:
    from scripts.mp42mov import convert_to_live_photo  # noqa: E402
except ModuleNotFoundError:
    convert_to_live_photo = None
try:
    from scripts.mp42gif import mp4_to_gif as convert_mp4_to_gif  # noqa: E402
except ModuleNotFoundError:
    convert_mp4_to_gif = None
from scripts.scan import (  # noqa: E402
    get_my_ip,
    get_network_range,
    scan_network,
    scan_lan_devices,
    scan_devices_in_ranges,
)
from scripts.URL2mp4 import download_youtube_video  # noqa: E402
from scripts.yolo.json_to_yolo import decode_json  # noqa: E402
from scripts.yolo.label_vis import process_all_annotations  # noqa: E402
from scripts.yolo.write_img_path import generate_image_lists  # noqa: E402
from scripts.yolo.split_train_val import split_dataset  # noqa: E402

# 特殊命名的脚本需要动态导入
import importlib.util

split_files_path = SCRIPTS_DIR / "split-files.py"
split_spec = importlib.util.spec_from_file_location("split_files", split_files_path)
split_module = importlib.util.module_from_spec(split_spec)
assert split_spec.loader is not None
split_spec.loader.exec_module(split_module)
distribute_files = split_module.distribute_files

app = FastAPI(title="脚本工具箱 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/files", StaticFiles(directory=STORAGE_DIR), name="files")


@app.get("/api/health")
def health_check() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/api/jobs/{module_id}/{job_id}")
def api_get_job(module_id: str, job_id: str) -> JSONResponse:
    """
    查询指定模块下某个任务的元数据与结果，用于前端恢复历史任务。
    目前主要用于 extract-frames 模块，其它模块可逐步接入。
    """
    try:
        meta = load_job_meta(module_id, job_id)
    except FileNotFoundError as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return JSONResponse(meta)


@app.get("/api/download")
def api_download(path: str):
    """
    以"附件下载"方式返回存储目录下的文件，避免浏览器直接在线预览。
    仅允许以 /files/ 开头的路径。
    """
    try:
        # 解码 URL 编码的路径（处理中文字符等情况）
        cleaned = unquote((path or "").strip())
        if not cleaned.startswith("/files/"):
            raise ValueError("非法文件路径")
        rel = cleaned[len("/files/") :]
        # 处理路径中的特殊字符，确保路径正确
        file_path = STORAGE_DIR / rel
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError("文件不存在")
        return FileResponse(
            path=file_path,
            filename=file_path.name,
            media_type="application/octet-stream",
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/gif")
def gif_view_page(
    request: Request, file: str, title: Optional[str] = None
) -> HTMLResponse:
    """
    微信友好：GIF 预览页。用于手机端长按保存/添加表情，或桌面端直接查看。
    参数 `file` 形如 /files/.../xxx.gif
    """
    try:
        cleaned = (file or "").strip()
        if not cleaned.startswith("/files/"):
            raise ValueError("非法文件路径")
        rel = cleaned[len("/files/") :]
        gif_path = STORAGE_DIR / rel
        if not gif_path.exists() or not gif_path.is_file():
            raise FileNotFoundError("GIF 文件不存在")
        if gif_path.suffix.lower() != ".gif":
            raise ValueError("仅支持 .gif 文件")
    except Exception as exc:  # noqa: BLE001
        return HTMLResponse(
            content=f"<h1>无法显示</h1><p>{str(exc)}</p>",
            status_code=404,
        )

    base_url = str(request.base_url).rstrip("/")
    gif_url = f"{base_url}{cleaned}"
    display_title = (title or gif_path.stem).strip() or "GIF 预览"

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{display_title}</title>
    <meta name="theme-color" content="#111827" />
    <style>
      :root {{
        --bg: #0f172a;
        --card: #111827;
        --text: #e5e7eb;
        --muted: #9ca3af;
      }}
      * {{ box-sizing: border-box; }}
      html, body {{ height: 100%; }}
      body {{
        margin: 0; background: linear-gradient(135deg, var(--bg), #0b1225);
        color: var(--text); font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial;
        display: grid; place-items: center; padding: 24px;
      }}
      .card {{
        width: min(680px, 100%);
        background: var(--card);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 16px;
        padding: 20px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      }}
      .title {{ margin: 0 0 8px; font-size: 20px; font-weight: 700; }}
      .subtitle {{ margin: 0 0 14px; font-size: 13px; color: var(--muted); }}
      .stage {{ display: grid; place-items: center; background: #000; border-radius: 12px; overflow: hidden; }}
      .stage img {{ width: 100%; height: auto; display: block; image-rendering: -webkit-optimize-contrast; }}
      .hint {{ font-size: 12px; color: var(--muted); margin-top: 8px; }}
      .actions {{ display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }}
      .btn {{ padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: var(--text); text-decoration: none; }}
    </style>
  </head>
  <body>
    <main class="card">
      <h1 class="title">{display_title}</h1>
      <p class="subtitle">长按图片可保存/添加到表情（微信内打开更友好）</p>
      <div class="stage">
        <img src="{gif_url}" alt="{display_title}" />
      </div>
      <div class="actions">
        <a class="btn" href="{gif_url}" download>下载 GIF</a>
      </div>
      <p class="hint">如在微信中打开：长按图片 → 保存图片/添加到表情。</p>
    </main>
  </body>
</html>"""
    return HTMLResponse(content=html)


@app.get("/api/utils/qrcode")
def api_utils_qrcode(url: str):
    """
    输入任意 URL，返回二维码 PNG（StreamingResponse）。
    用于“手机扫码打开 GIF 页”，便于长按保存/添加表情。
    """
    try:
        cleaned = (url or "").strip()
        if not cleaned:
            raise ValueError("请输入有效的 URL")
        import qrcode  # type: ignore

        img = qrcode.make(cleaned)
        import io

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return StreamingResponse(buf, media_type="image/png")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _extract_frames_with_progress(
    job_id: str,
    video_path: Path,
    start_sec: float,
    end_sec: float,
    n_fps: int,
    output_path: Path,
    output_dir_name: str,
    input_filename: str,
):
    """
    后台任务：执行视频抽帧并更新进度。
    """
    import cv2

    try:
        # 初始化 meta.json（状态：running）
        update_job_progress("extract-frames", job_id, 0.0, "正在解析视频...", status="running")

        # 打开视频文件
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise IOError("无法打开视频文件")

        # 获取视频属性
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0
        if end_sec == -1:
            end_sec = duration

        # 验证时间范围有效性
        if start_sec < 0 or end_sec > duration or start_sec >= end_sec:
            cap.release()
            raise ValueError(f"无效时间范围 (视频时长: {duration:.2f}秒)")

        # 将秒转换为帧号
        start_frame = int(start_sec * fps)
        end_frame = min(int(end_sec * fps), total_frames - 1)

        # 计算帧间隔
        interval = max(1, int(round(fps / n_fps)))  # 至少间隔1帧

        # 估算需要处理的帧数（用于进度计算）
        frames_to_process = end_frame - start_frame + 1
        estimated_saved = max(1, frames_to_process // interval)

        update_job_progress(
            "extract-frames",
            job_id,
            5.0,
            f"开始抽帧：预计生成约 {estimated_saved} 张图片",
            status="running",
        )

        # 定位到起始帧
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

        count = 0
        saved_count = 0
        current_frame = start_frame
        last_progress_update = 0

        while current_frame <= end_frame:
            ret, frame = cap.read()
            if not ret:
                break

            # 检查是否达到保存间隔
            if count % interval == 0:
                # 计算当前时间戳
                timestamp = current_frame / fps
                frame_path = output_path / f"{input_filename}_frame_{timestamp:.2f}s.jpg"
                cv2.imwrite(str(frame_path), frame)
                saved_count += 1

                # 每保存 10 张图片或每 5% 进度更新一次
                progress = 5.0 + ((current_frame - start_frame) / frames_to_process) * 85.0
                if saved_count - last_progress_update >= 10 or progress - last_progress_update >= 5.0:
                    update_job_progress(
                        "extract-frames",
                        job_id,
                        progress,
                        f"已抽取 {saved_count} 张图片...",
                        status="running",
                    )
                    last_progress_update = progress

            count += 1
            current_frame += 1

        cap.release()

        if saved_count == 0:
            raise ValueError("未生成任何图像文件")

        # 打包阶段（90-95%）
        update_job_progress("extract-frames", job_id, 90.0, "正在打包结果文件...", status="running")
        zip_path = output_path.parent / f"{output_dir_name}.zip"
        make_zip(output_path, zip_path)

        # 生成文件列表（95-100%）
        update_job_progress("extract-frames", job_id, 95.0, "正在生成文件列表...", status="running")
        files = sorted(iter_files(output_path))
        files_urls = [build_file_url(file_path) for file_path in files]
        preview_limit = 8
        previews = files_urls[:preview_limit]

        result = {
            "message": f"抽帧完成，共生成 {saved_count} 张图片",
            "job_id": job_id,
            "input_filename": input_filename,
            "archive": build_file_url(zip_path),
            "files": files_urls,
            "total_files": len(files_urls),
            "previews": previews,
        }

        # 最终保存（100%，状态：success）
        save_job_meta("extract-frames", job_id, result, status="success")
        update_job_progress("extract-frames", job_id, 100.0, "处理完成", status="success")

    except Exception as exc:  # noqa: BLE001
        # 保存错误信息
        error_result = {
            "job_id": job_id,
            "input_filename": input_filename,
            "message": f"处理失败：{str(exc)}",
            "status": "failed",
        }
        save_job_meta("extract-frames", job_id, error_result, status="failed")
        update_job_progress("extract-frames", job_id, 0.0, f"处理失败：{str(exc)}", status="failed")


@app.post("/api/tasks/extract-frames")
async def api_extract_frames(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    start_sec: Optional[float] = Form(None),
    end_sec: Optional[float] = Form(None),
    n_fps: int = Form(...),
    output_dir: str = Form("frames"),
    crop_x: Optional[int] = Form(None),
    crop_y: Optional[int] = Form(None),
    crop_w: Optional[int] = Form(None),
    crop_h: Optional[int] = Form(None),
):
    """
    视频抽帧接口（异步模式）。
    上传完成后立即返回 job_id，后台异步执行抽帧任务。
    前端可通过 /api/jobs/extract-frames/{job_id} 轮询获取进度。
    """
    job_id, job_dir = create_job_dir("extract-frames")
    input_filename = (video.filename or "").strip() or "video"
    video_path = job_dir / input_filename
    save_upload_file(video, video_path)
    video_path = maybe_prepare_cropped_video(job_dir, video_path, crop_x, crop_y, crop_w, crop_h)

    output_dir_name = output_dir.strip() or "frames"
    output_path = job_dir / output_dir_name
    output_path.mkdir(parents=True, exist_ok=True)

    # 初始化 meta.json（状态：pending）
    initial_meta = {
        "job_id": job_id,
        "input_filename": input_filename,
        "message": "任务已创建，等待处理",
        "status": "pending",
        "progress": 0.0,
        "progress_message": "任务已创建",
    }
    save_job_meta("extract-frames", job_id, initial_meta, status="pending")

    # 启动后台任务
    background_tasks.add_task(
        _extract_frames_with_progress,
        job_id=job_id,
        video_path=video_path,
        start_sec=float(start_sec) if start_sec is not None else 0.0,
        end_sec=float(end_sec) if end_sec is not None else -1,
        n_fps=int(n_fps),
        output_path=output_path,
        output_dir_name=output_dir_name,
        input_filename=input_filename,
    )

    # 立即返回 job_id，前端开始轮询
    return {
        "job_id": job_id,
        "message": "任务已创建，正在后台处理",
        "status": "pending",
        "input_filename": input_filename,
    }


@app.post("/api/tasks/extract-single-frame")
async def api_extract_single_frame(
    video: UploadFile = File(...),
    timestamp: float = Form(...),
    crop_x: Optional[int] = Form(None),
    crop_y: Optional[int] = Form(None),
    crop_w: Optional[int] = Form(None),
    crop_h: Optional[int] = Form(None),
):
    """
    提取视频指定时刻的单帧图片。
    用户通过拖动进度条选择时刻，保存该时刻的原图。
    """
    import cv2

    job_id, job_dir = create_job_dir("extract-single-frame")
    video_path = job_dir / video.filename
    save_upload_file(video, video_path)

    try:
        # 打开视频文件
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise IOError("无法打开视频文件")

        # 获取视频属性
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 0

        # 验证时间戳有效性
        if timestamp < 0 or (duration > 0 and timestamp > duration):
            cap.release()
            raise ValueError(f"无效时间戳 (视频时长: {duration:.2f}秒)")

        # 将秒转换为帧号
        frame_number = int(timestamp * fps) if fps > 0 else 0
        frame_number = min(frame_number, total_frames - 1) if total_frames > 0 else 0

        # 定位到指定帧
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()

        if not ret:
            cap.release()
            raise ValueError("无法读取指定时刻的视频帧")

        # 可选：按用户框选区域裁剪帧（像素坐标，基于原始分辨率）
        if crop_x is not None and crop_y is not None and crop_w is not None and crop_h is not None:
            x = max(0, int(crop_x))
            y = max(0, int(crop_y))
            w = max(0, int(crop_w))
            h = max(0, int(crop_h))
            if w > 1 and h > 1:
                fh, fw = frame.shape[:2]
                if x < fw and y < fh:
                    w = min(w, fw - x)
                    h = min(h, fh - y)
                    if w > 1 and h > 1:
                        frame = frame[y : y + h, x : x + w]

        # 生成输出文件名
        filename = video_path.stem
        frame_filename = f"{filename}_frame_{timestamp:.2f}s.jpg"
        frame_path = job_dir / frame_filename

        # 保存帧图片
        cv2.imwrite(str(frame_path), frame)
        cap.release()

    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    file_url = build_file_url(frame_path)
    return {
        "message": f"已保存 {timestamp:.2f} 秒时刻的帧图片",
        "job_id": job_id,
        "files": [file_url],
        "previews": [file_url],
        "total_files": 1,
        "timestamp": timestamp,
    }


@app.post("/api/tasks/mp4-to-gif")
async def api_mp4_to_gif(
    video: UploadFile = File(...),
    start_sec: Optional[float] = Form(None),
    end_sec: Optional[float] = Form(None),
    color_depth: Optional[int] = Form(None),
    scale: Optional[float] = Form(None),
    crop_x: Optional[int] = Form(None),
    crop_y: Optional[int] = Form(None),
    crop_w: Optional[int] = Form(None),
    crop_h: Optional[int] = Form(None),
):
    if convert_mp4_to_gif is None:
        raise HTTPException(
            status_code=503, detail="GIF 转换功能暂时不可用，请稍后重试"
        )

    job_id, job_dir = create_job_dir("mp4-to-gif")
    video_path = job_dir / video.filename
    save_upload_file(video, video_path)
    video_path = maybe_prepare_cropped_video(job_dir, video_path, crop_x, crop_y, crop_w, crop_h)

    # 输出 GIF 文件名采用源视频名
    output_path = job_dir / f"{video_path.stem}.gif"

    # 归一化参数
    start = float(start_sec) if start_sec is not None else 0.0
    colors = int(color_depth) if color_depth is not None else 256
    scl = float(scale) if scale is not None else 1.0
    # 约束缩放范围（0.1, 1.0]
    if not (0.1 <= scl <= 1.0):
        scl = 1.0

    # mp4_to_gif 需要数值型 end_time；若未提供，则读取视频时长
    if end_sec is None:
        try:
            from moviepy import VideoFileClip as _VideoFileClip  # type: ignore

            clip = _VideoFileClip(str(video_path))
            end = float(clip.duration or 0.0)
            clip.close()
        except Exception:
            end = start  # 兜底：避免 None 传入
    else:
        end = float(end_sec)

    try:
        convert_mp4_to_gif(
            input_path=str(video_path),
            output_path=str(output_path),
            start_time=start,
            end_time=end,
            fps=None,  # 使用源视频帧率
            color_depth=colors,
            scale=scl,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    file_url = build_file_url(output_path)
    return {
        "message": "GIF 生成完成",
        "job_id": job_id,
        "files": [file_url],
        "previews": [file_url],
        "total_files": 1,
    }


@app.post("/api/tasks/images-download")
async def api_images_download(
    page_url: str = Form(...),
    save_path: str = Form("downloads"),
):
    job_id, job_dir = create_job_dir("images-download")
    target_dir = job_dir / (save_path.strip() or "downloads")
    try:
        download_images_from_url(page_url, str(target_dir))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    files = list(iter_files(target_dir))
    zip_path = job_dir / f"{target_dir.name}.zip"
    make_zip(target_dir, zip_path)
    files_urls = [build_file_url(file_path) for file_path in files]
    return {
        "message": f"下载完成，共 {len(files)} 张图片",
        "job_id": job_id,
        "archive": build_file_url(zip_path),
        "files": files_urls,
        "total_files": len(files_urls),
        "previews": files_urls,
    }


@app.post("/api/tasks/mp4-to-live-photo")
async def api_mp4_to_live_photo(
    video: UploadFile = File(...),
    output_prefix: str = Form(...),
    duration: Optional[float] = Form(None),
    keyframe_time: Optional[float] = Form(None),
    crop_x: Optional[int] = Form(None),
    crop_y: Optional[int] = Form(None),
    crop_w: Optional[int] = Form(None),
    crop_h: Optional[int] = Form(None),
):
    if convert_to_live_photo is None:
        raise HTTPException(
            status_code=503, detail="实况照片功能暂时不可用，请稍后重试"
        )

    job_id, job_dir = create_job_dir("mp4-to-live-photo")
    video_path = job_dir / video.filename
    save_upload_file(video, video_path)
    video_path = maybe_prepare_cropped_video(job_dir, video_path, crop_x, crop_y, crop_w, crop_h)

    prefix = job_dir / (output_prefix.strip() or "live_photo")
    prefix.parent.mkdir(parents=True, exist_ok=True)

    try:
        convert_to_live_photo(
            input_video=str(video_path),
            output_prefix=str(prefix),
            duration=float(duration) if duration is not None else 3.0,
            keyframe_time=float(keyframe_time) if keyframe_time is not None else 1.0,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    mov_path = Path(f"{prefix}.mov")
    jpg_path = Path(f"{prefix}.jpg")
    files = [mov_path, jpg_path]
    files_urls = [build_file_url(path) for path in files]

    return {
        "message": "实况照片生成完成",
        "job_id": job_id,
        "files": files_urls,
    }


@app.post("/api/tasks/network-scan")
async def api_network_scan(network_range: str = Form(...)):
    """
    局域网扫描：仅扫描用户显式提供的网段（CIDR），不再尝试自动识别本机网段。
    - 支持以逗号/空白分隔的多个 CIDR，例如： "192.168.1.0/24, 10.0.0.0/24"
    - 返回按类型分组的设备信息，同时保留 devices 扁平列表（向后兼容）。
    """
    try:
        cleaned = (network_range or "").strip()
        if not cleaned:
            raise ValueError("请输入扫描网段（CIDR），例如 192.168.1.0/24")
        # 拆分多个网段，支持逗号与空白
        parts = [p for p in (cleaned.replace(",", " ").split()) if p]
        if not parts:
            raise ValueError("请输入有效的 CIDR 网段，例如 192.168.1.0/24")
        result = scan_devices_in_ranges(parts)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    devices = result.get("devices", [])
    networks = result.get("networks", [])
    groups = result.get("groups", {})

    # 为前端提供更友好的中文分组名称
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
        grouped.append(
            {
                "key": key,
                "label": label_map.get(key, key),
                "count": len(items),
                "devices": [
                    {
                        "name": item.get("name"),
                        "ip": item.get("ip"),
                        "mac": item.get("mac"),
                        "hostname": item.get("hostname"),
                        "open_ports": item.get("open_ports", []),
                    }
                    for item in items
                ],
            }
        )

    return {
        "message": f"扫描完成，发现 {len(devices)} 台设备（{', '.join(networks) or '无效网段'}）",
        "networks": networks,
        "devices": devices,  # 保留：[{ip, mac, hostname?, open_ports?, category?, name?}]
        "groups": grouped,  # 新增：分组输出
    }


@app.post("/api/tasks/folder-split")
async def api_folder_split(
    source_dir: str = Form(...),
    file_extension: str = Form(...),
    num_folders: int = Form(...),
):
    source_path = Path(source_dir)
    if not source_path.is_absolute():
        source_path = (BASE_DIR / source_path).resolve()
    if not source_path.exists():
        raise HTTPException(status_code=404, detail="源目录不存在")

    try:
        distribute_files(str(source_path), file_extension, int(num_folders))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "message": "文件分配完成",
        "source_dir": str(source_path),
    }


@app.post("/api/tasks/url-to-mp4")
async def api_url_to_mp4(video_url: str = Form(...)):
    job_id, job_dir = create_job_dir("url-to-mp4")
    cwd = os.getcwd()
    try:
        os.chdir(job_dir)
        download_youtube_video(video_url)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        os.chdir(cwd)

    downloads_dir = job_dir / "Downloads"
    if not downloads_dir.exists():
        raise HTTPException(status_code=500, detail="未生成下载文件")

    zip_path = job_dir / "downloads.zip"
    make_zip(downloads_dir, zip_path)
    return {
        "message": "下载任务完成",
        "job_id": job_id,
        "archive": build_file_url(zip_path),
        "files": [build_file_url(path) for path in iter_files(downloads_dir)],
    }


@app.post("/api/tasks/url-to-qrcode")
async def api_url_to_qrcode(
    target_url: str = Form(...),
):
    """
    根据用户提交的网页链接生成二维码图片。
    返回可直接访问与预览的 PNG 文件 URL。
    """
    job_id, job_dir = create_job_dir("url-to-qrcode")
    png_path = job_dir / "qrcode.png"

    try:
        import qrcode  # type: ignore
        from qrcode.constants import ERROR_CORRECT_M  # type: ignore

        url = (target_url or "").strip()
        if not url:
            raise ValueError("请输入有效的链接地址")

        qr = qrcode.QRCode(
            version=None,
            error_correction=ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        img.save(png_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    file_url = build_file_url(png_path)
    return {
        "message": "二维码已生成，请扫描或下载图片",
        "job_id": job_id,
        "files": [file_url],
        "previews": [file_url],
        "total_files": 1,
    }


@app.post("/api/tasks/mp3-to-qrcode")
async def api_mp3_to_qrcode(
    request: Request,
    audio: UploadFile = File(...),
):
    """
    接收用户上传的 MP3 文件，保存并生成指向该文件的二维码。
    二维码内容为该音频文件的绝对访问 URL，扫码即可在手机端直接播放。
    """
    job_id, job_dir = create_job_dir("mp3-to-qrcode")
    audio_path = job_dir / audio.filename
    save_upload_file(audio, audio_path)

    # 基础校验：仅允许 .mp3
    if audio_path.suffix.lower() != ".mp3":
        raise HTTPException(status_code=400, detail="仅支持上传 .mp3 文件")

    # 构造音频的相对与绝对 URL
    audio_rel_url = build_file_url(audio_path)
    base_url = str(request.base_url).rstrip("/")
    # 播放页 URL（更友好的扫码播放界面）
    page_url = f"{base_url}/listen?file={quote(audio_rel_url, safe='')}&title={quote(audio.filename, safe='')}"

    # 生成二维码（PNG）
    png_path = job_dir / "qrcode.png"
    try:
        import qrcode  # type: ignore
        from qrcode.constants import ERROR_CORRECT_M  # type: ignore

        qr = qrcode.QRCode(
            version=None,
            error_correction=ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(page_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        img.save(png_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    qr_url = build_file_url(png_path)
    return {
        "message": "已生成扫码播放的二维码",
        "job_id": job_id,
        "files": [qr_url, audio_rel_url],  # 同时返回二维码与音频文件
        "previews": [qr_url],  # 结果预览展示二维码
        "audio_url": audio_rel_url,  # 便于前端可选显示
        "total_files": 2,
    }


@app.get("/listen")
def listen_page(
    request: Request, file: str, title: Optional[str] = None
) -> HTMLResponse:
    """
    简洁美观的音频播放页面。
    通过查询参数 `file`（应以 /files/ 开头的相对 URL）来定位音频文件。
    可选 `title` 指定页面标题/显示名。
    """
    try:
        cleaned = (file or "").strip()
        if not cleaned.startswith("/files/"):
            raise ValueError("非法文件路径")
        # 解析相对路径并校验物理文件存在
        rel = cleaned[len("/files/") :]
        audio_path = STORAGE_DIR / rel
        if not audio_path.exists() or not audio_path.is_file():
            raise FileNotFoundError("音频文件不存在")
        if audio_path.suffix.lower() != ".mp3":
            raise ValueError("仅支持 .mp3 文件")
    except Exception as exc:  # noqa: BLE001
        return HTMLResponse(
            content=f"<h1>无法播放</h1><p>{str(exc)}</p>",
            status_code=404,
        )

    base_url = str(request.base_url).rstrip("/")
    audio_url = f"{base_url}{cleaned}"
    display_title = (title or audio_path.stem).strip() or "音频播放"

    # 内联样式与播放页 HTML
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{display_title}</title>
    <meta name="theme-color" content="#111827" />
    <meta property="og:title" content="{display_title}" />
    <meta property="og:type" content="music.song" />
    <meta property="og:audio" content="{audio_url}" />
    <style>
      :root {{
        --bg: #0f172a;
        --card: #111827;
        --text: #e5e7eb;
        --muted: #9ca3af;
        --accent: #22d3ee;
        --accent2: #a78bfa;
      }}
      * {{ box-sizing: border-box; }}
      html, body {{ height: 100%; }}
      body {{
        margin: 0; background: linear-gradient(135deg, var(--bg), #0b1225);
        color: var(--text); font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji";
        display: grid; place-items: center; padding: 24px;
      }}
      .card {{
        width: min(720px, 100%);
        background: radial-gradient(1200px 400px at -10% -20%, rgba(34,211,238,0.12), transparent 60%),
                    radial-gradient(800px 300px at 120% 0%, rgba(167,139,250,0.12), transparent 60%),
                    var(--card);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 16px;
        padding: 28px 24px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      }}
      .title {{
        margin: 0 0 8px; font-size: 22px; font-weight: 700; letter-spacing: .3px;
      }}
      .subtitle {{
        margin: 0 0 20px; font-size: 14px; color: var(--muted);
      }}
      .player {{
        display: grid; gap: 16px;
      }}
      .cover {{
        width: 100%; aspect-ratio: 16/9; border-radius: 12px;
        background: linear-gradient(135deg, rgba(34,211,238,0.25), rgba(167,139,250,0.25));
        display: grid; place-items: center; color: rgba(255,255,255,0.8);
        border: 1px solid rgba(255,255,255,0.08);
        cursor: pointer; appearance: none; -webkit-appearance: none; outline: none; background-clip: padding-box;
      }}
      .cover-icon {{
        width: 56px; height: 56px;
        background: linear-gradient(135deg, var(--accent), var(--accent2));
        -webkit-mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill=\"%23fff\" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>') no-repeat center / 80% 80%;
        mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill=\"%23fff\" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>') no-repeat center / 80% 80%;
        border-radius: 12px;
      }}
      audio {{
        width: 100%;
        filter: drop-shadow(0 2px 8px rgba(0,0,0,0.25));
      }}
      .actions {{
        display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px;
      }}
      .btn {{
        padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04); color: var(--text); cursor: pointer;
        transition: transform .08s ease, background .2s ease, border-color .2s ease;
      }}
      .btn:hover {{ transform: translateY(-1px); background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.18); }}
      .link {{ text-decoration: none; color: inherit; }}
      .hint {{ font-size: 12px; color: var(--muted); margin-top: 8px; }}
    </style>
  </head>
  <body>
    <main class="card">
      <h1 class="title">{display_title}</h1>
      <p class="subtitle">扫码直达 · 简洁播放页</p>
      <section class="player">
        <button class="cover" id="coverPlay" type="button" aria-label="播放">
          <span class="cover-icon" aria-hidden="true"></span>
        </button>
        <audio id="player" controls preload="metadata" src="{audio_url}"></audio>
        <div class="actions">
          <a class="btn link" href="{audio_url}" download>下载音频</a>
          <button class="btn" id="copyLink">复制播放链接</button>
        </div>
        <p class="hint">如无法自动播放，请点击播放按钮或使用系统播放器打开。</p>
      </section>
    </main>
    <script>
      (function() {{
        const btn = document.getElementById('copyLink');
        if (btn && navigator.clipboard) {{
          btn.addEventListener('click', async () => {{
            try {{
              await navigator.clipboard.writeText('{audio_url}');
              btn.textContent = '已复制';
              setTimeout(() => (btn.textContent = '复制播放链接'), 1500);
            }} catch (e) {{
              btn.textContent = '复制失败';
              setTimeout(() => (btn.textContent = '复制播放链接'), 1500);
            }}
          }});
        }}
        /**
         * @description 点击封面按钮触发播放；播放时隐藏封面，暂停/结束时显示
         */
        const coverBtn = document.getElementById('coverPlay');
        const audioEl = document.getElementById('player');
        if (coverBtn && audioEl) {{
          coverBtn.addEventListener('click', () => {{
            audioEl.play().catch(() => {{}}); 
          }});
          const sync = () => {{
            coverBtn.style.display = audioEl.paused ? 'grid' : 'none';
          }};
          audioEl.addEventListener('play', sync);
          audioEl.addEventListener('pause', sync);
          audioEl.addEventListener('ended', sync);
          sync();
        }}
      }})();
    </script>
  </body>
</html>"""
    return HTMLResponse(content=html)


@app.post("/api/tasks/video-to-qrcode")
async def api_video_to_qrcode(
    request: Request,
    video: UploadFile = File(...),
    crop_x: Optional[int] = Form(None),
    crop_y: Optional[int] = Form(None),
    crop_w: Optional[int] = Form(None),
    crop_h: Optional[int] = Form(None),
):
    """
    接收用户上传的视频文件，保存并生成指向“美化观看页”的二维码。
    观看页地址形如 /watch?file=/files/.../xxx.mp4&title=...，扫码后直接播放。
    """
    job_id, job_dir = create_job_dir("video-to-qrcode")
    video_path = job_dir / video.filename
    save_upload_file(video, video_path)

    # 简单格式校验（常见视频后缀）
    valid_exts = {".mp4", ".mov", ".m4v", ".webm"}
    if video_path.suffix.lower() not in valid_exts:
        raise HTTPException(
            status_code=400, detail=f"仅支持视频文件（{', '.join(sorted(valid_exts))}）"
        )

    # 可选：按用户框选区域裁剪视频（像素坐标，基于原始分辨率）
    video_path = maybe_prepare_cropped_video(job_dir, video_path, crop_x, crop_y, crop_w, crop_h)

    # 构造视频相对 URL 与观看页 URL
    video_rel_url = build_file_url(video_path)
    base_url = str(request.base_url).rstrip("/")
    page_url = f"{base_url}/watch?file={quote(video_rel_url, safe='')}&title={quote(video.filename, safe='')}"

    # 生成二维码
    png_path = job_dir / "qrcode.png"
    try:
        import qrcode  # type: ignore
        from qrcode.constants import ERROR_CORRECT_M  # type: ignore

        qr = qrcode.QRCode(
            version=None,
            error_correction=ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(page_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        img.save(png_path)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    qr_url = build_file_url(png_path)
    return {
        "message": "已生成视频观看页二维码",
        "job_id": job_id,
        "files": [qr_url, video_rel_url],
        "previews": [qr_url],
        "video_url": video_rel_url,
        "total_files": 2,
    }


@app.get("/watch")
def watch_page(
    request: Request, file: str, title: Optional[str] = None
) -> HTMLResponse:
    """
    简洁美观的视频播放页面。
    通过查询参数 `file`（应以 /files/ 开头的相对 URL）来定位视频文件。
    可选 `title` 指定页面标题/显示名。
    """
    try:
        cleaned = (file or "").strip()
        if not cleaned.startswith("/files/"):
            raise ValueError("非法文件路径")
        rel = cleaned[len("/files/") :]
        video_path = STORAGE_DIR / rel
        if not video_path.exists() or not video_path.is_file():
            raise FileNotFoundError("视频文件不存在")
        if video_path.suffix.lower() not in {".mp4", ".mov", ".m4v", ".webm"}:
            raise ValueError("暂不支持该视频格式")
    except Exception as exc:  # noqa: BLE001
        return HTMLResponse(
            content=f"<h1>无法播放</h1><p>{str(exc)}</p>",
            status_code=404,
        )

    base_url = str(request.base_url).rstrip("/")
    video_url = f"{base_url}{cleaned}"
    display_title = (title or video_path.stem).strip() or "视频播放"

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{display_title}</title>
    <meta name="theme-color" content="#111827" />
    <meta property="og:title" content="{display_title}" />
    <meta property="og:type" content="video.other" />
    <meta property="og:video" content="{video_url}" />
    <style>
      :root {{
        --bg: #0f172a;
        --card: #111827;
        --text: #e5e7eb;
        --muted: #9ca3af;
        --accent: #22d3ee;
        --accent2: #a78bfa;
      }}
      * {{ box-sizing: border-box; }}
      html, body {{ height: 100%; }}
      body {{
        margin: 0; background: linear-gradient(135deg, var(--bg), #0b1225);
        color: var(--text); font-family: -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji";
        display: grid; place-items: center; padding: 24px;
      }}
      .card {{
        width: min(960px, 100%);
        background: radial-gradient(1200px 400px at -10% -20%, rgba(34,211,238,0.12), transparent 60%),
                    radial-gradient(800px 300px at 120% 0%, rgba(167,139,250,0.12), transparent 60%),
                    var(--card);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 16px;
        padding: 28px 24px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      }}
      .title {{
        margin: 0 0 8px; font-size: 22px; font-weight: 700; letter-spacing: .3px;
      }}
      .subtitle {{
        margin: 0 0 20px; font-size: 14px; color: var(--muted);
      }}
      .player {{ display: grid; gap: 16px; }}
      .stage {{
        border-radius: 12px; overflow: hidden; background: #000;
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 18px 36px rgba(0,0,0,0.35);
        position: relative;
      }}
      .fs-btn {{
        position: absolute; right: 10px; bottom: 10px;
        width: 36px; height: 36px; border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.18);
        background: rgba(0,0,0,0.35);
        cursor: pointer; backdrop-filter: blur(2px);
      }}
      .fs-btn:hover {{ background: rgba(0,0,0,0.5); }}
      .fs-btn::before {{
        content: ""; display: block; width: 100%; height: 100%;
        -webkit-mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill=\"%23fff\" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm0-4h3V7h2v5H7V7zm7 7h3v-3h2v5h-5v-2zm0-7V5h5v2h-3v3h-2z"/></svg>') no-repeat center / 70% 70%;
        mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill=\"%23fff\" viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm0-4h3V7h2v5H7V7zm7 7h3v-3h2v5h-5v-2zm0-7V5h5v2h-3v3h-2z"/></svg>') no-repeat center / 70% 70%;
        background: linear-gradient(135deg, var(--accent), var(--accent2));
      }}
      video {{ width: 100%; height: auto; display: block; background: #000; }}
      .actions {{ display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px; }}
      .btn {{
        padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12);
        background: rgba(255,255,255,0.04); color: var(--text); cursor: pointer;
        transition: transform .08s ease, background .2s ease, border-color .2s ease;
      }}
      .btn:hover {{ transform: translateY(-1px); background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.18); }}
      .link {{ text-decoration: none; color: inherit; }}
      .hint {{ font-size: 12px; color: var(--muted); margin-top: 8px; }}
    </style>
  </head>
  <body>
    <main class="card">
      <h1 class="title">{display_title}</h1>
      <p class="subtitle">扫码直达 · 简洁观看页</p>
      <section class="player">
        <div class="stage" id="stage">
          <video id="video" controls preload="metadata" playsinline src="{video_url}"></video>
          <button class="fs-btn" id="fsBtn" type="button" aria-label="全屏"></button>
        </div>
        <div class="actions">
          <a class="btn link" href="{video_url}" download>下载视频</a>
          <button class="btn" id="copyLink">复制观看链接</button>
        </div>
        <p class="hint">如无法自动播放，请点击播放按钮；iOS/Android 建议竖屏全屏播放。</p>
      </section>
    </main>
    <script>
      (function() {{
        const btn = document.getElementById('copyLink');
        if (btn && navigator.clipboard) {{
          btn.addEventListener('click', async () => {{
            try {{
              await navigator.clipboard.writeText('{video_url}');
              btn.textContent = '已复制';
              setTimeout(() => (btn.textContent = '复制观看链接'), 1500);
            }} catch (e) {{
              btn.textContent = '复制失败';
              setTimeout(() => (btn.textContent = '复制观看链接'), 1500);
            }}
          }});
        }}
        /**
         * @function requestFullscreenCompat
         * @description 以最大兼容性请求全屏（标准、WebKit、iOS）
         * @param {{HTMLVideoElement|HTMLElement}} el 目标元素
         * @returns {{Promise<void>}}
         */
        const requestFullscreenCompat = (el) => {{
          // iOS Safari（旧版）仅支持 video.webkitEnterFullscreen()
          if (el && typeof el.webkitEnterFullscreen === 'function') {{
            try {{ el.webkitEnterFullscreen(); }} catch (_e) {{ /* noop */ }}
            return Promise.resolve();
          }}
          const target = el.requestFullscreen ? el : (document.getElementById('stage') || el);
          const req = target.requestFullscreen
            || target.webkitRequestFullscreen
            || target.msRequestFullscreen
            || target.mozRequestFullScreen;
          return req ? Promise.resolve(req.call(target)) : Promise.resolve();
        }};

        const fsBtn = document.getElementById('fsBtn');
        const video = document.getElementById('video');
        if (fsBtn && video) {{
          fsBtn.addEventListener('click', () => requestFullscreenCompat(video));
        }}
      }})();
    </script>
  </body>
</html>"""
    return HTMLResponse(content=html)


@app.post("/api/tasks/yolo-json-to-txt")
async def api_yolo_json_to_txt(
    classes: str = Form(...),
    json_archive: Optional[UploadFile] = File(None),
):
    if json_archive is None:
        raise HTTPException(status_code=400, detail="请上传标注压缩包")

    job_id, job_dir = create_job_dir("yolo-json-to-txt")
    archive_path = job_dir / json_archive.filename
    save_upload_file(json_archive, archive_path)

    extracted_dir = extract_archive(archive_path, job_dir / "json_input")
    json_files = list(extracted_dir.rglob("*.json"))
    if not json_files:
        raise HTTPException(status_code=400, detail="压缩包中未找到 JSON 文件")

    labels_dir = job_dir / "labels"
    for json_file in json_files:
        decode_json(
            json_floder_path=str(json_file.parent),
            json_name=json_file.name,
            classes=classes,
            output_dir=str(labels_dir),
        )

    zip_path = job_dir / "labels.zip"
    make_zip(labels_dir, zip_path)
    return {
        "message": "转换完成",
        "job_id": job_id,
        "archive": build_file_url(zip_path),
        "files": [build_file_url(path) for path in iter_files(labels_dir)],
    }


@app.post("/api/tasks/yolo-label-vis")
async def api_yolo_label_vis(
    annotations_archive: Optional[UploadFile] = File(None),
    images_archive: Optional[UploadFile] = File(None),
    output_dir: str = Form("label_output"),
    suffix: str = Form("_annotated"),
    class_names: str = Form(""),
):
    if annotations_archive is None or images_archive is None:
        raise HTTPException(status_code=400, detail="请同时上传标注和图像压缩包")

    job_id, job_dir = create_job_dir("yolo-label-vis")
    ann_archive_path = job_dir / annotations_archive.filename
    img_archive_path = job_dir / images_archive.filename
    save_upload_file(annotations_archive, ann_archive_path)
    save_upload_file(images_archive, img_archive_path)

    annotations_dir = extract_archive(ann_archive_path, job_dir / "annotations")
    images_dir = extract_archive(img_archive_path, job_dir / "images")

    annotations_root = _find_first_dir_with_extension(annotations_dir, ".txt")
    images_root = _find_first_dir_with_extension(images_dir, None)
    if annotations_root is None:
        raise HTTPException(status_code=400, detail="标注压缩包中未找到 txt 文件")
    if images_root is None:
        raise HTTPException(status_code=400, detail="图片压缩包中未找到图像文件")

    output_path = job_dir / (output_dir.strip() or "label_output")
    classes_list: Optional[List[str]] = None
    cleaned = class_names.strip()
    if cleaned:
        classes_list = cleaned.split()

    try:
        process_all_annotations(
            annotations_dir=str(annotations_root),
            images_dir=str(images_root),
            output_dir=str(output_path),
            output_suffix=suffix,
            class_names=classes_list,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    zip_path = job_dir / "label_vis.zip"
    make_zip(output_path, zip_path)
    return {
        "message": "标注可视化完成",
        "job_id": job_id,
        "archive": build_file_url(zip_path),
        "files": [build_file_url(path) for path in iter_files(output_path)],
    }


@app.post("/api/tasks/yolo-write-img-path")
async def api_yolo_write_img_path(
    images_root: str = Form(...),
    image_sets_archive: Optional[UploadFile] = File(None),
    image_ext: str = Form(".jpg"),
):
    job_id, job_dir = create_job_dir("yolo-write-img-path")
    if image_sets_archive is None:
        raise HTTPException(status_code=400, detail="请上传 ImageSets 压缩包")

    archive_path = job_dir / image_sets_archive.filename
    save_upload_file(image_sets_archive, archive_path)
    extracted_dir = extract_archive(archive_path, job_dir / "image_sets")

    image_sets_dir = _find_first_dir_with_file(extracted_dir, "train.txt")
    if image_sets_dir is None:
        raise HTTPException(status_code=400, detail="压缩包中未找到 train.txt")

    output_dir = job_dir / "dataSet_path"
    try:
        generate_image_lists(
            image_sets_dir=str(image_sets_dir),
            output_dir=str(output_dir),
            images_root=images_root,
            image_ext=image_ext,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    zip_path = job_dir / "dataset_lists.zip"
    make_zip(output_dir, zip_path)
    return {
        "message": "路径文件生成完成",
        "job_id": job_id,
        "archive": build_file_url(zip_path),
        "files": [build_file_url(path) for path in iter_files(output_dir)],
    }


@app.post("/api/tasks/yolo-split-dataset")
async def api_yolo_split_dataset(
    xml_archive: Optional[UploadFile] = File(None),
    trainval_ratio: Optional[float] = Form(None),
    train_ratio: Optional[float] = Form(None),
):
    if xml_archive is None:
        raise HTTPException(status_code=400, detail="请上传 XML 压缩包")

    job_id, job_dir = create_job_dir("yolo-split-dataset")
    archive_path = job_dir / xml_archive.filename
    save_upload_file(xml_archive, archive_path)
    extracted_dir = extract_archive(archive_path, job_dir / "annotations")

    xml_dir = _find_first_dir_with_extension(extracted_dir, ".xml")
    if xml_dir is None:
        raise HTTPException(status_code=400, detail="压缩包中未找到 XML 文件")

    output_dir = job_dir / "ImageSets" / "Main"
    try:
        split_dataset(
            xml_path=str(xml_dir),
            txt_path=str(output_dir),
            trainval_percent=(
                float(trainval_ratio) if trainval_ratio is not None else 0.9
            ),
            train_percent=float(train_ratio) if train_ratio is not None else 0.9,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    zip_path = job_dir / "imagesets.zip"
    make_zip(output_dir.parent, zip_path)
    return {
        "message": "数据集划分完成",
        "job_id": job_id,
        "archive": build_file_url(zip_path),
        "files": [build_file_url(path) for path in iter_files(output_dir)],
    }


def _find_first_dir_with_extension(
    root: Path, extension: Optional[str]
) -> Optional[Path]:
    for path in root.rglob("*"):
        if path.is_file():
            if extension is None:
                return path.parent
            if path.suffix.lower() == extension.lower():
                return path.parent
    return None


def _find_first_dir_with_file(root: Path, filename: str) -> Optional[Path]:
    for path in root.rglob(filename):
        if path.is_file():
            return path.parent
    return None


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
