export const NVIDIA_FFMPEG_ARGS = {
  INPUT: '-hwaccel cuda -hwaccel_output_format cuda -extra_hw_frames 8',
  OUTPUT: '-c:v h264_nvenc',
};
