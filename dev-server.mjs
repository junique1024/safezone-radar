// 로컬 확인용: node dev-server.mjs → http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import handler from "./api/state.js";
const root = path.resolve("public");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".csv": "text/csv; charset=utf-8" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/state") return handler(req, res);
  let p = path.join(root, decodeURIComponent(u.pathname));
  if (!p.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
  fs.createReadStream(p).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log("http://localhost:" + (process.env.PORT || 3000)));
