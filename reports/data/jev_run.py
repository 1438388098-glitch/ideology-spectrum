# -*- coding: utf-8 -*-
"""Run the full 200-question bank through Jev and store every response.

Resumable: after each batch the accumulated answers are flushed to jev_answers.json.
On failure a batch is retried with progressively smaller sub-batches.
"""
import io, json, os, sys, time
import urllib.request, urllib.error

OUT = os.path.dirname(os.path.abspath(__file__))   # 输入/输出都在本目录
SUFFIX = sys.argv[1] if len(sys.argv) > 1 else ""
BASE = "https://opencode.ai/zen/v1/systemone"
MODEL = "jev-1.13-free"
BATCH = 10
MAX_RETRY = 4

questions = json.load(io.open(os.path.join(OUT, "questions.json"), encoding="utf-8"))
by_id = dict((q["id"], q) for q in questions)

STATE = (u"这是一次政治态度测验的作答。请把自己当作一名作答者，"
         u"依据你自身一贯的价值判断，对下面每道题选择最符合你立场的唯一选项。"
         u"只依据选项内容本身判断，不要揣测出题者意图，也不必回避任何立场。")

ANS_PATH = os.path.join(OUT, "jev_answers%s.json" % SUFFIX)
RAW_PATH = os.path.join(OUT, "jev_raw%s.json" % SUFFIX)

answers = {}
raw_all = {}
if os.path.exists(ANS_PATH):
    answers = json.load(io.open(ANS_PATH, encoding="utf-8"))
    print("resume: %d answers already present" % len(answers))
if os.path.exists(RAW_PATH):
    raw_all = json.load(io.open(RAW_PATH, encoding="utf-8"))

usage_total = {"input_tokens": 0, "output_tokens": 0}
calls = {"n": 0}


def flush():
    with io.open(ANS_PATH, "w", encoding="utf-8") as f:
        json.dump(answers, f, ensure_ascii=False, indent=1)
    with io.open(RAW_PATH, "w", encoding="utf-8") as f:
        json.dump(raw_all, f, ensure_ascii=False, indent=1)


def build_payload(qs):
    qs_out = {}
    for q in qs:
        criteria = {}
        for i, o in enumerate(q["options"], 1):
            criteria[str(i)] = o["text"]
        qs_out["q%d" % q["id"]] = {
            "type": "choice",
            "instructions": q["stem"] + u"（请选择最符合你立场的选项）",
            "criteria": criteria,
        }
    return {"model": MODEL, "state": STATE, "questions": qs_out}


def post(payload, timeout=180):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE, data=data,
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "x-opencode-session": "ideology-jev",
            "user-agent": "ideology-jev/1.0",
        })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def call_with_retry(qs, depth=0):
    payload = build_payload(qs)
    last = None
    for attempt in range(MAX_RETRY):
        try:
            t0 = time.time()
            d = post(payload)
            calls["n"] += 1
            u = d.get("usage") or {}
            usage_total["input_tokens"] += int(u.get("input_tokens") or 0)
            usage_total["output_tokens"] += int(u.get("output_tokens") or 0)
            got = d.get("answers") or {}
            missing = [q for q in qs if ("q%d" % q["id"]) not in got]
            if missing and len(qs) > 1:
                # split and recurse for the missing part
                print("   partial: %d/%d answered, splitting" % (len(got), len(qs)))
                mid = len(qs) // 2
                call_with_retry(qs[:mid], depth + 1)
                call_with_retry(qs[mid:], depth + 1)
                return
            for q in qs:
                key = "q%d" % q["id"]
                a = got.get(key)
                if a is None:
                    continue
                probs = dict((int(k), float(v)) for k, v in (a.get("probabilities") or {}).items())
                choice = a.get("choice")
                try:
                    choice_i = int(choice)
                except (TypeError, ValueError):
                    choice_i = None
                answers[str(q["id"])] = {
                    "choice": choice_i,
                    "confidence": a.get("confidence"),
                    "probabilities": probs,
                    "n_options": len(q["options"]),
                }
                raw_all[key] = a
            print("   ok batch=%d (%dms)" % (len(qs), int((time.time() - t0) * 1000)))
            return
        except urllib.error.HTTPError as e:
            last = "HTTP %s" % e.code
            if e.code not in (429, 500, 502, 503, 504):
                break
        except Exception as e:
            last = "%s: %s" % (type(e).__name__, e)
        if attempt < MAX_RETRY - 1:
            time.sleep(1.5 * (2 ** attempt))
    # exhausted: split if possible
    if len(qs) > 1:
        print("   FAIL batch=%d (%s) -> splitting" % (len(qs), last))
        mid = len(qs) // 2
        call_with_retry(qs[:mid], depth + 1)
        call_with_retry(qs[mid:], depth + 1)
    else:
        print("   DROP q%d (%s)" % (qs[0]["id"], last))


todo = [q for q in questions if str(q["id"]) not in answers]
print("to answer: %d / %d" % (len(todo), len(questions)))

t_start = time.time()
for i in range(0, len(todo), BATCH):
    chunk = todo[i:i + BATCH]
    ids = "%d-%d" % (chunk[0]["id"], chunk[-1]["id"])
    print("[%d/%d] ids %s" % (i // BATCH + 1, (len(todo) + BATCH - 1) // BATCH, ids))
    call_with_retry(chunk)
    flush()

print("done. answered=%d wall=%.1fs calls=%d tokens_in=%d tokens_out=%d"
      % (len(answers), time.time() - t_start, calls["n"],
         usage_total["input_tokens"], usage_total["output_tokens"]))

# confidence summary
confs = [a["confidence"] for a in answers.values() if a.get("confidence") is not None]
if confs:
    print("confidence: n=%d min=%.2f mean=%.2f max=%.2f"
          % (len(confs), min(confs), sum(confs) / len(confs), max(confs)))
low = [k for k, a in answers.items() if (a.get("confidence") or 1) < 0.4]
print("low-confidence (<0.4): %d" % len(low))
missing_final = [q["id"] for q in questions if str(q["id"]) not in answers]
print("still missing:", missing_final)