#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

PREFIX="$HOME/.local"
VENV_DIR="$HOME/.local/venvs/uboot"
DTC_VERSION="v1.7.2"
BC_VERSION="7.0.3"

mkdir -p "$PREFIX/bin" "$PREFIX/lib" "$PREFIX/include" "$HOME/.local/venvs"

export PATH="$VENV_DIR/bin:$PREFIX/bin:$PATH"
export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
export LD_LIBRARY_PATH="$PREFIX/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# 1. Install Device Tree Compiler (dtc + libfdt) into ~/.local
if [ ! -x "$PREFIX/bin/dtc" ] || [ ! -f "$PREFIX/include/libfdt.h" ]; then
  tmp_dtc="$(mktemp -d)"
  trap 'rm -rf "$tmp_dtc"' EXIT
  git clone --depth 1 --branch "$DTC_VERSION" https://github.com/dgibson/dtc.git "$tmp_dtc"
  make -C "$tmp_dtc" -j"$(nproc)" \
    NO_PYTHON=1 \
    PREFIX="$PREFIX" \
    EXTRA_CFLAGS="-O2" \
    LDFLAGS="-Wl,-rpath,$PREFIX/lib" \
    install-bin install-lib install-includes
  rm -rf "$tmp_dtc"
  trap - EXIT
fi

# 2. Install bc into ~/.local if not already available
if ! command -v bc >/dev/null 2>&1; then
  tmp_bc="$(mktemp -d)"
  trap 'rm -rf "$tmp_bc"' EXIT
  git clone --depth 1 --branch "$BC_VERSION" https://github.com/gavinhoward/bc.git "$tmp_bc"
  (
    cd "$tmp_bc"
    PREFIX="$PREFIX" CC=gcc ./configure.sh -G -N -O3
    make -j"$(nproc)"
    make install
  )
  rm -rf "$tmp_bc"
  trap - EXIT
fi

# 3. Create dedicated Python virtual environment and install U-Boot Python tooling
if [ ! -x "$VENV_DIR/bin/python3" ]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv --python python3 "$VENV_DIR"
  else
    python3 -m venv "$VENV_DIR"
  fi
fi

UBOOT_PY_PKGS=(
  setuptools
  wheel
  pyelftools
  pyyaml
  jsonschema
  pytest
  pytest-xdist
  cryptography
  pycryptodomex
  kconfiglib
  requests
  filelock
  packaging
  pylibfdt
)

if command -v uv >/dev/null 2>&1; then
  uv pip install --python "$VENV_DIR/bin/python3" --quiet "${UBOOT_PY_PKGS[@]}"
else
  "$VENV_DIR/bin/pip" install --no-input --quiet "${UBOOT_PY_PKGS[@]}"
fi

# 4. Persist PATH and library paths idempotently in ~/.bashrc
touch "$HOME/.bashrc"
sed -i '/case \$- in/,/esac/d' "$HOME/.bashrc" 2>/dev/null || true

for line in \
  'export PATH="$HOME/.local/venvs/uboot/bin:$HOME/.local/bin:$PATH"' \
  'export PKG_CONFIG_PATH="$HOME/.local/lib/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"' \
  'export LD_LIBRARY_PATH="$HOME/.local/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"'
do
  grep -qxF "$line" "$HOME/.bashrc" || echo "$line" >> "$HOME/.bashrc"
done
