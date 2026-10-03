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

-- (nights stayed in that room x that room type's daily rate)
DELIMITER //

CREATE FUNCTION fn_calculate_room_charges(p_booking_id INT)
RETURNS DECIMAL(10,2) DETERMINISTIC READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(10,2);
    SELECT IFNULL(SUM(
        GREATEST(DATEDIFF(br.CheckOutDateTime, br.CheckInDateTime), 1) * rt.DailyRate
    ), 0) INTO v_total
    FROM BOOKED_ROOMS br
    JOIN ROOM r      ON r.RoomID = br.RoomID
    JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
    WHERE br.BookingID = p_booking_id;
    RETURN v_total;
END //

-- Service charges for a booking = sum(Quantity x PriceAtUsage)
CREATE FUNCTION fn_calculate_service_charges(p_booking_id INT)
RETURNS DECIMAL(10,2) DETERMINISTIC READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(10,2);
    SELECT IFNULL(SUM(Quantity * PriceAtUsage), 0) INTO v_total
    FROM SERVICE_USAGE WHERE BookingID = p_booking_id;
    RETURN v_total;
END //

-- Full bill total = room charges + service charges
CREATE FUNCTION fn_calculate_bill_total(p_booking_id INT)
RETURNS DECIMAL(10,2) DETERMINISTIC READS SQL DATA
BEGIN
    RETURN fn_calculate_room_charges(p_booking_id) + fn_calculate_service_charges(p_booking_id);
END //

-- Outstanding balance = bill total - sum of payments recorded for the booking
CREATE FUNCTION fn_calculate_outstanding_balance(p_booking_id INT)
RETURNS DECIMAL(10,2) DETERMINISTIC READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(10,2);
    DECLARE v_paid DECIMAL(10,2);
    -- Once a bill exists, use its recorded total. Before check-in, estimate it.
    SELECT MAX(TotalAmount) INTO v_total FROM BILL WHERE BookingID = p_booking_id;
    SET v_total = COALESCE(v_total, fn_calculate_bill_total(p_booking_id));
    SELECT IFNULL(SUM(Amount), 0) INTO v_paid FROM PAYMENT WHERE BookingID = p_booking_id;
    RETURN v_total - v_paid;
END //

DELIMITER ;

-- TRIGGERS

DELIMITER //

-- A second overlap check protects ordinary inserts. The booking procedure also
-- locks the room and performs a current locking read for concurrent requests.
CREATE TRIGGER trg_prevent_overlap_booking
BEFORE INSERT ON BOOKED_ROOMS
FOR EACH ROW
BEGIN
    DECLARE v_conflict INT DEFAULT 0;

    SELECT COUNT(*) INTO v_conflict
    FROM BOOKED_ROOMS br
    JOIN BOOKING b ON b.BookingID = br.BookingID
    WHERE br.RoomID = NEW.RoomID
      AND b.BookingStatus IN ('Booked','Checked-In')
      AND NEW.CheckInDateTime < br.CheckOutDateTime
      AND NEW.CheckOutDateTime > br.CheckInDateTime;

    IF v_conflict > 0 THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Room is already booked for an overlapping period.';
    END IF;
END //

CREATE TRIGGER trg_room_status_sync
AFTER UPDATE ON BOOKING
FOR EACH ROW
BEGIN
    DECLARE v_room_count INT DEFAULT 0;

    IF NEW.BookingStatus = 'Checked-In' AND OLD.BookingStatus != 'Checked-In' THEN
        SELECT COUNT(DISTINCT RoomID) INTO v_room_count
        FROM BOOKED_ROOMS WHERE BookingID = NEW.BookingID;

        IF v_room_count = 0 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This booking has no rooms.';
        END IF;

        -- The conditional update takes row locks and rechecks the current
        -- status, so another check-in cannot claim an occupied room.
        UPDATE ROOM r
        JOIN BOOKED_ROOMS br ON br.RoomID = r.RoomID
        SET r.RoomStatus = 'Occupied'
        WHERE br.BookingID = NEW.BookingID
          AND r.RoomStatus = 'Available';

        IF ROW_COUNT() != v_room_count THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Every room must be Available before check-in.';
        END IF;
    ELSEIF NEW.BookingStatus IN ('Checked-Out','Cancelled')
       AND OLD.BookingStatus != NEW.BookingStatus THEN
        UPDATE ROOM r
        JOIN BOOKED_ROOMS br ON br.RoomID = r.RoomID
        SET r.RoomStatus = 'Available'
        WHERE br.BookingID = NEW.BookingID
          AND r.RoomStatus = 'Occupied'
          AND NOT EXISTS (
              SELECT 1
              FROM BOOKED_ROOMS other_room
              JOIN BOOKING other_booking ON other_booking.BookingID = other_room.BookingID
              WHERE other_room.RoomID = r.RoomID
                AND other_booking.BookingID != NEW.BookingID
                AND other_booking.BookingStatus = 'Checked-In'
          );
        -- A future Booked reservation does not mean the room is occupied now.
        -- The Occupied filter also preserves a room marked Maintenance.
    END IF;
END //

CREATE TRIGGER trg_prevent_checkout_with_due
BEFORE UPDATE ON BOOKING
FOR EACH ROW
BEGIN
    IF NEW.BookingStatus = 'Checked-Out' AND OLD.BookingStatus != 'Checked-Out' THEN
        IF OLD.BookingStatus != 'Checked-In' THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Only a Checked-In booking can be checked out.';
        END IF;
        IF fn_calculate_outstanding_balance(OLD.BookingID) > 0 THEN
            SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cannot check out: outstanding balance is not settled.';
        END IF;
    END IF;
END //

CREATE TRIGGER trg_update_bill_status_after_payment
AFTER INSERT ON PAYMENT
FOR EACH ROW
BEGIN
    DECLARE v_paid DECIMAL(10,2);

    SELECT IFNULL(SUM(Amount), 0) INTO v_paid
    FROM PAYMENT WHERE BillID = NEW.BillID;

    UPDATE BILL
    SET BillStatus = CASE
            WHEN v_paid >= TotalAmount THEN 'Paid'
            WHEN v_paid > 0 THEN 'Partially Paid'
            ELSE 'Unpaid'
        END
    WHERE BillID = NEW.BillID;
END //

DELIMITER ;

-- PROCEDURES

DELIMITER //

-- Make one booking containing one room. Each call creates a new booking.
CREATE PROCEDURE sp_make_booking(
    IN p_guest_id INT,
    IN p_staff_id INT,               -- NULL for a guest self-service booking
    IN p_room_id INT,
    IN p_checkin DATETIME,
    IN p_checkout DATETIME,
    IN p_guest_count INT,
    IN p_payment_method VARCHAR(20),
    OUT p_booking_id INT
)
proc_body: BEGIN
    DECLARE v_capacity INT DEFAULT NULL;
    DECLARE v_room_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_conflict INT DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET p_booking_id = NULL;
        ROLLBACK;
        RESIGNAL;
    END;

    SET p_booking_id = NULL;
    START TRANSACTION;

    IF p_checkin IS NULL OR p_checkout IS NULL
       OR p_checkout <= p_checkin OR DATE(p_checkin) < CURDATE() THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Choose a check-in date today or later and a later check-out date.';
    END IF;

    IF p_guest_count IS NULL OR p_guest_count <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Guest count must be positive.';
    END IF;

    IF p_payment_method IS NULL OR p_payment_method NOT IN ('Cash','Card','Bank Transfer') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Choose Cash, Card or Bank Transfer.';
    END IF;

    -- Requests for the same room queue on this row until commit or rollback.
    SELECT r.RoomStatus, rt.Capacity INTO v_room_status, v_capacity
    FROM ROOM r
    JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
    WHERE r.RoomID = p_room_id
    FOR UPDATE;

    IF v_room_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Room does not exist.';
    END IF;
    IF v_room_status = 'Maintenance' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This room is unavailable for maintenance.';
    END IF;
    IF p_guest_count > v_capacity THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Guest count exceeds room capacity.';
    END IF;

    -- A locking read sees bookings committed while this request waited for
    -- the room, including under InnoDB REPEATABLE READ isolation.
    SELECT br.BookedRoomID INTO v_conflict
    FROM BOOKED_ROOMS br
    JOIN BOOKING b ON b.BookingID = br.BookingID
    WHERE br.RoomID = p_room_id
      AND b.BookingStatus IN ('Booked','Checked-In')
      AND p_checkin < br.CheckOutDateTime
      AND p_checkout > br.CheckInDateTime
    LIMIT 1 FOR UPDATE;

    IF v_conflict IS NOT NULL THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Room is already booked for an overlapping period.';
    END IF;

    INSERT INTO BOOKING (GuestID, StaffID, BookingStatus, BookingDate, PreferredPaymentMethod)
    VALUES (p_guest_id, p_staff_id, 'Booked', CURDATE(), p_payment_method);
    SET p_booking_id = LAST_INSERT_ID();

    INSERT INTO BOOKED_ROOMS (BookingID, RoomID, CheckInDateTime, CheckOutDateTime, GuestCount)
    VALUES (p_booking_id, p_room_id, p_checkin, p_checkout, p_guest_count);

    COMMIT;
END //

-- Check-in: Booked -> Checked-In; rooms -> Occupied; opens a live BILL row
-- (a BILL must exist before checkout so guests can make payments *during*
-- their stay, not only at the very end)
CREATE PROCEDURE sp_check_in(IN p_booking_id INT)
proc_body: BEGIN
    DECLARE v_status VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT BookingStatus INTO v_status FROM BOOKING WHERE BookingID = p_booking_id FOR UPDATE;

    IF v_status IS NULL OR v_status != 'Booked' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only a Booked reservation can be checked in.';
    END IF;

    -- Update the booking status to Checked-In
    UPDATE BOOKING SET BookingStatus = 'Checked-In' WHERE BookingID = p_booking_id;
    -- trg_room_status_sync marks the room(s) Occupied

    INSERT INTO BILL (BookingID, RoomCharges, ServiceCharges, TotalAmount, BillStatus)
    VALUES (p_booking_id, fn_calculate_room_charges(p_booking_id),
            fn_calculate_service_charges(p_booking_id),
            fn_calculate_bill_total(p_booking_id), 'Unpaid');

    COMMIT;
END //

-- Recalculates the live BILL row for a Checked-In booking. Called after any
-- service usage is logged, and again at checkout to lock in final totals.
CREATE PROCEDURE sp_recalculate_bill(IN p_booking_id INT)
proc_body: BEGIN
    DECLARE v_room_charges DECIMAL(10,2);
    DECLARE v_service_charges DECIMAL(10,2);
    DECLARE v_total DECIMAL(10,2);
    DECLARE v_balance DECIMAL(10,2);

    -- The room charge is fixed when check-in opens the bill. Catalogue rate
    -- changes must not reprice this stay during service entry or checkout.
    -- The calling procedure already holds the booking lock; lock its bill next.
    SELECT RoomCharges INTO v_room_charges
    FROM BILL WHERE BookingID = p_booking_id FOR UPDATE;
    IF v_room_charges IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No bill exists yet for this booking.';
    END IF;
    SET v_service_charges = fn_calculate_service_charges(p_booking_id);
    SET v_total = v_room_charges + v_service_charges;
    SET v_balance = v_total - (SELECT IFNULL(SUM(Amount),0) FROM PAYMENT WHERE BookingID = p_booking_id);

    UPDATE BILL
    SET ServiceCharges = v_service_charges,
        TotalAmount = v_total,
        BillStatus = CASE WHEN v_balance <= 0 THEN 'Paid'
                          WHEN v_balance < v_total THEN 'Partially Paid'
                          ELSE 'Unpaid' END
    WHERE BookingID = p_booking_id;
END //

-- Check-out: recalculates + finalises the BILL, verifies balance is settled,
-- frees the room(s)
CREATE PROCEDURE sp_check_out(IN p_booking_id INT, IN p_staff_id INT)
proc_body: BEGIN
    DECLARE v_status VARCHAR(20);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT BookingStatus INTO v_status FROM BOOKING WHERE BookingID = p_booking_id FOR UPDATE;

    IF v_status IS NULL OR v_status != 'Checked-In' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only a Checked-In booking can be checked out.';
    END IF;

    -- Billing stays based on the reserved window (see note in sp_check_in);
    -- we do not overwrite CheckOutDateTime here.
    CALL sp_recalculate_bill(p_booking_id);
    UPDATE BILL SET StaffID = p_staff_id WHERE BookingID = p_booking_id;

    -- blocked by trg_prevent_checkout_with_due if a balance remains unpaid
    UPDATE BOOKING SET BookingStatus = 'Checked-Out' WHERE BookingID = p_booking_id;
    -- trg_room_status_sync marks the room(s) Available

    COMMIT;
END //

-- Log service usage: only allowed while the booking is Checked-In
CREATE PROCEDURE sp_log_service_usage(
    IN p_booking_id INT,
    IN p_service_id INT,
    IN p_quantity INT
)
proc_body: BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE v_price DECIMAL(10,2);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    SELECT BookingStatus INTO v_status FROM BOOKING WHERE BookingID = p_booking_id FOR UPDATE;

    IF v_status IS NULL OR v_status != 'Checked-In' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Services can only be logged against a Checked-In booking.';
    END IF;

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Service quantity must be positive.';
    END IF;

    SELECT UnitPrice INTO v_price FROM SERVICE_CATALOGUE WHERE ServiceID = p_service_id AND IsActive = TRUE;
    IF v_price IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Choose an active service.';
    END IF;

    INSERT INTO SERVICE_USAGE (BookingID, ServiceID, Quantity, PriceAtUsage)
    VALUES (p_booking_id, p_service_id, p_quantity, v_price);

    CALL sp_recalculate_bill(p_booking_id);

    COMMIT;
END //


CREATE PROCEDURE sp_process_payment(
    IN p_booking_id INT,
    IN p_amount DECIMAL(10,2),
    IN p_method VARCHAR(20)
)
proc_body: BEGIN
    DECLARE v_outstanding DECIMAL(10,2);
    DECLARE v_bill_id INT;
    DECLARE v_type VARCHAR(10);
    DECLARE v_status VARCHAR(20) DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Match the booking-first lock order used by service usage and checkout.
    -- This keeps payments, added services and checkout from racing each other.
    SELECT BookingStatus INTO v_status FROM BOOKING WHERE BookingID = p_booking_id FOR UPDATE;
    IF v_status IS NULL OR v_status != 'Checked-In' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payments require a Checked-In booking.';
    END IF;

    SELECT BillID INTO v_bill_id FROM BILL WHERE BookingID = p_booking_id FOR UPDATE;

    IF v_bill_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No bill exists yet for this booking (guest must be Checked-In first).';
    END IF;

    SET v_outstanding = fn_calculate_outstanding_balance(p_booking_id);

    IF p_amount IS NULL OR p_amount <= 0 OR p_amount > v_outstanding THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment amount must be > 0 and cannot exceed the outstanding balance.';
    END IF;

    IF p_method IS NULL OR p_method NOT IN ('Cash','Card','Bank Transfer') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Choose Cash, Card or Bank Transfer.';
    END IF;

    SET v_type = IF(p_amount >= v_outstanding, 'Full', 'Partial');

    INSERT INTO PAYMENT (BookingID, BillID, PaymentType, Amount, PaymentMethod)
    VALUES (p_booking_id, v_bill_id, v_type, p_amount, p_method);
    -- trg_update_bill_status_after_payment updates BILL.BillStatus

    COMMIT;
END //

DELIMITER ;
