from moviepy import VideoFileClip
import os
from PIL import Image

def mp4_to_gif(input_path, output_path, start_time, end_time, fps=None, color_depth=256, scale=1.0):
    # 检查输入文件是否存在
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"输入文件 {input_path} 不存在")
    
    # 检查输出目录是否存在，如果不存在则创建
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    try:
        # 使用 MoviePy 加载视频
        clip = VideoFileClip(input_path)
        
        # 计算时间范围
        if end_time > clip.duration:
            end_time = clip.duration
        
        if start_time > end_time:
            print("开始时间不能大于结束时间，将使用整个视频")
            start_time = 0
            end_time = clip.duration
            
        # 将剪辑后的视频转换为 GIF
        # 使用 PIL 写入 GIF，可以更好地控制颜色和优化
        frames = []
        
        # 自动使用源视频帧率（若未显式指定）
        fps_value = None
        try:
            fps_value = float(fps) if fps is not None else float(clip.fps)
            if not (fps_value and fps_value > 0):
                fps_value = 10.0
        except Exception:
            fps_value = 10.0

        # 直接使用 get_frame 采样，无需创建子剪辑
        for t in range(int(start_time * fps_value), int(end_time * fps_value)):
            frame_time = t / fps_value
            if frame_time >= clip.duration:
                break
            frame = clip.get_frame(frame_time)
            # 将每一帧转换为 PIL 图像
            img = Image.fromarray(frame)
            # 按比例缩放（如需要）
            try:
                s = float(scale) if scale is not None else 1.0
            except Exception:
                s = 1.0
            s = max(0.1, min(1.0, s))
            if s != 1.0:
                new_w = max(1, int(img.width * s))
                new_h = max(1, int(img.height * s))
                resample = getattr(Image, "Resampling", Image).__dict__.get("LANCZOS", Image.LANCZOS)
                img = img.resize((new_w, new_h), resample=resample)
            frames.append(img)
        
        # 保存为 GIF
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            duration=int(1000 / fps_value),  # 每帧显示时间(毫秒)
            loop=0,  # 无限循环
            palette=Image.Palette.ADAPTIVE,  # 自动生成调色板
            optimize=True,
            colors=color_depth
        )
        
        print(f"GIF 已成功保存到 {output_path}")
        
    except Exception as e:
        print(f"转换过程中出错: {e}")
        raise

def main(start_time, end_time, fps, color_depth):
    # 将 Tkinter 相关依赖延迟导入，避免在无图形环境下导入失败
    import tkinter as tk  # type: ignore
    from tkinter import filedialog, messagebox  # type: ignore

    # 创建主窗口
    root = tk.Tk()
    root.withdraw()  # 隐藏主窗口
    
    # 获取输入文件路径
    input_path = filedialog.askopenfilename(
        title="选择输入的 MP4 文件",
        filetypes=[("MP4 文件", "*.mp4"), ("所有文件", "*.*")]
    )
    
    if not input_path:
        messagebox.showwarning("警告", "没有选择输入文件")
        return
    
    # 获取输出文件路径
    output_path = filedialog.asksaveasfilename(
        title="选择输出的 GIF 文件",
        defaultextension=".gif",
        filetypes=[("GIF 文件", "*.gif"), ("所有文件", "*.*")]
    )
    
    if not output_path:
        messagebox.showwarning("警告", "没有选择输出文件")
        return
    
    # 显示转换信息
    messagebox.showinfo("开始转换", f"将从 {input_path} 转换到 {output_path}")
    
    # 若未提供 end_time，则以视频总时长为结束时间
    if end_time is None:
        try:
            clip = VideoFileClip(input_path)
            end_time = clip.duration
            clip.close()
        except Exception:
            end_time = 0

    # 执行转换
    try:
        mp4_to_gif(input_path, output_path, start_time, end_time, fps, color_depth)
        messagebox.showinfo("转换成功", f"GIF 已成功保存到 {output_path}")
    except Exception as e:
        messagebox.showerror("转换失败", f"转换过程中出错: {str(e)}")

if __name__ == "__main__":
    import argparse
    # 设置命令行参数
    parser = argparse.ArgumentParser(description='将 MP4 视频转换为 GIF')
    # parser.add_argument('--input', help='输入的 MP4 文件路径')
    # parser.add_argument('--output', help='输出的 GIF 文件路径')
    parser.add_argument('--start', type=float, default=0.0, help='开始时间(秒)')
    parser.add_argument('--end', type=float, default=None, help='结束时间(秒)')
    parser.add_argument('--fps', type=int, default=10, help='输出 GIF 的帧率')
    parser.add_argument('--color_depth', type=int, default=256, help='输出 GIF 的颜色深度')
    
    args = parser.parse_args()

    # 调用转换函数
    # mp4_to_gif(args.input, args.output, args.start, args.end, args.fps, args.color_depth)
    main(args.start, args.end, args.fps, args.color_depth)