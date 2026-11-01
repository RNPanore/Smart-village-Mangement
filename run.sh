#!/usr/bin/env bash
cd "$(dirname "$0")/backend" || exit 1
python3 -m pip install -q -r requirements.txt || exit 1
python3 app.py
