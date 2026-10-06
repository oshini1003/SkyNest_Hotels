-- Audit integration definitions. Do not import this file over an existing database.
-- Use: node backend/Database/addAuditLog.js --backend-stopped
-- The installer checks baseline definitions, preserves definers/context, and saves backups.
-- No database selection, DROP, reset, historical backfill, or business-row writes.
DELIMITER //

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
) ENGINE=InnoDB //

CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON AUDIT_LOG
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit history cannot be updated.';
END //

CREATE TRIGGER trg_audit_log_no_delete
BEFORE DELETE ON AUDIT_LOG
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit history cannot be deleted.';
END //

CREATE PROCEDURE sp_check_in(IN p_booking_id INT, IN p_staff_id INT)
proc_body: BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE v_staff_role VARCHAR(20) DEFAULT NULL;
    DECLARE v_bill_id INT;
    DECLARE v_operation_id CHAR(36);
    DECLARE v_bill_after JSON;
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
    SELECT Role INTO v_staff_role FROM STAFF WHERE StaffID = p_staff_id FOR SHARE;
    IF v_staff_role IS NULL OR v_staff_role NOT IN ('Admin','Manager','Receptionist') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A permitted staff member is required.';
    END IF;
    SET v_operation_id = UUID();
    UPDATE BOOKING SET BookingStatus = 'Checked-In' WHERE BookingID = p_booking_id;
    INSERT INTO BILL (BookingID, RoomCharges, ServiceCharges, TotalAmount, BillStatus)
    VALUES (p_booking_id, fn_calculate_room_charges(p_booking_id),
            fn_calculate_service_charges(p_booking_id),
            fn_calculate_bill_total(p_booking_id), 'Unpaid');
    SET v_bill_id = LAST_INSERT_ID();
    SELECT JSON_OBJECT(
        'BillID', BillID, 'BookingID', BookingID,
        'RoomCharges', CAST(RoomCharges AS CHAR),
        'ServiceCharges', CAST(ServiceCharges AS CHAR),
        'TotalAmount', CAST(TotalAmount AS CHAR),
        'BillStatus', BillStatus, 'StaffID', StaffID
    ) INTO v_bill_after FROM BILL WHERE BillID = v_bill_id FOR UPDATE;
    INSERT INTO AUDIT_LOG
        (OperationID, ActorType, StaffID, GuestID, BookingID, Action,
         TableAffected, RecordID, OldValues, NewValues, Details)
    VALUES
        (v_operation_id, 'staff', p_staff_id, NULL, p_booking_id, 'Check-In',
         'BOOKING', p_booking_id,
         JSON_OBJECT('BookingID', p_booking_id, 'BookingStatus', v_status),
         JSON_OBJECT('BookingID', p_booking_id, 'BookingStatus', 'Checked-In'),
         'Reservation checked in.'),
        (v_operation_id, 'staff', p_staff_id, NULL, p_booking_id, 'BillOpened',
         'BILL', v_bill_id, NULL, v_bill_after, 'Bill opened at check-in.');
    COMMIT;
END //

CREATE PROCEDURE sp_check_out(IN p_booking_id INT, IN p_staff_id INT)
proc_body: BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE v_staff_role VARCHAR(20) DEFAULT NULL;
    DECLARE v_bill_id INT DEFAULT NULL;
    DECLARE v_operation_id CHAR(36);
    DECLARE v_bill_before JSON;
    DECLARE v_bill_after JSON;
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
    SELECT Role INTO v_staff_role FROM STAFF WHERE StaffID = p_staff_id FOR SHARE;
    IF v_staff_role IS NULL OR v_staff_role NOT IN ('Admin','Manager','Receptionist') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A permitted staff member is required.';
    END IF;
    SELECT BillID, JSON_OBJECT(
        'BillID', BillID, 'BookingID', BookingID,
        'RoomCharges', CAST(RoomCharges AS CHAR),
        'ServiceCharges', CAST(ServiceCharges AS CHAR),
        'TotalAmount', CAST(TotalAmount AS CHAR),
        'BillStatus', BillStatus, 'StaffID', StaffID
    ) INTO v_bill_id, v_bill_before FROM BILL WHERE BookingID = p_booking_id FOR UPDATE;
    IF v_bill_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No bill exists yet for this booking.';
    END IF;
    SET v_operation_id = UUID();
    CALL sp_recalculate_bill(p_booking_id);
    UPDATE BILL SET StaffID = p_staff_id WHERE BookingID = p_booking_id;
    UPDATE BOOKING SET BookingStatus = 'Checked-Out' WHERE BookingID = p_booking_id;
    SELECT JSON_OBJECT(
        'BillID', BillID, 'BookingID', BookingID,
        'RoomCharges', CAST(RoomCharges AS CHAR),
        'ServiceCharges', CAST(ServiceCharges AS CHAR),
        'TotalAmount', CAST(TotalAmount AS CHAR),
        'BillStatus', BillStatus, 'StaffID', StaffID
    ) INTO v_bill_after FROM BILL WHERE BillID = v_bill_id FOR UPDATE;
    INSERT INTO AUDIT_LOG
        (OperationID, ActorType, StaffID, GuestID, BookingID, Action,
         TableAffected, RecordID, OldValues, NewValues, Details)
    VALUES
        (v_operation_id, 'staff', p_staff_id, NULL, p_booking_id, 'Check-Out',
         'BOOKING', p_booking_id,
         JSON_OBJECT('BookingID', p_booking_id, 'BookingStatus', v_status),
         JSON_OBJECT('BookingID', p_booking_id, 'BookingStatus', 'Checked-Out'),
         'Reservation checked out.'),
        (v_operation_id, 'staff', p_staff_id, NULL, p_booking_id, 'BillFinalized',
         'BILL', v_bill_id, v_bill_before, v_bill_after, 'Bill finalized at checkout.');
    COMMIT;
END //

CREATE PROCEDURE sp_process_payment(
    IN p_booking_id INT,
    IN p_amount DECIMAL(10,2),
    IN p_method VARCHAR(20),
    IN p_staff_id INT
)
proc_body: BEGIN
    DECLARE v_outstanding DECIMAL(10,2);
    DECLARE v_bill_id INT;
    DECLARE v_type VARCHAR(10);
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_staff_role VARCHAR(20) DEFAULT NULL;
    DECLARE v_payment_id INT;
    DECLARE v_operation_id CHAR(36);
    DECLARE v_bill_before JSON;
    DECLARE v_bill_after JSON;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    START TRANSACTION;
    SELECT BookingStatus INTO v_status FROM BOOKING WHERE BookingID = p_booking_id FOR UPDATE;
    IF v_status IS NULL OR v_status != 'Checked-In' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payments require a Checked-In booking.';
    END IF;
    SELECT Role INTO v_staff_role FROM STAFF WHERE StaffID = p_staff_id FOR SHARE;
    IF v_staff_role IS NULL OR v_staff_role NOT IN ('Admin','Manager','Receptionist') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A permitted staff member is required.';
    END IF;
    SELECT BillID, JSON_OBJECT(
        'BillID', BillID, 'BookingID', BookingID,
        'RoomCharges', CAST(RoomCharges AS CHAR),
        'ServiceCharges', CAST(ServiceCharges AS CHAR),
        'TotalAmount', CAST(TotalAmount AS CHAR),
        'BillStatus', BillStatus, 'StaffID', StaffID
    ) INTO v_bill_id, v_bill_before FROM BILL WHERE BookingID = p_booking_id FOR UPDATE;
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
    SET v_operation_id = UUID();
    INSERT INTO PAYMENT (BookingID, BillID, PaymentType, Amount, PaymentMethod)
    VALUES (p_booking_id, v_bill_id, v_type, p_amount, p_method);
    SET v_payment_id = LAST_INSERT_ID();
    SELECT JSON_OBJECT(
        'BillID', BillID, 'BookingID', BookingID,
        'RoomCharges', CAST(RoomCharges AS CHAR),
        'ServiceCharges', CAST(ServiceCharges AS CHAR),
        'TotalAmount', CAST(TotalAmount AS CHAR),
        'BillStatus', BillStatus, 'StaffID', StaffID
    ) INTO v_bill_after FROM BILL WHERE BillID = v_bill_id FOR UPDATE;
    INSERT INTO AUDIT_LOG
        (OperationID, ActorType, StaffID, GuestID, BookingID, Action,
         TableAffected, RecordID, OldValues, NewValues, Details)
    VALUES
        (v_operation_id, 'staff', p_staff_id, NULL, p_booking_id, 'PaymentProcessed',
         'PAYMENT', v_payment_id, NULL,
         JSON_OBJECT('PaymentID', v_payment_id, 'BookingID', p_booking_id,
             'BillID', v_bill_id, 'PaymentType', v_type,
             'Amount', CAST(p_amount AS CHAR), 'PaymentMethod', p_method),
         'Payment recorded.'),
        (v_operation_id, 'staff', p_staff_id, NULL, p_booking_id, 'BillPaymentApplied',
         'BILL', v_bill_id, v_bill_before, v_bill_after, 'Bill status updated after payment.');
    COMMIT;
END //

CREATE PROCEDURE sp_log_service_usage(
    IN p_booking_id INT,
    IN p_service_id INT,
    IN p_quantity INT,
    IN p_staff_id INT,
    IN p_guest_id INT
)
proc_body: BEGIN
    DECLARE v_status VARCHAR(20);
    DECLARE v_price DECIMAL(10,2);
    DECLARE v_owner_id INT;
    DECLARE v_staff_role VARCHAR(20) DEFAULT NULL;
    DECLARE v_actor_type VARCHAR(5);
    DECLARE v_bill_id INT DEFAULT NULL;
    DECLARE v_usage_id INT;
    DECLARE v_operation_id CHAR(36);
    DECLARE v_bill_before JSON;
    DECLARE v_bill_after JSON;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    START TRANSACTION;
    SELECT BookingStatus, GuestID INTO v_status, v_owner_id
    FROM BOOKING WHERE BookingID = p_booking_id FOR UPDATE;
    IF v_status IS NULL OR v_status != 'Checked-In' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Services can only be logged against a Checked-In booking.';
    END IF;
    IF (p_staff_id IS NULL AND p_guest_id IS NULL)
       OR (p_staff_id IS NOT NULL AND p_guest_id IS NOT NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Exactly one service actor is required.';
    END IF;
    IF p_staff_id IS NOT NULL THEN
        SELECT Role INTO v_staff_role FROM STAFF WHERE StaffID = p_staff_id FOR SHARE;
        IF v_staff_role IS NULL OR v_staff_role NOT IN ('Admin','Manager','Receptionist','ServiceStaff') THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A permitted staff member is required.';
        END IF;
        SET v_actor_type = 'staff';
    ELSE
        IF p_guest_id != v_owner_id THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Service usage requires the booking owner.';
        END IF;
        SET v_actor_type = 'guest';
    END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Service quantity must be positive.';
    END IF;
    SELECT UnitPrice INTO v_price FROM SERVICE_CATALOGUE WHERE ServiceID = p_service_id AND IsActive = TRUE;
    IF v_price IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Choose an active service.';
    END IF;
    SELECT BillID, JSON_OBJECT(
        'BillID', BillID, 'BookingID', BookingID,
        'RoomCharges', CAST(RoomCharges AS CHAR),
        'ServiceCharges', CAST(ServiceCharges AS CHAR),
        'TotalAmount', CAST(TotalAmount AS CHAR),
        'BillStatus', BillStatus, 'StaffID', StaffID
    ) INTO v_bill_id, v_bill_before FROM BILL WHERE BookingID = p_booking_id FOR UPDATE;
    IF v_bill_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No bill exists yet for this booking.';
    END IF;
    SET v_operation_id = UUID();
    INSERT INTO SERVICE_USAGE (BookingID, ServiceID, Quantity, PriceAtUsage)
    VALUES (p_booking_id, p_service_id, p_quantity, v_price);
    SET v_usage_id = LAST_INSERT_ID();
    CALL sp_recalculate_bill(p_booking_id);
    SELECT JSON_OBJECT(
        'BillID', BillID, 'BookingID', BookingID,
        'RoomCharges', CAST(RoomCharges AS CHAR),
        'ServiceCharges', CAST(ServiceCharges AS CHAR),
        'TotalAmount', CAST(TotalAmount AS CHAR),
        'BillStatus', BillStatus, 'StaffID', StaffID
    ) INTO v_bill_after FROM BILL WHERE BillID = v_bill_id FOR UPDATE;
    INSERT INTO AUDIT_LOG
        (OperationID, ActorType, StaffID, GuestID, BookingID, Action,
         TableAffected, RecordID, OldValues, NewValues, Details)
    VALUES
        (v_operation_id, v_actor_type, p_staff_id, p_guest_id, p_booking_id,
         'ServiceUsageRecorded', 'SERVICE_USAGE', v_usage_id, NULL,
         JSON_OBJECT('UsageID', v_usage_id, 'BookingID', p_booking_id,
             'ServiceID', p_service_id, 'Quantity', p_quantity,
             'PriceAtUsage', CAST(v_price AS CHAR)), 'Service usage recorded.'),
        (v_operation_id, v_actor_type, p_staff_id, p_guest_id, p_booking_id,
         'BillRecalculated', 'BILL', v_bill_id, v_bill_before, v_bill_after,
         'Bill recalculated after service usage.');
    COMMIT;
END //

DELIMITER ;
