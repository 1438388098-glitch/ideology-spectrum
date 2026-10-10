# 意识形态光谱 Ideology Spectrum

系统化收集与介绍全球主要意识形态，并提供 **50 / 100 / 200 题三档可选**的判断测试，从 10 个维度量化定位你的政治立场。纯前端计分 + 零依赖 Python 统计后端。

**在线示例**：<https://iweistoicqc5.top/ideology/>

## 功能

- **意识形态分类库**：自由主义、保守主义、社会主义、共产主义、无政府主义、法西斯主义、民族主义、女权主义、环保主义、宗教原教旨主义等，逐一定义、主张与代表人物
- **三档测试**：50 / 100 / 200 题可选，逐题作答，每题给出所选选项的意识形态倾向解析
- **10 维量化定位**：经济左右、社会自由—威权、进步—传统、全球—民族、世俗—宗教、环保—发展、平等—等级、个人—集体、改良—革命、和平—强硬
- **匹配与对比**：与意识形态库逐轴计算相似度，给出最贴近流派及 Top5，附与指定政府画像的适配度
- **国家社会气候参考**：多国 10 维画像，按你的立场给出契合度参考（不构成移民建议）
- **结果分享图**：Canvas 生成，可保存分享
- **统计后端**：管理面板查看提交总量、意识形态分布、10 轴均值、政府适配度分布、近 14 天趋势与逐条记录

## 目录结构

```
ideology-site/
├── index.html            # 单页前端（首页 / 分类 / 测试 / 对比）
├── css/styles.css
├── js/
│   ├── axes.js           # 10 个维度定义
│   ├── questions.js      # 打包题库（200 题 × 4 选项）
│   ├── ideologies.js     # 意识形态库
│   ├── migration.js      # 各国社会气候画像
│   └── app.js            # 计分、匹配、结果图、提交
├── data/batch1-5.json    # 题库源文件（5 批共 200 题）
├── server/
│   ├── server.py         # 后端 API（仅 Python 标准库 + SQLite）
│   └── admin.html        # 管理面板（登录 + 统计 + 记录）
└── reports/              # 用本题库对 LLM 做政治光谱测量的报告与复现脚本
```

## 本地运行

前端为纯静态站，计分全部在浏览器完成：

```bash
cd ideology-site
python -m http.server 8080
# 打开 http://127.0.0.1:8080
```

后端（可选，仅用于记录提交与统计）：

```bash
cd server
ADMIN_PASSWORD=你的密码 python3 server.py
# 监听 127.0.0.1:8011，数据写入同目录 data.db
```

> 前端 `/api/*` 为相对路径，本地无反代时提交会静默失败，不影响答题与结果展示。

## 部署

线上采用 nginx 反代布局，前端与后端分离：

1. 前端（`index.html`、`css/`、`js/`）放入静态目录，`location ^~ /ideology/ { alias .../; }`
2. `admin.html` 同目录分发，自带登录页
3. `/api/` 反向代理到 `127.0.0.1:8011`（后端只监听本机回环，不直接暴露公网）
4. 后端用 systemd 守护示例：

```ini
[Service]
WorkingDirectory=/www/wwwroot/ideology/server
Environment=ADMIN_PASSWORD=你的密码
ExecStart=/usr/bin/python3 /www/wwwroot/ideology/server/server.py
Restart=always
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/submit` | 提交一条测试结果（公开） |
| POST | `/api/login` | 管理员登录，签发 12 小时 token |
| GET | `/api/admin/stats?token=` | 统计总览 |
| GET | `/api/admin/records?token=&page=&size=` | 记录分页列表 |

提交体示例（10 轴键名与 `js/axes.js` 一致）：

```json
{
  "mode": "200",
  "username": "匿名",
  "axes": {"ECON": 0, "SOC": 0, "PROG": 0, "GLOB": 0, "SEC": 0, "ECO": 0, "HIER": 0, "INDV": 0, "REV": 0, "PEACE": 0},
  "topMatch": {"name": "社会民主主义", "nameEn": "Social Democracy", "similarity": 85.7},
  "topMatches": [],
  "govFit": {"overall": 71.8, "grade": "总体契合"}
}
```

## 安全说明

- 管理员密码经环境变量 `ADMIN_PASSWORD` 注入，**未设置时 `/api/login` 一律拒绝**；代码与仓库中不含任何明文口令
- 登录 token 仅存于进程内存，重启即失效
- 后端只监听 `127.0.0.1`，必须经反向代理对外服务
- `server/data.db` 存有访客提交的记录，已加入 `.gitignore`，请勿入库或公开

## 冒烟测试

```bash
cd server
ADMIN_PASSWORD=test123 python3 server.py &

# 登录：错密码 401，对密码 200 并返回 token
curl -s -X POST http://127.0.0.1:8011/api/login -d '{"password":"wrong"}'
curl -s -X POST http://127.0.0.1:8011/api/login -d '{"password":"test123"}'

# 提交一条记录 -> 200 {"ok":true,"id":1}
curl -s -X POST http://127.0.0.1:8011/api/submit -H 'Content-Type: application/json' -d '{"mode":"50","axes":{"ECON":0,"SOC":0,"PROG":0,"GLOB":0,"SEC":0,"ECO":0,"HIER":0,"INDV":0,"REV":0,"PEACE":0},"topMatch":{"name":"测试"}}'

# 带 token 查统计与记录
curl -s "http://127.0.0.1:8011/api/admin/stats?token=<TOKEN>"
curl -s "http://127.0.0.1:8011/api/admin/records?token=<TOKEN>"
```

## 评测报告

`reports/` 附一份用完整 200 题题库对 LLM（Jev）做政治光谱测量的报告与复现脚本：逐题构造结构化选择题让模型作答，按站点原生计分口径还原其 10 维画像——展示了这套题库作为「模型价值倾向测量工具」的另一种用法。

## 免责声明

本站对各意识形态仅作客观、描述性介绍，不代表对任何立场的倡导或否定。政治光谱是连续的，标签只是近似。国家社会气候画像为定性共识刻画，仅供参考，不构成移民建议。

## License

[MIT](LICENSE)
