// vue.config.js

module.exports = {
  pluginOptions: {
    electronBuilder: {
      mainProcessWatch: ["src/services/**/*.js", "src/utils/db.js", "src/utils/backgroundExtra.js"],
      builderOptions: {
        ...(process.env.YANQIAN_ELECTRON_DIST
          ? { electronDist: process.env.YANQIAN_ELECTRON_DIST }
          : {}),
        appId: "com.yanqian.todo",
        productName: "眼前",
        copyright: "Copyright © 2026 Yanqian",
        directories: {
          buildResources: "./public"
          // output: "./dist", //输出文件路径
        },
        electronDownload: {
          mirror: "https://npmmirror.com/mirrors/electron/"
        },
        win: {
          icon: "./public/logo.ico",
          artifactName: "yanqian-todo-list Setup ${version}.${ext}",
          target: [
            {
              target: "nsis",
              arch: process.env.YANQIAN_ELECTRON_DIST
                ? [process.arch]
                : ["x64", "ia32"]
            }
          ]
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          shortcutName: "眼前",
          uninstallDisplayName: "眼前",
          installerIcon: "./public/logo.ico",
          uninstallerIcon: "./public/logo.ico",
          installerHeaderIcon: "./public/logo.ico"
        },
        dmg: {
          contents: [
            {
              x: 410,
              y: 150,
              type: "link",
              path: "/Applications"
            },
            {
              x: 130,
              y: 150,
              type: "file"
            }
          ]
        },
        mac: {
          icon: "./public/logo.icns",
          hardenedRuntime: true,
          gatekeeperAssess: false,
          entitlements: "./public/entitlements.mac.plist",
          entitlementsInherit: "./public/entitlements.mac.plist",
          target: {
            target: "default",
            arch: "universal"
          }
        },
        publish: null
        // releaseInfo: {
        //   releaseName: "",
        //   releaseNotes: "",
        //   releaseDate: "",
        // },
      },
      nodeIntegration: true
    }
  },
  configureWebpack: {
    externals: {}
  }
};
