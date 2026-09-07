// vue.config.js

module.exports = {
  pluginOptions: {
    electronBuilder: {
      mainProcessWatch: ["src/services/**/*.js", "src/utils/db.js", "src/utils/backgroundExtra.js"],
      builderOptions: {
        ...(process.env.YANQIAN_ELECTRON_DIST
          ? { electronDist: process.env.YANQIAN_ELECTRON_DIST }
          : {}),
        appId: "xhznl-todo-list",
        productName: "xhznl-todo-list",
        copyright: "Copyright © 2020 xhznl",
        directories: {
          buildResources: "./public"
          // output: "./dist", //输出文件路径
        },
        electronDownload: {
          mirror: "https://npmmirror.com/mirrors/electron/"
        },
        win: {
          icon: "./public/logo.ico",
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
          shortcutName: "xhznl-todo-list"
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
