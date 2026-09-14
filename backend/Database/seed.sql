-- ============================================================================
-- HRGSMS - Sample seed data
-- ============================================================================
USE hrgsms;

-- BRANCH
INSERT INTO BRANCH (Name, Location, ContactNumber) VALUES
('SkyNest Colombo', 'Colombo 03, Sri Lanka', '0112345678'),
('SkyNest Kandy',   'Kandy, Sri Lanka',      '0812345678'),
('SkyNest Galle',   'Galle, Sri Lanka',      '0912345678');

-- ROOM_TYPE
INSERT INTO ROOM_TYPE (Name, Capacity, DailyRate) VALUES
('Single', 1, 8000.00),
('Double', 2, 12000.00),
('Suite',  4, 25000.00);

-- AMENITY
INSERT INTO AMENITY (AmenityName) VALUES
('Free WiFi'), ('Air Conditioning'), ('Mini Bar'), ('Sea View'), ('Balcony'), ('Bathtub');

-- ROOM_TYPE_AMENITY
INSERT INTO ROOM_TYPE_AMENITY (RoomTypeID, AmenityID) VALUES
(1,1),(1,2),
(2,1),(2,2),(2,3),
(3,1),(3,2),(3,3),(3,4),(3,5),(3,6);

-- ROOM (Colombo=1, Kandy=2, Galle=3)
INSERT INTO ROOM (BranchID, RoomTypeID, RoomNumber, RoomStatus) VALUES
(1,1,'101','Available'),(1,2,'102','Available'),(1,3,'201','Available'),
(2,1,'101','Available'),(2,2,'102','Available'),
(3,2,'101','Available'),(3,3,'201','Available');

-- GUEST
INSERT INTO GUEST (Name, ContactNumber, Email, IDNumber, Address) VALUES
('Oshini Perera', '0771234567', 'oshini@example.com', '200112345678', 'Colombo'),
('Kasun Silva',   '0779876543', 'kasun@example.com',  '199534567890', 'Kandy');

-- GUEST_ACCOUNT  (password for both demo guests: "guest123")
INSERT INTO GUEST_ACCOUNT (GuestID, Username, PasswordHash) VALUES
(1, 'oshini', '$2b$10$/zdxvmLhmlY2Z/Qpkd0g..bus.TRFdudM7E.GNEppgAkVK8D58ZY.'),
(2, 'kasun',  '$2b$10$/zdxvmLhmlY2Z/Qpkd0g..bus.TRFdudM7E.GNEppgAkVK8D58ZY.');

-- STAFF
INSERT INTO STAFF (BranchID, Name, Role, Email) VALUES
(NULL, 'Admin User',        'Admin',        'admin@skynest.lk'),
(1,    'Nimal Manager',     'Manager',      'nimal@skynest.lk'),
(1,    'Amali Receptionist','Receptionist', 'amali@skynest.lk'),
(1,    'Sunil Service',     'ServiceStaff', 'sunil@skynest.lk');

-- STAFF_ACCOUNT (password for all demo staff: "staff123")
INSERT INTO STAFF_ACCOUNT (StaffID, Username, PasswordHash) VALUES
(1, 'admin',  '$2b$10$TnrFDT0LAKCTgSgEr0HVA.D4x5/PSGZKGarONz7sPs59EfKmnb04C'),
(2, 'nimal',  '$2b$10$TnrFDT0LAKCTgSgEr0HVA.D4x5/PSGZKGarONz7sPs59EfKmnb04C'),
(3, 'amali',  '$2b$10$TnrFDT0LAKCTgSgEr0HVA.D4x5/PSGZKGarONz7sPs59EfKmnb04C'),
(4, 'sunil',  '$2b$10$TnrFDT0LAKCTgSgEr0HVA.D4x5/PSGZKGarONz7sPs59EfKmnb04C');

-- SERVICE_CATALOGUE
INSERT INTO SERVICE_CATALOGUE (ServiceName, Description, UnitPrice, IsActive) VALUES
('Room Service',   'In-room dining',        1500.00, TRUE),
('Spa Treatment',  '60 minute spa session', 6000.00, TRUE),
('Laundry',        'Per load',              800.00,  TRUE),
('Minibar',        'Per item',              500.00,  TRUE);

-- A sample booking via the stored procedure (Room 1, Colombo, 2 nights)
CALL sp_make_booking(1, 3, 1, '2026-09-20 14:00:00', '2026-09-22 12:00:00', 1, 'Card', @booking_id);
SELECT @booking_id AS SampleBookingID;
