"""
从视频中提取指定时间点的单帧图像并保存。

该脚本读取一个包含时间节点的txt文件（或文件夹中的所有txt文件），
从视频中提取对应时间点的帧，并保存到指定的输出路径。
"""
import cv2
import os
import argparse
from typing import List, Tuple


def parse_time_string(time_str: str) -> float:
    """
    将 hour:min:second 格式的时间字符串转换为秒数。
    
    @param time_str: 时间字符串，格式为 hour:min:second（例如 "1:23:45"）
    @return: 对应的秒数
    """
    parts = time_str.split(':')
    if len(parts) != 3:
        raise ValueError(f"时间格式错误，应为 hour:min:second，实际为: {time_str}")
    
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2])
        
        if hours < 0 or minutes < 0 or minutes >= 60 or seconds < 0 or seconds >= 60:
            raise ValueError(f"时间值超出有效范围: {time_str}")
        
        total_seconds = hours * 3600 + minutes * 60 + seconds
        return float(total_seconds)
    except ValueError as e:
        raise ValueError(f"无法解析时间字符串: {time_str}, 错误: {e}")


def format_time_string(seconds: float) -> str:
    """
    将秒数转换为 hour:min:second 格式的字符串。
    
    @param seconds: 秒数（整数）
    @return: hour:min:second 格式的字符串
    """
    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours}:{minutes:02d}:{secs:02d}"


def parse_timestamps(txt_path: str) -> List[Tuple[float, str]]:
    """
    从txt文件中解析时间节点。
    
    @param txt_path: txt文件路径，每行包含一个时间节点（格式：hour:min:second）
    @return: 时间节点列表，每个元素为 (秒数, 原始时间字符串) 的元组
    """
    timestamps = []
    if not os.path.isfile(txt_path):
        raise FileNotFoundError(f"时间节点文件不存在: {txt_path}")
    
    with open(txt_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line or line.startswith('#'):  # 跳过空行和注释行
                continue
            
            try:
                timestamp_seconds = parse_time_string(line)
                if timestamp_seconds < 0:
                    print(f"警告: 第 {line_num} 行的时间节点为负数，已跳过: {line}")
                    continue
                timestamps.append((timestamp_seconds, line))
            except ValueError as e:
                print(f"警告: 第 {line_num} 行无法解析时间格式，已跳过: {line} ({e})")
                continue
    
    # 去重并排序（按秒数排序）
    timestamps = sorted(set(timestamps), key=lambda x: x[0])
    return timestamps


def get_txt_files(input_path: str) -> List[str]:
    """
    获取txt文件列表。如果输入是文件，返回包含该文件的列表；如果是文件夹，返回所有txt文件。
    
    @param input_path: 输入路径（文件或文件夹）
    @return: txt文件路径列表
    """
    txt_files = []
    
    if os.path.isfile(input_path):
        # 如果是文件，检查是否为txt文件
        if input_path.lower().endswith('.txt'):
            txt_files.append(input_path)
        else:
            raise ValueError(f"输入文件不是txt格式: {input_path}")
    elif os.path.isdir(input_path):
        # 如果是文件夹，遍历所有txt文件
        for root, dirs, files in os.walk(input_path):
            for file in files:
                if file.lower().endswith('.txt'):
                    txt_files.append(os.path.join(root, file))
        
        if not txt_files:
            raise ValueError(f"文件夹中没有找到txt文件: {input_path}")
    else:
        raise FileNotFoundError(f"输入路径不存在: {input_path}")
    
    return sorted(txt_files)


def extract_frames_by_timestamps(video_path: str, txt_path: str, output_dir: str):
    """
    从视频中提取指定时间点的帧并保存。
    
    @param video_path: 输入视频文件路径
    @param txt_path: 包含时间节点的txt文件路径
    @param output_dir: 输出目录路径
    """
    # 检查视频文件是否存在
    if not os.path.isfile(video_path):
        raise FileNotFoundError(f"视频文件不存在: {video_path}")
    
    # 解析时间节点
    timestamps = parse_timestamps(txt_path)
    if not timestamps:
        print(f"警告: 时间节点文件为空或没有有效的时间节点: {txt_path}")
        return 0, 0
    
    time_strings = [ts[1] for ts in timestamps]
    print(f"\n处理文件: {os.path.basename(txt_path)}")
    print(f"读取到 {len(timestamps)} 个时间节点: {time_strings}")
    
    # 创建输出目录
    os.makedirs(output_dir, exist_ok=True)
    
    # 打开视频文件
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"无法打开视频文件: {video_path}")
    
    # 获取视频属性
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if fps > 0 else 0
    
    print(f"视频信息: {total_frames} 帧, FPS: {fps:.2f}, 时长: {duration:.2f}秒")
    
    # 获取视频文件名（不含扩展名）用于生成输出文件名
    video_basename = os.path.splitext(os.path.basename(video_path))[0]
    
    saved_count = 0
    skipped_count = 0
    
    # 遍历每个时间节点
    for timestamp_seconds, time_string in timestamps:
        # 验证时间节点是否在视频时长范围内
        if timestamp_seconds > duration:
            print(f"警告: 时间节点 {time_string} ({timestamp_seconds}秒) 超出视频时长 ({duration:.2f}秒)，已跳过")
            skipped_count += 1
            continue
        
        # 将时间转换为帧号（精确到秒，取该秒的第一帧）
        frame_number = int(timestamp_seconds * fps)
        if frame_number >= total_frames:
            frame_number = total_frames - 1
        
        # 定位到指定帧
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
        ret, frame = cap.read()
        
        if not ret:
            print(f"警告: 无法读取时间节点 {time_string} ({timestamp_seconds}秒) 对应的帧，已跳过")
            skipped_count += 1
            continue
        
        # 生成输出文件名：视频名_时间戳.jpg（使用原始时间字符串，替换冒号为下划线）
        safe_time_string = time_string.replace(':', '_')
        output_filename = f"{video_basename}_{safe_time_string}.jpg"
        output_path = os.path.join(output_dir, output_filename)
        
        # 保存帧
        success = cv2.imwrite(output_path, frame)
        if success:
            print(f"已保存: {output_filename} (时间节点: {time_string}, 帧号: {frame_number})")
            saved_count += 1
        else:
            print(f"错误: 无法保存帧到 {output_path}")
            skipped_count += 1
    
    cap.release()
    
    print(f"完成! 共保存 {saved_count} 张图像到: {output_dir}")
    if skipped_count > 0:
        print(f"警告: 跳过了 {skipped_count} 个时间节点")
    
    return saved_count, skipped_count


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="从视频中提取指定时间点的单帧图像",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )
    parser.add_argument(
        "--video_path",
        type=str,
        required=True,
        help="输入视频文件路径"
    )
    parser.add_argument(
        "--txt_path",
        type=str,
        required=True,
        help="包含时间节点的txt文件路径或文件夹路径（每行一个时间节点，格式：hour:min:second，例如 1:23:45）。如果是文件夹，将遍历所有txt文件"
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        required=True,
        help="输出目录路径。如果处理多个txt文件，每个txt文件的输出将保存在以txt文件名命名的子目录中"
    )
    
    args = parser.parse_args()
    
    try:
        # 获取所有txt文件
        txt_files = get_txt_files(args.txt_path)
        print(f"找到 {len(txt_files)} 个txt文件")
        
        total_saved = 0
        total_skipped = 0
        
        # 处理每个txt文件
        for txt_file in txt_files:
            # 如果处理多个文件，为每个txt文件创建单独的输出子目录
            if len(txt_files) > 1:
                txt_basename = os.path.splitext(os.path.basename(txt_file))[0]
                txt_output_dir = os.path.join(args.output_dir, txt_basename)
            else:
                txt_output_dir = args.output_dir
            
            try:
                saved, skipped = extract_frames_by_timestamps(
                    video_path=args.video_path,
                    txt_path=txt_file,
                    output_dir=txt_output_dir
                )
                total_saved += saved
                total_skipped += skipped
            except Exception as e:
                print(f"处理文件 {txt_file} 时出错: {str(e)}")
                continue
        
        print(f"\n{'='*60}")
        print(f"全部完成! 共处理 {len(txt_files)} 个txt文件")
        print(f"总计保存 {total_saved} 张图像")
        if total_skipped > 0:
            print(f"总计跳过 {total_skipped} 个时间节点")
        print(f"{'='*60}")
        
    except Exception as e:
        print(f"错误: {str(e)}")
        exit(1)

