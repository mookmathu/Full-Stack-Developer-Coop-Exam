# Fleet Management Platform — Setup Guide

## Prerequisites
- Node.js 18+
- Docker + phpMyAdmin (MySQL)

---

## Tech Stack
# Backend #
- Node.js - ตัวรันโปรแกรมฝั่ง Server
- Express.js - Framework สำหรับสร้าง API
- MySQL — ฐานข้อมูล
- JWT + Refresh Token — ระบบ Login
- bcrypt — เข้ารหัสรหัสผ่านก่อนบันทึกลงฐานข้อมูล
- nodemon — รีสตาร์ท Server อัตโนมัติตอน Development

# Frontend #
- HTML / CSS / JavaScript 
- Bootstrap 5.3.2 — ใช้จัดการ Layout และ UI Components
- Bootstrap Icons 1.11.3 — ใช้สำหรับไอคอนต่าง ๆ

# Infrastructure #
- Docker + Docker Compose — รัน MySQL ในคอนเทนเนอร์
- phpMyAdmin — หน้าเว็บสำหรับจัดการฐานข้อมูล

---

## Step 1: Setup MySQL Database

1. เปิด phpMyAdmin ที่ `http://localhost:8080` (หรือ port ที่ใช้)
2. สร้าง database ใหม่ชื่อ `fleet_db`
3. เปิด **SQL** tab แล้ว copy ทั้งหมดจากไฟล์ `database/schema.sql` แล้ว Execute
4. ตรวจสอบว่ามี tables ครบ 11 ตาราง

---

## Step 2: Configure Backend

1. เปิดไฟล์ `backend/.env`
2. แก้ค่าให้ตรงกับ Docker MySQL:
   ```
   DB_HOST=localhost
   DB_PORT=3306          # หรือ port ที่ map ออกมา
   DB_USER=root
   DB_PASSWORD=your_docker_password
   DB_NAME=fleet_db
   ```

---

## Step 3: Install & Run Backend

```bash
cd backend
npm install
npm run dev
```

Backend จะรันที่ `http://localhost:3000`
ถ้า MySQL connect สำเร็จจะเห็น: `✅ MySQL connected successfully`

---

## Step 4: Open Frontend

วิธีที่ง่ายที่สุด — ใช้ **Live Server** extension ใน VS Code:
1. คลิกขวาที่ `frontend/public/index.html`
2. เลือก "Open with Live Server"
3. Browser จะเปิดที่ `http://localhost:5500`

**หรือ** ใช้ any static file server:
```bash
cd frontend/public
npx serve .   # รันที่ port 3000 (อาจชนกับ backend — ใช้ port อื่น)
```

---

## Login Credentials (Seed Data)

| Username    | Password   | Role       |
|-------------|------------|------------|
| admin       | admin1234  | Admin      |
| dispatcher1 | admin1234  | Dispatcher |

---

## Project Structure

```
fleet-management/
├── backend/
│   ├── src/
│   │   ├── app.js                    # Express entry point + all routes
│   │   ├── config/database.js        # MySQL connection pool
│   │   ├── middleware/
│   │   │   ├── auth.js               # JWT verify + role permissions
│   │   │   └── auditLog.js           # Append-only audit logger
│   │   ├── controllers/
│   │   │   ├── authController.js     # login, refresh, logout
│   │   │   ├── vehicleController.js  # CRUD + status transition + history
│   │   │   ├── tripController.js     # trip + checkpoint logic
│   │   │   ├── driverController.js   # driver CRUD
│   │   │   └── alertController.js    # alerts + dashboard + audit + maintenance
│   │   ├── services/
│   │   │   └── alertEngine.js        # Extensible rule engine (runs every 5 min)
│   │   └── utils/response.js         # Standard error/success response helpers
│   └── .env
├── frontend/public/
│   ├── index.html                    # Login page
│   ├── css/main.css                  # Blue/white theme
│   ├── js/
│   │   ├── fleet-api.js              # API client + token refresh + helpers
│   │   └── sidebar.js                # Shared sidebar component
│   └── pages/
│       ├── dashboard.html            # Summary metrics + charts
│       ├── vehicles.html             # Vehicle list + filters + status transition
│       ├── drivers.html              # Driver management
│       ├── trips.html                # Trip list + tracker + multi-step form
│       ├── maintenance.html          # Schedule + alert panel
│       ├── alerts.html               # Alert management
│       └── audit.html                # Audit log viewer
└── database/
    └── schema.sql                    # Complete DB schema + seed data
```

---

## Adding a New Alert Rule (No Code Changes Needed)

เพียงแค่ INSERT ลง `alert_rules` table:
```sql
INSERT INTO alert_rules (rule_key, name, severity, config) VALUES (
  'my_new_rule',
  'My Custom Alert',
  'WARNING',
  '{"message_tpl": "Custom alert for {id}", "threshold": 100}'
);
```

แล้วเพิ่ม checker function ใน `alertEngine.js`:
```js
my_new_rule: async (rule, config) => {
  // query DB แล้ว return array of alert objects
  return [];
}
```

---

## Key Business Rules Implemented

- ✅ Vehicle 1 คัน = 1 trip ในเวลาเดียวกัน
- ✅ Driver license หมดอายุ → ไม่สามารถ assign trip
- ✅ Trip complete → update mileage + check maintenance threshold (ใน transaction เดียว)
- ✅ Vehicle status transition validation (IDLE→ACTIVE→IDLE, etc.)
- ✅ Checkpoint sequence: PENDING → ARRIVED → DEPARTED เท่านั้น
- ✅ Audit log append-only (MySQL trigger ป้องกัน UPDATE/DELETE)
- ✅ Dispatcher เห็น audit log ของตัวเองเท่านั้น
- ✅ Alert engine extensible ไม่ต้องแก้ core code
- ✅ Filter state restore จาก URL on reload
- ✅ JWT 15min + Refresh Token 7 days + httpOnly cookie
