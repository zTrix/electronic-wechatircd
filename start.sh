#!/bin/bash

cd ${0%/*} && pwd

ulimit -v 2097152
./node_modules/electron/dist/electron src/main.js
