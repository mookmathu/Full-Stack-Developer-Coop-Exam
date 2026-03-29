-- ============================================================
-- Fleet Management Platform - Database Schema
-- Engine: MySQL 8.0+  |  Charset: utf8mb4
-- ============================================================

CREATE DATABASE IF NOT EXISTS fleet_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fleet_db;

-- ------------------------------------------------------------
-- 1. USERS & AUTH
-- ------------------------------------------------------------
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','dispatcher') NOT NULL DEFAULT 'dispatcher',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,
  expires_at  DATETIME NOT NULL,
  is_revoked  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 2. DRIVERS
-- (drivers first because vehicles FK to drivers)
-- ------------------------------------------------------------
CREATE TABLE drivers (
  id                 VARCHAR(20) PRIMARY KEY,   -- e.g. drv_001
  name               VARCHAR(150) NOT NULL,
  license_number     VARCHAR(50)  NOT NULL UNIQUE,
  license_expires_at DATE         NOT NULL,
  phone              VARCHAR(20),
  status             ENUM('available','on_trip','inactive') NOT NULL DEFAULT 'available',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 3. VEHICLES
-- ------------------------------------------------------------
CREATE TABLE vehicles (
  id               VARCHAR(20) PRIMARY KEY,   -- e.g. veh_001
  license_plate    VARCHAR(20)  NOT NULL UNIQUE,
  type             ENUM('TRUCK','VAN','MOTORCYCLE','PICKUP') NOT NULL,
  status           ENUM('ACTIVE','IDLE','MAINTENANCE','RETIRED') NOT NULL DEFAULT 'IDLE',
  driver_id        VARCHAR(20),
  brand            VARCHAR(100),
  model            VARCHAR(100),
  year             YEAR,
  fuel_type        ENUM('DIESEL','GASOLINE','ELECTRIC','HYBRID'),
  mileage_km       FLOAT        NOT NULL DEFAULT 0,
  last_service_km  FLOAT        NOT NULL DEFAULT 0,
  next_service_km  FLOAT        NOT NULL DEFAULT 0,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 4. TRIPS
-- ------------------------------------------------------------
CREATE TABLE trips (
  id                   VARCHAR(20) PRIMARY KEY,   -- e.g. trp_001
  vehicle_id           VARCHAR(20) NOT NULL,
  driver_id            VARCHAR(20) NOT NULL,
  status               ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
  origin               VARCHAR(255) NOT NULL,
  destination          VARCHAR(255) NOT NULL,
  distance_km          FLOAT,
  cargo_type           ENUM('GENERAL','FRAGILE','HAZARDOUS','REFRIGERATED'),
  cargo_weight_kg      FLOAT,
  estimated_duration_min INT,
  started_at           DATETIME,
  ended_at             DATETIME,
  created_by           INT,                        -- user_id
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (driver_id)  REFERENCES drivers(id),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Trip draft: stores multi-step form state per user session
-- ใช้สำหรับ multi-step form ที่ต้องการ persist ระหว่าง step
CREATE TABLE trip_drafts (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT         NOT NULL,
  session_key  VARCHAR(64) NOT NULL,   -- random UUID ต่อ session การสร้าง trip
  step1_data   JSON,                   -- { vehicle_id, driver_id }
  step2_data   JSON,                   -- { origin, destination, cargo_type, ... }
  current_step TINYINT NOT NULL DEFAULT 1,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_session (user_id, session_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 5. CHECKPOINTS
-- ------------------------------------------------------------
CREATE TABLE checkpoints (
  id            VARCHAR(20) PRIMARY KEY,   -- e.g. chk_001
  trip_id       VARCHAR(20) NOT NULL,
  sequence      INT         NOT NULL,
  status        ENUM('PENDING','ARRIVED','DEPARTED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  location_name VARCHAR(255) NOT NULL,
  latitude      DECIMAL(10,7),
  longitude     DECIMAL(10,7),
  purpose       ENUM('FUEL','REST','DELIVERY','PICKUP','INSPECTION'),
  notes         TEXT,
  arrived_at    DATETIME,
  departed_at   DATETIME,
  FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
  UNIQUE KEY uq_trip_seq (trip_id, sequence)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 6. MAINTENANCES
-- ------------------------------------------------------------
CREATE TABLE maintenances (
  id                VARCHAR(20) PRIMARY KEY,   -- e.g. mnt_001
  vehicle_id        VARCHAR(20) NOT NULL,
  status            ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','OVERDUE') NOT NULL DEFAULT 'SCHEDULED',
  type              ENUM('OIL_CHANGE','TIRE','BRAKE','ENGINE','INSPECTION','REPAIR') NOT NULL,
  scheduled_at      DATETIME    NOT NULL,
  mileage_at_service FLOAT,
  technician        VARCHAR(150),
  cost_thb          DECIMAL(12,2),
  notes             TEXT,
  parts_replaced    JSON,                      -- array of part strings
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 7. ALERT ENGINE
-- alert_rules = config ของแต่ละ rule (ไม่ต้องแตะ code เพื่อเพิ่ม rule)
-- alerts      = instance ที่ถูก trigger แล้ว
-- ------------------------------------------------------------
CREATE TABLE alert_rules (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  rule_key   VARCHAR(50) NOT NULL UNIQUE,   -- e.g. 'vehicle_due_service'
  name       VARCHAR(150) NOT NULL,
  severity   ENUM('WARNING','CRITICAL') NOT NULL DEFAULT 'WARNING',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  config     JSON,          -- threshold, message template, etc.
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE alerts (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  rule_id               INT         NOT NULL,
  affected_resource_type ENUM('vehicle','driver','trip','maintenance') NOT NULL,
  affected_resource_id  VARCHAR(20) NOT NULL,
  message               TEXT        NOT NULL,
  severity              ENUM('WARNING','CRITICAL') NOT NULL,
  is_read               BOOLEAN     NOT NULL DEFAULT FALSE,
  triggered_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 8. AUDIT LOGS (append-only — ห้าม UPDATE/DELETE)
-- ------------------------------------------------------------
CREATE TABLE audit_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT,                          -- NULL = system action
  action        VARCHAR(50)  NOT NULL,        -- e.g. LOGIN_SUCCESS, VEHICLE_CREATED
  resource_type VARCHAR(50),
  resource_id   VARCHAR(20),
  old_values    JSON,
  new_values    JSON,
  ip_address    VARCHAR(45),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Prevent UPDATE and DELETE on audit_logs via trigger
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: UPDATE not allowed';

CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only: DELETE not allowed';

-- ============================================================
-- SEED DATA
-- ============================================================

-- Admin user: password = "admin1234"
INSERT INTO users (username, password_hash, role) VALUES
('admin',      '$2b$10$rQZ9uAVn8L.YoUO1qMVJ4eKjF5kLpNvXsBq3iA7mWcYhDxGeZtS3u', 'admin'),
('dispatcher1','$2b$10$rQZ9uAVn8L.YoUO1qMVJ4eKjF5kLpNvXsBq3iA7mWcYhDxGeZtS3u', 'dispatcher');

-- Drivers
INSERT INTO drivers (id, name, license_number, license_expires_at, phone, status) VALUES
('drv_001', 'สมชาย ใจดี',    'DL-TH-001234', '2025-06-30', '081-234-5678', 'available'),
('drv_002', 'วิชัย มั่นคง',   'DL-TH-005678', '2026-12-31', '082-345-6789', 'available'),
('drv_003', 'ประสิทธิ์ เร็วไว','DL-TH-009012', '2024-03-15', '083-456-7890', 'available');

-- Vehicles
INSERT INTO vehicles (id, license_plate, type, status, driver_id, brand, model, year, fuel_type, mileage_km, last_service_km, next_service_km) VALUES
('veh_001', 'กข-1234', 'TRUCK',      'IDLE',        'drv_001', 'Isuzu',  'D-Max',    2020, 'DIESEL',   45230, 40000, 50000),
('veh_002', 'คง-5678', 'VAN',        'ACTIVE',      'drv_002', 'Toyota', 'HiAce',    2021, 'GASOLINE', 28900, 25000, 35000),
('veh_003', 'จฉ-9012', 'PICKUP',     'MAINTENANCE', NULL,      'Ford',   'Ranger',   2019, 'DIESEL',   62100, 60000, 70000),
('veh_004', 'ชซ-3456', 'MOTORCYCLE', 'IDLE',        'drv_003', 'Honda',  'CB500',    2022, 'GASOLINE',  8400,  5000, 10000);

-- Trips
INSERT INTO trips (id, vehicle_id, driver_id, status, origin, destination, distance_km, cargo_type, cargo_weight_kg, estimated_duration_min, started_at, created_by) VALUES
('trp_001', 'veh_002', 'drv_002', 'IN_PROGRESS', 'กรุงเทพฯ', 'เชียงใหม่', 696, 'GENERAL',    1500, 480, NOW() - INTERVAL 3 HOUR, 1),
('trp_002', 'veh_001', 'drv_001', 'SCHEDULED',   'กรุงเทพฯ', 'ขอนแก่น',   445, 'FRAGILE',    800,  360, NULL, 1);

-- Checkpoints
INSERT INTO checkpoints (id, trip_id, sequence, status, location_name, latitude, longitude, purpose) VALUES
('chk_001', 'trp_001', 1, 'DEPARTED', 'นครสวรรค์', 15.7047, 100.1372, 'FUEL'),
('chk_002', 'trp_001', 2, 'ARRIVED',  'ลำปาง',     18.2888, 99.4900,  'REST'),
('chk_003', 'trp_001', 3, 'PENDING',  'เชียงใหม่',  18.7883, 98.9853,  'DELIVERY');

-- Maintenances
INSERT INTO maintenances (id, vehicle_id, status, type, scheduled_at, mileage_at_service, technician, notes) VALUES
('mnt_001', 'veh_003', 'SCHEDULED',   'OIL_CHANGE', NOW() + INTERVAL 2 DAY,  62000, 'ช่างสมชาย', 'เปลี่ยนถ่ายน้ำมันเครื่อง'),
('mnt_002', 'veh_001', 'SCHEDULED',   'TIRE',       NOW() - INTERVAL 5 DAY,  45000, 'ช่างวิชัย',  'เปลี่ยนยาง 4 เส้น'),
('mnt_003', 'veh_004', 'IN_PROGRESS', 'INSPECTION', NOW() - INTERVAL 1 DAY,   8000, 'ช่างประสิทธิ์','ตรวจสภาพประจำปี');

-- Alert rules (extensible — เพิ่ม rule ใหม่แค่ INSERT ที่นี่)
INSERT INTO alert_rules (rule_key, name, severity, config) VALUES
('vehicle_due_service',  'Vehicle Due for Service',   'WARNING',  JSON_OBJECT('message_tpl', 'Vehicle {id} is due for service (mileage: {mileage} km)')),
('overdue_maintenance',  'Overdue Maintenance',        'CRITICAL', JSON_OBJECT('threshold_days', 3, 'message_tpl', 'Maintenance {id} is overdue by {days} days')),
('license_expiring_soon','License Expiring Soon',      'WARNING',  JSON_OBJECT('threshold_days', 30, 'message_tpl', 'Driver {name} license expires in {days} days')),
('trip_delayed',         'Trip Delayed',               'CRITICAL', JSON_OBJECT('threshold_pct', 150, 'message_tpl', 'Trip {id} has exceeded {pct}% of estimated duration'));
