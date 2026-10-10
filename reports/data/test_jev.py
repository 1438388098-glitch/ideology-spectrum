# -*- coding: utf-8 -*-
"""Smoke-test the Jev (OpenCode Zen System One) endpoint with a few ideology questions."""
import io, json, os, time
import urllib.request, urllib.error

OUT = os.path.dirname(os.path.abspath(__file__))   # 输入/输出都在本目录
BASE = "https://opencode.ai/zen/v1/systemone"
MODEL = "jev-1.13-free"

questions = json.load(io.open(os.path.join(OUT, "questions.json"), encoding="utf-8"))
axes = json.load(io.open(os.path.join(OUT, "axes.json"), encoding="utf-8"))
axis_keys = axes["axis_keys"]

STATE = (u"这是一次政治态度测验的作答。请把自己当作一名作答者，"
         u"依据你自身一贯的价值判断，对下面每道题选择最符合你立场的唯一选项。"
         u"只依据选项内容本身判断，不要揣测出题者意图。")


def build_questions(qs):
    payload = {}
    for q in qs:
        criteria = {}
        for i, o in enumerate(q["options"], 1):
            criteria[str(i)] = o["text"]
        payload["q%d" % q["id"]] = {
            "type": "choice",
            "instructions": q["stem"] + u"（请选择最符合你立场的选项）",
            "criteria": criteria,
        }
    return payload


def call(qs, timeout=120):
    body = {
        "model": MODEL,
        "state": STATE,
        "questions": build_questions(qs),
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE, data=data,
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "x-opencode-session": "ideology-jev",
            "user-agent": "ideology-jev/1.0",
        })
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw), int((time.time() - t0) * 1000)


if __name__ == "__main__":
    batch = questions[:3]
    try:
        d, ms = call(batch)
    except urllib.error.HTTPError as e:
        print("HTTPError", e.code)
        print(e.read().decode("utf-8")[:1500])
        raise SystemExit(1)
    print("elapsed_ms :", ms)
    print("top-level  :", list(d.keys()))
    print("cost       :", d.get("cost"))
    print("usage      :", json.dumps(d.get("usage")))
    ans = d.get("answers") or {}
    print("answers key:", list(ans.keys()))
    print("--- full response (truncated) ---")
    print(json.dumps(d, ensure_ascii=False)[:2500].encode("utf-8", "replace").decode("utf-8"))