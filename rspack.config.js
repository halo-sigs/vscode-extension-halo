"use strict";

const path = require("path");

/** @type {import('@rspack/cli').Configuration} */
const extensionConfig = {
  target: "node",
  mode: "none",
  entry: "./src/extension.ts",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    library: {
      type: "commonjs2",
    },
  },
  externals: {
    vscode: "commonjs vscode",
  },
  resolve: {
    tsConfig: {
      configFile: path.resolve(__dirname, "./tsconfig.json"),
    },
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/],
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: {
              syntax: "typescript",
            },
            externalHelpers: true,
          },
        },
        type: "javascript/auto",
      },
    ],
  },
  devtool: "nosources-source-map",
  infrastructureLogging: {
    level: "log",
  },
  optimization: {
    usedExports: true,
    innerGraph: true,
  },
};
module.exports = [extensionConfig];
