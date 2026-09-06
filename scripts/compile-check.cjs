// Compile sources without requiring a desktop runtime. This is NOT an Electron packaging or native smoke test.
const path = require("path");
const webpack = require("webpack");
const Service = require("@vue/cli-service/lib/Service");
async function main() {
  const plugins = [
    "@vue/cli-plugin-babel",
    "@vue/cli-plugin-eslint"
  ].map(id => ({ id, apply: require(id) }));
  plugins.push({
    id: "compile-check-externals",
    apply(api) {
      api.configureWebpack({ externals: { electron: "commonjs electron" } });
    }
  });
  const service = new Service(process.cwd(), { plugins });
  await service.run(
    "build",
    { dest: "dist-check/renderer", mode: "production" },
    []
  );
  await new Promise((resolve, reject) =>
    webpack(
      {
        mode: "production",
        target: "electron-main",
        entry: path.resolve("src/background.js"),
        output: {
          path: path.resolve("dist-check/main"),
          filename: "background.js"
        },
        resolve: { alias: { "@": path.resolve("src") } },
        externals: [
          (context, request, callback) => {
            if (
              request.startsWith(".") ||
              request.startsWith("@/") ||
              path.isAbsolute(request) ||
              request === "vue-cli-plugin-electron-builder/lib"
            )
              callback();
            else callback(null, "commonjs " + request);
          }
        ],
        module: {
          rules: [
            {
              test: /\.js$/,
              exclude: /node_modules/,
              use: {
                loader: "babel-loader",
                options: {
                  babelrc: false,
                  configFile: false,
                  presets: [
                    [
                      "@babel/preset-env",
                      { targets: { electron: "11" }, modules: false }
                    ]
                  ]
                }
              }
            }
          ]
        },
        plugins: [
          new webpack.DefinePlugin({
            __static: JSON.stringify(path.resolve("public")),
            "process.env.NODE_ENV": JSON.stringify("production")
          })
        ]
      },
      (error, stats) => {
        if (error) return reject(error);
        if (stats.hasErrors())
          return reject(Error(stats.toString({ all: false, errors: true })));
        console.log("Main-process compilation passed.");
        resolve();
      }
    )
  );
  console.log(
    "COMPILE ONLY: renderer and main sources passed; desktop runtime and installer remain unverified."
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
