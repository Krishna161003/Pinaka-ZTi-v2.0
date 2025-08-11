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
  const today = new Date().toISOString().split('T')[0]; // Today's date in YYYY-MM-DD format
  
  const updateExpiredSQL = `
    UPDATE License 
    SET license_status = 'expired' 
    WHERE license_status = 'activated' 
    AND end_date IS NOT NULL 
    AND end_date < ?
  `;
  
  db.query(updateExpiredSQL, [today], (err, result) => {
    if (err) {
      console.error('Error updating expired licenses:', err);
    } else if (result.affectedRows > 0) {
      console.log(`Updated ${result.affectedRows} expired license(s)`);
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

app.use(bodyParser.json());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Get license details by server ID
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
app.post("/run-script", (req, res) => {
  const { userUsername, userId, newPassword, hostIP } = req.body;

  // Log received request data
  console.log("Received request body:", req.body);

  // Ensure all required fields are provided
  if (!userUsername || !userId || !newPassword || !hostIP) {
    return res.status(400).send({
      message:
        "Missing required fields: userUsername, userId, newPassword, or hostIP",
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

        // If password already updated, don't allow another update
        if (updatePwdStatus) {
          return res
            .status(400)
            .send({ message: "Password already updated for this user" });
        }

        // Command to execute the shell script with the arguments in the correct order
        const command = `bash /usr/src/app/update-password.sh ${userUsername} ${userId} ${newPassword} ${hostIP}`;

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

  // Create all_in_one table with new fields
  const deploymentsTableSQL = `
    CREATE TABLE IF NOT EXISTS all_in_one (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id CHAR(21),
      cloudName VARCHAR(255),
      Ip VARCHAR(15),
      SkylineURL VARCHAR(255),
      CephURL VARCHAR(255),
      deployment_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      bmc_ip VARCHAR(15),           
      bmc_username VARCHAR(255),   
      bmc_password VARCHAR(255)
    ) ENGINE=InnoDB;  -- Ensure InnoDB engine for foreign key support
  `;
  db.query(deploymentsTableSQL, (err, result) => {
    if (err) throw err;
    console.log("All_in_one table checked/created...");
  });

  // Create hardware_info table if not exists
  const hardwareInfoTableSQL = `
    CREATE TABLE IF NOT EXISTS hardware_info (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id CHAR(21),
      server_ip VARCHAR(15),
      cpu_cores INT,
      memory VARCHAR(50), -- e.g., '16GB', '32GB'
      disk VARCHAR(255), -- e.g., '500GB SSD, 1TB HDD'
      nic_1g INT, -- Number of 1G NICs
      nic_10g INT, -- Number of 10G NICs
      FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB;  -- Ensure InnoDB engine for foreign key support
  `;

  db.query(hardwareInfoTableSQL, (err, result) => {
    if (err) throw err;
    console.log("Hardware_info table checked/created...");
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
      status VARCHAR(255),               -- status
      type VARCHAR(255),                 -- type
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

    // Create new deployment_activity_log table with default timestamp
    const childDeploymentActivityLogTableSQL = `
        CREATE TABLE IF NOT EXISTS child_deployment_activity_log (
          id INT AUTO_INCREMENT PRIMARY KEY, -- S.NO
          serverid CHAR(36) UNIQUE NOT NULL, -- serverid (generate with nanoid or uuid in app code)
          user_id CHAR(36),                  -- Userid
          host_serverid CHAR(36),             -- Host Serverid
          username VARCHAR(255),             -- username
          serverip VARCHAR(15),              -- serverip
          status VARCHAR(255),               -- status
          type VARCHAR(255),                 -- type
          role VARCHAR(255),                 -- role
          Management VARCHAR(255) NULL,
          Storage VARCHAR(255) NULL,
          External_Traffic VARCHAR(255) NULL,
          VXLAN VARCHAR(255) NULL,
          datetime DATETIME DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_user_id (user_id)        -- Added index for foreign key
        ) ENGINE=InnoDB;
        `;

    db.query(childDeploymentActivityLogTableSQL, (err, result) => {
      if (err) throw err;
      console.log("Child Deployment_Activity_log table checked/created...");
      // Ensure 'role' column exists (MySQL 8 supports IF NOT EXISTS)
      db.query("ALTER TABLE child_deployment_activity_log ADD COLUMN IF NOT EXISTS role VARCHAR(255)", (altErr) => {
        if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
          console.warn("Could not ensure 'role' column on child_deployment_activity_log:", altErr.message);
        }
      });
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
      db.query("ALTER TABLE License ADD COLUMN IF NOT EXISTS start_date DATE NULL", (altErr) => {
        if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
          console.warn("Could not ensure 'start_date' column on License:", altErr.message);
        }
      });
      
      db.query("ALTER TABLE License ADD COLUMN IF NOT EXISTS end_date DATE NULL", (altErr) => {
        if (altErr && altErr.code !== 'ER_DUP_FIELDNAME' && altErr.code !== 'ER_CANT_ADD_FIELD') {
          console.warn("Could not ensure 'end_date' column on License:", altErr.message);
        }
      });

      // Create Host table
      const hostTableSQL = `
        CREATE TABLE IF NOT EXISTS Host (
          id INT AUTO_INCREMENT PRIMARY KEY, -- S.No
          user_id CHAR(36), -- User_id (Foreign Key)
          server_id CHAR(36), -- Server_id (Foreign Key)
          cloudname VARCHAR(255), -- Cloudname
          serverip VARCHAR(15), -- ServerIP
          servervip VARCHAR(255), -- ServerVIP
          role VARCHAR(255), -- Role
          license_code VARCHAR(255), -- License_code (Foreign Key)
          Management VARCHAR(255) NULL,
          Storage VARCHAR(255) NULL,
          External_Traffic VARCHAR(255) NULL,
          VXLAN VARCHAR(255) NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES deployment_activity_log(user_id),
          FOREIGN KEY (server_id) REFERENCES deployment_activity_log(serverid),
          FOREIGN KEY (license_code) REFERENCES License(license_code)
        ) ENGINE=InnoDB;
      `;

      db.query(hostTableSQL, (err, result) => {
        if (err) throw err;
        console.log("Host table checked/created...");
        // Ensure unique constraint on server_id
        db.query('ALTER TABLE Host ADD UNIQUE KEY unique_server_id (server_id)', (err) => {
          if (err && err.code !== 'ER_DUP_KEYNAME' && err.code !== 'ER_DUP_ENTRY' && err.code !== 'ER_ALREADY_EXISTS') {
            // Ignore if already exists, else log
            console.error('Error adding unique constraint to Host.server_id:', err.message);
          } else if (!err) {
            console.log('Unique constraint on Host.server_id ensured.');
          }
        });
      });

      // Create Child Node table
      const childNodeTableSQL = `
        CREATE TABLE IF NOT EXISTS child_node (
          id INT AUTO_INCREMENT PRIMARY KEY, -- S.No
          user_id CHAR(36), -- User_id (Foreign Key)
          server_id CHAR(36), -- Server_id (Foreign Key)
          host_serverid VARCHAR(255), -- Host_serverid
          serverip VARCHAR(15), -- ServerIP
          role VARCHAR(255), -- Role
          license_code VARCHAR(255), -- License_code (Foreign Key)
          Management VARCHAR(255) NULL,
          Storage VARCHAR(255) NULL,
          External_Traffic VARCHAR(255) NULL,
          VXLAN VARCHAR(255) NULL,
          timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES child_deployment_activity_log(user_id),
          FOREIGN KEY (server_id) REFERENCES child_deployment_activity_log(serverid),
          FOREIGN KEY (license_code) REFERENCES License(license_code)
        ) ENGINE=InnoDB;
      `;

      db.query(childNodeTableSQL, (err, result) => {
        if (err) throw err;
        console.log("Child Node table checked/created...");
      });
    });
    console.log("Child Node table checked/created...");
  });
  
  // Set up periodic check for expired licenses (run every hour)
  setInterval(checkAndUpdateExpiredLicenses, 60 * 60 * 1000); // 60 minutes * 60 seconds * 1000 milliseconds
  
  // Also run the check once on startup
  setTimeout(checkAndUpdateExpiredLicenses, 5000); // Run after 5 seconds to ensure DB is ready
});

// Helper to get the latest in-progress deployment for a user
app.get('/api/deployment-activity-log/latest-in-progress/:user_id', (req, res) => {
  const { user_id } = req.params;
  const sql = `
    SELECT * FROM deployment_activity_log 
    WHERE user_id = ? AND status = 'progress' 
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

// Get latest in-progress child deployment activity log for a user
app.get('/api/child-deployment-activity-log/latest-in-progress/:user_id', (req, res) => {
  const { user_id } = req.params;
  const sql = `
    SELECT * FROM child_deployment_activity_log 
    WHERE user_id = ? AND status = 'progress' 
    ORDER BY datetime DESC 
    LIMIT 1
  `;
  db.query(sql, [user_id], (err, results) => {
    if (err) {
      console.error('Error fetching in-progress child deployment:', err);
      return res.status(500).json({ error: 'Failed to fetch child deployment status' });
    }
    res.json({
      inProgress: results.length > 0,
      log: results[0] || null
    });
  });
});

// Insert new deployment activity log
const { nanoid } = require('nanoid');

app.post('/api/deployment-activity-log', (req, res) => {
  const { user_id, username, cloudname, serverip, vip, Management, External_Traffic, Storage, VXLAN } = req.body;
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
        (serverid, user_id, username, cloudname, serverip, status, type, server_vip, Management, External_Traffic, Storage, VXLAN)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [serverid, user_id, username, cloudname, serverip, status, type, vip, Management || null, External_Traffic || null, Storage || null, VXLAN || null], (err, result) => {
      if (err) {
        console.error('Error inserting deployment activity log:', err);
        return res.status(500).json({ error: 'Failed to insert deployment activity log' });
      }
      // Insert license details if provided
      const { license_code, license_type, license_period } = req.body;
      if (license_code) {
        const licenseInsertSQL = `
          INSERT INTO License (license_code, license_type, license_period, license_status, server_id) 
          VALUES (?, ?, ?, 'validated', ?)
          ON DUPLICATE KEY UPDATE 
            license_type=VALUES(license_type), 
            license_period=VALUES(license_period), 
            server_id=VALUES(server_id)
        `;
        db.query(licenseInsertSQL, [license_code, license_type, license_period, serverid], (licErr) => {
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
app.put('/api/update-license/:serverid', (req, res) => {
  const { serverid } = req.params;
  const { license_code, license_type, license_period, status } = req.body || {};

  if (!license_code || !license_type || !serverid) {
    return res.status(400).json({ message: 'license_code, license_type and serverid are required' });
  }

  const normalizedType = String(license_type).toLowerCase();
  const isPerpetual = normalizedType === 'perpectual' || normalizedType === 'perpetual';
  const effectiveStatus = (status || 'activated').toLowerCase();

  // Decide dates per requirement:
  // If status is activated:
  //  - Always set start_date to today
  //  - Set end_date to NULL for perpetual; otherwise compute from license_period
  let startDate = null;
  let endDate = null;
  if (effectiveStatus === 'activated') {
    startDate = new Date().toISOString().split('T')[0];
    endDate = isPerpetual ? null : calculateEndDate(license_period);
  }

  // If type is perpetual, force status activated and dates null as per requirement
  const finalStatus = isPerpetual ? 'activated' : effectiveStatus;

  const insertSql = `
    INSERT INTO License (license_code, license_type, license_period, license_status, server_id, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    insertSql,
    [license_code, license_type, license_period || null, finalStatus, serverid, startDate, endDate],
    (err, result) => {
      if (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(409).json({ message: 'License code already exists' });
        }
        console.error('Error inserting license:', err);
        return res.status(500).json({ message: 'Failed to create license entry' });
      }

      // Also update Host and child_node tables to reflect the new license for this server
      const updateHostSql = 'UPDATE Host SET license_code = ? WHERE server_id = ?';
      db.query(updateHostSql, [license_code, serverid], (hostErr) => {
        if (hostErr) {
          console.error('Error updating Host with new license:', hostErr);
          return res.status(500).json({ message: 'License created but failed to update Host table' });
        }

        const updateChildSql = 'UPDATE child_node SET license_code = ? WHERE server_id = ?';
        db.query(updateChildSql, [license_code, serverid], (childErr) => {
          if (childErr) {
            console.error('Error updating child_node with new license:', childErr);
            return res.status(500).json({ message: 'License created but failed to update child_node table' });
          }

          return res.status(200).json({
            message: 'License updated successfully',
            license: {
              license_code,
              license_type,
              license_period: license_period || null,
              license_status: finalStatus,
              server_id: serverid,
              start_date: startDate,
              end_date: endDate
            }
          });
        });
      });
    }
  );
});

// API to transfer completed deployment to appropriate table

app.post('/api/finalize-deployment/:serverid', (req, res) => {
  const { serverid } = req.params;
  // ... (rest of the code remains the same)
  const { server_type, role, host_serverid } = req.body;

  // First get the deployment data
  const getDeploymentSQL = `SELECT * FROM deployment_activity_log WHERE serverid = ? AND status = 'completed'`;

  db.query(getDeploymentSQL, [serverid], (err, results) => {
    if (err) {
      console.error('Error fetching deployment:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Deployment not found or not completed' });
    }

    const deployment = results[0];

    // Fetch the latest license_code for the serverid from License table
    const licenseQuery = 'SELECT license_code FROM License WHERE server_id = ? ORDER BY id DESC LIMIT 1';
    db.query(licenseQuery, [deployment.serverid], (licErr, licResults) => {
      if (licErr) {
        console.error('Error fetching license_code:', licErr);
        return res.status(500).json({ error: 'Failed to fetch license_code' });
      }
      const licenseCodeToUse = licResults.length > 0 ? licResults[0].license_code : null;

      // Update license status to 'activated' and set start/end dates
      if (licenseCodeToUse) {
        // Fetch license details to determine type and period
        const getLicenseSQL = `SELECT license_period, license_type FROM License WHERE license_code = ?`;
        db.query(getLicenseSQL, [licenseCodeToUse], (getLicErr, licResults) => {
          if (getLicErr) {
            console.error('Error fetching license period:', getLicErr);
            // Continue with basic update
            const updateLicenseSQL = `UPDATE License SET license_status = 'activated', server_id = ? WHERE license_code = ?`;
            db.query(updateLicenseSQL, [deployment.serverid, licenseCodeToUse], (licUpdateErr, result) => {
              if (licUpdateErr) {
                console.error('Error updating license status:', licUpdateErr);
              } else {
                console.log('License status updated:', result);
              }
            });
          } else {
            const licensePeriod = licResults[0]?.license_period;
            const licenseType = String(licResults[0]?.license_type || '').toLowerCase();
            const isPerpetual = licenseType === 'perpetual' || licenseType === 'perpectual';
            const startDate = new Date().toISOString().split('T')[0]; // Today's date

            if (isPerpetual) {
              // Perpetual: set start_date, keep end_date NULL
              const updateLicenseSQL = `UPDATE License SET license_status = 'activated', server_id = ?, start_date = ?, end_date = NULL WHERE license_code = ?`;
              db.query(updateLicenseSQL, [deployment.serverid, startDate, licenseCodeToUse], (licUpdateErr, result) => {
                if (licUpdateErr) {
                  console.error('Error updating perpetual license status:', licUpdateErr);
                } else {
                  console.log('Perpetual license activated with start date and NULL end date:', result);
                }
              });
            } else {
              // Term licenses: compute end date from period
              const endDate = calculateEndDate(licensePeriod);
              const updateLicenseSQL = `UPDATE License SET license_status = 'activated', server_id = ?, start_date = ?, end_date = ? WHERE license_code = ?`;
              db.query(updateLicenseSQL, [deployment.serverid, startDate, endDate, licenseCodeToUse], (licUpdateErr, result) => {
                if (licUpdateErr) {
                  console.error('Error updating term license status:', licUpdateErr);
                } else {
                  console.log('Term license activated with dates:', result);
                }
              });
            }
          }
        });
      }

      if (server_type === 'host') {
        // Insert into Host table
        const hostSQL = `
          INSERT IGNORE INTO Host (user_id, server_id, cloudname, serverip, servervip, role, license_code, Management, Storage, External_Traffic, VXLAN)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const hostValues = [
          deployment.user_id,
          deployment.serverid,
          deployment.cloudname,
          deployment.serverip,
          deployment.server_vip || null,
          role || 'host',
          licenseCodeToUse,
          req.body.Management || deployment.Management || null,
          req.body.External_Traffic || deployment.External_Traffic || null,
          req.body.Storage || deployment.Storage || null,
          req.body.VXLAN || deployment.VXLAN || null
        ];
        console.log('Executing host SQL:', { sql: hostSQL, values: hostValues });
        db.query(hostSQL, hostValues, (err) => {
          if (err) {
            console.error('Error creating host record:', err);
            return res.status(500).json({ error: 'Failed to create host record' });
          }
          res.json({ message: 'Host record created successfully' });
        });
      } else if (server_type === 'child') {
        // Insert into child_node table
        const childSQL = `
          INSERT INTO child_node (user_id, server_id, host_serverid, serverip, role, license_code, Management, Storage, External_Traffic, VXLAN)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        db.query(childSQL, [
          deployment.user_id,
          deployment.serverid,
          host_serverid || '',
          deployment.serverip,
          role || 'child',
          licenseCodeToUse,
          req.body.Management || deployment.Management || null,
          req.body.External_Traffic || deployment.External_Traffic || null,
          req.body.Storage || deployment.Storage || null,
          req.body.VXLAN || deployment.VXLAN || null
        ], (err) => {
          if (err) {
            console.error('Error creating child node record:', err);
            return res.status(500).json({ error: 'Failed to create child node record' });
          }
          res.json({ message: 'Child node record created successfully' });
        });
      } else {
        return res.status(400).json({ error: 'Invalid server_type. Must be "host" or "child"' });
      }
    });
  });
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

// Insert multiple child node deployment activity logs
app.post('/api/child-deployment-activity-log', async (req, res) => {
  const nodes = req.body.nodes; // Array of node objects
  const { user_id, username, host_serverid } = req.body;

  // Validate required fields
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid nodes array' });
  }

  if (!user_id || !username || !host_serverid) {
    return res.status(400).json({ error: 'Missing required fields: user_id, username, or host_serverid' });
  }

  try {
    // Generate server IDs for each node and insert into child_deployment_activity_log
    const insertedNodes = [];

    for (const node of nodes) {
      const { serverip, type, role, Management, Storage, External_Traffic, VXLAN } = node;
      // Normalize role: allow array of roles to be stored as comma-separated string
      const normalizedRole = Array.isArray(role) ? role.join(',') : role;

      // Validate node required fields
      if (!serverip || !type) {
        return res.status(400).json({ error: 'Each node must have serverip and type' });
      }

      // Generate unique serverid with SQDN- prefix
      const nanoid6 = customAlphabet('ABCDEVSR0123456789abcdefgzkh', 6);
      const serverid = 'SQDN-' + nanoid6();

      // Insert child deployment activity log
      const sql = `
INSERT INTO child_deployment_activity_log 
    (serverid, user_id, host_serverid, username, serverip, status, type, role, Management, Storage, External_Traffic, VXLAN)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

      await new Promise((resolve, reject) => {
        db.query(sql, [
          serverid, user_id, host_serverid, username, serverip, 'progress', 'child',
          normalizedRole || null, Management || null, Storage || null, External_Traffic || null, VXLAN || null
        ], (err, result) => {
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        });
      });

      // Insert or update license details if provided
      const { license_code, license_type, license_period } = node;
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
          db.query(licenseInsertSQL, [license_code, license_type, license_period, 'validated', serverid], (licErr) => {
            if (licErr) {
              reject(licErr);
            } else {
              resolve();
            }
          });
        });
      }

      insertedNodes.push({
        serverid,
        serverip,
        type,
        role: role || null
      });
    }

    res.status(200).json({
      message: 'Child deployment activity logs created successfully',
      nodes: insertedNodes
    });

  } catch (error) {
    console.error('Error inserting child deployment activity logs:', error);
    res.status(500).json({ error: 'Failed to insert child deployment activity logs' });
  }
});

// API: Get first Host server_id for a user (or any user if not provided)
app.get('/api/first-host-serverid', (req, res) => {
  const { userId } = req.query;
  let sql = 'SELECT server_id FROM Host';
  let params = [];
  if (userId) {
    sql += ' WHERE user_id = ?';
    params.push(userId);
  }
  sql += ' ORDER BY id ASC LIMIT 1';
  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error fetching first Host server_id:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    if (results.length > 0) {
      return res.json({ server_id: results[0].server_id });
    } else {
      return res.json({ server_id: null });
    }
  });
});

// API: Check if Host entry exists for a user (cloudName ignored)
app.get('/api/host-exists', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ message: 'userId is required' });
  let sql = 'SELECT 1 FROM Host WHERE user_id = ? LIMIT 1';
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

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

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

app.post('/store-user-id', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ message: 'User ID is required' });

  const sql = 'INSERT IGNORE INTO users (id) VALUES (?)';
  db.query(sql, [userId], (err) => {
    if (err) return res.status(500).json({ message: 'Error storing user ID' });
    res.status(200).json({ message: 'User ID stored successfully' });
  });
});


// API to fetch bmc data from the `all_in_one` table
app.post("/api/get-power-details", (req, res) => {
  const { userID } = req.body;

  if (!userID) {
    return res.status(400).json({ error: "Missing userID" });
  }

  // Query to fetch data
  const query = "SELECT bmc_ip AS ip, bmc_username AS username, bmc_password AS password, cloudName FROM all_in_one WHERE user_id = ?";
  db.query(query, [userID], (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({ error: "Database query failed" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "No data found for the given userID" });
    }

    // Return all matching records
    res.json(results);  // Return the entire results array
  });
});



// API to check if a license code exists in the License table
app.post('/api/check-license-exists', (req, res) => {
  const { license_code } = req.body;
  if (!license_code) {
    return res.status(400).json({ message: 'license_code is required' });
  }
  const sql = 'SELECT 1 FROM License WHERE license_code = ? LIMIT 1';
  db.query(sql, [license_code], (err, results) => {
    if (err) {
      console.error('Error checking license existence:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (results.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  });
});

app.post("/register", async (req, res) => {
  const { companyName, email, password } = req.body;

  try {
    // Check if the email already exists
    const existingUser = await new Promise((resolve, reject) => {
      const checkEmailSql = "SELECT * FROM users WHERE email = ?";
      db.query(checkEmailSql, [email], (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

    if (existingUser.length > 0) {
      return res.status(400).json({ message: "Email already exists !" });
    }

    // Dynamically import nanoid with custom alphabet
    const { customAlphabet } = await import("nanoid");
    const nanoid = customAlphabet("ABCDEVSR0123456789abcdefgzkh", 6);
    const id = nanoid(); // Generate unique ID with custom alphabet

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const sql =
      "INSERT INTO users (id, companyName, email, password) VALUES (?, ?, ?, ?)";
    await new Promise((resolve, reject) => {
      db.query(sql, [id, companyName, email, hashedPassword], (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });


    // Set the user session after registration
    req.session.userId = id;

    // Send registration email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      cc: ["support@pinakastra.cloud"],
      subject: "Welcome to Pinakastra!",
      html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);">
      
      <!-- Banner/Header -->
      <div style="background-color: #002147; padding: 20px; text-align: center;">
        <img src="https://pinakastra.com/assets/images/logo/logo.png" alt="Pinakastra" style="height: 50px;">
      </div>
      
      <!-- Main Content -->
      <div style="background-color: #f5f5f5; padding: 30px; text-align: center;">
        <h2 style="color: #1f75b6;">Welcome to Pinakastra!</h2>
        <p style="font-size: 16px; color: #333;">
          Hello <strong>${companyName}</strong>,
        </p>
        <p style="font-size: 16px; color: #333;">
          Thank you for joining us! Your account has been successfully registered.
        </p>
        <div style="background-color: #ffffff; border-radius: 10px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
          <p style="font-size: 14px; color: #555; margin: 0;">
            <strong>Your User ID :</strong>
          </p>
          <p style="font-size: 16px; color: #333; margin: 10px 0;">
          </p>
          <p style="font-size: 24px; color: #1f75b6; font-weight: bold; margin: 0;">
            ${id}
          </p>
        </div>
        <p style="font-size: 14px; color: #555;">
          Please keep this information secure.
        </p>
        <p style="font-size: 14px; color: #555;">
          If you have any questions or need assistance, feel free to contact our support team.
        </p>
      </div>
      
      <!-- Footer -->
      <div style="background-color: #002147; padding: 10px; text-align: center; color: #fff;">
        <p style="margin: 0;">Pinakastra Cloud </p>
        <p style="margin: 0;">
          <a href="mailto:cloud@pinakastra.com" style="color: #ffeb3b; text-decoration: none;">support@pinakastra.cloud</a>
        </p>
        <div style="margin-top: 10px;">
          <a href="https://www.facebook.com/profile.php?id=61552535922993&mibextid=kFxxJD" style="margin: 0 5px; color: #fff; text-decoration: none;">Facebook</a>
          <a href="https://x.com/pinakastra" style="margin: 0 5px; color: #fff; text-decoration: none;">X</a>
          <a href="https://linkedin.com/company/pinakastra-computing" style="margin: 0 5px; color: #fff; text-decoration: none;">LinkedIn</a>
        </div>
        <p style="margin-top: 10px; font-size: 12px;">&copy; Copyright  2021, All Right Reserved Pinakastra</p>
      </div>
    </div>
  `
    };

    await new Promise((resolve, reject) => {
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          reject(error);
        } else {
          console.log("Email sent:", info.response);
          resolve(info);
        }
      });
    });

    res
      .status(200)
      .json({ message: "User registered successfully", userId: id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error registering user" });
  }
});


// API: Get cloud deployments summary
app.get('/api/cloud-deployments-summary', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json([]);
  // Query distinct cloud names from Host table for this user
  const cloudQuery = `SELECT cloudname, MIN(timestamp) as createdAt FROM Host WHERE user_id = ? GROUP BY cloudname ORDER BY createdAt DESC`;
  db.query(cloudQuery, [userId], async (err, clouds) => {
    if (err) {
      console.error('Error fetching clouds:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    // For each cloud, get number of hosts and children
    const results = await Promise.all(clouds.map(async (cloud, idx) => {
      // Get all hosts for this cloud
      const hostQuery = `SELECT server_id, serverip, servervip, timestamp FROM Host WHERE cloudname = ? AND user_id = ?`;
      const hosts = await new Promise((resolve, reject) => {
        db.query(hostQuery, [cloud.cloudname, userId], (err, hostRows) => {
          if (err) return reject(err);
          resolve(hostRows);
        });
      });
      const hostCount = hosts.length;
      let childCount = 0;
      let hostserverip = null;
      let hostservervip = null;
      let createdAt = cloud.createdAt;
      if (hostCount > 0) {
        const serverIds = hosts.map(h => h.server_id);
        // Use the first host's serverip and servervip for the cloud
        hostserverip = hosts[0]?.serverip || null;
        hostservervip = hosts[0]?.servervip || null;
        createdAt = hosts[0]?.timestamp || cloud.createdAt;
        // Count all child nodes for these hosts
        const childQuery = `SELECT COUNT(*) AS cnt FROM child_node WHERE host_serverid IN (${serverIds.map(() => '?').join(',')})`;
        if (serverIds.length > 0) {
          const childRows = await new Promise((resolve, reject) => {
            db.query(childQuery, serverIds, (err, rows) => {
              if (err) return reject(err);
              resolve(rows);
            });
          });
          childCount = (childRows && childRows[0] && typeof childRows[0].cnt === 'number') ? childRows[0].cnt : 0;
        }
      }
      return {
        sno: idx + 1,
        cloudName: cloud.cloudname,
        numberOfNodes: hostCount + childCount,
        credentials: {
          hostserverip,
          hostservervip
        },
        createdAt: createdAt
      };
    }));
    res.json(results);
  });
});

// API: Get all hosts for Flight Deck tab
app.get('/api/flight-deck-hosts', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json([]);
  // Get all hosts for this user
  const hostQuery = `SELECT id, server_id, serverip, servervip, role, license_code, timestamp FROM Host WHERE user_id = ? ORDER BY timestamp DESC`;
  db.query(hostQuery, [userId], async (err, hosts) => {
    if (err) {
      console.error('Error fetching hosts:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    // For each host, get license status and squadron node count
    const results = await Promise.all(hosts.map(async (host, idx) => {
      // Get license status if license_code exists
      let licenseCode = null;
      if (host.license_code) {
        const licStatus = await new Promise((resolve) => {
          db.query('SELECT license_status FROM License WHERE license_code = ? LIMIT 1', [host.license_code], (err, rows) => {
            if (err || !rows.length) return resolve(null);
            resolve(rows[0].license_status === 'activated' ? host.license_code : null);
          });
        });
        licenseCode = licStatus;
      }
      // Get squadron node count
      const squadronNodeCount = await new Promise((resolve) => {
        db.query('SELECT COUNT(*) AS cnt FROM child_node WHERE host_serverid = ?', [host.server_id], (err, rows) => {
          if (err || !rows.length) return resolve(0);
          resolve(rows[0].cnt);
        });
      });
      return {
        sno: idx + 1,
        serverid: host.server_id,
        serverip: host.serverip,
        vip: host.servervip,
        role: host.role,
        licensecode: licenseCode,
        squadronNode: squadronNodeCount,
        credentialsUrl: host.serverip ? `https://${host.serverip}/` : null,
        createdAt: host.timestamp
      };
    }));
    res.json(results);
  });
});

// API: Get all squadron nodes for Squadron tab
app.get('/api/squadron-nodes', async (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json([]);
  const nodeQuery = `SELECT id, server_id, serverip, role, license_code, host_serverid, timestamp FROM child_node WHERE user_id = ? ORDER BY timestamp DESC`;
  db.query(nodeQuery, [userId], async (err, nodes) => {
    if (err) {
      console.error('Error fetching squadron nodes:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    const results = await Promise.all(nodes.map(async (node, idx) => {
      // Get license status if license_code exists
      let licenseCode = null;
      if (node.license_code) {
        const licStatus = await new Promise((resolve) => {
          db.query('SELECT license_status FROM License WHERE license_code = ? LIMIT 1', [node.license_code], (err, rows) => {
            if (err || !rows.length) return resolve(null);
            resolve(rows[0].license_status === 'activated' ? node.license_code : null);
          });
        });
        licenseCode = licStatus;
      }
      // Get VIP from Host table for host_serverid
      let vip = null;
      if (node.host_serverid) {
        vip = await new Promise((resolve) => {
          db.query('SELECT servervip FROM Host WHERE server_id = ? LIMIT 1', [node.host_serverid], (err, rows) => {
            if (err || !rows.length) return resolve(null);
            resolve(rows[0].servervip);
          });
        });
      }
      return {
        sno: idx + 1,
        serverid: node.server_id,
        serverip: node.serverip,
        role: node.role,
        licensecode: licenseCode,
        credentialUrl: node.serverip ? `https://${node.serverip}/` : null,
        vip: vip,
        createdAt: node.timestamp
      };
    }));
    res.json(results);
  });
});

// API: Get dashboard counts for Cloud, Flight Deck, and Squadron
app.get('/api/dashboard-counts/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    // Get unique cloud count from Host table
    const cloudCountQuery = `SELECT COUNT(DISTINCT cloudname) AS cloudCount FROM Host WHERE user_id = ?`;

    // Get flight deck count from Host table
    const flightDeckCountQuery = `SELECT COUNT(*) AS flightDeckCount FROM Host WHERE user_id = ?`;

    // Get squadron count from child_node table
    const squadronCountQuery = `SELECT COUNT(*) AS squadronCount FROM child_node WHERE user_id = ?`;

    // Execute all queries in parallel
    const [cloudResult, flightDeckResult, squadronResult] = await Promise.all([
      new Promise((resolve, reject) => {
        db.query(cloudCountQuery, [userId], (err, result) => {
          if (err) reject(err);
          else resolve(result[0].cloudCount);
        });
      }),
      new Promise((resolve, reject) => {
        db.query(flightDeckCountQuery, [userId], (err, result) => {
          if (err) reject(err);
          else resolve(result[0].flightDeckCount);
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
      flightDeckCount: flightDeckResult,
      squadronCount: squadronResult
    });
  } catch (error) {
    console.error('Error fetching dashboard counts:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard counts' });
  }
});

// API: Get all hosts (for Inventory tab 1)
app.get('/api/hosts', (req, res) => {
  const userId = req.query.userId;
  let sql = 'SELECT * FROM Host';
  let params = [];
  if (userId) {
    sql += ' WHERE user_id = ?';
    params.push(userId);
  }
  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error fetching hosts:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// API: Get all child nodes (for Inventory tab 2)
app.get('/api/child-nodes', (req, res) => {
  const userId = req.query.userId;
  let sql = 'SELECT * FROM child_node';
  let params = [];
  if (userId) {
    sql += ' WHERE user_id = ?';
    params.push(userId);
  }
  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Error fetching child nodes:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// API: Get server counts (total, online, offline)
app.get('/api/server-counts', async (req, res) => {
  const hostIP = req.hostname;
  try {
    // Get count of servers from Host table
    const hostCountQuery = `SELECT COUNT(*) as host_count FROM Host`;

    // Get count of servers from child_node table
    const childCountQuery = `SELECT COUNT(*) as child_count FROM child_node`;

    // Get all server IPs for status check
    const serverIpsQuery = `SELECT serverip FROM Host UNION SELECT serverip FROM child_node`;

    // Execute all queries in parallel
    const [hostResult, childResult, serversResult] = await Promise.all([
      new Promise((resolve, reject) => {
        db.query(hostCountQuery, (err, result) => {
          if (err) reject(err);
          else resolve(result[0].host_count);
        });
      }),
      new Promise((resolve, reject) => {
        db.query(childCountQuery, (err, result) => {
          if (err) reject(err);
          else resolve(result[0].child_count);
        });
      }),
      new Promise((resolve, reject) => {
        db.query(serverIpsQuery, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      })
    ]);

    // Calculate total count
    const total_count = hostResult + childResult;

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
app.patch('/api/child-deployment-activity-log/:serverid', (req, res) => {
  const { serverid } = req.params;
  const { status } = req.body;
  const newStatus = status || 'completed';
  const sql = `UPDATE child_deployment_activity_log SET status = ? WHERE serverid = ?`;
  db.query(sql, [newStatus, serverid], (err, result) => {
    if (err) {
      console.error('Error updating child deployment activity log:', err);
      return res.status(500).json({ error: 'Failed to update child deployment activity log' });
    }
    res.status(200).json({ message: `Child deployment activity log updated to ${newStatus}` });
  });
});

// Finalize a child deployment: mark completed and create child_node entry
app.post('/api/finalize-child-deployment/:serverid', (req, res) => {
  const { serverid } = req.params;

  // Fetch child deployment data (prefer completed, but accept progress too if needed)
  const getChildSQL = `SELECT * FROM child_deployment_activity_log WHERE serverid = ? LIMIT 1`;
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
    const updateStatusSQL = `UPDATE child_deployment_activity_log SET status = 'completed' WHERE serverid = ?`;
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

        // 4) Insert/update child_node entry
        const checkSQL = 'SELECT id FROM child_node WHERE server_id = ? LIMIT 1';
        db.query(checkSQL, [serverid], (chkErr, chkRows) => {
          if (chkErr) {
            console.error('Error checking existing child node:', chkErr);
            return res.status(500).json({ error: 'Failed to finalize child node (check)' });
          }

          const resolvedRole = (dep.role || 'child');
          const values = [
            dep.user_id,
            serverid,
            dep.host_serverid || '',
            dep.serverip,
            resolvedRole,
            licenseCodeToUse,
            req.body.Management || dep.Management || null,
            req.body.Storage || dep.Storage || null,
            req.body.External_Traffic || dep.External_Traffic || null,
            req.body.VXLAN || dep.VXLAN || null
          ];

          if (chkRows && chkRows.length > 0) {
            // Update existing
            const updSQL = `
              UPDATE child_node
              SET user_id=?, host_serverid=?, serverip=?, role=?, license_code=?, Management=?, Storage=?, External_Traffic=?, VXLAN=?
              WHERE server_id=?
            `;
            const updValues = [
              values[0], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], serverid
            ];
            db.query(updSQL, updValues, (updErr) => {
              if (updErr) {
                console.error('Error updating child node record:', updErr);
                return res.status(500).json({ error: 'Failed to update child node record' });
              }
              return res.json({ message: 'Child node record updated successfully' });
            });
          } else {
            // Insert new
            const insSQL = `
              INSERT INTO child_node (user_id, server_id, host_serverid, serverip, role, license_code, Management, Storage, External_Traffic, VXLAN)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            db.query(insSQL, values, (insErr) => {
              if (insErr) {
                console.error('Error creating child node record:', insErr);
                return res.status(500).json({ error: 'Failed to create child node record' });
              }
              return res.json({ message: 'Child node record created successfully' });
            });
          }
        });
      });
    });
  });
});