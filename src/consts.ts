export const FFMPEG_NVIDIA_ARGS = {
  INPUT: '-hwaccel cuda -hwaccel_output_format cuda -extra_hw_frames 8',
  OUTPUT: '-c:v h264_nvenc',
};
export const FFMPEG_AUDIO_BITRATE = 128;
export const FFMPEG_VIDEO_BITRATE_BUFFER = 0.05;
export const FFMPEG_VIDEO_BITRATE_DEFAULT = 2500;
export const WEB_UPLOAD_CLEANUP_MS = 150000;
