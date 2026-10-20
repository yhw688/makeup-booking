# OrlandoYHMakeup — Booking Platform

https://yihan-makeup.onrender.com/

Full-stack appointment booking system built with **Node.js, Express, SQLite, and SendGrid**.

## Tech Stack
- **Backend**: Node.js + Express
- **Database**: SQLite (via `better-sqlite3`) — stores client records, service types, booking dates, messages
- **Email**: SendGrid API — automated confirmation emails to client + artist alert
- **Frontend**: Vanilla JS + HTML/CSS — `fetch()` calls REST API

---

## Project Structure

```
makeup-booking/
├── server.js                  # Express entry point
├── db/
│   └── database.js            # SQLite init & schema
├── routes/
│   └── appointments.js        # REST API endpoints
├── utils/
│   └── mailer.js              # SendGrid email functions
├── public/
│   ├── index.html             # Frontend (served as static)
│   └── style.css
├── .env.example               # Environment variable template
└── package.json
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env and fill in your SendGrid API key
```

### 3. Get a SendGrid API key
1. Sign up at [sendgrid.com](https://sendgrid.com) (free tier: 100 emails/day)
2. Go to **Settings → API Keys → Create API Key**
3. Verify your sender email (`yihans.art@gmail.com`) under **Sender Authentication**
4. Paste the key into `.env`

### 4. Run
```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

Open → http://localhost:3000

---

## REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/appointments` | Create new booking + send emails |
| `GET` | `/api/appointments` | List all appointments |
| `GET` | `/api/appointments/:id` | Get single appointment |
| `PATCH` | `/api/appointments/:id/status` | Update status (pending/confirmed/cancelled) |
| `GET` | `/api/health` | Health check |

### Example POST body
```json
{
  "name":    "Jane Smith",
  "email":   "jane@example.com",
  "date":    "2025-09-15",
  "service": "bridal-makeup",
  "message": "I'd love a romantic, soft glam look!"
}
```

### Example response
```json
{
  "success": true,
  "message": "Appointment created! A confirmation email is on its way.",
  "data": {
    "id": 1,
    "name": "Jane Smith",
    "email": "jane@example.com",
    "date": "2025-09-15",
    "service": "bridal-makeup",
    "message": "I'd love a romantic, soft glam look!"
  }
}
```

---

## Deployment (Render / Railway)

1. Push this folder to a GitHub repo
2. Connect to [render.com](https://render.com) or [railway.app](https://railway.app)
3. Set environment variables in the dashboard
4. Deploy — the platform auto-runs `npm start`
