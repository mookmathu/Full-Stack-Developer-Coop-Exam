CREATE TABLE drivers (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  license_number VARCHAR(50) UNIQUE NOT NULL,
  license_expires_at DATE NOT NULL,
  phone VARCHAR(20) NOT NULL,
  status ENUM('ACTIVE','INACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE vehicles (
  id VARCHAR(36) PRIMARY KEY,
  license_plate VARCHAR(20) UNIQUE NOT NULL,
  type ENUM('TRUCK','VAN','MOTORCYCLE','PICKUP') NOT NULL,
  status ENUM('ACTIVE','IDLE','MAINTENANCE','RETIRED') NOT NULL DEFAULT 'IDLE',
  driver_id VARCHAR(36),
  brand VARCHAR(50),
  model VARCHAR(50),
  year SMALLINT,
  fuel_type ENUM('DIESEL','GASOLINE','ELECTRIC','HYBRID'),
  mileage_km INT NOT NULL DEFAULT 0,
  last_service_km INT,
  next_service_km INT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);

CREATE TABLE trips (
  id VARCHAR(36) PRIMARY KEY,
  vehicle_id VARCHAR(36) NOT NULL,
  driver_id VARCHAR(36) NOT NULL,
  status ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED')
    NOT NULL DEFAULT 'SCHEDULED',
  origin VARCHAR(100) NOT NULL,
  destination VARCHAR(100) NOT NULL,
  distance_km DECIMAL(8,2),
  cargo_type ENUM('GENERAL','FRAGILE','HAZARDOUS','REFRIGERATED'),
  cargo_weight_kg DECIMAL(8,2),
  started_at DATETIME,
  ended_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY (driver_id) REFERENCES drivers(id)
);

CREATE TABLE checkpoints (
  id VARCHAR(36) PRIMARY KEY,
  trip_id VARCHAR(36) NOT NULL,
  sequence TINYINT NOT NULL,
  status ENUM('PENDING','ARRIVED','DEPARTED','SKIPPED') NOT NULL DEFAULT 'PENDING',
  location_name VARCHAR(100) NOT NULL,
  latitude DECIMAL(9,6),
  longitude DECIMAL(9,6),
  purpose ENUM('FUEL','REST','DELIVERY','PICKUP','INSPECTION'),
  notes TEXT,
  arrived_at DATETIME,
  departed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trip_id) REFERENCES trips(id),
  UNIQUE KEY uq_trip_sequence (trip_id, sequence)
);

CREATE TABLE maintenance (
  id VARCHAR(36) PRIMARY KEY,
  vehicle_id VARCHAR(36) NOT NULL,
  status ENUM('SCHEDULED','IN_PROGRESS','COMPLETED','OVERDUE')
    NOT NULL DEFAULT 'SCHEDULED',
  type ENUM('OIL_CHANGE','TIRE','BRAKE','ENGINE','INSPECTION','REPAIR') NOT NULL,
  scheduled_at DATETIME NOT NULL,
  completed_at DATETIME,
  mileage_at_service INT,
  technician VARCHAR(100),
  cost_thb DECIMAL(10,2),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE maintenance_parts (
  id VARCHAR(36) PRIMARY KEY,
  maintenance_id VARCHAR(36) NOT NULL,
  part_name VARCHAR(100) NOT NULL,
  part_number VARCHAR(50),
  quantity TINYINT NOT NULL DEFAULT 1,
  cost_thb DECIMAL(10,2),
  FOREIGN KEY (maintenance_id) REFERENCES maintenance(id)
);

CREATE TABLE users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('DISPATCHER','ADMIN') NOT NULL DEFAULT 'DISPATCHER',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_logs (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(36),
  ip_address VARCHAR(45),
  result ENUM('SUCCESS','FAIL') NOT NULL,
  detail JSON,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vehicles_status ON vehicles(status);
CREATE INDEX idx_vehicles_driver ON vehicles(driver_id);
CREATE INDEX idx_trips_vehicle ON trips(vehicle_id);
CREATE INDEX idx_trips_status ON trips(status);
CREATE INDEX idx_trips_started ON trips(started_at);
CREATE INDEX idx_checkpoints_trip ON checkpoints(trip_id);
CREATE INDEX idx_maintenance_vehicle ON maintenance(vehicle_id);
CREATE INDEX idx_maintenance_status ON maintenance(status);
CREATE INDEX idx_maintenance_scheduled ON maintenance(scheduled_at);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

