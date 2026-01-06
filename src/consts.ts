export const FFMPEG_NVIDIA_ARGS = {
  INPUT: '-hwaccel cuda -hwaccel_output_format cuda -extra_hw_frames 8',
  OUTPUT: '-c:v h264_nvenc',
};

export const FFMPEG_AUDIO_BITRATE = 128;
export const FFMPEG_VIDEO_BITRATE_BUFFER = 0.05;

export const WEB_TARGET_SIZE_LIST = [10, 25, 50, 100];
export const WEB_DEFAULT_DOWNLOAD_FILENAME = 'v10m-download';