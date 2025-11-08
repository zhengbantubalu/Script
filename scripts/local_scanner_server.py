from __future__ import annotations

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 复用现有扫描逻辑
from .scan import scan_lan_devices

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
    """
    触发一次本机所在局域网的扫描，输出结构与后端 /api/tasks/network-scan 尽量保持一致：
    {
        "message": "...",
        "networks": [...],
        "devices": [...],
        "groups": [
            { "key": "camera", "label": "摄像头", "count": N, "devices": [...] },
            ...
        ]
    }
    """
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
        "message": f"本地扫描完成，发现 {len(devices)} 台设备（{', '.join(networks) or '未知网段'}）",
        "networks": networks,
        "devices": devices,
        "groups": grouped,
    }


if __name__ == "__main__":
    # 默认监听本机回环端口
    uvicorn.run("scripts.local_scanner_server:app", host="127.0.0.1", port=47832, reload=False)


