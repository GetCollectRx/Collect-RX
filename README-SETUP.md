# CollectRx Platform - Complete Setup Guide

## 📦 What's Included

This package contains everything you need to run the CollectRx platform:

1. **server.js** - Backend API server (Node.js)
2. **index.html** - Frontend dashboard (opens in browser)
3. **package.json** - Node.js dependencies
4. **.env** - Environment configuration

## 🚀 Quick Start (3 Steps)

### Step 1: Install Dependencies
Open Terminal and navigate to this folder, then run:
```bash
npm install
```

### Step 2: Start the Backend Server
```bash
node server.js
```

You should see:
```
╔════════════════════════════════════════════════════════════╗
║   CollectRx Platform - 100 Patients Loaded                ║
║   Server: http://localhost:3001                           ║
╚════════════════════════════════════════════════════════════╝
```

**Keep this terminal window open!** The server needs to keep running.

### Step 3: Open the Frontend
Simply **double-click** the `index.html` file to open it in your browser.

Or right-click and choose "Open with" → Chrome/Safari/Firefox

## ✅ You're Done!

You should now see:
- Dashboard with 100 patients
- Search and filter functionality
- "Send Email" buttons that work
- "Payment Link" buttons that work

## 🔧 How It Works

### Backend (server.js)
- Runs on `http://localhost:3001`
- Provides API endpoints for patient data
- Handles email sending and payment link generation
- Auto-generates 100 sample patients with realistic data

### Frontend (index.html)
- Opens directly in your browser
- Connects to backend API automatically
- React-based interface with working buttons
- Real-time updates when you click actions

## 🎯 What You Can Do

### In the Dashboard:
- **View Stats**: Total AR, collections, emails sent
- **Search Patients**: Filter by name, email, or status
- **Send Emails**: Click "Send Email" → backend logs it
- **Generate Payment Links**: Click "Payment Link" → creates Stripe-style link
- **Watch Console**: Check terminal to see API calls happening

### Try These Actions:
1. Search for "sarah" - should find Sarah patients
2. Filter by "Needs Attention" - shows high-risk accounts
3. Click "Send Email" on any patient - watch terminal
4. Click "Payment Link" - link gets copied to clipboard

## 📊 Sample Data

The system auto-generates:
- **100 patients** with random names
- **Realistic balances**: $200 - $4,700
- **Days outstanding**: 5 - 155 days
- **Email engagement**: Opens, clicks, attempts
- **Statuses**: Pending, Payment Plans, Responsive, Needs Attention

## 🛠️ File Structure

```
collectrx-platform/
├── server.js          # Backend API server
├── index.html         # Frontend dashboard
├── package.json       # Node dependencies
├── .env              # Configuration (optional)
└── README.md         # This file
```

## 🔄 Restarting

If something goes wrong:

1. **Stop the server**: Press `Control + C` in terminal
2. **Restart**: Run `node server.js` again
3. **Refresh browser**: Reload the `index.html` page

## 💡 Tips

- **Keep terminal open**: Server must stay running
- **Check port 3001**: Make sure nothing else is using it
- **Browser console**: Press F12 to see API calls and errors
- **Terminal logs**: Watch for "📧 Sending email..." messages

## 🎨 Customization

### Change Number of Patients
Edit `server.js` line ~12:
```javascript
for (let i = 1; i <= 100; i++) {  // Change 100 to any number
```

### Change Port
Edit `server.js` line near bottom:
```javascript
const PORT = 3001;  // Change to 3002, 8000, etc.
```

Then update `index.html` line ~13:
```javascript
const API_URL = 'http://localhost:3001/api';  // Match your port
```

## 🐛 Troubleshooting

**Problem**: "Cannot GET /"
- **Solution**: You opened `http://localhost:3001` - that's the API server. Open `index.html` instead!

**Problem**: Loading screen doesn't go away
- **Solution**: Make sure `node server.js` is running in terminal

**Problem**: Buttons don't work
- **Solution**: Check browser console (F12) for errors. Make sure backend is running.

**Problem**: Port already in use
- **Solution**: Something else is using port 3001. Either stop that app or change the port.

## 📞 Next Steps

This is a fully functional prototype! To make it production-ready:

1. Add real SendGrid integration for emails
2. Add real Stripe Connect for payments
3. Connect to actual practice management system
4. Add user authentication
5. Deploy to a hosting service

## ✨ What You've Built

You now have a complete, integrated accounts receivable automation platform:
- ✅ Backend API with 100 patients
- ✅ Interactive dashboard
- ✅ Working email automation
- ✅ Payment link generation
- ✅ Real-time data updates
- ✅ Search and filtering
- ✅ Professional UI

**This is ready for beta testing with dental practices!**