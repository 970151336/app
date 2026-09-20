# 全球电视直播 · H5（实时版 v2.0）

参考 `dytt` H5 框架构建的电视直播 App。**数据全部通过浏览器实时请求 [iptv-org API](https://github.com/iptv-org/api)，不写入本地数据文件。**

## 数据来源（实时）
| 端点 | 用途 |
|------|------|
| `countries.json` | 国家 / 地区（含国旗 emoji、官方语言） |
| `languages.json` | 语言 |
| `categories.json` | 分类（含描述） |
| `regions.json` | 地区（含成员国） |
| `channels.json` | 全量频道元数据（名称/国家/分类/官网/开播日期…） |
| `guides.json` | 节目单 EPG 源（按站点分组的 XMLTV 地址） |
| `iptv/channels/{id}.m3u` | 单个频道的播放流（按需拉取，带画质信息） |

> 多 host 回退：**首选 `iptv-org.github.io/api/`（官方 live 端点，README 标注）**，后备 `raw.githubusercontent.com/iptv-org/api/master/`（`master` 分支已不再包含 `.json` 数据文件，仅部分历史环境可访问）。
> `channels.json` 较大（约 30MB），首次进入会流式下载并显示进度，之后写入 **IndexedDB** 缓存（TTL 6h），再次进入秒开。
> 网络不可用时自动降级到内置本地样本数据并显示「离线模式」提示。

## 功能
- **5 个 Tab**：直播 / 分类 / 精选 / 节目单 / 我的
- **实时分类体系**：250+ 国家（带国旗）、30+ 真实分类（带描述与频道数）、地区、语言
- **频道库**：全量搜索（名称/别名/国家/语言/分类）、按国家/地区/语言/分类筛选
- **频道详情**：富元数据（官网、别名、电视台、开播/停播日期、同国家推荐）
- **播放器**：`hls.js` / 原生 HLS 播放；多播放源切换 + 画质徽标；收藏、观看历史
- **节目单 EPG**（新界面）：来自 `guides.json`，按提供方站点分组，可打开 XMLTV 源
- **分类画廊**（新界面）：真实分类卡片墙
- 收藏 / 历史跨页同步（localStorage + 事件总线）、设置页可清除频道库缓存

## 目录
```
tv-live-app/
├── index.html            # App 壳层（底部 5 Tab，iframe 页面栈）
├── src/
│   ├── navTemplate.js    # 导航控制器代码生成器（不可修改）
│   ├── MpPageRouter.js   # iframe 页面栈路由（不可修改）
│   └── ScriptMpPageRouter.js  # 同上（命名别名，不可修改）
├── pages/
│   ├── api.js            # 实时数据层 window.TVAPI（fetch + 缓存 + 索引 + 降级）
│   ├── data.js           # 本地样本数据（离线降级用，非主数据源）
│   ├── store.js          # 跨页状态（收藏/历史）
│   ├── page.css          # 暗色主题样式
│   ├── home/category/channels/channel/player/rank/search/mine/
│   │   categories/guide/settings/favlist/history .html
├── gen_data.py           # 本地样本数据生成器（可选）
└── README.md
```

## 运行
```bash
cd tv-live-app
python3 -m http.server 8088
# 浏览器打开 http://127.0.0.1:8088/index.html
```
> 需通过本地服务器访问（`file://` 直开会因 CORS 无法拉取实时数据，将自动进入离线降级模式）。
> 首次进入会下载频道库（约 30MB），请保持联网；之后有缓存更快。

数据版权归各电视台所有，仅供个人学习交流使用。
