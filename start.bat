@echo off
title Pump.fun Multi-Wallet Interaction Tool

echo [92m=== Checking Environment ===[0m

:: Check if Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [91mError: Node.js is not installed![0m
    echo Please install Node.js from https://nodejs.org/ (version 16 or higher^)
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

:: Check Node.js version
node -v > temp.txt
set /p NODE_VERSION=<temp.txt
del temp.txt
echo [96mNode.js version: %NODE_VERSION%[0m

:: Check if npm is installed
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [91mError: npm is not installed![0m
    echo Please install Node.js which includes npm
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

echo [92m=== Checking Dependencies ===[0m

:: Check if node_modules exists
if not exist "node_modules" (
    echo [93mInstalling dependencies...[0m
    npm install
    if %errorlevel% neq 0 (
        echo [91mError installing dependencies![0m
        echo Press any key to exit...
        pause >nul
        exit /b 1
    )
) else (
    echo [92mDependencies already installed[0m
)

:: Check if required files exist
if not exist "config" mkdir config
if not exist "wallets.txt" (
    echo [93mCreating template wallets.txt...[0m
    echo # Add your wallet private keys here, one per line> wallets.txt
    echo # Example format:>> wallets.txt
    echo # 4KvGWaGBH7RZKUKVJmEgxvUqtYByHGJ8yDUPXGBZe4YhAoRJXJCQH9MzqtXHwFqQzy7rNwGUYvYd9ATpVx4zGUMJ>> wallets.txt
)

if not exist "proxies.txt" (
    echo [93mCreating template proxies.txt...[0m
    echo # Add your proxies here, one per line> proxies.txt
    echo # Supported formats:>> proxies.txt
    echo # http://username:password@host:port>> proxies.txt
    echo # socks://username:password@host:port>> proxies.txt
)

if not exist "comments.txt" (
    echo [93mCreating template comments.txt...[0m
    echo Great project! 🚀> comments.txt
    echo Amazing work! 💪>> comments.txt
    echo Looking forward to the future! 🌟>> comments.txt
    echo Incredible potential! 🔥>> comments.txt
    echo Solid team and roadmap! 👏>> comments.txt
)

echo [92m=== Starting Program ===[0m
echo [96mOpening Pump.fun Multi-Wallet Interaction Tool...[0m
echo.

:: Start the program
node main.js

:: If the program exits, wait for user input
echo.
echo [93mProgram closed. Press any key to exit...[0m
pause >nul 