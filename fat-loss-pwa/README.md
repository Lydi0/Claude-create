# 减脂助手 PWA — 部署教程

## 📁 文件结构
```
fat-loss-pwa/
├── index.html       # 主应用
├── style.css        # 样式
├── sw.js            # Service Worker (离线缓存)
├── manifest.json    # PWA 配置
├── netlify.toml     # Netlify 配置
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## 第一步：注册 GitHub（用来托管代码）

1. 打开 https://github.com/signup
2. 注册账号（免费）
3. 创建新仓库：点击右上角 "+" → "New repository"
   - 仓库名称：`fat-loss-pwa`
   - 选择 **Public**
   - 点击 Create repository
4. 将这个文件夹所有文件上传到仓库（拖拽或用 Git 命令）

---

## 第二步：注册 Netlify 并托管

1. 打开 https://app.netlify.com/signup
2. 点击 **"Sign up with GitHub"**，授权登录
3. 进入控制台后点击 **"Add new site"** → **"Import an existing project"**
4. 选择 **GitHub**，找到你的 `fat-loss-pwa` 仓库
5. 配置：
   - Branch: `main`
   - Build command: 留空
   - Publish directory: `.`（就是根目录）
6. 点击 **"Deploy site"**
7. 等待约30秒，你会得到一个网址如 `https://amazing-xyz.netlify.app`
8. （可选）在 Site settings → Domain management 里自定义域名

---

## 第三步：注册 Firebase（数据云同步）

### 3.1 创建项目
1. 打开 https://console.firebase.google.com
2. 点击 **"创建项目"** → 输入项目名称（如 `fat-loss-tracker`）
3. 关闭 Google Analytics（可选），点击**创建项目**

### 3.2 启用 Authentication
1. 左侧菜单 → **Authentication** → 点击**开始**
2. 选择 **Sign-in method** 选项卡
3. 点击 **Google**，启用，填写项目支持邮箱 → 保存

### 3.3 启用 Firestore 数据库
1. 左侧菜单 → **Firestore Database** → 点击**创建数据库**
2. 选择 **以生产模式启动**
3. 区域选择 `asia-east1`（台湾/香港节点，速度快）→ 完成

### 3.4 设置安全规则
在 Firestore → 规则选项卡，将规则改为：
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
点击**发布**。

### 3.5 添加 Web 应用，获取配置
1. 项目设置（齿轮图标）→ **常规** → 滚动到底部
2. 点击 **Web 图标（</>）** → 输入应用名称 → 点击**注册应用**
3. 复制 `firebaseConfig` 对象内容

### 3.6 设置授权域名
1. Authentication → **Settings** → **已授权网域**
2. 点击 **添加域名**
3. 输入你的 Netlify 域名（如 `amazing-xyz.netlify.app`）

### 3.7 填写配置到代码
打开 `index.html`，找到：
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  ...
};
```
将 `YOUR_API_KEY` 等替换为 Firebase 给你的真实配置。

然后将修改后的文件推送到 GitHub，Netlify 会自动重新部署。

---

## 第四步：安装到手机（添加到主屏幕）

### iPhone
1. Safari 浏览器打开你的 Netlify 网址
2. 点击底部**分享按钮** → **添加到主屏幕**
3. 点击**添加**，图标会出现在桌面

### Android
1. Chrome 浏览器打开网址
2. 浏览器会弹出**"添加到主屏幕"**提示
3. 或点击右上角三点菜单 → **安装应用**

---

## 功能说明

| 功能 | 说明 |
|------|------|
| 热量缺口环 | 可视化今日摄入/消耗/缺口 |
| 中文食物数据库 | 内置60+常见食物，按名称搜索 |
| 运动打卡 | 12种运动快速选择，按体重自动计算消耗 |
| 4项每日打卡 | 运动/喝水/早睡/称重，计算连续天数 |
| 体重趋势图 | 14天折线图 |
| 热量缺口柱状图 | 7天可视化，标注目标线 |
| 减脂计划 | 基于Mifflin-St Jeor公式计算BMR/TDEE |
| 离线可用 | Service Worker 缓存，无网络也能使用 |
| 多端同步 | Firebase Firestore 实时同步手机/电脑 |

---

## 你的个人减脂计划（预设）

- 基础代谢 BMR：**1278 kcal**
- 每日总消耗 TDEE：**1758 kcal**
- 每日目标摄入：**1258 kcal**（每日缺口500kcal）
- 预计达标时间：约 **8 周**
- 每日蛋白质建议：**83g**

---

如有问题，在 profile 页面修改个人信息后点"保存"即可重新计算。
