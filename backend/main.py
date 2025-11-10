"""脚本工具箱后端服务。"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .utils import (
    BASE_DIR,
    STORAGE_DIR,
    build_file_url,
    create_job_dir,
    extract_archive,
    iter_files,
    make_zip,
    save_upload_file,
)

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
from scripts.scan import (  # noqa: E402
    get_my_ip,
    get_network_range,
    scan_network,
    scan_lan_devices,
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


@app.post("/api/tasks/extract-frames")
async def api_extract_frames(
    video: UploadFile = File(...),
    start_sec: Optional[float] = Form(None),
    end_sec: Optional[float] = Form(None),
    n_fps: int = Form(...),
    output_dir: str = Form("frames"),
):
    job_id, job_dir = create_job_dir("extract-frames")
    video_path = job_dir / video.filename
    save_upload_file(video, video_path)

    output_dir_name = output_dir.strip() or "frames"
    output_path = job_dir / output_dir_name

    try:
        saved = extract_frames(
            video_path=str(video_path),
            start_sec=float(start_sec) if start_sec is not None else 0.0,
            end_sec=float(end_sec) if end_sec is not None else -1,
            n_fps=int(n_fps),
            output_dir=str(output_path),
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    files = sorted(iter_files(output_path))
    if not files:
        raise HTTPException(status_code=500, detail="未生成任何图像文件")

    zip_path = job_dir / f"{output_dir_name}.zip"
    make_zip(output_path, zip_path)

    files_urls = [build_file_url(file_path) for file_path in files]
    preview_limit = 8
    previews = files_urls[:preview_limit]

    return {
        "message": f"抽帧完成，共生成 {saved} 张图片",
        "job_id": job_id,
        "archive": build_file_url(zip_path),
        "files": files_urls,
        "total_files": len(files_urls),
        "previews": previews,
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
):
    if convert_to_live_photo is None:
        raise HTTPException(status_code=503, detail="实况照片功能暂时不可用，请稍后重试")

    job_id, job_dir = create_job_dir("mp4-to-live-photo")
    video_path = job_dir / video.filename
    save_upload_file(video, video_path)

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
async def api_network_scan(placeholder: Optional[str] = Form(None)):
    """
    局域网扫描：忽略入参，自动识别本机所有活跃网段并扫描。
    返回按类型分组的设备信息，同时保留 devices 扁平列表（向后兼容）。
    """
    result = scan_lan_devices()
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
        "message": f"扫描完成，发现 {len(devices)} 台设备（{', '.join(networks) or '未知网段'}）",
        "networks": networks,
        "devices": devices,  # 保留：[{ip, mac, hostname?, open_ports?, category?, name?}]
        "groups": grouped,   # 新增：分组输出
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
    audio_abs_url = f"{base_url}{audio_rel_url}"

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
        qr.add_data(audio_abs_url)
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
        "previews": [qr_url],              # 结果预览展示二维码
        "audio_url": audio_rel_url,        # 便于前端可选显示
        "total_files": 2,
    }


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
            trainval_percent=float(trainval_ratio) if trainval_ratio is not None else 0.9,
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


def _find_first_dir_with_extension(root: Path, extension: Optional[str]) -> Optional[Path]:
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

