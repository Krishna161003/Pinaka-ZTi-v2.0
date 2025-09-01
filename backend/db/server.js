const express = require("express");
const session = require("express-session");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const authRoutes = require("./authRoutes"); // Adjust the path as needed
const cors = require("cors");
const loginRoutes = require("./loginRoutes"); // New file for login
const nodemailer = require("nodemailer"); // Import nodemailer library
const bcrypt = require("bcrypt"); // Import bcrypt library
const { customAlphabet } = require('nanoid'); // Import nanoid for generating unique IDs
require("dotenv").config(); // Load environment variables
const axios = require('axios');
const os = require('os');

// Helper to get the primary local IPv4 address (non-internal)
function getLocalIP() {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if ((net.family === 'IPv4' || net.family === 4) && !net.internal) {
          return net.address;
        }
      }
    }
  } catch (e) {
    console.warn('Could not determine local IP:', e.message);
  }
  return '127.0.0.1';
}


// Helper function to calculate end date based on license period (number of days)
function calculateEndDate(licensePeriod) {
  if (!licensePeriod) return null;
  
  const today = new Date();
  const startDate = today.toISOString().split('T')[0]; // YYYY-MM-DD format
  
  // Parse license period as number of days
  const days = parseInt(licensePeriod);
  
  if (isNaN(days) || days < 0) {
    console.warn(`Invalid license period: ${licensePeriod}. Expected a positive number of days.`);
    return null;
  }
  
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + days);
  
  return endDate.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Helper function to check and update expired licenses
function checkAndUpdateExpiredLicenses() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // 1) Find licenses that have just expired (transition candidates)
  const selectToExpireSQL = `
    SELECT L.license_code, L.server_id, DS.serverip
    FROM License L
    LEFT JOIN deployed_server DS ON DS.serverid = L.server_id
    WHERE L.license_status = 'activated'
      AND L.end_date IS NOT NULL
      AND L.end_date < ?
  `;

  db.query(selectToExpireSQL, [today], (selErr, rows) => {
    if (selErr) {
      console.error('Error selecting licenses to expire:', selErr);
      return;
    }

    const targets = Array.isArray(rows) ? rows.filter(r => !!r.serverip) : [];

    // 2) Mark them as expired
    const updateExpiredSQL = `
      UPDATE License
      SET license_status = 'expired'
      WHERE license_status = 'activated'
        AND end_date IS NOT NULL
        AND end_date < ?
    `;

    db.query(updateExpiredSQL, [today], async (updErr, result) => {
      if (updErr) {
        console.error('Error updating expired licenses:', updErr);
        return;
      }

      const affected = result?.affectedRows || 0;
      if (affected > 0) {
        console.log(`Updated ${affected} expired license(s)`);

        // 3) Enforce on Flask for each affected server IP
        try {
          const flaskHost = getLocalIP();
          const flaskPort = process.env.FLASK_PORT || 2020;
          const https = require('https');
          const agent = new https.Agent({ rejectUnauthorized: false });

          // De-duplicate server IPs to avoid multiple calls per server
          const uniqueIps = [...new Set(targets.map(t => t.serverip))];
          if (uniqueIps.length === 0) {
            console.log('No server IPs associated with expired licenses to enforce.');
            return;
          }

          // Build IP -> server_id(s) map for later status updates
          const ipToServerIds = {};
          for (const t of targets) {
            if (!t.serverip) continue;
            if (!ipToServerIds[t.serverip]) ipToServerIds[t.serverip] = new Set();
            if (t.server_id) ipToServerIds[t.serverip].add(t.server_id);
          }

          console.log(`Enforcing license expiration on ${uniqueIps.length} server(s) via Flask...`, { host: flaskHost, port: flaskPort });

          const results = await Promise.allSettled(
            uniqueIps.map(async (ip) => {
              const maxAttempts = 3;
              let lastErr = null;
              for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                  const resp = await axios.post(`https://${flaskHost}:${flaskPort}/license/enforce-expired`, { server_ip: ip }, {
                    headers: { 'Content-Type': 'application/json' },
                    httpsAgent: agent,
                    timeout: 30_000,
                  });
                  console.log(JSON.stringify({ event: 'license_enforcement_call', ip, attempt, success: true, status: resp.status }));
                  return { ip, data: resp.data };
                } catch (err) {
                  lastErr = err;
                  console.warn(JSON.stringify({ event: 'license_enforcement_call', ip, attempt, success: false, error: err?.message }));
                  // Exponential backoff: 500ms, 1000ms (1s), 2000ms (2s)
                  const delay = Math.pow(2, attempt - 1) * 500;
                  await new Promise(r => setTimeout(r, delay));
                }
              }
              throw { ip, error: lastErr };
            })
          );

          const successIPs = results.filter(r => r.status === 'fulfilled').map(r => r.value.ip);
          const failures = results.filter(r => r.status === 'rejected');
          console.log(`License enforcement completed: ${successIPs.length} success, ${failures.length} failed`);
          if (failures.length > 0) {
            failures.slice(0, 3).forEach((f, i) => console.warn(`Enforcement failure ${i + 1}:`, f.reason?.error?.message || f.reason?.message || f.reason));
            if (failures.length > 3) console.warn(`...and ${failures.length - 3} more failures`);
          }

          // Update disable_enforced=1 for successfully enforced servers
          if (successIPs.length > 0) {
            const successServerIds = [];
            for (const ip of successIPs) {
              const idSet = ipToServerIds[ip];
              if (idSet && idSet.size) {
                for (const id of idSet) successServerIds.push(id);
              }
            }
            const uniqueServerIds = [...new Set(successServerIds)].filter(Boolean);
            if (uniqueServerIds.length > 0) {
              const updSql = `UPDATE License SET disable_enforced = 1 WHERE license_status = 'expired' AND server_id IN (?)`;
              db.query(updSql, [uniqueServerIds], (enfErr, enfRes) => {
                if (enfErr) {
                  console.error('Error updating disable_enforced for servers:', enfErr);
                } else {
                  console.log(`Marked disable_enforced=1 for ${uniqueServerIds.length} server(s)`);
                }
              });
            }
          }
        } catch (e) {
          console.error('Error during license enforcement calls:', e);
        }
      }
    });
  });

// Fetch deployed server IPs for a given cloudname (and optional user filter)
// Retrieves distinct server IPs from deployed_server table for a specific cloud
// Supports optional user filtering and returns IP addresses for network operations
app.get('/api/deployed-server-ips', (req, res) => {
  try {
    const { cloudname, user_id } = req.query;
    if (!cloudname) {
      return res.status(400).json({ error: 'cloudname is required' });
    }
    // Fetch distinct IPs from deployed_server for the cloud
    // If user_id provided and column exists in schema, filter by it; otherwise ignore
    const params = [cloudname];
    const whereUser = user_id ? ' AND (user_id = ?)' : '';
    if (user_id) params.push(user_id);
    const sql = `SELECT DISTINCT serverip FROM deployed_server WHERE cloudname = ?${whereUser}`;
    db.query(sql, params, (err, rows) => {
      if (err) {
        console.error('Error fetching deployed server IPs:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      const ips = Array.isArray(rows) ? rows.map(r => r.serverip).filter(Boolean) : [];
      return res.json({ ips });
    });
  } catch (e) {
    console.error('Unexpected error in /api/deployed-server-ips:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
}
const https = require('https');
const fs = require('fs');
const { exec } = require("child_process");
const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, true);
    },
    credentials: true,
  })
);

app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use("/api", loginRoutes); // Use the login routes
app.use("/api", authRoutes);

// Use session middleware (if you are using sessions for authentication)
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key", // Use environment variable or fallback
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true in production with HTTPS
  })
);





// Check if a license code already exists
// Checks if a license code already exists in the database
// Returns license details and availability status for validation purposes
app.post('/api/check-license-exists', (req, res) => {
  const { license_code } = req.body;
  
  if (!license_code) {
    return res.status(400).json({ error: 'License code is required' });
  }

  const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306,
  });

  db.connect((err) => {
    if (err) {
      console.error('Database connection error:', err);
      return res.status(500).json({ error: 'Database connection error' });
    }

    const sql = 'SELECT * FROM License WHERE license_code = ?';
    db.query(sql, [license_code], (err, results) => {
      db.end(); // Close the connection
      
      if (err) {
        console.error('Database query error:', err);
        return res.status(500).json({ error: 'Error checking license' });
      }
      
      if (results.length > 0) {
        return res.status(200).json({ 
          exists: true,
          message: 'This license code is already in use',
          license: results[0]
        });
      }
      
      return res.status(200).json({ 
        exists: false,
        message: 'License code is available'
      });
    });
  });
});

// Insert multiple child node deployment activity logs (type = 'secondary') for Cloud module
// Creates multiple child node deployment activity logs with type 'secondary'
// Handles license binding and generates unique server IDs for each node
app.post('/api/child-deployment-activity-log', async (req, res) => {
  const nodes = req.body.nodes; // Array of node objects
  const { user_id, username } = req.body;

  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid nodes array' });
  }
  if (!user_id || !username) {
    return res.status(400).json({ error: 'Missing required fields: user_id or username' });
  }

  try {
    // Fetch earliest deployed_server entry to copy VIP and cloudname
    const firstVipAndCloud = await new Promise((resolve) => {
      const q = `SELECT server_vip, cloudname FROM deployed_server WHERE cloudname IS NOT NULL AND cloudname <> '' ORDER BY datetime ASC LIMIT 1`;
      db.query(q, [], (err, rows) => {
        if (err) {
          console.error('Error fetching first VIP/cloudname:', err);
          return resolve({ server_vip: null, cloudname: null });
        }
        const r = rows && rows[0] ? rows[0] : {};
        resolve({ server_vip: r?.server_vip || null, cloudname: r?.cloudname || null });
      });
    });

    const insertedNodes = [];
    for (const node of nodes) {
      const { serverip, hostname, Management, Storage, External_Traffic, VXLAN, license_code, license_type, license_period, role } = node;
      if (!serverip) {
        return res.status(400).json({ error: 'Each node must have serverip' });
      }

      const nanoid6 = customAlphabet('ABCDEVSR0123456789abcdefgzkh', 6);
      const serverid = 'SQDN-' + nanoid6();

      // Prefer cloudname sent from client per-node; fallback to earliest deployed_server cloudname
      const chosenCloudname = (node && node.cloudname) ? node.cloudname : (firstVipAndCloud.cloudname || null);

      const insSql = `
        INSERT INTO deployment_activity_log
          (serverid, user_id, username, cloudname, serverip, hostname, status, type, role, server_vip, Management, Storage, External_Traffic, VXLAN)
        VALUES (?, ?, ?, ?, ?, ?, 'progress', 'secondary', ?, ?, ?, ?, ?, ?)
      `;
      await new Promise((resolve, reject) => {
        db.query(
          insSql,
          [
            serverid,
            user_id,
            username,
            chosenCloudname,
            serverip,
            hostname || null,
            role || null,
            firstVipAndCloud.server_vip || null,
            Management || null,
            Storage || null,
            External_Traffic || null,
            VXLAN || null,
          ],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Upsert license if present and bind to serverid
      if (license_code) {
        const licenseInsertSQL = `
          INSERT INTO License (license_code, license_type, license_period, license_status, server_id)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            license_type=VALUES(license_type),
            license_period=VALUES(license_period),
            license_status=VALUES(license_status),
            server_id=VALUES(server_id)
        `;
        // Normalize license_type and force period NULL for perpetual
        const normalizedType = String(license_type || '').trim().toLowerCase();
        const isPerpetual = normalizedType === 'perpectual' || normalizedType === 'perpetual';
        const periodToStore = isPerpetual ? null : (license_period || null);
        await new Promise((resolve, reject) => {
          db.query(licenseInsertSQL, [license_code, license_type, periodToStore, 'validated', serverid], (licErr) => (licErr ? reject(licErr) : resolve()));
        });
      }

      insertedNodes.push({ serverid, serverip });
    }

    return res.status(200).json({ message: 'Child node deployment activity logs created successfully', nodes: insertedNodes });
  } catch (error) {
    console.error('Error inserting child node deployment activity logs:', error);
    return res.status(500).json({ error: 'Failed to insert child node deployment activity logs' });
  }
});

// Finalize a child node deployment (Cloud) from deployment_activity_log into deployed_server (type = 'secondary')
// Finalizes child node deployment by moving from activity log to deployed_server table
// Activates licenses and sets start/end dates for license management
app.post('/api/finalize-child-deployment/:serverid', (req, res) => {
  const { serverid } = req.params;

  const getSql = `SELECT * FROM deployment_activity_log WHERE serverid = ? LIMIT 1`;
  db.query(getSql, [serverid], (err, rows) => {
    if (err) {
      console.error('Error fetching child node deployment activity log:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Child node deployment not found' });
    }

    const dep = rows[0];

    // Mark completed
    const updateStatusSQL = `UPDATE deployment_activity_log SET status = 'completed' WHERE serverid = ?`;
    db.query(updateStatusSQL, [serverid], (upErr) => {
      if (upErr) {
        console.error('Error marking child node deployment completed:', upErr);
      }

      // License handling
      const licQuery = 'SELECT license_code FROM License WHERE server_id = ? LIMIT 1';
      db.query(licQuery, [serverid], (licErr, licRows) => {
        if (licErr) {
          console.error('Error fetching license_code for child node:', licErr);
        }
        const licenseCodeToUse = licRows && licRows.length > 0 ? licRows[0].license_code : null;

        if (licenseCodeToUse) {
          const getLicenseSQL = `SELECT license_type, license_period FROM License WHERE license_code = ?`;
          db.query(getLicenseSQL, [licenseCodeToUse], (getLicErr, licResults) => {
            if (getLicErr) {
              console.error('Error fetching license period for child node:', getLicErr);
              const updLicSQL = `UPDATE License SET license_status = 'activated', server_id = ? WHERE license_code = ?`;
              db.query(updLicSQL, [serverid, licenseCodeToUse], (licUpdErr) => {
                if (licUpdErr) console.error('Error activating child node license:', licUpdErr);
              });
            } else {
              const row = licResults && licResults[0] ? licResults[0] : {};
              const normalizedType = String(row.license_type || '').trim().toLowerCase();
              const isPerpetual = normalizedType === 'perpectual' || normalizedType === 'perpetual';
              const licensePeriod = row.license_period;
              const startDate = new Date().toISOString().split('T')[0];
              const endDate = isPerpetual ? null : calculateEndDate(licensePeriod);
              const periodToStore = isPerpetual ? null : licensePeriod;
              const updLicSQL = `UPDATE License SET license_status = 'activated', server_id = ?, start_date = ?, end_date = ?, license_period = ? WHERE license_code = ?`;
              db.query(updLicSQL, [serverid, startDate, endDate, periodToStore, licenseCodeToUse], (licUpdErr) => {
                if (licUpdErr) console.error('Error activating child node license:', licUpdErr);
              });
            }
          });
        }

        // Upsert into deployed_server
        const checkSQL = 'SELECT id FROM deployed_server WHERE serverid = ? LIMIT 1';
        db.query(checkSQL, [serverid], (chkErr, chkRows) => {
          if (chkErr) {
            console.error('Error checking existing deployed child server:', chkErr);
            return res.status(500).json({ error: 'Failed to finalize child node (check)' });
          }

          const resolvedRole = (dep.role || 'child');

          if (chkRows && chkRows.length > 0) {
            const updSQL = `
              UPDATE deployed_server
              SET user_id=?, username=?, cloudname=?, serverip=?, hostname=?, server_vip=?, role=?, license_code=?, Management=?, Storage=?, External_Traffic=?, VXLAN=?
              WHERE serverid=?
            `;
            const updValues = [
              dep.user_id,
              dep.username || null,
              dep.cloudname || null,
              dep.serverip,
              dep.hostname || null,
              dep.server_vip || null,
              resolvedRole,
              licenseCodeToUse || null,
              dep.Management || null,
              dep.Storage || null,
              dep.External_Traffic || null,
              dep.VXLAN || null,
              serverid
            ];
            db.query(updSQL, updValues, (updErr) => {
              if (updErr) {
                console.error('Error updating deployed child server record:', updErr);
                return res.status(500).json({ error: 'Failed to update deployed child server record' });
              }
              return res.json({ message: 'Deployed child server record updated successfully' });
            });
          } else {
            const insSQL = `
              INSERT INTO deployed_server (serverid, user_id, username, cloudname, serverip, hostname, server_vip, role, license_code, Management, Storage, External_Traffic, VXLAN)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const insValues = [
              serverid,
              dep.user_id,
              dep.username || null,
              dep.cloudname || null,
              dep.serverip,
              dep.hostname || null,
              dep.server_vip || null,
              resolvedRole,
              licenseCodeToUse || null,
              dep.Management || null,
              dep.Storage || null,
              dep.External_Traffic || null,
              dep.VXLAN || null
            ];
            db.query(insSQL, insValues, (insErr) => {
              if (insErr) {
                console.error('Error creating deployed child server record:', insErr);
                return res.status(500).json({ error: 'Failed to create deployed child server record' });
              }
              return res.json({ message: 'Deployed child server record created successfully' });
            });
          }
        });
      });
    });
  });
});

// API: List pending child (secondary) deployments with optional filters
// Retrieves pending child deployments from deployment_activity_log with optional filters
// Returns deployment status and configuration details for monitoring and management
app.get('/api/pending-child-deployments', (req, res) => {
  const { status = 'progress', user_id, cloudname } = req.query || {};
  let sql = `SELECT serverid, serverip, hostname, cloudname, user_id, username, server_vip, Management, Storage, External_Traffic, VXLAN
             FROM deployment_activity_log WHERE status = ? AND type = 'secondary'`;
  const params = [status];
  if (user_id) {
    sql += ' AND user_id = ?';
    params.push(user_id);
  }
  if (cloudname) {
    sql += ' AND cloudname = ?';
    params.push(cloudname);
  }
  sql += ' ORDER BY datetime ASC';
  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching pending child deployments:', err);
      return res.status(500).json({ error: 'Failed to fetch pending child deployments' });
    }
    return res.json({ rows });
  });
});

// Get license details by server ID
// Checks password update status for a specific user from the database
// Returns update_pwd_status flag to determine if user has completed initial setup
app.get("/api/check-password-status/:userId", (req, res) => {
  const { userId } = req.params;

  const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306,
  });

  db.connect((err) => {
    if (err) {
      console.error("Error connecting to the database:", err);
      return res.status(500).send({ message: "Error connecting to the database", error: err });
    }

    db.query(
      "SELECT update_pwd_status FROM users WHERE id = ?",
      [userId],
      (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res.status(500).send({ message: "Database query error", error: err });
        }

        if (results.length === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        const updatePwdStatus = results[0].update_pwd_status;
        res.status(200).send({ updatePwdStatus });
      }
    );
  });
});



// /run-script API to update password and set user status
// Executes password update script with user credentials and host information
// Updates user password status in database after successful script execution
app.post("/run-script", (req, res) => {
  const { userUsername, userId, oldPassword, newPassword, hostIP } = req.body;

  // Log received request data (without passwords for security)
  console.log("Received request body:", {
    userUsername,
    userId,
    oldPassword: oldPassword ? "[HIDDEN]" : "undefined",
    newPassword: newPassword ? "[HIDDEN]" : "undefined",
    hostIP
  });

  // Ensure all required fields are provided
  if (!userUsername || !userId || !oldPassword || !newPassword || !hostIP) {
    return res.status(400).send({
      message:
        "Missing required fields: userUsername, userId, oldPassword, newPassword, or hostIP",
    });
  }

  // Create a MySQL connection inside the route
  const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306,
  });

  // Connect to the MySQL database
  db.connect((err) => {
    if (err) {
      console.error("Error connecting to the database:", err);
      return res
        .status(500)
        .send({ message: "Error connecting to the database", error: err });
    }
    console.log("MySQL connected...");

    // Check if the user exists and get their update_pwd_status
    db.query(
      "SELECT update_pwd_status FROM users WHERE id = ?",
      [userId],
      (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res
            .status(500)
            .send({ message: "Database query error", error: err });
        }

        if (results.length === 0) {
          return res.status(404).send({ message: "User not found" });
        }

        const updatePwdStatus = results[0].update_pwd_status;

        // Allow password updates regardless of update_pwd_status
        // The update_pwd_status is only used to track if user has completed initial setup

        // Command to execute the shell script with the arguments in the correct order
        const command = `bash /usr/src/app/update-password.sh ${userUsername} ${userId} ${oldPassword} ${newPassword} ${hostIP}`;

        console.log(`Executing command: ${command}`);

        // Run the shell script using exec
        exec(command, (error, stdout, stderr) => {
          if (error) {
            console.error(`exec error: ${error}`);
            return res
              .status(500)
              .send({ message: "Script execution failed", error: stderr });
          }
          console.log(`stdout: ${stdout}`);

          // After successful password update, update the database status to true
          db.query(
            "UPDATE users SET update_pwd_status = ? WHERE id = ?",
            [true, userId],
            (err) => {
              if (err) {
                console.error("Error updating password status:", err);
                return res.status(500).send({
                  message: "Failed to update password status",
                  error: err,
                });
              }

              console.log("Password status updated successfully");

              return res.status(200).send({
                message: "Password updated and status updated to true",
                result: stdout,
              });
            }
          );
        });
      }
    );
  });
});

let options = {}
try {
  options = {
    key: fs.readFileSync('/etc/ssl/keycloak.key'),
    cert: fs.readFileSync('/etc/ssl/keycloak.crt'),
  };
} catch (err) {
  console.error('❌ Failed to read SSL certificates:', err.message);
  process.exit(1);
}

// Simple health check endpoint to verify Node.js backend is running
// Returns basic status message for service monitoring and testing
app.get('/', (req, res) => {
  res.send('NODE BACKEND IS RUNNING SUCCESSFULLY!');
});

// Create a MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 3306,
});

// Connect to the MySQL database
db.connect((err) => {
  if (err) {
    console.error("Error connecting to the database:", err);
    process.exit(1); // Exit the application if the database connection fails
  }
  console.log("MySQL connected...");

  // Create users table if not exists
  const usersTableSQL = `
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY, 
      companyName VARCHAR(255),
      email VARCHAR(255),
      password VARCHAR(255),
      update_pwd_status BOOLEAN DEFAULT FALSE
    ) ENGINE=InnoDB;  -- Ensure InnoDB engine for foreign key support
  `;
  db.query(usersTableSQL, (err, result) => {
    if (err) throw err;
    console.log("Users table checked/created...");

    // Insert default user if not exists
    const defaultUserSQL = `
      INSERT IGNORE INTO users (id, companyName, email, password) 
      VALUES ('A1B2C3', 'admin', NULL, ?)
    `;
    const hashedPassword = bcrypt.hashSync('admin', 10);
    db.query(defaultUserSQL, [hashedPassword], (err, result) => {
      if (err) throw err;
      console.log("Default user ensured...");
    });
  });
  
  // Create new deployment_activity_log table with default timestamp
  const deploymentActivityLogTableSQL = `
    CREATE TABLE IF NOT EXISTS deployment_activity_log (
      id INT AUTO_INCREMENT PRIMARY KEY, -- S.NO
      serverid CHAR(36) UNIQUE NOT NULL, -- serverid (generate with nanoid or uuid in app code)
      user_id CHAR(36),                  -- Userid
      username VARCHAR(255),             -- username
      cloudname VARCHAR(255),            -- cloudname
      serverip VARCHAR(15),              -- serverip
      hostname VARCHAR(255) NULL,        -- hostname
      status VARCHAR(255),               -- status
      type VARCHAR(255),                 -- type
      role VARCHAR(255) NULL,            -- role (host/child/other, comma-separated for multi)
      server_vip VARCHAR(255),           -- Server_vip (can be NULL or value)
      Management VARCHAR(255) NULL,
      Storage VARCHAR(255) NULL,
      External_Traffic VARCHAR(255) NULL,
      VXLAN VARCHAR(255) NULL,
      datetime DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id)        -- Added index for foreign key
    ) ENGINE=InnoDB;
  `;

  db.query(deploymentActivityLogTableSQL, (err, result) => {
    if (err) throw err;
    console.log("Deployment_Activity_log table checked/created...");

    // Ensure role column exists for older databases
    db.query("ALTER TABLE deployment_activity_log ADD COLUMN role VARCHAR(255) NULL", (altErr) => {
      if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
        console.warn("Could not ensure 'role' column on deployment_activity_log:", altErr.message);
      }
    });

    // Ensure hostname column exists for older databases
    db.query("ALTER TABLE deployment_activity_log ADD COLUMN hostname VARCHAR(255) NULL", (altErr) => {
      if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
        console.warn("Could not ensure 'hostname' column on deployment_activity_log:", altErr.message);
      }
    });

    // Create License table
    const licenseTableSQL = `
      CREATE TABLE IF NOT EXISTS License (
        id INT AUTO_INCREMENT PRIMARY KEY, -- S.No
        license_code VARCHAR(255) UNIQUE NOT NULL, -- License_code (Primary Key)
        license_type VARCHAR(255), -- License_type
        license_period VARCHAR(255), -- License_period
        license_status VARCHAR(255), -- License_status
        server_id CHAR(36), -- Server_id (no longer a Foreign Key)
        start_date DATE NULL, -- Start date when license is activated
        end_date DATE NULL -- End date calculated from license_period
      ) ENGINE=InnoDB;
    `;

    db.query(licenseTableSQL, (err, result) => {
      if (err) throw err;
      console.log("License table checked/created...");
      
      // Add start_date and end_date columns to existing License table if they don't exist
      // MySQL may not support IF NOT EXISTS for ADD COLUMN in your version; attempt and ignore duplicate errors
      db.query("ALTER TABLE License ADD COLUMN start_date DATE NULL", (altErr) => {
        if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
          console.warn("Could not ensure 'start_date' column on License:", altErr.message);
        }
      });

      db.query("ALTER TABLE License ADD COLUMN end_date DATE NULL", (altErr) => {
        if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
          console.warn("Could not ensure 'end_date' column on License:", altErr.message);
        }
      });

      // Ensure disable_enforced flag exists to mark enforcement completion
      db.query("ALTER TABLE License ADD COLUMN disable_enforced TINYINT(1) DEFAULT 0", (altErr) => {
        if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
          console.warn("Could not ensure 'disable_enforced' column on License:", altErr.message);
        }
      });

      // Create Deployed Server table (same as deployment_activity_log except no status column)
      const deployedServerTableSQL = `
        CREATE TABLE IF NOT EXISTS deployed_server (
          id INT AUTO_INCREMENT PRIMARY KEY, -- S.No
          serverid CHAR(36) UNIQUE NOT NULL, -- ServerId (same as log)
          user_id CHAR(36), -- UserId
          username VARCHAR(255), -- Username
          cloudname VARCHAR(255), -- Cloud Name
          serverip VARCHAR(15), -- Server IP
          hostname VARCHAR(255) NULL, -- hostname
          server_vip VARCHAR(255), -- Server VIP
          role VARCHAR(255), -- Role
          license_code VARCHAR(255), -- License_code (Foreign Key)
          Management VARCHAR(255) NULL,
          Storage VARCHAR(255) NULL,
          External_Traffic VARCHAR(255) NULL,
          VXLAN VARCHAR(255) NULL,
          datetime DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (license_code) REFERENCES License(license_code)
        ) ENGINE=InnoDB;
      `;

      db.query(deployedServerTableSQL, (err, result) => {
        if (err) throw err;
        console.log("Deployed Server table checked/created...");
        
        // Ensure hostname column exists for older deployed_server tables
        db.query("ALTER TABLE deployed_server ADD COLUMN hostname VARCHAR(255) NULL", (altErr) => {
          if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
            console.warn("Could not ensure 'hostname' column on deployed_server:", altErr.message);
          }
        });
      });
    });
    console.log("Deployed Server table ensured...");
  });

  // Create lifecycle_history table for Lifecycle Management History tab
  const lifecycleHistoryTableSQL = `
    CREATE TABLE IF NOT EXISTS lifecycle_history (
      id VARCHAR(64) PRIMARY KEY,           -- Job/History ID (from lifecycle job)
      info VARCHAR(512),                    -- Patch Info / description
      date DATETIME,                        -- Date/time of completion
      user_id CHAR(36) NULL,                -- Optional: who triggered it
      log LONGTEXT NULL,                    -- Combined stdout/stderr/readme log
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `;
  db.query(lifecycleHistoryTableSQL, (err, result) => {
    if (err) throw err;
    console.log("Lifecycle_history table checked/created...");

    // Ensure 'log' column exists for existing databases (ignore duplicate/unsupported errors)
    db.query("ALTER TABLE lifecycle_history ADD COLUMN log LONGTEXT NULL", (altErr) => {
      if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
        console.warn("Could not ensure 'log' column on lifecycle_history:", altErr.message);
      }
    });
  });
  
  // Create keycloak_client_secret table
  const keycloakClientSecretTableSQL = `
    CREATE TABLE IF NOT EXISTS keycloak_client_secret (
      sno INT AUTO_INCREMENT PRIMARY KEY,
      client_secret VARCHAR(512) NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `;
  
  db.query(keycloakClientSecretTableSQL, (err, result) => {
    if (err) throw err;
    console.log("Keycloak client secret table checked/created...");
  });

  // Set up periodic check for expired licenses (run every hour)
  setInterval(checkAndUpdateExpiredLicenses, 60 * 60 * 1000); // 60 minutes * 60 seconds * 1000 milliseconds
  
  // Also run the check once on startup
  setTimeout(checkAndUpdateExpiredLicenses, 5000); // Run after 5 seconds to ensure DB is ready
});

// Insert lifecycle management history item
// Stores lifecycle management history items with patch information and logs
// Supports upsert operations for updating existing history entries
app.post('/api/lifecycle-history', (req, res) => {
  try {
    const { id, info, date, user_id, log } = req.body || {};
    if (!id || !info) {
      return res.status(400).json({ error: 'id and info are required' });
    }
    // Allow date to be ISO string, epoch, or omit (defaults to now)
    let dateVal;
    if (!date) {
      dateVal = new Date();
    } else if (typeof date === 'number') {
      // seconds or milliseconds
      dateVal = new Date(date < 10_000_000_000 ? date * 1000 : date);
    } else {
      dateVal = new Date(date);
    }
    const sql = `
      INSERT INTO lifecycle_history (id, info, date, user_id, log)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        info = VALUES(info),
        date = VALUES(date),
        user_id = VALUES(user_id),
        log = VALUES(log)
    `;
    db.query(sql, [id, info, dateVal, user_id || null, log || null], (err) => {
      if (err) {
        console.error('Error inserting lifecycle history:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      return res.status(200).json({ message: 'Lifecycle history stored' });
    });
  } catch (e) {
    console.error('Unexpected error in POST /api/lifecycle-history:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Fetch lifecycle management history items
// Retrieves lifecycle management history items with optional user filtering
// Returns patch history sorted by date for lifecycle management tracking
app.get('/api/lifecycle-history', (req, res) => {
  try {
    const { user_id } = req.query || {};
    let sql = 'SELECT id, info, date FROM lifecycle_history';
    const params = [];
    if (user_id) {
      sql += ' WHERE user_id = ?';
      params.push(user_id);
    }
    sql += ' ORDER BY date DESC, created_at DESC';
    db.query(sql, params, (err, rows) => {
      if (err) {
        console.error('Error fetching lifecycle history:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      return res.json({ rows: rows || [] });
    });
  } catch (e) {
    console.error('Unexpected error in GET /api/lifecycle-history:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Fetch the stored lifecycle log for a given history id as a downloadable .log file
// Downloads lifecycle log file for a specific history entry as plain text
// Returns log content with proper headers for file download functionality
app.get('/api/lifecycle-history/:id/log', (req, res) => {
  try {
    const { id } = req.params || {};
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const sql = 'SELECT log FROM lifecycle_history WHERE id = ? LIMIT 1';
    db.query(sql, [id], (err, rows) => {
      if (err) {
        console.error('Error fetching lifecycle log:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      const logText = rows && rows[0] ? rows[0].log : null;
      if (!logText) {
        return res.status(404).json({ error: 'Log not found' });
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="lifecycle-${id}.log"`);
      return res.status(200).send(logText);
    });
  } catch (e) {
    console.error('Unexpected error in GET /api/lifecycle-history/:id/log:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper to get the latest in-progress deployment for a user
app.get('/api/deployment-activity-log/latest-in-progress/:user_id', (req, res) => {
  const { user_id } = req.params;
  const sql = `
    SELECT * FROM deployment_activity_log 
    WHERE user_id = ? AND status = 'progress' AND type = 'primary'
    ORDER BY datetime DESC 
    LIMIT 1
  `;
  db.query(sql, [user_id], (err, results) => {
    if (err) {
      console.error('Error fetching in-progress deployment:', err);
      return res.status(500).json({ error: 'Failed to fetch deployment status' });
    }
    res.json({
      inProgress: results.length > 0,
      log: results[0] || null
    });
  });
});

// Get latest in-progress secondary deployment activity log for a user (from deployment_activity_log)
// Retrieves the latest in-progress secondary deployment for a specific user
// Returns secondary deployment status and configuration details for monitoring
app.get('/api/deployment-activity-log/latest-in-progress/secondary/:user_id', (req, res) => {
  const { user_id } = req.params;
  const sql = `
    SELECT * FROM deployment_activity_log
    WHERE user_id = ? AND status = 'progress' AND type = 'secondary'
    ORDER BY datetime DESC
    LIMIT 1
  `;
  db.query(sql, [user_id], (err, results) => {
    if (err) {
      console.error('Error fetching in-progress secondary deployment:', err);
      return res.status(500).json({ error: 'Failed to fetch secondary deployment status' });
    }
    res.json({
      inProgress: results.length > 0,
      log: results[0] || null
    });
  });
});

// Insert new deployment activity log
const { nanoid } = require('nanoid');

// Creates new deployment activity log entry for host deployment tracking
// Generates unique server IDs and handles license information for deployment management
app.post('/api/deployment-activity-log', (req, res) => {
  const { user_id, username, cloudname, serverip, hostname, vip, Management, External_Traffic, Storage, VXLAN } = req.body;
  if (!user_id || !username || !cloudname || !serverip) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // First, check if there's already an in-progress deployment for this user
  const checkSql = `
    SELECT serverid FROM deployment_activity_log 
    WHERE user_id = ? AND status = 'progress' AND cloudname = ? AND serverip = ?
    LIMIT 1
  `;

  db.query(checkSql, [user_id, cloudname, serverip], (checkErr, results) => {
    if (checkErr) {
      console.error('Error checking for existing deployment:', checkErr);
      return res.status(500).json({ error: 'Failed to check for existing deployment' });
    }

    // If an in-progress deployment exists, return its serverid without creating a new one
    if (results && results.length > 0) {
      const existingServerId = results[0].serverid;
      return res.status(200).json({
        message: 'Using existing deployment',
        serverid: existingServerId,
        existing: true
      });
    }

    // No existing in-progress deployment found, create a new one
    const status = 'progress';
    const type = 'host';
    // For host type, use 'FD-' + 6-char nanoid; for others, use regular nanoid
    let serverid;
    if (type === 'host') {
      const { customAlphabet } = require('nanoid');
      const nanoid6 = customAlphabet('ABCDEVSR0123456789abcdefgzkh', 6);
      serverid = 'FD-' + nanoid6();
    } else {
      serverid = nanoid();
    }

    const sql = `
      INSERT INTO deployment_activity_log
        (serverid, user_id, username, cloudname, serverip, hostname, status, type, server_vip, Management, External_Traffic, Storage, VXLAN)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [serverid, user_id, username, cloudname, serverip, hostname || null, status, type, vip, Management || null, External_Traffic || null, Storage || null, VXLAN || null], (err, result) => {
      if (err) {
        console.error('Error inserting deployment activity log:', err);
        return res.status(500).json({ error: 'Failed to insert deployment activity log' });
      }
      // Insert license details if provided
      const { license_code, license_type, license_period } = req.body;
      if (license_code) {
        // Normalize type and force NULL period for perpetual licenses
        const normalizedType = String(license_type || '').trim().toLowerCase();
        const isPerpetual = normalizedType === 'perpectual' || normalizedType === 'perpetual';
        const periodToStore = isPerpetual ? null : (license_period || null);
        const licenseInsertSQL = `
          INSERT INTO License (license_code, license_type, license_period, license_status, server_id) 
          VALUES (?, ?, ?, 'validated', ?)
          ON DUPLICATE KEY UPDATE 
            license_type=VALUES(license_type), 
            license_period=VALUES(license_period), 
            server_id=VALUES(server_id)
        `;
        db.query(licenseInsertSQL, [license_code, license_type, periodToStore, serverid], (licErr) => {
          if (licErr) {
            console.error('Error inserting/updating license:', licErr);
            // Continue anyway, but log error
          }
          res.status(200).json({
            message: 'Deployment activity log and license created',
            serverid,
            existing: false
          });
        });
      } else {
        res.status(200).json({
          message: 'Deployment activity log created',
          serverid,
          existing: false
        });
      }
    });
  });
});

// Update deployment activity log status to completed
// Updates deployment activity log status for a specific server deployment
// Allows status changes from progress to completed or other states
app.patch('/api/deployment-activity-log/:serverid', (req, res) => {
  const { serverid } = req.params;
  const { status } = req.body;
  const newStatus = status || 'completed';
  const sql = `UPDATE deployment_activity_log SET status = ? WHERE serverid = ?`;
  db.query(sql, [newStatus, serverid], (err, result) => {
    if (err) {
      console.error('Error updating deployment activity log:', err);
      return res.status(500).json({ error: 'Failed to update deployment activity log' });
    }
    return res.status(200).json({ message: `Deployment activity log updated to ${newStatus}` });
  });
});

// API to fetch license details for a serverid
// Retrieves license details for a specific server including status and dates
// Checks for expired licenses and returns comprehensive license information
app.get('/api/license-details/:serverid', (req, res) => {
  const { serverid } = req.params;
  
  // First check and update any expired licenses
  checkAndUpdateExpiredLicenses();
  
  const sql = 'SELECT license_code, license_type, license_period, license_status, start_date, end_date FROM License WHERE server_id = ? ORDER BY id DESC LIMIT 1';
  db.query(sql, [serverid], (err, results) => {
    if (err) {
      console.error('Error fetching license details:', err);
      return res.status(500).json({ error: 'Failed to fetch license details' });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: 'No license found for this serverid' });
    }
    res.json(results[0]);
  });
});

// Create or update license entry for a server
// Expects body: { license_code, license_type, license_period, serverid, status }
// Creates or updates license entry for a server with activation and date management
// Handles perpetual and time-based licenses with proper status and date calculations
app.put('/api/update-license/:serverid', (req, res) => {
  const { serverid } = req.params;
  const { license_code, license_type, license_period, status } = req.body || {};

  if (!license_code || !license_type || !serverid) {
    return res.status(400).json({ message: 'license_code, license_type and serverid are required' });
  }

  const normalizedType = String(license_type).toLowerCase();
  const isPerpetual = normalizedType === 'perpectual' || normalizedType === 'perpetual';
  const effectiveStatus = (status || 'activated').toLowerCase();
  // If type is perpetual, force status activated
  const finalStatus = isPerpetual ? 'activated' : effectiveStatus;
  // Force license_period to NULL for perpetual
  const licensePeriodToStore = isPerpetual ? null : (license_period || null);

  // Decide dates per requirement based on finalStatus:
  //  - If finalStatus is activated: set start_date to today; end_date NULL for perpetual, else computed
  let startDate = null;
  let endDate = null;
  if (finalStatus === 'activated') {
    startDate = new Date().toISOString().split('T')[0];
    endDate = isPerpetual ? null : calculateEndDate(licensePeriodToStore);
  }

  const insertSql = `
    INSERT INTO License (license_code, license_type, license_period, license_status, server_id, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    insertSql,
    [license_code, license_type, licensePeriodToStore, finalStatus, serverid, startDate, endDate],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'License code already exists' });
        }
        console.error('Error inserting license:', err);
        return res.status(500).json({ message: 'Failed to create license entry' });
      }

      // Also reflect the license code on the deployed_server row for this server
      const updDepSql = `UPDATE deployed_server SET license_code = ? WHERE serverid = ?`;
      db.query(updDepSql, [license_code, serverid], (updErr) => {
        if (updErr) {
          console.error('Error updating deployed_server license_code:', updErr);
          // Do not fail the whole request; the License row is already inserted.
        }

        return res.status(200).json({
          message: 'License updated successfully',
          license: {
            license_code,
            license_type,
            license_period: licensePeriodToStore,
            license_status: finalStatus,
            server_id: serverid,
            start_date: startDate,
            end_date: endDate
          }
        });
      });
    }
  );
});


// Get latest in-progress deployment activity log for a user
app.get('/api/deployment-activity-log/latest-in-progress/:user_id', (req, res) => {
  const { user_id } = req.params;
  const sql = `
    SELECT * FROM deployment_activity_log
    WHERE user_id = ? AND status = 'progress' AND type = 'host'
    ORDER BY datetime DESC LIMIT 1
  `;
  db.query(sql, [user_id], (err, results) => {
    if (err) {
      console.error('Error fetching deployment activity log:', err);
      return res.status(500).json({ error: 'Failed to fetch deployment activity log' });
    }
    if (results.length > 0) {
      res.status(200).json({ inProgress: true, log: results[0] });
    } else {
      res.status(200).json({ inProgress: false });
    }
  });
});


// API: Get dashboard counts for Cloud, Flight Deck, and Squadron
// Retrieves dashboard counts for Cloud and Squadron deployments for a user
// Returns cloud count and squadron count for dashboard statistics and monitoring
app.get('/api/dashboard-counts/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Get unique cloud count from deployed_server table
    const cloudCountQuery = `SELECT COUNT(DISTINCT cloudname) AS cloudCount FROM deployed_server WHERE user_id = ?`;

    // Get squadron count from deployed_server table
    const squadronCountQuery = `SELECT COUNT(*) AS squadronCount FROM deployed_server WHERE user_id = ?`;

    // Execute queries in parallel
    const [cloudResult, squadronResult] = await Promise.all([
      new Promise((resolve, reject) => {
        db.query(cloudCountQuery, [userId], (err, result) => {
          if (err) reject(err);
          else resolve(result[0].cloudCount);
        });
      }),
      new Promise((resolve, reject) => {
        db.query(squadronCountQuery, [userId], (err, result) => {
          if (err) reject(err);
          else resolve(result[0].squadronCount);
        });
      })
    ]);

    // Return the counts
    res.status(200).json({
      cloudCount: cloudResult,
      squadronCount: squadronResult
    });
  } catch (error) {
    console.error('Error fetching dashboard counts:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard counts' });
  }
});

// API: Get deployed servers (alias of child-nodes; source: deployed_server)
// Retrieves all deployed servers with optional user filtering
// Returns server information from deployed_server table for inventory management
app.get('/api/deployed-servers', (req, res) => {
  const userId = req.query.userId;
  let sql = "SELECT * FROM deployed_server";
  const params = [];
  if (userId) {
    sql += ' WHERE user_id = ?';
    params.push(userId);
  }
  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error fetching deployed servers:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// API: Get server details by IP from deployed_server table
// Retrieves server details by IP address from deployed_server table
// Returns server ID, IP, and role information for server identification
app.get('/api/server-details-by-ip', (req, res) => {
  const { ip, userId } = req.query;
  
  if (!ip) {
    return res.status(400).json({ error: 'IP parameter is required' });
  }

  let sql = "SELECT serverid, serverip, hostname, role FROM deployed_server WHERE serverip = ?";
  const params = [ip];
  
  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }
  
  sql += ' ORDER BY datetime DESC LIMIT 1';
  
  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error fetching server details by IP:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (results && results.length > 0) {
      res.json(results[0]);
    } else {
      // Return null if no server found for this IP
      res.json({ serverid: null, serverip: ip, hostname: null, role: null });
    }
  });
});

// API: Get first cloudname from deployed_server globally (earliest row)
// Retrieves the first cloudname from deployed_server table globally
// Returns the earliest cloudname for system configuration and defaults
app.get('/api/first-cloudname', (req, res) => {
  const sql = `
    SELECT cloudname FROM deployed_server
    WHERE cloudname IS NOT NULL AND cloudname <> ''
    ORDER BY datetime ASC
    LIMIT 1
  `;
  db.query(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching first cloudname:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    const cloudname = rows && rows[0] ? rows[0].cloudname : null;
    return res.json({ cloudname });
  });
});

// API: Get distinct server IPs from deployed_server for dropdowns
// Retrieves distinct server IPs for dropdown selection with user filtering
// Returns IP addresses for UI dropdown components and server selection
app.get('/api/deployed-server-ips-dropdown', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json([req.hostname]);
  const sql = `SELECT DISTINCT serverip FROM deployed_server WHERE user_id = ? AND serverip IS NOT NULL AND serverip <> '' ORDER BY serverip`;
  db.query(sql, [userId], (err, rows) => {
    if (err) {
      console.error('Error fetching deployed server IPs:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    const ips = (rows || []).map(r => r.serverip).filter(Boolean);
    if (!ips.length) return res.json([req.hostname]);
    return res.json(ips);
  });
});

// API: Get all squadron nodes for Squadron tab (from deployed_server)
// Retrieves squadron nodes from deployed_server table excluding host nodes
// Returns node information with credentials and VIP details for squadron management
app.get('/api/squadron-nodes', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json([]);

  const nodeQuery = `
    SELECT serverid, serverip, hostname, role, license_code, server_vip, datetime, Management, Storage, External_Traffic, VXLAN
    FROM deployed_server
    WHERE user_id = ? AND (role IS NULL OR role NOT LIKE '%host%')
    ORDER BY datetime DESC
  `;

  db.query(nodeQuery, [userId], async (err, rows) => {
    if (err) {
      console.error('Error fetching squadron nodes:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    try {
      const results = (rows || []).map((row, idx) => ({
        sno: idx + 1,
        serverid: row.serverid,
        serverip: row.serverip,
        hostname: row.hostname,
        role: row.role,
        licensecode: row.license_code || null,
        credentialUrl: row.serverip ? `https://${row.serverip}/` : null,
        vip: row.server_vip || null,
        createdAt: row.datetime,
        Management: row.Management || null,
        Storage: row.Storage || null,
        External_Traffic: row.External_Traffic || null,
        VXLAN: row.VXLAN || null
      }));

      res.json(results);
    } catch (e) {
      console.error('Error building squadron nodes response:', e);
      res.status(500).json({ error: 'Failed to build response' });
    }
  });
});

// API: Get cloud deployments summary (uses deployed_server table)
// Retrieves cloud deployments summary with node counts and credential information
// Returns cloud statistics and representative server details for dashboard display
app.get('/api/cloud-deployments-summary', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json([]);

  const cloudQuery = `
    SELECT cloudname, MIN(datetime) as createdAt
    FROM deployed_server
    WHERE user_id = ?
    GROUP BY cloudname
    ORDER BY createdAt DESC
  `;

  db.query(cloudQuery, [userId], async (err, clouds) => {
    if (err) {
      console.error('Error fetching clouds from deployed_server:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    try {
      const results = await Promise.all((clouds || []).map(async (cloud, idx) => {
        // Count all nodes (rows) for this cloud
        const countQuery = `SELECT COUNT(*) AS cnt FROM deployed_server WHERE cloudname = ? AND user_id = ?`;
        const nodeCount = await new Promise((resolve, reject) => {
          db.query(countQuery, [cloud.cloudname, userId], (e, rows) => {
            if (e) return reject(e);
            resolve(rows && rows[0] ? rows[0].cnt : 0);
          });
        });

        // Pick the earliest row as representative for credentials
        const credQuery = `
          SELECT serverip, server_vip, datetime
          FROM deployed_server
          WHERE cloudname = ? AND user_id = ?
          ORDER BY datetime ASC
          LIMIT 1
        `;
        const firstRow = await new Promise((resolve, reject) => {
          db.query(credQuery, [cloud.cloudname, userId], (e, rows) => {
            if (e) return reject(e);
            resolve(rows && rows[0] ? rows[0] : null);
          });
        });

        return {
          sno: idx + 1,
          cloudname: cloud.cloudname,
          numberOfNodes: nodeCount,
          credentials: {
            serverip: firstRow?.serverip || null,
            server_vip: firstRow?.server_vip || null
          },
          createdAt: firstRow?.datetime || cloud.createdAt || null
        };
      }));

      res.json(results);
    } catch (e) {
      console.error('Error building cloud deployments summary:', e);
      res.status(500).json({ error: 'Failed to build summary' });
    }
  });
});

// Insert multiple node deployment activity logs into deployment_activity_log (type = 'primary')
// Creates multiple node deployment activity logs with type 'primary'
// Handles license binding and generates unique server IDs for squadron deployments
app.post('/api/node-deployment-activity-log', async (req, res) => {
  const nodes = req.body.nodes; // Array of node objects
  const { user_id, username, cloudname } = req.body;

  // Validate required fields
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid nodes array' });
  }
  if (!user_id || !username) {
    return res.status(400).json({ error: 'Missing required fields: user_id or username' });
  }

  try {
    const insertedNodes = [];
    for (const node of nodes) {
      const { serverip, hostname, server_vip, Management, Storage, External_Traffic, VXLAN, license_code, license_type, license_period, role } = node;
      if (!serverip) {
        return res.status(400).json({ error: 'Each node must have serverip' });
      }

      // Generate unique serverid with SQDN- prefix
      const nanoid6 = customAlphabet('ABCDEVSR0123456789abcdefgzkh', 6);
      const serverid = 'SQDN-' + nanoid6();

      // Insert deployment activity log (type = 'primary')
      const insSql = `
        INSERT INTO deployment_activity_log
          (serverid, user_id, username, cloudname, serverip, hostname, status, type, role, server_vip, Management, Storage, External_Traffic, VXLAN)
        VALUES (?, ?, ?, ?, ?, ?, 'progress', 'primary', ?, ?, ?, ?, ?, ?)
      `;
      await new Promise((resolve, reject) => {
        db.query(
          insSql,
          [serverid, user_id, username, cloudname || null, serverip, hostname || null, role || null, server_vip || null, Management || null, Storage || null, External_Traffic || null, VXLAN || null],
          (err) => (err ? reject(err) : resolve())
        );
      });

      // Upsert license if present and bind to serverid
      if (license_code) {
        const licenseInsertSQL = `
          INSERT INTO License (license_code, license_type, license_period, license_status, server_id)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            license_type=VALUES(license_type),
            license_period=VALUES(license_period),
            license_status=VALUES(license_status),
            server_id=VALUES(server_id)
        `;
        await new Promise((resolve, reject) => {
          db.query(licenseInsertSQL, [license_code, license_type, license_period, 'validated', serverid], (licErr) => (licErr ? reject(licErr) : resolve()));
        });
      }

      insertedNodes.push({ serverid, serverip });
    }

    return res.status(200).json({ message: 'Node deployment activity logs created successfully', nodes: insertedNodes });
  } catch (error) {
    console.error('Error inserting node deployment activity logs:', error);
    return res.status(500).json({ error: 'Failed to insert node deployment activity logs' });
  }
});

// Update node deployment activity log status (deployment_activity_log)
// Updates node deployment activity log status for a specific server
// Allows status changes for squadron deployment progress tracking
app.patch('/api/node-deployment-activity-log/:serverid', (req, res) => {
  const { serverid } = req.params;
  const { status } = req.body;
  const newStatus = status || 'completed';
  const sql = `UPDATE deployment_activity_log SET status = ? WHERE serverid = ?`;
  db.query(sql, [newStatus, serverid], (err) => {
    if (err) {
      console.error('Error updating node deployment activity log:', err);
      return res.status(500).json({ error: 'Failed to update node deployment activity log' });
    }
    return res.status(200).json({ message: `Node deployment activity log updated to ${newStatus}` });
  });
});

// Finalize a node deployment from deployment_activity_log into deployed_server (type = 'primary')
// Finalizes node deployment by moving from activity log to deployed_server table
// Activates licenses and sets start/end dates for squadron deployment completion
app.post('/api/finalize-node-deployment/:serverid', (req, res) => {
  const { serverid } = req.params;
  const { role } = req.body || {}; // Ignored; role is taken from log table

  const getSql = `SELECT * FROM deployment_activity_log WHERE serverid = ? LIMIT 1`;
  db.query(getSql, [serverid], (err, rows) => {
    if (err) {
      console.error('Error fetching node deployment activity log:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Node deployment not found' });
    }

    const dep = rows[0];

    // 1) Update status to completed (idempotent)
    const updateStatusSQL = `UPDATE deployment_activity_log SET status = 'completed' WHERE serverid = ?`;
    db.query(updateStatusSQL, [serverid], (upErr) => {
      if (upErr) {
        console.error('Error marking node deployment completed:', upErr);
      }

      // 2) Fetch linked license
      const licQuery = 'SELECT license_code FROM License WHERE server_id = ? LIMIT 1';
      db.query(licQuery, [serverid], (licErr, licRows) => {
        if (licErr) {
          console.error('Error fetching license_code for node:', licErr);
        }
        const licenseCodeToUse = licRows && licRows.length > 0 ? licRows[0].license_code : null;

        // 3) Activate license and set start/end dates
        if (licenseCodeToUse) {
          const getLicenseSQL = `SELECT license_period FROM License WHERE license_code = ?`;
          db.query(getLicenseSQL, [licenseCodeToUse], (getLicErr, licResults) => {
            if (getLicErr) {
              console.error('Error fetching license period for node:', getLicErr);
              const updLicSQL = `UPDATE License SET license_status = 'activated', server_id = ? WHERE license_code = ?`;
              db.query(updLicSQL, [serverid, licenseCodeToUse], (licUpdErr) => {
                if (licUpdErr) console.error('Error activating node license:', licUpdErr);
              });
            } else {
              const licensePeriod = licResults[0]?.license_period;
              const startDate = new Date().toISOString().split('T')[0];
              const endDate = calculateEndDate(licensePeriod);
              const updLicSQL = `UPDATE License SET license_status = 'activated', server_id = ?, start_date = ?, end_date = ? WHERE license_code = ?`;
              db.query(updLicSQL, [serverid, startDate, endDate, licenseCodeToUse], (licUpdErr) => {
                if (licUpdErr) console.error('Error activating node license:', licUpdErr);
              });
            }
          });
        }

        // 4) Upsert into deployed_server
        const checkSQL = 'SELECT id FROM deployed_server WHERE serverid = ? LIMIT 1';
        db.query(checkSQL, [serverid], (chkErr, chkRows) => {
          if (chkErr) {
            console.error('Error checking existing deployed server:', chkErr);
            return res.status(500).json({ error: 'Failed to finalize node (check)' });
          }

          const resolvedRole = (dep.role || 'child');

          if (chkRows && chkRows.length > 0) {
            const updSQL = `
              UPDATE deployed_server
              SET user_id=?, username=?, cloudname=?, serverip=?, hostname=?, server_vip=?, role=?, license_code=?, Management=?, Storage=?, External_Traffic=?, VXLAN=?
              WHERE serverid=?
            `;
            const updValues = [
              dep.user_id,
              dep.username || null,
              dep.cloudname || null,
              dep.serverip,
              dep.hostname || null,
              dep.server_vip || null,
              resolvedRole,
              licenseCodeToUse || null,
              dep.Management || null,
              dep.Storage || null,
              dep.External_Traffic || null,
              dep.VXLAN || null,
              serverid
            ];
            db.query(updSQL, updValues, (updErr) => {
              if (updErr) {
                console.error('Error updating deployed server record:', updErr);
                return res.status(500).json({ error: 'Failed to update deployed server record' });
              }
              return res.json({ message: 'Deployed server record updated successfully' });
            });
          } else {
            const insSQL = `
              INSERT INTO deployed_server (serverid, user_id, username, cloudname, serverip, hostname, server_vip, role, license_code, Management, Storage, External_Traffic, VXLAN)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const insValues = [
              serverid,
              dep.user_id,
              dep.username || null,
              dep.cloudname || null,
              dep.serverip,
              dep.hostname || null,
              dep.server_vip || null,
              resolvedRole,
              licenseCodeToUse || null,
              dep.Management || null,
              dep.Storage || null,
              dep.External_Traffic || null,
              dep.VXLAN || null
            ];
            db.query(insSQL, insValues, (insErr) => {
              if (insErr) {
                console.error('Error creating deployed server record:', insErr);
                return res.status(500).json({ error: 'Failed to create deployed server record' });
              }
              return res.json({ message: 'Deployed server record created successfully' });
            });
          }
        });
      });
    });
  });
});

// API: List pending node deployments filtered by status/type (defaults: progress/primary)
// Retrieves pending node deployments with optional status and type filtering
// Returns deployment status and configuration details for squadron monitoring
app.get('/api/pending-node-deployments', (req, res) => {
  const { status = 'progress', type = 'primary', user_id, cloudname } = req.query || {};
  let sql = `SELECT serverid, serverip, hostname, cloudname, user_id, username, server_vip, Management, Storage, External_Traffic, VXLAN
             FROM deployment_activity_log WHERE status = ? AND type = ?`;
  const params = [status, type];
  if (user_id) {
    sql += ' AND user_id = ?';
    params.push(user_id);
  }
  if (cloudname) {
    sql += ' AND cloudname = ?';
    params.push(cloudname);
  }
  sql += ' ORDER BY datetime ASC';
  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching pending node deployments:', err);
      return res.status(500).json({ error: 'Failed to fetch pending node deployments' });
    }
    return res.json({ rows });
  });
});

// API: Get server counts (total, online, offline)
// Retrieves server counts including total, online, and offline servers
// Uses Flask API to check server status and returns comprehensive inventory statistics
app.get('/api/server-counts', async (req, res) => {
  const hostIP = req.hostname;
  try {
    // Use deployed_server as the single source of truth for inventory counts
    const totalCountQuery = `SELECT COUNT(*) AS total_count FROM deployed_server`;
    const serverIpsQuery = `SELECT serverip FROM deployed_server`;

    const [total_count, serversResult] = await Promise.all([
      new Promise((resolve, reject) => {
        db.query(totalCountQuery, (err, result) => {
          if (err) reject(err);
          else resolve(result[0].total_count || 0);
        });
      }),
      new Promise((resolve, reject) => {
        db.query(serverIpsQuery, (err, result) => {
          if (err) reject(err);
          else resolve(result || []);
        });
      })
    ]);

    // For the Node.js implementation, we'll call the Flask endpoint to check server status
    // This is a temporary solution until we implement SSH functionality directly in Node.js
    const axios = require('axios');
    const https = require('https');

    // Create an HTTPS agent that doesn't validate certificates (for local development)
    const agent = new https.Agent({ rejectUnauthorized: false });

    // Check status of each server
    let online_count = 0;
    let offline_count = 0;

    // Process servers in batches to avoid too many concurrent connections
    const batchSize = 5;
    const servers = serversResult;

    for (let i = 0; i < servers.length; i += batchSize) {
      const batch = servers.slice(i, i + batchSize);
      const statusChecks = batch.map(async (server) => {
        try {
          const response = await axios.post(`https://${hostIP}:2020/check-server-status`, {
            server_ip: server.serverip
          }, {
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: agent
          });

          return response.data.status === 'online';
        } catch (error) {
          return false;
        }
      });

      const results = await Promise.all(statusChecks);
      online_count += results.filter(status => status).length;
      offline_count += results.filter(status => !status).length;
    }

    return res.status(200).json({
      total_count,
      online_count,
      offline_count
    });
  } catch (error) {
    console.error('Error getting server counts:', error);
    return res.status(500).json({ error: 'Failed to get server counts' });
  }
});

https.createServer(options, app).listen(5000, () => {
  console.log('Node.js backend is running on HTTPS at port 5000');
});

// Mark child deployment activity log as completed
// Updates child deployment activity log status for a specific server
// Allows status changes for child deployment progress tracking and management
app.patch('/api/child-deployment-activity-log/:serverid', (req, res) => {
  const { serverid } = req.params;
  const { status } = req.body;
  const newStatus = status || 'completed';
  const sql = `UPDATE deployment_activity_log SET status = ? WHERE serverid = ?`;
  db.query(sql, [newStatus, serverid], (err, result) => {
    if (err) {
      console.error('Error updating child deployment activity log:', err);
      return res.status(500).json({ error: 'Failed to update child deployment activity log' });
    }
    res.status(200).json({ message: `Child deployment activity log updated to ${newStatus}` });
  });
});

// Finalize a child deployment: mark completed and upsert into deployed_server
app.post('/api/finalize-child-deployment/:serverid', (req, res) => {
  const { serverid } = req.params;

  // Fetch child deployment data (prefer completed, but accept progress too if needed)
  const getChildSQL = `SELECT * FROM deployment_activity_log WHERE serverid = ? LIMIT 1`;
  db.query(getChildSQL, [serverid], (err, rows) => {
    if (err) {
      console.error('Error fetching child deployment activity log:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Child deployment not found' });
    }

    const dep = rows[0];

    // 1) Update status to completed (idempotent)
    const updateStatusSQL = `UPDATE deployment_activity_log SET status = 'completed' WHERE serverid = ?`;
    db.query(updateStatusSQL, [serverid], (upErr) => {
      if (upErr) {
        console.error('Error marking child deployment completed:', upErr);
        // Continue to try inserting child node anyway
      }

      // 2) Get license_code if linked
      const licQuery = 'SELECT license_code FROM License WHERE server_id = ? LIMIT 1';
      db.query(licQuery, [serverid], (licErr, licRows) => {
        if (licErr) {
          console.error('Error fetching license_code for child:', licErr);
        }
        const licenseCodeToUse = licRows && licRows.length > 0 ? licRows[0].license_code : null;

        // 3) Set license status to 'activated' and set start/end dates
        if (licenseCodeToUse) {
          // First get the license period to calculate end date
          const getLicenseSQL = `SELECT license_period FROM License WHERE license_code = ?`;
          db.query(getLicenseSQL, [licenseCodeToUse], (getLicErr, licResults) => {
            if (getLicErr) {
              console.error('Error fetching license period for child:', getLicErr);
              // Continue with basic update
              const updLicSQL = `UPDATE License SET license_status = 'activated', server_id = ? WHERE license_code = ?`;
              db.query(updLicSQL, [serverid, licenseCodeToUse], (licUpdErr) => {
                if (licUpdErr) {
                  console.error('Error activating child license:', licUpdErr);
                }
              });
            } else {
              const licensePeriod = licResults[0]?.license_period;
              const startDate = new Date().toISOString().split('T')[0]; // Today's date
              const endDate = calculateEndDate(licensePeriod);
              
              const updLicSQL = `UPDATE License SET license_status = 'activated', server_id = ?, start_date = ?, end_date = ? WHERE license_code = ?`;
              db.query(updLicSQL, [serverid, startDate, endDate, licenseCodeToUse], (licUpdErr) => {
                if (licUpdErr) {
                  console.error('Error activating child license:', licUpdErr);
                }
              });
            }
          });
        }

        // 4) Insert/update deployed_server entry
        const checkSQL = 'SELECT id FROM deployed_server WHERE serverid = ? LIMIT 1';
        db.query(checkSQL, [serverid], (chkErr, chkRows) => {
          if (chkErr) {
            console.error('Error checking existing child node:', chkErr);
            return res.status(500).json({ error: 'Failed to finalize child node (check)' });
          }

          const resolvedRole = (dep.role || 'child');

          if (chkRows && chkRows.length > 0) {
            // Update existing
            const updSQL = `
              UPDATE deployed_server
              SET user_id=?, username=?, cloudname=?, serverip=?, hostname=?, server_vip=?, role=?, license_code=?, Management=?, Storage=?, External_Traffic=?, VXLAN=?
              WHERE serverid=?
            `;
            const updValues = [
              dep.user_id,
              dep.username || null,
              null,
              dep.serverip,
              dep.hostname || null,
              null,
              resolvedRole,
              licenseCodeToUse || null,
              req.body.Management || dep.Management || null,
              req.body.Storage || dep.Storage || null,
              req.body.External_Traffic || dep.External_Traffic || null,
              req.body.VXLAN || dep.VXLAN || null,
              serverid
            ];
            db.query(updSQL, updValues, (updErr) => {
              if (updErr) {
                console.error('Error updating deployed server record:', updErr);
                return res.status(500).json({ error: 'Failed to update deployed server record' });
              }
              return res.json({ message: 'Deployed server record updated successfully' });
            });
          } else {
            // Insert new
            const insSQL = `
              INSERT INTO deployed_server (serverid, user_id, username, cloudname, serverip, hostname, server_vip, role, license_code, Management, Storage, External_Traffic, VXLAN)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            const insValues = [
              serverid,
              dep.user_id,
              dep.username || null,
              null,
              dep.serverip,
              dep.hostname || null,
              null,
              resolvedRole,
              licenseCodeToUse || null,
              req.body.Management || dep.Management || null,
              req.body.Storage || dep.Storage || null,
              req.body.External_Traffic || dep.External_Traffic || null,
              req.body.VXLAN || dep.VXLAN || null
            ];
            db.query(insSQL, insValues, (insErr) => {
              if (insErr) {
                console.error('Error creating deployed server record:', insErr);
                return res.status(500).json({ error: 'Failed to create deployed server record' });
              }
              return res.json({ message: 'Deployed server record created successfully' });
            });
          }
        });
      });
    });
  });
});


// API: Check if Host entry exists for a user (cloudName ignored)
// Checks if a host entry exists for a specific user in deployed_server table
// Returns boolean flag to determine if user has any deployed servers
app.get('/api/host-exists', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: 'userId is required' });
  let sql = 'SELECT 1 FROM deployed_server WHERE user_id = ? LIMIT 1';
  let params = [userId];
  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error checking Host existence:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (results.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  });
});

// Stores user ID in the users table for user management and tracking
// Creates new user entry if it doesn't exist using INSERT IGNORE
app.post('/store-user-id', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  const sql = 'INSERT IGNORE INTO users (id) VALUES (?)';
  db.query(sql, [userId], (err) => {
    if (err) return res.status(500).json({ message: 'Error storing user ID' });
    res.status(200).json({ message: 'User ID stored successfully' });
  });
});

// Get all Keycloak client secrets from database for authentication
// Retrieves all client secrets ordered by timestamp (newest first)
// Can be used for single secret (take first) or iterative authentication (try all)
app.get('/api/get-keycloak-secrets', (req, res) => {
  const sql = `SELECT client_secret FROM keycloak_client_secret ORDER BY timestamp DESC`;

  db.query(sql, [], (err, results) => {
    if (err) {
      console.error('Error retrieving Keycloak client secrets:', err);
      return res.status(500).json({ error: 'Failed to retrieve client secrets' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'No client secrets found in database' });
    }
    
    const clientSecrets = results.map(row => row.client_secret);
    console.log(`Retrieved ${clientSecrets.length} client secret(s) from database`);
    
    return res.status(200).json({ 
      client_secrets: clientSecrets,
      client_secret: clientSecrets[0], // For backward compatibility - returns most recent
      count: clientSecrets.length,
      source: 'database'
    });
  });
});

// Store Keycloak client secret received from Flask backend
// Receives client secret data from Flask and stores it in keycloak_client_secret table
// Only inserts if the client secret is different from existing ones
app.post('/api/store-keycloak-secret', (req, res) => {
  const { client_secret, source_file } = req.body;
  
  if (!client_secret) {
    return res.status(400).json({ error: 'client_secret is required' });
  }

  // First check if this client secret already exists
  const checkSql = `SELECT sno FROM keycloak_client_secret WHERE client_secret = ? LIMIT 1`;
  
  db.query(checkSql, [client_secret], (checkErr, checkResults) => {
    if (checkErr) {
      console.error('Error checking existing Keycloak client secret:', checkErr);
      return res.status(500).json({ error: 'Failed to check existing client secret' });
    }
    
    // If client secret already exists, don't insert
    if (checkResults && checkResults.length > 0) {
      const existingId = checkResults[0].sno;
      console.log(`Client secret already exists in database (ID: ${existingId}), skipping insertion`);
      
      return res.status(200).json({ 
        message: 'Client secret already exists, no insertion needed',
        record_id: existingId,
        action: 'skipped'
      });
    }
    
    // Client secret is new, proceed with insertion
    const insertSql = `INSERT INTO keycloak_client_secret (client_secret) VALUES (?)`;
    
    db.query(insertSql, [client_secret], (insertErr, insertResult) => {
      if (insertErr) {
        console.error('Error storing new Keycloak client secret:', insertErr);
        return res.status(500).json({ error: 'Failed to store Keycloak client secret' });
      }
      
      const recordId = insertResult.insertId;
      console.log(`New Keycloak client secret stored successfully with ID: ${recordId}, source: ${source_file || 'unknown'}`);
      
      return res.status(200).json({ 
        message: 'New Keycloak client secret stored successfully',
        record_id: recordId,
        action: 'inserted'
      });
    });
  });
});

// Validates cloud name availability by checking deployment_activity_log table
// Returns availability status to prevent duplicate cloud name creation
app.post("/check-cloud-name", async (req, res) => {
  const { cloudName } = req.body;

  try {
    const existingCloud = await new Promise((resolve, reject) => {
      const query = "SELECT * FROM deployment_activity_log WHERE cloudname = ?";
      db.query(query, [cloudName], (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    if (existingCloud.length > 0) {
      return res.status(400).json({ message: "Cloud name already exists. Please choose a different name." });
    }

    res.status(200).json({ message: "Cloud name is available." });
  } catch (error) {
    console.error("Error checking cloud name:", error);
    res.status(500).json({ message: "An error occurred while checking the cloud name." });
  }
});