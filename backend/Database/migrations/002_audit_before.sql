-- Reviewed pre-audit procedure definitions from main 208d11b.
-- Comparison/recovery reference only; use addAuditLog.js for an existing database.
DELIMITER //

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
    UPDATE BOOKING SET BookingStatus = 'Checked-In' WHERE BookingID = p_booking_id;
    INSERT INTO BILL (BookingID, RoomCharges, ServiceCharges, TotalAmount, BillStatus)
    VALUES (p_booking_id, fn_calculate_room_charges(p_booking_id),
            fn_calculate_service_charges(p_booking_id),
            fn_calculate_bill_total(p_booking_id), 'Unpaid');
    COMMIT;
END //

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
    CALL sp_recalculate_bill(p_booking_id);
    UPDATE BILL SET StaffID = p_staff_id WHERE BookingID = p_booking_id;
    UPDATE BOOKING SET BookingStatus = 'Checked-Out' WHERE BookingID = p_booking_id;
    COMMIT;
END //

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
    COMMIT;
END //

DELIMITER ;
