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
 * @property {string} [endpoint] 提交 API
 * @property {ModuleField[]} [fields] 表单字段
 * @property {ModuleGuide} [guide] 使用提示
 * @property {string} [externalUrl] 外部链接地址（如果提供，点击后直接跳转到该链接）
 */

/**
 * 模块信息集合，涵盖当前目录下的 Python 脚本。
 * @type {Module[]}
 */
export const MODULES = [
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
    description: "提供目标网址与存储目录后，后台脚本 `images_download.py` 会抓取页面上的图片。",
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
    description: "支持两种输入模态：网址链接（生成访问二维码）或 MP3 文件（生成美化播放页二维码）。",
    endpoint: "/api/tasks/url-to-qrcode",
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
    summary: "按指定网段（CIDR）扫描在线设备。",
    description:
      "请输入要扫描的局域网网段（CIDR），例如 192.168.1.0/24。本功能仅根据用户输入的网段执行扫描，不再尝试自动识别或访问“用户所在的网段”。",
    endpoint: "/api/tasks/network-scan",
    tags: [
      { id: "network", label: "网络" },
      { id: "scapy", label: "Scapy" }
    ],
    fields: [
      {
        id: "network_range",
        type: "text",
        label: "扫描网段（CIDR）",
        placeholder: "如 192.168.1.0/24 或 10.0.0.0/24",
        required: true,
        description: "可输入多个网段，使用逗号或空格分隔；仅扫描你填写的网段。"
      }
    ],
    guide: {
      title: "安全提示",
      tips: ["仅在授权的内网环境中使用，避免对他人网络造成干扰。", "部分设备可能关闭 ARP 响应，如需更全列表可多次扫描。"]
    }
  },
  {
    id: "folder-split",
    name: "批量文件分拣",
    summary: "将同类文件平均分配到多个子文件夹。",
    description: "`split-files.py` 支持按扩展名对目录内文件均分，适合分发标注任务。",
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
    summary:
      "支持 YouTube、bilibili 及其他由 yt-dlp 支持的视频链接下载（尝试兼容咪咕等国内平台）。",
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
      tips: ["仅下载有权限的公开视频，遵守平台使用条款。", "部分站点需额外登录或 Cookie，暂不支持。"]
    }
  },
  {
    id: "yolo-json-to-txt",
    name: "YOLO 标注转换",
    summary: "批量将 LabelMe JSON 转为 YOLO 标签。",
    description: "借助 `yolo/json_to_yolo.py`，上传 JSON 数据集并指定类别即可自动生成 YOLO 标签文件。",
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
    description: "脚本 `yolo/label_vis.py` 会读取标签文件与原图，输出带框的调试图像。",
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
    description: "`yolo/write_img_path.py` 根据 `ImageSets/Main` 与配置生成 `train/val/test` 路径文件。",
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
      tips: ["会在 `dataSet_path/` 下输出 train/val/test 三个列表。", "脚本默认类别配置如需修改，请在提交参数中同步更新。"]
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
      tips: ["最终会生成 train.txt、val.txt、trainval.txt、test.txt。", "若需固定随机种子，请联系管理员在后端扩展。"]
    }
  },
  {
    id: "scholar-search",
    name: "学术搜索",
    summary: "聚合检索 OpenAlex + Crossref + arXiv，让科研更高效。",
    description: "ScholarSearch 是一个强大的学术文献搜索平台，支持多数据源检索和智能推荐。",
    tags: [
      { id: "search", label: "学术搜索" },
      { id: "research", label: "科研工具" }
    ],
    externalUrl: "http://47.93.189.31:3000/"
  }
];

