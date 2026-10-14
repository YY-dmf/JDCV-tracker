<h1 align="center">🌱 VCJDtracker · 不言求职记</h1>

<p align="center">
  一个为秋招/实习人打造的投递管理工作台 <br>
  独立开发 · 纯前端 · 数据本地存储
</p>

<p align="center">
  <img src="https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white" alt="HTML5">
  <img src="https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white" alt="CSS3">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/Storage-IndexedDB-orange" alt="IndexedDB">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

<p align="center">
  <a href="#-功能一览">功能</a> ·
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-技术栈">技术栈</a> ·
  <a href="#-隐私说明">隐私说明</a>
</p>

---

## ✨ 为什么做这个

秋招投了几十家公司，邮箱乱、表格烦、面试复盘记不住……  
干脆自己写一个小工具，**把投递、简历、复盘放在同一个页面**，打开就能用，数据全在自己浏览器里。

---

## 🎯 功能一览

| 模块 | 能做什么 |
|------|----------|
| 📋 **JD 投递跟踪** | 可编辑表格 · 四态状态切换（待投递/已投递/流程中/寄了）· 自动排序 · 右键快捷操作 |
| 📄 **我的简历** | PDF 上传预览 · 下载/替换/删除 · 自动记录更新时间 |
| 📝 **学习复盘 MEMO** | 搜索分页 · 折叠展开 · 拖动排序 · 富文本编辑 |
| 👤 **个人主页** | 头像上传裁剪 · 自定义 slogan |
| 💾 **数据管理** | 本地自动保存 · 一键备份导出/恢复 · 删除可撤销 |

### 界面风格

森林绿主色 + 燕麦白、奶茶驼、雾蓝灰、灰调裸粉辅助色，适配桌面和手机。

---

## 🚀 快速开始

**方式一：直接打开**
```bash
# 下载后双击 index.html 即可使用
```

**方式二：本地起服务**
```bash
python -m http.server 8080
# 访问 http://127.0.0.1:8080
```

**方式三：在线体验**（部署后填入链接）
> 🔗 [点击打开在线版本](https://yy-dmf.github.io/JDCV-tracker/)

---

## 🛠 技术栈

- **纯原生** HTML / CSS / JavaScript，零依赖、零构建
- **IndexedDB** 本地数据库，数据不上云
- **响应式布局**，手机电脑都能用
- 三个文件搞定：`index.html` + `styles.css` + `app.js`

---

## 🔒 隐私说明

- 所有数据保存在你自己的浏览器里，**不会上传到任何服务器**
- 换设备/换浏览器前，请用右上角「⇅」导出备份，再在新环境恢复
- 备份文件包含 PDF、图片、笔记，请自行妥善保存

---

## 📁 文件结构

```text
VCJDtracker/
├── index.html       # 页面结构
├── styles.css       # 样式与响应式布局
├── app.js           # 应用逻辑与本地数据存储
├── README.md        # 使用说明
├── .gitignore       # 排除个人附件
├── .gitattributes   # 统一换行
└── .nojekyll        # 静态发布标记
```

---

<p align="center">
  如果这个工具帮到了你，欢迎点个 ⭐ Star 鼓励一下
</p>
