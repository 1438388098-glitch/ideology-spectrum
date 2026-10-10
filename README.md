English · [简体中文](./README.zh-CN.md)

# Ideology Spectrum 意识形态光谱

A platform that systematically catalogs the world's major political ideologies and offers an **optional 50 / 100 / 200-question test** that locates your political stance across 10 dimensions. All scoring runs client-side; the optional stats backend is pure standard-library Python with zero dependencies.

**Live demo**: <https://iweistoicqc5.top/ideology/>

## Features

- **Ideology catalog**: liberalism, conservatism, socialism, communism, anarchism, fascism, nationalism, feminism, environmentalism, religious fundamentalism, and more — each with definitions, core claims, and representative thinkers
- **Three test lengths**: 50 / 100 / 200 questions, answered one by one, each with an analysis of the ideological leaning behind your chosen option
- **10-dimension positioning**: economic left–right, social libertarian–authoritarian, progressive–traditional, globalist–nationalist, secular–religious, ecology–development, egalitarian–hierarchical, individualist–collectivist, reformist–revolutionary, pacifist–hardline
- **Matching & comparison**: similarity scores against the ideology catalog, your closest match plus top 5, and a government-fit gauge against a reference government profile
- **Country climate reference**: 10-dimension profiles of many countries, ranked by fit with your stance (reference only, not immigration advice)
- **Shareable result card**: generated with Canvas, ready to save and share
- **Stats backend**: an admin panel showing submission totals, ideology distribution, 10-axis averages, government-fit distribution, a 14-day trend, and the raw record list

## Project layout

```
ideology-site/
├── index.html            # Single-page frontend (home / catalog / test / compare)
├── css/styles.css
├── js/
│   ├── axes.js           # Definitions of the 10 dimensions
│   ├── questions.js      # Bundled question bank (200 questions × 4 options)
│   ├── ideologies.js     # Ideology catalog
│   ├── migration.js      # Country social-climate profiles
│   └── app.js            # Scoring, matching, result card, submission
├── data/batch1-5.json    # Question bank source (5 batches, 200 questions total)
├── server/
│   ├── server.py         # Backend API (Python standard library + SQLite only)
│   └── admin.html        # Admin panel (login + stats + records)
└── reports/              # A political-spectrum measurement of an LLM using this question bank, with repro scripts
```

## Run locally

The frontend is a fully static site; all scoring happens in the browser:

```bash
cd ideology-site
python -m http.server 8080
# Open http://127.0.0.1:8080
```

Backend (optional — only needed for recording submissions and stats):

```bash
cd server
ADMIN_PASSWORD=your-password python3 server.py
# Listens on 127.0.0.1:8011; data is written to data.db in the same directory
```

> The frontend calls `/api/*` via relative paths. Without a reverse proxy, submissions fail silently during local testing — answering and viewing results are unaffected.

## Deployment

The live deployment uses nginx with the frontend and backend separated:

1. Serve the frontend (`index.html`, `css/`, `js/`) from a static directory: `location ^~ /ideology/ { alias .../; }`
2. Distribute `admin.html` in the same directory; it ships with its own login page
3. Reverse-proxy `/api/` to `127.0.0.1:8011` (the backend only listens on loopback and is never exposed directly)
4. Example systemd unit for the backend:

```ini
[Service]
WorkingDirectory=/www/wwwroot/ideology/server
Environment=ADMIN_PASSWORD=your-password
ExecStart=/usr/bin/python3 /www/wwwroot/ideology/server/server.py
Restart=always
```

## API

| Method | Path | Description |
|---|---|---|
| POST | `/api/submit` | Submit a test result (public) |
| POST | `/api/login` | Admin login; issues a 12-hour token |
| GET | `/api/admin/stats?token=` | Stats overview |
| GET | `/api/admin/records?token=&page=&size=` | Paginated record list |

Example submission body (axis keys match `js/axes.js`):

```json
{
  "mode": "200",
  "username": "anonymous",
  "axes": {"ECON": 0, "SOC": 0, "PROG": 0, "GLOB": 0, "SEC": 0, "ECO": 0, "HIER": 0, "INDV": 0, "REV": 0, "PEACE": 0},
  "topMatch": {"name": "Social Democracy", "nameEn": "Social Democracy", "similarity": 85.7},
  "topMatches": [],
  "govFit": {"overall": 71.8, "grade": "broadly aligned"}
}
```

## Security notes

- The admin password is injected via the `ADMIN_PASSWORD` environment variable. **If it is unset, `/api/login` rejects every attempt.** No plaintext credentials exist in the code or this repository
- Login tokens live only in process memory and expire on restart
- The backend only listens on `127.0.0.1`; a reverse proxy is required for public access
- `server/data.db` stores visitor submissions — it is git-ignored; never commit or publish it

## Smoke test

```bash
cd server
ADMIN_PASSWORD=test123 python3 server.py &

# Login: wrong password -> 401, correct password -> 200 with a token
curl -s -X POST http://127.0.0.1:8011/api/login -d '{"password":"wrong"}'
curl -s -X POST http://127.0.0.1:8011/api/login -d '{"password":"test123"}'

# Submit a record -> 200 {"ok":true,"id":1}
curl -s -X POST http://127.0.0.1:8011/api/submit -H 'Content-Type: application/json' -d '{"mode":"50","axes":{"ECON":0,"SOC":0,"PROG":0,"GLOB":0,"SEC":0,"ECO":0,"HIER":0,"INDV":0,"REV":0,"PEACE":0},"topMatch":{"name":"test"}}'

# Query stats and records with the token
curl -s "http://127.0.0.1:8011/api/admin/stats?token=<TOKEN>"
curl -s "http://127.0.0.1:8011/api/admin/records?token=<TOKEN>"
```

## Evaluation report

`reports/` includes a report and repro scripts that ran the full 200-question bank through an LLM (Jev) as a political-spectrum measurement: each question is framed as a structured multiple-choice task, then scored with the site's native logic to reconstruct a 10-dimension profile — a second use of the question bank as a tool for measuring a model's value leanings.

## Disclaimer

This site presents every ideology descriptively and neutrally; it does not advocate for or against any stance. The political spectrum is continuous, and labels are approximations. Country social-climate profiles are qualitative sketches for reference only, not immigration advice.

## License

[MIT](LICENSE)
