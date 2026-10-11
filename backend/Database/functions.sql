-- FUNCTIONS

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

CREATE FUNCTION fn_calculate_service_charges(p_booking_id INT)
RETURNS DECIMAL(10,2) DETERMINISTIC READS SQL DATA
BEGIN
    DECLARE v_total DECIMAL(10,2);
    SELECT IFNULL(SUM(Quantity * PriceAtUsage), 0) INTO v_total
    FROM SERVICE_USAGE WHERE BookingID = p_booking_id;
    RETURN v_total;
END //

CREATE FUNCTION fn_calculate_bill_total(p_booking_id INT)
RETURNS DECIMAL(10,2) DETERMINISTIC READS SQL DATA
BEGIN
    RETURN fn_calculate_room_charges(p_booking_id) + fn_calculate_service_charges(p_booking_id);
END //

