# xhznl-todo-list

:sparkles:一个使用 electron + vue + electron-builder 开发的跨平台 todolist（便签）桌面应用

## 相关技术

[electron 9.x](https://github.com/electron/electron)

[vue 2.x](https://github.com/vuejs/vue)

[vue-cli-plugin-electron-builder](https://github.com/nklayman/vue-cli-plugin-electron-builder)

[electron-builder](https://github.com/electron-userland/electron-builder)

[lowdb](https://github.com/typicode/lowdb)

[exceljs](https://github.com/exceljs/exceljs)

[dayjs](https://github.com/iamkun/dayjs)

[Vue.Draggable](https://github.com/SortableJS/Vue.Draggable)

......

## 功能预览

![todo list](/resources/1.png)

![done list](/resources/2.png)

![基本操作](/resources/3.gif)

![数据导出](/resources/4.gif)

![鼠标穿透](/resources/5.gif)

![macOS](/resources/6.png)

## 步骤

```powershell
npm install

# 推荐：使用项目内隔离数据调试，不影响正式数据
$env:YANQIAN_TEST = "1"
$env:YANQIAN_DATA_DIR = Join-Path (Get-Location) ".local-debug-data"
npm run electron:serve

# 构建 Windows 安装包
npm run electron:build
```

开发模式会自动监听 `src` 目录并重新编译。按 `Ctrl+C` 停止开发服务器。
修改 `src/background.js`、`src/services` 或主进程 IPC 后，请按 `Ctrl+C` 完整重启开发服务器；只热更新界面可能让新界面连接到旧主进程，并提示“不支持的操作”。
隔离模式的数据保存在 `.local-debug-data/data-dev.json`。

本项目使用较旧的 Vue CLI 4。`package.json` 已锁定兼容 Node 24 的
`websocket-driver`，请保留 `package-lock.json` 并使用 `npm install` 安装依赖。

下载 releases：https://github.com/xiajingren/xhznl-todo-list/releases

## 规划

- [x] todo/done 基本功能
- [x] 本地数据库存储
- [x] 软件自动更新
- [x] 数据导出为 excel
- [x] 开机启动
- [x] 鼠标穿透
- [ ] 窗口贴边自动收起
- [ ] ......
