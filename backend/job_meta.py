"""任务元数据读写工具，临时解决方案，后续考虑引入数据库"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from .utils import STORAGE_DIR


def save_job_meta(
    module_id: str,
    job_id: str,
    payload: Mapping[str, Any],
    status: str = "success",
) -> Path:
    """将任务结果保存为 meta.json，便于后续查询/恢复。"""

    job_dir = STORAGE_DIR / module_id / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    meta_path = job_dir / "meta.json"

    data = dict(payload)
    data.setdefault("job_id", job_id)
    data.setdefault("module_id", module_id)
    data.setdefault("status", status)

    created_at = data.get("created_at")
    if not isinstance(created_at, str) or not created_at.strip():
        created_at = datetime.now(timezone.utc).isoformat()
    data["created_at"] = created_at

    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return meta_path


def update_job_progress(
    module_id: str,
    job_id: str,
    progress: float,
    message: str | None = None,
    status: str | None = None,
) -> Path:
    """
    更新任务进度（原子写入，避免并发冲突）。
    
    Args:
        module_id: 模块 ID
        job_id: 任务 ID
        progress: 进度百分比 (0.0-100.0)
        message: 可选的状态消息
        status: 可选的状态（pending/running/success/failed）
    """
    job_dir = STORAGE_DIR / module_id / job_id
    meta_path = job_dir / "meta.json"
    
    # 读取现有数据（如果存在）
    data = {}
    if meta_path.exists():
        with meta_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    
    # 更新进度和状态
    data["progress"] = max(0.0, min(100.0, float(progress)))
    if message is not None:
        data["progress_message"] = str(message)
    if status is not None:
        data["status"] = str(status)
    
    # 确保必要字段存在
    data.setdefault("job_id", job_id)
    data.setdefault("module_id", module_id)
    if "created_at" not in data:
        data["created_at"] = datetime.now(timezone.utc).isoformat()
    
    # 原子写入
    with meta_path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    return meta_path


def load_job_meta(module_id: str, job_id: str) -> dict:
    """读取指定任务的 meta.json。"""

    meta_path = STORAGE_DIR / module_id / job_id / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(f"任务 {module_id}/{job_id} 不存在或已过期")
    with meta_path.open("r", encoding="utf-8") as f:
        return json.load(f)
