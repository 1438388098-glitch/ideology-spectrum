#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全球意识形态测试 —— 记录与统计后端
================================
仅使用 Python 3 标准库（http.server / sqlite3 / json / hashlib / secrets / datetime），
无任何第三方依赖。由 nginx 反向代理 /api/ 前缀转发到本服务（127.0.0.1:8001）。

接口一览：
  POST /api/submit            提交一条测试结果（公开）
  POST /api/login             管理员登录，返回 token（12 小时有效）
  GET  /api/admin/stats       统计总览（需 token）
  GET  /api/admin/records     答题记录分页列表（需 token）
其他路径一律返回 404。

部署方式：
  ADMIN_PASSWORD=你的密码 python3 server.py &   # 后台运行；也可用 systemd / supervisor 守护
  管理员密码通过环境变量 ADMIN_PASSWORD 注入，未设置时 /api/login 一律拒绝。
"""

import json
import os
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

# ----------------------------- 基础常量 -----------------------------
HOST = "127.0.0.1"                      # 只监听本机，供 nginx 反代，不暴露公网
PORT = 8011                             # 注意：8001 已被本机 hermes 服务占用，故用 8011

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data.db")   # SQLite 数据库文件

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()  # 管理员密码，由环境变量注入
TOKEN_TTL = 12 * 60 * 60                # token 有效期 12 小时（秒）

# 10 个轴的合法键名（固定顺序，用于校验与统计输出）
AXIS_KEYS = ["ECON", "SOC", "PROG", "GLOB", "SEC", "ECO",
             "HIER", "INDV", "REV", "PEACE"]

VALID_MODES = {"50", "100", "200"}      # 合法答题模式

# 政府适配度等级（固定顺序，用于统计输出）
GOV_GRADES = ["高度契合", "总体契合", "部分契合", "差异显著"]

# 内存 token 表：token -> 过期时间戳（秒）。线程锁保护，多线程并发读写安全。
_token_lock = threading.Lock()
_tokens = {}


# ----------------------------- 数据库 -----------------------------
def get_conn():
    """打开数据库连接。每个请求/线程新建连接，避免跨线程共享。"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """初始化数据库表（幂等，可重复执行）。"""
    conn = get_conn()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT,                       -- ISO 本地时间+时区
                mode TEXT,                     -- '50' / '100' / '200'
                username TEXT DEFAULT '匿名',  -- 可空，默认'匿名'
                axes TEXT,                     -- JSON：10 个轴得分
                top_match TEXT,                -- JSON：最贴近意识形态
                top_matches TEXT,              -- JSON：Top5 数组
                gov_overall REAL,              -- 政府适配度 0-100
                gov_grade TEXT,                -- 适配度等级
                created_at TEXT                -- 记录创建时间（与 ts 相同）
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


# ----------------------------- 工具函数 -----------------------------
def now_iso():
    """返回带时区偏移的本地时间 ISO 字符串，如 2026-08-19T10:30:00.123456+08:00。"""
    return datetime.now().astimezone().isoformat()


def json_body(handler):
    """读取请求体并解析 JSON。返回 (数据, 错误信息)，成功时错误为 None。"""
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except ValueError:
        return None, "invalid Content-Length"
    if length <= 0:
        return None, "empty body"
    try:
        raw = handler.rfile.read(length)
        return json.loads(raw.decode("utf-8")), None
    except Exception:
        return None, "invalid json"


def safe_float(x, default=0.0):
    """安全转 float；布尔值/非法值一律返回默认值。"""
    if isinstance(x, bool):
        return default
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def validate_submit(payload):
    """
    校验提交数据。
    返回 (错误信息 or None, 规范化字段 dict)。
    """
    if not isinstance(payload, dict):
        return "body must be a JSON object", None

    # --- mode ---
    mode = payload.get("mode")
    if mode not in VALID_MODES:
        return "mode 必须是 50 / 100 / 200 之一", None

    # --- username（可空，默认'匿名'） ---
    username = payload.get("username")
    if not isinstance(username, str) or not username.strip():
        username = "匿名"
    username = username.strip()[:50] or "匿名"

    # --- axes：必须包含全部 10 个键，值必须为数值 ---
    axes = payload.get("axes")
    if not isinstance(axes, dict):
        return "axes 必须是对象", None
    missing = [k for k in AXIS_KEYS if k not in axes]
    if missing:
        return "axes 缺少维度: " + ",".join(missing), None
    cleaned_axes = {}
    for k in AXIS_KEYS:
        v = axes[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return "axes[" + k + "] 必须是数值", None
        cleaned_axes[k] = float(v)   # 统一转 float

    # --- topMatch：必须存在且含 name ---
    top_match = payload.get("topMatch")
    if not isinstance(top_match, dict):
        return "topMatch 必须是对象", None
    name = top_match.get("name")
    if not isinstance(name, str) or not name.strip():
        return "topMatch.name 必填", None

    # --- topMatches（可选，最多保留 5 条） ---
    top_matches = payload.get("topMatches")
    if not isinstance(top_matches, list):
        top_matches = []
    cleaned_matches = []
    for m in top_matches[:5]:
        if isinstance(m, dict):
            cleaned_matches.append({
                "name": str(m.get("name", ""))[:50],
                "nameEn": str(m.get("nameEn", ""))[:50],
                "similarity": safe_float(m.get("similarity")),
            })

    # --- govFit（可选） ---
    gov = payload.get("govFit")
    gov_overall = 0.0
    gov_grade = ""
    if isinstance(gov, dict):
        gov_overall = safe_float(gov.get("overall"))
        g = gov.get("grade")
        if isinstance(g, str):
            gov_grade = g.strip()[:20]
        elif g is not None:
            gov_grade = str(g)[:20]

    cleaned = {
        "mode": mode,
        "username": username,
        "axes": cleaned_axes,
        "top_match": {
            "name": name.strip()[:50],
            "nameEn": str(top_match.get("nameEn", ""))[:50],
            "similarity": safe_float(top_match.get("similarity")),
        },
        "top_matches": cleaned_matches,
        "gov_overall": gov_overall,
        "gov_grade": gov_grade,
    }
    return None, cleaned


def auth_token(token):
    """校验 token 是否有效（存在且未过期）。无效返回 False。"""
    if not token:
        return False
    with _token_lock:
        exp = _tokens.get(token)
        if exp is None:
            return False
        if time.time() > exp:      # 已过期则清除
            _tokens.pop(token, None)
            return False
        return True


# ----------------------------- 统计计算 -----------------------------
def build_daily(count_by_date):
    """生成近 14 天（含今天）的 [{"date":"MM-DD","count":n}, ...]，缺的日期补 0。"""
    today = datetime.now().date()
    out = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        out.append({"date": d.strftime("%m-%d"),
                    "count": count_by_date.get(key, 0)})
    return out


def compute_stats():
    """计算全部统计指标。无数据时返回各字段空值（0 / {} / []），绝不抛错。"""
    empty = {
        "total": 0,
        "byMode": {"50": 0, "100": 0, "200": 0},
        "byIdeo": {},
        "axisAvg": {k: 0.0 for k in AXIS_KEYS},
        "govGrades": {g: 0 for g in GOV_GRADES},
        "govAvg": 0.0,
        "daily": build_daily({}),
    }

    conn = get_conn()
    try:
        total = conn.execute("SELECT COUNT(*) c FROM records").fetchone()["c"]
        if total == 0:
            return empty

        # 各模式数量
        by_mode = {m: 0 for m in VALID_MODES}
        for row in conn.execute("SELECT mode, COUNT(*) c FROM records GROUP BY mode"):
            by_mode[row["mode"]] = row["c"]

        # 意识形态分布（基于 top_match 里的 name，按次数降序）
        by_ideo = {}
        for row in conn.execute("SELECT top_match FROM records"):
            try:
                name = json.loads(row["top_match"]).get("name", "未知")
            except Exception:
                name = "未知"
            by_ideo[name] = by_ideo.get(name, 0) + 1
        by_ideo = dict(sorted(by_ideo.items(), key=lambda kv: kv[1], reverse=True))

        # 10 轴平均分（保留 1 位小数）
        sums = {k: 0.0 for k in AXIS_KEYS}
        cnt = 0
        for row in conn.execute("SELECT axes FROM records"):
            try:
                axes = json.loads(row["axes"])
            except Exception:
                continue
            cnt += 1
            for k in AXIS_KEYS:
                v = axes.get(k)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    sums[k] += float(v)
        axis_avg = {k: (round(sums[k] / cnt, 1) if cnt else 0.0)
                    for k, s in sums.items()}

        # 政府适配度等级分布
        gov_grades = {g: 0 for g in GOV_GRADES}
        for row in conn.execute("SELECT gov_grade FROM records"):
            g = row["gov_grade"] or ""
            gov_grades[g] = gov_grades.get(g, 0) + 1

        # 政府适配度平均（1 位小数）
        avg = conn.execute("SELECT AVG(gov_overall) a FROM records").fetchone()["a"]
        gov_avg = round(avg or 0.0, 1)

        # 近 14 天提交趋势
        count_by_date = {r["d"]: r["c"] for r in conn.execute(
            "SELECT substr(created_at,1,10) d, COUNT(*) c FROM records "
            "GROUP BY substr(created_at,1,10)"
        )}

        return {
            "total": total,
            "byMode": by_mode,
            "byIdeo": by_ideo,
            "axisAvg": axis_avg,
            "govGrades": gov_grades,
            "govAvg": gov_avg,
            "daily": build_daily(count_by_date),
        }
    finally:
        conn.close()


def fetch_records(page, size):
    """分页查询记录，按 id 倒序。返回 (total, rows)。"""
    conn = get_conn()
    try:
        total = conn.execute("SELECT COUNT(*) c FROM records").fetchone()["c"]
        offset = (page - 1) * size
        rows = []
        for r in conn.execute(
            "SELECT id, ts, mode, username, top_match, gov_overall, gov_grade, axes "
            "FROM records ORDER BY id DESC LIMIT ? OFFSET ?",
            (size, offset),
        ):
            try:
                top = json.loads(r["top_match"])
            except Exception:
                top = {"name": "未知", "nameEn": "", "similarity": 0.0}
            try:
                axes = json.loads(r["axes"])
            except Exception:
                axes = {}
            rows.append({
                "id": r["id"],
                "ts": r["ts"],
                "mode": r["mode"],
                "username": r["username"],
                "topMatch": top,
                "govOverall": r["gov_overall"],
                "govGrade": r["gov_grade"],
                "axes": axes,
            })
        return total, rows
    finally:
        conn.close()


# ----------------------------- HTTP 处理器 -----------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "IdeologyAPI/1.0"

    # ---- CORS 响应头 ----
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "86400")

    def _send_json(self, code, obj):
        """统一 JSON 响应出口，所有响应都带 CORS 头。"""
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _token(self):
        """从 query string 提取 token。"""
        q = parse_qs(urlsplit(self.path).query)
        return (q.get("token") or [None])[0]

    def log_message(self, fmt, *args):
        # 覆盖默认的 stderr 日志，统一格式输出到 stdout，方便排障
        print("[%s] %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                           fmt % args))

    # ---- 请求入口（统一 try/except，避免单请求异常导致进程崩溃） ----
    def do_OPTIONS(self):
        print("[OPTIONS] %s" % self.path)
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        print("[GET] %s" % self.path)
        path = urlsplit(self.path).path
        try:
            if path == "/api/admin/stats":
                self.route_stats()
            elif path == "/api/admin/records":
                self.route_records()
            else:
                self._send_json(404, {"ok": False, "error": "not found"})
        except Exception:
            self._send_json(500, {"ok": False, "error": "server error"})

    def do_POST(self):
        print("[POST] %s" % self.path)
        path = urlsplit(self.path).path
        try:
            if path == "/api/submit":
                self.route_submit()
            elif path == "/api/login":
                self.route_login()
            else:
                self._send_json(404, {"ok": False, "error": "not found"})
        except Exception:
            self._send_json(500, {"ok": False, "error": "server error"})

    # ---- 各路由实现 ----
    def route_submit(self):
        """POST /api/submit：写入一条测试结果。"""
        payload, err = json_body(self)
        if err:
            self._send_json(400, {"ok": False, "error": err})
            return
        err, cleaned = validate_submit(payload)
        if err:
            self._send_json(400, {"ok": False, "error": err})
            return
        ts = now_iso()
        conn = get_conn()
        try:
            cur = conn.execute(
                "INSERT INTO records "
                "(ts, mode, username, axes, top_match, top_matches, "
                " gov_overall, gov_grade, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (
                    ts,
                    cleaned["mode"],
                    cleaned["username"],
                    json.dumps(cleaned["axes"], ensure_ascii=False),
                    json.dumps(cleaned["top_match"], ensure_ascii=False),
                    json.dumps(cleaned["top_matches"], ensure_ascii=False),
                    cleaned["gov_overall"],
                    cleaned["gov_grade"],
                    ts,
                ),
            )
            conn.commit()
            rid = cur.lastrowid
        finally:
            conn.close()
        print("  -> 已保存 #%d (%s, %s)" %
              (rid, cleaned["mode"], cleaned["top_match"]["name"]))
        self._send_json(200, {"ok": True, "id": rid})

    def route_login(self):
        """POST /api/login：密码正确则签发 token。"""
        payload, err = json_body(self)
        if err:
            self._send_json(400, {"ok": False, "error": err})
            return
        if (not ADMIN_PASSWORD or not isinstance(payload, dict)
                or payload.get("password") != ADMIN_PASSWORD):
            self._send_json(401, {"ok": False, "error": "密码错误"})
            return
        token = secrets.token_hex(24)
        with _token_lock:
            _tokens[token] = time.time() + TOKEN_TTL
        print("  -> 管理员登录成功，已签发 token")
        self._send_json(200, {"ok": True, "token": token})

    def route_stats(self):
        """GET /api/admin/stats：统计总览（需 token）。"""
        if not auth_token(self._token()):
            self._send_json(401, {"ok": False, "error": "未授权"})
            return
        self._send_json(200, {"ok": True, "stats": compute_stats()})

    def route_records(self):
        """GET /api/admin/records：分页记录列表（需 token）。"""
        if not auth_token(self._token()):
            self._send_json(401, {"ok": False, "error": "未授权"})
            return
        q = parse_qs(urlsplit(self.path).query)
        try:
            page = max(1, int((q.get("page") or ["1"])[0]))
        except ValueError:
            page = 1
        try:
            size = int((q.get("size") or ["20"])[0])
        except ValueError:
            size = 20
        size = max(1, min(100, size))     # 单页最多 100 条，防止滥用
        total, rows = fetch_records(page, size)
        self._send_json(200, {
            "ok": True, "total": total, "page": page, "size": size, "rows": rows,
        })


# ----------------------------- 启动 -----------------------------
def main():
    init_db()
    print("=" * 60)
    print("  全球意识形态测试 · 记录与统计后端")
    print("  监听地址: http://%s:%d" % (HOST, PORT))
    print("  数据库:   %s" % DB_PATH)
    print("  管理接口: /api/admin/* （需 token）")
    if not ADMIN_PASSWORD:
        print("  [警告] 未设置 ADMIN_PASSWORD 环境变量，管理员登录不可用")
    print("=" * 60)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
