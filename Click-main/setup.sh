#!/bin/bash

echo "====================================="
echo "Dental A/R System Setup"
echo "====================================="
echo ""

echo "[1/4] Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "Error: npm install failed"
    exit 1
fi

echo ""
echo "[2/4] Generating Prisma client..."
npm run db:generate
if [ $? -ne 0 ]; then
    echo "Error: Prisma generate failed"
    exit 1
fi

echo ""
echo "[3/4] Creating database..."
npm run db:push
if [ $? -ne 0 ]; then
    echo "Error: Database creation failed"
    exit 1
fi

echo ""
echo "[4/4] Seeding database..."
npm run db:seed
if [ $? -ne 0 ]; then
    echo "Error: Database seeding failed"
    exit 1
fi

echo ""
echo "====================================="
echo "Setup Complete!"
echo "====================================="
echo ""
echo "To start the application, run:"
echo "  npm run dev"
echo ""
echo "Then open your browser to:"
echo "  http://localhost:5173"
echo ""
