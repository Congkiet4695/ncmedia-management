#!/usr/bin/env bash
# Kiểm logic healthcheck (verify_routing) của deploy/deploy.sh bằng mock — không cần Docker / production.
# Chạy: bash deploy/tests/verify-healthcheck.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$HERE/../deploy.sh"
export MOCK_DIR="$(mktemp -d)"
trap 'rm -rf "$MOCK_DIR"' EXIT
mkdir -p "$MOCK_DIR/bin"

log() { printf '[deploy] %s\n' "$*"; }
err() { printf '[deploy:err] %s\n' "$*"; }

# `docker exec ncmedia-nginx sh -c SCRIPT sh URL` ⇒ chạy SCRIPT tại chỗ với wget giả.
docker() {
  [ "$1" = exec ] || return 99
  shift 2
  PATH="$MOCK_DIR/bin:$PATH" "$@"
}

# wget giả kiểu busybox: header (-S) + tiến trình ra stderr, body ra file -O. Kịch bản lấy theo URL.
cat > "$MOCK_DIR/bin/wget" <<'EOF'
#!/usr/bin/env bash
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -O) out="$2"; shift 2;; -T) shift 2;; -S) shift;; *) url="$1"; shift;; esac; done
key=$(printf '%s' "$url" | tr -c 'A-Za-z0-9' '_')
sc="$(cat "$MOCK_DIR/scenario_$key" 2>/dev/null || echo refused)"
host=$(printf '%s' "$url" | sed 's#http://##; s#/.*##')
case "$sc" in
  refused) echo "wget: can't connect to remote host: Connection refused" >&2; exit 1;;
  html200)
    printf 'Connecting to %s\n  HTTP/1.1 200 OK\n  Content-Type: text/html; charset=utf-8\n  Set-Cookie: secret=1\n' "$host" >&2
    printf '<html><script src="/_next/static/chunks/main.js"></script></html>' > "$out"; sleep 0.3  # tải body xong mới in tiến trình
    printf "saving to '%s'\nx 100%% |****|\n'%s' saved\n" "$out" "$out" >&2; exit 0;;
  redirect)
    printf 'Connecting to %s\n  HTTP/1.1 307 Temporary Redirect\n  Location: /login\nConnecting to %s\n  HTTP/1.1 200 OK\n  Content-Type: text/html; charset=utf-8\n' "$host" "$host" >&2
    printf '<html><script src="/_next/static/x.js"></script></html>' > "$out"; exit 0;;
  nginx502)
    printf 'Connecting to %s\n  HTTP/1.1 502 Bad Gateway\n  Content-Type: text/html\n' "$host" >&2
    printf '<html><center>502 Bad Gateway</center></html>' > "$out"
    echo "wget: server returned error: HTTP/1.1 502 Bad Gateway" >&2; exit 1;;
  html-no-next)
    printf 'Connecting to %s\n  HTTP/1.1 200 OK\n  Content-Type: text/html\n' "$host" >&2
    printf '<html>Cannot GET /login</html>' > "$out"; exit 0;;
  json-ok)
    printf 'Connecting to %s\n  HTTP/1.1 200 OK\n  Content-Type: application/json; charset=utf-8\n' "$host" >&2
    printf '{"success":true,"data":{"status":"ok"}}' > "$out"; exit 0;;
  json404)
    printf 'Connecting to %s\n  HTTP/1.1 404 Not Found\n  Content-Type: application/json\n' "$host" >&2
    printf '{"success":false}' > "$out"; echo "wget: server returned error: HTTP/1.1 404 Not Found" >&2; exit 1;;
esac
EOF
chmod +x "$MOCK_DIR/bin/wget"

# Nạp ĐÚNG các hàm từ deploy.sh (probe_http … verify_routing).
eval "$(awk '/^probe_http\(\) \{/{on=1} on{print} on && /^verify_routing\(\) \{/{last=1} last && /^\}/{exit}' "$DEPLOY")"

set_sc() { printf '%s' "$2" > "$MOCK_DIR/scenario_$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_')"; }
scenario() {
  set_sc http://backend:3000/api/v1/health "$1"; set_sc http://frontend:3000/login "$2"
  set_sc http://127.0.0.1/api/v1/health "$3"; set_sc http://127.0.0.1/login "$4"
}

pass=0; fail=0
expect() { # expect <label> <0|1> ...scenario
  local label="$1" want="$2" out got; shift 2; scenario "$@"
  if out="$(verify_routing 2>&1)"; then got=0; else got=1; fi
  if [ "$got" = "$want" ]; then pass=$((pass+1)); echo "✓ $label (exit $got)"; else fail=$((fail+1)); echo "✗ $label: want $want got $got"; fi
  printf '%s\n' "$out" | sed 's/^/    /'
  if printf '%s' "$out" | grep -qi 'secret'; then fail=$((fail+1)); echo "✗ $label: leaked a header value"; fi
}

expect "mọi thứ khoẻ (giống production thật)"        0 json-ok html200 json-ok html200
expect "redirect hợp lệ rồi tới trang 200"            0 json-ok redirect json-ok redirect
expect "frontend sập ⇒ nginx 502"                     1 json-ok refused json-ok nginx502
expect "nginx đẩy /login sang backend (Cannot GET)"   1 json-ok html200 json-ok html-no-next
expect "backend sập"                                  1 refused html200 nginx502 html200
expect "API route trả 404"                            1 json-ok html200 json404 html200

# Bằng chứng lỗi cũ: kiểm tra pipe + grep -q cũ thất bại trên đúng phản hồi KHOẺ.
scenario json-ok html200 json-ok html200
if docker exec ncmedia-nginx wget -S -O /dev/null http://127.0.0.1/login 2>&1 | grep -qi 'content-type: text/html'; then
  echo "(kiểm tra cũ) đạt"; else echo "(kiểm tra cũ) THẤT BẠI trên phản hồi khoẻ — status pipeline ${PIPESTATUS[*]:-?}"; fi

echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
