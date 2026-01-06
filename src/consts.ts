export const NVIDIA_FFMPEG_ARGS = {
  INPUT: '-hwaccel cuda -hwaccel_output_format cuda -extra_hw_frames 8',
  OUTPUT: '-c:v h264_nvenc',
};

export const FFMPEG_AUDIO_BITRATE = 128; // 128 kbps
export const FFMPEG_VIDEO_BITRATE_BUFFER = 0.05; // 5%