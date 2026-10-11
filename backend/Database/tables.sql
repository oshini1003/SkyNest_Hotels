-- Fresh database only: this script never drops an existing database.
CREATE DATABASE SkyNest_Hotels CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE SkyNest_Hotels;

SET FOREIGN_KEY_CHECKS = 0;

-- BRANCH

CREATE TABLE BRANCH (
    BranchID        INT AUTO_INCREMENT PRIMARY KEY,
    Name            VARCHAR(100) NOT NULL,
    Location        VARCHAR(150) NOT NULL,
    ContactNumber   VARCHAR(20)  NOT NULL
) ENGINE=InnoDB;

-- ROOM_TYPE

CREATE TABLE ROOM_TYPE (
    RoomTypeID   INT AUTO_INCREMENT PRIMARY KEY,
    Name         VARCHAR(100)   NOT NULL,
    Capacity     INT           NOT NULL CHECK (Capacity > 0),
    DailyRate    DECIMAL(10,2) NOT NULL CHECK (DailyRate >= 0)
) ENGINE=InnoDB;

-- AMENITY  +  ROOM_TYPE_AMENITY

CREATE TABLE AMENITY (
    AmenityID    INT AUTO_INCREMENT PRIMARY KEY,
    AmenityName  VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE ROOM_TYPE_AMENITY (
    RoomTypeID  INT NOT NULL,
    AmenityID   INT NOT NULL,
    PRIMARY KEY (RoomTypeID, AmenityID),
    FOREIGN KEY (RoomTypeID) REFERENCES ROOM_TYPE(RoomTypeID) ON DELETE CASCADE,
    FOREIGN KEY (AmenityID)  REFERENCES AMENITY(AmenityID)   ON DELETE CASCADE
) ENGINE=InnoDB;

-- ROOM

CREATE TABLE ROOM (
    RoomID       INT AUTO_INCREMENT PRIMARY KEY,
    BranchID     INT NOT NULL,
    RoomTypeID   INT NOT NULL,
    RoomNumber   VARCHAR(10) NOT NULL,
    RoomStatus   ENUM('Available','Occupied','Maintenance') NOT NULL DEFAULT 'Available',
    UNIQUE KEY uq_room_branch_number (BranchID, RoomNumber),
    FOREIGN KEY (BranchID)   REFERENCES BRANCH(BranchID),
    FOREIGN KEY (RoomTypeID) REFERENCES ROOM_TYPE(RoomTypeID)
) ENGINE=InnoDB;


-- GUEST  +  GUEST_ACCOUNT

CREATE TABLE GUEST (
    GuestID         INT AUTO_INCREMENT PRIMARY KEY,
    Name            VARCHAR(100) NOT NULL,
    ContactNumber   VARCHAR(20)  NOT NULL,
    Email           VARCHAR(150),
    IDNumber        VARCHAR(30)  NOT NULL UNIQUE,
    Address         VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE GUEST_ACCOUNT (
    GuestID        INT PRIMARY KEY,
    Username       VARCHAR(60)  NOT NULL UNIQUE,
    PasswordHash   VARCHAR(255) NOT NULL,
    FOREIGN KEY (GuestID) REFERENCES GUEST(GuestID) ON DELETE CASCADE
) ENGINE=InnoDB;

-- STAFF  +  STAFF_ACCOUNT (1-to-1 login extension)

CREATE TABLE STAFF (
    StaffID   INT AUTO_INCREMENT PRIMARY KEY,
    BranchID  INT NULL,   -- NULL allowed for Admin/Manager overseeing all branches
    Name      VARCHAR(100) NOT NULL,
    Role      ENUM('Admin','Manager','Receptionist','ServiceStaff') NOT NULL,
    Email     VARCHAR(150),
    FOREIGN KEY (BranchID) REFERENCES BRANCH(BranchID)
) ENGINE=InnoDB;

CREATE TABLE STAFF_ACCOUNT (
    StaffID        INT PRIMARY KEY,
    Username       VARCHAR(60)  NOT NULL UNIQUE,
    PasswordHash   VARCHAR(255) NOT NULL,
    FOREIGN KEY (StaffID) REFERENCES STAFF(StaffID) ON DELETE CASCADE
) ENGINE=InnoDB;

-- SERVICE_CATALOGUE

CREATE TABLE SERVICE_CATALOGUE (
    ServiceID     INT AUTO_INCREMENT PRIMARY KEY,
    ServiceName   VARCHAR(100)  NOT NULL,
    Description   VARCHAR(255),
    UnitPrice     DECIMAL(10,2) NOT NULL CHECK (UnitPrice >= 0),
    IsActive      BOOLEAN       NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- BOOKING  (BookingStatus lives here; per-room stay dates live on BOOKED_ROOMS)

CREATE TABLE BOOKING (
    BookingID              INT AUTO_INCREMENT PRIMARY KEY,
    GuestID                INT NOT NULL,
    StaffID                INT NULL,  -- NULL = self-service booking made by the guest online
    BookingStatus          ENUM('Booked','Checked-In','Checked-Out','Cancelled') NOT NULL DEFAULT 'Booked',
    BookingDate            DATE NOT NULL DEFAULT (CURRENT_DATE),
    PreferredPaymentMethod ENUM('Cash','Card','Bank Transfer') NOT NULL,
    CreatedDate            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (GuestID) REFERENCES GUEST(GuestID),
    FOREIGN KEY (StaffID) REFERENCES STAFF(StaffID)
) ENGINE=InnoDB;


-- BOOKED_ROOMS  (bridge table: a booking can span multiple rooms; each row
--                carries the actual stay window and headcount for that room)

CREATE TABLE BOOKED_ROOMS (
    BookedRoomID     INT AUTO_INCREMENT PRIMARY KEY,
    BookingID        INT NOT NULL,
    RoomID           INT NOT NULL,
    CheckInDateTime  DATETIME NOT NULL,
    CheckOutDateTime DATETIME NOT NULL,
    GuestCount       INT NOT NULL DEFAULT 1 CHECK (GuestCount > 0),
    CHECK (CheckOutDateTime > CheckInDateTime),
    FOREIGN KEY (BookingID) REFERENCES BOOKING(BookingID) ON DELETE CASCADE,
    FOREIGN KEY (RoomID)    REFERENCES ROOM(RoomID)
) ENGINE=InnoDB;

-- SERVICE_USAGE

CREATE TABLE SERVICE_USAGE (
    UsageID        INT AUTO_INCREMENT PRIMARY KEY,
    BookingID      INT NOT NULL,
    ServiceID      INT NOT NULL,
    UsageDate      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Quantity       INT NOT NULL CHECK (Quantity > 0),
    PriceAtUsage   DECIMAL(10,2) NOT NULL,   -- captured at insert time, never re-derived
    FOREIGN KEY (BookingID) REFERENCES BOOKING(BookingID),
    FOREIGN KEY (ServiceID) REFERENCES SERVICE_CATALOGUE(ServiceID)
) ENGINE=InnoDB;

-- BILL  (one live bill per booking, opened at check-in and finalised at checkout)

CREATE TABLE BILL (
    BillID          INT AUTO_INCREMENT PRIMARY KEY,
    BookingID       INT NOT NULL UNIQUE,
    StaffID         INT NULL,  -- staff member who processed the checkout/bill
    RoomCharges     DECIMAL(10,2) NOT NULL,
    ServiceCharges  DECIMAL(10,2) NOT NULL,
    TotalAmount     DECIMAL(10,2) NOT NULL,
    BillStatus      ENUM('Paid','Partially Paid','Unpaid') NOT NULL DEFAULT 'Unpaid',
    GeneratedDate   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (BookingID) REFERENCES BOOKING(BookingID),
    FOREIGN KEY (StaffID)   REFERENCES STAFF(StaffID)
) ENGINE=InnoDB;

-- PAYMENT

CREATE TABLE PAYMENT (
    PaymentID       INT AUTO_INCREMENT PRIMARY KEY,
    BookingID       INT NOT NULL,
    BillID          INT NOT NULL,
    PaymentType     ENUM('Full','Partial') NOT NULL,
    Amount          DECIMAL(10,2) NOT NULL CHECK (Amount > 0),
    PaymentDate     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PaymentMethod   ENUM('Cash','Card','Bank Transfer') NOT NULL,
    FOREIGN KEY (BookingID) REFERENCES BOOKING(BookingID),
    FOREIGN KEY (BillID)    REFERENCES BILL(BillID)
) ENGINE=InnoDB;

-- Successful workflow events only. Paired entries share OperationID and commit
-- with the business change. Existing history is not reconstructed or attributed.
CREATE TABLE AUDIT_LOG (
    AuditID        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    OperationID    CHAR(36) NOT NULL,
    ActorType      ENUM('staff','guest') NOT NULL,
    StaffID        INT NULL,
    GuestID        INT NULL,
    BookingID      INT NOT NULL,
    Action         VARCHAR(64) NOT NULL,
    TableAffected  VARCHAR(32) NOT NULL,
    RecordID       INT NOT NULL,
    OldValues      JSON NULL,
    NewValues      JSON NOT NULL,
    Details        VARCHAR(255) NOT NULL,
    CreatedAt      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT chk_audit_actor CHECK (
        (ActorType = 'staff' AND StaffID IS NOT NULL AND GuestID IS NULL)
        OR (ActorType = 'guest' AND GuestID IS NOT NULL AND StaffID IS NULL)
    ),
    FOREIGN KEY (StaffID) REFERENCES STAFF(StaffID),
    FOREIGN KEY (GuestID) REFERENCES GUEST(GuestID),
    FOREIGN KEY (BookingID) REFERENCES BOOKING(BookingID),
    INDEX idx_audit_booking_created (BookingID, CreatedAt, AuditID),
    INDEX idx_audit_staff_created (StaffID, CreatedAt),
    INDEX idx_audit_operation (OperationID)
) ENGINE=InnoDB;

-- REFRESH_TOKEN (Token stores a SHA-256 hex digest, not a usable refresh token)

CREATE TABLE REFRESH_TOKEN (
    TokenID         INT AUTO_INCREMENT PRIMARY KEY,
    UserType        ENUM('guest', 'staff') NOT NULL,
    UserID          INT NOT NULL,
    Token           VARCHAR(500) NOT NULL UNIQUE,
    ExpiresAt       DATETIME NOT NULL,
    RevokedAt       DATETIME NULL,
    CreatedAt       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_refresh_token (Token),
    INDEX idx_user_tokens (UserType, UserID)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- INDEXES (support the SRS's most frequent queries)

CREATE INDEX idx_bookedrooms_room_dates ON BOOKED_ROOMS(RoomID, CheckInDateTime, CheckOutDateTime);
CREATE INDEX idx_bookedrooms_booking    ON BOOKED_ROOMS(BookingID);
CREATE INDEX idx_booking_status         ON BOOKING(BookingStatus);
CREATE INDEX idx_room_branch_type_status ON ROOM(BranchID, RoomTypeID, RoomStatus);
CREATE INDEX idx_serviceusage_booking   ON SERVICE_USAGE(BookingID);
CREATE INDEX idx_serviceusage_service_date ON SERVICE_USAGE(ServiceID, UsageDate);
CREATE INDEX idx_payment_booking        ON PAYMENT(BookingID);
CREATE INDEX idx_payment_bill           ON PAYMENT(BillID);
CREATE INDEX idx_payment_date           ON PAYMENT(PaymentDate);


