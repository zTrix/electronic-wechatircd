#!/bin/bash

cd ${0%/*} && pwd

./node_modules/electron/dist/electron src/main.js
