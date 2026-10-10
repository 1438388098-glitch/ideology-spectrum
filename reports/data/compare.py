# -*- coding: utf-8 -*-
"""Compare the two Jev runs: per-question agreement, axis deltas, top-match stability."""
import io, json, os, math

OUT = os.path.dirname(os.path.abspath(__file__))   # 输入/输出都在本目录
questions = json.load(io.open(os.path.join(OUT, "questions.json"), encoding="utf-8"))
ax = json.load(io.open(os.path.join(OUT, "axes.json"), encoding="utf-8"))
axis_keys = ax["axis_keys"]
a1 = json.load(io.open(os.path.join(OUT, "jev_answers.json"), encoding="utf-8"))
a2 = json.load(io.open(os.path.join(OUT, "jev_answers_run2.json"), encoding="utf-8"))
ideologies = json.load(io.open(os.path.join(OUT, "ideologies.json"), encoding="utf-8"))

identical = 0
diffs = []
for q in questions:
    k = str(q["id"])
    if a1[k]["choice"] == a2[k]["choice"]:
        identical += 1
    else:
        diffs.append({"id": q["id"], "v1": a1[k]["choice"], "v2": a2[k]["choice"]})
print("identical choices : %d / %d  (%.1f%%)" % (identical, len(questions), 100.0 * identical / len(questions)))

max_abs = dict((k, 0) for k in axis_keys)
for q in questions:
    for k in axis_keys:
        mx = 0
        for o in q["options"]:
            v = o.get("scores", {}).get(k)
            if isinstance(v, (int, float)):
                mx = max(mx, abs(v))
        max_abs[k] += mx


def axes_of(answers):
    s = dict((k, 0) for k in axis_keys)
    for q in questions:
        ci = answers[str(q["id"])]["choice"]
        if isinstance(ci, int) and 1 <= ci <= len(q["options"]):
            for k in axis_keys:
                s[k] += q["options"][ci - 1]["scores"].get(k, 0)
    return dict((k, max(-100, min(100, int(round(s[k] / max_abs[k] * 100))))) for k in axis_keys)


x1, x2 = axes_of(a1), axes_of(a2)
print("\naxis    run1  run2  delta")
for k in axis_keys:
    print("  %-6s %5d %5d %+5d" % (k, x1[k], x2[k], x2[k] - x1[k]))

max_dist = math.sqrt(len(axis_keys) * (200.0 ** 2))


def top(ux):
    best = None
    for ideo in ideologies:
        d = math.sqrt(sum((ux[k] - ideo["axes"].get(k, 0)) ** 2 for k in axis_keys))
        sim = 100.0 * (1 - d / max_dist)
        if best is None or sim > best[1]:
            best = (ideo["nameEn"], sim)
    return best


print("\ntop match run1:", top(x1)[0], "%.1f" % top(x1)[1])
print("top match run2:", top(x2)[0], "%.1f" % top(x2)[1])
print("\nswitched questions:", len(diffs))
for d in diffs[:12]:
    print("  q%-4d %s -> %s" % (d["id"], d["v1"], d["v2"]))