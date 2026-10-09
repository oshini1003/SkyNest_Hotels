const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { canAct, canonicalId } = require('../utils/staffScope');

const fields = 'ServiceID, ServiceName, Description, CAST(UnitPrice AS CHAR) AS UnitPrice, IsActive';
const snapshotKeys = ['ServiceName', 'Description', 'UnitPrice', 'IsActive'];
const controls = /[\u0000-\u001f\u007f-\u009f]/;
const decimal = /^(0|[1-9]\d{0,7})(?:\.(\d{1,2}))?$/;
const canonicalPrice = /^(0|[1-9]\d{0,7})\.\d{2}$/;

class CatalogueError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const reject = (status, message) => { throw new CatalogueError(status, message); };
const hasKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validText = (value, max) => typeof value === 'string' && [...value].length <= max && !controls.test(value);
const validSnapshot = value => hasKeys(value, snapshotKeys)
  && validText(value.ServiceName, 100) && !!value.ServiceName.trim()
  && (value.Description === null || validText(value.Description, 255))
  && typeof value.UnitPrice === 'string' && canonicalPrice.test(value.UnitPrice)
  && typeof value.IsActive === 'boolean';

function authorize(req) {
  if (!canAct(req, ['Admin', 'Manager']) || !Object.hasOwn(req.user, 'branchId')
      || req.user.branchId !== req.staffScope.branchId) {
    reject(403, 'Manager or administrator access is required.');
  }
}

function parseBody(body, editing) {
  const keys = ['serviceName', 'description', 'unitPrice', ...(editing ? ['isActive', 'expected'] : [])];
  if (!hasKeys(body, keys)) reject(400, 'Provide exactly the required service fields.');
  if (!validText(body.serviceName, 100) || !body.serviceName.trim()) {
    reject(400, 'Enter a service name of 1 to 100 characters without control characters.');
  }
  if (body.description !== null && !validText(body.description, 255)) {
    reject(400, 'Use a description of up to 255 characters without control characters, or null.');
  }
  const match = typeof body.unitPrice === 'string' && !controls.test(body.unitPrice) && decimal.exec(body.unitPrice.trim());
  if (!match) reject(400, 'Enter a price from 0.00 to 99999999.99 as a decimal string with at most two decimal places.');
  if (editing && (typeof body.isActive !== 'boolean' || !validSnapshot(body.expected))) {
    reject(400, 'Provide a boolean active status and the original service snapshot.');
  }
  return {
    ServiceName: body.serviceName.trim(),
    Description: body.description === null ? null : body.description.trim() || null,
    UnitPrice: `${match[1]}.${(match[2] || '').padEnd(2, '0')}`,
    IsActive: editing ? body.isActive : true,
  };
}

function readService(row) {
  if (!row || !canonicalId(row.ServiceID) || ![0, 1, false, true].includes(row.IsActive)) {
    throw new Error('Invalid service catalogue row.');
  }
  const service = { ServiceID: row.ServiceID, ServiceName: row.ServiceName,
    Description: row.Description, UnitPrice: row.UnitPrice, IsActive: row.IsActive === 1 || row.IsActive === true };
  if (!validSnapshot(Object.fromEntries(snapshotKeys.map(key => [key, service[key]])))) {
    throw new Error('Invalid service catalogue values.');
  }
  return service;
}

async function checkStaff(conn, scope, locking) {
  const [[staff]] = await conn.execute(
    `SELECT s.StaffID, s.Role, s.BranchID FROM STAFF s
     JOIN STAFF_ACCOUNT a ON a.StaffID = s.StaffID
     WHERE s.StaffID = ?${locking ? ' FOR SHARE' : ''}`, [scope.staffId]);
  if (!staff || staff.StaffID !== scope.staffId || staff.Role !== scope.role || staff.BranchID !== scope.branchId) {
    reject(401, 'Your staff access has changed. Please sign in again.');
  }
}

// One connection owns each operation. A failed COMMIT may already have saved;
// report an unknown outcome and never retry, even if rollback later succeeds.
async function transaction(req, writing, work) {
  const conn = await pool.getConnection();
  let started = false;
  let committing = false;
  let discard = false;
  try {
    if (writing) await conn.beginTransaction();
    else {
      await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    }
    started = true;
    await checkStaff(conn, req.staffScope, writing);
    const result = await work(conn);
    committing = true;
    await conn.commit();
    started = false;
    return result;
  } catch (error) {
    discard = !(error instanceof CatalogueError);
    if (started) {
      try { await conn.rollback(); } catch (_) { discard = true; }
    }
    if (!committing && error instanceof CatalogueError) throw error;
    if (!committing && (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)
        || [1205, 1213].includes(error.errno))) {
      reject(409, 'Another catalogue change is in progress. Refresh before trying again.');
    }
    // Hide driver SQL/messages, including commit errors the global handler
    // might otherwise mistake for a definite duplicate or validation failure.
    throw new Error('The service catalogue operation could not be confirmed.', { cause: error });
  } finally {
    try { if (discard) conn.destroy(); else conn.release(); } catch (_) { /* Preserve the result or primary error. */ }
  }
}

function handler(action) {
  return asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      authorize(req);
      await action(req, res);
    } catch (error) {
      if (error instanceof CatalogueError) return res.status(error.status).json({ error: error.message });
      // Acquisition failures must also bypass global SQL-specific messages.
      throw new Error('The service catalogue request could not be completed.', { cause: error });
    }
  });
}

// GET /api/management/services: active and retired, for managers/admins only.
const listManagedServices = handler(async (req, res) => {
  if (Object.keys(req.query || {}).length) reject(400, 'This catalogue does not accept query filters.');
  const services = await transaction(req, false, async conn => {
    const [rows] = await conn.execute(`SELECT ${fields} FROM SERVICE_CATALOGUE ORDER BY ServiceName, ServiceID`);
    return rows.map(readService);
  });
  res.json(services);
});

// POST /api/services: IsActive uses the existing TRUE default and column grants.
const createService = handler(async (req, res) => {
  const value = parseBody(req.body, false);
  const service = await transaction(req, true, async conn => {
    const [result] = await conn.execute(
      'INSERT INTO SERVICE_CATALOGUE (ServiceName, Description, UnitPrice) VALUES (?, ?, ?)',
      [value.ServiceName, value.Description, value.UnitPrice]);
    if (!canonicalId(result.insertId) || result.affectedRows !== 1) throw new Error('Invalid service insert result.');
    return { ServiceID: result.insertId, ...value };
  });
  res.status(201).json({ saved: true, service });
});

// PUT /api/services/:id: compare the original row while locked, then replace it.
const updateService = handler(async (req, res) => {
  const rawId = req.params.id;
  if (typeof rawId !== 'string' || !/^[1-9]\d*$/.test(rawId) || !canonicalId(Number(rawId))) {
    reject(400, 'Service reference must be a positive whole number no greater than 2147483647.');
  }
  const serviceId = Number(rawId);
  const value = parseBody(req.body, true);
  const service = await transaction(req, true, async conn => {
    const [[row]] = await conn.execute(
      `SELECT ${fields} FROM SERVICE_CATALOGUE WHERE ServiceID = ? FOR UPDATE`, [serviceId]);
    if (!row) reject(404, 'Service not found.');
    const original = readService(row);
    if (original.ServiceID !== serviceId) throw new Error('Invalid service reference returned.');
    if (!snapshotKeys.every(key => original[key] === req.body.expected[key])) {
      reject(409, 'This service changed after you opened it. Refresh and review the latest values before saving.');
    }
    const [result] = await conn.execute(
      `UPDATE SERVICE_CATALOGUE SET ServiceName = ?, Description = ?, UnitPrice = ?, IsActive = ? WHERE ServiceID = ?`,
      [value.ServiceName, value.Description, value.UnitPrice, value.IsActive, serviceId]);
    if (![0, 1].includes(result.affectedRows)
        || (result.affectedRows === 0 && !snapshotKeys.every(key => original[key] === value[key]))) {
      throw new Error('Invalid service update result.');
    }
    return { ServiceID: serviceId, ...value };
  });
  res.json({ saved: true, service });
});

module.exports = { listManagedServices, createService, updateService };
