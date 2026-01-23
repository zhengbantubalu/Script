"""后端通用工具函数。"""

from __future__ import annotations

import os
import shutil
import tarfile
import uuid
import zipfile
import subprocess
from pathlib import Path
from typing import Iterable, Tuple, Optional

import cv2

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = Path(__file__).resolve().parent / "storage"
TEMP_DIR = STORAGE_DIR / "tmp"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)


def create_job_dir(module_id: str) -> Tuple[str, Path]:
    """创建模块专属的作业目录。"""

    job_id = uuid.uuid4().hex
    job_dir = STORAGE_DIR / module_id / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_id, job_dir


def save_upload_file(upload_file, destination: Path) -> Path:
    """保存上传文件到目标路径。"""

    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload_file.file, buffer)
    return destination


def extract_archive(archive_path: Path, target_dir: Path) -> Path:
    """解压 zip 或 tar 包到指定目录。返回实际解压目录。"""

    target_dir.mkdir(parents=True, exist_ok=True)
    if zipfile.is_zipfile(archive_path):
        with zipfile.ZipFile(archive_path, "r") as zf:
            zf.extractall(target_dir)
    elif tarfile.is_tarfile(archive_path):
        with tarfile.open(archive_path, "r:*") as tf:
            tf.extractall(target_dir)
    else:
        raise ValueError("仅支持 zip 或 tar 格式的压缩文件")
    return target_dir


def make_zip(source_dir: Path, zip_path: Path) -> Path:
    """将目录压缩为 zip 文件。"""

    zip_path.parent.mkdir(parents=True, exist_ok=True)
    base_name = str(zip_path.with_suffix(""))
    shutil.make_archive(base_name, "zip", source_dir)
    return zip_path


def iter_files(directory: Path) -> Iterable[Path]:
    """遍历目录内的文件。"""

    for root, _, files in os.walk(directory):
        for file_name in files:
            yield Path(root) / file_name


def build_file_url(file_path: Path) -> str:
    """根据文件路径构造静态访问 URL。"""

    relative = file_path.relative_to(STORAGE_DIR)
    return f"/files/{relative.as_posix()}"


def get_video_size(video_path: Path) -> Tuple[int, int]:
    """
    获取视频宽高（像素）。

    使用 OpenCV 读取视频元信息；若失败则抛出异常。
    """

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        cap.release()
        raise IOError("无法打开视频文件以读取尺寸")
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()
    if w <= 0 or h <= 0:
        raise ValueError("无法读取有效的视频尺寸")
    return w, h


def _normalize_crop(
    video_w: int,
    video_h: int,
    crop_x: int,
    crop_y: int,
    crop_w: int,
    crop_h: int,
) -> Optional[Tuple[int, int, int, int]]:
    """
    规范化裁剪参数：裁剪框限制在视频范围内，并对齐到偶数像素（提升编码兼容性）。
    返回 (x, y, w, h)，若无效则返回 None。
    """

    x = max(0, int(crop_x))
    y = max(0, int(crop_y))
    w = max(0, int(crop_w))
    h = max(0, int(crop_h))

    if w <= 1 or h <= 1:
        return None

    # 裁剪到边界内
    if x >= video_w or y >= video_h:
        return None
    w = min(w, video_w - x)
    h = min(h, video_h - y)

    # 对齐到偶数像素（yuv420p 常见要求）
    x = x - (x % 2)
    y = y - (y % 2)
    w = w - (w % 2)
    h = h - (h % 2)

    if w <= 1 or h <= 1:
        return None
    if x + w > video_w:
        w = (video_w - x) - ((video_w - x) % 2)
    if y + h > video_h:
        h = (video_h - y) - ((video_h - y) % 2)
    if w <= 1 or h <= 1:
        return None

    return x, y, w, h


def crop_video_ffmpeg(
    input_path: Path,
    output_path: Path,
    crop_x: int,
    crop_y: int,
    crop_w: int,
    crop_h: int,
) -> Path:
    """
    使用 ffmpeg 对视频进行 ROI 裁剪并输出到 output_path。

    注意：裁剪会导致视频重新编码（为了最大兼容性，使用 libx264 + yuv420p）。
    """

    output_path.parent.mkdir(parents=True, exist_ok=True)
    crop_filter = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}"
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vf",
        crop_filter,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return output_path


def maybe_prepare_cropped_video(
    job_dir: Path,
    video_path: Path,
    crop_x: Optional[int],
    crop_y: Optional[int],
    crop_w: Optional[int],
    crop_h: Optional[int],
) -> Path:
    """
    若用户提供 crop_x/crop_y/crop_w/crop_h，则先生成裁剪后的视频文件并返回新路径；否则返回原路径。
    """

    if crop_x is None or crop_y is None or crop_w is None or crop_h is None:
        return video_path

    vw, vh = get_video_size(video_path)
    normalized = _normalize_crop(vw, vh, crop_x, crop_y, crop_w, crop_h)
    if normalized is None:
        return video_path
    x, y, w, h = normalized

    out_path = job_dir / f"{video_path.stem}__crop_{x}_{y}_{w}_{h}.mp4"
    try:
        crop_video_ffmpeg(video_path, out_path, x, y, w, h)
    except Exception:
        # 若 ffmpeg 不可用或裁剪失败，回退使用原视频，避免影响主流程
        return video_path
    return out_path

