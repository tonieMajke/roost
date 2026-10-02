#!/bin/sh
# Sprawdza, że pty.node w paczce nie wymaga glibc nowszego niż MAX (domyślnie 2.34 = Debian 12/Ubuntu 22.04+).
set -eu
MAX="${1:-2.34}"
PTY="$(dirname "$0")/../release/linux-unpacked/resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node"
[ -f "$PTY" ] || { echo "brak $PTY" >&2; exit 2; }
NEEDED="$(objdump -T "$PTY" | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1 | sed 's/GLIBC_//')"
echo "pty.node wymaga glibc <= $NEEDED (limit $MAX)"
HIGHEST="$(printf '%s\n%s\n' "$NEEDED" "$MAX" | sort -V | tail -1)"
[ "$HIGHEST" = "$MAX" ] || { echo "ZA NOWY glibc w pty.node" >&2; exit 1; }
