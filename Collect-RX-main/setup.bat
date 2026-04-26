@echo off
echo =====================================
echo Dental A/R System Setup
echo =====================================
echo.

echo [1/4] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo Error: npm install failed
    pause
    exit /b %errorlevel%
)

echo.
echo [2/4] Generating Prisma client...
call npm run db:generate
if %errorlevel% neq 0 (
    echo Error: Prisma generate failed
    pause
    exit /b %errorlevel%
)

echo.
echo [3/4] Creating database...
call npm run db:push
if %errorlevel% neq 0 (
    echo Error: Database creation failed
    pause
    exit /b %errorlevel%
)

echo.
echo [4/4] Seeding database...
call npm run db:seed
if %errorlevel% neq 0 (
    echo Error: Database seeding failed
    pause
    exit /b %errorlevel%
)

echo.
echo =====================================
echo Setup Complete!
echo =====================================
echo.
echo To start the application, run:
echo   npm run dev
echo.
echo Then open your browser to:
echo   http://localhost:5173
echo.
pause
