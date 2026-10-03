// These limits match the GUEST / GUEST_ACCOUNT / STAFF_ACCOUNT columns.
function text(value, label, limit, optional = false) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  const cleaned = value.trim();
  if (!cleaned && !optional) throw new Error(`${label} is required.`);
  if ([...cleaned].length > limit) throw new Error(`${label} must be at most ${limit} characters.`);
  return cleaned || null;
}

function phone(value) {
  const cleaned = text(value, 'Contact number', 100).replace(/[\s-]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) {
    throw new Error('Contact number must contain 7 to 15 digits, optionally starting with +.');
  }
  return cleaned;
}

function email(value) {
  const cleaned = text(value, 'Email', 150, true);
  if (cleaned && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) throw new Error('Enter a valid email address.');
  return cleaned;
}

function password(value, label = 'Password') {
  if (typeof value !== 'string' || value.length < 6 || Buffer.byteLength(value, 'utf8') > 72) {
    throw new Error(`${label} must have at least 6 characters and use at most 72 UTF-8 bytes.`);
  }
  return value;
}

function bodyObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send a JSON object.');
  return body;
}

function checked(parser) {
  return (body) => {
    try { return { value: parser(bodyObject(body)) }; }
    catch (error) { return { error: error.message }; }
  };
}

const validateGuestRegistration = checked((body) => ({
  name: text(body.name, 'Full name', 100),
  contactNumber: phone(body.contactNumber),
  email: email(body.email),
  idNumber: text(body.idNumber, 'NIC / passport number', 30),
  address: text(body.address, 'Address', 255, true),
  username: text(body.username, 'Username', 60),
  password: password(body.password),
}));

const validateGuestProfile = checked((body) => {
  const result = {};
  if (Object.hasOwn(body, 'name')) result.name = text(body.name, 'Full name', 100);
  if (Object.hasOwn(body, 'contactNumber')) result.contactNumber = phone(body.contactNumber);
  if (Object.hasOwn(body, 'email')) result.email = email(body.email);
  if (Object.hasOwn(body, 'address')) result.address = text(body.address, 'Address', 255, true);
  if (!Object.keys(result).length) throw new Error('Provide name, contactNumber, email or address to update.');
  return result;
});

const validateCredentials = checked((body) => {
  const username = text(body.username, 'Username', 60);
  if (typeof body.password !== 'string' || !body.password || Buffer.byteLength(body.password, 'utf8') > 72) {
    throw new Error('Enter a valid password.');
  }
  return { username, password: body.password };
});

const validatePasswordChange = checked((body) => {
  if (typeof body.currentPassword !== 'string' || !body.currentPassword || Buffer.byteLength(body.currentPassword, 'utf8') > 72) {
    throw new Error('Current password is required and must use at most 72 UTF-8 bytes.');
  }
  return { currentPassword: body.currentPassword, newPassword: password(body.newPassword, 'New password') };
});

const validateStaffRegistration = checked((body) => {
  if (!['Admin', 'Manager', 'Receptionist', 'ServiceStaff'].includes(body.role)) throw new Error('Select a valid staff role.');
  const branchId = body.branchId === undefined || body.branchId === null || body.branchId === '' ? null : body.branchId;
  if (branchId !== null && (!Number.isSafeInteger(branchId) || branchId < 1)) throw new Error('branchId must be a positive integer or null.');
  return { branchId, name: text(body.name, 'Full name', 100), role: body.role, email: email(body.email),
    username: text(body.username, 'Username', 60), password: password(body.password) };
});

module.exports = { validateGuestRegistration, validateGuestProfile, validateCredentials, validatePasswordChange, validateStaffRegistration };
