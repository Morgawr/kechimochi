#!/usr/bin/env bash
set -euo pipefail

# Each worker needs its own display and window manager: native input and focus
# belong to the display, even when WebDriver sessions and databases are separate.
if [[ "${1:-}" != '--display-ready' ]]; then
    exec xvfb-run --auto-servernum \
        --server-args='-screen 0 1280x1024x24' \
        --error-file="${SPEC_STAGE_DIR:?}/xvfb.log" \
        bash "$0" --display-ready "$@"
fi
shift

export GDK_BACKEND=x11
openbox >"${SPEC_STAGE_DIR:?}/openbox.log" 2>&1 &
for _ in {1..50}; do
    if wmctrl -m >/dev/null 2>&1; then
        echo "[e2e] Isolated native display: $DISPLAY"
        exec "$@"
    fi
    sleep 0.1
done
cat "$SPEC_STAGE_DIR/openbox.log" >&2
exit 1
