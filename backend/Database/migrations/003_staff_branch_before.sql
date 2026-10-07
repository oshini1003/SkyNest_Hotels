-- Reviewed pre-branch-access definitions from main bb41f35.
-- Comparison/recovery reference only; use the controlled branch-access installer.
DELIMITER //

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

    -- Update the booking status to Checked-In
    UPDATE BOOKING SET BookingStatus = 'Checked-In' WHERE BookingID = p_booking_id;
    -- trg_room_status_sync marks the room(s) Occupied

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

    -- Billing stays based on the reserved window (see note in sp_check_in);
    -- we do not overwrite CheckOutDateTime here.
    CALL sp_recalculate_bill(p_booking_id);
    UPDATE BILL SET StaffID = p_staff_id WHERE BookingID = p_booking_id;

    -- blocked by trg_prevent_checkout_with_due if a balance remains unpaid
    UPDATE BOOKING SET BookingStatus = 'Checked-Out' WHERE BookingID = p_booking_id;
    -- trg_room_status_sync marks the room(s) Available

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

    -- Match the booking-first lock order used by service usage and checkout.
    -- This keeps payments, added services and checkout from racing each other.
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
    -- trg_update_bill_status_after_payment updates BILL.BillStatus

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

CREATE PROCEDURE sp_update_booked_room(
    IN p_booking_id INT,
    IN p_booked_room_id INT,
    IN p_new_room_id INT,
    IN p_new_checkin DATETIME,
    IN p_new_checkout DATETIME,
    IN p_new_guest_count INT
)
proc_body: BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_cur_room INT DEFAULT NULL;
    DECLARE v_cur_in DATETIME;
    DECLARE v_cur_out DATETIME;
    DECLARE v_cur_guests INT;
    DECLARE v_room INT;
    DECLARE v_in DATETIME;
    DECLARE v_out DATETIME;
    DECLARE v_guests INT;
    DECLARE v_room_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_capacity INT DEFAULT NULL;
    DECLARE v_conflict INT DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    -- Booking lock first, as in check-in, check-out and payments. It also
    -- serialises this edit with cancellation and check-in.
    SELECT BookingStatus INTO v_status FROM BOOKING WHERE BookingID = p_booking_id FOR UPDATE;
    IF v_status IS NULL OR v_status <> 'Booked' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only a Booked reservation can be modified.';
    END IF;

    -- Only this procedure edits BOOKED_ROOMS and it holds the booking lock,
    -- so this row cannot change underneath it.
    SELECT RoomID, CheckInDateTime, CheckOutDateTime, GuestCount
      INTO v_cur_room, v_cur_in, v_cur_out, v_cur_guests
    FROM BOOKED_ROOMS
    WHERE BookedRoomID = p_booked_room_id AND BookingID = p_booking_id;
    IF v_cur_room IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'That room entry does not belong to this booking.';
    END IF;

    SET v_room   = IFNULL(p_new_room_id, v_cur_room);
    SET v_in     = IFNULL(p_new_checkin, v_cur_in);
    SET v_out    = IFNULL(p_new_checkout, v_cur_out);
    SET v_guests = IFNULL(p_new_guest_count, v_cur_guests);

    IF v_out <= v_in OR DATE(v_in) < CURDATE() THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Choose a check-in date today or later and a later check-out date.';
    END IF;

    -- Requests for the same room queue on this row until commit or rollback.
    SELECT r.RoomStatus, rt.Capacity INTO v_room_status, v_capacity
    FROM ROOM r
    JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
    WHERE r.RoomID = v_room
    FOR UPDATE OF r;

    IF v_room_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Room does not exist.';
    END IF;
    IF v_room_status = 'Maintenance' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This room is unavailable for maintenance.';
    END IF;
    IF v_guests > v_capacity THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Guest count exceeds room capacity.';
    END IF;

    -- Locking read, as in sp_make_booking: sees stays committed while this
    -- request waited for the room, even under REPEATABLE READ.
    SELECT br.BookedRoomID INTO v_conflict
    FROM BOOKED_ROOMS br
    JOIN BOOKING b ON b.BookingID = br.BookingID
    WHERE br.RoomID = v_room
      AND br.BookedRoomID <> p_booked_room_id
      AND b.BookingStatus IN ('Booked','Checked-In')
      AND v_in < br.CheckOutDateTime
      AND v_out > br.CheckInDateTime
    LIMIT 1 FOR UPDATE;

    IF v_conflict IS NOT NULL THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Room is already booked for an overlapping period.';
    END IF;

    UPDATE BOOKED_ROOMS
    SET RoomID = v_room, CheckInDateTime = v_in, CheckOutDateTime = v_out, GuestCount = v_guests
    WHERE BookedRoomID = p_booked_room_id;

    COMMIT;
END //

DELIMITER ;
