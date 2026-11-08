#!/bin/bash
# ==============================================================================
# Demo Shell Script for the terminal
# Demonstrating Linux bash scripting parity
# ==============================================================================

echo "Starting test.sh..."
echo "Running in: $PWD"
echo "Script path (\$0): $0"
echo "Total arguments passed (\$#): $#"

if [ -n "$1" ]; then
  echo "Greeting argument received: $1"
else
  echo "Tip: You can pass arguments to scripts! (e.g. ./test.sh 'Hello World')"
fi

echo ""
echo "--- Checking Virtual Filesystem ---"
if [ -d "games" ]; then
  echo " 'games' directory detected in current path."
  echo "Scanning available games:"
  for game in sokoban invaders tetris minesweeper; do
    echo "  * $game"
  done
else
  echo "Notice: 'games' directory not found in current directory."
fi

if [ -d "blogs" ]; then
  echo "'blogs' directory found!"
fi

echo ""
echo "--- Testing ---"
COUNT=0
for step in "Compiling VFS" "Checking Permissions" "Validating Subshell"; do
  COUNT=1
  echo "  [OK] $step"
done

echo ""
echo "Shell script executed successfully!"
echo "Feel free to create and edit your own scripts using 'nano' or 'vim'!"
echo "Try running: nano my_script.sh to also view the script"
