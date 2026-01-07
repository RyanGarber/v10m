Priority:
- Workers not exiting on failure in apps/web
- - Promisify jobs & SpawnChildProcess to simplify logic flow?

Other:
- Add VPN option
- Use progress from yt-dlp stderr?

Security:
- Check for symlinks on upload
- Check filesize, duration, resolution; use ulimit or timeout
- Add -allowed_extensions and -protocol_whitelist to ffmpeg
- [?] disable libavdevice and avisynth in ffmpeg