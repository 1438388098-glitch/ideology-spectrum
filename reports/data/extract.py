# -*- coding: utf-8 -*-
"""Extract JS literals (window.X = ...) into JSON. Handles BOM + multiple assignments."""
import io, json, os, re

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 站点根目录
OUT = os.path.dirname(os.path.abspath(__file__))   # 输入/输出都在本目录
os.makedirs(OUT, exist_ok=True)


def extract_literal(text, varname):
    """Find `varname = <json>` and return the parsed value via bracket matching."""
    m = re.search(re.escape(varname) + r"\s*=\s*", text)
    if not m:
        raise SystemExit("cannot find %s" % varname)
    i = m.end()
    # skip whitespace
    while i < len(text) and text[i] in " \t\r\n":
        i += 1
    if text[i] not in "[{":
        raise SystemExit("no literal after %s (got %r)" % (varname, text[i:i + 20]))
    open_ch = text[i]
    close_ch = "]" if open_ch == "[" else "}"
    depth = 0
    in_str = False
    esc = False
    j = i
    while j < len(text):
        ch = text[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
            elif ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return json.loads(text[i:j + 1])
        j += 1
    raise SystemExit("unbalanced literal for %s" % varname)


def strip_line_comments(text):
    """Remove // comments that are outside of string literals."""
    out = []
    in_str = False
    esc = False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_str:
            out.append(ch)
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        else:
            if ch == '"':
                in_str = True
                out.append(ch)
            elif ch == "/" and i + 1 < len(text) and text[i + 1] == "/":
                while i < len(text) and text[i] != "\n":
                    i += 1
                continue
            else:
                out.append(ch)
        i += 1
    return "".join(out)


def load(path):
    with io.open(path, encoding="utf-8-sig") as f:
        return f.read()


qtext = load(os.path.join(SITE, "js", "questions.js"))
itext = load(os.path.join(SITE, "js", "ideologies.js"))
atext = load(os.path.join(SITE, "js", "axes.js"))

questions = extract_literal(qtext, "window.QUESTIONS")
ideologies = extract_literal(itext, "window.IDEOLOGIES")
gov = extract_literal(strip_line_comments(itext), "window.GOV_PROFILE")
axes = extract_literal(strip_line_comments(atext), "window.AXES")

axis_keys = [a["key"] for a in axes]

def dump(name, obj):
    with io.open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)

dump("questions.json", questions)
dump("ideologies.json", ideologies)
dump("gov_profile.json", gov)
dump("axes.json", {"axes": axes, "axis_keys": axis_keys})

tot_opts = sum(len(q["options"]) for q in questions)
themes = {}
for q in questions:
    themes[q["theme"]] = themes.get(q["theme"], 0) + 1
oc = {}
for q in questions:
    oc[len(q["options"])] = oc.get(len(q["options"]), 0) + 1

max_abs = {k: 0 for k in axis_keys}
for q in questions:
    for k in axis_keys:
        mx = 0
        for o in q["options"]:
            v = o.get("scores", {}).get(k)
            if isinstance(v, int):
                mx = max(mx, abs(v))
        max_abs[k] += mx

print("questions      :", len(questions))
print("total options  :", tot_opts)
print("option-counts  :", oc)
print("themes         :", themes)
print("axis_keys      :", axis_keys)
print("ideologies     :", len(ideologies))
print("q ids min/max  :", min(q["id"] for q in questions), max(q["id"] for q in questions))
print("denominators   :", max_abs)
print("ideo fields    :", sorted(ideologies[0].keys()))
print("ideo names     :", [d.get("nameEn") for d in ideologies])
print("gov profile    :", json.dumps(gov, ensure_ascii=False)[:200])