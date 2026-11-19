@echo off
rem WorkBuddy / other Electron hosts inject ELECTRON_RUN_AS_NODE=1 into child
rem processes, which would turn this binary into plain Node. Strip it here.
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
cd /d "%~dp0"
start "" "runtime\electron.exe" .
