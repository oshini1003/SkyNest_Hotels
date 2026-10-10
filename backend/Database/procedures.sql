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
    DECLARE v_staff_role VARCHAR(20) DEFAULT NULL;
    DECLARE v_staff_branch_id INT DEFAULT NULL;
    DECLARE v_room_branch_id INT DEFAULT NULL;
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

    IF p_staff_id IS NOT NULL THEN
        SELECT Role, BranchID INTO v_staff_role, v_staff_branch_id
        FROM STAFF WHERE StaffID = p_staff_id FOR SHARE;
        IF v_staff_role IS NULL OR v_staff_role NOT IN ('Admin','Manager','Receptionist') THEN
            SIGNAL SQLSTATE '45004' SET MESSAGE_TEXT = 'A permitted staff member is required.';
        END IF;
        IF v_staff_role = 'Receptionist' AND v_staff_branch_id IS NULL THEN
            SIGNAL SQLSTATE '45004' SET MESSAGE_TEXT = 'A permitted staff member is required.';
        END IF;
    END IF;

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
    SELECT r.RoomStatus, rt.Capacity, r.BranchID
      INTO v_room_status, v_capacity, v_room_branch_id
    FROM ROOM r
    JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
    WHERE r.RoomID = p_room_id
    FOR UPDATE;

    IF v_staff_role = 'Receptionist'
       AND (v_room_branch_id IS NULL OR v_room_branch_id <> v_staff_branch_id) THEN
        SIGNAL SQLSTATE '45003' SET MESSAGE_TEXT = 'Room not found.';
    END IF;

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

-- Change the room, stay dates or guest count of one room entry on a Booked
-- reservation. NULL parameters keep the current value.
CREATE PROCEDURE sp_update_booked_room(
    IN p_booking_id INT,
    IN p_booked_room_id INT,
    IN p_new_room_id INT,
    IN p_new_checkin DATETIME,
    IN p_new_checkout DATETIME,
    IN p_new_guest_count INT,
    IN p_staff_id INT               -- NULL for an owner-checked guest request
)
proc_body: BEGIN
    DECLARE v_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_staff_role VARCHAR(20) DEFAULT NULL;
    DECLARE v_staff_branch_id INT DEFAULT NULL;
    DECLARE v_scope_room_id INT DEFAULT NULL;
    DECLARE v_foreign_room_id INT DEFAULT NULL;
    DECLARE v_room_branch_id INT DEFAULT NULL;
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
    IF p_staff_id IS NOT NULL THEN
        SELECT Role, BranchID INTO v_staff_role, v_staff_branch_id
        FROM STAFF WHERE StaffID = p_staff_id FOR SHARE;
        IF v_staff_role IS NULL OR v_staff_role NOT IN ('Admin','Manager','Receptionist') THEN
            SIGNAL SQLSTATE '45004' SET MESSAGE_TEXT = 'A permitted staff member is required.';
        END IF;

        IF v_staff_role IN ('Receptionist','ServiceStaff') THEN
            IF v_staff_branch_id IS NULL THEN
                SIGNAL SQLSTATE '45004' SET MESSAGE_TEXT = 'A permitted staff member is required.';
            END IF;

            -- The booking lock serialises room edits. Use current locking reads so
            -- an earlier REPEATABLE READ snapshot cannot hide a committed room move.
            -- ROOM.BranchID is immutable through the runtime account.
            SELECT br.BookedRoomID INTO v_scope_room_id
            FROM BOOKED_ROOMS br
            WHERE br.BookingID = p_booking_id
            ORDER BY br.BookedRoomID
            LIMIT 1 FOR SHARE;

            SELECT br.BookedRoomID INTO v_foreign_room_id
            FROM BOOKED_ROOMS br
            LEFT JOIN ROOM r ON r.RoomID = br.RoomID
            WHERE br.BookingID = p_booking_id
              AND (r.BranchID IS NULL OR r.BranchID <> v_staff_branch_id)
            ORDER BY br.BookedRoomID
            LIMIT 1 FOR SHARE OF br;

            -- Empty and mixed-branch bookings are unavailable to branch staff.
            IF v_scope_room_id IS NULL OR v_foreign_room_id IS NOT NULL THEN
                SIGNAL SQLSTATE '45003' SET MESSAGE_TEXT = 'Booking not found.';
            END IF;
        END IF;
    END IF;

    IF v_status IS NULL OR v_status <> 'Booked' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only a Booked reservation can be modified.';
    END IF;

    -- Only this procedure edits BOOKED_ROOMS and it holds the booking lock,
    -- so this row cannot change underneath it.
    SELECT RoomID, CheckInDateTime, CheckOutDateTime, GuestCount
      INTO v_cur_room, v_cur_in, v_cur_out, v_cur_guests
    FROM BOOKED_ROOMS
    WHERE BookedRoomID = p_booked_room_id AND BookingID = p_booking_id
    FOR SHARE;
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
    SELECT r.RoomStatus, rt.Capacity, r.BranchID
      INTO v_room_status, v_capacity, v_room_branch_id
    FROM ROOM r
    JOIN ROOM_TYPE rt ON rt.RoomTypeID = r.RoomTypeID
    WHERE r.RoomID = v_room
    FOR UPDATE OF r;

    IF v_staff_role = 'Receptionist'
       AND (v_room_branch_id IS NULL OR v_room_branch_id <> v_staff_branch_id) THEN
        SIGNAL SQLSTATE '45003' SET MESSAGE_TEXT = 'Room not found.';
    END IF;

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
