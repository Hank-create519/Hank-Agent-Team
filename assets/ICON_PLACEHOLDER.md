# 应用图标占位目录

本目录用于存放打包所需的资源文件（electron-builder 的 `buildResources` 指向此处）。

- **Windows**：放置 `icon.ico`（建议 256x256 多分辨率 ICO），并在 `package.json` 的
  `build.win.icon` 中指定路径，例如 `"win": { "target": ["nsis","portable"], "icon": "assets/icon.ico" }`。
- **macOS**：可放置 `icon.icns`。

当前未内置图标，electron-builder 会回退到默认图标，打包不会报错。
