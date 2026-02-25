# Web Translate - 网页双语对照翻译

一个 Chrome 扩展插件，使用本地运行的 Ollama 大语言模型，实现网页整页翻译为中文。支持双语对照和替换原文两种显示方式。

## 特性

- **本地翻译** — 通过本地 Ollama 服务调用大语言模型，数据不离开本机
- **模型可选** — 自动获取本地已安装的 Ollama 模型列表，自由切换
- **双语对照** — 译文显示在原文下方，方便对照阅读
- **替换原文** — 可切换为替换模式，译文直接替代原文，阅读更沉浸
- **流式显示** — 翻译结果逐段实时显示，无需等待全部完成
- **智能过滤** — 自动跳过中文内容、代码块、纯数字等无需翻译的内容
- **视口优先** — 优先翻译当前可见区域的内容

## 前置要求

- [Ollama](https://ollama.ai) 已安装并运行
- 至少下载一个模型

```bash
# 启动 Ollama
ollama serve

# 下载模型（任选其一或多个）
ollama pull qwen2:7b
ollama pull qwen2.5:7b
ollama pull llama3.1
```

## 安装

1. 下载或克隆本仓库
2. 打开 Chrome，访问 `chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择项目目录

## 使用

1. 打开任意英文网页
2. 点击浏览器工具栏中的插件图标
3. 确认 Ollama 连接状态为绿色
4. 从下拉框选择翻译模型
5. 选择显示方式（双语对照 / 替换原文）
6. 点击「翻译此页」

## 项目结构

```
web-translate/
├── manifest.json   # Chrome 扩展配置（Manifest V3）
├── background.js   # Service Worker，调用 Ollama API
├── content.js      # Content Script，DOM 提取与译文注入
├── popup.html      # 弹出窗口 UI
├── popup.js        # 弹出窗口逻辑
├── styles.css      # 双语对照与替换模式样式
└── icons/          # 扩展图标
```

## 技术方案

- **Chrome Extension Manifest V3**
- **Ollama REST API**（`localhost:11434`），流式响应
- Service Worker 与 Content Script 通过 `chrome.runtime.connect`（Port）长连接通信
- 模型选择与显示模式配置通过 `chrome.storage.local` 持久化

## License

MIT
